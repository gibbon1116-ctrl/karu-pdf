# SPEC-R6f: 「同じ記号を探す」で選んだ候補を、画像の一覧で確認する

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 新しい窓・ページの部分描画（Worker）・図面の強調表示・選択状態の同期にまたがり、描画の負荷の判断を伴うため既定の sol-high。

---

## 背景（利用者の意見、2026-10-14）

> 「すべてを選ぶ」や「確度の高い候補を選ぶ」で記号を選択したとき、（同じ記号を探すの枠とは別に）選択したものの画像を確認する枠を作成したい。ここで選択を外したものは数量へ追加の候補からも自動で外れるようにしたい。それぞれの選択した記号をクリックしたとき、その画像が PDF 上のどれなのかが分かるよう、記号の位置を強調する表示を行いたい。

参考: 利用者が示した他ソフトの「抽出精度（閾値）確認」の窓（表示のチェック・イメージ・閾値の3列の一覧）。

今の作り:

- 候補は `store.symbolCandidates`。各候補は `id`・`pageIndex`・`rect`・`center`・`score`・`confidence`・`label`・`state`（`pending` / `chosen` / `counted`）を持つ。
- `SymbolSearchPanel` は `createPortal` で出す。
- 選択は `store.toggleSymbolCandidate(id)`・`chooseSymbolCandidates`・`chooseHighConfidenceCandidates`。
- 「選んだ n 件を数量へ追加」は `state === 'chosen'` の候補を数える。

## 変更内容

### 1. 窓「選んだ候補の確認」

- 新規 `src/app/SymbolCandidateReview.tsx`。`SymbolSearchPanel` から出す。
- 「同じ記号を探す」の枠とは**別の窓**にする。
  - 「同じ記号を探す」と同じ portal の先（`.document-workspace .viewer-slot`）に、`position: absolute; top: 8px; right: calc(260px + 16px)` で、同じ枠の左隣に置く。狭くて重なる場合は左寄りでよい。
  - 見出し「選んだ候補の確認」、「折り畳む」・閉じる（×）のボタン。
  - 高さは画面の 70% まで。中身はスクロールする。
  - 幅 約 300px。
  - `role="dialog"`・`aria-modal` なし・`aria-label="選んだ候補の確認"`。
- **開くとき**: 選んだ候補（`chosen`）が 0 件から 1 件以上になったとき自動で開く（「すべて選ぶ」「確度の高い候補を選ぶ」、図面で1つ選んだときも）。「同じ記号を探す」の枠に「選んだ候補を画像で確認」ボタンを足し、閉じた後も開き直せるようにする。
- **閉じるとき**: × で閉じる。検索を閉じる・候補が消えたとき（`symbolCandidates === null`）は閉じる。
- **一覧に出す候補**: 窓を開いてから一度でも `chosen` になった、図面に出ている候補（`visibleSymbolCandidates`）。
  - 外した候補も一覧に残し、チェックを外れた状態で出す（もう一度選べる）。
  - `counted`（拾い済み）は出さない。
  - 並びはページ順、ページの中は上から下・左から右（`rect` の y、x）。
- **各行**（`role="row"` の格子でも、`<ul>` でもよい）:
  - チェック（`aria-label="p.{ページ} の候補 {番号} を選ぶ"`）。チェックは `state === 'chosen'`。変えると `store.toggleSymbolCandidate(id)`。**チェックを外すと「数量へ追加」の候補から外れる**（今の状態の仕組みのまま）。
  - 画像（下の 2.）。
  - p.{ページ}・似ている度合い（`score` を小数2桁）・添字（`label`、無ければ「添字なし」）・確度が `check` なら「要確認」。
- 上部:
  - 「選択 {chosen 件} / 一覧 {件}」
  - 「一覧をすべて選ぶ」「一覧をすべて外す」（一覧の候補だけ対象）
- 行をクリック（画像・文字の所。チェックは除く）すると 3. の強調をする。

### 2. 画像（サムネイル）

- 候補の `rect` を上下左右に 35% 広げた範囲（ページの外は切る）を描く。添字や周りの線も見えるようにするため。
- 長い辺 96px 程度。白地。
- `PdfWorkerPool` に `renderRegionImage(docId, pageIndex, rect, maxPx)` を足す。
  - 戻り値は `ImageBitmap` を描いた `HTMLCanvasElement` か data URL。
  - 作りは今の `renderFixtureSample` の `render({ contentsOnly: true, deviceRect, renderScale })` と同じ。優先度は低く（表示中のページの描画を妨げない）。
- **窓を開いているときだけ**描く。
  - 一度に2件まで順に描く。
  - 画面に見えている行を先に描く（`IntersectionObserver` があれば使う。無ければ上から順）。
  - 描いた画像は候補の `id` で覚え、同じ検索の間は描き直さない。
  - 窓を閉じる・検索をやり直すと、待っている描画を取り消す（`render` の `cancel`）。
- 描けないときは「画像なし」と出し、ほかの行は続ける。

### 3. 図面での強調

- ストアに表示だけの状態 `focusedSymbolCandidateId: string | null` と `setFocusedSymbolCandidate(id | null)` を足す（`notifyUi`。保存・履歴・数量に入れない）。
- 行をクリックすると:
  - その候補のページの、その位置へ図面を動かす（App の `QuantityNavigationContext.navigate(page, rect)` と同じ動き。`SymbolSearchPanel` に `onLocate(pageIndex, rect)` を足して App から渡す）。
  - `setFocusedSymbolCandidate(id)` する。
- `AnnotationLayer` の候補（`symbol-search-candidate`）で、強調中の候補に `focused` の class と `data-focused="true"` を付ける。
  - 見た目: 太い橙の枠（今の選択より目立つ）と、外側に少し大きい枠を 1.5 秒ほど点滅（`@keyframes`）。
  - 強調は次のクリック・窓を閉じる・検索をやり直すまで残す。
- 一覧の行も、強調中の候補の行を背景色で示す。図面で候補をクリックして選んだときは、その候補の行を強調して見える位置へスクロールする（`focusedSymbolCandidateId` を図面のクリックでも設定する）。

## 対象

- 新規 `src/app/SymbolCandidateReview.tsx`
- `src/app/SymbolSearchPanel.tsx`（窓を出す・開き直すボタン・`onLocate`）
- `src/App.tsx`（`onLocate`）
- `src/client/PdfWorkerPool.ts`（`renderRegionImage`）
- `src/editor/AnnotationStore.ts`（`focusedSymbolCandidateId`）
- `src/editor/AnnotationLayer.tsx`（強調の class）
- `src/styles.css`

## 試験

- 単体（ストア）: `setFocusedSymbolCandidate` は保存・履歴に入らない。`clearSymbolCandidates` で消える。
- e2e（`e2e/symbol-candidate-review.annotate.spec.ts`。既存の記号の検索の e2e（`symbol-search*.annotate.spec.ts`）の作りにならう）:
  - 記号を検索して「すべて選ぶ」→ 窓「選んだ候補の確認」が開き、行が候補の数だけあり、画像が出る（`img` か `canvas` が1つ以上）。
  - 行のチェックを1つ外すと「選んだ n 件を数量へ追加」の n が1減り、図面のその候補が `data-state="pending"`。
  - 行をクリックするとその候補が `data-focused="true"`。
  - × で閉じ、「選んだ候補を画像で確認」で開き直せる。

## 受入条件・停止条件

- 窓を開かない限り、検索の速さ・図面の描画は今と同じ。サムネイルの描画で表示中のページの描画が遅れない。
- 記号の検索の e2e と単体試験全件が合格。
- 戻し方: この段階のコミットの revert。

## 禁止事項

- 候補の検索・選択の規則、数量への追加の動きを変えない（外したものが追加されない以外）。
- 外部通信を足さない。`https://` を含む文字列を足さない。git 操作をしない。
