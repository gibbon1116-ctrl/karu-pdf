# SPEC-R3: 関連候補の Excel 別シート・他工事の担当・集計表の件数

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 既存の Excel 出力と保存データに接続し、既存の出力を変えないことの判断を伴うため既定の sol-high。

---

## 目的

1. 集計表の Excel に、関連候補の判断と未判断の一覧を **別シート「関連候補の確認」** で出す。内訳書・集計表・チェックシートのシートは変えない。
2. 「他工事」と判断するときに担当（建築／電気設備／機械設備／別途工事／その他）を記録し、表示・Excel に出す。
3. 集計表の上部に「関連候補：未判断 n件」を出す（出力は止めない）。

関連の候補の機能を使っていない文書（判断0件・案件区分なし）では、**Excel の出力・集計表の表示を一切変えない**（別シートも件数も出さない。ルールも読まない）。

## 対象

- `src/core/related/reviews.ts`: `RelatedReviewDecision` に省略可能な `assignee?: '建築' | '電気設備' | '機械設備' | '別途工事' | 'その他'` を足す（parse は不正値を捨てる。serialize は保持）。`decision !== '他工事'` のときは保存しない。
- `src/app/RelatedSuggestions.tsx`: 「他工事」を押したとき、担当を選ぶ小さな選択（既定「その他」）を出し、決めたら記録。判断済みの表示・未判断一覧に担当を出す。担当の変更もできる。
- 新規 `src/app/relatedXlsx.ts`: 純粋関数 `relatedReviewSheet(rows: RelatedReviewRow[]): XlsxSheet`。`RelatedReviewRow` は `{ status: '未判断' | '後で確認' | '必要' | '不要' | '単価包含' | '他工事' | '構成要素で拾う' | '確認した'; origins: string（起点の項目の略号・名称、無ければ「起点なし」）; target: string（提案品目）; kind: '拾い候補' | '確認事項'; question: string; assignee: string; reason: string; ruleIds: string; refs: string（記号：資料名）; decidedAt: string }`。列はこの順。見出し行・列幅・先頭行の固定は既存のチェックシート（`quantityXlsx.ts` の `quantityChecks` のシート）と同じ書き方。並びは 未判断 → 後で確認 → 判断済み。表題「関連候補の確認」、2行目に「提案は拾い漏れの確認用で、別途計上の根拠ではありません」。
- `src/app/quantityXlsx.ts`: `QuantityWorkbookOptions` に省略可能な `relatedReviews?: RelatedReviewRow[]` を足し、あれば最後に `relatedReviewSheet` を足す。無ければ今と同じシートの配列。
- `src/app/QuantityTable.tsx`:
  - Excel 出力の処理で、ストアの判断データに判断が1件以上あるか案件区分があるときだけ、`loadRelated()` と R2 の文書全体の評価・一覧（`src/app/relatedReviewList.ts`）を使って `RelatedReviewRow[]` を作り、`relatedReviews` に渡す。それ以外は渡さない。
  - 同じ条件のとき、集計表の上部に「関連候補：未判断 n件」を出す（評価は描画後。評価中は件数を出さない）。

## 試験

- `tests/related.xlsx.test.ts`: `relatedReviewSheet` の列・並び・表題・注記。`quantityWorkbookSheets` に `relatedReviews` を渡さないときの結果が、渡す前（改修前）と完全に同じ（シートの配列を `toEqual`）。渡したときは最後に1枚増えるだけで、他のシートが同じ。
- `tests/related.reviews.test.ts` に追加: `assignee` の parse・serialize（他工事以外は捨てる、不正値は捨てる）。
- `e2e/related-export.annotate.spec.ts`: 判断（他工事・担当「機械設備」を含む）を付けた文書で集計表の Excel を出し（既存の e2e の Excel 出力の取り方にならう）、別シート「関連候補の確認」に行がある。判断の無い文書ではシートが増えない。

## 受入条件・停止条件

- 関係 e2e（quantity-table、quantity-breakdown、breakdown-master、quantity-checks）と単体試験全件が合格。既存シートの内容が改修前と一致。
- 停止・戻し方は R1・R2 と同じ（この段階のコミットの revert）。

## 禁止事項

- 数量・施工条件別集計・連動・別紙明細・丸めを変えない。確認事項を数量0の内訳行として出さない。関連の機能を使っていない文書の出力を変えない。外部通信・https:// を含む文字列を足さない。
