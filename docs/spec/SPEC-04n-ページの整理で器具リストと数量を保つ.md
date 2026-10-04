# SPEC-04n: ページの整理（並べ替え・削除・追加）で器具リストと数量を保つ

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: PDF の構造（カタログ）の保全と、Worker・画面の再読込にまたがる、データ消失の不具合の修正のため（判定表「既存アプリの中核ロジック改修」）

> Codex デスクトップアプリへ貼り付けて実行する場合は、モデルセレクタを上記に合わせてから貼り付けること。

---

## 目的

利用者の報告（2026-10-04、試用版 1.2.0）:

> ページタブの「ページを整理」で図面の並び替えや削除、追加を行うと、個数カウントタブから作成した器具リストや拾った器具の数量が全てリセットされる。図面を編集しても、個数を拾った図面を削除しない限りは数量や器具リストの情報が保持されるようにしたい。

## 原因（Claude Code が確認したこと）

1. **PDF から器具リストが消える。** ページの整理は Worker で `applyPageLayout`（`src/core/pageOps.ts`）を呼び、MuPDF の `rearrangePages` でページを組み替える。MuPDF 1.28.1 の `rearrangePages` は文書のカタログ（`Root`）を作り直し、`Type`・`Pages`（と MuPDF 自身が整える `Outlines`・`OCProperties`・`Dests`）以外の項目を落とす。Claude Code の確認（`work/check-organize-catalog-keys.mjs`、`work/check-organize-keeps-counts.mjs`）:
   - 前: `Info, KaruCountFixtures, KaruHeaderFooter, Lang, PageLayout, Pages, Type, ViewerPreferences`
   - 後: `Pages, Type`（増分保存して開き直しても同じ）
   - 残したページの印の `KaruCount` は残る。削除したページの印は消える（これは正しい）。
   - そのため、器具リスト（`KaruCountFixtures`）とヘッダー・フッターの設定（`KaruHeaderFooter`）が消え、残った印も参照先の器具がなくなる。`applyPageLayout` はフォーム（`AcroForm`）だけを、組み替えの前に控えて後で戻している（`existingAcroForm`・`rebuildAcroFormFields`）。
2. **画面が読み直さない。** 整理の適用後（と整理の取消し、ヘッダー・フッターの適用・削除の後）、`finishPageLayout`（`src/App.tsx`）→ `DocumentSession.updateAfterPageLayout`（`src/app/documentModel.ts`）が `annotationStore.reset(true)` で書き込みと器具リストを空にし、未読込に戻す。器具タブ（`src/app/FixturePanel.tsx`）と書き込みタブ（`src/app/AnnotationListPanel.tsx`）の読込の `useEffect` は `[session, pool]` が変わらないので動かず、器具リストと一覧が空のままになる。
3. **抽出・分割で作るPDFにも器具リストが入らない。** `extractPages`・`splitPages` は新しい文書へ `graftPage` するだけで、カタログの器具リストを写さない。
4. **他のPDFから追加したページの印。** 他の文書から `graftPage` で追加したページの印は、元の文書の器具リストの器具（id）を参照するが、この文書の器具リストにはその器具がない。

## 対象

- 作業フォルダ: `C:\Users\gibbo\.codex\worktrees\dda9\PDF編集アプリ`
- 変更してよいファイル: `src/core/pageOps.ts`、`src/core/countFixtures.ts`（読み書きの補助関数が要る場合だけ）、`src/app/documentModel.ts`（`updateAfterPageLayout` まわりだけ）、`src/App.tsx`（`finishPageLayout` まわりだけ）、`src/app/FixturePanel.tsx`・`src/app/AnnotationListPanel.tsx`（読込の `useEffect` の条件だけ）、`src/worker/pdf.worker.ts`（必要な場合だけ）、`tests/`、`e2e/`
- 変更しないファイル: 上記以外。特に `src/core/annotations.ts`、`src/editor/`
- **並行作業の注意:** 別の作業（SPEC-04m 追補）が同時に `src/editor/AnnotationStore.ts`、`src/editor/AnnotationLayer.tsx`、`src/viewer/PageView.tsx`、`src/viewer/Viewer.tsx`、`e2e/cloud-issues.annotate.spec.ts` を変更している。これらには触れないこと。また、作業ツリーには SPEC-04m の未コミットの変更（`src/app/AnnotationListPanel.tsx`、`src/core/issues.ts` など）が入っている。`AnnotationListPanel.tsx` は読込の `useEffect` の条件だけを変え、SPEC-04m の変更を消さないこと。

## 変更内容

1. `applyPageLayout` で、`rearrangePages` が落とすカタログの項目を、組み替えの前に控えて後で戻す（`AcroForm` の今の扱いと同じ考え方）。
   - 戻す項目: 名前が `Karu` で始まるすべての項目（器具リスト `KaruCountFixtures`、ヘッダー・フッターの設定 `KaruHeaderFooter` など）と、ページに依存しない標準の項目 `Lang`・`ViewerPreferences`・`PageLayout`・`PageMode`・`MarkInfo`・`Metadata`・`OutputIntents`・`Extensions`・`Version`。
   - 戻さない項目（ページを指すため、並べ替え・削除の後に戻すと壊れた参照や誤ったページ番号になる）: `PageLabels`・`OpenAction`・`Names`・`StructTreeRoot`・`AA` など。`Outlines`・`OCProperties`・`Dests` は MuPDF が整えて残すので、上書きしない。`AcroForm` は今の処理のまま。
   - 組み替えの後で `Root` が別のオブジェクトに変わっていても、新しい `Root` に入れる。
2. 他の文書からページを追加したときは、追加したページの印（`KaruCount` の新形式 `{version:2, fixtureId}`）が参照する器具のうち、この文書の器具リストにないものを、追加元の文書の器具リストから写して加える。
   - この文書の器具リストにすでにある id は、この文書のものを残す（上書きしない）。
   - 加えた結果が器具リストの上限（1,000件・4MiB）を超えるときは、整理を中止してエラーにする（文書は整理の前のまま。今の `pdfOperation` の取消しで戻る）。メッセージは「追加するページの器具を合わせると、器具リストの上限を超えます。」など。
   - 旧形式の印（`{version:1, group}`）は、器具タブを開いたときに今の仕組みで器具へ移るので、何もしない。
3. `extractPages`（抽出・分割の出力）で、出力するページの印が参照する器具を、ページの元の文書の器具リストから集めて、出力の文書の器具リストとして書く。参照がなければ書かない。
4. 画面の読み直し: ページの組み替えなどで書き込みを空にした後、器具リストを読んでいた文書（`fixturesReady` だった文書）は、器具リストとすべてのページの書き込みを読み直す（`ensureSessionFixtures`）。器具タブと書き込みタブを開いたままでも、整理の後に器具リスト・個数・一覧が戻ること。
   - 例: 器具タブ・書き込みタブの読込の `useEffect` の条件に `session.pageRevision`（`updateAfterPageLayout` で増える）を加える。`updateAfterPageLayout` の前に器具リストを読んでいたかを覚えておき、`finishPageLayout` の後で `ensureSessionFixtures` を呼ぶ。
   - 選択中の器具・器具ごとの表示/非表示は、今と同じく整理の後も保つ（`reset(true)`）。
5. 整理の取消し（「直前のページ操作を元に戻す」）は、今の控え（整理の前の増分保存）から戻すので、器具リストも戻る。画面の読み直しは 4 と同じ。

## 試験

- 単体試験（`tests/`、`tests/pageLayout.integration.test.ts` などの書き方に合わせる）:
  - 器具リスト・ヘッダーフッターの設定・`Lang`・`ViewerPreferences`・`PageLayout` を持ち、3ページに個数の印がある PDF で、並べ替え・1ページ削除・白紙の追加を `applyPageLayout` で行う。増分保存して開き直すと、器具リストと設定と標準の項目が残り、残したページの印は `KaruCount` を保ち、削除したページの印だけが消えている。`PageLabels` は戻していない。
  - 他の文書から、その文書の器具を参照する印のあるページを追加すると、この文書の器具リストに足りない器具が加わる。同じ id の器具はこの文書のものが残る。
  - 上限を超える場合はエラーになり、文書は整理の前のまま。
  - `extractPages`・`splitPages` の出力に、出力するページの印が参照する器具だけが器具リストとして入る。
- 画面試験（`e2e/`、`e2e/organize.annotate.spec.ts` などの書き方に合わせる）:
  - 器具を2つ作り、3ページに印を置く（保存しない）。器具タブを開いたまま「ページを整理」で並べ替え・1ページ削除・白紙の追加を適用すると、器具リストは同じで、全図面の個数は削除したページの分だけ減り、表示中の図面の個数はページの移動に合わせて変わる。書き込みタブの一覧も空にならない。
  - そのまま保存して開き直しても、器具リストと個数が残る。
  - 「直前のページ操作を元に戻す」で、整理の前の個数に戻る。
  - ヘッダー・フッターの設定が整理の後も残る（既存の試験があれば、それに確認を足す）。
- 既存の単体試験・画面試験がすべて通ること。

## 禁止事項

- 元データ（`test-data/`、`bench-results/`、`dist*/`、`release/`、`work/`）を変更しないこと
- 「対象」に挙げていないファイルを変更しないこと
- 整理・抽出・分割の結果のページの並び・内容・回転・フォームの扱いを変えないこと
- 通常の読込に処理を足さないこと
- 指示していない仕様変更・リファクタを行わないこと
- 依存関係を追加しないこと
- **テスト・ビルド・型検査・ブラウザーを実行しないこと**（Claude Code 側で行う）
- **python は使えない（この環境に入っていない）。ファイルの編集は apply_patch で行い、スクリプトによる一括書き換えをしないこと**
- git 操作をしないこと

## 検証項目（Claude Code 側で実施）

- [ ] `npx tsc --noEmit` が通る
- [ ] `npm test`（単体試験の全件）が通る
- [ ] `npm run build` の後、追加した画面試験と、ページの整理・ヘッダーフッター・器具リストに関係する既存の画面試験、通常版の画面試験の全件が通る
- [ ] 実際の図面（`test-data/shichigahama-drawing.pdf`）で、印を拾ってからページを整理し、器具リストと個数が残ることを画面で確かめる

## 報告してほしいこと

- 変更したファイル一覧
- 控えて戻したカタログの項目と、戻さなかった項目
- 他の文書から追加したページの器具の扱い
- SPEC から逸脱した箇所があれば、その内容と理由
- 残課題
