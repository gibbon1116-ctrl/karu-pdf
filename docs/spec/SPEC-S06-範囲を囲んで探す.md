# SPEC-S06: 「同じ記号を探す」で、囲んだ範囲の中だけを探す

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 見本の切り取りの仕組み（App の状態）を、パネルを閉じずに使い回す。中止・別文書・ページ編集との関係を壊さない判断が要る

---

## 利用者の要望

> 同じ記号を探すで記号の検索をするとき、範囲を指定して、指定した範囲内のみで検索をする機能を追加したい。

## 現状（Claude Code が確かめたこと）

- 検索の範囲は「このページ」「ページを指定」「すべてのページ」の 3 つ（`SymbolSearchPanel.tsx`）。
- `SymbolSearchClient.search` は `searchRect` をすでに受け取れる。
  - 線の検索では `options.region` になり、候補の四角が範囲に完全に入るものだけを残す（`vectorSymbolSearch.ts` 438 行付近）。
  - 画像の検索では、範囲だけを描いて探す。
  - パネルからは今は渡していない（ページ全体）。
- 四角を囲む操作は、App の `sampleCapture` と `AnnotationLayer` の `FixtureSampleSelection` が担う。
  - 囲み終わると `completeFixtureSample` が見本の画像を作り、`resolve(sample)` を呼ぶ。
  - Esc・「中止」・文書やページの切替では `finishSampleCapture(null)` を呼ぶ。

## 変更内容

### 1. パネル（`src/app/SymbolSearchPanel.tsx`）

- 「探す範囲」に 4 つ目の選択肢「範囲を囲む」を加える（`scope` の値 `'area'`）。
- 囲んだ範囲は `area: { pageIndex: number; rect: Rect } | null` としてパネルの状態に持つ。
- 「範囲を囲む」を選んだとき：
  - 範囲がまだ無ければ、すぐに囲む操作を始める（下の `onRequestArea`）。
  - 選択肢の下に、範囲の説明とボタンを出す。
    - 範囲があるとき：`p.{ページ番号} の範囲（{幅} × {高さ} mm）` と、ボタン「範囲を囲み直す」。
      - mm は pt × 25.4 / 72 を四捨五入した整数。
    - 範囲がないとき：「範囲を囲んでください」と、ボタン「範囲を囲む」。
- 囲む操作の結果：
  - 範囲が返れば `area` を設定し、`invalidate()` で前の候補を消す（条件を変えたときと同じ）。
  - 中止（`null`）なら、前の `area` をそのまま残す。
- 「探す」：
  - `scope === 'area'` で `area` が無いとき：エラー「範囲を囲んでください」を出し、探さない。
  - 範囲の幅か高さが、見本の四角（`selection.rect`）の幅か高さより小さいとき：エラー「範囲が見本より小さいため探せません。広く囲んでください」を出し、探さない。
  - それ以外：探すページは `[area.pageIndex]` だけにし、`client.search` に `searchRect: area.rect` を渡す。
  - ほかの範囲（このページ・ページを指定・すべて）では `searchRect` を渡さない（今と同じ）。
- 囲む操作の最中に「探す」を押せないようにする（`capturingArea` の間は「探す」を無効）。
- `scope` を `'area'` 以外に替えたとき、`area` は消さずに残す（戻したときに使える）。ただし図面上の枠（下の 3）は消す。

### 2. App（`src/App.tsx`）

- `sampleCapture` の状態に、範囲を囲む用の項目を足す。
  - 例：`area?: true` と `resolveArea(area: { pageIndex: number; rect: Rect } | null)`。形は任せる。
- `completeFixtureSample(pageIndex, rect)` で、範囲を囲む操作のとき：
  - 見本の画像を作らない（`pool.renderFixtureSample` を呼ばない）。
  - 幅・高さのどちらかが 2mm 未満なら、今と同じ「範囲が小さすぎます」の案内を出して続ける。
  - それ以外は `{ pageIndex, rect }` を返して終わる。
- 範囲を囲む操作の案内文：「探す範囲を四角で囲んでください（Esc で中止）」。
- Esc・「中止」・`finishSampleCapture(null)` では、範囲を囲む操作も `null` で終わる（Promise を必ず解決する）。
- パネルに `onRequestArea(): Promise<{ pageIndex: number; rect: Rect } | null>` を渡す。
  - パネルを閉じない。`symbolSearch` の状態を変えない。
  - パネルが閉じられた・文書が替わった場合も、Promise は `null` で解決する。
- 範囲を囲む操作を、`closeSymbolSearch` の「見本の囲み中なら終える」と同じ扱いにする（パネルを閉じたら囲む操作も終える）。
- 範囲を囲む操作の最中は、`sampleCapture.symbolFixtureId` を設定しない（見本を囲み直す操作と区別する）。ただし、上の「パネルを閉じたら終える」は守る。

### 3. 図面上の範囲の枠（`src/editor/AnnotationStore.ts`、`src/editor/AnnotationLayer.tsx`、`src/styles.css`）

- ストアに `symbolSearchArea: { pageIndex: number; rect: Rect } | null`（初期値 `null`）と、設定する関数 `setSymbolSearchArea(area)` を足す。
  - 設定で `notify(false)` を呼ぶ（保存状態を変えない）。
  - `clearSymbolCandidates()` でも `null` に戻す（パネルを閉じたとき枠が残らない）。
- パネルは、`scope === 'area'` で `area` があるとき、枠を表示する（`setSymbolSearchArea(area)`）。それ以外は `null`。
  - パネルが外れるとき（dispose）は `null` に戻す。
- `AnnotationLayer` は、`store.symbolSearchArea?.pageIndex === props.pageIndex` のとき、ページ全体の `svg` に破線の四角を描く。
  - `data-testid="symbol-search-area-{pageIndex}"`、class `symbol-search-area`。
  - 操作を受けない（`pointer-events: none`）。候補の枠より下に描く。
  - 線は青系の破線、塗りは無し。`vector-effect: non-scaling-stroke`。
- 通常の閲覧（検索パネルを開いていない）では、この `svg` を作らない。

### 4. ヘルプ（`src/app/HelpDialog.tsx`）

同じ記号を探すの説明に、次を足す。

> 「探す範囲」で「範囲を囲む」を選ぶと、図面を四角で囲んだ範囲の中だけを探します。範囲に完全に入る記号だけが候補になります。囲み直すときは「範囲を囲み直す」を押してください。

## 変えないこと

- 「このページ」「ページを指定」「すべてのページ」の検索の結果と速さ。
- 見本を囲む操作（「同じ記号を探す」「見本を囲み直す」「図面から見本を切り取る」）の動き。
- 保存データ。範囲は保存しない。
- `SymbolSearchClient`・Worker・`vectorSymbolSearch` は変えない（`searchRect` はすでに使える）。

## 試験

**画面の試験**（新規 `e2e/symbol-search-area.annotate.spec.ts`）

- `tests/symbolShapeFixtures.ts` の `symbolShapePdf()` と `symbolShapeSampleRect` を使う。
  - この図面の本体は 8 つ。4 つが y < 100、4 つが y > 100（`e2e/symbol-other-fixture.annotate.spec.ts` を参考に）。
- 手順と確かめること：
  1. 項目を追加し、見本を囲んでパネルを開く。形の細部と画像の確認は外す（参考の試験と同じ）。
  2. 「範囲を囲む」を選ぶ → 案内「探す範囲を四角で囲んでください」が出る。
  3. 上半分（y < 100 の 4 つを完全に含み、下の 4 つを含まない四角）を囲む。
     - パネルが閉じない。
     - `symbol-search-area-0` が見える。
     - `p.1 の範囲（… mm）` の表示が出る。
  4. 「探す」→ 候補は 4 件、すべて y < 100。
  5. 「範囲を囲み直す」→ Esc で中止 → 前の範囲が残る（表示と枠）。
  6. 「このページ」に替える → 枠が消える。「探す」→ 候補 8 件（今と同じ）。
  7. 「範囲を囲む」に戻す → 前の範囲で枠が出る。
  8. 見本より小さい範囲を囲む → 「探す」で「範囲が見本より小さいため探せません」が出て、候補は増えない。
  9. 「閉じる」→ 枠が消える。

**単体の試験**（`tests/` にある AnnotationStore の試験に足す。無ければ新しい試験ファイル）

- `setSymbolSearchArea` で設定・`null` に戻せる。`clearSymbolCandidates()` で `null` になる。
- 設定しても保存の変更扱いにならない（`notify(false)`）。既存の試験の書き方に合わせる。

**変わらないことの確認**（Claude Code が実行する）

- `e2e/symbol-search.annotate.spec.ts`、`e2e/symbol-other-fixture.annotate.spec.ts`、`e2e/symbol-shape.annotate.spec.ts`、`e2e/symbol-labels.annotate.spec.ts`。

## 対象

- 変更してよいファイル：
  - `src/app/SymbolSearchPanel.tsx`、`src/App.tsx`、`src/editor/AnnotationStore.ts`、`src/editor/AnnotationLayer.tsx`、`src/styles.css`、`src/app/HelpDialog.tsx`
  - 新しい試験ファイル、AnnotationStore の既存の試験ファイル
- 変更しないファイル：上以外。

## 禁止事項

- 関数名・入力名・既存の文言を、SPEC にない形で変えないこと。
- git の操作をしないこと。python・pytest は使わない。

## 報告してほしいこと

- 変更点、SPEC から逸脱した箇所と理由、Claude Code に実行してほしい試験。
