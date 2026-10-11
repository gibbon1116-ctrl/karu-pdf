# SPEC-S13: ページの挿入・削除・並べ替えで、項目の見本のページ番号を付け替える

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: PDF の組み直しの途中で保存データを書き換える。重複ページ・削除・別 PDF からのページの扱いに判断が要る

---

## 利用者の要望

> 「ページを挿入・削除すると、登録済みの見本は「図面と合わない」となり、囲み直しになります。」この課題については改善してください。

## 現状（Claude Code が確かめたこと）

- 項目の見本は `CountFixtureSample { png; width; height; pageIndex; rect?; lines? }`。PDF の Root の `KaruCountFixtures` に、文書全体で 1 つ保存される（`src/core/countFixtures.ts` の `readCountFixtures`・`writeCountFixtures`）。
- ページの挿入・削除・並べ替え・回転・他の PDF からの追加は、`src/core/pageOps.ts` の `applyPageLayout(targetDocId, target, cards, sources)` が行う。
  - `cards` の順が新しいページの順。`card.source` は `{ kind: 'blank', ... }` か `{ kind: 'page', docId, pageIndex }`。
  - 同じ文書のページ（`card.source.docId === targetDocId`）は、元のページ番号 `card.source.pageIndex` を `order` に入れる。
  - `preserveCatalog` で `Karu` で始まる Root の値（項目の一覧を含む）を残し、`rearrangePages(order)` の後に戻す。
  - **見本の `pageIndex` は付け替えていない。** そのため、前のページを消したり足したりすると、見本の場所が別のページを指す。次の検索で、作り直した画像が合わず、囲み直しになる（SPEC-S07 の確かめ）。
- 抜き出し（`extractPages`）・分割（`splitPages`）は新しい PDF を作り、項目の一覧を写さない。変更不要。
- 直前のページ操作を戻す（`undoPageLayout`）は、操作前の PDF に戻すので、項目の一覧も戻る。変更不要。

## 変更内容（`src/core/pageOps.ts`）

`applyPageLayout` で、Root の値を戻した後に、項目の見本のページ番号を付け替える。

- 対応表：元のページ番号 → 新しいページ番号。
  - `cards` を順に見て、同じ文書のページ（`kind === 'page'` かつ `docId === targetDocId`）の `pageIndex` を、その card の位置（新しいページ番号）に対応させる。
  - 同じ元のページが複数回ある（複製）ときは、最初の位置を使う。
  - 空白ページ・他の PDF からのページは対応表に入れない。
- 項目の一覧を `readCountFixtures(target)` で読み、見本があるものを直す。
  - 元のページが新しい並びに残っていれば：`pageIndex` を新しい番号にする。`rect`・`lines` はそのまま。
  - 元のページが無くなった（削除）：`rect` と `lines` を外す。画像（png・大きさ）は残し、`pageIndex` はそのまま（表示にしか使わない）。
  - 回転を変えたページ（`card.rotation` が 0 以外）の見本は、`rect` と `lines` を外す（座標が変わるため）。
    - `card.rotation` の意味（元からの回転か、絶対の回転か）は `rotatePage` を読んで確かめ、元のページから回転が変わる場合だけ外す。
- 何も変わらなければ書き込まない。変われば `writeCountFixtures(target, fixtures)` で書き込む。
- 項目の一覧が無い・読めない PDF では何もしない（例外を出さない）。
- 付け替えは、`rearrangePages` と Root の値の戻しが終わった後、`rotatePage` の前後どちらでもよい（同じ `try` の中）。

## 変えないこと

- ページの組み直しのほかの結果（ページの並び・回転・図面情報・縮尺・フォーム・見出しなど）。
- 抜き出し・分割・戻す。
- 見本の形式（S07・S09 のまま）。

## 試験（`tests/pageLayout.test.ts` か新しい試験ファイル）

mupdf で小さな PDF（3 ページ）を作り、項目を 3 つ書き込む。見本はそれぞれ 0・1・2 ページ目、`rect` と `lines` 付き。

- 並べ替え `[2, 0, 1]`：見本のページが `1, 2, 0` になる。`rect`・`lines` は同じ。
- 削除 `[0, 2]`：0 ページ目の見本は 0、2 ページ目の見本は 1。1 ページ目の見本は `rect`・`lines` が無くなり、画像は残る。
- 前に空白ページを挿入 `[blank, 0, 1, 2]`：見本のページが 1 ずつ増える。
- 複製 `[0, 0, 1, 2]`：0 ページ目の見本は 0（最初の位置）。
- 回転を変えたページの見本は `rect`・`lines` が無くなる。回転を変えていないページは残る。
- 見本の無い項目・項目の無い PDF で、例外が出ない。結果の項目の一覧の他の値は変わらない。

## 対象

- 変更：`src/core/pageOps.ts`
- 試験：`tests/pageLayout.test.ts`（足す）か新しい試験ファイル
- 変更しないファイル：上以外。

## 禁止事項

- 既存の関数名・入力名を変えないこと。
- git の操作をしないこと。python・pytest は使わない。

## 報告してほしいこと

- 変更点、SPEC から逸脱した箇所と理由、Claude Code に実行してほしい試験。
