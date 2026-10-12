# SPEC-B02: 電気の内訳書マスタ（読み込み・検索・項目への変換）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 新しいモジュールの設計（既存の標準マスタとの連携、項目の検証規則との整合、遅延読込の境界）と、データの整合を確かめる試験の設計が要る

---

## 背景

計画 `docs/調査/内訳書標準書式対応_計画.md` の段階 B02。公共建築工事内訳書標準書式（設備工事編）の電気設備の細目別内訳を、Claude がデータにした。

- `src/core/breakdown/types.ts` — データの型（作成済み。変えない）
- `src/core/breakdown/electricalGroups.ts` — 種目・科目・中科目ごとの細目の並び（43 群、974 行。作成済み。変えない）
- `src/core/breakdown/electricalDetails.ts` — 別紙明細の標準の明細 `ELECTRICAL_DETAILS` と、摘要の標準の選択肢 `ELECTRICAL_CHOICES`（作成済み。変えない）

この段階では、これらを **読み込み・一覧・検索し、選んだ行を数量拾いの項目（`FixturePreset`）に変換する関数** を作る。画面（標準マスタの「内訳書から選ぶ」タブ）は次の段階 B03 で作るので、この段階では画面を変えない。

## 対象

- 対象フォルダ: リポジトリのルート
- 新規: `src/core/breakdownMaster.ts`、`tests/breakdownMaster.test.ts`
- 変更しない: `src/core/breakdown/*.ts`（データ）、`src/core/quantityMaster.ts`、`src/core/countFixtures.ts`、画面のファイル

## 変更内容

### 1. `src/core/breakdownMaster.ts`（新規）

このモジュールは画面から `import('../core/breakdownMaster')` で**遅延読込**する（B03）。起動時に読み込まれるファイルから静的に import しないこと（試験で確かめる必要はない。B03 の e2e で確かめる）。

データは `./breakdown/electricalGroups`・`./breakdown/electricalDetails` を静的に import する。既存の標準マスタは `./quantityMaster` から `masterEntries`・`QUANTITY_MASTER`・`normalizeMasterText`・`type MasterEntry` を import してよい（`quantityMaster` は同じく遅延読込の塊なので問題ない）。

次を export する。名前はこのとおりにする。

```ts
import type { BreakdownBook, FixturePreset, QuantityKind, QuantityMethod, SummaryField } from './countFixtures'
import type { BreakdownRowData, DetailTemplate } from './breakdown/types'

/** 一覧の1行（細目）。 */
export interface BreakdownEntry {
  /** 一意の鍵。JSON.stringify([book, section, subject, middle ?? '', 行の通し番号（群の中の index）]) */
  key: string
  book: BreakdownBook
  section: string
  subject: string
  middle?: string
  row: BreakdownRowData
  /** 別紙明細の標準の明細。separate でないとき、または標準が無いときは [] */
  details: readonly DetailTemplate[]
  /** この細目自体を拾いの項目にできるか（kindForUnit(row.unit) が値を返し、separate でない） */
  pickable: boolean
  /** 検索用の正規化文字列（normalizeMasterText で book・section・subject・middle・row.name・summary・details の name を連結） */
  search: string
}

/** 単位から拾いの種類。拾えない単位（式・t・kg・台日など）は undefined */
export function kindForUnit(unit: string): { kind: QuantityKind; method: QuantityMethod } | undefined

/** 全行。book を渡すとその編だけ（今は '電気設備' だけデータがある）。結果は初回に作って再利用する */
export function breakdownEntries(book?: BreakdownBook): readonly BreakdownEntry[]

/** 検索。既存の searchQuantityMaster と同じく、空白で区切った語がすべて search に含まれる行。limit 件まで、total は全件数 */
export function searchBreakdown(query: string, limit?: number): { entries: BreakdownEntry[]; total: number }

/** 摘要の標準の選択肢。細目（数量で計上する行）は ELECTRICAL_CHOICES の「細目名|区分名」。無ければ [] */
export function summaryChoices(rowName: string, label: string): readonly string[]

/** 数量で計上する細目を項目にする。values は摘要の値（区分名と値。値が空の区分は捨てる） */
export function presetFromRow(entry: BreakdownEntry, values?: readonly SummaryField[]): FixturePreset

/** 別紙明細の明細を項目にする。master のある明細は、選んだ標準マスタの規格（masterChoices）ごとに1つずつ作る */
export function presetsFromDetail(entry: BreakdownEntry, template: DetailTemplate, values?: readonly SummaryField[], masterChoices?: readonly MasterEntry[]): FixturePreset[]

/** master のある明細で選べる標準マスタの規格。categories は MasterEntry.category、types は MasterEntry.type で一致させ、QUANTITY_MASTER の並び順で返す */
export function detailMasterEntries(template: DetailTemplate): readonly MasterEntry[]
```

#### 規則

- **kindForUnit**: `COUNT_UNITS`（`countFixtures.ts`）に含まれる単位 → `{ kind: 'count', method: 'click' }`。`'m'` → `{ kind: 'length', method: 'polyline' }`。`'㎡'` → `{ kind: 'area', method: 'polygon' }`。`'㎥'` → `{ kind: 'volume', method: 'polygonDepth' }`。それ以外は `undefined`。
- **pickable**: `!row.separate && kindForUnit(row.unit) !== undefined`。
- **details**: `row.separate` のときだけ `ELECTRICAL_DETAILS[row.name] ?? []`。
- **breakdown の位置**（項目に入れる値）: `{ book, section, subject, ...(middle ? { middle } : {}), item: row.name }`。
- **presetFromRow**（`entry.pickable` でなければ `Error('この細目は拾いの項目にできません。')`）:
  - `category`: `entry.middle ?? entry.subject`
  - `code`: `''`
  - `name`: `row.name`
  - `kind`・`method`: `kindForUnit(row.unit)`。個数のときは `kind: 'count'` を持たせず（`undefined`）、`method` も持たせない（既存の個数の項目と同じ形）
  - `unit`: 個数で `row.unit !== '個'` のときだけ `row.unit`
  - `breakdown`: 上の規則
  - `summary`: values のうち値が空でないもの（前後の空白を取る）。無ければ持たない
  - `aggregation`: 個数は `'location'`、それ以外は `'document'`
- **presetsFromDetail**（`template` が `entry.details` に含まれなければ `Error`）:
  - `template.master` があるとき: `masterChoices` の各 `MasterEntry` から1つずつ。`category`・`code`・`spec`・`name`・`kind`・`method`・`defaults`・`aggregation`・`conditions` は `MasterEntry` のまま。`breakdown` は上の規則（`item` は細目名 `row.name`）。`summary` は values のうち値のあるもの（無ければ持たない）。`masterChoices` が空なら `[]`。`masterChoices` に `detailMasterEntries(template)` に無いものが入っていたら `Error`。
  - `template.master` が無いとき: 1つだけ作る。`category`: `entry.middle ?? entry.subject`、`code`: `template.code ?? ''`、`name`: `template.name`、`kind`・`method`・`unit`・`aggregation` は presetFromRow と同じ規則で `template.unit` から。`kindForUnit(template.unit)` が `undefined`（t など）なら `Error('この明細は連動で計算する予定のため、まだ拾いの項目にできません。')`。
- 作った項目はすべて `fixtureBreakdownError` が `undefined` になること（摘要の文字数などの上限を超える入力は `Error` にしてよい。文は `fixtureBreakdownError` の文をそのまま使う）。
- **searchBreakdown**: `normalizeMasterText` で正規化。空の問い合わせは `{ entries: [], total: 0 }`。既定の `limit` は 200。並びは `breakdownEntries()` の順。

### 2. 試験 `tests/breakdownMaster.test.ts`（新規、vitest）

データの整合と関数を確かめる。

1. `breakdownEntries('電気設備')` が 974 行。すべて `book === '電気設備'`。`key` が一意。
2. `ELECTRICAL_DETAILS` の鍵はすべて、どこかの行の `row.name`（`separate` の行）と一致する（使われない鍵が無い）。
3. `ELECTRICAL_CHOICES` の鍵「細目名|区分名」はすべて、`separate` でない行のどれかの `row.name` と `row.summary` に一致する。
4. `ELECTRICAL_DETAILS` の各明細: `code` は 16 字以内、`name` は 80 字以内。`master` のある明細は `detailMasterEntries` が1件以上（参照する分類・種類が `QUANTITY_MASTER` に実在する）。`master` の無い明細は `kindForUnit(unit)` が値を返すか、`linked` を持つ。
5. `separate` の行のうち `details` が空のものの名前の一覧を、期待値（下記）と `toEqual` で比べる（1式で数量の無い細目。データの変更に気付くため）。
   - 期待値（重複を除き JavaScript の `sort()` の順。Claude がデータから確かめ済み）: `チェーンブロック`、`据付費`、`排気ダクト工事`、`排気配管工事`、`換気ダクト工事`、`機器間ケーブル工事`、`機器間ｹｰﾌﾞﾙ工事`、`燃料配管工事`、`立会検査`、`給気ダクト工事`、`試験調整費`、`諸経費`、`運搬費`
6. `kindForUnit` の対応（個・台・か所 → count、m、㎡、㎥、式・t・台日 → undefined）。
7. `presetFromRow`: 「庁舎/電灯設備/電灯分岐/分電盤（面）」に `[{ label: '盤名称', value: 'L-1' }]` → `unit: '面'`、`breakdown`・`summary` が正しく、`fixtureBreakdownError` が無い。`separate` の行では `Error`。
8. `presetsFromDetail`: 「電灯幹線/電線管」に `detailMasterEntries` の先頭2件 → 2件、各 `breakdown.item === '電線管'`、`spec` が元のまま。`master` の無い「ボックス類/プルボックス」 → 1件、`kind` が個数、`summary` は値のあるものだけ。`linked` で単位 t の「搬入費/機器搬入」 → `Error`。
9. `searchBreakdown('電灯幹線 電線管')` が電灯幹線の電線管の行を含む。`searchBreakdown('感知器')` が煙感知器・熱感知器を含む。`searchBreakdown('')` は 0 件。
10. `summaryChoices('熱感知器', '形式')` が空でない。`summaryChoices('分電盤', '盤名称')` は `[]`。

## 禁止事項

- `src/core/breakdown/` のデータ・型を変えないこと（データの誤りに気付いたら報告する）。
- 既存のファイル（`quantityMaster.ts`・`countFixtures.ts`・画面）を変えないこと。
- 依存パッケージを足さないこと。
- 指示していない関数・設定を足さないこと。

## 検証項目（Claude Code が実行する）

- [ ] `npx tsc --noEmit`
- [ ] `npx vitest run tests/breakdownMaster.test.ts`
- [ ] 既存の単体試験が通る

## 報告してほしいこと

- 作った関数と規則の解釈で迷った所
- データの整合の試験で見つかった食い違い（データを直さずに報告）
- 残課題
