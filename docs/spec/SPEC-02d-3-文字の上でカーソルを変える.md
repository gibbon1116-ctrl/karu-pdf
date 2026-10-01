# SPEC-02d-3: 文字に印を付ける道具で、文字の上ではカーソルを文字カーソルにする

## 実行モデル指定（必須）

- モデル: `gpt-5.6-sol`
- reasoning effort: `high`
- 選定理由: Worker への新しい問い合わせと、画面側の当たり判定を、動作の軽さの条件を守って組み込むため

---

## 目的

利用者から次の要望が出た（2026-10-01）。

> 文字にハイライト等を付けるとき、文字にカーソルがあっていることが分かるように、カーソルの形が変わるようにして下さい。

「文字に印▼」の道具（文字を選択・ハイライト・下線・取り消し線）を使っているときのカーソルを、次のようにする。
- 選べる文字の上: 文字カーソル（`cursor: text`。I の形）
- それ以外: 矢印（`cursor: default`）

今は十字（`crosshair`）が出ている。

最初に、SPEC-02d-2 と、今の `src/editor/AnnotationLayer.tsx`、`src/core/textSelection.ts` を読むこと。

## 対象

- 変更してよいファイル: `src/core/textSelection.ts`、`src/worker/`、`src/client/PdfWorkerPool.ts`、`src/editor/AnnotationLayer.tsx`、新規 `src/editor/textHitTest.ts`、`src/styles.css`、`tests/`、`e2e/`
- 変更しないファイル: 上記以外

## 変更内容

### 1. Worker（Worker 0）

- 新しいメッセージ `pageTextLines {docId, pageIndex}` → `{lines: Rect[]}`
  - `StructuredTextCache` の、そのページの `StructuredText` を使う。キャッシュがあれば使い回し、無ければ作ってキャッシュに入れる。
  - `walk()` の `beginLine(bbox)` で、行ごとの外接枠を集める。空白だけの行は除く。
  - 座標は、`selectText` と同じページ座標にする。
  - 文字の無いページでは、空の配列を返す。
- 検索中でも待たされないよう、SPEC-02d-2 のレビューで加えた「短い要求」（`INTERACTIVE_REQUESTS`）に加える。

### 2. 画面（`AnnotationLayer.tsx`）

- 文字に印の道具のときだけ、ページにカーソルが**初めて入ったとき**（`pointerenter` か、最初の `pointermove`）に、そのページの行の枠を1回だけ問い合わせる。
  - 結果は、そのページの注釈レイヤーの ref に持つ。道具を切り替えても捨てなくてよい。ページ整理の適用などでレイヤーが作り直されたときは、作り直しに任せる。
  - 応答が返るまでは矢印にする。
- `pointermove` のたびに、`textHitTest.ts` の関数で「カーソルの位置が行の枠（上下左右に 1pt 広げる）に入っているか」を判定する。
  - 結果に応じて、SVG 要素の `style.cursor` を `text` か `default` に直接書き換える。前と同じ値なら書き換えない。
  - **React の state は使わない**（マウスが動くたびに描き直さないため）。
- 文字を選んでドラッグしている間は、ずっと `text` にする。
- 既にある書き込みの上や、操作の帯（［コピー］など）の上は、今までどおりそれぞれのカーソルにする。
- 文字に印の道具でないときは、問い合わせも判定もしない。今のカーソルのまま変えない。
- CSS の `.annotation-layer:not(.tool-select)` の十字は、文字に印の4つの道具では使わない。

### 3. 当たり判定（`src/editor/textHitTest.ts`）

- `hitTextLine(lines: readonly Rect[], point: Point, padding = 1): boolean` を作る。
- 行が多いページ（2,000 行を超える）では、y 方向の区分け（例: 20pt ごと）を一度だけ作り、判定ではその区分けの中だけを調べる。区分けの作成も、この関数群の中にまとめる。

## 動作の軽さ（最重要）

- 文字に印の道具を使っていないときは、Worker に何も問い合わせない。
- 問い合わせは、カーソルが入ったページごとに1回だけにする。全ページ分を先に取りに行かない。
- `pointermove` で行う処理は、当たり判定と `style.cursor` の書き換えだけにする。

## テスト

- **単体テスト**（`textHitTest`）: 枠の中、外、余白 1pt の境目、2,000 行を超える場合の区分けで同じ結果になること。
- **Node の結合テスト**: `sample-small.pdf` の1ページ目で、`pageTextLines` が1行以上を返し、「Sample page 1」の検索結果の Quad を含む行があること。文字の無いページでは空になること。
- **画面のテスト（e2e）**
  1. 「文字を選択」（M）で、「Sample page 1」の文字の上にカーソルを置くと、注釈レイヤーの計算済みの `cursor` が `text` になる。
  2. 同じページの文字の無い所では `default` になる。
  3. ハイライトの道具でも同じになる。
  4. 「選択」の道具に戻すと、今までどおりのカーソルに戻る。

## 禁止事項

- 対象外のファイルを変更しないこと。git の変更操作をしないこと。
- マウスの動きごとに React の state を更新しないこと。
- 自分で起動したサーバーは必ず止め、一時ファイルは削除すること。

## 検証項目

- [ ] `npm run build`、`npm test`、`npm run e2e`（全件）がすべて成功する。

## 報告してほしいこと

- 作成、変更したファイルと要点
- 文字の多いページ（`test-data/real/公共建築工事標準仕様書_建築_R7.pdf` がある場合）での、行の数と、`pageTextLines` の応答時間（1回だけ測る）
- 逸脱と残課題
