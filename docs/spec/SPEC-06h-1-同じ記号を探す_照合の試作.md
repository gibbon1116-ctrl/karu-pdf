# SPEC-06h-1: 同じ記号を探す（Visual Search）— 照合の部品と Worker の試作、測定の仕組み

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 画像の照合の算法（正規化相互相関・ピラミッド・候補の絞り込み）と専用 Worker・取り消しを新しく作り、性能を測って採否を決めるため（判定表「新規機能の実装」「仕様に判断の余地が残っている作業」）

---

## 目的

利用者の指示（要約）: 照明器具などの記号を図面上で1つ見本に指定すると、同じかよく似た記号を図面から探して候補として示す。自動では数量に入れない（人が確かめる候補を探すまで）。PDF を開いたときに全ページを画像解析・高解像度化・先読みしない。使わない利用者に負担をかけない。明示的に押したときだけ動く。まず今のページ、必要なら指定ページ・全ページ。粗い検索 → 候補だけ詳しく、の二段階。UI のスレッドを長く占めない（Worker）。中止できる。キャッシュは上限付き、PDF を閉じたら捨てる。**性能への影響が大きい場合は導入しない**（理由・ボトルネック・将来の方法を報告）。

この SPEC は、採否を決めるための**照合の部品・専用 Worker・測定の仕組み**だけを作る。画面（候補の表示・採用・数量への追加）は、測定の結果を見て SPEC-06h-2 で作る。

## 現状（Claude Code が確認したこと）

- ページの描画: `PdfWorkerPool.render({ docId, pageIndex, priority, renderScale, deviceRect, contentsOnly })` が `ImageBitmap` を返す（`renderFixtureSample` は、見本の切り出しにこれを使い、`contentsOnly: true` で注釈を除いて描く）。
- 見本の記号の切り出し: SPEC-04f（`FixtureSampleContext`、項目の画面の「図面から見本を取る」）。
- Worker の作り方の例: `src/worker/image.worker.ts` と `src/client/ImageWorkerClient.ts`（vite の `new Worker(new URL(...), { type: 'module' })`）。

## 対象

- 対象フォルダ: `C:\Users\gibbo\Desktop\PDF編集アプリ\.claude\worktrees\karupdf-quantity-ui-8301e6`
- 変更してよいファイル:
  - 新規 `src/core/symbolSearch.ts` — 照合の算法（DOM・Worker に依存しない純粋な関数）
  - 新規 `src/worker/symbolSearch.worker.ts` — 照合の専用 Worker
  - 新規 `src/client/SymbolSearchClient.ts` — ページを描いて Worker に渡し、結果を返す。取り消し
  - `src/App.tsx` — 試験用のフック（`window.__karu.symbolSearch(...)`、`?test=1` のときだけ）を足すだけ
  - `tests/`、新規 `e2e/symbol-search.perf.spec.ts`（測定用。`bench` の project に入る名前にする）
- 変更しないファイル: 上以外。画面は作らない。`docs/`、設定ファイル、`scripts/`

## 変更内容

### 1. 照合の算法（`symbolSearch.ts`）

```ts
export interface GrayImage { width: number; height: number; data: Uint8Array }  // 0 = 白、255 = 黒（インクの濃さ）
export interface SymbolMatch { x: number; y: number; width: number; height: number; score: number; rotation: 0 | 90 | 180 | 270 }  // 画像の画素の座標（左上）
export interface SymbolSearchOptions {
  threshold: number          // 最終の似ている度合いの下限（0〜1、既定 0.8）
  rotations: boolean         // 90°・180°・270° も探す（既定 true）
  maxResults: number         // 既定 500
  region?: { x: number; y: number; width: number; height: number }  // 探す範囲（画素）。省略はページ全体
  shouldStop?: () => boolean // 途中で止める（Worker の中の取り消しの確認）
  onProgress?: (done: number, total: number) => void
}
export function toGray(rgba: Uint8ClampedArray, width: number, height: number): GrayImage   // インクの濃さ = 255 - 輝度
export function searchSymbol(page: GrayImage, template: GrayImage, options: SymbolSearchOptions): { matches: SymbolMatch[]; stats: { coarseCandidates: number; refined: number; levels: number; ms: { coarse: number; refine: number; total: number } } }
```

- 方式: 正規化相互相関（NCC）。
  1. 見本の外側の白い余白を切り詰める（インクの外接四角 + 1px）。
  2. ピラミッド: 画像と見本を 2×2 の平均で縮める。見本の長い辺が 8〜16px になる段まで縮めた段を「粗い段」にする（最大 4 段）。
  3. 粗い段で全位置の NCC を求める。窓の平均・分散は積分画像で出す。窓の分散がほぼ 0（白い所）は飛ばす。回転は見本を回した 4 つで同じことをする。各回転の結果から、3×3 の極大で、粗い下限（`threshold - 0.2`、最低 0.4）以上の位置を候補にする（上限 20,000、多ければ点の高い順）。
  4. 詳しい段（元の大きさ）で、各候補の周り ±(2^段数) px を NCC で調べ、最高の位置と点にする。
  5. `threshold` 以上を残し、重なり（中心の距離が見本の短い辺の半分未満）は点の高い方を残す。点の高い順に `maxResults` まで。
- `shouldStop()` を、粗い段の行ごと・候補 200 件ごとに確かめ、true なら途中の結果を捨てて `Error('cancelled')` を投げる。
- 依存ライブラリを足さない。型付き配列（`Float32Array`・`Float64Array`・`Int32Array`）で書く。

### 2. 専用 Worker（`symbolSearch.worker.ts`）

- 受け取る: `{ type: 'search', id, page: ImageBitmap, template: ImageBitmap, renderScale, options }`（`ImageBitmap` は transfer）。`OffscreenCanvas` で画素にし、`toGray` → `searchSymbol`。終わったら `ImageBitmap` を `close()` し、配列の参照を捨てる。
- 返す: `{ type: 'result', id, matches, stats, memory: { pagePixels, bytes } }`、途中は `{ type: 'progress', id, done, total }`、失敗は `{ type: 'error', id, message }`。
- 1つの Worker で1度に1件。

### 3. クライアント（`SymbolSearchClient.ts`）

```ts
export interface SymbolSearchRequest { docId: string; pageIndex: number; sampleRect: Rect; samplePageIndex: number; searchRect?: Rect; options?: Partial<SymbolSearchOptions> }  // Rect はページの座標（pt、左上が原点）
export interface SymbolCandidate { pageIndex: number; rect: Rect; center: Point; score: number; rotation: 0 | 90 | 180 | 270 }
export class SymbolSearchClient {
  constructor(pool: PdfWorkerPool)
  search(request: SymbolSearchRequest, onProgress?: (stage: 'render' | 'search', done: number, total: number) => void): { promise: Promise<{ candidates: SymbolCandidate[]; metrics: SymbolSearchMetrics }>; cancel(): void }
  dispose(): void   // Worker を terminate する
}
export interface SymbolSearchMetrics { renderScale: number; pagePixels: number; renderMs: number; transferMs: number; searchMs: number; coarseCandidates: number; refined: number; totalMs: number }
```

- 描く倍率: 見本の長い辺が 32px になる倍率（`32 / max(見本の幅pt, 高さpt)`）。ただし描くページ（か `searchRect`）の画素が 1,600 万を超えないように下げる（下げたら `metrics` に残す）。見本と探すページは同じ倍率で描く（`contentsOnly: true`、`priority` は表示より低い）。
- 照合の Worker は**最初の検索のときに作る**（アプリの起動・PDF を開くときには作らない）。`cancel()` は Worker を `terminate()` して捨て（確実に止まる）、次の検索で作り直す。`dispose()` も terminate。描画の依頼が終わっていなければ取り消す（`cancelJobs`）。
- キャッシュはしない（この試作では）。

### 4. 試験用のフック（`App.tsx`、`?test=1` のときだけ）

- `window.__karu.symbolSearch(request)` → `{ candidates, metrics }`。`window.__karu.symbolSearchCancelTest(request, afterMs)` → `afterMs` 後に `cancel()` して、`{ cancelled: boolean, settledMs }` を返す（取り消しから promise が終わるまでの時間）。

## テスト

### 単体（新規 `tests/symbolSearch.test.ts`）

合成の画像で確かめる（`GrayImage` を直接作る）:

- 白い 600×400 の画像に、見本（例: 24×24 の円と十字）を 5 か所に置き、似た別の記号（四角）を 3 か所に置く → 5 か所だけが見つかり、位置の誤差が 1px 以内、点が 0.95 以上。
- 90° 回した記号は `rotations: true` で見つかり、`false` では見つからない。
- 見本に線が重なった記号（記号の上を細い線が横切る）も `threshold: 0.7` で見つかる。
- `region` の外は見つけない。
- `shouldStop` が true を返すと `cancelled` で止まる。
- 速さ: 4,000×3,000 の白い画像に記号 200 個（32×32）で、`searchSymbol` が 1.5 秒未満（目安。超えたら試験は失敗にせず、測定値を `console.log` で出す）。

### 測定（新規 `e2e/symbol-search.perf.spec.ts`、`bench` の project）

- 実図面（`test-data/real/七ヶ浜町_実施設計図.pdf` があれば。無ければ試験を skip）の、電灯の平面図のページ（図面名称に「電灯」を含む最初のページ。見つからなければ 1 ページ目）で、記号の見本の四角は試験の引数（環境変数 `SYMBOL_SAMPLE` に `page,x0,y0,x1,y1`、無ければ skip）で受け取る。
- 測る: `metrics`（描く倍率・画素数・描画・転送・照合の時間・粗い候補・詳しく調べた数）、候補の数、`performance.memory.usedJSHeapSize` の検索の前・後・検索して 2 秒後、取り消しの `settledMs`、検索中のスクロールのフレーム間隔（`requestAnimationFrame` の p95）。結果を `test-results/symbol-search-perf.json` に書く（`work/` には書かない）。
- 候補の位置を確かめるための画像: 候補の四角を描いたページの画像を `test-results/symbol-search-candidates.png` に保存する（画面の描画に頼らず、描いたページの画像に四角を重ねてよい）。

## 禁止事項

- PDF を開くとき・ページを表示するとき・スクロールのときに、照合のための処理（描画・Worker の起動・解析）をしないこと。
- 照合の結果を数量に入れる処理を作らないこと（この SPEC では画面を作らない）。
- 依存ライブラリを足さないこと。外部への送信をしないこと。
- 試験から `work/` など Git の管理外のフォルダへ書き込まないこと（`test-results/` は可）。
- 対象外のファイルを変更しないこと。git の操作をしないこと。python・pytest は使わない。
- 試験の実行はしなくてよい（Claude Code が実行する）。書くだけでよい。`npx tsc --noEmit` と `npx vitest run tests/symbolSearch.test.ts` は実行してよい。

- 同じ作業フォルダで、別の作業（保存状態・選択の表示・標準マスタ）が同時に進んでいる。`App.tsx` はフックを1か所足すだけにし、他の行を書き換えないこと。対象外のファイルに型エラーや変更があっても触らず、報告だけすること。

## 検証項目

- [ ] `npx tsc --noEmit` が通る。
- [ ] 単体試験を書いた（実行できたら結果も）。測定の e2e を書いた。

## 報告してほしいこと

- 変更したファイルと要点、照合の算法の段の数え方
- 単体試験の結果と速さ（実行できた場合）
- SPEC から逸脱した箇所と理由、残課題（精度・速さで心配な点）
