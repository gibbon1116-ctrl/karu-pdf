# SPEC-S08: 集計表を Excel（.xlsx）に書き出す

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 外部ライブラリなしで .xlsx（ZIP と Office Open XML）を作る。Excel が開ける正しい形式と、既存の CSV を変えないことの両方が要る

---

## 利用者の要望

> 集計表を出力するとき、CSVでの出力になっているが、表示している集計表の画面がそのまま出力できるようにしたい。CSVではなく、エクセルの資料として出力したい。

利用者の選択：
- 1 枚目のシートは、画面の集計表をそのまま出す。
- 2 枚目のシートに明細を付ける。
- CSV の書き出しは残す。

## 現状（Claude Code が確かめたこと）

- 集計表は `src/app/QuantityTable.tsx`。
  - 表示の切替：図面別・階別・階・部屋別（`mode`）、施工条件別（`allConditions`）、項目ごとの展開（`expanded`）。
  - 絞り込み：分類・種別・名称や略号の検索・未設定だけ（`filters`）。
  - 表の中身は `projectQuantityTable(data, mode, filters, drawingInfo, display)` が作る。
    - `rows`：分類の行、項目の行、施工条件の行。
    - `columns`：80 列まで（`ordered.slice(0, 80)`）。
  - 固定の列：見本・略号・名称・単位・全図面。見本は、項目に見本（PNG）があればその画像。
  - 数の書き方：個数は整数、それ以外は小数 2 桁（`format`）。0 は空欄。
- CSV は `src/app/annotationCsv.ts` の `createQuantityCsv(index, fixtures, currentPageIndex, type, drawingInfo)`。
  - 明細（`type === 'detail'`）の列は `QUANTITY_DETAIL_HEADER`。
- 依存ライブラリは `mupdf`・`react`・`react-dom` だけ。ZIP を作る仕組みは無い。
  - 閉域版・単一 HTML 版があるので、ネットワークを使うものや新しい依存は足さない。

## 変更内容

### 1. .xlsx を作る部品（新規 `src/core/xlsxWriter.ts`）

外部ライブラリを使わずに、.xlsx のバイト列を作る。

- 入力（形は任せるが、次を表せること）：
  - シートの並び。各シートに、名前、セル、セルの結合、列の幅、行の高さ、固定する行・列、画像。
  - セルの値：文字・数・空。
  - セルの書式（決まった組から選ぶ）：
    - 普通の文字
    - 見出し（太字・薄い灰の塗り・細い罫線・中央寄せ・折り返し）
    - 分類の行（太字・薄い青の塗り）
    - 整数（`0`）、小数 2 桁（`0.00`）
    - 罫線付きの文字
    - 罫線付きの整数・小数 2 桁
  - 画像：PNG のバイト列、置くセル（行・列）、表示の幅・高さ（px）。
- 出力：`Uint8Array`（.xlsx の中身）。
- 作るもの：
  - ZIP は無圧縮（stored）。CRC-32 を正しく計算する。ファイル名は ASCII。
  - `[Content_Types].xml`、`_rels/.rels`、`docProps/core.xml`、`docProps/app.xml`
  - `xl/workbook.xml`、`xl/_rels/workbook.xml.rels`、`xl/styles.xml`、`xl/sharedStrings.xml`
  - `xl/worksheets/sheetN.xml`
  - 画像があるシートだけ：`xl/drawings/drawingN.xml`、その rels、`xl/media/imageN.png`、シートの rels
- 守ること：
  - XML の特殊文字（`& < > " '`）を正しく書き換える。XML で使えない制御文字は取り除く。
  - シート名は Excel の決まり（31 文字以内、`[]:*?/\` を使わない）に合わせて直す。
  - 数は有限の数だけを数として書く（`NaN`・`Infinity` は空にする）。
  - 文字は共有文字列（sharedStrings）に入れる。
  - 列の番号は A〜XFD に正しく変換する（例：0→A、25→Z、26→AA、16383→XFD）。

### 2. 集計表の書き出し（新規 `src/app/quantityXlsx.ts`）

`createQuantityWorkbook(...)` のような関数を作り、`Uint8Array` を返す。入力は、集計表の今の状態（`data`・`mode`・`filters`・`display`・`drawingInfo`）、PDF の名前、`QuantityIndex`、項目の一覧。

**1 枚目：シート名「集計表」**

- 1 行目：`{PDF の名前（.pdf を除く）} 数量集計表`（太字）。
- 2 行目：表示の条件。例：`図面別・施工条件別・分類：電気・種別：個数・検索：LED・未設定だけ`。
  - 表示の名前は画面と同じ（図面別／階別／階・部屋別）。
  - 使っていない条件は書かない。
- 3 行目：空行。
- 4・5 行目：見出し（2 段）。
  - 固定の列：見本・略号・名称・単位・全図面。4・5 行目を縦に結合する。
  - 列ごと：上の段が `heading`、下の段が `subheading`（画面と同じ）。
- 6 行目から：画面の `rows` と同じ順。
  - 分類の行：その行の全部の列を結合し、分類名を書く（分類の行の書式）。
  - 項目の行：見本（下）・略号・名称・単位・全図面の合計・列ごとの値。
  - 施工条件の行：略号は空、名称は `└ {条件名、未設定なら「未設定」}`。見本も空。
  - 長さの施工条件の行で、画面が全図面の下に小さく出す「平面 … ／ 立上り・立下り …」は、1 枚目には出さない（明細のシートの「区間」で確かめられる）。
- 数：
  - 個数は整数の書式、それ以外は小数 2 桁の書式。値は丸めずに数として書く（表示は Excel の書式で丸める）。
  - 0 は空欄（画面と同じ）。
- 列：**80 列で切らず、すべての列を出す**。`projectQuantityTable` に列の上限を渡せるようにする（下の 4）。
- 見本：
  - 項目に見本（`fixture.sample`）があれば、その PNG を見本のセルに置く。
  - 大きさは、縦横比を保って 24px × 24px の中に収める。行の高さはそれに合わせる。
  - 見本が無い項目（印の形だけの項目、長さ・面積などの項目）は空欄。
- 見た目：
  - 固定の列と見出しを固定表示にする（左 5 列、上 5 行）。
  - 列の幅：見本 6、略号 12、名称 28、単位 6、全図面 12、列ごと 14（Excel の文字数の単位、目安）。
  - 表の部分（見出しから最後の行まで）に細い罫線。
- 表に行が無いとき：見出しの下に「該当する項目はありません」と書く。

**2 枚目：シート名「明細」**

- `createQuantityCsv(..., 'detail', ...)` と同じ行を、同じ順で出す。
  - 1 行目は `QUANTITY_DETAIL_HEADER`（見出しの書式）。
  - 数量・ページ番号・拾いの件数は数として書く（数量は、個数は整数、それ以外は小数 2 桁の書式）。
- **1 枚目の絞り込みは明細に使わない**（CSV の明細と同じく、すべての項目）。
  - その旨を 1 枚目の 2 行目の最後に書く：`（明細のシートは絞り込みなし）`。
- 見出しの行を固定表示にする。

### 3. 明細の行を CSV と共有する（`src/app/annotationCsv.ts`）

- 明細の行を作る部分を関数にして公開する（例：`quantityDetailRows(index, fixtures, drawingInfo)`）。数量は丸めない数で返す。
- `createQuantityCsv` はこの関数を使い、今と同じ書き方（個数は整数、それ以外は `toFixed(2)`）で文字にする。
- **CSV の出力は 1 バイトも変えない。** 既存の `tests/quantityCsv.test.ts`・`tests/annotationCsv.test.ts` は直さずに通ること。

### 4. 集計表の画面（`src/app/QuantityTable.tsx`）

- `projectQuantityTable` に、列の上限を指定する引数を足す（省略したときは今と同じ 80）。
  - 画面は今と同じ 80 列。Excel はすべての列。
- 道具の行の「CSVに書き出す」の隣に、ボタン「Excelに書き出す」を足す。
  - 押すと、今の表示（`mode`・`filters`・`allConditions`・`expanded`）で .xlsx を作り、保存する。
  - 作る部品（`quantityXlsx.ts`・`xlsxWriter.ts`）は押したときに読み込む（`import()`）。最初の読込みには入れない。
  - 保存：`window.showSaveFilePicker` があれば、それで保存する（ファイルの種類に .xlsx を示す）。無ければ、ダウンロードのリンクで保存する。
    - 種類：`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
    - ファイル名：`{PDF の名前（.pdf を除く）}_数量集計表.xlsx`
  - 利用者が保存を取りやめた（`AbortError`）ときは、何も表示しない。
  - 作成中はボタンを無効にする。失敗したら、表の上のエラー表示（`error`）に理由を出す。
- PDF の名前は `session.name` を使う。

### 5. ヘルプ（`src/app/HelpDialog.tsx`）

集計表の段落（「数量タブの「集計表」で図面の下に幅広い表を開けます。…」）の最後に、次を足す。

> 「Excelに書き出す」で、表示中の集計表（切替・絞り込み・施工条件の展開・見本の画像を含み、列は省略しません）と、明細のシートを Excel のファイルに書き出せます。

## 変えないこと

- CSV の書き出し（中身・ファイル名・操作）。
- 集計表の画面の表示と操作（80 列まで、仮想スクロール）。
- 集計表を開かないときの動き。最初に読み込むプログラムの大きさを増やさない（Excel の部品は押したときだけ読み込む）。
- 保存データ。

## 試験

**単体**（新規 `tests/xlsxWriter.test.ts`）

- 試験の中に、無圧縮の ZIP を読む小さな関数を書く（中のファイル名と中身を取り出す。CRC-32 も確かめる）。
- 確かめること：
  - 必要なファイル（上の 1 のファイル）がそろう。`[Content_Types].xml` に、シート・共有文字列・書式・（画像があれば）図形と png の種類がある。
  - 列の番号の変換（0→A、25→Z、26→AA、701→ZZ、702→AAA、16383→XFD）。
  - 特殊文字（`A&B<C>"D'`）と日本語が、XML として正しく書かれ、元に戻せる。制御文字は消える。
  - 数は `<v>` に書かれ、文字は共有文字列を指す。`NaN` は空。
  - セルの結合・固定表示・列の幅が XML に出る。
  - 画像を置いたシートに drawing の参照があり、`xl/media/image1.png` が元の PNG と同じバイト列。
  - 各 XML が整形式（`DOMParser` があれば使う。無ければ開始・終了タグの数の一致などで確かめる）。

**単体**（新規 `tests/quantityXlsx.test.ts`）

- 既存の `tests/quantityTable.test.ts` の作り方（項目と `QuantityIndex` の作り方）に合わせる。
- 確かめること：
  - 1 枚目の見出し・分類の行・項目の行・施工条件の行が、`projectQuantityTable` の `rows` と同じ順・同じ値。
  - 81 列以上ある場合も、すべての列が出る（画面の表は 80 列のまま）。
  - 絞り込み（分類・検索）が 1 枚目に効き、2 行目に条件が書かれる。
  - 2 枚目の明細が、`createQuantityCsv(..., 'detail')` と同じ行・同じ順（数は数で比べる）。
  - 見本のある項目だけ、画像が入る。

**変わらないことの確認**（Claude Code が実行する）

- `tests/quantityCsv.test.ts`、`tests/annotationCsv.test.ts`、`tests/quantityTable*.test.ts`、集計表の画面の試験。

## 対象

- 変更してよいファイル：
  - 新規：`src/core/xlsxWriter.ts`、`src/app/quantityXlsx.ts`、`tests/xlsxWriter.test.ts`、`tests/quantityXlsx.test.ts`
  - 変更：`src/app/annotationCsv.ts`、`src/app/QuantityTable.tsx`、`src/app/HelpDialog.tsx`
- 変更しないファイル：上以外。`package.json` に依存を足さない。

## 禁止事項

- 外部ライブラリ・ネットワークを使わないこと。
- 関数名・入力名・既存の文言を、SPEC にない形で変えないこと。
- git の操作をしないこと。python・pytest は使わない。

## 報告してほしいこと

- 変更点、SPEC から逸脱した箇所と理由、Claude Code に実行してほしい試験。
