# SPEC-01c-2: ページ整理の適用の速さと、フォームの保持

## 実行モデル指定（必須）

- モデル: `gpt-5.6-sol`
- reasoning effort: `high`
- 選定理由: SPEC-01c の続きで、同じスレッドでページ整理の中核を直すため

---

## 目的

SPEC-01c のレビューで、2つの問題が見つかった。これを直す。

1. **適用が遅い。** `heavy-300p.pdf`（300 ページ・100MB）で 10 ページを並べ替えて適用するのに、**12.8 秒**かかる（目標は 5 秒以内）。
   - 最適化の後も、Claude Code が `playwright.config.ts` の bench に `perf-organize` を加えて測り直したところ、12.8 秒だった。
2. **フォームが壊れる。** `rearrangePages` の後に `/AcroForm/Fields` が消える。入力欄の見た目（Widget）はページに残るが、他のソフトでは入力できなくなる。**利用者のデータが失われる不具合**である。

## 対象

- 変更してよいファイル: `src/core/pageOps.ts`、`src/worker/`、`src/client/PdfWorkerPool.ts`、`src/App.tsx`、`src/app/`、`src/organize/`、`tests/`、`e2e/`
- 変更しないファイル: `src/core/annotations.ts`、`textLayout.ts`、`save.ts`、`docs/`、`public/`、`LICENSE`、設定ファイル（`playwright.config.ts` は Claude Code が変更済み）

## 変更内容

1. **時間の内訳を測る**
   - 適用の各段階（未反映の書き込みの反映、控えの取得、ページの組み立て、`exportBytes`、表示用 Worker の読み込み直し、main thread の更新）の時間を `performance.now()` で測る。
   - `perf-organize` の結果に内訳として出す。
2. **遅い段階を直す**
   - 内訳を見て、時間のかかっている段階を直す。
   - 例えば、100MB のバイト列の保存やコピーを何度もしていないか、表示用 Worker に同じバイト列を順番に渡していないか（並列にできないか）、控えの取得で全体を書き出していないか、を確かめる。
   - 目標: 開発機で **5 秒以内**。
   - 5 秒に届かない場合は、段階ごとの下限（MuPDF の処理そのものにかかる時間）を示し、どこまで縮められたかを報告する。
3. **フォームの一覧を作り直す**（`src/core/pageOps.ts`）
   - `rearrangePages` の後、残っているページの Widget から、フィールドの最上位（`/Parent` を辿った先）を集める。それで `/AcroForm/Fields` を作り直す。
   - 削除したページにしかない Widget のフィールドは、一覧から除く。
   - `/AcroForm` のそのほかの項目（`/DR`、`/DA`、`/NeedAppearances` など）は保つ。
   - テスト: 入力欄を持つ試験用 PDF（テストの中で作ってよい）で、並べ替えと削除の後も `/AcroForm/Fields` に残ったページのフィールドがあり、MuPDF の `getWidgets()` で値を読めること。
4. **他の PDF から加えたページの制約**（graftPage では、しおり・リンク・フォームは移らない）を、使い方の画面で利用者に伝えられるよう、ページ整理の画面の「他のPDFを追加」の近くに、短い注記（ツールチップで可）として表示する。

## 禁止事項

- 対象外のファイルを変更しないこと。git の変更操作をしないこと。
- 計測の条件（ページ数、並べ替えるページ数、試験用 PDF）を変えないこと。
- 自分で起動したサーバーは必ず止め、一時ファイルは削除すること。

## 検証項目

- [ ] `npm run build`、`npm test`、`npm run e2e` がすべて成功する。
- [ ] `npx playwright test --project=bench perf-organize` を実行し、適用の時間と内訳を報告する（最大3回）。

## 報告してほしいこと

- 変更したファイルと要点
- 適用の時間の内訳（直す前と後）
- フォームの作り直しのテスト結果
- 逸脱と残課題
