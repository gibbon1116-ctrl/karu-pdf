# SPEC-B04: 内訳書形式の Excel 出力（細目別内訳・別紙明細）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: Excel の書き出し部品に数式を足す改修（ファイル形式の正しさ）と、内訳書の並び・別紙明細の判定・丸め・シート間の参照を組む新しい投影の設計が要る

---

## 背景

計画 非公開の調査資料 の段階 B04（4.6）。B01〜B03 で、数量拾いの項目に内訳書の位置（編・種目・科目・中科目・細目）・摘要・単位を持たせ、内訳書のマスタから項目を作れるようにした。この段階では、拾った数量を **公共建築工事内訳書標準書式の形で Excel に書き出す**。利用者は単価を入れて設計書に使う。

数量の丸めは利用者の決定どおり **公共建築設備数量積算基準** に合わせる: 内訳書（細目別内訳）の数量は小数点以下第1位を四捨五入して整数。別紙明細は、長さは小数点以下第1位、面積・体積・質量は第2位まで（四捨五入）、個数は整数。

## 対象

- 対象フォルダ: リポジトリのルート
- 新規:
  - `src/app/breakdownXlsx.ts` — 内訳書のシートの投影
  - `tests/breakdownXlsx.test.ts`
- 変更:
  - `src/core/xlsxWriter.ts` — 数式のセル、開いたときの再計算
  - `src/app/quantityXlsx.ts` — 内訳書のシートを足す
  - `src/app/HelpDialog.tsx` — 説明の文を足す
  - `tests/xlsxWriter.test.ts`、`tests/quantityXlsx.test.ts` — 必要な試験を足す（既存の試験は変えない）
  - `e2e/quantity-table.annotate.spec.ts` は変えない。新しい e2e は `e2e/breakdown-master.annotate.spec.ts` に1件足す
- 変えない: `src/core/breakdownMaster.ts`、`src/core/breakdown/*`、`src/core/countFixtures.ts`

## 変更内容

### 1. 数式のセル（`xlsxWriter.ts`）

- `XlsxCell` に `formula?: string` を足す（先頭の `=` は付けない。例: `'C5*E5'`）。`formula` があるセルは `<c r s><f>…</f></c>` と書く（`value` が数ならキャッシュ値として `<v>` も書いてよい。文字列の `value` との併用は不可で `Error`）。数式の文字は XML のエスケープをする。
- ブックに `<calcPr fullCalcOnLoad="1"/>` を入れ、Excel で開いたときに数式を計算させる（`workbook.xml` の `</sheets>` の後）。
- 書式（`XlsxStyle`）に `'borderedMoney'`（罫線付き、数値の書式 `#,##0`）を足す。`STYLE_IDS`・`STYLES_XML` を合わせて直す。既存の書式の番号は変えない（新しい書式は末尾に足す）。
- `tests/xlsxWriter.test.ts` に、数式セルの XML、`calcPr`、エスケープ、`value` が文字列で `formula` もあると `Error`、の試験を足す。

### 2. 内訳書のシート（`breakdownXlsx.ts`、新規）

`breakdownMaster` を静的に import してよい（`quantityXlsx` は Excel を書き出すときだけ遅延読込される）。

```ts
export interface BreakdownSheetOptions {
  fixtures: readonly CountFixture[]
  index: QuantityIndex
  pdfName: string
}
/** 内訳書の位置を持つ項目が無ければ []。あれば「細目別内訳」「別紙明細」の2シート（別紙明細が無ければ1シート） */
export function breakdownSheets(options: BreakdownSheetOptions): XlsxSheet[]
/** 丸め。level 'item' は整数、'detail' は個数=整数・長さ=0.1・面積/体積=0.01。四捨五入で、浮動小数の誤差（例 2.675）を正しく扱う */
export function roundBreakdownQuantity(value: number, kind: QuantityKind, level: 'item' | 'detail'): number
```

#### どの項目を出すか

- `breakdown` を持つ項目だけ。数量（`index.total(id)`）が 0 の項目は出さない。
- 施工条件（`index.byCondition(id)`）が2つ以上ある項目、または条件が1つで空でない項目は、条件ごとに行を分ける（数量は条件ごとの `total`）。条件が空（未設定）だけのときは1行。

#### 細目が「別紙明細」かの判定

同じ位置（編・種目・科目・中科目・細目）の項目をまとめて、次で決める。

1. `breakdownEntries()` に、その位置（`book`・`section`・`subject`・`middle`、`row.name === item`）の行があれば、その行の `row.separate` で決める。
2. 行が無い（利用者が手で入れた位置）ときは、その位置の項目のうち1つでも `name !== item` のものがあれば別紙明細、すべて `name === item` なら数量で計上する細目。

#### 並び

- 群（編・種目・科目・中科目）の並びは、`breakdownEntries()` に最初に出てくる順。マスタに無い群は、その後に、群の中の項目の `order` の最小値の順。
- 群の中の細目の並びは、マスタの行の順（同じ名前の行が複数あれば最初）。マスタに無い細目は後ろに、項目の `order` の順。
- 同じ細目の中の項目は `order` の順、その中の条件は、空（未設定）を先に、次に項目の施工条件の候補の順、候補に無いものは文字列の昇順（実装後に Claude が変更。当初は文字列の昇順）。

#### 「細目別内訳」シート

列: 名称・摘要・数量・単位・単価・金額・備考（A〜G）。列幅の目安 28・36・10・6・12・14・20。

1. 1行目: `${pdfName から .pdf を除いたもの} 細目別内訳`（書式 `title`、A〜G を結合）。2行目は空。3行目: 見出し（書式 `header`）。見出しの行を固定表示（`freeze: { rows: 3, columns: 0 }`）。
2. 群ごとに:
   - 種目・科目・中科目が直前の群と変わったところで、見出しの行を出す（書式 `category`、A〜G を結合）。種目の行は種目名、科目の行は全角空白1つ＋科目名、中科目の行は全角空白2つ＋中科目名。編が変わったら編名の行も先に出す（全角空白なし）。
   - 細目の行:
     - **数量で計上する細目**: 項目（と条件）ごとに1行。名称 = `item`（細目名）。摘要 = `summaryText(f)` と、規格（`f.spec`）、条件をこの順に「、」でつないだもの（空は省く）。数量 = `roundBreakdownQuantity(数量, kind, 'item')`。単位 = `quantityUnit(f)`。単価は空。金額 = 数式 `IF(E{r}="","",C{r}*E{r})`。備考 = `f.remark` と、マスタの行が `renovation` なら「※」を「、」でつないだもの。
     - **別紙明細の細目**: 1行。名称 = `item`、摘要は空、数量 = 1、単位 = `式`、単価は空、金額 = 別紙明細シートのその細目の「計」の金額のセルへの参照（数式 `'別紙明細'!F{行}`）、備考 = `別紙明細-${番号}`（と「※」）。
   - 群の最後に「計」の行: 名称 = `計`、金額 = その群の細目の行の金額の `SUM`（数式）。
3. 数値のセルの書式: 数量は `borderedInteger`、金額は `borderedMoney`、文字は `borderedText`。

#### 「別紙明細」シート

同じ列（A〜G）。1行目: `${名前} 別紙明細`、3行目: 見出し、固定表示は細目別内訳と同じ。

- 別紙明細の細目ごと（細目別内訳に出した順）に:
  - 見出しの行（`category`、A〜G 結合）: `別紙明細-${番号}　${科目}／${中科目 ?? ''}／${細目}`（中科目が無ければ `${科目}／${細目}`）。番号は1から順。
  - 項目（と条件）ごとに1行: 名称 = `f.name`。摘要 = `fixtureCode(f)`（略号＋規格）、`summaryText(f)`、条件を「、」でつないだもの（空は省く。略号が名称と同じなら略号は省く）。数量 = `roundBreakdownQuantity(数量, kind, 'detail')`。単位 = `quantityUnit(f)`。単価は空。金額 = 数式（細目別内訳と同じ形）。備考 = `f.remark`。
  - 「計」の行: 金額 = その細目の行の `SUM`。
- 数量の書式: 個数は `borderedInteger`、それ以外は `borderedDecimal`。

### 3. `quantityXlsx.ts`

- `quantityWorkbookSheets` の戻り値の末尾に `breakdownSheets({ fixtures, index, pdfName })` を足す（項目に位置が無ければ何も足さない＝今と同じ2シート）。
- 既存の「集計表」「明細」は変えない。

### 4. ヘルプ（`HelpDialog.tsx`）

「標準マスタから追加」の説明の段落（`「分野の一式」では従来の見本をまとめて追加できます。` で終わる文）の後に、次の文を同じ段落に足す:

> 「内訳書から選ぶ」では、公共建築工事内訳書標準書式の科目・中科目・細目をたどって選び、盤名称・形式などの摘要を入れて追加できます（いまは電気設備）。盤名称・記号を「、」で区切ると複数の項目をまとめて作れます。内訳書の位置を持つ項目は、集計表の Excel に「細目別内訳」「別紙明細」のシートとして出ます（数量は数量積算基準の丸め。単価を入れると金額が計算されます）。

### 5. 試験

`tests/breakdownXlsx.test.ts`（vitest）:

1. 位置の無い項目だけなら `breakdownSheets` は `[]`。
2. 電灯分岐の分電盤 L-1（3面）・L-2（1面）、電灯幹線の電線管（ねじなし電線管 E25: 隠ぺい 12.34m・露出 5.06m）と同じ電灯幹線の電線（IV 5.5sq 30.55m）を持つデータで:
   - 細目別内訳の見出し行の並び（庁舎 → 電灯設備 → 電灯幹線 → … → 電灯分岐）と、細目の行の並びがマスタの順（電灯幹線では「電線」が「電線管」より前）。
   - 分電盤の行が2つ、摘要 `L-1`・`L-2`、数量 3・1、単位 面。
   - 電線・電線管の細目がそれぞれ「1 式」で、金額のセルが別紙明細シートの「計」の行を参照する数式。備考が `別紙明細-1`・`別紙明細-2`（細目別内訳に出た順）。
   - 別紙明細で、電線管が条件ごとに2行（12.3 と 5.1、摘要に「隠ぺい配管」「露出配管」）、数量の書式が小数。「計」の行の数式が SUM。
3. マスタに無い位置（手で入れた「科目 A／細目 B」）で、名称が細目と同じ項目1つ → 数量で計上する細目。名称が違う項目 → 別紙明細。
4. `roundBreakdownQuantity`: 2.5 → 3（item）、2.45 m → 2.5（detail）、2.675 ㎡ → 2.68（detail）、1.005 ㎡ → 1.01、count の 2.5 → 3。
5. 改修の行（例: 電灯幹線の「撤去」の明細を持つ項目）の細目別内訳の備考に「※」。
6. `quantityWorkbookSheets` が、位置のある項目があるときに4シート（集計表・明細・細目別内訳・別紙明細）、無いときに2シート。

e2e（`e2e/breakdown-master.annotate.spec.ts` に1件）: 内訳書から分電盤 L-1 を追加し、図面に印を2つ置き、集計表から Excel に書き出す（既存の `e2e/quantity-table.annotate.spec.ts` の「Excel export writes the displayed table…」と同じ取り出し方）。ブックに「細目別内訳」シートがあり、分電盤の行の数量が 2、単位が 面。

## 禁止事項

- 既存の「集計表」「明細」シートの内容・書式を変えないこと。既存の書式の番号を変えないこと。
- `breakdownMaster`・`breakdown/*`・`countFixtures` を変えないこと。
- 依存パッケージを足さないこと。指定外のファイルを変えないこと。

## 検証項目（Claude Code が実行する）

- [ ] `npx tsc --noEmit`、単体（新規・変更分と全件）
- [ ] `npm run build` の後 e2e（新規の1件、`quantity-table`、`breakdown-master`）
- [ ] 書き出したブックを Excel 互換の読み取りで開き、数式が計算されること（Claude が手元で確認）

## 報告してほしいこと

- 変更したファイルと関数
- SPEC から外れた所と理由
- 残課題
