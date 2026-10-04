# SPEC-04g: 「本文文字の修正」を外す

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 画面・出力処理・Worker・試験の複数ファイルにまたがる削除で、文字の選択や確定保存と共有している部分を見分ける判断が要るため（判定表「複数ファイルにまたがる改修」「仕様に判断の余地が残っている作業」）

> Codex デスクトップアプリへ貼り付けて実行する場合は、モデルセレクタを上記に合わせてから貼り付けること。

---

## 目的

利用者から次の判断が出た（2026-10-04）。

> 図面データの修正自体はCAD等の別のソフトで行います。

これを受けて、本文文字の修正（文字を選んで「文字を修正…」、図面の文字を1行ずつ直したコピーを作る機能。訂正注釈で記録する代替を含む）を削除する、と利用者が決めた。メニュー・画面・専用の処理・専用の試験ごと取り除く。

他の機能（文字の選択、文字のコピー、文字への印（ハイライト・下線・取り消し線）、指摘、個数カウント、確定して別名で保存、印刷、通常の保存）は1つも変えない。

元に戻す必要が出た場合は Git の履歴から戻す。コードを残してメニューだけ隠す方式にはしない。

## 確かめたこと（2026-10-04、現在のコード）

### 「本文文字の修正」だけが使っているもの

- 入口: `src/editor/AnnotationLayer.tsx:977-978` の「文字を修正…」ボタン（文字を選択したときの小さな操作欄）と、`karu-pdf:text-correction` のイベント。
- 画面: `src/app/TextCorrectionDialog.tsx`（「訂正注釈で記録」を含む）。
- `src/App.tsx`: `TextCorrectionDialog` の遅延読込（61行）、`textCorrection` の状態（252行）、`karu-pdf:text-correction` の受け取り（904-910行付近）、画面の描画（1700-1704行付近）。
- 処理: `src/core/textCorrection.ts`（`TextCorrection`、`applyTextCorrection`。一時的な Redact 注釈を使う）。
- 出力: `src/core/output.ts` の `correction` 引数（7・20・28・33・35行）、`src/worker/protocol.ts:174` の `correction`、`src/worker/pdf.worker.ts:522-524` の `request.correction` と、そのための BIZ UDゴシックの読込、`src/client/PdfWorkerPool.ts:545-547` の `prepareOutput` の `correction` 引数。
- 試験: `tests/textCorrection.integration.test.ts`、`e2e/text-correction.annotate.spec.ts`、`e2e/businessCases.ts:237` の「試用版の本文修正コピーと個数カウントを配布形態ごとに保存できる」の本文修正の部分（243行の `karu-pdf:text-correction` など）。
- ヘルプ: `src/app/HelpDialog.tsx:48`。

### 残すもの（他の機能が使っている）

- `src/core/textExtract.ts` の `extractTextLines` と型（`src/core/textSelection.ts` が使う）。
- 文字の選択・コピー・文字への印と、その操作欄の他のボタン。
- フォント（BIZ UDゴシックなど）の読込のうち、指摘の番号・文字・吹き出しなど他の書き込みが使うもの。
- `prepareOutput` の `bake`（確定して別名で保存、印刷、通常の保存）。
- 電子署名・編集権限で出力を止める保護（`assertEditablePdf`）。
- `e2e/businessCases.ts:237` の試験のうち、個数カウントを配布形態ごとに保存する部分。

## 対象

- 作業フォルダ: `C:\Users\gibbo\.codex\worktrees\dda9\PDF編集アプリ`
- 変更してよいファイル: 上の「だけが使っているもの」に挙げたファイル、`e2e/` の配布形態別の試験（`fixed-*.spec.ts`、`single-*.spec.ts`）で本文修正を確かめている部分
- 削除してよいファイル: `src/app/TextCorrectionDialog.tsx`、`src/core/textCorrection.ts`、`tests/textCorrection.integration.test.ts`、`e2e/text-correction.annotate.spec.ts`
- 変更しないファイル: 上記以外。特に `package.json`、`package-lock.json`、`vite.config.ts`、`playwright.config.ts`、`scripts/`、`docs/`、`test-data/`、`bench-results/`、`dist*/`、`release/`、`work/`

## 事前確認

- `rg -n "textCorrection|TextCorrection|text-correction|applyTextCorrection|correction|文字を修正|訂正注釈|_文字修正|本文修正" src tests e2e` で参照を洗い出し、上の一覧に漏れがないか確かめる。`src/core/measure.ts` の `correction`（用紙の補正）は別物なので触らない。
- `e2e/businessCases.ts` と配布形態別の試験で、本文修正と他の機能を一緒に確かめている試験を見分ける。

## 変更内容

1. 文字の選択の操作欄から「文字を修正…」を削除し、`karu-pdf:text-correction` のイベントを送る処理・受け取る処理を削除する。
2. `src/App.tsx` から、本文修正の状態・処理・描画を削除する。
3. `TextCorrectionDialog.tsx` と `core/textCorrection.ts` を削除する。
4. 出力処理から `correction` を削除する。`prepareDocumentOutput(source, edits, fontResources, bake)`、`PdfWorkerPool.prepareOutput(docId, edits, bake)` にし、protocol と Worker を合わせる。保存の方式は `bake` のときだけ `'full'`、それ以外は `'incremental'` にする（従来の `bake || correction` から `correction` を除く）。編集権限の確認は `bake || edits.length` のときに行う（従来から `correction` を除く）。
5. Worker の、本文修正のためだけの BIZ UDゴシックの読込（`if (request.correction) ...`）を削除する。他の書き込みのためのフォントの読込は変えない。
6. ヘルプから本文修正の説明を削除する。他の説明は変えない。
7. 試験を合わせる:
   - 本文修正だけを確かめる試験・ファイルは削除する。
   - 本文修正と他の機能を一緒に確かめている試験は、本文修正の部分だけを削除し、他の機能（個数カウントを配布形態ごとに保存する、など）の確認は残す。試験名も内容に合わせて直す。
   - 使われなくなった import（例: `e2e/businessCases.ts` の `extractTextLines`）は削除する。

## 禁止事項

- 元データ（`test-data/`、`bench-results/`、`dist*/`、`release/`、`work/`）を変更しないこと
- 「残すもの」に挙げた処理・保護を変えないこと。指示していない仕様変更・リファクタを行わないこと
- 関数名・変数名・入力項目名を勝手に変更しないこと（削除する機能のものを除く）
- 依存関係を追加・削除しないこと
- **テスト・ビルド・型検査・ブラウザーを実行しないこと**（Claude Code 側で行う）
- **python は使えない（この環境に入っていない）。ファイルの編集は apply_patch で行い、スクリプトによる一括書き換えをしないこと**
- git 操作をしないこと

## 検証項目（Claude Code 側で実施）

- [ ] `npx tsc --noEmit` が通る
- [ ] `npm test`（単体試験の全件）が通る
- [ ] `npm run build` の後、通常版の画面試験の全件が通る
- [ ] 文字を選択したときの操作欄に「文字を修正…」がなく、文字のコピー・文字への印は従来どおり使える
- [ ] 上の `rg` で、削除した機能への参照が残っていない

## 報告してほしいこと

- 削除・変更したファイル一覧
- 削除した関数・型・試験と、残した関数・試験の一覧（判断に迷ったものは理由も）
- 書き換えた試験（何を何で確かめる形にしたか）
- SPEC から逸脱した箇所があれば、その内容と理由
- 残課題
