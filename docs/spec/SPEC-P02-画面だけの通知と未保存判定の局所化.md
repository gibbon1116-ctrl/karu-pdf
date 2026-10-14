# SPEC-P02: 画面だけの通知と未保存判定の局所化

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 中核ストアの通知の分類と未保存判定の失効条件を変える、取り違えると未保存警告の偽陰性になる判断を伴うため既定の sol-high。

---

## 目的

フェーズ0の実測（1,000項目×10,000拾い）で、項目を選ぶだけで `dirtySummary()` の全量計算（全注釈の基準比較＋項目の JSON 比較）が 1 回 343 ms 走っていた。
原因: `dirtySummary()` のキャッシュが全体の `version` に結び付いていて、選択・ホバー・フラッシュなど保存内容を変えない通知でも外れる。App は通知ごとに描画し `session.dirty` → `isDirty()` → `dirtySummary()` を呼ぶ。

保存内容（未保存判定の材料）を変えない通知を、監査済みの一覧に限って「画面だけの通知」に分け、未保存判定のキャッシュを保存内容の版に結び付ける。

## 対象

- `src/editor/AnnotationStore.ts`
- 新規 `tests/AnnotationStore.contentRevision.test.ts`

## 変更内容

### 1. 保存内容の版

1. `private contentRevision = 0` を追加。公開メソッド `getContentRevision(): number`（単調増加）を追加。
2. 既存の `private notify(quantityChanged = true)` は、**先頭で `this.contentRevision += 1`** を行うようにする。それ以外（計数器、quantityVersion、候補の再判定、version、リスナー）は今のまま。
   → 既定ではすべての通知が保存内容の版を進める（安全側）。
3. 新しい `private notifyUi(): void` を追加: `perfCount('store.notify.uiOnly')`、`this.version += 1`、`perfCount('store.listenerCalls', this.listeners.size)`、リスナー呼出し。`contentRevision` と `quantityVersion` は進めない。候補の再判定もしない。
4. `dirtySummary()` のキャッシュ判定を `this.dirtyCache?.version === this.version` から **`contentRevision`** に変える（`dirtyCache` の型のキー名も `contentRevision` に変える）。

### 2. `notify(false)` → `notifyUi()` に置き換えてよいメソッド（監査済みの許可一覧）

下の各メソッドについて、**そのメソッドの中で `notify(false)` の前に変わる状態が、未保存判定の材料（下記）と注釈の内容のどれにも触れないことを確認してから** `notifyUi()` に置き換える。
1つでも触れる、または確信が持てないメソッドは置き換えずに `notify(false)` のまま残し、報告に理由を書く。

未保存判定の材料: `annotations`（各注釈の保存される内容と `deleted`）、`baselines`、`fixtures`、`fixtureBaseline`、`scales` / `scaleBaselines`、`scaleRegions` / `scaleRegionBaselines`、`drawings` / `drawingDirtyBaselines`、`roomRegions` / `roomRegionBaselines`、`pageRoomSets` / `pageRoomSetBaselines`、`roomSets` / `roomSetBaseline`、`quantityChecks` / `quantityCheckBaseline` / `quantityChecksReady`、`editEntries()` が参照するもの全部。

許可一覧（候補）:
- 強調・フラッシュ: `setHighlightedVertex`, `setHighlightedRise`, `flashPickup`（2か所とも）
- 図記号候補: `setSymbolSearchArea`, `setSymbolCandidateFilters`, `setSymbolShapeFilter`, `setSymbolOtherFilter`, `clearSymbolCandidates`, `beginSymbolCandidates`, `appendSymbolCandidates`, `toggleSymbolCandidate`, `chooseSymbolCandidates`, `chooseHighConfidenceCandidates`
- 表示の絞り込み: `setAnnotationFilter`, `setDrawingFollowsFilter`, `setFixtureVisible`, `setShowQuantityValues`, `setOnlySelectedFixture`, `showAllFixtures`, `setShowRoomRegions`
- 選択: `selectFixture`, `prepareCountTool`, `selectOnly`, `toggleSelection`, `clearSelection`, `selectInRect`
- 拾いの既定値（保存も未保存判定もしない記憶）: `setCurrentLocation`, `setRouteTemplate`, `setPickupMethod`, `rememberRouteFixture`, `clearRouteInheritance`
- 操作モードの開始・終了: `startAreaHoles`, `endAreaHoles`, `startRoomCapture`, `endRoomCapture`, `startRoomEdit`, `endRoomEdit`, `startRoomSetAlign`, `endRoomSetAlign`

**置き換えない（`notify(false)` のまま）**: `loadDrawingInfos`, `applyAutomaticDrawingInfo`, `setDrawingInfo`, `loadScaleRegions`, `loadRoomRegions`, `setRoomRegions`, `loadRoomSets`, `changeRoomSets`, `ensureQuantityChecks`, `setQuantityCheckBasic`, `touch`、および上の一覧に無いすべての呼出し。

`releaseDrawingFilter` のように許可一覧のメソッドから別のメソッドを呼ぶ場合、呼ばれた側が自分の通知を出すので、それぞれ独立に判定する。

### 3. 通知なしの書き換えの点検

`this.annotations` の要素、`baselines`、上記の未保存判定の材料を書き換えたのに `notify()` / `notify(false)` を呼ばない経路があると、これまでは後の画面だけの通知でキャッシュが外れて正しくなっていたが、変更後は古い未保存判定が残る。
AnnotationStore 全体を点検し、そのような経路（例: 保存結果の反映 `markApplied`、読込 `ensurePageLoaded` 系、`setLayout`、`deferNotify` で通知を後回しにする経路、`reset`）を探して、**材料を変えた後に必ず `contentRevision` が進む**ようにする。
進めるだけでよく通知が不要な場所は `this.contentRevision += 1` を直接書く（通知を増やさない）。点検結果を報告に一覧で書く。

### 4. 変えないこと

- `subscribe` / `getSnapshot`（`version` を返す）/ `quantityIndex()` / 計数器の名前は今のまま。画面の購読側はこのフェーズでは変えない。
- `isDirty()`、`dirtySummary()` の返す内容・意味。

### 5. 試験 `tests/AnnotationStore.contentRevision.test.ts`（新規）

既存の `tests/AnnotationStore.symbolSearch.test.ts` の作り方にならう。`setPerfEnabled(true)` / `resetPerfCounters()` / `getPerfCounters()`（`src/perf/counters.ts`）で `store.dirtySummary.compute` の回数を数える。

1. 拾い数件を作った状態で `dirtySummary()` を1回呼んだ後、許可一覧の代表（`selectFixture`、`selectOnly`、`clearSelection`、`setHighlightedVertex`、`flashPickup`＋タイマー経過、`setAnnotationFilter`、`setFixtureVisible`、`beginSymbolCandidates`→`appendSymbolCandidates`→`clearSymbolCandidates`、`setCurrentLocation`）を各10回程度行い、そのたびに `isDirty()` と `dirtySummary()` を呼んでも `store.dirtySummary.compute` が増えないこと、`getContentRevision()` が変わらないこと、`getSnapshot()` は増えること。
2. 保存内容が変わる操作では未保存判定が正しく更新されること（各操作の直後に `dirtySummary()` が、キャッシュを使わず新しく計算した場合と同じ値＝別インスタンスのストアで同じ操作をした結果か、期待値の直書きで比較）:
   拾いの追加 → `annotations` が増える、`undo()` で戻る、`redo()`、`setCountFixtures` で項目の名称変更 → `fixtures: true`、その `undo()` で `fixtures: false`、`setDrawingInfo` → `drawings` にそのページ、`setRoomRegions` → `rooms`、`setQuantityCheckBasic`（使えるなら）→ `quantityChecks`。
3. 保存の反映: `toEdits()` → `markApplied(...)`（既存試験 `tests/AnnotationStore.test.ts` 等で使われている成功結果の形にならう。見つからなければこの項目は省き報告）の後で `isDirty()` が false になり、その後の選択だけでは false のまま、拾いを1つ足すと true。
4. `notifyUi()` を使うメソッドでもリスナーは呼ばれる（`subscribe` したリスナーの呼出し回数が増える）。

## 禁止事項

- 未保存警告の偽陰性を作らないこと（迷ったら `notify(false)` のまま）。
- 数量・集計・保存・Undo/Redo・通知の順序を変えないこと。許可一覧の置き換え以外で通知の回数を変えないこと。
- 指定ファイル以外を変えないこと。関数名・export 名を変えないこと。
- 外部通信・新規パッケージ・https:// を含む文字列を足さないこと。

## 報告してほしいこと

- `notifyUi()` に置き換えたメソッド一覧と、置き換えなかった許可一覧のメソッドとその理由
- 「通知なしの書き換え」の点検結果（場所と対処）
- SPEC から外れた所と理由
