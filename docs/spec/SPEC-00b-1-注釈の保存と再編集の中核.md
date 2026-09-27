# SPEC-00b-1: 試作（注釈の保存と再編集の中核）

## 実行モデル指定（必須）

- モデル: `gpt-5.6-sol`
- reasoning effort: `high`
- 選定理由: 新しい機能の実装で、PDF の内部構造（外観ストリーム、フォントの埋め込みとサブセット化）という判断の余地がある難所を含み、複数のファイルにまたがるため

---

## 目的

「かるPDF」でいちばん大事な要件は、**日本語の書き込みを保存し、開き直した後も再編集できること**である（既存のソフトでいちばん不満だった点）。

この SPEC では、その中核を、画面なしで（Node の結合テストで確かめられる形で）作る。

- 文字の注釈（FreeText）を BIZ UDゴシックで書き込む。フォントは使った文字だけを埋め込み、外観（AP）は自前で作る。
- 保存して開き直すと、同じ内容・位置・大きさ・色で読み戻せる。
- 読み戻した注釈を書き換えて、もう一度保存できる。
- 四角（Square）の注釈を作る、動かす、消す。
- 保存した PDF が、MuPDF でも、Edge と同じエンジン（PDFium）でも、同じ見た目になる。

画面での操作（ツール、ドラッグ、文字の入力欄）は、次の SPEC-00b-2 で作る。

最初に、`docs/要件と設計方針.md`（特に第4章「書き込みと保存」）と、今の `src/` の構成を読むこと。

## 対象

- 対象フォルダ: `C:\Users\gibbo\Desktop\PDF編集アプリ`
- 新しく作るファイル:
  - `src/core/textLayout.ts`: 文字の配置の計算（純関数）
  - `src/core/fontMetrics.ts`: TTF の表から ascender と unitsPerEm を読む
  - `src/core/defaultAppearance.ts`: DA 文字列を作る、読む
  - `src/core/annotations.ts`: 注釈の一覧、変更の反映、FreeText の外観の生成
  - `src/core/save.ts`: 保存
  - テスト: `tests/textLayout.test.ts`、`tests/defaultAppearance.test.ts`、`tests/annotations.integration.test.ts`、`tests/pdfium.compat.test.ts`
- 変更してよいファイル:
  - `src/worker/protocol.ts`、`src/worker/pdf.worker.ts`、`src/client/PdfWorkerPool.ts`（新しいメッセージの追加だけ）
  - `package.json`（devDependencies に `@embedpdf/pdfium` を**バージョン固定 `2.15.1`** で追加する）
  - `scripts/make-test-pdf.mjs`（必要があれば、テスト用の注釈を追加するだけ）
- 変更しないファイル: `docs/`、`public/fonts/`、`LICENSE`、`vite.config.ts`、`tsconfig.json`、`src/viewer/`、`src/perf/`、`src/App.tsx`

## 変更内容

### 1. データの形（`src/core/annotations.ts` に型として定義する）

```ts
type Rect = [number, number, number, number]   // ページ座標（MuPDF の getBounds と同じ座標系。pt、y は下向き、回転は反映済み）
type RGB = [number, number, number]            // 0〜1

interface AnnotationInfo {           // 読み出した注釈
  objNum: number                     // 注釈オブジェクトの番号（識別子）
  pageIndex: number
  type: string                       // 'FreeText' | 'Square' | それ以外（そのまま）
  editable: boolean                  // FreeText か Square なら true
  rect: Rect
  contents: string                   // FreeText の本文
  fontSize: number | null            // DA から読む（FreeText）
  textColor: RGB | null              // DA から読む（FreeText）
  strokeColor: RGB | null            // /C（Square）
  borderWidth: number | null
  madeByKaru: boolean                // DA のフォント名が BIZUDGothic か BIZUDMincho なら true
}

type AnnotationEdit =
  | { kind: 'createFreeText'; pageIndex: number; rect: Rect; text: string; fontSize: number; color: RGB; font: 'BIZUDGothic' }
  | { kind: 'updateFreeText'; objNum: number; pageIndex: number; rect: Rect; text: string; fontSize: number; color: RGB; font: 'BIZUDGothic' }
  | { kind: 'createSquare'; pageIndex: number; rect: Rect; color: RGB; borderWidth: number }
  | { kind: 'updateSquare'; objNum: number; pageIndex: number; rect: Rect; color: RGB; borderWidth: number }
  | { kind: 'delete'; objNum: number; pageIndex: number }
```

- `font` は、この SPEC では `'BIZUDGothic'` だけを扱う。明朝は第1版で追加する。
- `rect` の高さは、FreeText では呼び出し側（00b-2 の画面）が文字の配置の計算結果から決める。この SPEC の関数は、渡された `rect` をそのまま使う。

### 2. 文字の配置（`src/core/textLayout.ts`、純関数）

```ts
interface LayoutInput { text: string; fontSize: number; boxWidth: number; advance: (ch: string) => number /* em 単位 */; ascent: number /* em 単位 */ }
interface LayoutLine { text: string; x: number; baseline: number }   // 箱の左上からの pt
interface LayoutResult { lines: LayoutLine[]; height: number }       // height は余白を含む
export const PADDING = 2            // pt（上下左右）
export const LINE_HEIGHT_RATIO = 1.2
```

- 行の高さは `fontSize × LINE_HEIGHT_RATIO`。1行目のベースラインは `PADDING + ascent × fontSize`。
- 改行文字 `\n` で必ず改行する（`\r\n` と `\r` は `\n` として扱う）。タブは空白1つとして扱う。
- 1行の幅（advance の合計 × fontSize）が `boxWidth − 2 × PADDING` を超える手前で折り返す。**文字単位**で折り返す（英単語の途中でも折り返してよい）。
- **禁則処理**（追い出し方式）
  - 行頭に来てはいけない文字: 、。，．・：；？！゛゜ヽヾゝゞ々ー）］｝」』】〕〉》”’ ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ と、半角の `) ] } , . : ; ! ?`
    - これが次の行の先頭に来る場合は、前の行の最後の1文字を次の行へ送る。
    - ただし、前の行が1文字しかない場合は送らない。
  - 行末に来てはいけない文字: （［｛「『【〔〈《“‘ と、半角の `( [ {`
    - これが行末に来る場合は、次の行へ送る。
- 空の文字列は、1行（空行）として扱う。
- `height = 2 × PADDING + 行数 × fontSize × LINE_HEIGHT_RATIO`
- 単体テストでは、改行、折り返し、禁則（行頭・行末）、1文字の行、空文字、半角と全角の混在を確かめる。advance は固定値の関数を渡してよい。

### 3. フォントの情報（`src/core/fontMetrics.ts`）

- TTF のバイト列から、`head` 表の unitsPerEm（オフセット 18、uint16）と、`hhea` 表の ascender（オフセット 4、int16）を読む。`ascent = ascender / unitsPerEm` を返す。
- advance は、`mupdf.Font` の `encodeCharacter` と `advanceGlyph` から求める。
  - 単位（em で正規化されているか）を型定義と実測で確かめ、コメントに書く。
  - フォントに無い文字（グリフ番号 0）は `〓` に置き換えて配置し、置き換えた件数を返す。

### 4. DA 文字列（`src/core/defaultAppearance.ts`）

- 作る: `/BIZUDGothic 10.5 Tf 1 0 0 rg`
  - 色は 0〜1 の小数（小数点以下3桁まで、末尾の 0 は省く）。
  - サイズは小数点以下2桁まで。
- 読む: `/<名前> <サイズ> Tf` と、色（`g` 1成分、`rg` 3成分、`k` 4成分。k は RGB に変換）を取り出す。読めない部分は null にする。
- 単体テストを書く。

### 5. 注釈の一覧と変更（`src/core/annotations.ts`）

- `listAnnotations(doc, pageIndex): AnnotationInfo[]`
  - `rect` は `annot.getRect()`（ページ座標）を使う。この座標系であることを、回転したページ（sample-small の5ページ目、/Rotate 90）で確かめる。
  - DA は `annot.getObject().get('DA')` の文字列を自前で読む（`getDefaultAppearance()` は、知らないフォント名を置き換えることがあるため使わない）。
- `applyEdits(doc, edits, font: FontResource): ApplyResult`
  - **FreeText を作る／更新する**
    1. 属性を設定する。
       - `setRect`、`setContents`
       - DA（`getObject().put('DA', ...)` で文字列として設定する）
       - `/BS << /W 0 >>`（枠なし）、`/F 4`（印刷可）
       - `/NM`（`karu-` で始まる一意の名前。新規のときだけ）
       - `setModificationDate`
       - **作成者（/T）は設定しない。/RC も設定しない。**
    2. `annot.update()` を1回呼び、MuPDF に標準の外観を作らせる。これは、以後の自動の作り直しの印を消すためである。
    3. その後、**自前の外観で `/AP /N` を置き換える**（第6章）。
    4. 置き換えた後は、`update()` を呼ばない。保存の前後で、外観が MuPDF に作り直されていないことをテストで確かめる。
  - **Square を作る／更新する**
    - `setRect`、`setColor`、`setBorderWidth` を設定する。`setInteriorColor([])`（塗りなし）にする。
    - `update()` で MuPDF に外観を作らせる。
  - **削除**: `page.deleteAnnotation(annot)`
  - 注釈は、`objNum` でページの注釈一覧から探す。見つからなければ、エラーとして結果に含める（例外で全体を止めない）。
  - 戻り値には、作った注釈の objNum と、置き換えた文字の件数を含める。

### 6. FreeText の外観（最重要）

**要件**
- BIZ UDゴシックを埋め込み、**使った文字だけのサブセット**にする。
- 文書にもともとある他のフォントには、一切触れない。
- 文字は ToUnicode を持ち、検索とコピーができる。

**方式A（先に試す）**: 一時文書でサブセットを作ってから移す

1. `new mupdf.PDFDocument()` で一時文書を作る。
2. 今回作る／更新するすべての FreeText について、一時文書に同じ大きさのページを作る。そこに同じ内容の FreeText を作り、外観を作る。
   - 外観は、`DisplayList` に、`mupdf.Text` の `showGlyph`（第2章の配置、第3章のグリフ）と `fillText` で文字を描き、`setAppearanceFromDisplayList` で設定する。
   - 行列の向き（y が下向きの座標系での文字の反転）は、描いた結果の画像で確かめる。
3. 一時ページの内容から、その外観を参照させる（`q /Fm0 Do Q` など）。こうして `subsetFonts()` が使われている文字を見つけられるようにする。そのうえで、一時文書で `subsetFonts()` を呼ぶ。
4. `doc.graftObject()`（または `newGraftMap()`）で、外観のオブジェクトを本来の文書へ移す。本来の注釈の `/AP` を `<< /N 移したオブジェクト >>` にする。外観の BBox と Matrix は、本来の注釈の Rect と一致させる。

**方式B（A がうまくいかない場合）**: 一時文書で `addFont(font)` を使い、内容ストリーム（`BT /F1 … Tf … Tj ET`、Identity-H のグリフ番号を16進で書く）と `setAppearance(...)` で外観を作る。その後の手順は A と同じ（サブセット化 → 移す）。

どちらの方式を採ったかと、その理由を報告すること。

**確かめること**（`tests/annotations.integration.test.ts`）
- 保存した PDF を開き直したとき:
  - `/AP /N` のフォント資源に BaseFont `…+BIZUDGothic…`（サブセットの接頭辞付き）があり、FontFile2 か FontFile3 と ToUnicode を持つ。
  - 埋め込まれたフォントのストリームの長さが **300KB 未満**である（全体の 4.7MB が入っていない）。
  - `page.toStructuredText().asText()` に、書き込んだ日本語が含まれる。
  - 注釈の範囲を描くと、赤に近い画素が一定数以上ある（見えている）。

### 7. 保存（`src/core/save.ts`）

- `saveDocument(doc, mode: 'incremental' | 'full'): { bytes: Uint8Array; mode: 'incremental' | 'full'; ms: number }`
  - `'incremental'` を指定しても、`canBeSavedIncrementally()` が false の場合は `'full'` で保存する。実際に使った方式を返す。
  - `'full'` では、不要なオブジェクトを除き、圧縮する。オプション文字列は型定義とドキュメントで確かめる。
  - MuPDF の Buffer から Uint8Array へコピーした後、Buffer は `destroy()` する。

### 8. Worker の通信（Worker 0 だけが担当する）

- 追加するメッセージ:
  - `listAnnotations {requestId, pageIndex}` → `{annotations}`
  - `layoutText {requestId, text, fontSize, boxWidth}` → `LayoutResult`
  - `applyAndSave {requestId, edits, mode}` → `{bytes（transfer）, mode, ms, created, errors}`
- フォントは、初めて必要になったときに `${import.meta.env.BASE_URL}fonts/BIZUDGothic-Regular.ttf` から読み、`mupdf.Font` として Worker 0 に保持する。Node のテストでは `public/fonts/` から読む。
- これらのメッセージは、キューの描画要求より先に処理する（優先度 −1 に相当）。
- `PdfWorkerPool` に、これらを Promise で呼ぶメソッドを追加する。**画面の側（viewer）からは、まだ呼ばない**（00b-2 で使う）。

### 9. テスト

- `tests/annotations.integration.test.ts`（Node、実際の mupdf、`test-data/sample-small.pdf`）
  1. 1ページ目に FreeText「日本語の書き込みテスト①（半角ABC 123）」を作る（10.5pt、赤、幅 200pt）。保存して開き直し、次を確かめる。
     - 本文、Rect（誤差 0.01 以内）、DA のサイズと色、`madeByKaru`
     - 第6章の項目
  2. 1. の注釈を「書き換えました。\n二行目」に更新して保存し、開き直して、本文と外観の文字（structured text）が新しい内容になっていることを確かめる。
  3. もともとある FreeText（"Existing note"、Helv）を日本語に書き換える。BIZ UD で外観が作り直され、`madeByKaru` が true になることを確かめる。
  4. 回転したページ（5ページ目）に FreeText を作る。保存後に描いた画像で、文字が注釈の範囲の中に描かれていることを確かめる。
  5. Square を作る → 動かす（rect を変える）→ 保存して開き直し、位置を確かめる → 削除する → 保存して開き直し、無いことを確かめる。
  6. 増分保存で、元のバイト列が保存後のバイト列の先頭にそのまま残っていることを確かめる。
- **実物の資料での確認**（`test-data/real/公共建築工事標準仕様書_建築_R7.pdf` があるときだけ実行する。なければ skip）
  - FreeText を3つ（3つの別ページ）作って増分保存する。次を確かめて、値を記録する。
    - 増えたバイト数が **300KB 未満**
    - 保存にかかった時間
  - 注釈を置いていない3ページを保存の前後で描き、画素が一致すること（他のフォントに触れていないことの確認）。
- `tests/pdfium.compat.test.ts`（Edge と同じ描画エンジンでの確認）
  - `@embedpdf/pdfium` で、1. の保存結果の1ページ目を、注釈込み（`FPDF_ANNOT`）で描く。
  - 注釈の範囲の赤に近い画素の数が、MuPDF で描いた場合の ±30% 以内であることを確かめる（日本語が消えていないことの確認）。
  - 回転したページ（4.）も同じように確かめる。
- 確認用に、1. と 4. の保存結果を `test-results/annot-roundtrip.pdf` に書き出す（後で Claude Code が Acrobat と Edge で目視確認する）。

## 禁止事項

- 対象外のファイルを変更しないこと。git の操作をしないこと。
- 文書にもともとあるフォントやページの内容を変えないこと（`subsetFonts()` を元の文書に対して呼ばない）。
- 注釈に作成者（/T）を入れないこと。
- `@embedpdf/pdfium` は devDependencies だけに入れ、`src/` から import しないこと（アプリ本体には含めない）。
- 自分で起動したサーバーは必ず止めること。一時ファイルは削除すること。

## 検証項目

- [ ] `npm run build` が成功する（main のチャンクに mupdf と pdfium が含まれない）。
- [ ] `npm test` がすべて成功する（上記の新しいテストを含む。実物の資料のテストは、ファイルがあるので実行されること）。
- [ ] `npm run e2e` が成功する（既存のものが壊れていない）。

## 報告してほしいこと

- 作成、変更したファイル
- 外観の方式（A か B か）と理由、行列の向きなどで分かったこと
- サブセットにしたフォントの大きさ、実物の資料での増えたバイト数と保存時間
- PDFium での確認の結果（赤の画素数の比較）
- MuPDF.js の API で、型定義や SPEC の記述と違っていた点
- 逸脱と残課題
