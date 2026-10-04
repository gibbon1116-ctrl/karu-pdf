# SPEC-04j: 個数カウントと指摘の外観を setAppearance で入れ、多数の保存を速くする

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: すべての個数カウントと指摘の保存が通る外観の作成処理で、回転ページの向きの扱いを保ったまま MuPDF の呼び方を変える中核の性能改修のため（判定表「既存アプリの中核ロジック改修」）

> Codex デスクトップアプリへ貼り付けて実行する場合は、モデルセレクタを上記に合わせてから貼り付けること。

---

## 目的

器具リストで数える個数カウント（SPEC-04d）で、印を一度に多く更新する保存（旧形式の全件移行、印の多い器具の書式変更、多数の貼り付けなど）が極端に遅い。印1,000個の移行と書式変更でブラウザーでは約50秒、5,000個では25分を超えた（画面試験 `e2e/review-load.annotate.spec.ts:24` が2分の制限を超える）。

SPEC-04i で注釈の検索を索引化したが、遅さは変わらなかった。Claude Code が Node 上で計測した結果、主因は印ごとに呼んでいる MuPDF の `annotation.update()`（`pdf_update_annot`）で、1回の時間がページ上の注釈の数に比例して増える（件数の2乗で遅くなる）。

## 確かめたこと（2026-10-04、Claude Code の計測）

### 保存処理の内訳（Node、`applyEdits`、旧形式の印の移行と1器具の書式変更）

| 印の数 | `applyEdits` 全体 | うち `annotation.update()` |
|---:|---:|---:|
| 400 | 875ms | 652ms（500回） |
| 1,000 | 4,779ms | 4,329ms（1,100回） |

他の呼出し（`setRect`・`setColor`・`getObject`・`addStream` など）は合計でも数十ms。

### 外観の入れ方の比較（Node、`work/zz-profile-update.test.ts`・`work/zz-profile-update2.test.ts`）

既存の Stamp の位置・色・透明度を変えて自前の外観を入れ、**保存前に `page.update()` とページの描画**を行ってから保存し、開き直して自前の外観が残っているかを確かめた。

| 方式 | 既存500個 | 新規300個 | 2,000個（既存） | 描画後も自前の外観が残るか |
|---|---:|---:|---:|---|
| 現行: 設定 → `update()` → `AP` を直接差し替え | 1,009ms（2.0ms/個） | 890ms（3.0ms/個） | 14,857ms（7.4ms/個） | 残る |
| 設定 → `annotation.setAppearance(...)` | 13ms（0.026ms/個） | 6ms（0.018ms/個） | 62ms（0.031ms/個） | **既存・新規とも残る** |
| 辞書へ直接書込み（`Rect`・`C`・`CA`・`AP`、`update()` なし） | 20ms | 22ms | 79ms | 新規の印では**上書きされる**（使えない） |

`setAppearance`（`pdf_set_annot_appearance`）で外観を入れれば、`update()` は不要になり、件数に比例する時間で済む。

### 現在のコード

- 個数カウントの印: `applyEdits` の `createSymbol`/`updateSymbol` の `edit.countFixture` の分岐（`src/core/annotations.ts` の 1590〜1605行付近）で、`setRect`・`setColor`・`setOpacity` の後に `annotation.update()`（「Clear MuPDF's pending Stamp appearance before installing the shared custom AP」）を呼び、`appearances` に積む。
- 指摘の印: `createIssue`/`updateIssue` の分岐（1435〜1450行付近）でも、設定の後に `annotation.update()` を呼び、`appearances` に積む（`drawIssue`）。
- `installTemporaryAppearances`（1306行付近）が、一時文書で作った外観（個数カウントは同じ書式でテンプレートを共有）を元の文書へ写し（`graftMap.graftObject`）、向きを合わせ（`orientVisibleAppearance` または `orientAppearanceForAnnotation`）、`targetObject.put('AP', …)` で入れている。
- 四角・線・丸・手書き・文字・計測などは、MuPDF に外観を作らせるために `update()` を使っている（682〜814行付近など）。これらは今回変えない。

## 対象

- 作業フォルダ: `C:\Users\gibbo\.codex\worktrees\dda9\PDF編集アプリ`
- 変更してよいファイル: `src/core/annotations.ts`（個数カウントと指摘の外観の入れ方だけ）、`tests/`（下の試験の追加）
- 変更しないファイル: 上記以外。特に `e2e/`、`src/app/`、`src/editor/`、`src/worker/`、`src/client/`

## 変更内容

1. 個数カウントの印と指摘の印について、`applyEdits` の中の `annotation.update()` を呼ばないようにする。
2. `installTemporaryAppearances` で、個数カウントと指摘の外観を `targetObject.put('AP', …)` で直接入れる代わりに、`annotation.setAppearance('N', null, matrix, bbox, resources, contents)` で入れる。
   - `contents`: テンプレートの外観の内容（ストリームの文字列）。向きの補正が要る場合は、今の `orientVisibleAppearance`・`orientAppearanceForAnnotation` と同じ結果になるように、`matrix`・`bbox`（または内容の先頭の `cm`）で補正する。
   - `resources`: テンプレートの `Resources` を元の文書へ写したもの。同じテンプレートの印では同じ `Resources`（フォントのサブセットを含む）を共有し、印ごとに複製しない。
   - `bbox`・`matrix`: テンプレートの `BBox`・`Matrix`（と向きの補正）。
3. 保存結果の見た目（位置・大きさ・向き・色・透明度・略号や番号の文字）は今と同じにする。回転ページ（0・90・180・270度）と CropBox のずれのあるページでも同じにする。
4. 他の種類（四角・線・丸・手書き・文字・吹き出し・計測・雲・記号（個数カウントでないもの））の外観の作り方は変えない。
5. 使われなくなる処理（個数カウント・指摘のための `update()` の呼出しなど）は削除する。他の種類がまだ使う関数は残す。

## 試験

- `tests/` に次を追加する。
  - 印 2,000個の旧形式の個数カウントを持つPDFで、全件の移行と1器具の書式変更を `applyEdits` で行い、5秒以内に終わる。保存して開き直すと、すべての印が新形式で、外観が自前の形（例: 星）になっている。
  - 個数カウントの印と指摘の印を、新規作成・更新の両方で作り、**保存前に `page.update()` と描画**をしても自前の外観が残る（`AP` の内容が自前のものである）。
  - 回転 0・90・180・270度のページで、個数カウントの印と指摘の印の中心の画素が、印の色になっている（今の見た目と同じ位置に描かれている）。既存の回転の試験（`tests/businessOutput.integration.test.ts` など）の書き方に合わせる。
  - 1回の `applyEdits` の中での `annotation.update()` の呼出しが、個数カウント・指摘の印では0回である。
- 既存の単体試験・統合試験がすべて通るようにする。

## 禁止事項

- 元データ（`test-data/`、`bench-results/`、`dist*/`、`release/`、`work/`）を変更しないこと
- 「対象」に挙げていないファイルを変更しないこと
- 個数カウント・指摘以外の外観の作り方を変えないこと。保存結果の見た目を変えないこと
- 指示していない仕様変更・リファクタを行わないこと
- 依存関係を追加しないこと
- **テスト・ビルド・型検査・ブラウザーを実行しないこと**（Claude Code 側で行う）
- **python は使えない（この環境に入っていない）。ファイルの編集は apply_patch で行い、スクリプトによる一括書き換えをしないこと**
- git 操作をしないこと

## 検証項目（Claude Code 側で実施）

- [ ] `npx tsc --noEmit` が通る
- [ ] `npm test`（単体試験の全件）が通る
- [ ] `npm run build` の後、`e2e/review-load.annotate.spec.ts` が2分の制限内で通り、通常版の画面試験の全件が通る
- [ ] `node work/measure-5000-save.mjs dist 1000` と `… 5000` で、改修前（1,000個の移行と書式変更で約50秒）と比べた時間を記録する
- [ ] 保存したPDFを開き直した見た目（スクリーンショット）が改修前と同じ

## 報告してほしいこと

- 変更したファイル一覧と、外観の入れ方の変更点（向きの補正の扱い、Resources の共有のしかた）
- 追加した試験
- SPEC から逸脱した箇所があれば、その内容と理由
- 残課題（他の種類で同じように件数の2乗で遅くなる箇所があれば、場所と理由）
