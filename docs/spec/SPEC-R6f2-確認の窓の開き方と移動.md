# SPEC-R6f2: 「選んだ候補の確認」の窓は一括選択のときだけ自動で開き、ドラッグで動かせる

## 実行モデル指定（必須）

- モデル: `gpt-6-luna`
- reasoning effort: `max`
- 選定理由: R6f の2ファイルの局所修正（開く条件の変更と、見出しのドラッグでの移動）で、判断は SPEC で決め切っているため luna-max。

---

## 背景

R6f の窓は「選んだ候補が 0 件から 1 件以上になったら自動で開く」作りで、図面で候補を1つクリックしただけでも開き、図面の上の候補を覆ってクリックできなくなる（既存の e2e `symbol-search`・`symbol-other-fixture` が失敗）。

利用者の依頼は「『すべてを選ぶ』や『確度の高い候補を選ぶ』で記号を選択したとき」に画像を確認する枠。

## 変更内容

1. `src/app/SymbolSearchPanel.tsx`:
   - `previousChosen` を使った「0 件から 1 件以上で開く」自動表示をやめる。
   - 「すべて選ぶ」「確度の高い候補を選ぶ」を押して1件以上が選ばれたときだけ `setReviewOpen(true)` する。
   - 図面で候補をクリックしたときは開かない（開いているときは今までどおり一覧が更新される）。
   - 「選んだ候補を画像で確認」ボタンは残す。
2. `src/app/SymbolCandidateReview.tsx`: 見出し（`header`）をドラッグすると窓が動く。
   - `pointerdown` で開始し、ボタンの上では始めない。`setPointerCapture` を使う。
   - 位置は `style.left` / `style.top`（px）で持ち、`right` の指定を外す。
   - 親（`.viewer-slot`）の中に収める。見出しが少なくとも 40px は親の中に残るように制限する。
   - 位置は窓を閉じても、同じ検索の間は覚える（コンポーネントの state でよい）。
   - 見出しに `title="ドラッグで動かせます"`、`cursor: move`。
3. `src/styles.css`: 見出しの `cursor: move`、ドラッグ中は `user-select: none`。

## 試験

- `e2e/symbol-candidate-review.annotate.spec.ts`:
  - 図面で候補を1つクリックしても窓は開かず、「すべて選ぶ」で開くことに直す（今の「図面での選択による自動表示」の試験の意図を変える）。
  - 見出しを 100px ドラッグすると窓の位置が動く。
- 既存の `e2e/symbol-search.annotate.spec.ts`・`e2e/symbol-other-fixture.annotate.spec.ts` は変えずに合格すること。

## 禁止事項

- 一覧・画像・強調の動きを変えない。外部通信を足さない。git 操作をしない。
