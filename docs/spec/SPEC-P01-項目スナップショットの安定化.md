# SPEC-P01: 項目スナップショットの安定化

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 中核ストアの状態管理と、2つの画面の再計算条件を変える判断を伴うため既定の sol-high。

---

## 目的

フェーズ0の実測（1,000項目×10,000拾い）で、項目を選ぶだけで集計表が7回描画され、そのたびに `getCountFixtures()` の深い複製（約5 ms）・`buildQuantityTableData`・`projectQuantityTable`・`linkRelations` を作り直していた（選択1回で約75 ms）。
原因は `getCountFixtures()` が毎回新しい複製を返すため、`useMemo([fixtures])` が毎回外れること。
項目定義が変わったときだけ新しくなる、不変で安全な UI 用スナップショットを作り、QuantityTable と FixturePanel がそれを使うようにする。

## 対象

- `src/editor/AnnotationStore.ts`
- `src/app/QuantityTable.tsx`
- `src/app/FixturePanel.tsx`
- 新規 `tests/AnnotationStore.fixtureSnapshot.test.ts`

## 変更内容

### 1. AnnotationStore（項目の版と UI 用スナップショット）

1. `private fixturesRevision = 0` と `private fixturesSnapshotCache: { revision: number; value: readonly CountFixture[] } | null = null` を追加。
2. **`this.fixtures = ...` の代入をすべて** 新しい private メソッド `private replaceFixtures(next: CountFixture[]): void { this.fixtures = next; this.fixturesRevision += 1 }` 経由に置き換える。
   現状の代入箇所（すべて対象。見落とし禁止）: `reset()`、`ensureCountFixtures()` の読込完了、構成要素・経路の追加で項目を足す2か所（`this.fixtures = structuredClone(fixtures)`）、`setCountFixtures()`、注釈の一括変更で項目も変える箇所（`if (fixtures) { before.fixtures = ...; this.fixtures = structuredClone(fixtures) }`）、`restoreMany()`（Undo/Redo）。
   ほかに `this.fixtures` へ代入する箇所があればそれも同じにする。`this.fixtures` の配列や要素をその場で書き換えている箇所があれば報告する（現状は無いはず）。
3. 公開メソッドを追加:
   ```ts
   /** 項目定義の版。項目の配列を置き換えるたびに増える（単調増加）。 */
   getFixturesRevision(): number
   /** 画面用の項目一覧。版が同じあいだは同じ配列を返す。配列・要素・入れ子をすべて Object.freeze 済み。内部の配列とは別物。 */
   getCountFixturesSnapshot(): readonly CountFixture[]
   ```
   `getCountFixturesSnapshot()` はキャッシュの revision が現在と違うときだけ `structuredClone(this.fixtures)` を作って深く freeze（配列・各項目・入れ子のオブジェクトと配列を再帰的に）し、キャッシュする。
   作る処理を `perfTime('store.fixturesSnapshot.build', ...)` で包む（`perfTime` は既に import 済み）。
4. **`getCountFixtures()` は変えない**（毎回、呼び出し元が変更してよい新しい複製を返す契約を保つ）。`getCountFixture(id)` など他の既存メソッドも変えない。
5. 通知（`notify`）、`quantityVersion`、`version`、`getSnapshot`、`subscribe` は変えない。

### 2. QuantityTable.tsx

- 描画中の `const fixtures = store.getCountFixtures()` を `const fixtures = store.getCountFixturesSnapshot()` に変える。
- `useSyncExternalStore(store.subscribe, store.getSnapshot)` はそのまま残す（数量の索引や選択の変化で描画するため）。
- `fixtures` と、それから作られる `data`（`TableItem.fixture` など）を書き換えている箇所が無いか確認する。書き換えがあれば、その箇所だけ局所的に複製してから書き換える（freeze 済みの値を変更すると例外になるため）。
- 出力（Excel/CSV など）で `store.getCountFixtures()` を呼んでいる箇所はそのまま（可変の複製が必要な場所）。
- `useMemo` の依存配列は変えない。`fixtures` の参照が安定することで、項目定義が変わらない限り `linkRelations` / `buildQuantityTableData` / `projectQuantityTable` が再実行されなくなる。

### 3. FixturePanel.tsx

- `const fixtures = useMemo(() => store.getCountFixtures(), [store, version])` を `const fixtures = store.getCountFixturesSnapshot()` に変える。`version` は他の useMemo/useEffect が使っているので変数は残す。
- `fixtures`（と `groups`, `categories`, `outlineGroups`, `panelGroups`, `selected` などそこから派生する値）を書き換えている箇所、または子コンポーネントへ渡して子が書き換える可能性がある箇所を確認する。
  ダイアログの初期値（`setDialog({ initial: ... })` など）に渡すときは、子が書き換えても安全なように `structuredClone` した値を渡す。既に `getCountFixtures()` を呼んで可変の複製を得ている箇所は変えない。
- それ以外の動作・表示・依存配列は変えない。

### 4. 試験 `tests/AnnotationStore.fixtureSnapshot.test.ts`（新規）

既存の `tests/AnnotationStore.symbolSearch.test.ts` の作り方（`ensureCountFixtures(async () => [...], async () => {})`）にならう。項目は数件でよい。

1. 選択・画面だけの操作で同じ配列が返る: `selectFixture`、`flashPickup`（vi.useFakeTimers で 1500 ms 進めて消えるところまで）、`setHighlightedVertex`、`setCurrentLocation('floor', '2階')`、`setShowQuantityValues(false)`、図記号候補の `beginSymbolCandidates` / `clearSymbolCandidates` の前後で、`getCountFixturesSnapshot()` が `toBe` で同じ、`getFixturesRevision()` も同じ。
2. 拾いの追加・Undo/Redo（項目は変えない `createCountMarks`）でも同じ配列が返る（拾いだけでは項目定義は変わらない）。
3. 項目定義が変わる操作で新しい配列になり、内容が `getCountFixtures()` と `toEqual`: `setCountFixtures` で追加・削除・名称変更・並べ替え、それぞれの `undo()` と `redo()`、`reset()`、もう一度 `ensureCountFixtures` で読み込み。各操作で revision が増える（前より大きい）。
4. freeze: 返った配列・各項目・`style` などの入れ子が `Object.isFrozen`。`getCountFixtures()` の戻り値を書き換えてもスナップショットと次の `getCountFixtures()` は変わらない。スナップショットは内部配列と別物（`setCountFixtures` 前に取ったスナップショットは、その後も古い内容のまま）。
5. `getCountFixtures()` は呼ぶたびに別の配列（`not.toBe`）で、書き換えてもよい（freeze されていない）。

## 禁止事項

- 数量・集計・内訳書・保存・Undo/Redo・通知の結果や順序を変えないこと。
- `getCountFixtures()` の複製を返す契約を変えないこと。内部の `this.fixtures` 配列やその要素を外へ返す新しい経路を作らないこと。
- `subscribe` / `getSnapshot` / `notify` を置き換えないこと（このフェーズでは全体通知の仕組みに手を入れない）。
- 指定ファイル以外を変えないこと。関数名・export 名を変えないこと。
- 外部通信・新規パッケージ・https:// を含む文字列を足さないこと。

## 報告してほしいこと

- `replaceFixtures` に置き換えた代入箇所の一覧（関数名）
- QuantityTable / FixturePanel で、freeze 済みの値を書き換えうる箇所の確認結果と対処
- SPEC から外れた所と理由


## 依頼側で確認済みのこと

FixturePanel が fixtures/fixture を渡す子（CountMarker, FixtureHoverCard, FixturePresetDialog, QuantityBreakdown, QuantityCsvExportDialog, RecentFixtures, BreakdownMoveDialog, FixtureDialog）のソースを grep し、受け取った fixtures 配列や項目を書き換える箇所は無かった（FixturePresetDialog の `fixture.link = ...` は自分で新しく作った項目への代入）。子のファイルは変更しないこと。
