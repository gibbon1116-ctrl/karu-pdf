# SPEC-06j-1: 線の取り出しで MuPDF の線データの解放を正しくする

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: WASM のメモリ管理（参照数と表示リスト）に関わる不具合の修正で、試験の作り方に判断が要るため

---

## 目的

1.4.1 で入れた線の取り出し（`src/worker/vectorExtract.ts` の `extractVectorPage`）が、MuPDF の線データ（`Path`）を二重に解放している。これを直す。

## 現状（Claude Code が確認したこと）

- `extractVectorPage` は表示リスト（`page.toDisplayList(false)` か `DisplayListCache` の中のリスト）を JS の `mupdf.Device` で走らせ、`strokePath`・`fillPath`・`fillText`・`strokeText`・`fillImage`・`fillImageMask` を受けている。
- mupdf.js（1.28.1）は、各コールバックの引数を `new Path(libmupdf._wasm_keep_path(ptr))` のように包み、`FinalizationRegistry` で GC 時に `_wasm_drop_path` を呼ぶ。
- 表示リストの中の線データは、表示リストの記憶域に詰めて格納されている。包み（`Path`）を `destroy()` しないまま表示リストが破棄されると、後で GC が走ったときに、すでに解放された記憶域の線を解放しようとする。
- 実測（Node、利用者の33ページの電気設備図）:
  - 今のコード: `Path` の解放 630,185 回のうち約 94,000 回が `RuntimeError: memory access out of bounds`（`emscripten_builtin_free ← fz_free ← fz_drop_path ← wasm_drop_path`）。
  - コールバックの中で `path.destroy()`・`stroke.destroy()`・`colorspace.destroy()`・`text.destroy()`・`image.destroy()` を呼ぶ版: 失敗 0 回。
  - 表示リストを使わず `page.runPageContents` で走らせた場合は、包みを GC に任せても失敗 0 回。問題は表示リストの線に限られる。
- この Worker は描画・編集・保存も受け持つ。WASM の記憶域が壊れると、それらに影響しうる。

## 対象

- 対象フォルダ: `C:\Users\gibbo\Desktop\PDF編集アプリ\.claude\worktrees\karupdf-quantity-ui-8301e6`
- 変更してよいファイル: `src/worker/vectorExtract.ts`、`tests/vectorExtraction.test.ts`（試験を足す）
- 変更しないファイル: 上以外すべて

## 変更内容

1. `mupdf.Device` の各コールバックで、受け取った包みを使い終えたらその場で `destroy()` する。
   - `strokePath(path, stroke, ctm, colorspace, …)`: `path`・`stroke`・`colorspace`
   - `fillPath(path, evenOdd, ctm, colorspace, …)`: `path`・`colorspace`
   - `fillText(text, ctm, colorspace, …)`: `text`・`colorspace`
   - `strokeText(text, stroke, ctm, colorspace, …)`: `text`・`stroke`・`colorspace`
   - `fillImage(image, ctm, …)`: `image`
   - `fillImageMask(image, ctm, colorspace, …)`: `image`・`colorspace`
2. 走査中に例外が出ても解放されるように、`try { … } finally { …destroy() }` で包む。
3. 線の取り出しの結果（`segments`・`segmentCount`・`stats`）は1ビットも変えない。

## テスト（`tests/vectorExtraction.test.ts` に足す）

- 線・塗り・文字・画像を含む PDF（既存の試験の作り方でよい）で `extractVectorPage` を呼ぶ。コールバックに渡されたすべての `Path`・`StrokeState`・`ColorSpace`・`Text`・`Image` の包みが、関数から戻る前に `destroy()` 済み（`pointer === 0`）であることを確かめる。
  - 方法は任せる。例: `mupdf.Path.prototype` 等の `destroy` を試験の中だけ一時的に包んで回数を数え、`stats.strokePaths + stats.fillPaths` と一致することを確かめる。試験後に元へ戻す。
- 注釈のあるページ（表示リストを一時的に作って破棄する経路）と、`DisplayListCache` を使う経路の両方で確かめる。
- 既存の試験の期待値（線の本数・座標）は変えない。
- 注意: vitest は `process.env.MODE` を `test` で上書きする。環境変数で分岐するなら別の名前を使う。

## 禁止事項

- 線の取り出しの結果を変えないこと。
- 対象外のファイルを変更しないこと。git の操作をしないこと。python・pytest は使わない。
- Worker の入口のファイル（`*.worker.ts`）から値を export しないこと。
- `npx tsc --noEmit` と `npx vitest run tests/vectorExtraction.test.ts` は実行してよい。e2e は実行しなくてよい。

## 報告してほしいこと

- 変更したファイルと要点
- SPEC から逸脱した箇所と理由
