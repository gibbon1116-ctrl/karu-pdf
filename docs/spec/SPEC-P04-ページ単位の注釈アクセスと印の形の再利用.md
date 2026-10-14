# SPEC-P04: ページ単位の注釈アクセスと印の形の再利用

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 描画に使う注釈の取得をキャッシュへ置き換え、更新漏れが表示の欠落・残留になる判断を伴うため既定の sol-high。

---

## 目的

フェーズ2後の CPU プロファイル（1,000項目×10,000拾い、100頁、項目選択10回）で、選択1回あたり:

- `getPageAnnotations()` の各注釈の複製（`cloneState`）と未保存判定（`samePersisted` → `stableJson` 2回）: 約 70 ms。AnnotationLayer が描画のたびに呼び、表示中15ページぶん走る。
- 個数の印の形（`countMarkerData` の三角関数による多角形とその移動）: 約 70 ms。印ごと・描画ごとに同じ形を作り直している。
- `countOverlayObjNums` / `issueOverlayObjNums`: 1回 17 回呼ばれ、毎回全注釈を走査（約 14 ms）。

保存内容の版 `contentRevision`（SPEC-P02 で導入。保存内容・注釈が変わる通知で必ず進む）に結び付けたページ別キャッシュと、印の形の再利用で、結果を変えずにこれらを減らす。

## 対象

- `src/editor/AnnotationStore.ts`
- `src/editor/AnnotationLayer.tsx`
- `src/editor/countMarkers.ts`
- 新規 `tests/AnnotationStore.pageSnapshot.test.ts`
- 新規 `tests/countMarkers.cache.test.ts`

## 変更内容

### 1. AnnotationStore: ページ別の注釈スナップショット

1. 公開メソッドを追加:
   ```ts
   /** 描画用のページの注釈。getPageAnnotations と同じ内容・同じ順。contentRevision が同じあいだは同じ配列を返す。配列と各注釈（入れ子を含む）は Object.freeze 済み。 */
   getPageAnnotationsSnapshot(pageIndex: number): readonly EditableAnnotation[]
   ```
2. 内部に、`contentRevision` ごとに作り直す「ページ番号 → 注釈ID の配列」の補助索引を持つ。
   - 版が変わって最初に使われたとき、`this.annotations` を1回だけ走査し、削除済みを除いて、Map の反復順のままページ別に ID を並べる（`getPageAnnotations` の `filter` と同じ順になる）。
   - ページ別のスナップショット（`Map<number, readonly EditableAnnotation[]>`）も同じ版に結び付け、版が変わったら Map ごと捨てる（古いページのキャッシュを残さない）。
   - 各要素は `publicAnnotation(annotation, this.isAnnotationDirty(annotation))` を深く freeze したもの（SPEC-P01 の項目スナップショットと同じ再帰 freeze を private 関数にまとめて共用してよい）。
   - 作る処理を `perfTime('store.pageSnapshot.build', ...)` で包む。
3. `getPageAnnotations()` は変えない（呼ぶたびに新しい複製を返す。他の呼び出し元と `window.__karu.getEditableAnnotations` が使う）。
4. `reset()` でこれらのキャッシュを捨てる。
5. **更新漏れの点検**: `publicAnnotation` が返す項目（`cloneState` が写す全フィールドと `dirty`）を変えるのに `contentRevision` が進まない経路がないか、AnnotationStore 全体を点検する。
   例: `setLayout`、`markApplied`（objNum の付与・基準の更新）、`ensurePageLoaded` 系の読込、`legacyChange` 関連、`touch`、`deferNotify`、`revision` の加算、保存時の補正、Undo/Redo の `restoreMany`。
   進まない経路があれば、その書き換えの直後に `this.contentRevision += 1` を足す（通知は増やさない）。点検結果を報告に一覧で書く。

### 2. AnnotationStore: overlay の走査のキャッシュ

- `countOverlayObjNums(pageIndex)` と `issueOverlayObjNums(pageIndex)` の結果を、ページ別に `contentRevision`（`countOverlayObjNums` は加えて `fixturesReady`）に結び付けてキャッシュする。
  `fixturesReady` が false のときの早期 return は今のまま。
- 戻り値は今と同じく呼び出し元が変えてよい配列にする（キャッシュの配列をそのまま返さず、`[...cached]` で返す）。
- 計数器（`store.countOverlayObjNums` / `store.issueOverlayObjNums`）はキャッシュが外れて実際に走査したときだけ計上されるように、`perfTime` の位置を走査部分に置く。
- `drawingHiddenObjNums` は表示の絞り込み（画面だけの状態）に依存するので変えない。

### 3. AnnotationLayer.tsx

- `const annotations = props.store.getPageAnnotations(props.pageIndex).filter(a => props.store.isShownOnDrawing(a))` を `getPageAnnotationsSnapshot` に置き換える（`filter` は今のまま描画ごとに行う）。
- `annotations` とその要素を書き換えている箇所が無いことを確認する。あれば報告し、その箇所だけ局所的に複製する。
- それ以外（依存配列、描画、イベント処理）は変えない。

### 4. countMarkers.ts: 印の形の再利用

- `countMarkerData(style, x, y)` のうち、原点まわりの形（`outline` / `fills` / `strokes` を `move` する前のもの）を `${style.shape}|${style.size}|${style.fill}` をキーにモジュール内の `Map` へキャッシュする。上限 256 件を超えたら `clear()` する。
- `move` は今のまま毎回新しい配列を作る（キャッシュの配列を外へ返さない・書き換えない）。`bright` / `color` / `opacity` / `code` は今のまま毎回計算する。
- 返す値・数値・順序は1ビットも変えない（足し算の順序 `a + x` / `b + y` を保つ）。
- `countSvgPath` / `countPdfPath` / `CountMarker` / `QuantitySwatch` は変えない。

### 5. 試験

`tests/countMarkers.cache.test.ts`（新規）— 改修前の出力と一致することを固定値で確認する。次のコードをそのまま使い、ハッシュが `'2debee81'`、件数が 630 であることを expect する（改修前のコードで依頼側が計算済み）。さらに同じループを2回目に回しても同じハッシュになること（キャッシュ利用時）、返った `outline` を書き換えても次の呼び出し結果が変わらないことを確かめる。

```ts
const shapes = ['circle','doubleCircle','square','roundedSquare','triangle','invertedTriangle','diamond','pentagon','hexagon','octagon','star','hourglass','cross','plus']
const fills = ['none','solid','half','dot','hatch']
const out: string[] = []
for (const shape of shapes) for (const fill of fills) for (const size of [6, 10, 13.5]) for (const [x, y] of [[0, 0], [123.25, 456.5], [-7.1, 3.3]]) {
  const d = countMarkerData({ shape, fill, color: [0.2, 0.6, 0.9], size, opacity: 0.8, showCode: true } as CountStyle, x, y)
  out.push(JSON.stringify(d) + countSvgPath(d.outline) + countSvgPath(d.fills) + countSvgPath(d.strokes, false))
}
let h = 0x811c9dc5; for (const b of new TextEncoder().encode(out.join('\n'))) h = Math.imul(h ^ b, 0x01000193) >>> 0
const hash = h.toString(16).padStart(8, '0')
```

`tests/AnnotationStore.pageSnapshot.test.ts`（新規）— 既存の `tests/AnnotationStore.symbolSearch.test.ts` の作り方にならう。

1. 不変条件: 次の各操作の後で、すべての関係ページ p について `getPageAnnotationsSnapshot(p)` が `getPageAnnotations(p)` と `toEqual`、かつ `countOverlayObjNums(p)` / `issueOverlayObjNums(p)` がキャッシュを使わない走査結果と一致（キャッシュを使わない比較値は、同じ操作を別の新しいストアに行った結果ではなく、`getPageAnnotations` 由来で試験内に書いた同じ条件の走査で求める）:
   複数ページへの `create`、`createCountMarks`、移動（既存の更新メソッド、例: 矩形の変更）、削除、`undo()`、`redo()`、`setCountFixtures` で項目削除（個数の印の扱いが変わる）、`toEdits()` → `markApplied({ created: [...], errors: [] })`（`objNum` が付く。既存 `tests/AnnotationStore.test.ts` の形にならう）、`reset()`。
2. 画面だけの操作（`selectFixture`、`selectOnly`、`clearSelection`、`setHighlightedVertex`、`setAnnotationFilter`）の前後で `getPageAnnotationsSnapshot(p)` が `toBe` で同じ配列。
3. 保存内容が変わる操作の後は新しい配列になり、変わったページの内容が更新されている。
4. 返った配列・要素・`rect` などの入れ子が `Object.isFrozen`。`getPageAnnotations()` の戻り値は freeze されておらず、書き換えてもスナップショットに影響しない。
5. ページ番号は Map 順で、`getPageAnnotations` と同じ順序であること（並び順を変える操作の後を含む）。

## 禁止事項

- 描画される注釈の内容・順序・表示/非表示、選択の強調、最前面の表示を変えないこと。
- `getPageAnnotations()`、`countOverlayObjNums()`、`issueOverlayObjNums()` の戻り値の意味と、呼び出し元が戻り値を変えてよい契約を変えないこと。
- 印の形・パス文字列・PDF への書き出しの数値を変えないこと。
- 指定ファイル以外を変えないこと。関数名・export 名を変えないこと。
- 外部通信・新規パッケージ・https:// を含む文字列を足さないこと。

## 報告してほしいこと

- 「更新漏れの点検」の結果（場所と対処）
- AnnotationLayer で freeze 済みの値を書き換えうる箇所の確認結果
- SPEC から外れた所と理由
