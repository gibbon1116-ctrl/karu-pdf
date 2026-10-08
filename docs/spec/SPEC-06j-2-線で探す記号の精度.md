# SPEC-06j-2: 線で探す「同じ記号を探す」の精度を上げる

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 照合の採点の考え方を変え、線の取り出し・Worker・画面にまたがるため（判定表「新規機能・アルゴリズムの変更」）

---

## 目的

利用者の電気設備図（CAD の図面。図面の文字も線、円は 12 角形の折れ線、文字の下に白い塗りの四角）で、照明器具を「同じ記号を探す」と精度が低い。原因は次の3つ。Claude Code が試作で確かめた方法で直す。

1. ずれの許容が見本の**短辺**の 4%。幅 3pt × 長さ 19pt の器具では 0.19pt になり、同じ記号の 0.24pt の寸法違いを落とす。
2. 見本の枠に、器具の横の文字・文字の下の白い四角・配線の破線が入る。これらが見本の線の長さの約3割を占める。
3. 照合が「見本の線が候補の位置にあるか」の**一方向**だけ。同じ外形に斜線を足した非常用器具（別の記号）も満点になる。

試作の結果（26 ページ。白抜きの器具 101 台、斜線の入った非常用 54 台）:

| 方式 | 全候補 | 確度高の候補 |
|---|---|---|
| 1.4.2（文字も囲む・0.85） | 正しい器具 48・非常用 22 | （確度の印では区別できない） |
| 本 SPEC（どの囲み方でも・0.90） | 正しい器具 101・非常用 54・その他 2〜3 | 正しい器具 95・非常用 2・その他 1 |

**基本の考え方は変えない**:
- 線の無いページは今の画像の全面検索のまま。
- 候補は除外せず、確度の印（確度高・要確認）で分ける。
- 候補を自動で数量に入れない。

## 現状（Claude Code が確認したこと）

- 線の取り出し: `src/worker/vectorExtract.ts` の `extractVectorPage`（独自の `mupdf.Device`）。結果は `VectorPage`（`src/core/vectorPaths.ts`）の `segments: Float32Array`（x1,y1,x2,y2）。
  - 渡し方: `pdf.worker.ts` の `vectorsExtracted`（`segments.buffer` を transfer）→ `PdfWorkerPool.extractVectors` → `VectorCache`（`src/client/VectorCache.ts`、3 ページ・16MB）。
- 照合: `src/core/vectorSymbolSearch.ts` の `vectorSymbolSearch(segments, sampleRect, options, sampleSegments)`。
  - 許容は `options.tolerance ?? min(1, max(.15, 短辺 × .04))`。同じ式が `src/worker/symbolSearchMessages.ts` の `searchVectorMessage` にもある。
  - 見本は「両端が sampleRect ± 許容の中にある線」すべて。
  - 結果 `VectorSymbolMatch { rect, center, score, angle }`。`rect` は sampleRect を回して移した外接矩形。
- 画像の確かめ: `SymbolSearchClient.ts`。
  - 見本の画像は `request.sampleRect` から描く。
  - `imageConfidence(imageScore, threshold)` で `high`/`check` を決める（下限 `threshold − .50`、0.20〜0.60）。
  - 「画像でも確認する」がオフなら `confidence` は付かない。
- 候補: `AnnotationStore` の `symbolCandidates`（`confidence?`, `imageScore?`）。
  - 描画は `AnnotationLayer.tsx`（`data-confidence`、`<title>` は `線 0.93・画像 0.81`）。
  - パネルは `SymbolSearchPanel.tsx`（`候補 n 件（確度高 a 件・要確認 b 件）`、「確度の高い候補を選ぶ」）。

## 対象

- 対象フォルダ: `C:\Users\gibbo\Desktop\PDF編集アプリ\.claude\worktrees\karupdf-quantity-ui-8301e6`
- 変更してよいファイル:
  - `src/worker/vectorExtract.ts`
  - `src/core/vectorPaths.ts`
  - `src/core/vectorSymbolSearch.ts`
  - `src/worker/symbolSearchMessages.ts`
  - `src/worker/symbolSearch.worker.ts`
  - `src/worker/protocol.ts`
  - `src/worker/pdf.worker.ts`（`vectorsExtracted` で太さの配列も transfer するだけ）
  - `src/client/PdfWorkerPool.ts`（同上）
  - `src/client/VectorCache.ts`
  - `src/client/SymbolSearchClient.ts`
  - `src/editor/AnnotationStore.ts`（候補に値を1つ足すだけ）
  - `src/editor/AnnotationLayer.tsx`（候補の `<title>` だけ）
  - `src/app/SymbolSearchPanel.tsx`
  - `src/app/HelpDialog.tsx`
  - `tests/`
  - `e2e/vector-search-snap.annotate.spec.ts`
  - `e2e/symbol-search.annotate.spec.ts`
- 変更しないファイル: 上以外。画像の全面検索（`search` メッセージ・`searchSymbol`）の動作は変えない。

## 変更内容

### 1. 線の取り出し（`vectorExtract.ts`・`vectorPaths.ts`）

1. **白い塗りを線にしない**。`fillPath` の色が白なら、線を足さない（`stats.whiteFills` に数える）。白の判定は次のとおり。
   - 色の成分数が 1（Gray）: 値 ≥ 0.95
   - 3（RGB）: すべて ≥ 0.95
   - 4（CMYK）: すべて ≤ 0.05
   - 理由: 紙の上で見えない（文字の下の白抜き四角など）。スナップの端点からも消えてよい。
2. **線の太さを持つ**。`VectorPage` に `widths: Float32Array`（`segments` の線 1 本につき 1 つ）を足す。
   - 線（stroke）の太さは、表示の座標での太さ（`stroke.getLineWidth() × sqrt(|ctm[0]·ctm[3] − ctm[1]·ctm[2]|)`）。
   - 塗りの輪郭は 0。
   - 上限 400,000 本・打ち切りの扱いは `segments` と同じ。
   - `vectorsExtracted` では両方の buffer を transfer する。`VectorCache` の `bytes` に `widths` も数える（上限 16MB は変えない）。
3. それ以外の結果（線の座標・本数・`classifyPage`）は、白い塗りを除いた分を除いて変えない。

### 2. 見本の整理（`vectorSymbolSearch.ts` に新しい関数）

```ts
export interface PreparedTemplate {
  segments: Float32Array; widths: Float32Array; bounds: Rect; tolerance: number
  removed: { wiring: number; other: number }; total: number; cleaned: boolean
}
export function defaultVectorTolerance(rect: Rect): number  // min(1, max(.3, 長辺 × .03))
export function prepareVectorTemplate(pageSegments: Float32Array, pageWidths: Float32Array, sampleRect: Rect): PreparedTemplate
```

1. `tol0 = defaultVectorTolerance(sampleRect)`。見本の候補は「両端が sampleRect ± tol0 の中にあり、長さ > 0 の線」（今と同じ選び方）。
2. **配線を除く**。
   - 起点: 片方の端が枠（± tol0）の外にあり、枠と交わるページの線。
   - 起点から、同じ直線上に並ぶ見本の線をたどって連鎖させ、たどった見本の線を除く。
   - 「同じ直線上」の条件: 向きの差の sin < 0.06、相手の両端からこちらの直線までの距離 < tol0、2本の線の間の距離 ≤ 2pt。
3. **離れた小さなかたまりを除く**（文字など）。
   - 残った見本の線を、つながりでかたまりに分ける。
   - 「つながる」条件: 線どうしの距離（交われば 0）≤ tol0、かつ太さが近い（どちらかが 0、または差が大きい方の 10% 以内）。
   - 長さの合計が最大のかたまりの 25% 未満のかたまりを除く。
4. **戻す条件**: 残りが 2 本未満、または残りの長さが元の 40% 未満なら、整理をやめて元の見本を使う（`cleaned: false`）。
5. `bounds` は残った線の外接矩形。`tolerance = defaultVectorTolerance(bounds)`（**整理後の大きさで決め直す**）。
6. 見本の線が数千本を超える場合は O(n²) にならないよう格子で近傍を引く（上限を設けてよい。超えたら整理しない）。

### 3. 照合（`vectorSymbolSearch`）

1. 許容の既定を `defaultVectorTolerance` に変える（`searchVectorMessage` の重複した式も同じ関数を使う）。
2. 照合は、`prepareVectorTemplate` の結果（線・`bounds`・`tolerance`）を見本として行う。
   - `rect` は `bounds` を回して移した外接矩形。候補の枠は記号そのものに合う。
3. **逆向きの確かめ**。各候補について次を求め、`VectorSymbolMatch` に `extra`（0〜1）を足す。
   - 範囲: 候補の範囲（回して移した `bounds` ± tolerance）に両端が入るページの線。今の格子の索引で引く。
   - 0.5pt おきに点を取り、移した見本の線のどれかから `max(.2, tolerance × .45)` 以内にない点の長さの割合を `extra` とする。線が無ければ 0。
   - 候補は除外しない。
4. 結果に `template: { segments: 本数, length, removed, total, cleaned, rect: bounds }` を返す。
5. 時間: 見本の整理と逆向きの確かめを足しても、今の照合時間の 2 倍程度に収める。候補ごとにページ全体の線を走査しないこと。

### 4. 確度（`SymbolSearchClient.ts`・候補・画面）

1. 線で探した候補には**常に** `confidence` を付ける。
   - `high`: `extra ≤ 0.4`、かつ（画像の確認がオフ、または `imageScore ≥ 画像の下限`）
   - `check`: それ以外
   - 画像の下限の式（`imageConfidenceThreshold`）は変えない。
2. 画像の確認では、見本の画像を `request.sampleRect` ではなく、結果の `template.rect`（整理後の `bounds`）から描く。候補の位置の画像と大きさを合わせるため。
3. 候補に `extra?: number` を持たせる（メモリだけ）。
4. `<title>` の表示:
   - 線の候補: `線 0.93・余分な線 5%・画像 0.81`（画像の確認がオフなら画像を省く）
   - 画像の候補: 今のまま
5. パネルの結果に、整理したときだけ `見本の線 18 本（配線・文字とみて 24 本を除きました）` を出す。
6. 線の無いページ（画像の全面検索）は今のまま（`confidence` なし）。
7. ヘルプに次を足す。
   - 見本の枠に文字や配線が入っても、記号の本体だけで探すこと。
   - 線が余分にある候補（斜線入りの別の記号など）は「要確認」になること。

## テスト

### 単体（`tests/`）

- 取り出し:
  - 白い塗り（`1 g`・`1 1 1 rg`・`0 0 0 0 k`）は線にならず、`whiteFills` に数えられる。
  - 白でない塗りは今どおり線になる。
  - `widths` が `segments` と同じ本数で、CTM の拡大を反映する。
- `prepareVectorTemplate`（合成の線で）:
  - 細長い四角＋12 角形の円（太さ 0.7）、横に文字の形（太さ 0.42、離れている）、枠を横切る破線の配線（太さ 0.84）を含む見本 → 四角と円だけが残り、`removed.wiring`・`removed.other` が数えられる。
  - 戻す条件（残りが少ないとき元に戻る）。
  - `tolerance` が整理後の長辺の 3%（0.3〜1）。
- `vectorSymbolSearch`:
  - 細長い四角（幅 3pt・長さ 19pt）で、幅が 0.24pt 違う同じ記号も 0.9 以上で見つかる。
  - 同じ外形に斜線を足した記号は `extra > 0.4`。斜線の無い記号は `extra ≤ 0.1`。
- 既存の試験は通すこと。意図した変更で期待値が変わる試験は直してよいが、何をなぜ変えたか報告すること。

### 画面（e2e、書くだけ。実行は Claude Code が行う）

- `e2e/vector-search-snap.annotate.spec.ts`: 「画像でも確認する」をオフにしても、線の候補に `data-confidence` が付く。今の「付かない」の期待を変える。
- 斜線を足した記号が混ざる PDF（既存の試験の PDF の作り方に倣う）で探す。
  - 斜線入りは `data-confidence="check"`。
  - 「確度の高い候補を選ぶ」で斜線の無いものだけ選ばれる。
- 画像だけのページでは今どおり（`data-confidence` なし）。

## 禁止事項

- 線の無いページの画像検索の動作を変えないこと。
- 候補を除外しないこと（確度の印だけ）。候補を自動で数量に入れないこと。
- 画面のスレッドで照合・整理・逆向きの確かめをしないこと（Worker で行う）。
- PDF を開く・表示・スクロールのときに何もしないこと。線を取り出すのは今と同じ場面だけ。
- 線の取り出しで、MuPDF の包み（`Path` 等）をコールバックの中で解放する今の処理（SPEC-06j-1）を壊さないこと。
- Worker の入口のファイル（`*.worker.ts`）から値を export しないこと。
- 試験から `work/` へ書き込まないこと。対象外のファイルを変更しないこと。git の操作をしないこと。python・pytest は使わない。
- vitest は `process.env.MODE` を `test` で上書きする。環境変数で分岐するなら別の名前にすること。
- `npx tsc --noEmit` と単体試験は実行してよい。e2e は実行しなくてよい。

## 報告してほしいこと

- 変更したファイルと要点
- SPEC から逸脱した箇所と理由、変えた既存の試験の期待値とその理由
- 残課題
