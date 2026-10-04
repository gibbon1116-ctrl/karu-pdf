# SPEC-04b: 「図面内文字を抽出」と「共有・提出用に保存」を外す

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 画面・Worker・出力処理・試験の複数ファイルにまたがる削除で、本文文字の修正や確定保存と共有している部分を見分ける判断が要るため（判定表「複数ファイルにまたがる改修」「仕様に判断の余地が残っている作業」）

> Codex デスクトップアプリへ貼り付けて実行する場合は、モデルセレクタを上記に合わせてから貼り付けること。

---

## 目的

利用者から次の判断が出た（2026-10-04）。

> 図面内文字の抽出や共有・提出用に保存の機能は不要。

この2つの機能を、メニュー・画面・専用の処理・専用の試験ごと取り除く。他の機能（特に「文字を修正…」＝本文文字の限定修正、文字の選択、確定して別名で保存、印刷、通常の保存）は1つも変えない。

元に戻す必要が出た場合は Git の履歴（導入前タグ `karu-pdf-before-eizen-20261003`、このブランチの過去のコミット）から戻す。コードを残してメニューだけ隠す方式にはしない。

## 確かめたこと（2026-10-04、現在のコード）

### 「図面内文字を抽出」だけが使っているもの

- メニュー: `src/app/MenuBar.tsx:83` の「図面内文字を抽出…」と `onExtractText`
- 画面: `src/app/TextExportDialog.tsx`、`src/app/textExport.ts`
- `src/App.tsx`: `TextExportDialog` の遅延読込（62行）、`textExportOpen`、`textExtractionAbortRef`、`trackTextExtraction`（296行付近）と、その中止呼出し（270・495・668行付近）、ダイアログの描画（1659行付近）、`onExtractText`（1575行）
- `src/client/PdfWorkerPool.ts:469` の `extractPageText`
- `src/worker/pdf.worker.ts` の `extractPageText` 要求の処理（380・775行付近）と `cancelTextExtraction`（727行付近）
- `src/worker/protocol.ts` の `extractPageText` 要求、`cancelTextExtraction`、`ExtractPageTextResponse`（`pageTextExtracted`）
- `src/core/textSelection.ts` の `extractPage()` と、その出力結果のキャッシュ（`exports`、文書あたり約4MiB）
- 試験: `tests/textExport.test.ts`、`e2e/text-extract.annotate.spec.ts`、`tests/textExtract.test.ts` のうち `extractPage()` と出力キャッシュを確かめる部分
- スクリプト: `scripts/eizen-text-validation.mjs`、`scripts/eizen-bench.mjs` の `--text-extraction`（23行）とその分岐（`conditions.textExtraction`、`row.textExtraction`、`afterFeatureClose` など）

### 「共有・提出用に保存」だけが使っているもの

- メニュー: `src/app/MenuBar.tsx:80` の「共有・提出用に保存…」と `onSafeOutput`
- 画面: `src/app/SafeOutputDialog.tsx`
- `src/App.tsx`: `SafeOutputDialog` の import（13行）、`safeOutputOpen`（255行）、`saveSafeOutput`（837行付近）、ダイアログの描画（1664行）、`onSafeOutput`（1576行）
- `src/core/safeOutput.ts`（`createSafeOutput`、`SafeOutputOptions`、`RedactionRegion`、JPEG付帯情報の除去など）
- `src/core/output.ts` の `safe` 引数と `createSafeOutput` の呼出し（6・21・36行）
- `src/worker/protocol.ts:188` の `safe`、`src/worker/pdf.worker.ts:531` の `request.safe`
- `src/client/PdfWorkerPool.ts:565` の `prepareOutput` の `safe` 引数
- 試験: `tests/businessOutput.integration.test.ts`（81・137・164行の各試験、96・117行の試験のうち共有用出力の部分）、`tests/improvements.integration.test.ts`（46・59・77行の試験のうち共有用出力の部分）、`e2e/businessCases.ts`（165行の確認、302行付近の「共有用墨消しは…」の試験）
- ヘルプ: `src/app/HelpDialog.tsx:31`

### 残すもの（他の機能が使っている）

- `src/core/textExtract.ts` の `extractTextLines` と、その型。`src/core/textCorrection.ts`（本文文字の修正）、`src/core/textSelection.ts`、`e2e/businessCases.ts`、`tests/textCorrection.integration.test.ts` が使っている。
- `src/core/textSelection.ts` の文字選択の処理と、選択用の StructuredText キャッシュ（20ページ）。
- `window.__karu.pageTextLines`、`pool.isIdle()`。
- `src/core/textCorrection.ts` の Redact 注釈の処理（本文文字の修正の一部。共有用の墨消しとは別）。
- `prepareOutput` の `bake` と `correction`。確定して別名で保存、印刷、通常の保存、本文文字の修正の出力。
- 電子署名・編集権限で出力を止める保護。確定・通常保存・本文修正に対する既存の判定は変えない。

## 対象

- 作業フォルダ: `C:\Users\gibbo\.codex\worktrees\dda9\PDF編集アプリ`
- 変更してよいファイル: 上の「だけが使っているもの」に挙げたファイル、`src/app/TextCorrectionDialog.tsx`（`prepareOutput` の呼出しの引数を合わせるだけ）、`src/core/textExtract.ts`（抽出出力にしか使わない関数・定数があれば削除）、`tests/textExtractFixtures.ts`（使われなくなる場合だけ）
- 削除してよいファイル: `src/app/TextExportDialog.tsx`、`src/app/textExport.ts`、`src/app/SafeOutputDialog.tsx`、`src/core/safeOutput.ts`、`tests/textExport.test.ts`、`e2e/text-extract.annotate.spec.ts`、`scripts/eizen-text-validation.mjs`
- 変更しないファイル: 上記以外。特に `package.json`、`package-lock.json`、`vite.config.ts`、`playwright.config.ts`、`scripts/audit-allowlist.json`、`docs/`、`test-data/`、`bench-results/`、`dist*/`、`release/`、`work/`

## 事前確認

- `rg -n "extractPageText|pageTextExtracted|cancelTextExtraction|TextExport|textExport|extractPage\(|safeOutput|SafeOutput|createSafeOutput|onExtractText|onSafeOutput|図面内文字|共有・提出用|墨消し|textExtraction" src tests e2e scripts` で参照を洗い出し、上の一覧に漏れがないか確かめる。漏れがあれば、他の機能が使っているかを確かめてから扱いを決め、報告する。
- `tests/businessOutput.integration.test.ts` と `tests/improvements.integration.test.ts` の該当試験を読み、共有用出力だけを確かめる試験と、確定・通常保存・署名保護も確かめている試験を見分ける。

## 変更内容

1. メニューから「共有・提出用に保存…」と「図面内文字を抽出…」を削除し、`MenuBar` の props から `onSafeOutput` と `onExtractText` を削除する。
2. `src/App.tsx` から、上に挙げた2機能の状態・処理・描画を削除する。他の機能の処理（`prepareOutput(bake)`、確定、印刷、本文修正、`window.__karu` の他の関数）は変えない。
3. 「図面内文字を抽出」の専用処理を削除する: `TextExportDialog.tsx`、`textExport.ts`、`PdfWorkerPool.extractPageText`、Worker の `extractPageText` と `cancelTextExtraction`、protocol の該当型、`TextSelection.extractPage()` と出力キャッシュ。`extractTextLines` は残す。
4. 「共有・提出用に保存」の専用処理を削除する: `SafeOutputDialog.tsx`、`core/safeOutput.ts`、`prepareDocumentOutput` の `safe` 引数、protocol の `safe`、Worker の `request.safe`、`PdfWorkerPool.prepareOutput` の `safe` 引数。`prepareOutput` の引数は `(docId, edits, bake, correction?)` にし、呼出し側（`App.tsx`、`TextCorrectionDialog.tsx`）を合わせる。
5. ヘルプ（`HelpDialog.tsx`）から2機能の説明を削除する。他の説明は変えない。
6. 試験を合わせる:
   - 2機能だけを確かめる試験・ファイルは削除する。
   - 2機能と他の機能を一緒に確かめている試験は、2機能の部分だけを削除し、他の機能の確認（確定保存・通常保存・署名保護・編集権限・注釈反映エラーの巻き戻しなど）は残す。必要なら、共有用出力で確かめていた保護を、確定保存（`bake: true`）の出力で確かめる形に置き換える。
   - `tests/textExtract.test.ts` は、`extractPage()` と出力キャッシュの試験を削除する。`extractTextLines` の性質（Font参照の解放、補助平面文字、縦書き、CropBox・UserUnit・回転の座標、コピー不可PDFの扱いなど）を確かめている試験は、`extractTextLines` を直接呼ぶ形に書き換えて残す。
   - `e2e/businessCases.ts` の「共有・提出用に保存」の無効表示の確認（165行）は削除する。同じ試験の他の確認は残す。
7. `scripts/eizen-bench.mjs` から `--text-extraction` とその分岐を削除する。既存の計時・指標・試行順・出力形式、空回し（`--no-browser-warmup`）は変えない。`scripts/eizen-text-validation.mjs` は削除する。

## 禁止事項

- 元データ（`test-data/`、`bench-results/`、`dist*/`、`release/`、`work/`）を変更しないこと
- 「残すもの」に挙げた処理・保護を変えないこと。指示していない仕様変更・リファクタを行わないこと
- 関数名・変数名・入力項目名を勝手に変更しないこと（削除する機能のものを除く）
- 依存関係を追加・削除しないこと
- **テスト・ビルド・型検査・ブラウザーを実行しないこと**（実行と結果確認は Claude Code 側で行う。CLIのサンドボックスでは実行できない）。構文の確認が必要なら、変更したファイルを目で読み直す
- git 操作をしないこと

## 検証項目（Claude Code 側で実施）

- [ ] `npx tsc --noEmit` が通る
- [ ] `npm test`（単体試験の全件）が通る
- [ ] `npm run build` が通り、その後の通常版の画面試験（`--project=e2e`）が通る
- [ ] メニューに2つの項目がない。本文文字の修正（`e2e/text-correction.annotate.spec.ts`）、確定保存・印刷・通常保存の試験が通る
- [ ] 上の `rg` で、削除した機能への参照が残っていない（`extractTextLines` と本文修正の Redact を除く）

## 報告してほしいこと

- 削除・変更したファイル一覧
- 削除した関数・型・試験と、残した関数・試験の一覧（判断に迷ったものは理由も）
- 書き換えた試験（何を何で確かめる形にしたか）
- SPEC から逸脱した箇所があれば、その内容と理由
- 残課題
