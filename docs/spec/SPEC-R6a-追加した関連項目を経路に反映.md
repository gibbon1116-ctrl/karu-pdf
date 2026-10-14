# SPEC-R6a: 関連の候補で追加した項目を、経路の線要素・頂点の個数に自動で反映する

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 関連の候補・App のダイアログ・ストアの経路の変更（履歴）にまたがり、反映先の判断を伴うため既定の sol-high。

---

## 背景（試用版 related2 の利用者の意見、2026-10-14）

1. 「頂点の個数で選択できる項目は、関連する項目として選択したものを上位に全て現わし、その他の項目も選択したものの次に表示されるようにしたい。」
2. 「頂点部分に追加するということで選択した項目は、頂点は自分でドロップダウンで選択するので、項目は自動で追加するようにしたい。」
3. 「『追加する』を選択した項目が、数量拾いの欄には表示されるが、『線要素の追加』部分に自動で反映されていない。反映されるようにしたい。」

前提: R6b（面積の項目を線要素にする、`src/core/routeSurface.ts`）の後に行う。

## 用語

- **起点の線項目**: 右の数量拾いに出ている項目で、`quantityMethod === 'polyline'` かつ連動でないもの。
  - 例: ケーブル、電線管、ダクト、配管。
  - 経路の印を選んでいるときはその主の項目、一覧で選んでいるときはその項目。
- **関連の個数の項目**: 起点の線項目について `suggestRelated` で出る提案（item・check）のうち、文書にある個数の項目（`quantityMethod === 'click'`、連動でない）で提案先に当たるもの。
  - item は提案先の分類・名称、check は `create.name` で照合する（「選択済み」の判定と同じ）。
  - 提案の並び順に並べ、同じ項目は1回だけ出す。

## 変更内容

### 1. 「追加する」の後の反映（意見3、意見2の一部）

`FixtureUiContext.addFromMaster(query, context?)` と `createFixture(initial, context?)` に省略可能な `context` を足す。

```ts
interface RelatedAddContext {
  originFixtureId: string   // 起点の項目
  routeId?: string          // 右のパネルで起点の線項目の経路の印を1つ選んでいるとき、その印のID
}
```

`RelatedSuggestions` の「追加する」は `context` を渡す。App は、標準マスタの追加・新しい項目の保存で項目が追加されたら（今の `addFixtureItems` / `saveNewFixture` の後）、起点が線項目のときだけ次を行う。

| 追加した項目 | 反映 |
|---|---|
| 長さの項目（`polyline`）、または R6b の面積の項目（`isRouteSurfaceFixture`） | **起点の線項目を主とするすべての経路と、これから引く経路に、追加の線要素として足す**（条数 1。施工条件は主の項目の今の条件をまねない＝未設定。面積の項目は `perM` に `surfacePerimeterM(起点)`） |
| 個数の項目 | `context.routeId` があれば、その経路の頂点の個数に1行足す（頂点は使っていない最初の中間の頂点、無ければ終点。数 1）。無ければ足さない（3.の「関連の項目」から足せる） |
| それ以外（体積・連動 等） | 何もしない（今と同じ） |

- 標準マスタで一度に複数の項目を追加したときは、それぞれに上の規則を当てる。
- 状態の文を出す（例「PF22 を VVF 1.6-2C の経路 12 本とこれからの経路の線要素に入れました（Ctrl+Z で戻せます）」）。

### 2. ストアの新しいメソッド

`addRouteMemberToFixture(originId: string, member: RouteExtra, newFixtures?: readonly CountFixture[]): { error?: string; changed: number; skipped: number }`

- 起点を主とする経路の印（`quantity.method === 'polyline'` で `quantity.itemId === originId`、削除・旧形式の変更でないもの）ごとに処理する:
  - すでにその項目が構成（主・追加）にあれば変えない。
  - 追加の線要素が 10 件あれば足さずに `skipped`。
  - それ以外は末尾に足す。
  - 検査は `setRouteMembers` と同じ規則（R6b の面積の線要素を含む）。
- これからの経路: `lastRouteMembers` の起点の値の `extra` に同じ規則で足す。無ければ `{ itemId: originId, count: 1, cond: {}, extra: [member], name: '' }`。`routeTemplate` が起点のものなら、それにも足す。
- 項目の追加（`newFixtures`）・経路の変更・記憶の変更を1つの履歴にまとめる（R5b の `addComponentToFixture` と同じ作り）。
- 変更が無ければ履歴を作らない。
- 経路の保存の上限（8,000 字）を超える印は、足さずに `skipped`。

### 3. 頂点の個数の項目の並びと「関連の項目」（意見1・2）

`RouteItems` の「頂点の個数」（R5c）を変える。

- **項目の選択** `<select aria-label="頂点の個数{n}の項目">` を2つの `<optgroup>` にする:
  1. `label="関連の項目"`: 経路の主の項目の関連の個数の項目（全部）。
  2. `label="そのほかの個数の項目"`: 残りの個数の項目（今の並び）。

  関連の個数の項目が無いときは optgroup を使わず今の並びにする。
- **「関連の項目」のボタン**: 区画の上に、関連の個数の項目ごとにボタン「＋ {略号} {名称}」（`aria-label="頂点に {名称} を足す"`）を並べる。押すとその項目の行を1つ足す（頂点は使っていない最初の中間の頂点、無ければ終点。数 1）。
  - 同じ項目でも別の頂点に足せるよう、ボタンは足した後も出しておく。
  - 同じ項目・同じ頂点の重複は R5c の検査のまま。
  - 足せる頂点が無ければ無効にし、`title` に理由を出す。
- 「＋ 頂点に個数の項目を足す」は残す。既定の項目は関連の個数の項目の先頭、無ければ今の規則（防火区画貫通を含むもの → 並びの先頭）。
- 関連の個数の項目の計算:
  - 新しいフック `useRelatedCountItems(store, originFixtureId)`（例 `src/app/relatedRouteItems.ts`）。
  - **関連の機能を使っている文書だけ**計算する。条件は R2b・R5a と同じ（セッションのメモリで開いた／登録した、案件区分がある、判断がある）。
  - `loadRelated()` の結果で起点1件だけ `suggestRelated` する。使っていない文書ではルールを読まず、空の配列を返す（並びは今のまま）。
  - 文書の項目（`getFixturesRevision`）・判断・案件区分・品目作業が変わったときだけ計算し直す。印の選択や数の変更では計算しない。

## 対象

- `src/app/documentModel.ts`（`FixtureUiContext` の型）
- `src/App.tsx`（追加後の反映）
- `src/app/fixtureAdd.ts`（必要なら、追加した項目を返す）
- `src/app/RelatedSuggestions.tsx`（`context` を渡す）
- `src/app/FormatPanel.tsx`（`routeId` を渡す）
- `src/editor/AnnotationStore.ts`（新しいメソッド）
- `src/app/RouteItems.tsx`
- 新規 `src/app/relatedRouteItems.ts`
- 試験

## 試験

- 単体（ストア）`addRouteMemberToFixture`:
  - 経路3本（うち1本はすでにその項目あり）→ `changed = 2`。
  - 追加の線要素 10 件の経路は `skipped`。
  - `lastRouteMembers` に入り、次に引いた経路に入る。
  - 面積の項目は `perM` 付き。
  - `newFixtures` の追加。
  - Undo 1回で全部戻り、Redo で戻る。
  - 起点が線項目でない・個数の項目を線要素にしようとすると `error`。
- e2e（`e2e/related-route.annotate.spec.ts`）:
  - 電線管の分類の長さの項目（例 PF22。起点）とケーブルの項目がある PDF で、起点の経路を2本引く。
  - 右の関連の候補で、電線管の「防火区画等貫通処理」（E-015）の「追加する」→ 標準マスタで追加 → 選んでいた経路の頂点の個数に1行入る。
  - 同じ電線管の線項目の候補（長さの提案先があるもの。無ければ create の単位 m の check）で「追加する」→ 保存 → 2本の経路の線要素に入る。
  - 頂点の個数の項目の選択の先頭の optgroup が「関連の項目」で、防火区画貫通処理がある。
  - 「関連の項目」のボタンで行が足せる。
  - Ctrl+Z で戻る。
- 関連・経路・数量の既存 e2e と単体試験全件が合格。

## 受入条件・停止条件

- 関連の機能を使っていない文書では、経路の右のパネルの表示・動作・性能が R5c と同じ（ルールを読まない）。
- 線項目でない起点の「追加する」は今と同じ。
- 戻し方: この段階のコミットの revert。

## 禁止事項

- 経路・個数の印の保存形式を変えない。
- 数量を勝手に足さない（反映は利用者が「追加する」で項目を追加したとき・ボタンを押したときだけ）。
- 外部通信を足さない。`https://` を含む文字列を足さない。git 操作をしない。
