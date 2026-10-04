# SPEC-04k: 保存のジャーナルを区切り、多数の印の保存を件数に比例する時間にする

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: すべての保存が通る編集の取消し（原子性）の仕組みを変える中核の改修で、失敗時に元へ戻す正しさの判断が要るため（判定表「既存アプリの中核ロジック改修」）

> Codex デスクトップアプリへ貼り付けて実行する場合は、モデルセレクタを上記に合わせてから貼り付けること。

---

## 目的

SPEC-04j で個数カウントと指摘の外観を `setAppearance` で入れるようにしたが、ブラウザーでの保存はまだ遅い。旧形式の印1,000個の移行と1器具の書式変更の保存が約12.6秒かかり、5,000個では画面試験 `e2e/review-load.annotate.spec.ts:24` が2分の制限を超える。

Claude Code の計測で、残りの主因は保存のときの MuPDF のジャーナル（失敗時に元へ戻すための変更記録）だと分かった。1回の操作（`beginOperation`〜`endOperation`）の中で変えるオブジェクトが多いと、件数の2乗で遅くなる。MuPDF はオブジェクトを変えるたびに、その操作で記録済みの変更の一覧を先頭から探すため、と推定している。

## 確かめたこと（2026-10-04、Claude Code の計測）

### ブラウザーでの内訳（`work/profile-save-path.mjs dist 1000`、旧形式の印1,000個の移行と1器具の書式変更）

| 区間 | 時間 |
|---|---:|
| 保存全体（`saveToBytes`） | 12,618ms |
| うち Worker への依頼から返事まで | 12,511ms |
| うち主処理（依頼の前と返事の後） | 108ms |

編集は `updateSymbol` 1,000件と `setCountFixtures` 1件、保存は増分保存。

### Node での段階ごとの時間（ブラウザーが Worker に送った編集をそのまま使用、`work/edits-1000.json`）

| 段階 | 時間 |
|---|---:|
| `applyEdits`（ジャーナルなし） | 318ms |
| `applyEdits`（`pdfOperation` の中＝実際の保存経路） | 18,604ms |
| 増分保存 | 24ms |
| 保存結果を開き直す | 36ms |

### 操作を区切った場合（Node、同じ編集）

| 1回の操作に入れた編集 | 適用の時間 | 全部を `undo()` したら元に戻るか |
|---|---:|---|
| 1,001件（1回、現状） | 13,481ms | 戻る |
| 200件ずつ（6回） | 967ms | 戻る |
| 50件ずつ（21回） | 686ms | 戻る |

この実験は `applyEdits` を区切りごとに分けて呼んだ。本番では `applyEdits` を1回で呼んだまま（個数カウントの外観のテンプレートとフォントを全件で共有するため）、中で操作を区切る。

## 対象

- 作業フォルダ: `C:\Users\gibbo\.codex\worktrees\dda9\PDF編集アプリ`
- 変更してよいファイル: `src/core/editTransaction.ts`、`src/core/annotations.ts`（区切りの呼出しを足すだけ）、`tests/`（下の試験の追加）
- 変更しないファイル: 上記以外。特に `src/worker/`、`src/client/`、`src/app/`、`src/editor/`、`e2e/`

## 変更内容

1. `applyEdits` に省略できる引数を足す: `applyEdits(doc, edits, fontResources, options?: { checkpoint?: () => void })`。
   - 編集の繰返し（`for (const [editIndex, edit] of edits.entries())`）で、1件の編集を終えるたびに（成功・失敗とも）`options.checkpoint?.()` を呼ぶ。
   - `installTemporaryAppearances` で、元の文書の注釈に外観を入れる繰返しで、1件入れるたびに `checkpoint` を呼ぶ（引数で渡す）。
   - ほかに、全件にわたって元の文書のオブジェクトを変える繰返しがあれば、同じように呼ぶ（あれば報告する）。
   - `checkpoint` を渡さない呼出し（既存の試験など）の動作と結果は今と同じにする。
2. `src/core/editTransaction.ts` に、操作を区切る版の関数を作る（名前は任せる。例: `pdfChunkedOperation(document, action: (checkpoint: () => void) => T)`）。
   - 開始時は今の `pdfOperation` と同じ（`assertEditablePdf`、`enableJournal`、`beginOperation('かるPDF 編集')`）。
   - `checkpoint` が50回呼ばれるごとに、`endOperation()` してから `beginOperation('かるPDF 編集')` し直す。この呼出しの中で終えた操作の数を数える。
   - 成功したら、最後の操作を `endOperation()` する。
   - 失敗したら（`action` が例外を出したら）、いまの操作を `abandonOperation()` し、**この呼出しの中で終えた操作の数だけ `undo()` する**。これより前の呼出しの操作は戻さない。その後、元の例外を投げ直す。
   - 戻した後の文書は、呼出し前と同じ内容にする（注釈・カタログの `KaruCountFixtures`・ページの `Annots` を含む）。
3. `applyEditsAtomically` と `applyAndSaveAtomically` を、2 の区切る版で行う。`applyEdits` には 2 の `checkpoint` を渡す。
   - `applyAndSaveAtomically` の保存（`saveDocument`）と開き直しの確認（`openDocument`）は、今と同じく最後の操作の中で行う。どちらかが失敗したら、2 の方法で全部を戻す。
   - `applyEdits` の結果に `errors` があるときに例外にして戻す動作は今と同じ。
4. 今の `pdfOperation` は、ページの整理・ヘッダーフッターで使っているので残す（動作も変えない）。

## 試験

`tests/` に次を追加する。`tests/stampAppearance.integration.test.ts`・`tests/annotations.batch.integration.test.ts` の書き方（フォントの読み方・PDFの作り方）に合わせる。

- 印2,000個の旧形式の個数カウントを持つPDFで、`AnnotationStore` で全件の移行と1器具の書式変更の編集を作り、`applyAndSaveAtomically` で保存する。10秒以内に終わり、開き直すと全件が新形式で、書式を変えた器具の印の外観が新しい形になっている。
- 区切りの回数: 上の保存で `beginOperation` が「`checkpoint` の呼出し回数 ÷ 50」程度の回数呼ばれる（1回だけではない）。
- 失敗時に戻ること（`applyEditsAtomically` と `applyAndSaveAtomically` の両方）: 300件の編集のうち、250件目に失敗する編集（例: 存在しない注釈の番号の更新）を入れる。例外になり、文書は呼出し前と同じ内容になる（全ページの注釈の一覧・各注釈の `Rect`・`KaruCount`・カタログの `KaruCountFixtures` が同じ）。続けて正しい編集で保存すると成功する。
- 前の呼出しの操作は戻さないこと: `applyEditsAtomically` を成功させた後、別の呼出しで失敗させると、最初の呼出しの変更は残っている。
- 既存の単体試験・統合試験がすべて通るようにする。

## 禁止事項

- 元データ（`test-data/`、`bench-results/`、`dist*/`、`release/`、`work/`）を変更しないこと
- 「対象」に挙げていないファイルを変更しないこと
- ジャーナルを使わずに済ませる（失敗時に元へ戻せなくなる）変更をしないこと
- 外観の作り方・保存結果の見た目を変えないこと
- 指示していない仕様変更・リファクタを行わないこと
- 依存関係を追加しないこと
- **テスト・ビルド・型検査・ブラウザーを実行しないこと**（Claude Code 側で行う）
- **python は使えない（この環境に入っていない）。ファイルの編集は apply_patch で行い、スクリプトによる一括書き換えをしないこと**
- git 操作をしないこと

## 検証項目（Claude Code 側で実施）

- [ ] `npx tsc --noEmit` が通る
- [ ] `npm test`（単体試験の全件）が通る
- [ ] `npm run build` の後、`e2e/review-load.annotate.spec.ts` が2分の制限内で通り、通常版の画面試験の全件が通る
- [ ] `node work/measure-5000-save.mjs dist 1000` と `… 5000` で、改修前（1,000個で12.6秒、04j の前は50.2秒）と比べた時間を記録する

## 報告してほしいこと

- 変更したファイル一覧と、区切りの入れ方（どの繰返しで `checkpoint` を呼んだか）
- 追加した試験
- SPEC から逸脱した箇所があれば、その内容と理由
- 残課題
