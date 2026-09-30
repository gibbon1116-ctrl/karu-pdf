# SPEC-02d-2: 文字の選択（コピー）と、文字への印（ハイライト・下線・取り消し線）

## 実行モデル指定（必須）

- モデル: `gpt-5.6-sol`
- reasoning effort: `high`
- 選定理由: Worker 側の文字情報（StructuredText）の扱いと、画面の新しい道具、注釈の中核の追加にまたがる新機能のため

---

## 目的

利用者から「選択した文字にだけ蛍光ペンで色を付ける等の機能も欲しい」という要望が出た（Acrobat の「テキストをハイライト」に当たる）。

次の機能を作る。
- PDF の中の文字を選んでコピーする。
- 選んだ文字に、ハイライト・下線・取り消し線を付ける。

今の「蛍光ペン」（自由な線を描く）は、そのまま残す。

最初に次を読むこと。
- `docs/追加機能の計画.md`
- SPEC-01b、SPEC-02a（道具の段と分割ボタン）
- 今の `src/core/annotations.ts`、`src/worker/`、`src/client/PdfWorkerPool.ts`、`src/editor/`、`src/app/ToolRow.tsx`

## MuPDF.js で使える機能（型定義で確認済み）

- `page.toStructuredText(options)` → `StructuredText`
- `StructuredText.highlight(p, q, max_hits?)`: 2点の間の文字の四角形（Quad）の一覧を返す。
- `StructuredText.copy(p, q)`: 2点の間の文字列を返す。
- `StructuredText.snap(p, q, mode)`: 単語・行に合わせる（`'chars' | 'words' | 'lines'`）。
- `PDFAnnotation.setQuadPoints(quadlist)`: Highlight、Underline、StrikeOut の文字の位置。

## 対象

- 変更してよいファイル: `src/core/annotations.ts`（種類の追加）、新規 `src/core/textSelection.ts`、`src/worker/`、`src/client/PdfWorkerPool.ts`、`src/editor/`、`src/app/`、`src/App.tsx`、`src/styles.css`、`tests/`、`e2e/`
- 変更しないファイル: `docs/`（この SPEC を除く）、`public/`、`LICENSE`、設定ファイル、`src/core/textLayout.ts`、`src/viewer/`（重ね表示の組み込みに必要な最小限は可）

## 変更内容

### 1. Worker（`src/core/textSelection.ts`、Worker 0）

- ページの `StructuredText` を、Worker 0 でページごとにキャッシュする（最大 20 ページ、LRU、`destroy()` を忘れない）。
- 新しいメッセージ:
  - `selectText {docId, pageIndex, from, to, mode}` → `{quads, text}`
    - `from` と `to` はページ座標。`mode` は `'chars'`（ドラッグ）、`'words'`（ダブルクリック）、`'lines'`（トリプルクリック）。
  - `pageHasText {docId, pageIndex}` → `boolean`（スキャン画像などで、文字が無いページの判定）
- 文書が変わったとき（書き込みの反映は関係ない。ページ整理の適用、閉じるとき）は、キャッシュを捨てる。

### 2. 道具（道具の段に「文字に印▼」を加える。キー `M`）

- 分割ボタン「文字に印▼」: 文字を選択／ハイライト／下線／取り消し線
- **文字を選択**
  - ドラッグで文字を選ぶ。選んだ部分は、半透明の青い四角（Quad）で表示する。
  - ダブルクリックで単語、トリプルクリックで行を選ぶ。
  - `Ctrl+C` でコピーする（クリップボードへの書き込みは `navigator.clipboard.writeText`）。
  - 右クリックの代わりに、選んだ範囲の近くに小さな帯を出す: ［コピー］［ハイライト］［下線］［取り消し線］
- **ハイライト／下線／取り消し線**
  - ドラッグで文字を選び、離したら、その文字に印を付ける（注釈を作る）。道具はそのまま（続けて付けられる）。
- ドラッグ中の問い合わせは、requestAnimationFrame ごとに最大1回とし、前の応答が返るまで次を送らない（Worker を詰まらせない）。
- 文字の無いページでは、ドラッグを始めたときに「このページには選択できる文字がありません（スキャン画像など）」と、画面の下に短く表示する。
- ページをまたぐ選択は、今回はしない（1ページの中だけ）。

### 3. 注釈（`src/core/annotations.ts`）

- `AnnotationEdit` と `AnnotationInfo` に、Highlight・Underline・StrikeOut を加える。
  - 属性は `quads`（ページ座標の Quad の一覧）、`color`、`opacity`（ハイライトの既定は 0.4）。
  - 外観は MuPDF の `update()` に任せる（フォントを使わないため）。
- 既定の色: ハイライトは黄、下線は赤、取り消し線は赤。書式パネルで色（ハイライトは黄・緑・水色・桃、下線と取り消し線は 8 色）と、ハイライトの透明度を変えられる。
- 選んだとき:
  - Quad の外接枠を点線で示す。
  - 色の変更と削除ができる。
  - 移動と大きさの変更はできない（文字に結び付いているため）。
- 他のソフトで作られた Highlight、Underline、StrikeOut も、編集できる注釈（色の変更と削除）として読み込む。今は下地に描いているので、`editable` の対象を広げる。
- 重ね表示（SVG）で Quad を描く。
  - ハイライト: 半透明の塗り（`mix-blend-mode: multiply`）
  - 下線: 下辺の線
  - 取り消し線: 中央の線

### 4. 書き込みの一覧（02d）との関係

- 02d の書き込みの一覧に、印の付いた文字（`text`）も表示できるよう、`AnnotationInfo` に `markedText`（Quad の範囲の文字列。作るときに記録する。/Contents に入れる）を持たせる。

## テスト

- **Node の結合テスト**
  - 文字のある試験用 PDF（`scripts/make-test-pdf.mjs` の sample-small には文字がある）で、`selectText` が Quad と文字列を返すこと。
  - ハイライト・下線・取り消し線を作って保存し、開き直して、種類・Quad・色・透明度・markedText が戻ること。
  - PDFium で描いても見えること。
- **単体テスト**: 問い合わせの間引き（前の応答が返るまで次を送らない）。
- **画面のテスト（e2e）**
  1. 「文字を選択」でドラッグ → `Ctrl+C` → クリップボードの文字列を確かめる（Playwright の権限を付けてよい）。
  2. ハイライトでドラッグ → 保存して開き直す → ハイライトがあり、`markedText` が選んだ文字であることを確かめる。
  3. 下線と取り消し線も1つずつ確かめる。
  4. スキャン風のページ（heavy の A4）でドラッグすると、「選択できる文字がありません」の表示が出ることを確かめる。
- **性能**: 文字の多いページ（`test-data/real/公共建築工事標準仕様書_建築_R7.pdf` がある場合）で、ドラッグ中のフレーム間隔の p95 が 20ms 以下であること。`e2e/perf-edit.spec.ts` に加え、1回だけ実行する。

## 禁止事項

- 対象外のファイルを変更しないこと。git の変更操作をしないこと。
- ドラッグ中に、React の state をマウスの動きごとに更新しないこと。
- 自分で起動したサーバーは必ず止め、一時ファイルは削除すること。

## 検証項目

- [ ] `npm run build`、`npm test`、`npm run e2e` がすべて成功する。
- [ ] 上の性能の計測の結果を報告する。

## 報告してほしいこと

- 作成、変更したファイルと要点
- 検証の結果と性能
- 逸脱と残課題
