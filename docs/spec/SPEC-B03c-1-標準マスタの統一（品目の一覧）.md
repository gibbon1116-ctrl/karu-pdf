# SPEC-B03c-1: 標準マスタの統一 — 品目の一覧と項目の作り方（画面なし）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 既存の標準マスタと内訳書のマスタを1つの品目の一覧にまとめる設計（分類の統一、同一判定、組合せの展開、施工条件の扱い）

---

## 利用者の要望と決定（試用版 第1版、2026-10-11）

> 「内訳書から選ぶ」「規格から選ぶ」「分野の一式」それぞれで入力したものが、ばらばらの項目として入力される。分野の一式の項目は削除し、「規格から選ぶ」から入力する場合は、「内訳書から選ぶ」で入力できる項目をすべて列挙するようにしたい。…ドロップダウンで入力する場合と、チェックしたものをすべて追加する方式と2通りあるが、すべてチェックしたものを追加する方式に統一したい。

決定:
- 数量タブの分類は **材料の分類** で統一する（照明器具・盤類・ボックス類・電線管・ケーブル（低圧）・塗装 …）。内訳書の位置は項目の中に持つ。
- 「規格から選ぶ」でも画面の上で内訳書の位置を選べるようにする（B03c-2）。どちらのタブで足しても、同じ品目・同じ位置なら同じ項目（追加済み）になる。
- 摘要の値は、すべてチェックで選ぶ（選んだ値の組合せごとに項目を作る）。施工（隠ぺい・露出）・処理（撤去・取外し）は項目を分けず、**施工条件の候補**にする（既存の電線管などと同じ。拾うときに選ぶ）。

この段階では **品目の一覧と、選んだものから項目（FixturePreset）を作る関数** を作る。画面は B03c-2。

## データ（Claude が作成済み。変えないこと）

- `src/core/breakdown/types.ts`: `SummarySlot.condition`（施工条件として扱う区分）
- `src/core/breakdown/electricalDetails.ts`: 施工・処理の区分に `condition: true`
- `src/core/breakdown/catalogMap.ts`: 既存の標準マスタ → 内訳書の細目、分類の名前のそろえ方、照明の行、別紙明細の細目 → 分類

## 対象

- 新規: `src/core/catalog.ts`、`tests/catalog.test.ts`
- 変えない: `src/core/quantityMaster.ts`、`src/core/breakdownMaster.ts`、`src/core/breakdown/*`、`src/core/countFixtures.ts`、画面

## 変更内容 — `src/core/catalog.ts`

画面から遅延読込する（`quantityMaster`・`breakdownMaster` と同じ塊でよい）。

```ts
export interface CatalogOption {
  key: string            // 品目の中で一意
  label: string          // チェックボックスの文字（例: 'IV 1.6mm'、'E25塗装'）。品目に選択肢が無いときは ''
  note?: string          // 補足（換算の根拠など）
  code: string; spec?: string; name: string
  kind?: QuantityKind; method?: QuantityMethod; defaults?: QuantityDefaults
  conditions?: readonly string[]
  convert?: FixtureConvert
}
export interface CatalogItem {
  key: string            // 一意（下の規則）
  field: string          // 分野（既存の標準マスタの分野。内訳書の品目は '電気設備'）
  category: string       // 統一した分類（材料）
  type: string           // 種類（一覧の3列目に出す名前）
  name: string           // 品目の名称（表示用）
  unit: string           // 表示の単位（換算があれば換算後）
  breakdownItem?: string // 内訳書の細目名（位置の item の既定）
  options: readonly CatalogOption[]   // 1件以上
  slots: readonly SummarySlot[]       // 摘要の区分（施工条件の区分を含む）
  search: string         // normalizeMasterText で正規化した検索用の文字列
}
export interface CatalogSelection {
  options: readonly string[]                               // 選んだ CatalogOption.key
  values?: Readonly<Record<string, readonly string[]>>     // 選択肢のある区分 → 選んだ値（チェック＋ほかの値）
  text?: Readonly<Record<string, string>>                  // 選択肢の無い区分 → 入力した文字
}
export type CatalogPosition = Omit<BreakdownPosition, 'item'> & { item?: string }
export const MAX_CATALOG_COMBINATIONS = 100
export function catalogItems(): readonly CatalogItem[]                       // 初回に作って再利用
export function searchCatalog(query: string, limit?: number): { results: Array<{ item: CatalogItem; options: readonly CatalogOption[] }>; total: number }
export function catalogItemsForBreakdownRow(entry: BreakdownEntry): readonly CatalogItem[]
export function catalogPresets(item: CatalogItem, selection: CatalogSelection, position?: CatalogPosition): FixturePreset[]
```

### 品目の作り方（`catalogItems`）

並びは 1 → 2 → 3 の順、それぞれの中は元のデータの順。

1. **既存の標準マスタ**（`QUANTITY_MASTER` の各 `MasterType`）: 1種類 = 1品目。
   - `key` = `master:` ＋ `JSON.stringify([field, category, type])`。
   - `category` = `CATEGORY_ALIASES[category] ?? category`。`type` = `MasterType.type`、`name` = `MasterType.name`、`unit` = `QUANTITY_UNITS[kind]`。
   - `breakdownItem`（分野が電気設備のときだけ）= `MASTER_TYPE_ITEMS[type] ?? MASTER_CATEGORY_ITEMS[category]`（元の分類で引く）。
   - `options` = `masterEntries()` のうちその種類のもの（並びはそのまま）。`label` = `fixtureCode(entry)`、ほかの値は `MasterEntry` のまま（`conditions` も）。`slots` = `[]`。
2. **内訳書の数量で計上する細目**（`breakdownEntries()` のうち `pickable`）:
   - 分類: `LIGHTING_ROWS` に含まれる名前 → `'照明器具'`。名前が「盤」で終わるか、摘要の区分に「盤名称」がある → `'盤類'`。それ以外 → その行の科目（`entry.subject`）。
   - `key` = `row:` ＋ `JSON.stringify([分類, row.name])`。同じ鍵の行は最初の行だけを品目にする（例: 端子盤は 17 の群にあるが品目は1つ）。
   - `type` = `name` = `row.name`、`unit` = `row.unit`、`breakdownItem` = `row.name`。
   - `slots` = `row.summary` の各区分 → `{ label, choices: summaryChoices(row.name, label) }`（選択肢が空なら `choices` を持たない）。
   - `options` = 1件（`key` `'item'`、`label` ''、`code` ''、`name` = `row.name`、`kind`・`method` は `kindForUnit(row.unit)`）。
3. **内訳書の別紙明細の標準の明細**（`ELECTRICAL_DETAILS` の各細目の各明細。`master` のある明細を除く。`variants` も無く `kindForUnit(unit)` も無い明細（搬入費の t など）も除く）:
   - `key` = `detail:` ＋ `JSON.stringify([細目名, template.name])`。
   - `category` = `DETAIL_CATEGORY[細目名] ?? 細目名`。`type` = `name` = `template.name`、`unit` = `template.unit`、`breakdownItem` = 細目名、`slots` = `template.summary ?? []`。
   - `options`: `variants` があれば variant ごと（`key` = `variant.code`、`label` = `variant.code`、`note` = `variant.convert.basis`、`code`・`spec`・`convert` は variant、拾い方は `template.pick`）。無ければ1件（`key` `'item'`、`label` ''、`code` = `template.code ?? ''`、`kind`・`method` は `kindForUnit(template.unit)`）。

`search` は分野・分類・種類・名称・各 option の label・spec・各区分の名前と選択肢を連結して正規化。

### 内訳書の行 → 品目（`catalogItemsForBreakdownRow`）

- 数量で計上する細目 → 2 の品目（1件）。
- 別紙明細の細目 → その細目の明細ごとに: `master` の無い明細は 3 の品目。`master` のある明細は、`detailMasterEntries(template)` の種類に当たる 1 の品目すべて（`template.summary` があれば、その品目を複製して `slots` を `template.summary` にしたもの。`key` の末尾に `#` ＋ 細目名 ＋ 明細名）。
- 標準の明細の無い別紙明細・拾えない行 → `[]`。

### 項目を作る（`catalogPresets`）

1. 選んだ option（`selection.options` のうち `item.options` にあるもの）ごとに、2〜4 の組合せを作る。1つも無ければ `[]`。
2. **施工条件の区分**（`slot.condition`）: 項目を分けない。`choices` を施工条件の候補にする（option の `conditions` があれば、その後ろに重複なく足す）。
3. **選択肢のある区分**: `selection.values[label]` の値（前後の空白を取り、空と重複を除く）ごとに分ける。値が無ければその区分は摘要に入れない（分けない）。
4. **選択肢の無い区分**: `selection.text[label]` の文字。区分名が「記号」「盤名称」「名称」「建具番号」のうち最初の区分だけ `/[、,，]/` で区切って値ごとに分ける。ほかは1つの値。空なら入れない。
5. 組合せの数が `MAX_CATALOG_COMBINATIONS` を超えたら `Error('組合せが100件を超えます。選ぶ値を減らしてください。')`。
6. 項目の値:
   - `category` = `item.category`、`name` = `option.name`、`spec` = `option.spec`（あれば）、`kind`・`method`・`defaults`・`convert`（複製）は option から。
   - `code` = `option.code`。空で、4 の区切る区分の値が 16 字以内なら、その値。
   - `unit`: 個数で `convert` が無く、`item.unit` が `COUNT_UNITS` にあって「個」でなければ `item.unit`。
   - `aggregation`: 個数（換算なし）は `'location'`、それ以外は `'document'`。
   - `conditions`: 2 の候補（無ければ持たない）。既存の標準マスタの option の `conditions` はそのまま。
   - `summary`: 3・4 の値を区分の順に（施工条件の区分は入れない）。無ければ持たない。
   - `breakdown`: `position` があれば `{ book, section, subject, middle?, item: position.item ?? item.breakdownItem ?? item.name }`。無ければ持たない。
   - `fixtureBreakdownError`（と換算の検査）に当たれば、その文で `Error`。

### 検索（`searchCatalog`）

既存の `searchQuantityMaster` と同じ考え方: 空白で区切った語がすべて一致する品目。数字・φ・□ で始まる語（寸法の語）は、品目の文字ではなく **option の label・spec** に一致させ、`options` には一致した option だけを入れる。寸法の語が無ければ `options` は品目のすべて。並びは `catalogItems()` の順、`limit` の既定 200（品目の数）。

## 試験 `tests/catalog.test.ts`

1. `catalogItems()` に、`QUANTITY_MASTER` の種類と同じ数の 1 の品目、`pickable` の行の名前（分類ごとの重複を除く）の数の 2 の品目、3 の明細の品目がある。鍵が一意。
2. 既存の標準マスタの「コンセント」「スイッチ」の品目の分類が「配線器具」。電線管 E の品目の `breakdownItem` が「電線管」、MD が「金属ダクト」、DL が「ＬＥＤ照明器具」。
3. 「分電盤」の品目の分類が「盤類」、「ＬＥＤ照明器具」が「照明器具」、「熱感知器」が「火災報知設備」。
4. **同じ項目になる**: 規格から（1 の E の品目で E25、位置 `{電気設備, 庁舎, 電灯設備, 電灯幹線}`）と、内訳書から（電灯幹線の「電線管」の行 → `catalogItemsForBreakdownRow` の E の品目で E25、位置に `item: '電線管'`）の項目の `fixtureIdentity` と `category` が同じ。
5. 分電盤に `text: { 盤名称: 'L-1、L-2' }` → 2件、`code` L-1・L-2、`unit` 面、分類「盤類」。
6. アウトレットボックスで `values: { 寸法: ['中浅形', '中深形'] }` → 2件、`conditions` が `['隠ぺい', '露出']`、`summary` に寸法だけ。
7. 配管塗装の E25・E19 → 2件、`convert.unit` ㎡、`kind: 'length'`。
8. 組合せが 101 件になる選び方 → `Error`。
9. `searchCatalog('E25')` の結果に、E の品目（options は E25 だけ）と配管塗装（options は E25塗装 だけ）がある。`searchCatalog('分電盤')` に盤類の分電盤。

## 禁止事項

- データ・既存のマスタ・`countFixtures.ts` を変えないこと（足りない関数があれば報告）。
- 画面を変えないこと（B03c-2）。依存パッケージを足さないこと。

## 検証項目（Claude Code が実行する）

- [ ] 型検査、`tests/catalog.test.ts`、全件の単体
