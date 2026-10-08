# SPEC-07a: 経路の部分（平面・立上り・その他の加算）と施工条件の持ち方、古いデータの読み込み、集計の索引

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 保存形式・互換性・集計・Undo にまたがる中心のデータ構造の変更（判定表「新規機能・データ構造の変更」）

---

## 目的

計画: `docs/調査/施工条件別数量拾い_計画.md`（必ず読むこと）。

利用者の指示（2026-10-08）:
- 経路構成の「全長／平面＋立上り／立上りのみ」をやめる。
- 経路を「平面」と「立上り・立下り」に分けて、それぞれに施工条件を持たせる。
- 部材ごとに違う施工条件を持てるようにする。
- 立上り・立下りが複数あって条件が違う場合も、正しく管理する。
- 古いデータは失わずに読む。

この段階では**データの持ち方・保存・読み込み・集計の索引・ストアの操作**を作る。画面は次の段階（SPEC-07c・07d）で作り替える。今の画面（範囲の選択など）は、この段階の後も壊さずに動くようにする（下の「今の画面との互換」）。

## 現状（Claude Code が確認したこと）

- `src/core/quantity.ts`:
  - `QuantityMark`（version 1）の線の拾いは `itemId`・`count`（条数）・`scope?: 'all'|'noSlack'|'rise'`・`extra?: Array<{ itemId, count, scope? }>`（追加の部材、最大 10）・`addM`（立上り・立下りの合計）・`slackM`（余長・その他）を持つ。
  - 関数: `parseQuantityMark`（JSON は 2000 文字まで）、`routeLength(planM, mark, scope)`、`quantityLabel`、`ROUTE_SCOPES`、`validRouteScope`。
- `src/core/annotations.ts`: 読み込み 376 行 `parseQuantityMark(readString(object, 'KaruQuantity'))`。保存 1533 行 `parseQuantityMark(JSON.stringify(edit.quantity))` を `KaruQuantity` に書く。
- `src/core/counts.ts`: `CountMark` は version 2 で `fixtureId`・`floor`・`room`。
- `src/core/quantityIndex.ts`:
  - `QuantityIndex.build` が拾いごとに `QuantityEntry { itemId, annotationId, pageIndex, floor, room, value, routeCount, scope }` を作る。
  - 線の拾いは部材ごとに 1 件で、`value = routeLength(...) × 条数`。
- `src/editor/AnnotationStore.ts`:
  - `updateRoute`、`setRouteItems`、`addFixturesAndSetRouteItems`、`reassignCounts`（範囲が違うと項目の変更を断る）、`updateQuantityAdd`、`updateQuantityValues`、`routeTemplate`（`scope` を含む）、`quantityText`。
  - Undo は `history.push({ before, after })` の形。
- `scope` を使う所: `RouteItems.tsx`、`LinePicker.tsx`、`routeSets.ts`（`scopeShort`）、`AnnotationLayer.tsx`（経路の印の title）、`FixturePanel.tsx`、`annotationCsv.ts`、各試験。

## 対象

- 対象フォルダ: `C:\Users\gibbo\Desktop\PDF編集アプリ\.claude\worktrees\karupdf-quantity-ui-8301e6`
- 変更してよいファイル:
  - `src/core/quantity.ts`、`src/core/counts.ts`、`src/core/quantityIndex.ts`、`src/core/annotations.ts`（数量の読み書きの箇所だけ）
  - `src/editor/AnnotationStore.ts`
  - `src/app/RouteItems.tsx`、`src/app/LinePicker.tsx`、`src/app/routeSets.ts`、`src/app/FixturePanel.tsx`、`src/editor/AnnotationLayer.tsx`、`src/app/annotationCsv.ts`、`src/app/QuantityTable.tsx`、`src/app/QuantityBreakdown.tsx`（`scope` の参照を新しい形へ置き換えるのに必要な最小限だけ）
  - `tests/`、`e2e/`（既存の期待値の更新が必要な場合のみ）
- 変更しないファイル: 上以外。

## 変更内容

### 1. 型（`src/core/quantity.ts`）

```ts
export type RoutePart = 'plan' | 'rise' | 'slack'
/** undefined: 数える・施工条件は未設定 / string: 数える・その施工条件 / null: この部分は数えない */
export type PartCondition = string | null | undefined
export interface RouteConditions {
  plan?: string | null
  /** 1つの値はすべての立上りに効く。配列は立上り1か所ごと（rises と同じ順。欠けた位置は undefined） */
  rise?: string | null | Array<string | null>
  slack?: string | null
}
export interface Rise { m: number; at?: number }  // m: 長さ(m)。at: 表示用の頂点の番号（任意。07e で使う）
```

`QuantityMark` に次を足す（`version: 1` のまま。既存の項目はそのまま）。
- `rises?: Rise[]`: 線の拾いだけ。立上り・立下りの1か所ごとの長さ。最大 20 件、各 0〜1000m（0.01m 単位）。
- `cond?: RouteConditions`: 線の拾いの主の部材の施工条件。
- `extra[i].cond?: RouteConditions`: 追加の部材の施工条件。
- `condition?: string`: 線以外の拾い（面積・体積など）の施工条件。

**施工条件の文字列**: 1〜30 文字、前後の空白なし、改行なし。

### 2. 読み込み（`parseQuantityMark`）と古いデータ

- 文字数の上限を 2000 → 8000 にする（古い版は 2000 を超えると読めないので、書き出しはできるだけ短くする。下の 3.）。
- `rises` があれば検証して使い、`addM` は `rises` の合計と見なす（保存されている `addM` と違えば `rises` を正とする）。
- `rises` が無く `addM > 0` なら、`rises = [{ m: addM }]` と見なす（メモリ上）。
- `cond` が無い部材は、`scope` から作る。
  - `'rise'` → `{ plan: null, slack: null }`
  - `'noSlack'` → `{ slack: null }`
  - `'all'`・なし → `{}`
- `cond` も `scope` もある場合は `cond` を正とする。
- メモリ上の `QuantityMark` では `scope` を持たない（`cond` に一本化）。

### 3. 書き出し（新しく `serializeQuantityMark(mark): string` を作り、`annotations.ts` の保存で使う）

- 古い版（1.4.3 まで）のために、`addM`（立上りの合計）と、部材ごとの近い `scope` を書く。
  - `plan === null && slack === null` → `'rise'`
  - `slack === null` → `'noSlack'`
  - それ以外 → 書かない
- 古い版の `scope` では表せない組合せ（平面は数えないがその他は数える、立上りの一部だけ数えない等）は、近い値で書く。古い版の集計とは合わないことを、コメントと報告に書く。
- `rises` は、1 件で `at` が無い場合は書かない（`addM` だけで足りる）。
- `cond` は空なら書かない。`plan`・`rise`・`slack` も `undefined` なら書かない。
- `parseQuantityMark(serializeQuantityMark(m))` が `m` と同じになること（読み書きで変わらない。未保存の判定のため）。

### 4. 数量の計算（`src/core/quantity.ts`）

```ts
export function routeMembers(mark: QuantityMark): Array<{ itemId: string; count: number; cond: RouteConditions }>  // 主→追加の順
export function routeRises(mark: QuantityMark): Rise[]                      // rises か addM から
export function riseCondition(cond: RouteConditions, i: number): PartCondition
export interface RoutePortion { part: RoutePart; riseIndex?: number; lengthM: number; condition?: string }  // 1条あたり
export function routePortions(planM: number, mark: QuantityMark, member: RouteConditions): RoutePortion[]  // 数えない部分は含めない。長さ 0 の部分も含めない
```

- 平面＝`planM`、立上り i＝`rises[i].m`、その他＝`slackM`。
- 部材の数量＝Σ（各部分の長さ）× 条数。
- 既存の `routeLength(planM, mark, scope)` は、`routeMemberLength(planM, mark, cond)` に置き換える。同じ値になること。

### 5. 器具（`src/core/counts.ts`）

- `CountMark` version 2 に `condition?: string` を足す。
- 読み書きで保持し、古い版は無視するだけにする（version は上げない）。

### 6. 集計の索引（`src/core/quantityIndex.ts`）

- `QuantityEntry` に `part?: RoutePart`、`riseIndex?: number`、`condition?: string`（未設定は `undefined`）を足し、`scope` を消す。
- 線の拾いは、部材×部分（`routePortions`）ごとに 1 件の entry にする。`value = lengthM × 条数`、`routeCount = 条数`。
- 線以外の拾いは `condition = mark.condition`。器具は `condition = countMark.condition`。
- 既存の集計（`total`・`byPage`・`byFloor`・`byRoom`・`byFloorRoom`・`pagesOf`・`entries`・`countEntriesOnPage`）は、項目の合計が今と同じになること。
  - 線の拾いの entry は部分ごとに分かれる。
  - entry の数を数えて件数にしている所は、`annotationId` の重複を除いて数えること（`QuantityBreakdown`・`QuantityTable`・CSV の「拾いの件数」は既にそうしているか確かめる）。
- 新しい集計:

```ts
byCondition(itemId: string): Map<string, { plan: number; rise: number; slack: number; other: number; total: number; annotationIds: Set<string> }>  // キー '' は未設定
```

- 計算は `build` の中で 1 回だけ行う。呼ばれるたびに entry を走査しない（`byPage` と同じくキャッシュ）。

### 7. ストアの操作（`src/editor/AnnotationStore.ts`、すべて Undo・Redo できること）

1. `setRouteMembers(id, members: ReadonlyArray<{ itemId: string; count: number; cond?: RouteConditions }>)`
   - 今の `addFixturesAndSetRouteItems` と同じ検証（線の項目、重複なし、条数 1〜99、最大 11）に、`cond` の検証を足す。
   - `addFixturesAndSetRouteItems(newFixtures, id, members)` も同じ形の `members` を受ける。
2. `setRouteRises(id, rises: readonly Rise[])`
   - 検証して `rises` と `addM` を更新する。
   - 立上りの数が変わったとき、部材の `rise` の配列は長さを合わせる（増えた所は `undefined`、減った所は捨てる）。
   - `updateQuantityAdd(id, addM)` は「立上りが 0〜1 件なら 1 件の長さを `addM` にする」として残す。2 件以上のときは何もしない（07c の画面で1か所ごとに編集する）。
3. `setRouteCondition(ids: readonly string[], itemId: string, part: RoutePart, condition: PartCondition, riseIndex?: number)`
   - 選んだ複数の線の拾いのうち、`itemId` の部材のその部分の条件をまとめて変える。
   - `riseIndex` 無しの `rise` は、すべての立上りに効く 1 つの値にする。
   - 1 回の Undo で戻る。
4. `setQuantityCondition(ids: readonly string[], condition: string | undefined)`
   - 線以外の数量の拾いと器具の印の条件をまとめて変える。1 回の Undo。
5. **直前の条件の引継ぎ**
   - 項目ごとに、最後に設定した部材構成と条件をメモリ（ストア）に覚える（`lastRouteConditions: Map<itemId, RouteConditions>`、`lastCondition: Map<itemId, string>`）。
   - 同じ項目の新しい拾いを置くとき、その条件を引き継ぐ（引継ぎが無ければ未設定）。
   - PDF には保存しない。
6. `routeTemplate` は `scope` の代わりに `cond` を持つ。
7. `reassignCounts`: 「範囲が異なる」の判定を、`cond` の比較に置き換える。
   - 文言は「施工条件または数える部分が異なるため、項目を変更できません。先にそろえてください。」。
8. `quantityText`・`quantityLabel`: 部材の印の後ろの `scopeSuffix` を、次の短い表示に変える。
   - 平面を数えない部材は「（立上り）」。
   - 条件が付いている部材は「（ラック）」のように、平面の条件を出す。平面と立上りで違う場合は「（ラック／管内）」。

### 8. 今の画面との互換（この段階の後も今の画面が動くこと）

- `RouteItems` の範囲の選択（全長／平面＋立上り／立上りのみ）は、当面 `cond` の数える部分を次のように切り替える表示として残す。施工条件は保つ。
  - 全長 → 全部数える
  - 平面＋立上り → `slack: null`
  - 立上りのみ → `plan: null, slack: null`
- 選択の表示は、今の部材の `cond` から逆に求める。どれにも当てはまらなければ「個別」と表示する（07c で置き換える）。
- `routeSets.ts`（よく使う構成）は、`scope` の代わりに `cond` を保存・復元する。localStorage の古い形（`scope`）も読む。
- `LinePicker`・`AnnotationLayer` の経路の印の title・CSV の既存の列は、`scope` を参照していれば `cond` から同じ意味の文字にする。

## テスト

### 単体（`tests/`）

- 読み込み:
  - 古い JSON（`scope` が all・noSlack・rise、`extra` に範囲付き、`addM`・`slackM` あり）を読んで、`cond`・`rises` が上の対応になる。
  - 合計の長さが、今の `routeLength` と同じになる。
- 読み書きで変わらない:
  - `parseQuantityMark(serializeQuantityMark(m))` が元と同じ。
  - 立上り複数・条件あり・数えない部分ありで確かめる。
- 古い版との互換:
  - `serializeQuantityMark` の結果を、今のコードの読み込み（このブランチの変更前の `parseQuantityMark` を試験の中に写して）で読める。
  - 部材ごとの合計が、古い `scope` で表せる組合せでは一致する。
- `routePortions`: 部分ごとの長さと条件、数えない部分の除外、立上りごとの条件、条数を掛けること。
- 索引:
  - `byCondition` で、同じ条件の平面と立上りが合算され、内訳（plan・rise・slack）が分かれる。
  - 未設定はキー `''`。
  - `total`・`byPage` が既存と同じ。
  - 器具・面積の条件も集計される。
- ストア:
  - `setRouteMembers`・`setRouteRises`（立上りの増減で配列が揃う）・`setRouteCondition`（複数選択・1回の Undo）・`setQuantityCondition`・引継ぎ・`reassignCounts` の判定。
  - それぞれ Undo・Redo で元に戻る。
- 保存して読み直して同じになる（既存の注釈の保存の試験の形に倣う）。

### 画面（e2e）

- 実行しなくてよい。既存の経路構成・数量の e2e が、今の画面のまま通るように保つこと。
- 期待値の変更が要る試験は直してよいが、何をなぜ変えたか報告すること。

## 禁止事項

- 古いデータの平面長・立上り長・余長（その他の加算）・条数・部材構成を失わないこと。
- 古いデータに施工条件を自動で付けないこと。
- PDF を開く・表示・スクロールのときに新しい処理を足さないこと。集計の索引は、今と同じく数量が変わったときだけ作る。
- 拾いの操作ごとにすべての注釈を走査しないこと（今の索引のキャッシュを保つ）。
- 対象外のファイルを変更しないこと。git の操作をしないこと。python・pytest は使わない。
- vitest は `process.env.MODE` を `test` で上書きする。環境変数で分岐するなら別の名前にすること。
- `npx tsc --noEmit` と単体試験は実行してよい。e2e は実行しなくてよい。

## 報告してほしいこと

- 変更したファイルと要点
- 古い版の `scope` で表せない組合せの扱い
- SPEC から逸脱した箇所と理由、変えた既存の試験の期待値とその理由
