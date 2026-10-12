# SPEC-B03f-1: 個数の印に構成要素を持たせる（データ・集計・取り消し）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: PDF に保存する印の形式の拡張、集計の索引、編集の履歴（取り消し）・引き継ぎ・項目の削除や改名との整合にまたがる

---

## 利用者の要望（2026-10-11）

> 数量拾いを行う際、スイッチに対してスイッチボックスを構成要素として追加できるようにして下さい。他の器具等についても同様に構成要素を「線要素を追加」のように追加できるようにして下さい。

経路（線の数量）には「主」と「追加」の線要素があり（`QuantityMark.extra`）、1本の経路で複数の項目を数える。これと同じ考え方を **個数の印**（`CountMark`）に入れる。スイッチ1個の印に「スイッチボックス 1個」「設備プレート 1個」を持たせ、集計表ではそれぞれの項目の数量になる。

この SPEC はデータ・集計・保存・取り消しまで。画面（構成要素の欄と追加の画面）は SPEC-B03f-2 で作る。

## 対象

- 変更: `src/core/counts.ts`、`src/core/quantityIndex.ts`、`src/editor/AnnotationStore.ts`
- 試験: `tests/counts.test.ts`（足す）、`tests/quantityIndex.test.ts`（足す）、新規 `tests/countComponents.test.ts`
- 変えない: 図面の上の描き方（`AnnotationLayer.tsx`・`countMarkers`）、CSV、Excel、集計表の画面

## 変更内容

### 1. 印の形式（`counts.ts`）

- `CountMark` の version 2 に `extra?: CountComponent[]` を足す。
  `export interface CountComponent { itemId: string; count: number; condition?: string }`
  - `itemId`: 1〜80文字。印の `fixtureId` と同じ値は不可。`extra` の中で重複不可。
  - `count`: 1〜99 の整数（構成要素の個数。印1個あたり）。
  - `condition`: `validCondition`（`quantity.ts`）を満たす文字。省略可。
  - 件数は 10 件まで。空の配列は持たない（省く）。
- `parseCount`:
  - 文字列の長さの上限を 400 から **2400** にする。
  - `extra` が無ければ今と同じ。`extra` があって上の条件に**合わない**ときは、`extra` だけを捨てて印そのものは読む（数を失わないため。経路とは扱いが違う）。
  - 読んだ `extra` は `{ itemId, count, condition? }` だけに詰め直す（余計な項目を持ち込まない）。
- `export function countMembers(mark: CountMark): CountComponent[]`: 先頭が主（`{ itemId: countFixtureId(mark), count: 1, condition }`。version 1 は condition なし）、続いて `extra` の写し。
- `export function validCountComponents(mainId: string, extra: readonly CountComponent[]): boolean`: 上の条件の検査（parseCount と store で同じ判定を使う）。
- `countSummary` は変えない（主の項目だけを数える。今の呼び出し元の意味を保つ）。

### 2. 集計（`quantityIndex.ts`）

- 個数の印を数えるとき、主の行（今と同じ）に続けて、`extra` の各構成要素を
  `{ itemId: e.itemId, annotationId: a.id, pageIndex: a.pageIndex, value: e.count, floor, room, condition: e.condition }` として `add` する。
- 構成要素の項目が `fixtures` に無いとき、またはその項目が個数の項目でない（`quantityMethod(f) !== 'click'`）ときは数えない（経路の追加の線要素が線の項目だけを数えるのと同じ）。
- 構成要素は `countPages`（`countEntriesOnPage`、図面ごとの印の数）に**入れない**。印の数は主だけ。
- 換算（`convert`）・図面別・階／部屋別・施工条件別は、今の `add` の仕組みでそのまま効く。集計表の「位置へ移動」は `annotationIds` を通じて主の印を指す（変更不要）。

### 3. 編集（`AnnotationStore.ts`）

1. **複製**: `cloneState` と `create` で、`count.extra` を深く写す（配列を共有しない）。
2. **新しい印への引き継ぎ**（経路の `lastRouteMembers` と同じ考え方）:
   - `private readonly lastCountComponents = new Map<string, CountComponent[]>()`（主の項目 ID → 最後に設定した構成要素）。
   - `create` で version 2 の印を作るとき、`count.extra === undefined` なら、`lastCountComponents.get(fixtureId)` を写して入れる。各構成要素の `condition` は、覚えている値があればそれ、無ければ `newCondition(e.itemId)`。今は存在しない項目・個数の項目でないものは除く。結果が空なら `extra` を持たない。`createCountMarks`（標準図記号の候補からの一括追加）も `create` を通るので同じく引き継ぐ。
   - 文書を読み込み直したとき（今 `lastRouteMembers.clear()` をしている所）に一緒に消す。
   - 取り消し: `PickupMemory` の要素に `components?: CountComponent[]` を足し、`pickupMemory`／`restorePickupMemory` で覚える・戻す（`members` と同じ扱い）。`pickupMemoryIds` は個数の印の構成要素の ID も含める。
3. **構成要素を設定する**:
   `setCountComponents(ids: readonly string[], extra: readonly CountComponent[], newFixtures: readonly CountFixture[] = []): string | undefined`
   - `ids` の中の、削除されていない個数の印（`a.count && !a.quantity && !a.legacyChange`）すべての `extra` を、同じ `extra` にする。version 1 の印は version 2 に上げる（`changeQuantityCondition` と同じ書き方）。
   - 印ごとに、主と同じ項目の構成要素は除いてから設定する（主を変えた印に同じ項目が残らないように）。
   - 検査（だめなら何も変えずに文を返す）: `newFixtures` を足した項目一覧で、各 `itemId` が存在し個数の項目（`quantityMethod === 'click'`）であること、`validCountComponents` を満たすこと、`newFixtures` の ID が既存と重ならないこと、足したあとの項目一覧が `serializeCountFixtures` を通ること、各印の `JSON.stringify(count)` が `parseCount` を通り `extra` を失わないこと。
     返す文の例: `構成要素は10件までです。`、`構成要素の値が不正です。`
   - 1回の履歴（Ctrl+Z 1回で、項目の追加も含めて戻る）。`newFixtures` があれば `before.fixtures`／`after.fixtures` を持つ（`addFixturesAndSetRouteItems` と同じ）。引き継ぎの記憶（2.）も before/after に入れる。
   - 対象の印の主の項目ごとに `lastCountComponents` を更新する（空の構成も「構成なし」として覚える）。
   - 変わる印が無く `newFixtures` も無ければ、履歴を積まない（記憶の更新はする）。
   - 戻り値: 成功で `undefined`。
4. **数える印**: 公開のメソッド `countMarkIdsOf(fixtureId: string): string[]` を足す（主がその項目の、削除されていない個数の印の ID。B03f-2 の「同じ項目の印すべてに反映」で使う）。
5. **項目の改名・削除**（`setCountFixtures`）:
   - 施工条件の改名（`renames`）を、構成要素の `condition` にも当てる（構成要素の項目の改名を使う）。`lastCountComponents` の中も同じく改名する（経路の `renameTemplate` と同じ。取り消しの記憶も同じく扱う）。
   - 削除する項目（`removeIds`）が構成要素にある印は、その構成要素だけを外す（印は残す）。主が削除される印は今と同じく削除。`lastCountComponents` からも外す。
   - 影響の判定（`affected`）に、個数の印の構成要素の ID も入れる。
   - `fixtureRemovalCounts`: 個数の印で、構成要素にだけその項目がある印は `detached` に数える。
6. **項目を変更**（`reassignCounts`）: 個数の印の主を変えたとき、新しい主と同じ項目の構成要素は外す。
7. **表示・非表示**（`isCountVisible`）: 個数の印は、主**または**構成要素のどれかの項目が表示なら表示（経路と同じ）。
8. `selectedPickupsOnly` 等の既存の判定は変えない。

## 試験

`tests/counts.test.ts` に:
- `extra` 付きの印が `parseCount(JSON.stringify(mark))` で同じ形に戻る（`condition` の有無とも）。
- 11件、`count` 0・100・1.5、主と同じ `itemId`、重複、不正な `condition` は `extra` が捨てられ、印は読める。
- 2400文字を超えると `null`。`countMembers` の並び。

`tests/quantityIndex.test.ts` に:
- スイッチの印 2 個（1個は `extra: [{ itemId: SB, count: 1, condition: '隠ぺい（埋込）' }, { itemId: PL, count: 2 }]`）→ SB の合計 1、PL の合計 2、スイッチの合計 2。SB の施工条件別が `隠ぺい（埋込）` で 1。階・部屋・図面別に入る。
- 構成要素の項目が無い・線の項目のときは数えない。`countEntriesOnPage` は主だけ（2件）。
- 換算のある構成要素の項目は換算される。

新規 `tests/countComponents.test.ts`（`tests/routeComposition.test.ts` の作り方に倣う）:
- `setCountComponents` で設定 → `undo` で戻る → `redo` で戻る。`newFixtures` 付きは `undo` で項目も消える。
- 設定したあと `create`（または `createCountMarks`）で作った同じ項目の印に構成要素が引き継がれる。別の項目の印には引き継がれない。空の構成を設定したあとは引き継がない。
- 構成要素の項目を `setCountFixtures(…, [SB])` で削除 → 印は残り、構成要素だけが外れる。`fixtureRemovalCounts(SB)` が `{ deleted: 0, detached: 1 }`。
- 構成要素の項目の施工条件を改名 → 印の構成要素の `condition` が新しい名前になる。
- 主の印の項目を、構成要素にある項目へ `reassignCounts` → その構成要素が外れる。
- 11件・線の項目・存在しない項目は文を返し、何も変わらない。
- `countMarkIdsOf` が主の項目の印だけを返す。

## 禁止事項

- 主の印の数え方、経路の扱い、図面の上の描き方を変えないこと。
- 依存パッケージを足さないこと。指定外のファイルを変えないこと。

## 検証項目（Claude Code が実行する）

- [ ] 型検査、単体（変更分・全件）、e2e（数量拾い関係: `count-fixtures`・`route-composition`・`quantity-table`・`review-cursor`）
