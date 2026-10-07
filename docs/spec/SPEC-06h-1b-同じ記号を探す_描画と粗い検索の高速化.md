# SPEC-06h-1b: 同じ記号を探す — ページの描画を1回に、粗い検索を軽く

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: Worker の描画の要求を新しく足し、照合の段の選び方を変えて再測定するため（判定表「新規機能の実装」）

---

## 目的

SPEC-06h-1 の試作を実図面（七ヶ浜町 1ページ目、A3 1190×842pt、教室の机の記号 11×8pt を見本）で測った結果（Edge 154、`e2e/symbol-search.perf.spec.ts`）:

| 項目 | 値 |
|---|---|
| 描く倍率・画素 | 2.91 倍・848 万画素 |
| 描画 | **147,321ms**（160px の小片 353 枚） |
| 照合 | 5,069ms（粗い段 4,773ms、段 1、候補 180） |
| 候補 | 34（すべて机の記号の上。ただし机は約 100 個あり、見落としが多い） |
| 検索中のスクロール p95 | 16.9ms |

原因（Claude Code の調査）:

1. 描画: `contentsOnly` の描画（`pdf.worker.ts` の `renderFixtureRegion`）は見本の切り出し用で、160px までしか描けない。しかも小片ごとに**ページ全体の内容を最初から走らせる**（`page.runPageContents`）ので、353 回ページ全体を処理している。
2. 粗い段: 見本の長い辺を 32px で描くので、縮小が1回（16px）で止まり、粗い段の計算が多い。回転を既定で4つ探している。
3. 見落とし: 最終の下限 0.8 が、線や寸法の文字が重なった記号には厳しい。

## 対象

- 対象フォルダ: `C:\Users\gibbo\Desktop\PDF編集アプリ\.claude\worktrees\karupdf-quantity-ui-8301e6`
- 変更してよいファイル: `src/worker/pdf.worker.ts`・`src/worker/protocol.ts`・`src/client/PdfWorkerPool.ts`（照合用のページの描画の要求を1つ足すだけ。既存の描画は変えない）、`src/core/symbolSearch.ts`、`src/worker/symbolSearch.worker.ts`、`src/client/SymbolSearchClient.ts`、`tests/symbolSearch.test.ts`、`e2e/symbol-search.perf.spec.ts`
- 変更しないファイル: 上以外

## 変更内容

### 1. 照合用のページの描画（新しい要求）

- `PdfWorkerPool.renderSearchImage({ docId, pageIndex, renderScale, deviceRect }): { promise: Promise<{ width; height; gray: Uint8Array }>; cancel(): void }` を足す。Worker では、ページの内容（注釈を除く。`runPageContents`）を `deviceRect` の大きさの画素に**1回だけ**描き、インクの濃さ（`255 - 輝度`）の1バイトの配列にして返す（transfer）。RGBA の配列を main に送らない。
- 画素の上限は 1,600 万（超えたら Error）。優先度は表示の描画より低い（表示のスクロール・拡大の描画を待たせない。Worker の今の優先度のしくみに合わせる）。取り消しは、まだ始まっていなければ取り消す（始まったものは最後まで描いて捨てる）。
- 見本も同じ要求で描く。`SymbolSearchClient` は小片の描画をやめ、この要求を使う。照合の Worker には `gray` を transfer で渡す（`OffscreenCanvas` での変換をやめる）。

### 2. 照合を軽く

- 描く倍率: 見本の長い辺が **24px** になる倍率（今は 32px）。
- 粗い段: 見本の長い辺が **6〜12px** になる段まで縮める（最大 4 段）。
- 回転: 既定を `rotations: false` にする（画面で「回転した記号も探す」を選んだときだけ 4 つ）。
- 最終の下限の既定を **0.7** にする。粗い段の下限は `threshold - 0.25`（最低 0.35）。
- 速さの単体試験（4,000×3,000・記号 200）の目安を 600ms 未満にする（超えても失敗にせず値を出す）。

### 3. 測定

- `e2e/symbol-search.perf.spec.ts` に、`rotations` と `threshold` を環境変数（`SYMBOL_ROTATIONS=1`、`SYMBOL_THRESHOLD=0.7`）で変えられるようにする。描画の時間・照合の時間・候補の数を今と同じ形で出す。

## 禁止事項

- 既存の表示の描画・見本の切り出しの動作を変えないこと。
- PDF を開くとき・表示・スクロールのときに照合の処理をしないこと。
- 依存ライブラリを足さないこと。
- 試験から `work/` へ書き込まないこと。対象外のファイルを変更しないこと。git の操作をしないこと。python・pytest は使わない。
- `npx tsc --noEmit` と `npx vitest run tests/symbolSearch.test.ts` は実行してよい。e2e は実行しなくてよい。
- 同じ作業フォルダで、別の作業（数量拾いの作業画面: `FixturePanel.tsx`・`PickupBar.tsx`・`DocumentWorkspace.tsx`・`AnnotationStore.ts`・`App.tsx`・`styles.css` など）が同時に進んでいる。対象外のファイルに型エラーや変更があっても触らず、報告だけすること。

## 報告してほしいこと

- 変更したファイルと要点、単体試験の結果と速さ
- SPEC から逸脱した箇所と理由、残課題
