# SPEC-04c: 変更記録を削除し、指摘を整え、種類を選んでCSVに書き出す

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 注釈のデータ・番号・画面・CSV・引継ぎ・試験にまたがる改修で、旧版のPDFとの互換に判断が要るため（判定表「既存アプリの中核ロジック改修」「複数ファイルにまたがる改修」）

> Codex デスクトップアプリへ貼り付けて実行する場合は、モデルセレクタを上記に合わせてから貼り付けること。

---

## 目的

利用者から次の判断と要望が出た（2026-10-04）。

> 変更記録の書き込みについて改修依頼をしていましたが、やはり変更記録自体が不要です。図面データの修正自体はCAD等の別のソフトで行います。指摘の機能は残してください。

> CSVで書き出す際には、指定した種類について書き出せるようにした[い]。現状、「指摘一覧をCSV…」とあるが、指摘だけに限定せず、場合によっては複数の種類を選択して出力できるようにしたい。

指摘の番号は、利用者の回答により「文書全体の通し番号」とする（現行どおり）。

この SPEC は、以前の `SPEC-04c-指摘と変更記録の分離.md`（取り下げ）に代わるもの。変更記録を作り込むのではなく、変更記録の機能を取り除き、指摘を実務で使いやすく整え、種類を選んで書き出すCSVを作る。背景は `docs/営繕改修_実用性レビュー.md` の 5章・6.1 と「決定事項」を参照。

## 確かめたこと（2026-10-04、現在のコード）

- 指摘と変更記録は、どちらも `kind: 'issue'` の Stamp 注釈で、PDF に `KaruIssue`（JSON）を持つ。変更記録は `recordKind: 'change'`（`src/core/issues.ts` の `Issue`、`parseIssue`）。
- 変更記録の道具: `src/app/ToolRow.tsx:14`（「変更記録」）、`src/ui/ToolIcon.tsx` の `'change'`、`src/editor/formatDefaults.ts` の `FormatTool` と `change`、`src/editor/AnnotationLayer.tsx:818-826`（作成）、`src/App.tsx:918`（道具の切替時の番号の初期化）、`src/app/FormatPanel.tsx`（`target === 'change'` の分岐）。
- 変更記録の詳細・一覧・CSV: `src/app/IssueDetails.tsx`（変更理由・関連指摘ID・関連指摘を選ぶ）、`src/app/AnnotationListPanel.tsx`（`'change'` の絞り込み、`createChangeCsv` のボタン）、`src/app/annotationCsv.ts`（`createChangeCsv`）。ヘルプは `src/app/HelpDialog.tsx` の「文字 → 変更記録」の段落。
- 番号は `AnnotationStore.issueNumbers`（`IssueNumbers`）1つで、指摘と変更記録が共有している。走査は `src/core/issues.ts:53` の `maxIssueNumber`。「番号を振り直す」は `AnnotationStore.renumberIssues()`（770行）で、両方をまとめて振り直す。
- 引継ぎ（`src/app/issueTransfer.ts`、`src/app/IssueTransferDialog.tsx`）は `pasteAnnotations`（`src/editor/AnnotationStore.ts:702`、721行で `issueNumbers.next()`）を使うため、新版では新しい番号になる。前回の指摘12が新版で指摘3になる。
- 詳細欄は内部ID（UUID）を「指摘ID」として表示している。分野は自由入力。
- CSV は「CSV に書き出す」（全書き込み）、「指摘一覧を CSV に書き出す」、「変更一覧をCSVに書き出す」、「個数をCSVに書き出す」の別々のボタン（`src/app/annotationCsv.ts`）。
- `KaruIssue` も `KaruCount` も持たない Stamp は `kind: 'other'`・`editable: false` になる（`src/core/annotations.ts:303-304, 330-338`）。

## 対象

- 作業フォルダ: `C:\Users\gibbo\.codex\worktrees\dda9\PDF編集アプリ`
- 変更してよいファイル: `src/core/issues.ts`、`src/core/annotations.ts`（指摘の読込・保存の部分だけ）、`src/editor/AnnotationStore.ts`、`src/editor/AnnotationLayer.tsx`（変更記録の作成・表示の部分だけ）、`src/editor/formatDefaults.ts`、`src/app/FormatPanel.tsx`（変更記録の分岐の削除だけ）、`src/app/ToolRow.tsx`、`src/ui/ToolIcon.tsx`、`src/app/IssueDetails.tsx`、`src/app/AnnotationListPanel.tsx`、`src/app/annotationCsv.ts`、`src/app/issueTransfer.ts`、`src/app/IssueTransferDialog.tsx`、`src/App.tsx`（変更記録の道具の削除と `window.__karu` のCSV関数だけ）、`src/app/HelpDialog.tsx`、`src/styles.css`、`tests/`、`e2e/`
- 新しく作ってよいファイル: `src/app/CsvExportDialog.tsx`（下の5.）、試験ファイル
- 変更しないファイル: 上記以外。特に個数カウントの処理（`src/core/counts.ts` とその描画・書式）は変えない（SPEC-04d で作り直す）。`package.json`、`package-lock.json`、`scripts/`、`docs/`、`test-data/`、`dist*/`、`release/`、`work/`

## 事前確認

- 上の「確かめたこと」の箇所をすべて読む。
- `rg -n "recordKind|'change'|changeReason|relatedIssueId|createChangeCsv|変更記録|変更理由|関連指摘|issueNumbers|maxIssueNumber|renumberIssues|createIssueCsv|createAnnotationCsv|exportIssueCsv|exportAnnotationCsv" src tests e2e` で参照を洗い出す。
- 指摘・変更記録・CSV に関わる既存の試験（`tests/cloudIssues*.test.ts`、`tests/annotationCsv.test.ts`、`e2e/cloud-issues.annotate.spec.ts`、`e2e/compare.annotate.spec.ts`、`e2e/review-load.annotate.spec.ts`、`e2e/businessCases.ts` など）を読み、仕様変更で期待値が変わるものを把握する。

## 変更内容

### 1. 変更記録の機能を取り除く

1. 道具「変更記録」を削除する（ツールの一覧、メニュー、アイコン、書式の既定 `change`、作成処理、書式欄の分岐）。利用者のPCに保存済みの書式の既定に `change` が残っていても、読み込みで無視し、エラーにしない。
2. 詳細欄の変更記録の項目（変更理由・関連指摘ID・関連指摘を選ぶ・関連指摘を見る）、一覧の「変更記録」の絞り込み、`createChangeCsv` と「変更一覧をCSVに書き出す」を削除する。
3. ヘルプから変更記録の説明を削除する。
4. 変更記録だけを確かめる試験は削除する。

### 2. 旧版のPDFにある変更記録の扱い

試用版1.1.0で作ったPDFには、`recordKind: 'change'` の変更記録が残っていることがある。

1. 旧版の変更記録は**指摘として扱わない**。指摘の一覧・件数・番号・状態・CSV・引継ぎの対象から外す。
2. 図面上には従来の見た目のまま表示する（保存済みの外観）。
3. 書き込み一覧の「すべて」に、種類「変更記録（旧版）」として表示し、選んで削除できるようにする（Delete・元に戻すも使える）。内容・書式の編集はできない。
4. 利用者が削除しない限り、PDF の中の変更記録は変えない。開いただけで未保存の表示にしない。

### 3. 指摘の番号

1. 番号は従来どおり文書全体の通し番号。走査（`maxIssueNumber`）は指摘だけで最大値を求め、旧版の変更記録の番号は数えない。
2. 既存の指摘の番号は、利用者の操作なしに変えない。旧版のPDF（例: 指摘1、変更2、指摘3）でも、次の指摘は4になる。
3. 削除しても番号は詰めない（欠番のまま、従来どおり）。
4. 「番号を振り直す」は指摘だけを振り直す。確認の文に「振り直すと、CSVや印刷で渡した番号と合わなくなります」を入れる。元に戻せる（従来どおり）。

### 4. 引継ぎで番号を保つ

1. 前回版から新版へ引き継ぐ指摘は、**前回と同じ番号**で新版に追加する。`pasteAnnotations` に番号を保つ指定（例: 第5引数 `{ keepIssueNumbers: true }`）を追加して使う。通常の複製・貼り付けの動き（新しい番号・新しいID）は変えない。
2. 新版でその番号がすでに使われている場合だけ、次の番号を付ける。
3. 引き継いだ指摘には、前回の番号を `sourceNumber` として残す（`Issue` に任意の項目として追加し、保存・読込・検証する）。既存の `sourceId`・`sourceDocument` は従来どおり残す。
4. 引継ぎの画面は、追加した後に「番号を保った n件、番号が重なったため付け直した m件（例: 指摘12 → 指摘31）」を表示する。
5. 引き継いだ番号は `issueNumbers.observe` で最大値に反映し、その後に作る指摘はその次の番号になる。

### 5. 詳細欄

1. 指摘の詳細は、分野、図面番号、回答、修正確認（従来どおり）。
2. 分野は、候補（建築・構造・電気・機械・外構・その他）から選べて、自由入力もできる欄にする（`<input list>` と `<datalist>`）。
3. 内部ID（UUID）は表示しない。見出しは「指摘 12 の詳細」。

### 6. 種類を選んで書き出すCSV

1. 一覧の「CSV に書き出す」「指摘一覧を CSV に書き出す」を、1つの「CSV に書き出す…」ボタンにまとめる。押すと書き出しの画面（`src/app/CsvExportDialog.tsx`）を開く。個数カウントの「個数をCSVに書き出す」（集計）は、SPEC-04d で作り直すため今回はそのまま残す。
2. 書き出しの画面:
   - 書き出す種類（複数選択）: 指摘、個数カウント、文字、吹き出し、計測、図形（雲・線・矢印・四角・丸）、記号、ペン（蛍光ペン・手書き）、文字への印。「すべて選ぶ」「すべて外す」。初期値は一覧の絞り込みに対応する種類（「すべて」のときは全部）。
   - ページ範囲（一覧のページ範囲を初期値にする）。
   - 指摘の状態（すべて・未確認だけ・確認済だけ）。指摘を選んだときだけ出す。
   - 「書き出す」「閉じる」。対象が1件もないときは「書き出す」を押せないようにし、理由を表示する。
3. CSV は1つの表にする。選んだ種類に関係する列だけを出す。
   - 常に出す列: 種類、番号、ページ、図面番号、内容、色、位置（x, y mm）、大きさ（幅, 高さ mm）
   - 指摘を選んだとき: 状態、分野、回答、修正確認、引継ぎ元番号、引継ぎ元文書
   - 計測を選んだとき: 縮尺
   - 個数カウントを選んだとき: 個数の種類
   - 番号は指摘だけに入れる（数値）。内容は書き込みの本文（指摘は番号を含めない本文）。図面番号は指摘の図面番号（他は空欄）。その種類に関係しない列は空欄にする。
   - 旧版の変更記録は書き出さない。
4. 行の順は、種類の順（上の一覧の順）にまとめ、その中は、指摘は番号順、他はページ・上・左の順。
5. ファイル名は、指摘だけなら `<PDF名>_指摘一覧.csv`、それ以外は `<PDF名>_書き込み一覧.csv`。
6. BOM、CRLF、数式として解釈される文字列の抑止（`quote`）は既存どおり。
7. `window.__karu.exportIssueCsv()` と `exportAnnotationCsv()` は残し、新しい作り方で「指摘だけ」「すべての種類」を書き出した結果を返す。`window.__karu.exportCsv(kinds: string[])` を追加してよい。

### 7. ヘルプ

`src/app/HelpDialog.tsx` の指摘とCSVの説明を、上の仕様に合わせて書き直す（番号は文書全体の通し番号で、振り直すと渡した番号と合わなくなること、引継ぎで番号を保つこと、種類を選んでCSVに書き出すこと）。

### 8. 試験

- 単体試験を追加・更新する:
  - 旧版の変更記録（`recordKind: 'change'`）を含むPDFを読むと、指摘の一覧・件数・番号の走査に入らず、次の指摘の番号が指摘だけの最大値の次になる。
  - 振り直しが指摘だけに効き、元に戻せる。
  - 引継ぎは番号を保ち、重なるときだけ付け直して `sourceNumber` を残す。通常の複製・貼り付けは新しい番号。
  - `sourceNumber` の保存・読込と、不正値の拒否。
  - CSV の列が選んだ種類の組合せで変わる。行の順、BOM・CRLF・数式化の抑止。
- 画面試験を追加・更新する:
  - 「文字▼」のメニューに「変更記録」がない。
  - 旧版の変更記録を含むPDF（試験の中で `KaruIssue` に `recordKind: 'change'` を持つ Stamp を作る）を開くと、指摘の一覧に出ず、書き込み一覧の「すべて」に「変更記録（旧版）」として出て、選んで削除できる。
  - 詳細欄に分野の候補が出て、内部IDが表示されない。
  - CSV の画面で「指摘＋文字」を選んで書き出し、列と行を確かめる。
  - 比較の引継ぎで指摘の番号が保たれる（`e2e/compare.annotate.spec.ts` の既存の引継ぎ試験を拡張してよい）。
- 仕様の変更で期待値が変わる既存の試験（指摘CSVの列、変更記録の試験など）は、新しい仕様に合わせて更新または削除する。更新・削除した試験と理由を報告する。

## 性能

- 通常の読込・表示・スクロール・拡大に処理を足さない。番号の走査は従来どおり、指摘の道具を初めて使うときなどに文書あたり1回だけ行う。
- 書き出しの画面は、開いたときだけ読み込む（`lazy`）。
- 1,000件の指摘でも、一覧の100行ずつの表示を保つ。

## 禁止事項

- 元データ（`test-data/`、`bench-results/`、`dist*/`、`release/`、`work/`）を変更しないこと
- 「対象」に挙げていないファイルを変更しないこと。特に個数カウントの処理を変えないこと
- 既存PDFの指摘の番号と、旧版の変更記録を、利用者の操作なしに変えないこと
- 指摘の書式（色・大きさ・状態の表示）を変えないこと（今回の対象外）
- 指示していない仕様変更・リファクタを行わないこと。関数名・変数名・入力項目名を、この SPEC で指定したもの以外に変えないこと
- 依存関係を追加しないこと
- **テスト・ビルド・型検査・ブラウザーを実行しないこと**（Claude Code 側で行う）
- **python は使えない（この環境に入っていない）。ファイルの編集は apply_patch で行い、スクリプトによる一括書き換えをしないこと**
- git 操作をしないこと

## 検証項目（Claude Code 側で実施）

- [ ] `npx tsc --noEmit` が通る
- [ ] `npm test`（単体試験の全件）が通る
- [ ] `npm run build` の後、追加・更新した画面試験と、指摘・比較・一覧に関係する既存の画面試験が通る
- [ ] 試用版1.1.0で作った `test-data/real/legacy-trial-1.1.0.pdf`（指摘1・変更2・指摘3、旧形式の個数カウント入り）を開き、指摘の番号が変わらず、次の指摘が4になり、変更記録は指摘の一覧に出ない。開いただけでは未保存にならない
- [ ] 通常閲覧の読込・スクロール・拡大の数値を改修前と比べて記録する

## 報告してほしいこと

- 変更・作成・削除したファイル一覧
- 追加・変更・削除した関数・型・保存項目と、その役割
- 旧版の変更記録の扱い（読込・表示・削除の実装）
- 更新・削除した既存の試験と、その理由
- SPEC から逸脱した箇所があれば、その内容と理由
- 残課題
