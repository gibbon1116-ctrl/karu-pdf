# SPEC-04c: 指摘と変更記録を分ける（番号・印・書式・詳細・一覧）と、種類を選んで書き出すCSV

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 注釈のデータ・PDFへの保存と外観・画面・CSV・引継ぎにまたがる中核の改修で、既存PDFとの互換に判断が要るため（判定表「既存アプリの中核ロジック改修」「複数ファイルにまたがる改修」）

> Codex デスクトップアプリへ貼り付けて実行する場合は、モデルセレクタを上記に合わせてから貼り付けること。

---

## 目的

利用者から次の指摘と要望が出た（2026-10-04）。

> 変更記録と指摘があるが、連番になっているので扱いがごちゃごちゃになる。

> 変更記録の書式を自由度を高めたい。現状、大きさの設定しかできない。また、CSVで書き出す際には、指定した種類について書き出せるようにした[い]。現状、「指摘一覧をCSV…」とあるが、指摘だけに限定せず、場合によっては複数の種類を選択して出力できるようにしたい。

指摘の番号の付け方は、利用者の回答により「**文書全体の通し番号**（変更記録とは別の系列）」とする。

背景と判断は `docs/営繕改修_実用性レビュー.md` の 5章と「決定事項」を参照。番号は設計者とのやりとりに使う識別子なので、一度付けたら勝手に変わってはいけない。

## 確かめたこと（2026-10-04、現在のコード）

- 指摘と変更記録は、どちらも `kind: 'issue'` の Stamp 注釈で、PDF に `KaruIssue`（JSON）として保存する。変更記録は `recordKind: 'change'`。型は `src/core/issues.ts` の `Issue`、検証は `parseIssue`。
- 番号は `AnnotationStore.issueNumbers`（`IssueNumbers`、`src/editor/AnnotationStore.ts:191`）1つを共有している。作成は `src/editor/AnnotationLayer.tsx:818-826` と `src/editor/AnnotationStore.ts:425`、複製・貼り付けは `pasteAnnotations`（同 702行、721行で `issueNumbers.next()`）。初期化は `issueNumbers.initialize(() => pool.maxIssueNumber(docId))`（`src/App.tsx:379, 414, 919`、`src/editor/AnnotationLayer.tsx:820`、`src/app/IssueTransferDialog.tsx:26`）。走査は `src/core/issues.ts:53` の `maxIssueNumber`（Worker の `maxIssueNumber` 要求、`src/worker/pdf.worker.ts:365`、`src/worker/protocol.ts:365`、`src/client/PdfWorkerPool.ts:450`）。
- 「番号を振り直す」は `AnnotationStore.renumberIssues()`（770行）で、指摘と変更記録をまとめて振り直す。
- 図面上の印は、画面が `src/editor/AnnotationLayer.tsx:732`（白い丸に番号）、PDF の外観が `src/core/annotations.ts:1031` の `drawIssue`（同じ形）。保存は `src/core/annotations.ts:1325-1334`。状態が `done` のときはチェック印、`done`・`confirmed` は `issueColor` で灰色。
- 書式欄（`src/app/FormatPanel.tsx:194-201`）は、指摘・変更記録とも「大きさ」（12・16・24pt）だけ。指摘は色も選べるが、変更記録は選べない（94行の `simpleColorTarget` に `'change'` がない）。変更記録の既定色は紫（`src/editor/formatDefaults.ts` の `change: format([.55, .1, .7])`）。
- 詳細欄（`src/app/IssueDetails.tsx`）は、変更記録にも「分野」「回答」「修正確認」を出し、「関連指摘ID」に内部ID（UUID）を直接入力させる。
- 一覧（`src/app/AnnotationListPanel.tsx`）は、変更記録の行も種類名が「指摘」になり（`annotationKindLabel` が `kind: 'issue'` を「指摘」とする）、状態の選択も出る。
- CSV は「CSV に書き出す」（全書き込み）、「指摘一覧を CSV に書き出す」、「変更一覧をCSVに書き出す」（変更記録で絞ったときだけ）、「個数をCSVに書き出す」（個数カウントで絞ったときだけ）の別々のボタン（`src/app/annotationCsv.ts`）。
- 引継ぎ（`src/app/issueTransfer.ts`、`src/app/IssueTransferDialog.tsx`）は `pasteAnnotations` を使うため、新版では新しい番号になる。前回の指摘12が新版で指摘3になる。

## 対象

- 作業フォルダ: `C:\Users\gibbo\.codex\worktrees\dda9\PDF編集アプリ`
- 変更してよいファイル: `src/core/issues.ts`、`src/core/annotations.ts`（指摘の保存・読込・外観の部分だけ）、`src/editor/AnnotationStore.ts`、`src/editor/AnnotationLayer.tsx`、`src/editor/IssueEditor.tsx`、`src/editor/formatDefaults.ts`、`src/app/FormatPanel.tsx`、`src/app/IssueDetails.tsx`、`src/app/AnnotationListPanel.tsx`、`src/app/annotationCsv.ts`、`src/app/issueTransfer.ts`、`src/app/IssueTransferDialog.tsx`、`src/App.tsx`（番号の初期化と `window.__karu` のCSV関数だけ）、`src/worker/pdf.worker.ts`・`src/worker/protocol.ts`・`src/client/PdfWorkerPool.ts`（番号の走査の要求だけ）、`src/app/HelpDialog.tsx`、`src/styles.css`、`tests/`、`e2e/`
- 新しく作ってよいファイル: `src/app/CsvExportDialog.tsx`（下の6.）、試験ファイル
- 変更しないファイル: 上記以外。特に個数カウントの処理（`src/core/counts.ts` と、その描画・書式）は変えない（別の SPEC-04d で作り直す）。`package.json`、`package-lock.json`、`scripts/`、`docs/`、`test-data/`、`dist*/`、`release/`、`work/`

## 事前確認

- 上の「確かめたこと」に挙げた箇所をすべて読む。
- `rg -n "issueNumbers|maxIssueNumber|renumberIssues|recordKind|createIssueCsv|createChangeCsv|createAnnotationCsv|exportIssueCsv|exportAnnotationCsv|issueCsvFileName|annotationCsvFileName" src tests e2e` で参照を洗い出す。
- 指摘・変更記録・CSV に関わる既存の単体試験・画面試験（`tests/cloudIssues*.test.ts`、`tests/annotationCsv.test.ts`、`e2e/cloud-issues.annotate.spec.ts`、`e2e/compare.annotate.spec.ts`、`e2e/review-load.annotate.spec.ts` など）を読み、仕様変更で期待値が変わるものを把握する。

## 変更内容

### 1. 番号の系列を分ける

1. 指摘（`recordKind` が `'issue'` または未指定）と変更記録（`'change'`）は、別々の番号の系列にする。どちらも文書全体で1から始まる通し番号。
2. `AnnotationStore` に、指摘用の `issueNumbers` と変更記録用の `changeNumbers`（どちらも `IssueNumbers`）を持つ。系列を引数で選ぶ補助関数（例: `numbersFor(recordKind)`）を用意してよい。
3. 走査は文書あたり1回のまま、両系列の最大値を1度に求める。`maxIssueNumber(doc): number` を `maxRecordNumbers(doc): { issue: number; change: number }` に置き換え、Worker の要求・応答、`PdfWorkerPool`、呼出し側（`App.tsx`、`AnnotationLayer.tsx`、`IssueTransferDialog.tsx`）を合わせる。`initialize` は両系列を同時に初期化する（同じ Promise を共有し、走査を二重に行わない）。
4. 作成: 指摘の道具は `issueNumbers.next()`、変更記録の道具は `changeNumbers.next()` で番号を付ける。読込時の `observe` も系列ごとに行う。
5. 複製・貼り付け（`pasteAnnotations`）は、元の系列の次の番号を付ける（従来どおり新しい番号・新しいID）。
6. 「番号を振り直す」（`renumberIssues`）は系列を指定して、その系列だけを振り直す。元に戻す・やり直すも系列ごとに正しく戻す（履歴の `issueMaximum` を系列ごとにする）。
7. 削除しても番号は詰めない（欠番のまま、従来どおり）。
8. **既存PDFとの互換**: 試用版で作った PDF では、指摘と変更記録が同じ系列の番号を持っている（例: 指摘1、変更2、指摘3）。読み込んでも番号は変えない。新しく作る番号は、系列ごとの最大値の次から付ける（上の例では次の指摘は4、次の変更記録は3）。

### 2. 引継ぎで番号を保つ

1. 前回版から新版へ引き継ぐ指摘は、**前回と同じ番号**で新版に追加する。`pasteAnnotations` に番号を保つ指定（例: 第5引数 `{ keepIssueNumbers: true }`）を追加して使う。通常の複製・貼り付けの動きは変えない。
2. 新版の指摘の系列で、その番号がすでに使われている場合だけ、系列の次の番号を付ける。
3. 引き継いだ指摘には、前回の番号を `sourceNumber` として残す（`Issue` に任意の項目として追加。保存・読込・検証する）。既存の `sourceId`・`sourceDocument` は従来どおり残す。
4. 引継ぎの画面は、追加した後に「番号を保った n件、番号が重なったため付け直した m件（例: 指摘12 → 指摘31）」を表示してから閉じる。
5. 引き継いだ番号は `issueNumbers.observe` で系列の最大値に反映し、その後に作る指摘はその次の番号になる。

### 3. 印の形と書式（指摘・変更記録の両方）

1. 印の形を選べるようにする: 丸・三角・四角・ひし形・六角形。**既定は、指摘が丸、変更記録が三角**（図面の改訂記号の慣例）。
2. 書式欄に、指摘・変更記録とも次の項目を出す。書き込みを選んでいるときはその書き込みに、選んでいないときは道具の既定に反映する（既存の `FormatPanel` の書き方に合わせる）。
   - 形（上の5種類。記号の書式と同じようなボタン群でよい）
   - 線の色（既存の色見本 `COLORS`）
   - 塗り（なし・白・色見本から選ぶ。既定は白）
   - 線の太さ（既存の `WIDTHS` の pt。既定は従来の見た目に近い値）
   - 番号の文字の色（既定は「線の色と同じ」）
   - 大きさ（8・10・12・14・16・20・24・32・40・48 pt）
   - 透明度（既存の透明度の選択肢）
3. 指摘の状態の表示（`done`・`confirmed` の灰色、`done` のチェック印）は従来どおり指摘だけに適用する。変更記録には状態による色の変化を付けない。
4. 形・塗り・線の太さ・番号の文字の色は、`Issue` に任意の項目 `style` として追加して保存する（例: `style: { shape: 'circle' | 'triangle' | 'square' | 'diamond' | 'hexagon'; fill: RGB | null; textColor: RGB | null; lineWidth: number }`）。`parseIssue` で検証し、不正な値は読み込まない（既存の検証と同じ方針）。線の色は従来どおり注釈の色、透明度は注釈の不透明度として保存する。
5. `style` のない既存の指摘・変更記録は、従来の見た目（白い塗り・線の太さは大きさ×0.06）で表示する。ただし既存の変更記録の形は三角にする。
6. 画面の印（`AnnotationLayer.tsx:732`）と PDF の外観（`annotations.ts` の `drawIssue`）は、同じ形・塗り・線・文字・透明度で描く。他の PDF ソフトで開いても同じ見た目になるようにする（外観ストリームに描く）。
7. 番号の文字は、どの形でも印の内側に収まるようにする。三角では文字を下寄せ・小さめにする。桁数が増えても収まるようにする（既存の `issueFontSize` の考え方を形ごとに広げる）。

### 4. 詳細欄を分ける

1. 指摘の詳細: 分野、図面番号、回答、修正確認（従来どおり）。分野は、候補（建築・構造・電気・機械・外構・その他）から選べて、自由入力もできる欄にする（`<input list>` と `<datalist>` でよい）。
2. 変更記録の詳細: 図面番号、変更理由、関連指摘、日付。
   - 関連指摘は「指摘 12：内容の先頭」の一覧から選ぶ。内部ID（UUID）を直接入力する欄は削除する。保存する値は従来どおり関連する指摘の内部ID（`relatedIssueId`）。
   - 日付は日付入力欄（`YYYY-MM-DD`）。`Issue` に任意の項目 `date` として保存する。新しく作る変更記録は作成日を既定値にする。
   - 変更記録には、分野・回答・修正確認・状態を出さない（既存の値はデータに残すが、表示・編集しない）。
3. 詳細欄の見出しは「指摘 12 の詳細」「変更記録 3 の詳細」。内部ID（UUID）は表示しない。

### 5. 一覧を分ける

1. 一覧の行の種類名は、指摘は「指摘」、変更記録は「変更記録」と表示する。
2. 状態の選択は指摘の行だけに出す。
3. 絞り込みで「指摘」「変更記録」を選んだときは、それぞれの番号順に並べる。
4. 件数の表示は「未確認 x / 指摘 y、変更記録 z」とする。
5. 「番号を振り直す」は、絞り込みで指摘（「指摘」「指摘（未確認）」「指摘（確認済・旧対応済）」）または「変更記録」を選んでいるときだけ押せる。その系列だけを振り直す。確認の文に「振り直すと、CSVや印刷で渡した番号と合わなくなります」を入れる。

### 6. 種類を選んで書き出すCSV

1. 一覧の「CSV に書き出す」「指摘一覧を CSV に書き出す」「変更一覧をCSVに書き出す」を、1つの「CSV に書き出す…」ボタンにまとめる。押すと書き出しの画面（`src/app/CsvExportDialog.tsx`）を開く。「個数をCSVに書き出す」（個数カウントの集計）は SPEC-04d で作り直すため、今回はそのまま残す。
2. 書き出しの画面には次を置く。
   - 書き出す種類（複数選択）: 指摘、変更記録、個数カウント、文字、吹き出し、計測、図形（雲・線・矢印・四角・丸）、記号、ペン（蛍光ペン・手書き）、文字への印。「すべて選ぶ」「すべて外す」。初期値は一覧の絞り込みに対応する種類（「すべて」のときは全部）。
   - ページ範囲（一覧のページ範囲を初期値にする）。
   - 指摘の状態（すべて・未確認だけ・確認済だけ）。指摘を選んだときだけ出す。
   - 「書き出す」「閉じる」。1件もないときは「書き出す」を押せないようにし、理由を表示する。
3. CSV は1つの表にする。列は次のとおり。選んだ種類に関係する列だけを出す。
   - 常に出す列: 種類、番号、ページ、図面番号、内容、色、位置（x, y mm）、大きさ（幅, 高さ mm）
   - 指摘を選んだとき: 状態、分野、回答、修正確認、引継ぎ元番号、引継ぎ元文書、指摘ID
   - 変更記録を選んだとき: 変更理由、関連指摘番号、日付、変更ID
   - 計測を選んだとき: 縮尺
   - 個数カウントを選んだとき: 個数の種類
   - 番号は、指摘・変更記録だけに入れる（数値）。関連指摘番号は、関連指摘の内部IDから現在の番号を引いて入れる（見つからなければ空欄）。内容は書き込みの本文（指摘・変更記録は番号を含めない本文）。図面番号は指摘・変更記録の図面番号（他は空欄）。
   - その種類に関係しない列は空欄にする。
4. 行の順は、種類の順（上の一覧の順）にまとめ、その中は、指摘・変更記録は番号順、他はページ・上・左の順。
5. ファイル名は、指摘だけなら `<PDF名>_指摘一覧.csv`、変更記録だけなら `<PDF名>_変更一覧.csv`、それ以外は `<PDF名>_書き込み一覧.csv`。
6. BOM、CRLF、数式として解釈される文字列の抑止（`quote`）は既存どおり。
7. `window.__karu.exportIssueCsv()` と `exportAnnotationCsv()` は残し、新しい作り方で「指摘だけ」「すべての種類」を書き出した結果を返す。新たに `window.__karu.exportCsv(kinds: string[])` を追加してよい。

### 7. ヘルプ

`src/app/HelpDialog.tsx` の指摘・変更記録・CSVの説明を、上の仕様に合わせて書き直す（番号が別系列であること、印の形と書式、引継ぎで番号を保つこと、種類を選んでCSVに書き出すこと）。

### 8. 試験

- 単体試験を追加・更新する:
  - 指摘と変更記録を交互に作ると、指摘1・2、変更記録1・2のように系列ごとに番号が付く。
  - 既存の共有系列のJSON（指摘1、変更2、指摘3）を読み込んでも番号は変わらず、次は指摘4・変更記録3になる。
  - 振り直しが系列ごとで、元に戻すと両系列の状態が戻る。
  - 複製・貼り付けは系列に応じた番号になる。引継ぎは番号を保ち、重なるときだけ付け直して `sourceNumber` を残す。
  - `style`・`date`・`sourceNumber` の保存・読込と、不正値の拒否。
  - CSV の列が選んだ種類の組合せに応じて変わる。行の順、関連指摘番号の引き当て、BOM・CRLF・数式化の抑止。
- 画面試験を追加・更新する:
  - 指摘と変更記録を交互に作ると番号が独立し、印が丸と三角になる。
  - 変更記録の書式（形・線の色・塗り・線の太さ・文字の色・大きさ・透明度）を変え、保存して開き直しても保たれる。
  - 一覧で指摘・変更記録を絞り込むと種類名・番号順・状態の選択の有無が正しく、振り直しがその系列だけに効く。
  - CSV の画面で「指摘＋変更記録」を選んで書き出し、列と行を確かめる。
  - 比較の引継ぎで指摘の番号が保たれる（`e2e/compare.annotate.spec.ts` の既存の引継ぎ試験を拡張してよい）。
- 仕様の変更で期待値が変わる既存の試験（指摘CSVの列、変更記録の番号、印の形など）は、新しい仕様に合わせて更新する。更新した試験と理由を報告する。

## 性能

- 通常の読込・表示・スクロール・拡大に処理を足さない。番号の走査は従来どおり、指摘・変更記録の道具を初めて使うときなどに文書あたり1回だけ行う。
- 書き出しの画面は、開いたときだけ読み込む（`lazy`）。
- 1,000件の指摘でも、一覧の100行ずつの表示を保つ。

## 禁止事項

- 元データ（`test-data/`、`bench-results/`、`dist*/`、`release/`、`work/`）を変更しないこと
- 「対象」に挙げていないファイルを変更しないこと。特に個数カウントの処理を変えないこと
- 既存PDFの指摘・変更記録の番号を、利用者の操作なしに変えないこと
- 指示していない仕様変更・リファクタを行わないこと。関数名・変数名・入力項目名を、この SPEC で指定したもの以外に変えないこと
- 依存関係を追加しないこと
- **テスト・ビルド・型検査・ブラウザーを実行しないこと**（Claude Code 側で行う）
- **python は使えない（この環境に入っていない）。ファイルの編集は apply_patch で行い、スクリプトによる一括書き換えをしないこと**
- git 操作をしないこと

## 検証項目（Claude Code 側で実施）

- [ ] `npx tsc --noEmit` が通る
- [ ] `npm test`（単体試験の全件）が通る
- [ ] `npm run build` の後、追加・更新した画面試験と、指摘・比較・一覧に関係する既存の画面試験が通る
- [ ] 試用版1.1.0で作った指摘・変更記録入りのPDFを開き、番号が変わらず、新しい番号が系列ごとに続く
- [ ] 通常閲覧の読込・スクロール・拡大の数値を改修前と比べて記録する

## 報告してほしいこと

- 変更・作成したファイル一覧
- 追加・変更した関数・型・保存項目と、その役割
- 既存PDFとの互換の扱い（読み込み時に何をどう解釈するか）
- 更新した既存の試験と、その理由
- SPEC から逸脱した箇所があれば、その内容と理由
- 残課題
