# SPEC-06i-1: ベクターの線の取り出し、ページの判定、線による記号の照合と端点スナップの試作と測定

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: MuPDF の Device で線を取り出す Worker 処理と、幾何の照合の算法を新しく作り、性能を測って採否を決めるため（判定表「新規機能の実装」「仕様に判断の余地が残っている作業」）

---

## 目的

利用者の要望（2026-10-08）:

> PDF 内の線が、画像化されず、線分・パス等のベクター描画情報として保持されているかを判定して、残っていればその線を認識して同じ記号を探すようにできないか。動作が遅くなるようであれば実装しないのは変わらない。スナップでもベクター描画情報の始点終点を認識できるようにできないか。

この SPEC は、採否を決めるための**部品と測定の仕組み**だけを作る（画面への組み込みは結果を見て SPEC-06i-2 で）。

## これまでの事実（Claude Code が確認したこと）

- SPEC-05f の試作（削除済み。`docs/調査/スナップの再検証.md`）: Worker で `page.toDisplayList(false)` を独自 Device で歩き、`strokePath` からページ座標の線分を取り出した。曲線は平坦度 0.25pt・最大 12 分割。七ヶ浜町 1〜3ページ（5.8万〜11.7万本）で 494〜567ms、A1（15万本）で 926ms。16pt 格子の索引 30〜50ms。端点の探索 p95 は 0.1ms 程度、操作中のフレーム p95 は変わらなかった。当時は「取り出し 500ms 以内」を基準にしていたため不採用。
- 今の「同じ記号を探す」（画像の照合、`src/core/symbolSearch.ts`・`src/client/SymbolSearchClient.ts`・`src/worker/symbolSearch.worker.ts`）は、七ヶ浜町1ページ目で描画 2.2〜3.8 秒＋照合 0.6〜2.7 秒。文字や線が重なった記号は見落とす（机 100 個余りのうち 58〜65 個）。
- Worker の描画は `src/worker/pdf.worker.ts`（ページの表示リストのキャッシュ `displayListCache` がある）。照合用のページ描画の要求 `renderSearchImage`（SPEC-06h-1b）が参考になる。
- 既存頂点のスナップ: `src/core/snap.ts`（`buildSnapIndex(points, bounds)`・`findSnap`）、`src/editor/MeasurementOverlay.tsx`。

## 対象

- 対象フォルダ: `C:\Users\gibbo\Desktop\PDF編集アプリ\.claude\worktrees\karupdf-quantity-ui-8301e6`
- 変更してよいファイル:
  - 新規 `src/core/vectorPaths.ts` — 線分の配列の型、ページの判定、端点の取り出し（純粋な関数）
  - 新規 `src/core/vectorSymbolSearch.ts` — 線分による記号の照合（純粋な関数）
  - `src/worker/pdf.worker.ts`・`src/worker/protocol.ts`・`src/client/PdfWorkerPool.ts` — 線の取り出しの要求を1つ足すだけ（既存の描画・要求は変えない）
  - `src/App.tsx` — 試験用のフック（`?test=1` のときだけ）を足すだけ
  - `tests/`、新規 `e2e/vector-paths.perf.spec.ts`（`bench` の project）
- 変更しないファイル: 上以外。画面は作らない。

## 変更内容

### 1. 線の取り出し（Worker の新しい要求）

`PdfWorkerPool.extractVectors({ docId, pageIndex }): { promise: Promise<VectorPage>; cancel(): void }`

```ts
export interface VectorPage {
  pageIndex: number
  segments: Float32Array        // x1,y1,x2,y2 の並び。ページの表示座標（pt、左上原点、/Rotate を含む。注釈・数量拾いと同じ座標）
  segmentCount: number
  truncated: boolean            // 上限で打ち切ったか
  stats: { strokePaths: number; fillPaths: number; curves: number; images: number; imageAreaRatio: number; textGlyphs: number; ms: { displayList: number; walk: number; total: number } }
}
```

- ページの内容だけ（注釈を除く）。キャッシュ済みの表示リストがあれば使い、無ければ作る（作った表示リストを表示のキャッシュに入れるかは、既存のキャッシュの規則に従う）。
- 独自 Device: `strokePath` の線分（直線・`re`・閉じる線、変換行列を掛けた後の座標）。曲線は平坦度 0.25pt・最大 12 分割で折れ線にする。`fillPath` は輪郭を線分として足す（塗りの記号のため）。`fillImage` などの画像は、外接四角の面積をページ面積に対して足して `imageAreaRatio`。`fillText`・`strokeText` は文字の数だけ数える（線分には入れない）。`clipPath` などは無視。
- 線分の長さ 0.05pt 未満は捨てる。上限 400,000 本で打ち切り（`truncated: true`）。
- 優先度は表示の描画より低く。取り消しは、始まる前なら取り消す。
- `Float32Array` は transfer で返す。

### 2. ページの判定（`vectorPaths.ts`）

```ts
export type PageKind = 'vector' | 'raster' | 'mixed' | 'empty'
export function classifyPage(page: Pick<VectorPage, 'segmentCount' | 'stats'>): PageKind
```

- `raster`: `imageAreaRatio >= 0.5` かつ線分 200 未満（スキャンの図面など）。
- `vector`: 線分 200 以上かつ `imageAreaRatio < 0.2`。
- `mixed`: 線分 200 以上かつ `imageAreaRatio >= 0.2`。
- `empty`: それ以外（線分も画像も少ない）。

### 3. 線による記号の照合（`vectorSymbolSearch.ts`）

```ts
export interface VectorSymbolOptions { threshold: number /* 既定 0.85 */; rotations: boolean /* 既定 false */; tolerance?: number /* pt。省略時は見本の短い辺の 4%、最小 0.15、最大 1.0 */; maxResults: number /* 既定 2000 */; region?: Rect; shouldStop?: () => boolean }
export interface VectorSymbolMatch { rect: Rect; center: Point; score: number; angle: number }
export function vectorSymbolSearch(segments: Float32Array, sampleRect: Rect, options: VectorSymbolOptions): { matches: VectorSymbolMatch[]; template: { segments: number; length: number } ; stats: { anchorsTried: number; ms: number } }
```

- 見本: 両端が `sampleRect`（tolerance だけ広げる）に入る線分。2 本未満なら `Error('見本の範囲に線がありません')`。
- 索引: ページの線分を 8〜16pt の格子（見本の大きさに合わせる）に登録（`Uint32Array` の offsets/ids）。長さの索引（長さを tolerance 幅でまとめたもの）も作る。
- 照合（幾何のハッシュ）:
  1. 見本の一番長い線分を基準線にする。
  2. ページの中で、基準線と長さが tolerance 内で同じ線分を長さの索引から取り出す。`rotations: false` なら向きも同じ（±2°、端点の入れ替えを含む）ものだけ。`true` なら任意の角度。
  3. 各候補（端点の向き 2 通り）で、見本→ページの変換（回転＋平行移動）を決め、見本のすべての線分の上に等間隔に点を取って（線分の長さ 2pt ごと、最少 3 点）変換し、各点が格子の近くのページの線分から tolerance 以内にあるかを調べる。被覆率（当たった点の長さの重み付き割合）を点にする。ページの線が CAD の出力で分割・結合されていても当たるようにするため、端点どうしの一致ではなく「線の上にあるか」で調べる。
  4. `threshold` 以上を残し、中心の距離が見本の短い辺の半分未満の重なりは点の高い方。見本自身の位置も候補に含める。
- 余分な線（文字・寸法線・他の線）が記号に重なっていても、見本の線がそろっていれば当たる（画像の照合との違い）。
- `shouldStop` を候補 500 件ごとに確かめる。

### 4. 端点のスナップの部品（`vectorPaths.ts`）

```ts
export function segmentEndpoints(segments: Float32Array, limit = 200_000): Point[]   // 重複（0.01pt 以内）を除いた端点
```

`buildSnapIndex` にそのまま渡せる形。測定だけで、今のスナップの動作は変えない。

### 5. 試験用のフック（`App.tsx`、`?test=1` のときだけ）

- `window.__karu.vectorProbe(pageIndex)` → `{ kind, segmentCount, truncated, stats, transferBytes, endpointCount, endpointIndexMs, snapQuery: { p50, p95, max } }`（`snapQuery` は端点の索引で 1,000 回探した時間。`snapVertexProbe` と同じ測り方）
- `window.__karu.vectorSymbolSearch({ pageIndex, sampleRect, threshold?, rotations? })` → `{ matches, extractMs, searchMs, template }`

## テスト

### 単体（`tests/`）

- `classifyPage` の4種。
- `vectorSymbolSearch`（合成の線分）: 見本（四角＋対角線＝×の入った四角、10pt）を 8 か所、似た別の記号（対角線の無い四角）を 4 か所に置く → 8 か所だけ。記号の上を長い線が横切っても当たる。記号の辺が 2 本に分割されていても当たる。90° 回した記号は `rotations: true` で当たり `false` で当たらない。`region` の外は当たらない。10 万本の無関係な線分の中に 200 個の記号で 1 秒未満（超えたら失敗にせず値を出す）。
- `segmentEndpoints` の重複除去と上限。

### 測定（新規 `e2e/vector-paths.perf.spec.ts`、`bench` の project）

- 七ヶ浜町（`test-data/real/七ヶ浜町_実施設計図.pdf`、無ければ skip）の 1・2・3 ページと、`test-data/heavy-300p.pdf` の 6 ページ（A1）で `vectorProbe`。取り出し・判定・転送量・端点の索引と探索を記録。取り出し中に 1,500px スクロールして、フレームの p95 を記録。
- 七ヶ浜町 1 ページの机の記号（見本 `[742,174,753,182]`）で `vectorSymbolSearch`（threshold 0.85 と 0.75、回転なし）。候補の数と時間を記録。候補を描いたページの画像を `test-results/vector-symbol-candidates.png` に保存。
- 結果を `test-results/vector-paths-perf.json` に書く（`work/` には書かない）。

## 禁止事項

- PDF を開くとき・表示・スクロールのときに線の取り出しをしないこと（フックから呼ばれたときだけ）。
- 既存の描画・スナップ・同じ記号を探す（画像）の動作を変えないこと。
- 依存ライブラリを足さないこと。外部への送信をしないこと。
- 試験から `work/` へ書き込まないこと。対象外のファイルを変更しないこと。git の操作をしないこと。python・pytest は使わない。
- `npx tsc --noEmit` と `npx vitest run` で足した単体試験は実行してよい。e2e は実行しなくてよい。

## 報告してほしいこと

- 変更したファイルと要点、Device で受け取った要素の扱い（曲線・塗り・画像・文字）
- 単体試験の結果と速さ
- SPEC から逸脱した箇所と理由、残課題
