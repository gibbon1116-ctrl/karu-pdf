# SPEC-B10-3: 機械の連動（保温・塗装）と長方形ダクトの ㎡ 換算

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 連動の自動の元の条件の拡張、品目一覧での細目の規格（換算つき）の作成、データとの整合の試験にまたがる

---

## 背景

B10 で機械設備のマスタが入った。データは Claude が作成済み（**変えないこと**）:

- `src/core/breakdown/linkRules.ts`: 機械の規則（`pipe-insulation` 配管保温・`pipe-paint` 配管塗装・`duct-insulation` ダクト保温・`duct-paint` ダクト塗装）。`LinkAutoSources` に `outputKinds?`（元の項目の換算後の種類 `quantityOutputKind`）を足した。ダクトの規則は `outputKinds: ['area']`（㎡ のダクトだけ）。
- `src/core/breakdown/mechanicalDetails.ts` の `MECHANICAL_ROW_VARIANTS`: 細目の行（別紙明細でない）で、線で拾って換算する規格。長方形ダクト（書式の単位 ㎡）は、図面で中心線の長さを拾い、寸法（幅×高さ）の周長 `2×(幅＋高さ)/1000` を掛けて ㎡ にする（20 寸法）。
- `src/core/breakdown/conditionCandidates.ts`: 機械の分類（ダクト・制気口・機器の科目）の施工条件の候補。

## 対象

- 変更: `src/core/fixtureLink.ts`（`outputKinds` の検査と当て方）、`src/core/catalog.ts`（細目の行の換算つきの規格）
- 試験: `tests/fixtureLink.test.ts`・`tests/catalog.test.ts` に追記（末尾に足す EDIT で）
- 変えない: データの各ファイル、画面

## 1. 自動の元の `outputKinds`（`fixtureLink.ts`）

- `auto.outputKinds` があれば、元の項目の `quantityOutputKind(f)` がそのどれかであること（ほかの条件と AND）。検査: 値は `count`・`length`・`area`・`volume`・`mass` の中、5件まで。保存・読込の詰め直しにも入れる。

## 2. 細目の行の換算つきの規格（`catalog.ts`）

- 機械の細目の行の品目を作るとき、`MECHANICAL_ROW_VARIANTS[行の名前]` があれば、その品目の規格（options）を、別紙明細の `variants` と同じ形（今の `detailOptions` の variants の処理と同じ）にする: `key`・`label`・`code` は variant の `code`、`spec`、`name` は行の名前、`kind: 'length'`、`method: 'polyline'`、`convert` は variant の換算、`note` は `basis`。区分（摘要の `板厚等` など）はそのまま。
- 換算つきの規格を持たない行は今のまま。電気の品目は変えない。

## 3. 試験

- `fixtureLink.test.ts`: `outputKinds: ['area']` の自動の元が、長方形ダクト（長さで拾い ㎡ に換算する項目）だけを選び、スパイラルダクト（m）を選ばない。検査（範囲外の値）。
- `catalog.test.ts`: 機械の長方形ダクトの品目の規格が 20 件、`SD300×200` の換算が `1.0`（2×(300+200)/1000）で ㎡、`kind: 'length'`・`method: 'polyline'`。その規格で作る項目の単位が ㎡。機械の規則の自動の元（保温・塗装）のカテゴリが品目一覧にある（綴りの確認）。

## 禁止事項

- データのファイルを変えないこと。電気の品目・結果を変えないこと。依存パッケージを足さないこと。指定外のファイルを変えないこと。

## 検証項目（Claude Code が実行する）

- [ ] 型検査、単体（全件）、e2e（連動・内訳書）
