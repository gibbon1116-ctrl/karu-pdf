# SPEC-B11-2: 建築のマスタを内訳書の一覧と品目一覧に組み込む

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 内訳書のマスタ・品目一覧の第4の編の追加（種目による別紙明細の切替を含む）、既存の電気・機械の結果を変えない整合、データの整合の試験にまたがる

---

## 背景

B10-2 で機械設備・昇降機設備を組み込んだのと同じ形で、建築を組み込む。データは Claude が作成済み（**変えないこと**）:

- `src/core/breakdown/buildingGroups.ts`: `BUILDING_GROUPS`（101 群・799 行。新営の種目 庁舎・囲障・構内舗装・屋外排水・植栽 と、改修の種目「庁舎（改修）」。書式の PDF から抽出）
- `src/core/breakdown/buildingDetails.ts`: `BUILDING_DETAILS`（新営の別紙明細）、`BUILDING_RENOVATION_DETAILS`（種目「庁舎（改修）」の別紙明細）、`BUILDING_CHOICES`（`${細目}|${区分}` → 選択肢）
- `src/core/breakdown/catalogMap.ts` の `BUILDING_SUBJECT_CATEGORY`（科目 → 分類）

## 対象

- 変更: `src/core/breakdownMaster.ts`、`src/core/catalog.ts`
- 試験: `tests/breakdownMaster.test.ts`、`tests/catalog.test.ts`（追記）、`e2e/breakdown-master.annotate.spec.ts` に1件（追記）
- 変えない: データの各ファイル、画面、電気・機械・昇降機の結果

## 1. 内訳書のマスタ（`breakdownMaster.ts`）

- `breakdownEntries()` の最後に `BUILDING_GROUPS`（`book: '建築'`）を足す。並びは 電気設備 → 機械設備 → 昇降機設備 → 建築。
- 別紙明細の明細: 建築は、群の種目が `'庁舎（改修）'` なら `BUILDING_RENOVATION_DETAILS`、それ以外は `BUILDING_DETAILS`。
- `summaryChoices(row, label, '建築')` は `BUILDING_CHOICES`。`summaryIsCondition` は建築では false。

## 2. 品目一覧（`catalog.ts`）

- 建築の細目の品目・別紙明細の明細の品目を作る（`field: '建築'`）。
- 分類: 中科目が `撤去` で始まる群の細目は `'撤去'`、それ以外は `BUILDING_SUBJECT_CATEGORY[科目] ?? 科目`。別紙明細の明細の分類は、その別紙明細の細目名（電気・機械と同じ扱い）。
- 鍵は機械と同じく編を入れた形。同じ名前の細目が新営と改修の両方にある（例: 墨出し・養生）とき、別紙明細の明細は種目で違うので、別紙明細の明細の鍵に種目の区別（新営／改修）を入れる。
- 既存の標準マスタ（quantityMaster）の建築の種類は今のまま（細目に対応付けない）。

## 3. 試験

- `tests/breakdownMaster.test.ts`: 建築の行数 799・群 101。種目に `庁舎（改修）` がある。新営の「養生」の別紙明細が `養生（延べ面積）`・`養生（部位）`、改修の「養生」が `養生`（区分「改修の種類」）。`異形鉄筋|規格` の選択肢に SD345。電気・機械・昇降機の件数・鍵が変わらない。
- `tests/catalog.test.ts`: 建築の品目の分類（異形鉄筋 → 鉄筋、防水改修の改修の行 → 防水、撤去の中科目の行 → 撤去、囲障の行 → 外構）。新営と改修の「養生」の別紙明細の明細が別の品目。`BUILDING_CHOICES` の鍵の細目名がすべて `BUILDING_GROUPS` にある（綴りの確認。無ければ試験を落として Claude に報告）。B03e の `CONDITION_RULES` の整合の試験が通ること。
- e2e: 「内訳書から選ぶ」→ 編 `建築` → 庁舎 → コンクリート → 躯体 → 普通コンクリート（軸部） の強度 24・スランプ 18 を選んで追加 → 項目の分類が `コンクリート`、種別が体積（`window.__karu.getCountFixtures()` で確かめる）。異形鉄筋（単位 t）は今は拾えない細目として出る（B07 で連動の項目にする）。

## 禁止事項

- データのファイルを変えないこと（綴りの不整合などは報告する）。
- 電気・機械・昇降機の品目・項目・鍵・結果を変えないこと。依存パッケージを足さないこと。指定外のファイルを変えないこと。

## 検証項目（Claude Code が実行する）

- [ ] 型検査、単体（全件）、`npm run build` の後 e2e（内訳書・標準マスタ・集計表）
- [ ] 内訳書のマスタの遅延読込の塊の大きさを記録する
