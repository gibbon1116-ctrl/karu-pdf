# SPEC-R1b: 関連の候補の表示の整理

## 実行モデル指定（必須）

- モデル: `gpt-6-luna`
- reasoning effort: `max`
- 選定理由: 表示の文言・並べ方と CSS だけの局所修正で、照合・保存の判断を伴わないため luna-max。

---

## 目的

R1 の「関連の候補」の区画が長すぎて、数量パネルの上部（`.fixture-panel-controls`、高さの上限 45%）を占め、項目の一覧が見えにくい。
候補の見出しに、分類の全品目名（ケーブル7種類など）を並べているため1件が何行にもなる。控えめで短い表示にする。

## 対象

- `src/app/RelatedSuggestions.tsx`
- `src/styles.css`（末尾に `related-` で始まるクラスを足すだけ）

## 変更内容

1. 区画の要素に `className="related-suggestions"`、各候補の `article` に `className="related-card"` を付ける。`data-testid`・`aria-label`・ボタンの名前（「追加する」「不要」「単価包含」「他工事」「後で確認」「構成要素で拾う」「確認した」「閉じる」「すべて見る」）・`data-*` 属性は変えない（e2e が使う）。
2. 候補の見出し（h4）は `suggestion.targetTexts`（ルールの関連提案品目の原文、重複を除いて「、」でつなぐ）にする。その下に1行で「標準マスタ：」＋提案先の品目名を最大3件と「ほか n件」（提案先が無い確認事項は出さない）。今の `suggestionTitle()` は使わない。
3. 1行目の小さな表示（拾い候補／確認事項・優先度・ルールID）はそのまま。
4. 質問（questions）は先頭の1件だけ常に出し、残りの質問・「精査の要点」・根拠・起点は `<details><summary>詳しく</summary>…</details>` の中に入れる。起点のボタン（`aria-label` は今のまま）も中へ。
5. 「工事区分が未設定」「登録済み（n項目）」「標準マスタの提案先を解決できませんでした」は見出しの横の小さな印（`span.related-flag`）にする。
6. 「関連の候補 n件」の `details` は、直前に登録した項目がある（`originIds.length > 0`）ときだけ既定で開く。選択中の項目だけのときは既定で閉じる（見出しの件数は出す）。利用者が開いた・閉じた状態は今の仕組み（`closed`）のまま。
7. 案件区分と品目作業の選択欄を1行（`div.related-settings`、折り返し可）にまとめる。
8. CSS（`src/styles.css` の末尾に追加。既存のクラスは変えない）:
   - `.related-suggestions { font-size: 12px; margin: 6px 0; }`
   - `.related-settings { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }` と、その中の `select { font-size: 12px; }`
   - 候補の一覧の入れ物（`details` の中の候補を並べる部分）に `.related-list { max-height: 220px; overflow-y: auto; }`（この div を足す）
   - `.related-card { border: 1px solid #ccc; border-radius: 4px; padding: 4px 6px; margin: 4px 0; background: #fff; }`、`.related-card h4 { margin: 0; font-size: 12px; }`、`.related-card p { margin: 2px 0; }`、`.related-card button { padding: 1px 4px; font-size: 11px; margin: 2px 2px 0 0; }`
   - `.related-flag { display: inline-block; margin-left: 4px; padding: 0 4px; border-radius: 3px; background: #fff3cd; font-size: 10px; }`
   - `.related-master { color: #555; font-size: 11px; }`（「標準マスタ：」の行）
   - 暗い配色の設定が既存の CSS にあれば、それに合わせる（無ければ足さない）。

## 禁止事項

- 照合・集約・判断の記録（`suggest.ts`、`relatedState.ts`、`relatedModel.ts`）を変えない。`FixturePanel.tsx` を変えない。
- e2e が使う `data-testid`・ラベル・ボタン名を変えない。
- 既存の CSS ルールを変えない（末尾への追加だけ）。
