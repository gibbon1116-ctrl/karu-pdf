# SPEC-S02a: 形の細部の比較を、アプリの記号検索に組み込む（データの流れ。画面は変えない）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: Worker・メッセージ・取消しと、今の検索の結果を壊さないことにかかわるため

---

## 目的

SPEC-S01/S01b の試作（`src/core/symbolFeatureProfile.ts`）を、アプリの線の検索（ベクター検索）に組み込む。

- 候補ごとに、次の4つが見本と同じか・違うか・不明かを求める。
  - 上部の円弧（`topArc`）
  - 本体の外の枠（`annexFrame`）
  - 内部の斜線の本数（`interiorLines`）
  - 内部の塗り（`interior`）
- 結果を候補に付ける。

正解の5組の診断では、違う形の候補を「確定」にした数が 0 になり、要確認も減った（`docs/調査/標準図記号検索_実装記録_20261010.md`）。

この SPEC では、検索の依頼に `shapeCheck: true` を渡したときだけ動く。既定は `false` で、今の検索の結果・速度は変わらない。画面の設定と表示は、次の SPEC-S02b で行う。

## 現状の流れ（`src/client/SymbolSearchClient.ts`）

1. `vectorWorkerTask({type:'vector-search', …})` で、ベクター検索を新しい Worker で行う。
   - ページの線は `slice()` の写しを渡す（`VectorCache.ts`）。
2. ページの添字（`getLabels`）を割り当てる。
3. 次の条件のとき、局所画像の比較を行う。
   - 条件: `samplePage.paint && (paint が打切り || 見本の添字が無い)`。実図面ではほぼ常に成り立つ。
   - `describeLocal` で、候補の周りのタイルを `renderSearchImage` で描く（倍率は `min(8, 128/長辺)`）。
   - `local-describe` で、`describeLocalBody` と `describeLocalLabel` を求める。
4. `verify` が真なら、画像の確認（NCC）をして、確度（high/check）を決める。

## 変更内容

### 1. ベクター検索の Worker で、候補ごとの線の所有を求める（`src/worker/symbolSearchMessages.ts`）

**メッセージ**
- `VectorSearchMessage` に `features?: { complete: boolean; sampleComplete: boolean; samePage: boolean }` を足す。
- 応答 `vector-result` に `probes?: VectorFeatureProbes` を足す。
  ```ts
  export interface VectorFeatureProbes { sample: SymbolVectorFeatureProbe; matches: SymbolVectorFeatureProbe[]; ms: number }
  ```

**新しい純関数 `probeVectorMatches(message, result): VectorFeatureProbes | undefined`**
- `message.features` が無いか、`result` が null なら `undefined`。
- 線の集まり（`SymbolFeatureGeometry`）を作る。
  - 対象: `new SymbolFeatureGeometry(message.segments, message.segmentWidths, message.features.complete)`。
  - 見本: `samePage` なら対象と同じものを使う。違うページなら `new SymbolFeatureGeometry(message.sampleSegments, message.sampleWidths, message.features.sampleComplete)`。
- 姿勢（pose）。`t = result.template.rect`、`w = t[2]-t[0]`、`h = t[3]-t[1]`。
  - 見本: `{center:[(t[0]+t[2])/2,(t[1]+t[3])/2], width:w, height:h, angle:0}`。
  - 候補: `{center:m.center, width:w, height:h, angle:m.angle}`。
- 線幅は `result.template.strokeWidth`。
- 所有の線の上限: 全候補の `ownership.foreign` と `owned` の本数の合計が 200,000 を超えたら、それ以降の probe からは `ownership` を除く（除いた probe は、内部の比較が不明になる）。
- `ms` は、この関数にかかった時間。
- `matches` は、`result.matches` と同じ順・同じ長さ。

**Worker の入口**（`src/worker/symbolSearch.worker.ts`）
- `vector-search` で `searchVectorMessage` の後に `probeVectorMatches` を呼ぶ。
- 応答に `probes` を入れる。
- 入口ファイルに export を足さない（単一 HTML の Worker のため）。

### 2. 局所画像の Worker で、形の細部を求める

**メッセージ**
- `LocalDescribeMessage` に次を足す。
  ```ts
  shape?: { origin: Point; scale: number; probes: Array<SymbolVectorFeatureProbe | undefined> }
  ```
  - `origin` は、タイルの左上（表示 pt）。
  - `scale` は、タイルの倍率（px/pt）。
  - `probes` は、`bodies` と同じ順・同じ長さ。
- 応答の各 body に `shape?: LocalShape` を足す。
  ```ts
  export interface LocalShape {
    features: ReturnType<typeof confirmSymbolVectorFeatures>
    interior: SymbolInteriorProfile
  }
  ```
  - 型 `LocalDescribedBody = LocalBody & { shape?: LocalShape }` を、`symbolSearchMessages.ts` に置く。`symbolLocalImage.ts` は変えない。

**新しい純関数 `describeLocalMessage(message): LocalDescribedBody[]`**（`symbolSearchMessages.ts` に置く）
- 今の Worker の `local-describe` の処理（上限の確認、`describeLocalBody`、`describeLocalLabel`）を、そのまま移す。
- `message.shape` があれば、probe のある body ごとに求める。
  - 画像は `img = {...message.image, origin: message.shape.origin, scale: message.shape.scale}`。
  - `features = confirmSymbolVectorFeatures(probe, img)`。
  - `interior = describeSymbolInterior(img, probe.pose, probe.ownership)`。
- 入力の確認。違反したら例外（今の上限の例外と同じ扱い）。
  - `probes.length === bodies.length`。
  - `scale` が正の有限数。
  - `origin` が有限。
- Worker の入口は、この関数を呼ぶだけにする。

### 3. 判定の純関数（新しいファイル `src/core/symbolShapeDecision.ts`）

```ts
export type SymbolShapeFeature = 'topArc' | 'annexFrame' | 'interiorLines' | 'interior'
export interface SymbolShapeDecision { decision: 'same' | 'different' | 'unknown'; differences: SymbolShapeFeature[]; unknown: SymbolShapeFeature[] }
export function decideSymbolShape(sample: LocalShapeLike | undefined, target: LocalShapeLike | undefined): SymbolShapeDecision
```

- `LocalShapeLike` は `{ features: {topArc; annexFrame; interiorLineCount?}; interior: SymbolInteriorProfile }`。
- 見本か候補が無ければ、4つすべてを `unknown` に入れて `unknown` を返す。
- `topArc`・`annexFrame`:
  - どちらかが `'unknown'` なら不明。
  - 値が違えば違い。
- `interiorLines`:
  - どちらかが `undefined` なら不明。
  - 数が違えば違い。
- `interior`:
  - `compareSymbolFills(sample.interior, target.interior)` が `different` なら違い、`unknown` なら不明。
- 結果:
  - 違いが1つでもあれば `different`。
  - そうでなく、不明が1つでもあれば `unknown`。
  - それ以外は `same`。

### 4. 検索の流れ（`src/client/SymbolSearchClient.ts`）

**依頼と結果の型**
- `SymbolSearchRequest` に `shapeCheck?: boolean` を足す。既定は `false`。
- `SymbolCandidate` に `shape?: SymbolShapeDecision` を足す。
- `SymbolSearchMetrics` に次を足す（`shapeCheck` のときだけ）。
  - `shapeMs?: number`
  - `shapeDifferent?: number`
  - `shapeUnknown?: number`

**`shapeCheck` が真のとき**
- `vector-search` に `features` を渡す。
  - `complete: !target.truncated && target.kind === 'vector'`
  - `sampleComplete: !samplePage.truncated && samplePage.kind === 'vector'`
  - `samePage: request.pageIndex === request.samplePageIndex`
  - 画像を含むページ（`mixed`）では線だけで判断しない。
- 応答の `probes` を受け取る。
- `describeLocal` に、省略できる引数 `probes` を足す。
  - 渡されたとき、タイルごとに `shape: {origin: [tile.rect[0]/scale, tile.rect[1]/scale], scale, probes: tile.indices.map(i => probes[i])}` を送る。
- **今の局所画像の比較が動くとき**（上の条件が成り立つとき）
  - その2回の `describeLocal`（見本、候補）に、それぞれ `[probes.sample]` と `probes.matches` を渡す。
  - 描画を増やさない。
  - `keep` で候補を減らすときは、形の結果も同じように減らす。
- **今の局所画像の比較が動かないとき**
  - 形のためだけに `describeLocal` を見本・候補に1回ずつ行う。倍率は今と同じ `min(8, 128/長辺)`。
  - 添字の処理（`valueFromImage` など）は行わない。
- 候補ごとに `decideSymbolShape(見本の shape, 候補の shape)` を求めて、`shape` に入れる。
- 確度: `shape.decision !== 'same'` の候補は `'check'` にする（`finishVector` の今の条件に足す）。
  - 候補は消さない。違う形の候補を隠すのは、SPEC-S02b の画面で行う。
- 今の `compareLocalBody` による除外（`keep`）と `structureCheck` の扱いは変えない。
- `shapeMs` は、`probes.ms` と、クライアントで判定にかかった時間の合計。
  - 局所画像の描画・記述の時間は、今どおり `localMs` に入る。

**`shapeCheck` が偽・未指定のとき**
- 今とまったく同じに動く。`features` を渡さず、`shape` を付けない。

**取消し・解放**
- 今の `check()`、`run.abort`、watchdog、遅れて届いた応答の破棄を守る。
- probe と形の結果は、検索の間だけ持つ。キャッシュに入れない。

## 試験

**単体**
1. `tests/symbolShapeDecision.test.ts`: 上の規則（同じ・違う・不明・欠け）。
2. `tests/symbolSearchMessages.shape.test.ts`
   - 今の `tests/symbolFeatureProfile.test.ts` の作り方で、MuPDF でページを作る。
     - 半円の本体と円弧を持つ記号2つ。
     - 円弧の無い記号2つ。
   - `searchVectorMessage` と `probeVectorMatches`:
     - `features` があるとき、`probes.matches` が `result.matches` と同じ長さで、円弧の有無の probe が正しい。
     - `features` が無いとき `undefined`。
     - `complete: false` で、probe が `complete: false`。
   - `describeLocalMessage`:
     - `shape` を渡すと、各 body に `shape` が付く。
     - 今の `describeLocalBody`・`label` の結果は、`shape` の有無で変わらない。
     - `probes` の長さが違うと例外。
   - 所有の線の上限: 小さい上限で確かめられるように、上限を引数（既定 200,000）にしてよい。
3. 既存の試験がすべて通ること。特に次のもの。
   - `tests/symbolSearch.test.ts`、`tests/vectorWorkerPool.test.ts`、`tests/symbolLocalImage.test.ts`
   - `tests/symbolGlyphs.test.ts`、`tests/vectorSymbolSearch.test.ts`、`tests/symbolFeatureProfile.test.ts`

**画面（e2e）**
- この SPEC では足さない（SPEC-S02b で足す）。

## 対象

- 対象フォルダ: `C:\Users\gibbo\.codex\worktrees\dfd5\PDF編集アプリ`
- 変更してよいファイル:
  - `src/worker/symbolSearchMessages.ts`、`src/worker/symbolSearch.worker.ts`
  - `src/client/SymbolSearchClient.ts`
  - `src/core/symbolShapeDecision.ts`（新規）
  - `tests/`（新規の試験2つ）
- 変更しないファイル: 上以外。
  - `src/core/symbolFeatureProfile.ts`、`src/core/vectorSymbolSearch.ts`、`src/client/VectorCache.ts`、画面、保存の形式を含む。
  - `VectorCache.ts` の `vectorWorkerTask` は、メッセージをそのまま写して送るので、変えずに `features`・`shape` が届く。届かない場合は、変更せずに理由を報告すること。

## 禁止事項

- `shapeCheck` が偽のときの動作・結果・速度を変えないこと。
- 候補を消さないこと（`shape` で除外しない）。
- 通常の閲覧・PDF の読込・スナップ・保存に処理を足さないこと。
- `VectorPage`・スナップの配列を書き換えないこと。
- Worker の入口ファイルに export を足さないこと。
- 実図面の座標・器具名で分岐しないこと。
- git の操作をしないこと。python・pytest は使わない。

## 報告してほしいこと

- 変更したファイルと要点
- SPEC から逸脱した箇所と理由
- Claude Code に実行してほしい試験
