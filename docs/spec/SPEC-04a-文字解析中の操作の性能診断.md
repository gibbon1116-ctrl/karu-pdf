# SPEC-04a: 文字解析が実際に動いている間の操作の性能診断と、測定前の空回し

> **結果（2026-10-04）:** Codex（gpt-6.1-sol / high）が実装した。「1.」の空回しは採用した。「2.」の診断スクリプトは採用しない。利用者が「図面内文字の抽出は不要」と判断し、抽出の機能をメニューから外すことになったため、解析実働中の性能を測る必要がなくなった。

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 新しい測定スクリプトの作成で、操作と解析処理を確実に重ねる測り方に判断が要るため（判定表「新規機能の実装」「仕様に判断の余地が残っている作業」）

> Codex デスクトップアプリへ貼り付けて実行する場合は、モデルセレクタを上記に合わせてから貼り付けること。

---

## 目的

営繕改修の試用版（1.1.0）では、300ページのPDFで「図面内文字を抽出」を開始した状態の性能を測ったが、測定中の操作が続いたため抽出は 0/300 ページのまま待機していた。**抽出が実際に動いている間**に操作したときの速さ・待ち・メモリが未測定である。これを1回の短い診断で測れるようにする。

あわせて、既存の比較測定 `scripts/eizen-bench.mjs` では、ブラウザ起動後の最初の試行だけが版によらず約400ms遅いことが分かった（`docs/調査/営繕改修_試用版報告.md` の追記）。今後の比較が実行順に左右されないよう、記録しない空回しを先に行う。

## 確かめたこと（2026-10-04、現在のコード）

- 文字抽出は `src/app/TextExportDialog.tsx` → `src/app/textExport.ts` の `runTextExport` で、ページごとに `pool.extractPageText()` を呼ぶ。
- `pool.extractPageText()`（`src/client/PdfWorkerPool.ts:469`）は **Worker 0** へ `{ type: 'extractPageText', requestId, docId, pageIndex }` を送る。応答は `{ type: 'pageTextExtracted', requestId, result }`（`src/worker/protocol.ts:411`）。中止時は `{ type: 'cancelTextExtraction', requestId }` を送る。
- 各ページの前後に `quiet()` があり、`pool.isIdle()` が真かつ最後の操作から 1,000ms（`TEXT_EXPORT_QUIET_MS`）経つまで待つ。操作の判定は、ダイアログの外で起きた `pointerdown`、ボタンを押した `pointermove`、`wheel`、`keydown`、`input`、`scroll` の各イベント。
- 処理中のページ（MuPDF の同期呼出し）は途中で止められない。
- `window.__karu.pageTextLines(pageIndex)`（`?test=1` のとき）は Worker 0 への要求で、DOM イベントを起こさない。Worker 0 の混み具合を測る探りに使える。
- 画面の描画は Worker 1〜3 が担当する。
- 300ページ合成PDF（`test-data/heavy-300p.pdf`）の全ページ抽出は約15.8秒（1ページ平均約53ms）だった。

## 対象

- 作業フォルダ: `C:\Users\gibbo\.codex\worktrees\dda9\PDF編集アプリ`
- 変更してよいファイル:
  - `scripts/eizen-bench.mjs` — 下の「1.」の空回しの追加だけ
  - `scripts/eizen-extraction-active.mjs` — 新しく作る（下の「2.」）
- 変更しないファイル: 上記以外のすべて。特に `src/`、`tests/`、`e2e/`、`package.json`、`package-lock.json`、`scripts/eizen-compare.mjs`、`scripts/serve-fixed.mjs`、`test-data/`、`bench-results/`、`dist*/`、`release/`、`work/`

## 事前確認

- `scripts/eizen-bench.mjs` の全体（サーバーの起動、`processMemory()`、`frameAction()`、`trial()` の開き方と計時、記録の書き出し）を読み、同じ書き方を使う。
- `scripts/serve-fixed.mjs` の `createFixedServer` の使い方を確認する。
- `src/worker/protocol.ts` で、Worker が失敗を返すときの応答の型（`requestId` を持つ失敗応答）を確認し、抽出要求の失敗も記録できるようにする。
- `src/App.tsx` の `window.__karu`（1438行付近）で使える関数を確認する。

## 変更内容

### 1. `scripts/eizen-bench.mjs`: 記録しない空回し

1. 引数 `--no-browser-warmup` を追加する。指定がなければ空回しを行う。
2. 計時する試行（`for (const name of fixtureNames)` の繰り返し）の前に、各版（`datasets` の各要素。ポートは `4175 + variant`）について1回ずつ、版の順に空回しを行う。
   - 試行と同じ設定の**新しいコンテキスト**を作り、同じURLを開き、`fixtureNames` の最初のPDFを開く。
   - 鮮明表示（`window.__karu.getMetrics().openSharp.count > 0`）まで待つ（上限180秒）。
   - 受付から初表示・鮮明表示までの時間を、`trial()` と同じ方法（`file-input` の `change` を受けた時刻から `requestAnimationFrame` で監視）で取り、`dataset.browserWarmup`（配列）に `{ fixture, firstMs, sharpMs }` として残す。`trials` には入れない。
   - コンテキストを閉じる。
3. `result.conditions` に `browserWarmup` を追加する。空回しありは `'one unrecorded open per build in its own context before timed trials'`、なしは `'none'`。
4. 既存の計時・指標・試行順・出力形式は変えない。

### 2. `scripts/eizen-extraction-active.mjs`（新規）: 解析実働中の診断

#### 引数

| 引数 | 既定値 | 内容 |
|---|---|---|
| `--build-dir` | `bench-results/eizen/review-final-1.1.0-dist` | 測る版（ビルド済みフォルダー） |
| `--fixture` | `heavy-300p.pdf` | `test-data/` 内のPDF名 |
| `--mode` | `operations` | `operations`（操作を重ねる）または `per-page`（ページごとの抽出時間だけ） |
| `--runs` | `2` | `operations` の組数。各組で「抽出なし」と「抽出あり」を1回ずつ。1組目は なし→あり、2組目は あり→なし の順 |
| `--label` | `extraction-active` | 出力フォルダー名の先頭（英数字とハイフンだけ） |
| `--complete-timeout-ms` | `300000` | 抽出の完了を待つ上限 |

- サーバーは `createFixedServer(path.resolve(buildDir))` を `127.0.0.1:4178` で待ち受ける。URL は `http://127.0.0.1:4178/karu-pdf/?test=1&workers=4&warm=0`。
- ブラウザーは `chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-precise-memory-info'] })`。コンテキストは `viewport 1440×900`、`deviceScaleFactor: 1`、`serviceWorkers: 'block'`、`acceptDownloads: true`。
- 出力は `bench-results/eizen/<label>-<日時（:と.を-に置換）>/results.json`。試行ごとに書き出す（途中で止まっても残す）。
- `processMemory()` は `eizen-bench.mjs` と同じ方法（CDP の `SystemInfo.getProcessInfo` と PowerShell の `Get-Process` の private bytes 合計）を、このファイルに写して使う。`eizen-bench.mjs` は読み込むと測定が始まるので import しない。
- 計時する試行の前に、上の「1.」と同じ空回しを1回行い、`browserWarmup` に残す。

#### ページ内の記録（`addInitScript`）

`eizen-bench.mjs` と同じように `window.Worker` を包み、次を `window.__extractionIo` に残す。

- `requests`: Worker 0 に送られた `extractPageText` ごとに `{ worker, requestId, pageIndex, postedAt, doneAt, ms, lines, cancelledAt, error }`。
  - `postedAt`: `super.postMessage` の直後の `performance.now()`。
  - 応答 `pageTextExtracted`（同じ Worker・同じ `requestId`）で `doneAt`、`ms = doneAt - postedAt`、`lines = result.lines.length` を入れる。
  - 失敗応答で `doneAt` と `error` を入れる。
  - `cancelTextExtraction` を送ったら `cancelledAt` を入れる。
- `waitForNextPost(timeoutMs)`: 次に `extractPageText` が送られた瞬間に、その記録を返す Promise。時間切れなら `null`。
- `inFlight()`: 応答も中止もまだの要求（なければ `null`）。
- 受付から鮮明表示までの監視は `eizen-bench.mjs` の `__eizenOpen` と同じ方法でよい（鮮明表示を待つためだけに使う）。

#### `operations` モードの1回の試行

条件は `off`（抽出なし）または `on`（抽出あり）。

1. 新しいコンテキストでアプリを開き、`file-input` に `test-data/<fixture>` を入れ、鮮明表示まで待つ。`memory.afterOpen` を取る。
2. 探りの準備: `window.__karu.pageTextLines(1)` を1回呼び、かかった時間を `probeWarmMs` に残す（以後の探りで初回の読込が混ざらないようにする）。
3. `on` のときだけ、`eizen-bench.mjs` と同じUI操作で抽出を始める: 「ファイル▼」→「図面内文字を抽出…」→「抽出するページ」を `all` →「文字を抽出」。押した直後のページ内時刻を `extractionStartedAt` に残す。その後、最初の `pageTextExtracted` が届くまで待ち（上限30秒）、`firstPageDoneMs` を残す。届かなければ失敗として記録し、試行を止める。
   `off` のときは、同じ位置で3,000ms待つ。
4. 次の操作を2巡行う。1巡 = `scroll` → `zoom400` → `pan250` → （倍率を1に戻して鮮明表示を待つ。計時しない）→ `probe`。
   各操作の前に次の「合図待ち」をページ内で行う。
   - まず1,200ms待つ（この間、ハーネスはDOMイベントを起こさない）。
   - `on` のときは、続けて `waitForNextPost(10000)` で次の抽出要求が送られた瞬間を待ち、**同じ `page.evaluate` の中で直ちに**操作を始める。時間切れなら合図は `timeout` と記録して、そのまま操作する。
   - `off` のときは1,200ms待った後すぐ操作する。
   各操作の測り方（ページ内。`eizen-bench.mjs` の `frameAction()` に合わせる）:
   - `scroll`: `viewer.scrollTop = 0` から 1500px/秒で2,000ms スクロールする。フレーム間隔の p95・最大、白抜け（`resetBlankFrames()` と `getMetrics().blankFrames`）。
   - `zoom400`: `window.__karu.setZoom(4)` から、`zoomSettle.count` が増えて `isSharp()` が真になるまでの時間。フレーム間隔の p95・最大。
   - `pan250`: `viewer.scrollLeft += 250` から、`panSettle.count` が増えて `isSharp()` が真になるまでの時間。フレーム間隔の p95・最大。
   - `probe`: `await window.__karu.pageTextLines(1)` の往復時間。
   各操作の記録: `{ round, kind, condition, gate: 'extraction-post' | 'idle-only' | 'timeout', gateRequest: { requestId, pageIndex } | null, elapsedMs, frameP95Ms, frameMaxMs, blank, overlappedRequests }`。`overlappedRequests` は、操作の開始から終了までの間に処理中だった抽出要求の `{ pageIndex, ms }` の一覧（ハーネス側で `requests` から求める）。
5. 操作の後に `memory.afterOperations` を取る。
6. `on` のときだけ:
   - DOMイベントを起こさずに、ダイアログ `.text-export-dialog` の `[role="status"]` に結果（`/(\d+)ページ・(\d+)行。/`）が出るまで待つ。Node側で500msごとに確認し、上限は `--complete-timeout-ms`。完了までの時間（`extractionStartedAt` から）、ページ数、行数を `completion` に残す。時間切れや中止なら `completion.status` にその旨を残す。
   - `memory.afterExtractionComplete` を取り、続けて CDP の `HeapProfiler.collectGarbage` の後に `Performance.getMetrics` の `JSHeapUsedSize` を `retainedHeapAfterExtractionCompleteBytes` に残す。
   - ダイアログの「閉じる」を押し、`memory.afterDialogClose` を取る。
7. `off` のときだけ: 5.の後に、CDP の `HeapProfiler.collectGarbage` の後の `JSHeapUsedSize` を `retainedHeapAfterOperationsBytes` に残す。`on` では抽出中に回収を強制しない（抽出に影響するため）。`on` の回収後の値は6.の `retainedHeapAfterExtractionCompleteBytes` だけにする。
8. `window.__karu.listTabs()` の全タブを `closeTab` で閉じ、500ms待って `memory.afterDocumentClose` を取る。
9. 試行の記録に `extraction`（`requests` の全件、ページごとの時間の中央値・p95・最大、遅い順の5ページ `{ pageIndex, ms, lines }`）を付ける。

注意: 保存（`saveToBytes`）はこの診断では行わない。保存すると抽出が中止されることが既に分かっているため。

#### `per-page` モード

1回の試行で、PDFを開き、鮮明表示まで待ち、`memory.afterOpen` を取ってから全ページの抽出を始める。DOMイベントを起こさずに完了まで待ち（上限 `--complete-timeout-ms`）、`completion`、`extraction`（上と同じ集計）、`memory.afterExtractionComplete`、回収後の `JSHeapUsedSize` を残す。最後にダイアログを閉じ、文書を閉じて `memory.afterDocumentClose` を取る。

#### 記録の全体

`results.json` には次を含める: `schema: 1`、`label`、`mode`、`timestamp`、`buildDir`、`sourceSha`（`git rev-parse HEAD`）、`browser`、`node`、`hardware`（`eizen-bench.mjs` と同じ項目）、`fixture`（名前・バイト数・SHA-256）、`conditions`（viewport、workers: 4、quietMs: 1000、idleBeforeOpMs: 1200、gateTimeoutMs: 10000、`browserWarmup` の説明、`harnessSha256`）、`browserWarmup`、`trials`、`errors`、`summary`。

`summary` は条件（off / on）と操作の種類ごとに、`elapsedMs` と `frameP95Ms` の中央値と最大、合図が `extraction-post` だった回数を持つ。`on` についてはページごとの抽出時間（中央値・p95・最大）と完了までの時間も持つ。終わりに `console.table` で `summary` を表示し、出力先のパスを表示する。

#### 失敗時

`eizen-bench.mjs` と同じく、失敗した段階・内容・診断情報を `<fixture>-<run>-<condition>-failure.json` とスクリーンショットに残してから止める。サーバーとブラウザーは必ず閉じる。

## 禁止事項

- 元データ（`test-data/` のPDF、`bench-results/` の既存記録、`dist*/`、`release/`、`work/`）を変更しないこと
- 「対象」に書いた2ファイル以外を変更・作成しないこと
- `scripts/eizen-bench.mjs` の既存の計時・指標・試行順・出力形式を変えないこと（空回しの追加と `conditions.browserWarmup` の追加だけ）
- **測定・テスト・ビルドを実行しないこと。ブラウザーを起動しないこと。** 確認は `node --check scripts/eizen-bench.mjs` と `node --check scripts/eizen-extraction-active.mjs` だけにする（測定と結果確認は Claude Code 側で行う）
- 依存関係を追加しないこと（`@playwright/test` と Node の標準モジュールだけを使う）
- git 操作をしないこと

## 検証項目（Claude Code 側で実施）

- [ ] 2ファイルとも `node --check` を通る
- [ ] `node scripts/eizen-extraction-active.mjs --runs 1` が完走し、`on` の操作のうち合図が `extraction-post` の回が過半数ある
- [ ] `on` の `completion.status` が完了で、ページ数が300
- [ ] `node scripts/eizen-extraction-active.mjs --mode per-page --fixture shichigahama-drawing.pdf` が完走する
- [ ] `eizen-bench.mjs` の差分が空回しと `conditions.browserWarmup` の追加だけである

## 報告してほしいこと

- 変更・作成したファイル一覧
- 追加した関数名と、その役割
- `node --check` の結果
- SPEC から逸脱した箇所があれば、その内容と理由
- 測る前に Claude Code が知っておくべき注意（想定した時間、既知の弱点など）
