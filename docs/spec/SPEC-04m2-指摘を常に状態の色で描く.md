# SPEC-04m 追補: 図面上の指摘を常に状態の色で描き、保存時に古い色の外観を描き直す

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 描画の除外（PDF の描画と重ね描きの分担）と保存の編集の組み立てにまたがる改修のため（判定表「既存アプリの中核ロジック改修」）

> Codex デスクトップアプリへ貼り付けて実行する場合は、モデルセレクタを上記に合わせてから貼り付けること。

---

## 前提

SPEC-04m（`docs/spec/SPEC-04m-指摘の状態3種類と詳細のその場編集と器具画面の移動.md`）の実装が、作業ツリーにコミットせずに入っている。指摘の状態は3種類（未回答・回答済み・修正確認）で、色は `issueColor`（`src/core/issues.ts`）が状態だけで決める（赤・青・灰）。保存済みの旧い値（`revised`・`done`）は回答済みとして表示する。

## 問題（Claude Code が画面試験で確認したこと）

- 図面上の指摘の印は、編集した（`touched`）ものだけを重ね描き（`src/editor/AnnotationLayer.tsx` の `annotation-issue`）で描き、それ以外は PDF に保存された外観（AP）で描いている。個数カウントの印は、`AnnotationStore.countOverlayObjNums` で PDF の描画から除いて、常に重ね描きしている。
- そのため、旧い版で保存した指摘は、一覧では「回答済み（青）」なのに、図面上は保存時の外観の色のまま（旧版の対応済は灰色とチェック、1.2.0 で回答済み・修正済にしたものは赤）で描かれる。保存し直しても、その指摘を編集しない限り外観は変わらない。
- SPEC-04m の画面試験 `e2e/cloud-issues.annotate.spec.ts` の「3状態の選択肢・色を一覧、書式、SVG、保存PDFの外観でそろえる」（保存して開き直した後）と「旧対応済・修正済は青の回答済みで開き、保存値と未保存表示を変えない」は、開き直した指摘の重ね描き（`.annotation-issue circle`）を探して失敗している。

## 対象

- 作業フォルダ: `C:\Users\gibbo\.codex\worktrees\dda9\PDF編集アプリ`
- 変更してよいファイル: `src/editor/AnnotationStore.ts`、`src/editor/AnnotationLayer.tsx`、`src/viewer/PageView.tsx`、`src/viewer/Viewer.tsx`、`tests/`（新しい試験ファイル、または指摘の試験）、`e2e/cloud-issues.annotate.spec.ts`
- 変更しないファイル: 上記以外。**別の作業（SPEC-04n）が同時に `src/core/pageOps.ts`、`src/core/countFixtures.ts`、`src/app/`、`src/App.tsx`、`src/worker/`、`e2e/organize.annotate.spec.ts` などを変更している。これらには触れないこと。**

## 変更内容

1. 図面上の指摘を常に重ね描きする。
   - `AnnotationStore` に、そのページの指摘（旧版の変更記録を除く、削除していない、`objNum` のある指摘）の番号を返す関数（例: `issueOverlayObjNums(pageIndex)`）を作る。
   - PDF の描画から除く番号（`excludeAnnotObjNums`）に、個数カウントの印と同じく指摘も加える（`src/viewer/PageView.tsx` と `src/viewer/Viewer.tsx` の、`touchedObjNums` と `countOverlayObjNums` を合わせている箇所）。
   - `AnnotationLayer` で、指摘は `touched` でなくても重ね描きする（今の `visible` の条件に指摘を加える）。色は `issueColor` で状態の色になる。
   - 編集制限のある文書（`readOnly` で描画から何も除かない場合）は今と同じく保存済みの外観で描き、重ね描きしない（二重に描かない）。
2. 保存時に、色が状態と合わない指摘の外観を描き直す。
   - `AnnotationStore.toEdits()` で、文書に変更がある（`isDirty()`）ときだけ、読み込み済みの指摘のうち、色（`annotation.color`。PDF の `/C` から読んだもの）が `issueColor` の状態の色と違うものの色を状態の色にして、保存の編集（`updateIssue`）に含める。保存では `/C` と外観が状態の色になる。旧形式の個数カウントの移し替え（同じ `toEdits()` の `legacyCountObjects` の処理）と同じ考え方で、開いただけでは文書を変更済みにしない。
   - 新しく置く指摘や、状態を変えた指摘も、保存する色を状態の色にする（`/C` と外観をそろえる）。
3. 1 と 2 で、通常の読込・表示に重い処理を足さないこと（指摘の数に比例する軽い処理だけ）。

## 試験

- 単体試験（`tests/`）:
  - 文書に変更がないときの `toEdits()` は、色の古い指摘があっても編集を出さない。変更があるときは、色の古い指摘の `updateIssue` を状態の色で出す。保存（`markApplied`）の後は変更なしに戻る。
  - `issueOverlayObjNums` が、変更記録・削除済み・未保存（`objNum` なし）の指摘を除いて番号を返す。
- 画面試験（`e2e/cloud-issues.annotate.spec.ts`）:
  - SPEC-04m で追加した上記2つの試験が通ること（開き直した指摘・旧い値の指摘も重ね描きで状態の色になる）。
  - 旧い値の指摘を含む PDF を開き、別の書き込みを1つ加えて保存すると、保存した PDF（Node 側の MuPDF で確かめる）の旧い指摘の外観の色が青になっている。開いて何もせずに閉じる場合は未保存の印が付かない。
- 既存の試験（特に `e2e/review-load.annotate.spec.ts` の「1000指摘の一覧…」）が通ること。

## 禁止事項

- 元データ（`test-data/`、`bench-results/`、`dist*/`、`release/`、`work/`）を変更しないこと
- 「対象」に挙げていないファイルを変更しないこと（特に、同時に作業している SPEC-04n のファイル）
- 指摘以外の書き込みの描き方・保存を変えないこと
- 開いただけで文書を変更済みにしないこと
- 指示していない仕様変更・リファクタを行わないこと
- 依存関係を追加しないこと
- **テスト・ビルド・型検査・ブラウザーを実行しないこと**（Claude Code 側で行う）
- **python は使えない（この環境に入っていない）。ファイルの編集は apply_patch で行い、スクリプトによる一括書き換えをしないこと**
- git 操作をしないこと

## 報告してほしいこと

- 変更したファイル一覧
- 描画から除く指摘の決め方と、編集制限のある文書での扱い
- 保存時に描き直す指摘の決め方
- SPEC から逸脱した箇所があれば、その内容と理由
