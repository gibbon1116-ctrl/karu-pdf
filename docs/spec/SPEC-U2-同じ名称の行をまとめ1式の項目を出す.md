# SPEC-U2: 同じ名称の行の品目を1つにまとめ、品目の無い1式の行を「1式の項目」にする（電気設備・機械設備）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 一覧の鍵のまとめ方と、内訳書タブの引き当て・規格タブの位置の選び方にまたがる変更のため既定の sol-high。

---

## 背景

利用者の決定（2026-10-14、非公開の調査資料 §7）:

- **§7-3:** 名前が同じで内訳書の位置だけ違う品目は、規格タブでは1つにまとめ、追加するときに内訳書の位置を選ぶ。
  - 例: 開閉器箱が電灯・動力・電熱・構内配電の4科目にある。
  - 内訳書タブでは今どおり行ごとに出る。
- **§7-4:** 品目が0件の「1式」の行（据付費・試験調整費・諸経費 等。電気 73行・機械 19行）は、両方のタブに「1式の項目」として出す。

U1（既存の標準マスタの吸収）の後の `src/core/catalog.ts` に対して変更する。

Claude がデータを作成済み: `src/core/breakdown/mergedRows.ts`

- `LUMP_SUM_CATEGORY = '1式（経費・工事）'`
- `MERGED_ROW_CATEGORY[編][名称]`: まとめた品目の分類。

## 変更内容（`src/core/catalog.ts`）

### 1. 1式の項目

電気設備・機械設備の行で、`entry.row.separate` が真かつ、その行の明細から品目が1つもできないとき（今の `catalogItemsForBreakdownRow(entry)` が空）は、行の品目を作る。

作り方は、今の「1式・別紙明細でない行」と同じ:

- `options: [{ key: 'item', label: '', code: '', name: row.name, kind: 'count', method: 'click' }]`
- `unit: row.unit`（式）
- `category`: `rowCategory(entry)`
- `slots`: 行の summary
- `breakdownItem: row.name`
- 鍵は `rowKey(entry, …)` と同じ規則。

- **内訳書タブ:** `catalogItemsForBreakdownRow(entry)` は、その行に対してこの品目を返す。
  - `BreakdownPicker.tsx` が別紙明細の行で品目を出さない作りなら、出すように直す。
- **項目の数量:** 1式の項目は印の数で数える（今の機械設備の「諸経費」（式）の行の品目と同じ）。
- **建築:** 対象外（調査が済んでいない）。

### 2. 同じ名称の行の品目をまとめる

電気設備・機械設備で、`key` が `row:` の品目のうち、次がすべて同じものを1つにまとめる。

- 編
- 名称
- 単位
- 摘要の区分名の並び（`slots` の label の並び）

1式の項目も対象（据付費 19行 → 1品目 等）。

- **鍵:** 最初（`breakdownEntries()` の順）の品目の鍵を残し、ほかの鍵の品目は一覧から除く。
  - 除いた鍵 → 残した鍵の対応を持ち、`catalogItemsForBreakdownRow`・`representativeBreakdownPosition` で引き当てに使う（`#` の付いた重ね合わせの鍵の作り方も同じ鍵を使う）。
- **分類:** `MERGED_ROW_CATEGORY[編][名称]` があればそれ、無ければ残した品目の分類。
- **規格（options）:** 残した品目のもの。まとめる品目どうしの規格は同じはず（同じ名称から作るため）。違えば鍵の和で足す。
- **内訳書タブ:** 今どおり行ごとに出る（どの行でもまとめた品目が返る）。
  - `catalogPresets(item, selection, position)` の position はその行。

新しい関数（`src/core/catalog.ts`）:

```ts
/** 品目が出る内訳書の行の位置の一覧（breakdownEntries() の順、庁舎を先）。重ね合わせの鍵は元の鍵で比べる。 */
export function catalogItemPositions(item: CatalogItem): BreakdownPosition[]
```

- 結果は鍵ごとに覚えておく（初回だけ計算）。
- 1件だけの品目、位置の無い品目では、1件または空。

### 3. 規格タブの位置の選び方（`FixturePresetDialog.tsx`・`CatalogChooser.tsx`）

- `catalogItemPositions(item)` が2件以上の品目には、規格を選んだとき（今の「内訳書: …」のボタンの下）に select を出す。
  - `aria-label="{品目名}の内訳書の行"`
  - 選択肢の表示は `[種目（庁舎以外のとき）, 科目, 中科目, 細目].join(' › ')`
  - 選ぶと、その品目の位置（`itemPositions[item.key]`）にする。
  - 既定は今どおり（代表の位置。前に選んだ位置があればそれ）。
- 今の位置の欄（編・種目・科目・中科目）での選び方はそのまま使える。

## 試験

- **単体 `tests/catalog.mergedRows.test.ts`:**
  - 電気設備の「開閉器箱」の品目が一覧に1つ。分類は「盤類」。
    - `catalogItemPositions` が電灯設備・動力設備・電熱設備・構内配電線路の4件。
    - 動力設備の開閉器箱の行の `catalogItemsForBreakdownRow` がその品目を返す。
    - `catalogPresets` に動力設備の位置を渡すと、項目の内訳書の科目が動力設備。
  - 「据付費」（式）の品目が1つ。分類は `LUMP_SUM_CATEGORY`、位置は19件。電気設備の発電設備 自家発電（原動機）の据付費の行で返る。
  - 機械設備の「架台類」（式）・「総合調整費」（式）が1つずつ。
  - 機械設備の「諸経費」（式。別紙明細でない行）が1つ。位置は5件。
  - 電気設備・機械設備で、品目0件の行が無い。
  - 名称・単位が同じで摘要の区分が違う行（例 機械設備の「流し」組と台）はまとめない。
  - 規格タブの品目の鍵の集合と、全行の `catalogItemsForBreakdownRow` の鍵の集合が同じ（U1 の試験の「0件の行は無視」を外す）。
- **既存の試験:** 鍵・分類・件数が変わる所（電気設備の `row:` の鍵の数、`breakdownMaster` の件数 等）を直す。直した試験の一覧を報告に書く。
- **e2e `e2e/catalog-merged-rows.annotate.spec.ts`**（`breakdown-master.annotate.spec.ts` の作りにならう）:
  - 規格から選ぶで「開閉器箱」を検索 → 品目は1つ → 規格を選ぶ → 「開閉器箱の内訳書の行」で動力設備の行を選ぶ → 追加。
    - 項目の内訳書の位置が動力設備。
  - 内訳書から選ぶで、電気設備 › 庁舎 › 発電設備 › 自家発電（原動機） › 据付費 に品目「据付費（式）」が出る。

## 受入条件・停止条件

- 建築・昇降機の品目と試験の結果は今と同じ。
- 保存形式は変えない。既に PDF にある項目は変えない。
- 戻し方: この段階のコミットの revert。

## 禁止事項

- `mergedRows.ts`・`*Groups.ts`・`*Details.ts`・`masterAbsorption.ts` のデータを変えない。
- 外部通信・`https://` を含む文字列を足さない。git 操作をしない。
