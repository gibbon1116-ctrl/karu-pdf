# SPEC-U6: 記号・盤名称・名称の欄に選択肢があっても、選んだ値を項目の記号（略号）にする

## 実行モデル指定（必須）

- モデル: `gpt-6-luna`
- reasoning effort: `max`
- 選定理由: `catalogPresets` の1条件の変更と、既存の試験をなぞった試験の追加だけで、判断を伴わないため luna-max。

---

## 背景

利用者の依頼（2026-10-14）: 摘要の欄は自由記載だけでなく、一般的な仕様の選択肢を出す。Claude が標準単価積算基準の表から選択肢を足した。

- `src/core/breakdown/electricalStandardChoices.ts`
- `src/core/breakdown/mechanicalStandardChoices.ts`
- `src/core/breakdown/buildingStandardChoices.ts`

例: ＬＥＤ照明器具の「記号」に LSS1-2 等の型番、分電盤の「盤名称」、開閉器箱の「名称」。

`src/core/catalog.ts` の `catalogPresets` は、区分 `記号・盤名称・名称・建具番号`（`splitLabels`）のうち**選択肢の無い**区分だけを「分ける区分」（`splitIndex`）にしている。

- 分ける区分の値は、項目の `code`（図面の印の略号）になる（16字まで）。
- 選択肢を足したので、ＬＥＤ照明器具の記号に「L1、L2」と入れても `code` が空になってしまう。

## 変更内容（`src/core/catalog.ts` の `catalogPresets`）

- `splitIndex` の条件から「選択肢が無い」を外す（`!slot.condition && splitLabels.has(slot.label)` の最初の区分）。
- 分ける区分に選択肢があるとき、値は今の選択肢のある区分と同じく `selection.values[slot.label]` から取る。
  - チェックした選択肢と「ほかの値」の両方。
  - それぞれの値が `splitValue` になる。
- 選択肢の無いときの動き（`selection.text` を「、」で分ける）は今のまま。
- `code` の決め方（`option.code` が優先、無ければ16字以下の splitValue）は今のまま。

## 試験（`tests/catalog.absorption.test.ts` か `tests/catalog.test.ts` に追加）

- ＬＥＤ照明器具（個）の品目の `item` 規格（記号の無い規格）で、記号の選択肢 `LSS1-2` を選ぶ（`values: { 記号: ['LSS1-2'] }`）。
  - 項目は1件、`code` が `LSS1-2`、摘要の記号が `LSS1-2`。
- 同じ品目で `values: { 記号: ['L1', 'L2'] }`（ほかの値）→ 2件、`code` が `L1`・`L2`。
- DL の規格（記号 DL が規格から入る）は今どおり `code` が `DL`。
- 選択肢の無い記号の区分（例 機械設備の「パッケージ形空気調和機」の記号、`text: { 記号: 'PAC-1、PAC-2' }`）は今どおり2件、`code` が `PAC-1`・`PAC-2`。

## 禁止事項

- データファイルを変えない。保存形式を変えない。
- 外部通信・`https://` を含む文字列を足さない。git 操作をしない。
