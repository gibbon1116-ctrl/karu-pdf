# SPEC-04i: 多数の注釈を一度に更新する保存を速くする

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: すべての書き込みの保存が通る中核の処理（`applyEdits`）で、MuPDF のオブジェクトの寿命管理を変える性能改修のため（判定表「既存アプリの中核ロジック改修」「原因不明のバグ調査…」に準じる判断の重さ）

> Codex デスクトップアプリへ貼り付けて実行する場合は、モデルセレクタを上記に合わせてから貼り付けること。

---

## 目的

SPEC-04d（器具リストで数える個数カウント）の画面試験「100種類・5000個の印は描画をまとめ、集計・選択・スクロール・保存を維持する」（`e2e/review-load.annotate.spec.ts:24`）が、保存の段階で2分の制限を超えた。旧形式の印5,000個を新形式へ移す保存と、器具の書式を変えた後の保存で、多数の注釈を一度に更新するためである。

Claude Code が調べた原因: `src/core/annotations.ts` の `applyEdits` は、注釈を更新する編集ごとに `findAnnotation(page, objNum)`（462行）を呼ぶ。`findAnnotation` は毎回 `page.getAnnotations()` でページ上の**全注釈**の参照を作り、目的の1件以外を破棄する。5,000件の注釈があるページで5,000件を更新すると、約2,500万回の参照の作成と破棄になる。また、編集ごとに `doc.loadPage(edit.pageIndex)` でページを読み直している。

1回の `applyEdits` の中で、ページと注釈の参照をページごとに1度だけ作って使い回し、最後にまとめて解放する。保存の結果（PDF の内容）は変えない。

## 確かめたこと（2026-10-04、現在のコード）

- `applyEdits(doc, edits, fontResources)`（`src/core/annotations.ts:1377`）は、編集ごとに `page = doc.loadPage(edit.pageIndex)` を行い、更新・削除では `findAnnotation(page, objNum)` で注釈を探す（1414・1424・1448・1484・1494・1506・1519・1531・1543・1555・1597行など）。
- 外観を作る注釈は `keepForAppearance` で残し、`appearances`（`AppearanceTask[]`。`page` と `annotation` を持つ）に積み、最後に `installTemporaryAppearances` でまとめて外観を入れる。それ以外は各編集の `finally` で `annotation` と `page` を破棄している。
- 削除は `edit.kind === 'delete'`（1483行付近）。
- 個数カウントの外観は、同じ書式の印でテンプレートを共有している（`installTemporaryAppearances` の `countTemplates`、1315行付近）。

## 対象

- 作業フォルダ: `C:\Users\gibbo\.codex\worktrees\dda9\PDF編集アプリ`
- 変更してよいファイル: `src/core/annotations.ts`（`applyEdits` と `findAnnotation`、それに伴う後始末だけ）、`tests/`（下の試験の追加）
- 変更しないファイル: 上記以外。特に `e2e/`、`src/app/`、`src/editor/`、`src/worker/`、`src/client/`

## 変更内容

1. `applyEdits` の中に、その呼出しの間だけ使うキャッシュを作る。
   - ページ: `pageIndex` → `PDFPage`。同じページの編集では、同じ `PDFPage` を使い回す。
   - 注釈の索引: `pageIndex` → (`objNum` → `PDFAnnotation`)。あるページで最初に既存の注釈を探すときに `page.getAnnotations()` を**1回だけ**呼んで作る。以後の検索はこの索引から引く。
2. 注釈の更新・削除の各処理は、`findAnnotation(page, objNum)` の代わりに索引から引く関数（例: `lookupAnnotation(pageIndex, objNum)`）を使う。見つからないときの扱い（エラーの文言・`errors` への記録）は今と同じにする。
3. 削除した注釈は索引から外す。同じ呼出しの中で新しく作った注釈（`createAnnotation`）は、今と同じ扱いでよい（索引に入れなくてよい）。
4. 寿命の管理: 索引とページのキャッシュが持つ `PDFPage`・`PDFAnnotation` は、各編集の `finally` では破棄しない。`installTemporaryAppearances` が終わった後（エラーで途中終了した場合も含めて）に、`try/finally` でまとめて破棄する。各編集で新しく作った注釈で、外観に使わないものは、今どおり各編集の `finally` で破棄する。二重に破棄しないこと。
5. 外観の処理（`AppearanceTask` の `page`・`annotation`）が、キャッシュの参照を使っても正しく動くようにする（破棄の順序に注意する）。
6. 1件の編集の失敗が他の編集に影響しない今の動き（`errors` に記録して続ける。巻き戻しは呼出し側）を変えない。

## 試験

- `tests/` に次を追加する。
  - 1ページに注釈 2,000件を持つPDFで、そのうち 2,000件すべてを更新する編集（例: 位置の変更）を `applyEdits` に渡すと、正しく反映され、`page.getAnnotations()` の呼出しが**ページあたり1回**であることを確かめる（`PDFPage.prototype.getAnnotations` を数える、または同等の方法）。
  - 同じ呼出しの中で、更新・削除・新規作成が混ざっていても、結果が今と同じになることを確かめる（作成された注釈の `created`、削除された注釈が消えていること、外観が入っていること）。
  - 存在しない `objNum` の更新は、今と同じ文言で `errors` に記録され、他の編集は反映されること。
- 既存の単体試験・統合試験（`tests/annotations*.test.ts`、`tests/*integration*.test.ts` など）が今のまま通るようにする。

## 禁止事項

- 元データ（`test-data/`、`bench-results/`、`dist*/`、`release/`、`work/`）を変更しないこと
- 「対象」に挙げていないファイルを変更しないこと
- 保存の結果（PDF に書く内容・外観・順序）を変えないこと。指示していない仕様変更・リファクタを行わないこと
- 依存関係を追加しないこと
- **テスト・ビルド・型検査・ブラウザーを実行しないこと**（Claude Code 側で行う）
- **python は使えない（この環境に入っていない）。ファイルの編集は apply_patch で行い、スクリプトによる一括書き換えをしないこと**
- git 操作をしないこと

## 検証項目（Claude Code 側で実施）

- [ ] `npx tsc --noEmit` が通る
- [ ] `npm test`（単体試験の全件）が通る
- [ ] `npm run build` の後、`e2e/review-load.annotate.spec.ts` が2分の制限内で通る
- [ ] `node work/measure-5000-save.mjs` で、5,000個の移行・1種類の書式変更・1個の追加の保存時間を、改修前の値と比べて記録する
- [ ] 通常版の画面試験の全件が通る

## 報告してほしいこと

- 変更したファイル一覧と、キャッシュ・索引の作り方と寿命の管理
- 追加した試験
- SPEC から逸脱した箇所があれば、その内容と理由
- 残課題（他にも件数の2乗で遅くなる箇所に気付いた場合は、場所と理由）
