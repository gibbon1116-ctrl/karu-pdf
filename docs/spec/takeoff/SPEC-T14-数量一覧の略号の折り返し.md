# SPEC-T14: 数量の一覧で、長い略号と「連動」の札が隣の行に重なる表示崩れを直す

## 実行モデル指定（必須）

- モデル: `gpt-6-luna` / reasoning effort: `max`
- 選定理由: 2ファイル（FixturePanel.tsx・styles.css）の局所的な表示修正で、判断を伴わないため。

## 不具合（利用者の報告 2026-10-18）

数量の一覧（左の `fixture-panel`）の「塗装」の分類で、略号「PB300×300×200塗装」「E19塗装」が3行に折り返し、上下の行に重なって読めない。
原因: `src/styles.css` の `.fixture-row-code:has(.fixture-link-badge) { white-space: normal; overflow-wrap: anywhere; }` が、連動の札のある行で略号を何行にも折り返す。行の高さは 28px 固定（`.fixture-row`）。

## 直し方

1. `src/app/FixturePanel.tsx` の `.fixture-row-code` の中の略号（`{f.code}`）を `<span className="fixture-row-code-text">` で包む（`title` は今までどおり `.fixture-row-code` に付いている全文）。
2. `src/styles.css`:
   - 1151行目の規則を置き換える: 札のある略号の欄は縦に2段（1段目 略号、2段目 札）。`display: flex; flex-direction: column; justify-content: center; white-space: nowrap; overflow: hidden; line-height: 1.1;`
   - `.fixture-row-code-text { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`（長い略号は1行で「…」）。
   - 札（`.fixture-row-code .fixture-link-badge`）は 2段目に1行で並べ、行の高さ 28px に収まる大きさ（font-size 9px、line-height 1.2、上下の余白 0、margin 0 2px 0 0）。札が欄の幅を超えるときは欄の中で切る（重ならない）。
   - 札の無い行の見た目は変えない。
3. 他の表示（集計表 `.quantity-table` の札など）は変えない。

## 試験

- e2e は不要（Claude が画面で確認する）。既存の単体試験に影響しないこと。
