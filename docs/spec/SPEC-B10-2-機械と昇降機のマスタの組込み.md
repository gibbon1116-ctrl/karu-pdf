# SPEC-B10-2: 機械設備・昇降機設備のマスタを内訳書の一覧と品目一覧に組み込む

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 内訳書のマスタ（編ごとの群・明細・選択肢）と品目一覧（分類・施工条件の区分）の拡張、既存の電気の結果を変えない整合、データの整合の試験にまたがる

---

## 背景

利用者の指示で、電気 → 連動 → 機械 → 建築 の順に進めている。機械設備・昇降機設備の内訳書のデータは Claude が作成済み（**変えないこと**）:

- `src/core/breakdown/mechanicalGroups.ts`: `MECHANICAL_GROUPS`（35 群・397 行。書式の PDF から抽出）
- `src/core/breakdown/elevatorGroups.ts`: `ELEVATOR_GROUPS`（6 群）
- `src/core/breakdown/mechanicalDetails.ts`: `MECHANICAL_DETAILS`（別紙明細の標準の明細）、`MECHANICAL_CHOICES`（`${細目}|${区分}` → 選択肢）、`MECHANICAL_CONDITION_SLOTS`（施工条件として扱う `${細目}|${区分}`。配管の「区分」= 施工箇所）、`PIPE_LOCATIONS`
- `src/core/breakdown/catalogMap.ts` の `MECHANICAL_ROW_CATEGORY`（細目 → 分類）、`MECHANICAL_DETAIL_CATEGORY`（別紙明細 → 分類）

画面（「内訳書から選ぶ」の編のボタン、「規格から選ぶ」の位置の編の選択）は、マスタに編の行があれば使えるようにすでに作ってある（行が無い編は「準備中」）。

## 対象

- 変更: `src/core/breakdownMaster.ts`、`src/core/catalog.ts`
- 試験: `tests/breakdownMaster.test.ts`、`tests/catalog.test.ts`（足す）、`e2e/breakdown-master.annotate.spec.ts` に1件
- 変えない: データの各ファイル、画面のファイル（必要なら報告）、電気の結果

## 1. 内訳書のマスタ（`breakdownMaster.ts`）

- `breakdownEntries()` に、電気の後ろへ `MECHANICAL_GROUPS`（`book: '機械設備'`）、`ELEVATOR_GROUPS`（`book: '昇降機設備'`）を足す。鍵（`key`）の作り方は今と同じ（編を含む）。
- 別紙明細の明細（`details`）は編ごと: 電気は `ELECTRICAL_DETAILS`、機械は `MECHANICAL_DETAILS`、昇降機は無し（空）。
- `summaryChoices(rowName, label, book = '電気設備')`: 編ごとの選択肢（電気 `ELECTRICAL_CHOICES`、機械 `MECHANICAL_CHOICES`、昇降機 無し）。今の呼び出し元（電気）は引数を足さなくても同じ結果。
- 新しい `summaryIsCondition(rowName, label, book): boolean`（機械で `MECHANICAL_CONDITION_SLOTS` にあれば true）。
- 「内訳書から選ぶ」の摘要の選択（`presetFromRow` など）で、施工条件の区分は項目を分けず、その選択肢を項目の施工条件の候補（`conditions`）にする（電気の別紙明細の `condition: true` の区分と同じ扱い）。
- 検索の文字列（`search`）などは今のまま。

## 2. 品目一覧（`catalog.ts`）

- 数量で計上する細目の品目と別紙明細の明細の品目を、編ごとに作る（今は電気だけ）。`field` はその編（`'機械設備'`、`'昇降機設備'`）。
- 分類:
  - 電気: 今のまま（`rowCategory`）。
  - 機械の細目: `MECHANICAL_ROW_CATEGORY[細目] ?? 科目`。機械の別紙明細: `MECHANICAL_DETAIL_CATEGORY[別紙明細] ?? 別紙明細の名前`。
  - 昇降機: 科目。
- 細目の品目の区分（`slots`）: `summaryChoices(row, label, book)` の選択肢、`summaryIsCondition` なら `condition: true`（`catalogPresets` は今と同じく施工条件の区分を項目に分けず候補にする）。
- 品目の鍵（`rowKey` など）に編を入れ、電気と機械で同じ名前の細目（「温度計」「電気配管配線」など）が混ざらないようにする。電気の今の鍵は変えない（電気だけ今の形、機械・昇降機は編を足した形でよい）。
- 既存の標準マスタの機械の種類（SGP など）は今のまま（細目には対応付けない）。
- `conditionCandidatesFor` は今のまま（規則に当たらない機械の品目は、品目の候補だけ）。

## 3. 試験

- `tests/breakdownMaster.test.ts`: 機械の行数 397・群 35、昇降機の群 6。編ごとの鍵が一意。`給水管|管種` の選択肢に SGP-VB、`給水管|区分` が施工条件（`summaryIsCondition`）で `PIPE_LOCATIONS`。保温の別紙明細に「配管保温」（施工箇所が施工条件）。電気の結果（件数・最初の行・鍵）が変わらない。
- `tests/catalog.test.ts`: 機械の品目の分類（給水管 → 配管（給水・給湯）、長方形ダクト → ダクト、仕切弁 → 弁類、ポンプ類 → 科目）。給水管の品目から作る項目の施工条件の候補が `PIPE_LOCATIONS` で、区分で項目が分かれない。電気と機械で同じ名前の細目が別の品目。B03e の `CONDITION_RULES` の整合の試験が通ること（機械の品目が増えても）。
- e2e（`e2e/breakdown-master.annotate.spec.ts` に1件）: 「標準マスタから追加」→「内訳書から選ぶ」→ 編 `機械設備` → 庁舎 → 給水設備 → 給水管 の管種・呼び径を選んで追加 → 数量タブに分類「配管（給水・給湯）」の項目、編集画面の施工条件の候補に `屋内一般配管`。昇降機設備のボタンが押せる。

## 禁止事項

- データのファイルを変えないこと（綴りの不整合などは報告する）。
- 電気の品目・項目・鍵・結果を変えないこと。依存パッケージを足さないこと。指定外のファイルを変えないこと。

## 検証項目（Claude Code が実行する）

- [ ] 型検査、単体（全件）、`npm run build` の後 e2e（内訳書・標準マスタ・集計表）
- [ ] 内訳書のマスタの塊の大きさ（遅延読込の塊）を記録する
