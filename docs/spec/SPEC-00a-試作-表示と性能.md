# SPEC-00a: 試作（表示と性能の土台）

## 実行モデル指定（必須）

- モデル: `gpt-5.6-sol`
- reasoning effort: `high`
- 選定理由: 新規プロジェクトの立ち上げで、Worker・描画・画面・計測が複数のファイルにまたがる新機能の実装のため（判定表「新規機能の実装」「複数ファイルにまたがる改修」）

> Codex デスクトップアプリへ貼り付けて実行する場合は、モデルセレクタを上記に合わせてから貼り付けること。

---

## 目的

ブラウザだけで動く PDF 編集アプリ「かるPDF」の試作の前半である。PDF エンジン MuPDF.js（WASM）が、重い PDF を軽快に表示できるかを実測する。

試作の合格基準のうち、この SPEC で確かめるのは次の3項目である。

1. 300 ページ・100MB の PDF を開いてから、1ページ目が表示されるまで 3 秒以内
2. スクロールしたとき、次のページが白く抜けない
3. A1 図面を 400% に拡大したとき、0.5 秒以内に鮮明な表示が追いつく

書き込み（注釈）と保存は、次の SPEC-00b で扱う。ただし、00b で必要になる構造（第4章の「除外する注釈」の引数、Node からテストできるコアモジュール）は、この SPEC で先に用意しておく。

最初に `docs/要件と設計方針.md` を読み、全体の方針を把握すること。

## 対象

- 対象フォルダ: `C:\Users\gibbo\Desktop\PDF編集アプリ`（リポジトリのルート。空の新規プロジェクト）
- 既存ファイル（変更しない）: `docs/` 配下のすべて
- 作成するファイルは第3章の構成に従う。補助ファイルは `src/`、`scripts/`、`tests/`、`e2e/` の配下に限り追加してよい。追加したものは報告に列挙すること。

## 事前確認

- `npm view mupdf@1.28.1` で、パッケージが存在することを確認する。
- `npm install` の後、`node_modules/mupdf/dist/mupdf.d.ts` を読み、この SPEC に出てくる API の実際のシグネチャを確認する。SPEC の記述と食い違う場合は、型定義を正とし、報告に書く。
- `node_modules/mupdf/` の LICENSE ファイルの冒頭が「GNU AFFERO GENERAL PUBLIC LICENSE Version 3」であることを確認する。

## 変更内容

### 1. プロジェクトの土台

- `package.json`
  - `"name": "karu-pdf"`、`"private": true`、`"type": "module"`、`"license": "AGPL-3.0-or-later"`
  - 依存:
    - `mupdf` は **`1.28.1` に固定**する（`^` を付けない）
    - `react`、`react-dom`（最新の安定版）
  - 開発用の依存: `vite`、`@vitejs/plugin-react`、`typescript`、`vitest`、`@playwright/test`、`@types/react`、`@types/react-dom`、`@types/node`
  - scripts:
    - `dev`: `vite`
    - `build`: `tsc --noEmit && vite build`
    - `preview`: `vite preview`
    - `test`: `vitest run`
    - `e2e`: `playwright test --project=e2e`
    - `bench`: `playwright test --project=bench`
    - `make-test-pdf`: `node scripts/make-test-pdf.mjs`
- `vite.config.ts`
  - `base: '/karu-pdf/'`
  - `worker: { format: 'es' }`
  - `build.target: 'esnext'`
  - `optimizeDeps.exclude: ['mupdf']`
  - WASM は外部 CDN から読み込まず、ビルド成果物に同梱されること。`dist/` に `.wasm` が出力されることを確認する。
- `tsconfig.json`: `strict: true`
- `.gitignore`: `node_modules/`、`dist/`、`test-data/*.pdf`、`bench-results/`、`test-results/`、`playwright-report/`
- `LICENSE`: `node_modules/mupdf/` の AGPL-3.0 の全文をそのままコピーする。**自分の記憶から全文を書き起こしてはならない。** 見つからなければ作成せず、報告する。
- `index.html`: `<html lang="ja">`、タイトルは「かるPDF（試作）」

### 2. 座標と倍率の定義（全モジュール共通）

- **ページ座標**: MuPDF の `page.getBounds()` が返す座標系。単位は pt で y 軸は下向き、ページの /Rotate も反映済みである。アプリ内の幾何情報は、すべてこの座標系で持つ。
- **表示倍率 `zoom`**: 1.0 を 100% とする。100% のとき、1pt を 96/72 CSS px で表示する（A4 が実寸で表示される）。
- **描画スケール `renderScale`** = `zoom × 96/72 × devicePixelRatio`。ページ座標に掛けると、デバイス px になる。
- 倍率の段階: 25, 50, 67, 75, 100, 125, 150, 200, 300, 400, 600, 800 %。これに加えて「幅に合わせる」（任意の値）を用意する。ファイルを開いた直後は「幅に合わせる」にする。

### 3. ファイル構成

```
src/
  main.tsx                 React の起点
  App.tsx                  ツールバーと Viewer の配置
  core/                    MuPDF を使う処理。DOM にも Worker にも依存しない（Node でテストできる）
    mupdfDoc.ts            文書を開く、ページ数とページサイズの取得
    displayListCache.ts    ページごとの DisplayList の生成と LRU 管理
    render.ts              プレビューとタイルの描画 → RGBA の画素列を返す
  worker/
    protocol.ts            Worker との間でやり取りするメッセージの型（共有）
    pdf.worker.ts          メッセージの受付、優先度付きキュー、取消。core を呼ぶだけの薄い層
  client/
    PdfWorkerPool.ts       Worker を N 本管理し、Promise 形式の API を提供する
  viewer/
    pageLayout.ts          連続スクロールでの各ページの位置計算（純関数）
    tileGrid.ts            見えているタイルの計算（純関数）
    BitmapCache.ts         ImageBitmap の LRU（容量上限つき）
    Viewer.tsx             スクロール領域、仮想化、倍率の変更
    PageView.tsx           1ページ分の表示（プレビューの canvas とタイルの canvas）
  perf/
    metrics.ts             performance.mark と measure の集計
    DebugPanel.tsx         計測値の表示
scripts/
  make-test-pdf.mjs        試験用 PDF の生成（Node と mupdf を使う）
tests/                     Vitest（単体テストと、Node 上の mupdf を使う結合テスト）
e2e/
  smoke.spec.ts            開いて表示できることの確認（project: e2e）
  perf.spec.ts             性能の計測（project: bench）
playwright.config.ts
```

**画面のスレッド（main thread）では `mupdf` を import しない。** MuPDF の処理はすべて Worker 内で行う。ビルド後に、main 側のチャンクへ mupdf が含まれていないことを確認する。

### 4. core（MuPDF の処理）

- `openDocument(bytes: Uint8Array)`
  - `mupdf.Document.openDocument(bytes, 'application/pdf')` で開く。PDF でなければエラーにする。
  - 戻り値:
    - `pageCount`
    - `pageSizes: {width, height}[]`（各ページの `getBounds()` から求める）
    - `openMs`（計測用）
  - 全ページのサイズ取得にかかった時間も計測して返す。
- `DisplayListCache`
  - `get(pageIndex, excludeAnnotObjNums: ReadonlySet<number>)` で、ページの DisplayList を返す。
  - 生成手順は次のとおり。`page.toDisplayList(true)` は使わない。
    1. `new mupdf.DisplayList(page.getBounds())` と `new mupdf.DisplayListDevice(list)` を作る。
    2. `page.runPageContents(dev, Matrix.identity)` で本文を描く。
    3. `page.getAnnotations()` の各注釈について、注釈オブジェクトの番号が `excludeAnnotObjNums` に含まれていなければ `annot.run(dev, Matrix.identity)` で描く。
    4. `page.runPageWidgets(dev, Matrix.identity)` でフォーム部品を描く。
    5. `dev.close()` を呼ぶ。
  - 注釈オブジェクトの番号は、`annot.getObject()` が間接参照ならその番号を使う。取得方法は型定義で確認する。00a では、除外集合は常に空で呼ぶ。
  - キャッシュのキーは `pageIndex` と、除外集合の内容から作った文字列。
  - LRU の上限は 12 ページ分。追い出すときは `destroy()` を呼ぶ。
- `renderRegion(pageIndex, renderScale, deviceRect | null)`
  - `deviceRect` が null ならページ全体、指定があればその範囲（タイル）を描く。
  - 手順:
    1. `new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, bbox, true)` を作り、`clear(255)` で不透明な白にする。
    2. `new mupdf.DrawDevice(Matrix.identity, pixmap)` を作る。
    3. `list.run(dev, Matrix.scale(renderScale, renderScale))` で描く。
    4. `dev.close()` を呼ぶ。
    5. `getPixels()` の結果を**コピー**して（WASM のメモリを直接参照し続けない）、`{width, height, rgba}` を返す。
  - 使い終わった Pixmap と Device は必ず `destroy()` する。
  - 変換行列を二重に掛けていないことを、テストで確かめる（第9章）。
- MuPDF.js のオブジェクト（Page、DisplayList、Pixmap、Device）は、使い終わったらその場で `destroy()` する。FinalizationRegistry 任せにしない。

### 5. Worker とキュー

- 起動と同時に mupdf を初期化する。アプリの起動時に Worker を先に立ち上げ、ファイルを開くときに WASM の初期化を待たなくてよいようにする。
- メッセージ（`protocol.ts` で型を定義する）:
  - `open {bytes}` → `{pageCount, pageSizes, openMs, sizesMs}`
  - `render {jobId, generation, priority, pageIndex, renderScale, deviceRect|null}` → `{jobId, bitmap: ImageBitmap, renderMs}`
    - ImageBitmap は Worker 内で `createImageBitmap(new ImageData(rgba, w, h))` によって作り、transfer で返す。
  - `cancelBelow {generation}` → キューに残っている、世代が指定より古い要求を捨てる。捨てた要求は `{jobId, cancelled: true}` で応答する。
  - `stats` → `{queueLength, displayListCount}`
- 優先度は数値が小さいほど先に処理する。
  - 0: 見えているもの
  - 1: 先読みの低解像度
  - 2: 先読みの等倍
- **1回の処理で1件だけ実行し、次の処理は MessageChannel を使ってマクロタスクとして予約する。** 描画の合間に取消や新しい要求を受け付けるためである。
- `PdfWorkerPool`
  - Worker を N 本（`?workers=N` で指定、既定は 1）立ち上げる。各 Worker が文書のコピーを開く。先頭の Worker へは元の ArrayBuffer を transfer し、残りへはコピーを渡す。
  - `render` の要求は、キューが最も短い Worker へ振り分ける。
  - 00b で注釈の編集と保存を受け持つのは Worker 0 だけになる。その前提で、Worker 0 を識別できる形にしておく。

### 6. 表示（Viewer）

- 連続スクロールで、ページとページの間隔は 12 CSS px。背景は濃い灰色 `#525659`、ページはページサイズどおりの箱で表示する。
- **仮想化**: 画面の上下それぞれ2画面分の範囲にあるページだけ DOM を作る。それ以外は高さだけを持つ空の要素にする。
- **描画していないページ**: 明るい灰色 `#e8e8e8` にページ番号を表示する（白にしない）。
- **プレビュー**（ページ全体の描画）
  - ページをデバイス px にしたときの長辺が 2048 以下なら、ページ全体を、現在の描画スケールで描く（タイルは使わない）。
  - 長辺が 2048 を超えるなら、長辺がちょうど 2048 になるスケールでページ全体を描いたものを下地にし、その上に、見えている範囲のタイルを現在の描画スケールで重ねる。
- **タイル**
  - 1枚 512×512 デバイス px。
  - 描くのは、見えている範囲と、その周囲1枚分のタイル。
  - `tileGrid.ts` は、ページの矩形、表示範囲、描画スケールから、必要なタイルの一覧を返す純関数にする。
- **先読みの要求の順番**
  1. 見えているページのプレビューとタイル（優先度 0）
  2. 前後3画面分のページについて、長辺 512px の低解像度版（優先度 1）
  3. 前後1画面分のページについて、現在スケールのプレビュー（優先度 2）
- **描画のしかた**: 各ページに、プレビュー用の canvas とタイル用の canvas を置き、2d コンテキストの `drawImage` で描く（キャッシュのビットマップを消費しないため）。
  - 低解像度版 → プレビュー → タイルの順に、より鮮明なものへ置き換える。
  - **鮮明な版が届くまで、古い版や低解像度の版を消さない。**
- **スクロールしたとき**: スクロール位置が変わるたびに、見えている範囲を計算し直す（requestAnimationFrame で間引く）。画面の外へ出た要求は、世代を進めて `cancelBelow` を送り、取り消す。ただし、見えているページの要求は取り消さない。
- **倍率の変更**
  - Ctrl＋マウスホイールでは、カーソルの位置を中心に拡大縮小する。ツールバーのボタンは「縮小」「拡大」「幅に合わせる」。
  - 倍率を変えている最中は、手元のビットマップを CSS の拡大縮小で表示し続ける。操作が 150ms 止まったら、新しいスケールで描き直しを要求する。
- **BitmapCache**
  - キーは `pageIndex` ＋ 描画スケール ＋ タイル座標（プレビューなら `'full'`）。
  - 容量の上限は、推定値（幅 × 高さ × 4 バイト）の合計で 512MB。追い出すときは `bitmap.close()` を呼ぶ。

### 7. ファイルを開く・画面・計測

- **ファイルを開く方法**は3つ。
  1. 「開く」ボタン: `showOpenFilePicker`（PDF のみ）。取得した `FileSystemFileHandle` は、00b の上書き保存で使うため保持しておく。
  2. ウィンドウへのドラッグ＆ドロップ: `DataTransferItem.getAsFileSystemHandle()` でハンドルを取得する。取得できなければ File として読む。
  3. 非表示の `<input type="file" accept="application/pdf" data-testid="file-input">`: Playwright と予備の手段として使う。
- **ツールバー**（日本語）: 開く／縮小／拡大／幅に合わせる／倍率の表示（%）／現在のページ番号と総ページ数。
- **計測**（`perf/metrics.ts`）: 次の区間を `performance.mark` と `measure` で記録する。
  - `open`: ファイルを選んでから、1ページ目のプレビューを canvas に描くまで（**基準1**）
    - 開始の目印は、ファイルを選んだ直後（`arrayBuffer()` を読む前）に付ける。
  - `render-job`: 各描画要求の処理時間。Worker 側の `renderMs` と、要求から描画までの往復時間の両方を記録する。
  - `zoom-settle`: 倍率の変更が確定してから、見えているタイルがすべて現在スケールで描かれるまで（**基準3**）
  - `blank-frames`: スクロール中、フレームごとに「見えているページのうち、ビットマップが1枚も描かれていないページがあるか」を記録する。その割合と、最も長く続いた時間（ms）を出す（**基準2**）
- **`DebugPanel`**: URL に `?debug=1` を付けるか Ctrl+Shift+D で表示する。上記の値（最新値、平均、p95）、Worker のキューの長さ、BitmapCache の使用量（MB）、DisplayList の数を表示する。
- **テスト用の窓口**: `?test=1` のときだけ `window.__karu` を公開する。中身は次のとおり。
  - `getMetrics()`
  - `setZoom(zoom, anchor?)`
  - `scrollToPage(index)`
  - `isIdle()`（見えている範囲の描画がすべて終わったか）
  - `getHardwareInfo()`（`navigator.hardwareConcurrency` と `deviceMemory`）

### 8. 試験用 PDF の生成（`scripts/make-test-pdf.mjs`）

Node で mupdf を使い、次の2つのファイルを `test-data/` に生成する。

- **`test-data/heavy-300p.pdf`**（全 300 ページ。合計 90〜130MB になるよう調整する）
  - 6の倍数のページ（6, 12, …）は、**A1 横（2384×1684pt）の密なベクター図面**にする。全部で 50 ページ。
    - 短い線分を 150,000 本（線幅と色を数種類）
    - Helvetica の文字ラベルを 2,000 個
    - 斜線のハッチングを数か所
    - コンテンツストリームは Flate で圧縮する。
  - 残りの 250 ページは **A4 縦の「スキャンした紙」風**にする。
    - 1654×2339px のグレースケール画像（ノイズと濃淡を含む）を JPEG の品質 60 程度で1ページに貼る。
    - 上に Helvetica の文字を数行載せる。
  - 生成にかかった時間と、最終的なファイルサイズを表示する。
- **`test-data/sample-small.pdf`**（5 ページ）
  - A4 縦が4ページ、`/Rotate 90` の A4 が1ページ。
  - 00b の準備として、MuPDF で作った次の注釈を含める。
    - FreeText（Helv、英字の "Existing note"）
    - Square（赤、1pt）
    - Highlight
  - 各注釈の外観は `annot.update()` で生成する。

### 9. テスト

- **Vitest の単体テスト**
  - `pageLayout`: 異なる大きさのページが混ざっても、位置と全体の高さが正しいこと
  - `tileGrid`: 表示範囲の端、ページの端、倍率の境目（プレビューだけで足りる／タイルが必要）
  - `BitmapCache`: 容量を超えたら古い順に追い出され、`close()` が呼ばれること
- **Vitest の結合テスト**（Node 上の実際の mupdf と `sample-small.pdf` を使う。PDF がなければテストの中で生成する）
  - `openDocument` が正しいページ数とページサイズを返すこと（回転したページは幅と高さが入れ替わる）
  - `renderRegion` のページ全体の描画と、タイル4枚をつなぎ合わせた画像が、画素単位で一致すること（許容差は 1〜2 階調）。これで行列の二重掛けがないことを確かめる。
  - 除外集合に注釈の番号を入れると、その注釈の範囲が描かれないこと（00b の準備）
- **Playwright**
  - ブラウザは**システムにインストール済みの Edge（`channel: 'msedge'`）**を使う。`npx playwright install` でブラウザをダウンロードしない。
  - `webServer` で `vite preview` を起動する（`npm run build` した後）。
  - `e2e/smoke.spec.ts`: `sample-small.pdf` を file-input から開き、1ページ目が描かれるまでを確かめる（`isIdle()` の後、canvas の画素が一様な灰色でないこと）。
  - `e2e/perf.spec.ts`（project: bench。`heavy-300p.pdf` が必要）: Worker の本数を 1、2、3 と変え、それぞれ次の計測を行う。
    1. **開く**: file-input から開き、`open` の値を取る（3回の中央値）
    2. **スクロール**: 表示倍率を「幅に合わせる」にし、マウスホイールで毎秒およそ 3000 CSS px の速さで5秒間スクロールする。`blank-frames` の割合と、最も長く続いた時間を取る。
    3. **拡大**: A1 のページへ移動し、`setZoom(4.0)`（画面の中央を基準）を実行する。`zoom-settle` を取る。続けて 500 CSS px 横へスクロールし、見えている範囲が鮮明になるまでの時間を取る。
    4. 描画要求の処理時間の平均と p95
  - 結果は `bench-results/perf-<日時>.json` に保存し、コンソールに表でも出す。PC の情報（Node の `os.cpus()[0].model`、コア数、`os.totalmem()`）も記録する。

## 禁止事項

- `docs/` 配下のファイルを変更しないこと。
- **git の操作を一切しないこと**（commit、add、branch などを含む）。
- pdf.js、pdf-lib など、mupdf 以外の PDF ライブラリを使わないこと。
- 実行時に外部サイト（CDN など）から何も読み込まないこと。
- main thread のバンドルに mupdf を含めないこと。
- Playwright のブラウザをダウンロードしないこと（システムの Edge を使う）。
- この SPEC にない機能を足さないこと。具体的には、注釈、保存、タブ、サムネイル一覧、ページ整理、PWA は作らない（00b 以降で扱う）。
- `test-data/` の生成物以外で、ユーザーのファイルを読み書きしないこと。

## 検証項目

- [ ] `npm run build` が成功する。`dist/` に `.wasm` が含まれ、main のチャンクに mupdf が含まれない。
- [ ] `npm test` がすべて成功する。
- [ ] `npm run make-test-pdf` で2つの PDF が生成される。heavy のサイズが 90〜130MB に収まる。
- [ ] `npm run e2e` が成功する。
- [ ] `npm run bench` を実行し、Worker 1〜3 本それぞれの結果が得られる。
- [ ] `npm run dev` で起動し、`?debug=1` でデバッグパネルが表示される。

## 報告してほしいこと

- 作成したファイルの一覧（補助ファイルを追加した場合はその理由も）
- 型定義を確認した結果、SPEC の記述と違っていた API とその対応
- 計測結果の表（Worker 1〜3 本 × 開く／白抜けの割合と最長時間／拡大の確定／拡大後の横スクロール／描画の平均と p95）、および計測した PC の情報
- 基準1〜3に対する見立て（満たす、満たさない、ぎりぎり）と、ボトルネックだと考える箇所
- SPEC から逸脱した箇所があれば、その内容と理由
- 残課題
