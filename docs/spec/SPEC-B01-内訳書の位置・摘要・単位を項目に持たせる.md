# SPEC-B01: 内訳書の位置・摘要・単位・属性を項目に持たせる

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 保存形式（PDF に保存する項目の JSON）の拡張と互換、項目の同一判定、単位表示の 7 か所、編集画面にまたがる。古い版との互換と検証の判断が要る

> Codex デスクトップアプリへ貼り付けて実行する場合は、モデルセレクタを上記に合わせてから貼り付けること。

---

## 背景

計画 `docs/調査/内訳書標準書式対応_計画.md` の段階 B01。数量拾いの「項目」（`CountFixture`）に、公共建築工事内訳書標準書式の **内訳書の位置**（編・種目・科目・中科目・細目）、**摘要**（区分ごとの値）、**単位**（個数の項目だけ。台・面・か所など）、**備考**、**連動に使う属性**（質量・寸法・外径・単位質量・発生材の種類）を持たせる。マスタのデータ（B02）・選ぶ画面（B03）・内訳書形式の出力（B04）・連動の計算（B05〜B07）は後の段階。この段階では **データの形、保存と読み込み、項目の編集画面、単位の表示、同じ項目の判定** だけを作る。

利用者の決定: 同じ規格（例: E25 露出）でも、内訳書の位置（中科目など）が違えば別の項目にする。

## 対象

- 対象フォルダ: リポジトリのルート
- 変更するファイル:
  - `src/core/countFixtures.ts` — 型、定数、検証、読み込み（`parseCountFixtures`）、保存（`serializeCountFixtures`）、単位と同一判定の関数
  - `src/core/quantityMaster.ts` — `fixtureFromPreset` が新しい欄を引き継ぐ
  - `src/app/FixtureDialog.tsx` — 編集画面に「内訳書」の欄
  - `src/app/FixturePanel.tsx` — 単位の表示、`addMany` の同一判定と欄の引き継ぎ
  - `src/app/FixturePresetDialog.tsx` — 同一判定、単位の表示
  - `src/app/PickupBar.tsx`、`src/app/QuantityBreakdown.tsx`、`src/app/QuantityTable.tsx`、`src/app/quantityXlsx.ts`、`src/app/annotationCsv.ts` — 単位の表示
  - `src/app/routeSets.ts`、`src/app/RouteItems.tsx` — よく使う構成に内訳書の位置を含める
  - `src/app/LinePicker.tsx` — 同一判定
  - `tests/fixtureBreakdown.test.ts`（新規）— 単体試験

## 変更内容

### 1. 型と定数（`countFixtures.ts`）

次を追加して export する。名前はこのとおりにする。

```ts
export const COUNT_UNITS = ['個', '台', '面', '基', '組', '本', '枚', '灯', 'か所', '対'] as const
export type CountUnit = typeof COUNT_UNITS[number]
export const BREAKDOWN_BOOKS = ['建築', '電気設備', '機械設備', '昇降機設備'] as const
export type BreakdownBook = typeof BREAKDOWN_BOOKS[number]
/** 内訳書の位置。section=種目、subject=科目、middle=中科目（省略可）、item=細目 */
export interface BreakdownPosition { book: BreakdownBook; section: string; subject: string; middle?: string; item: string }
/** 摘要の1区分。label=区分名（例: 形式、呼び径）、value=値 */
export interface SummaryField { label: string; value: string }
/** 連動の計算（B05〜B07）に使う値。どれも任意 */
export interface FixtureAttributes {
  massKg?: number          // 機器の単体質量 kg
  widthMm?: number         // 外形 幅 mm
  depthMm?: number         // 外形 奥行 mm
  heightMm?: number        // 外形 高さ mm
  outerDiameterMm?: number // 管・ポール等の外径 mm
  unitMassKg?: number      // 数量1単位（1m、1個など）あたりの質量 kg
  wasteType?: string       // 発生材の種類（例: 金属くず）
}
```

`CountFixture` と `FixturePreset` の両方に次の任意の欄を足す。

```ts
unit?: CountUnit
breakdown?: BreakdownPosition
summary?: SummaryField[]
remark?: string
attributes?: FixtureAttributes
```

### 2. 値の決まり（検証）

`export function fixtureBreakdownError(f: Pick<CountFixture, 'kind' | 'unit' | 'breakdown' | 'summary' | 'remark' | 'attributes'>): string | undefined` を作る。問題が無ければ `undefined`、あれば利用者向けの日本語の文を返す。

- `unit`: `COUNT_UNITS` のどれか。**個数の項目（`kind` が `undefined` または `'count'`）だけ**持てる。長さ・面積・体積は単位を持たない（m・㎡・㎥ に固定）。
  - 文: 「単位は個数の項目だけに、候補の中から設定できます。」
- `breakdown`: `book` は `BREAKDOWN_BOOKS` のどれか。`section` 1〜20 文字、`subject` 1〜30 文字、`middle` は無いか 1〜30 文字、`item` 1〜40 文字。どれも文字列で、前後に空白が無く、改行・タブを含まない。
  - 文: 「内訳書の位置は、編・種目・科目・細目を入れてください（中科目は省略できます）。種目は20字、科目・中科目は30字、細目は40字までです。」
- `summary`: 配列で 1〜8 件。各 `label` 1〜20 文字、`value` 1〜60 文字、どちらも前後の空白・改行・タブなし。`label` の重複は不可。`summaryText(f)` の長さが 120 文字以下。
  - 文: 「摘要は8区分まで、区分名は20字、値は60字、合わせて120字までです。同じ区分名は使えません。」
- `remark`: 1〜40 文字、改行・タブなし。
  - 文: 「備考は40字までです。」
- `attributes`: オブジェクト。数値の欄は有限の数で 0 より大きく、上限は `massKg`・`unitMassKg` 100000、`widthMm`・`depthMm`・`heightMm` 100000、`outerDiameterMm` 10000。`wasteType` は 1〜20 文字、改行・タブなし。上の 7 つ以外の鍵は不可。空のオブジェクトは「無い」と同じに扱う（保存しない）。
  - 文: 「連動に使う値（質量・寸法・外径・単位質量・発生材の種類）が正しくありません。」

### 3. 表示用の関数（`countFixtures.ts`）

```ts
/** 数量の単位。個数は項目の単位（無ければ「個」）、ほかは QUANTITY_UNITS */
export function quantityUnit(f: Pick<CountFixture, 'kind' | 'unit'>): string
/** 摘要の値を「、」でつないだ文（区分名は含めない）。無ければ '' */
export function summaryText(f: Pick<CountFixture, 'summary'>): string
/** 内訳書の位置の同一判定用の文字列。無ければ ''。JSON.stringify([book, section, subject, middle ?? '', item]) */
export function breakdownKey(f: Pick<CountFixture, 'breakdown'>): string
/** 同じ項目かの判定。JSON.stringify([code, spec ?? '', name, breakdownKey(f)]) */
export function fixtureIdentity(f: Pick<CountFixture, 'code' | 'spec' | 'name' | 'breakdown'>): string
```

`summaryText` の例: `[{label:'呼び径',value:'E25'},{label:'施工',value:'露出'}]` → `'E25、露出'`。

### 4. 読み込み（`parseCountFixtures`）

- 新しい 5 つの欄は、**値が正しければ取り込み、正しくなければその欄だけを捨てて項目は残す**（新しい版で上限が広がった PDF を開いても項目が消えないようにするため）。既存の欄の扱い（不正なら項目ごと読まない）は変えない。
- 欄ごとの判定は 2 の規則と同じ。単位は個数の項目でなければ捨てる。`attributes` は正しい鍵だけ残すのではなく、1 つでも不正なら `attributes` ごと捨てる。空になったら持たない。
- 取り込むときは複製する（`summary` は新しい配列と新しいオブジェクト、`breakdown`・`attributes` も新しいオブジェクト）。
- 戻り値のオブジェクトの欄の並びは、既存の並びの後ろ（`style` の前でよい）に足す。欄が無いときはキー自体を持たない（`undefined` の鍵を作らない）。

### 5. 保存（`serializeCountFixtures`）

- 最初の検証ループで `fixtureConditionsError` に加えて `fixtureBreakdownError` も確かめ、問題があればその文で `Error` を投げる。
- JSON には、値があるときだけ書く（`attributes` が空のオブジェクトなら書かない、`summary` が空配列なら書かない）。
- 既存の「`parseCountFixtures(raw).length !== fixtures.length` なら上限超え」の検査は残す。

### 6. マスタからの追加（`quantityMaster.ts` の `fixtureFromPreset`）

`unit`・`breakdown`・`summary`・`remark`・`attributes` があれば複製して引き継ぐ。無ければ鍵を作らない。`MasterEntry` の生成（`masterEntries`）は変えない。

### 7. 同一判定

次の場所の「略号・規格・名称が同じなら同じ項目」を `fixtureIdentity` に置き換える（内訳書の位置が違えば別の項目）。

- `FixturePresetDialog.tsx` の `identity`（追加済みの表示とチェック）。
- `FixturePanel.tsx` の `addMany` の重複判定（177 行付近）。あわせて、`style` を持たない（マスタからの）項目を作るとき、`category, code, spec, name, kind, method, defaults, aggregation` に加えて `unit, breakdown, summary, remark, attributes` も引き継ぐ（値があるときだけ）。
- `LinePicker.tsx` 55 行付近の「既にある線の項目を候補から外す」判定（マスタの候補は内訳書の位置を持たないので、位置の無い項目とだけ一致する）。
- `routeSets.ts`:
  - `RouteSetItem` に `breakdown?: BreakdownPosition` を足す。`validItem` で、あれば 2 の規則で検証する（`fixtureBreakdownError({ breakdown })` を使ってよい）。
  - `identity` に内訳書の位置を含める（`fixtureIdentity` と同じ式）。
  - `resolveRouteSet` で項目を探すとき・作るときも位置を使う（作るときは `breakdown` を複製して持たせる）。
  - `RouteItems.tsx` 146 行付近の `currentItems` で、項目に位置があれば `breakdown` を含める。
  - 位置の無い既存の構成（ブラウザーに保存済み）はそのまま読めること。

### 8. 単位の表示

次の `QUANTITY_UNITS[quantityKind(f)]`（またはそれに相当する式）を `quantityUnit(f)` に置き換える。表示の場所・形は変えない。

- `FixturePanel.tsx` 108 行付近の `unit`、422 行付近の行の単位（今は個数では表示しない。この条件は変えない）。
- `PickupBar.tsx` 36 行付近。
- `QuantityBreakdown.tsx` 74 行付近。
- `QuantityTable.tsx` 386 行付近の「単位」の列。
- `quantityXlsx.ts` 86 行付近の「単位」の列。
- `annotationCsv.ts` の明細（149 行付近）と集計（179 行付近）の単位の列。
- `FixturePresetDialog.tsx` の `kindLabel` と「（個数・個）」の表示: 個数のときは `（個数・${quantityUnit(f)}）` にする。

CSV・Excel の列の数・並び・見出しは変えない（内訳書の列を足すのは B04）。

### 9. 編集画面（`FixtureDialog.tsx`）

「メモ」の下に、**閉じた状態で始まる** `<details>`（要約 `<summary>内訳書</summary>`。中身に位置・摘要・単位・備考のどれかが入っていれば開いた状態で始める）を置き、次を入れる。

- **単位**（個数の項目のときだけ）: `<select aria-label="単位">`。`COUNT_UNITS` を並べ、未設定は「個」と同じに扱う（選択肢の先頭「個（既定）」の値は空文字。空を選んだら `unit` を持たない）。
- **内訳書の位置**: `<fieldset><legend>内訳書の位置</legend>` に
  - 編 `<select aria-label="編">`（先頭は「なし」= 位置を持たない、続けて `BREAKDOWN_BOOKS`）
  - 種目 `<input aria-label="種目" maxLength={20}>`（編を「なし」から選んだとき、空なら「庁舎」を入れる）
  - 科目 `<input aria-label="科目" maxLength={30}>`
  - 中科目 `<input aria-label="中科目" maxLength={30}>`（空なら持たない）
  - 細目 `<input aria-label="細目" maxLength={40}>`
  - 編が「なし」のときは 4 つの入力を無効にする（値は消さないが、保存時は位置を持たない）。
- **摘要**: `<fieldset><legend>摘要</legend>` に行の一覧。各行は 区分名 `<input aria-label={'摘要の区分名' + (i + 1)} maxLength={20}>`、値 `<input aria-label={'摘要の値' + (i + 1)} maxLength={60}>`、「削除」ボタン。下に「摘要の区分を追加」ボタン（8 件で無効）。一覧の下に、つないだ文のプレビュー（`summaryText` の結果。空なら「（なし）」）。
- **備考**: `<input aria-label="備考" maxLength={40}>`。

保存（`onSubmit`）のとき:

- 文字列は前後の空白を取る。摘要は区分名と値の両方が空の行を捨てる。片方だけ空の行があれば「摘要は区分名と値の両方を入れてください。」を `setError` で出して保存しない。
- 編が「なし」なら `breakdown` を持たない。中科目が空なら `middle` を持たない。
- 個数でない項目には `unit` を持たせない。種別を個数から変えたとき（`changeKind`）も `unit` を外す。
- 空の `summary`・空の `remark` は持たない。`attributes` はこの画面では編集しない（そのまま引き継ぐ）。
- そのあと既存どおり `serializeCountFixtures` で確かめる。`fixtureBreakdownError` の文がそのまま `setError` に出る。

文言・`aria-label` は上のとおりにする。ほかの欄・既存の文言・既存の並びは変えない。

### 10. 単体試験（`tests/fixtureBreakdown.test.ts`、新規）

vitest。次を確かめる。

1. 位置・摘要・単位・備考・属性を持つ項目を `serializeCountFixtures` → `parseCountFixtures` で往復すると同じ値になる（`toEqual`）。
2. 新しい欄を持たない項目の保存 JSON に、新しい鍵（`unit`・`breakdown`・`summary`・`remark`・`attributes`）が出ない。
3. 読み込み時、不正な新しい欄はその欄だけ捨てて、項目は残る（例: `unit: 'kg'`、`breakdown.subject` が 31 文字、`summary` が 9 件、`attributes.massKg: -1`、`attributes` に未知の鍵、長さの項目に `unit: '台'`）。
4. 保存時、`fixtureBreakdownError` に当たる値は `serializeCountFixtures` が `Error` を投げる（文の一部で確かめる）。
5. `quantityUnit`: 単位なしの個数 → 「個」、`unit: '台'` → 「台」、長さ → 「m」、面積 → `QUANTITY_UNITS.area`。
6. `summaryText` の連結と、空のとき ''。
7. `fixtureIdentity`: 位置だけが違う 2 項目は別、位置なし同士で略号・規格・名称が同じなら同じ。
8. `fixtureFromPreset` が新しい欄を複製して引き継ぐ（元のプリセットの配列・オブジェクトと同一参照でない）。
9. `resolveRouteSet`: 同じ略号・規格・名称で位置の違う 2 項目があるとき、構成の項目の `breakdown` に合う方を選ぶ。位置の無い構成の項目は位置の無い項目を選ぶ。

既存の試験（`tests/` の他のファイル）は変えない。

## 禁止事項

- 既存の欄の検証（項目ごと読まない規則、上限の数値）を変えないこと。
- `masterEntries`・`searchQuantityMaster`・`QUANTITY_MASTER` のデータを変えないこと。
- CSV・Excel・集計表の列の数・並び・見出しを変えないこと。
- 指示していないリファクタ、関数名・変数名・既存の文言・`aria-label` の変更をしないこと。
- 指定した対象ファイル以外を変更しないこと。
- 依存パッケージを追加しないこと。

## 検証項目（Claude Code が実行する）

- [ ] `npx tsc --noEmit` が通る
- [ ] `npx vitest run tests/fixtureBreakdown.test.ts` が通る
- [ ] 既存の単体試験（`npx vitest run`）が通る
- [ ] e2e の数量拾い関係（項目の追加・編集、標準マスタ、集計表、構成）が通る
- [ ] 1.7.0 で作った PDF を開いて保存し直しても、項目・拾いが変わらない

## 報告してほしいこと

- 変更したファイルと、各ファイルで変えた関数・処理
- SPEC から外れた所があれば、その内容と理由
- 残課題
