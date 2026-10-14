# SPEC-R5c: 経路（線の拾い）の頂点に、個数の項目を足して計上する

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 数量拾いの保存データ（経路の印）・集計・Undo・経路の分割・項目の削除に関わる判断を伴うため既定の sol-high。

---

## 背景（利用者の意見、2026-10-14）

> 防火区画貫通処理はケーブルを拾うときに、「立上り・立下りを足す」と同様に頂点部分に追加計上できるようにしたい。他の個数で数える項目も、同様に頂点で計上できるようにしたい。

経路（`quantity.method === 'polyline'`）の右のパネル「経路構成」（`RouteItems`）で、頂点を選んで**個数の項目（`quantityMethod(f) === 'click'`）を何個でも足せる**ようにする。

- 足した数は、その項目の数量（集計表・数量パネル・Excel・CSV）に入る。
- 個数の印を図面に置かなくてよい。

## 保存データ

`src/core/quantity.ts`

```ts
/** 経路の頂点に足す個数の項目。at は頂点の番号（0 = 始点）。 */
export interface RoutePoint { itemId: string; at: number; count: number; condition?: string }
```

- `QuantityMark` に `points?: RoutePoint[]` を足す。経路（polyline）だけ。
- `validRoutePoints(value)`:
  - 配列で 50件以下。
  - 各要素の `itemId` は1〜80字の文字列。
  - `at` は 0 以上の整数。
  - `count` は 1〜99 の整数。
  - `condition` は無いか `validCondition`。
  - 同じ `itemId` と `at` の組は重ならない。
- `parseQuantityMark`:
  - 経路で `points` が正しければ写す（余計なキーは捨てる）。
  - **正しくなければ `points` だけを捨て、印は残す**（新しい欄なので、古いデータ・壊れたデータで拾い全体を失わない）。
  - 経路以外では捨てる。
- `serializeQuantityMark`:
  - 経路で `points` があれば、検査して書く（不正なら Error）。
  - 空配列は書かない。
  - 経路以外では書かない。
  - 経路の 8,000 字の上限は今と同じ。
- 以前の版で開いて保存すると、`points` は消える（以前の版は知らない欄を捨てる）。報告に書く。

## 集計（`src/core/quantityIndex.ts`）

- 経路の印を数えるときに、`points` の各要素を、その項目が個数の項目で連動でない（今の `clicks` の集合に入る）ときだけ足す。
  - `{ itemId, annotationId, pageIndex, value: count, floor, room, condition }`
  - `floor` と `room` は経路の印と同じ。
  - `part` は付けない（個数の印の構成要素 `extra` と同じ扱い）。
- `countPages`（ページの個数の印の一覧）には入れない。
- 頂点の番号が今の頂点の数を超えていても数える（表示だけ最後の頂点に寄せる）。

## ストア（`src/editor/AnnotationStore.ts`）

- `setRoutePoints(id: string, points: readonly RoutePoint[]): string | undefined`
  - 経路の印だけ。検査は `validRoutePoints` に加えて次のとおり（違反は日本語のメッセージを返す）:
    - 項目が存在する。
    - 個数の項目である。
    - 連動の項目でない。
  - 1つの履歴（Undo 1回）で書き換え、`refreshQuantity`。空なら `points` を消す。
- `splitRoute`: 立上りと同じ規則で分ける。
  - `at >= vertexIndex` は後ろの経路へ移し、`at - vertexIndex` にする。
  - それ以外は前の経路に残す。
- 項目の削除・施工条件の改名（`setCountFixtures` の `removeIds`・`renames`）:
  - 削除した項目の `points` を捨てる。
  - 改名した施工条件を `condition` に反映する（個数の印の `extra` と同じ）。
  - `affected` の判定に `points` の項目を含める。
- `fixtureMarkCount(id)`: `points` にその項目がある経路も数える（削除の確認の表示のため）。
- 経路の印の複製・貼り付け・移動は、`points` も他の欄と同じく保つ（`cloneQuantity` 等が丸ごと写すなら変更不要）。

## 画面

### 右のパネル `src/app/RouteItems.tsx`

「＋ 立上り・立下りを足す」とその他の加算の下に、区画「頂点の個数」を足す。

- 行ごとに次を並べる:
  - 項目（`<select aria-label="頂点の個数{n}の項目">`、文書の個数の項目で連動でないもの）
  - 頂点（`<select aria-label="頂点の個数{n}の位置">`、立上りの位置と同じ表記：始点・頂点k・終点）
  - 数（`aria-label="頂点の個数{n}の数"`、1〜99。条数の入力 `RouteCount` と同じ作り）
  - 施工条件（項目に候補があるとき。既存の `ConditionSelect` を使ってよい）
  - 削除（`aria-label="頂点の個数{n}を削除"`）
- 行にマウスを載せる・フォーカスすると、その頂点を強調する（`store.setHighlightedVertex`）。
- ボタン「＋ 頂点に個数の項目を足す」（50件で無効）:
  - 押すと、項目の選択の先頭に、名称または分類に「防火区画貫通」を含む個数の項目を出す。無ければ並びの先頭。
  - 頂点は、まだ使っていない最初の中間の頂点（無ければ終点）、数 1 の行を足す。
  - 文書に個数の項目が1つも無いときは押せない。押せない理由を `title` に出す（「個数の項目を先に追加してください」）。
- 各行の下に小さく「{略号} {名称} {数}{単位}」を出す。単位は `quantityUnit`。

### 図面 `src/editor/AnnotationLayer.tsx`

`QuantityRiseMarks` と同じ作りで `QuantityPointMarks` を足す。**立上りの印と違い、選択していなくても、その拾いが表示されている間は常に出す**（数量に入る物なので）。

- 各点の頂点（範囲外は最後の頂点）に、文字 `◆{略号}`（数が2以上なら `◆{略号}×{数}`）を出す。
- 位置は `dx = 7 / scale`、`dy = 14 / scale`（立上りの印 ↕ と重ならない）。
- `pointerEvents="none"`、`aria-hidden`。
- `className="annotation-point-mark"`、`data-point-index`。
- 頂点の強調中は少し大きくする（立上りと同じ）。
- 略号は `fixtureDrawingCode`（または一覧の略号の関数）を使う。項目が無い点は描かない。
- `styles.css`: 立上りの印（`annotation-rise-mark`）と同じ見た目で、色だけ変える（例 `#0b6e4f`）。

## 試験

- 単体 `tests/quantity.routePoints.test.ts`（新規）:
  - parse と serialize の往復。
  - 不正な `points` は parse で捨てて印は残る。serialize は Error。
  - 経路以外では捨てる。
  - 50件の上限。
  - 重複する組を拒む。
- 単体（`QuantityIndex`）: 経路に `points` を足すと、個数の項目の合計・ページ・階・施工条件の別に入る。連動・長さの項目の点は数えない。
- 単体（ストア）:
  - `setRoutePoints` の検査と Undo/Redo。
  - `splitRoute` での振り分け。
  - 項目の削除で点が消える。
  - `fixtureMarkCount`。
- e2e `e2e/route-points.annotate.spec.ts`（新規。既存の経路の e2e の作り方にならう）:
  - 長さの項目（ケーブル）と個数の項目（例: 名称「防火区画貫通処理」の個数の項目を `window.__karu` 等の既存の試験の手段で作る）がある PDF で経路を引く。
  - 右のパネルで「＋ 頂点に個数の項目を足す」を押すと、防火区画貫通処理が選ばれて数1の行ができる。
  - 数を 2 にすると、その項目の数量（`getCountFixtures` と集計の値、または数量パネルの表示）が 2 になる。
  - 図面に `annotation-point-mark` が出る。
  - 保存して開き直すと残る。Ctrl+Z で行が戻る。

## 受入条件・停止条件

- 点の無い経路・文書では、保存データ（`points` を書かない）・集計・表示が今と同じ。
- 関係する e2e（経路・数量パネル・集計表・`quantity-*`）と単体試験全件が合格。
- 戻し方: この段階のコミットの revert。

## 禁止事項

- 立上り・条数・施工条件・連動・埋戻しの計算を変えない。個数の印（`CountMark`）の形式を変えない。
- 外部通信を足さない。`https://` を含む文字列を足さない。git 操作をしない。
