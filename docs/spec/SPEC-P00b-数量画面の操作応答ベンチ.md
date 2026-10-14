# SPEC-P00b: 数量画面の操作応答ベンチ（Playwright）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 大量データの PDF 生成、画面操作、ページ内計測の設計を伴う新規ベンチのため既定の sol-high。

---

## 目的

高速化の改修前後を同じ条件で比べるため、数量パネルと集計表を開いた状態での操作応答を測る Playwright ベンチを作る。
**製品コードは変更しない。** 新規ファイル `e2e/quantity-ui.perf.spec.ts` だけを作る。

`playwright.config.ts` の `bench` プロジェクトは `/(?:perf|perf-edit|perf-organize)\.spec\.ts/` に一致するファイルを実行するので、
このファイルは `npx playwright test --project=bench e2e/quantity-ui.perf.spec.ts` で単独実行できる。

## 前提（別SPECで製品側に入る計数器）

URL に `perf=1` を付けると `window.__karuPerf = { get(): Record<string, { count: number; totalMs: number; maxMs: number }>; reset(): void }` が定義される。
計数器名の例: `store.notify.quantity`, `store.notify.ui`, `store.listenerCalls`, `store.getCountFixtures`, `QuantityIndex.build`,
`store.refreshSymbolCandidates`, `store.dirtySummary.compute`, `store.getPageAnnotations`, `store.countOverlayObjNums`, `store.issueOverlayObjNums`,
`QuantityTable.render`, `QuantityTable.linkRelations`, `QuantityTable.buildData`, `QuantityTable.project`,
`FixturePanel.render`, `FixturePanel.linkRelations`, `FixturePanel.groupFixtures`。
`window.__karuPerf` が無い場合は計数器の欄を null にして、時間だけ測って続行する（改修前の比較にも使えるように）。
型は spec ファイル内でローカルに宣言する（`declare global` で Window に `__karuPerf?` を足す）。

## 構成

- S: 項目 F=100、拾い M=1,000、ページ P=10
- L: 項目 F=1,000、拾い M=10,000、ページ P=100
- 環境変数 `KARU_PERF_SIZES`（例 `S`、`S,L`。既定 `S,L`）、`KARU_PERF_RUNS`（既定 1。構成ごとの繰返し回数。繰返しのたびに新しい BrowserContext）、`KARU_PERF_LABEL`（既定 `run`）。
- 各構成を1つの `test()` にする（`test.describe.configure({ mode: 'serial' })`）。タイムアウトは `test.setTimeout(30 * 60_000)`。

## PDF の生成（Node 側、決定的）

`e2e/quantity-table.annotate.spec.ts` の `drawingPdf` と同じ方式（mupdf の PDFDocument + AnnotationStore + `applyEdits` + BIZUDGothic フォント）で作る。

- ページ: 500×600 を P 枚。
- 項目 `f${i}`: `{ id: 'f'+i, code: 'F'+String(i).padStart(4,'0'), name: '項目'+i, category: ['電灯','コンセント','幹線','動力','弱電','火報','空調','衛生','建築','その他'][i % 10], order: i, kind: 'count', style: nextCountStyle([]) }`。
  i % 10 === 0 は `breakdown: { book: '電気設備', section: '庁舎', subject: '電灯設備', middle: '電灯分岐', item: '分電盤' }` を付ける。
- 拾い j: 項目 `f${j % F}`、ページ `(j * 7) % P`、中心 `[20 + (j % 40) * 11, 20 + (Math.floor(j / 40) % 50) * 11]`、
  `store.create({ kind: 'symbol', symbol: 'circle', pageIndex, rect: [x-5, y-5, x+5, y+5], count: { version: 2, id: 'm'+j, fixtureId } })`（drawingPdf と同じ形）。
- `applyEdits(doc, store.toEdits(), { BIZUDGothic: font }).errors` が空であることを expect。
- `test-results/perf-quantity/quantity-${size}.pdf` に書く（mkdir recursive）。生成時間も結果に残す。

## ページ内の計測器（`page.addInitScript` で注入）

- capture フェーズで `pointerdown`, `keydown`, `wheel`, `input` を document に登録し、`window.__perfLastInput = event.timeStamp` を記録。
- `PerformanceObserver({ type: 'longtask', buffered: true })` があれば `window.__perfLongTasks` 配列へ `{ start, duration }` を溜める（無いブラウザでは null）。
- 1操作の応答時間 = 操作直後に `page.evaluate` で `requestAnimationFrame(() => setTimeout(() => resolve(performance.now() - window.__perfLastInput), 0))` を待った値。
  操作の後で状態の到達を待つ必要がある場合（下記）は、到達を確認してから同じ方法で測る。
- 1操作群（下記 A〜E）の前に `__karuPerf.reset()` と longtask 配列のクリア、`performance.memory?.usedJSHeapSize` の記録。後で計数器・longtask の件数/合計/最大・heap を取る。

## 手順（構成ごと）

1. `page.goto('/karu-pdf/?test=1&perf=1&workers=3')`、`window.__karu` を待つ。`addInitScript` で `localStorage.setItem('karu-pdf:fixture-panel-settings-open', 'true')`。
2. 開く: `page.getByTestId('file-input').setInputFiles(pdfPath)` から、`.page-view[data-page-index="0"]` が見え、`数量` タブを押し、
   `window.__karu.getCountFixtures().length === F` になり、`window.__karu.getDrawingScanMetrics().scanning === false` になるまでの時間を `openMs` として記録。
   `window.__karu.setZoom(1)`。
3. 集計表を開く: `集計表を開く` ボタン押下から `getByRole('region', { name: '数量の集計表', exact: true })` が見えるまでを `tableOpenMs`。
4. 計測（各群の samples / median / p95 / max と、上記の計数器・longtask・heap）:
   - **A 項目選択**: k=0..min(100, F)-1 で `F${pad((k * 7) % F)} 項目${(k * 7) % F}` のボタン（`getByTestId('fixture-panel').getByRole('button', { name, exact: true })`）をクリック。
     1回目以外が同じ項目に戻らないこと。クリック後、`数量拾い` ボタンが `aria-pressed="true"` であることを確認してから応答時間を取る。
     （項目ボタンの選択状態の表し方は FixturePanel.tsx を読んで、選ばれたことを確認できる属性があればそれも待つ）
   - **B 検索欄**: 数量パネルの項目検索欄（FixturePanel.tsx で検索の state `search` に結び付いた input を特定する）に `F01` を1文字ずつ `page.keyboard.type(ch)` し、`Backspace` を3回。これを5回。1キーごとに1サンプル。
   - **C 集計表スクロール**: 集計表のスクロール領域（QuantityTable.tsx の `scrollRef` の要素）の中央にマウスを置き `page.mouse.wheel(0, 400)` を30回、続いて `-400` を30回。1回ごとに1サンプル。
   - **D 1点追加**: `F0001 項目1` を選び、`annotation-layer-0` の上で、ページ座標 `(20 + n * 22, 590)`（n=0..19）を e2e/count-fixtures.annotate.spec.ts の `clickPoint` と同じ換算でクリック。
     1クリックごと、`window.__karu.getEditableAnnotations(0)` の件数が1増えたことを poll で確認してから応答時間を取る。
   - **E Undo/Redo**: 続けて `Control+z` を20回、`Control+y` を20回。1回ごとに件数の増減を確認してから応答時間を取る。
     最後に件数が D の直後と一致することを expect。
5. 結果 JSON:
   ```
   { kind: 'karu-quantity-ui-baseline', label, timestamp, commit, size, run, F, M, P,
     environment: { userAgent, hardwareConcurrency, deviceMemory, devicePixelRatio, viewport, nodeVersion, os: os.type()+' '+os.release(), cpu: os.cpus()[0]?.model },
     generateMs, openMs, tableOpenMs,
     groups: { select: {...}, search: {...}, tableScroll: {...}, addOne: {...}, undoRedo: { undo: {...}, redo: {...} } } }
   ```
   各群: `{ samples: number[], median, p95, max, counters: Record|null, longTasks: { count, totalMs, maxMs } | null, heapBefore, heapAfter }`。
   commit は `execSync('git rev-parse HEAD')`（try/catch で null）。p95 は昇順で ceil(0.95n)-1 番目。
   `bench-results/perf-baseline/quantity-ui-${label}-${size}-r${run}-${timestamp}.json` に書き（mkdir recursive）、要約1行を console.log。
6. 時間の合否 assert はしない。操作が正しく効いたこと（選択、件数の増減、表が見えること）だけ assert する。

## 禁止事項

- `e2e/quantity-ui.perf.spec.ts` 以外のファイルを変更しないこと（playwright.config.ts も変えない）。
- 個人情報や実図面を使わない。外部へ送信しない。https:// を含む文字列を足さない。
- `test-data/` 配下へ書かない。

## 報告してほしいこと

- 作ったファイル、各群で使ったセレクタと、その根拠にしたソースの箇所
- SPEC から外れた所と理由、計測方法の限界（Playwright の往復時間が乗ること等）
