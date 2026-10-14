# SPEC-R5b: 「構成要素で拾う」を選ぶと、その品目を構成要素に自動で入れる

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 個数の印の構成要素（保存データ）とストアの履歴に関わる変更を伴うため既定の sol-high。

---

## 背景（利用者の意見、2026-10-14）

> 「構成要素で拾う」を選択した場合は、（右の数量拾いの）構成要素に自動で追加されているようにしたい。

今は「構成要素で拾う」は判断を記録するだけ（E-039 だけに出る）。R5a で関連の候補は右のパネル（表示中の項目1件）に移った。

## 対象

- `src/editor/AnnotationStore.ts`（新しいメソッド）
- `src/app/RelatedSuggestions.tsx`（R5a 後のもの）
- 必要なら `src/app/relatedModel.ts`（候補の品目から個数の規格を引くため）
- 試験

## 変更内容

### 1. 出す条件

「ほかの判断」の「構成要素で拾う」を、次のすべてを満たす **item** の候補に出す（E-039 に限らない）:

- 表示中の項目（起点）が個数の項目（`quantityMethod(f) === 'click'`）で、連動でない。
- 提案先が次のどちらかに当たる:
  - 文書の項目のうち、個数の項目で連動でないもの。提案先の分類・名称に一致する（選択済みの判定と同じ照合）。
  - 標準マスタの候補（`targets[].candidates`）のうち、個数の規格（`(option.method ?? 'click') === 'click' && (option.kind ?? 'count') === 'count'`）を持つもの。

### 2. 選んだときの動き

0. 当たる提案先が2つ以上あるとき（例 E-039 はスイッチボックスとアウトレットボックス）は、先にカードの中に次を出して、利用者に選ばせる（他工事の担当の選択と同じ作り）:
   - `<select aria-label="構成要素にする品目">`（提案先の名称。既定は先頭）
   - 「構成要素に入れる」「やめる」

   1つだけならすぐ進む。
1. 構成要素にする項目を決める:
   - 文書にある該当の個数の項目（`order` の最小）があればそれを使う。
   - 無ければ、標準マスタの最初の候補の最初の個数の規格から、`ComponentPicker` と同じ作り方で新しい項目を作る（`catalogPresets(item, { options: [option.key] })[0]`、`id` は新規、`order` は末尾、`style` は `nextCountStyle`、`line` は消す）。
   - 同じ `fixtureIdentity` の項目が文書にあればそれを使う。
2. ストアの新しいメソッドで、起点の項目の**すべての個数の印**と**これからの印**（`lastCountComponents`）に、その項目を数 1 の構成要素として足す。
3. 判断「構成要素で拾う」を記録する（今と同じ `decide`）。
4. 状態の文を出す（例「スイッチボックスを構成要素に入れました（印 4 個とこれからの印。Ctrl+Z で戻せます）」）。

右のパネルの「構成要素」の一覧（`CountItems`）は、選択中の印の構成を表示するので、印を選べばそこに出ている。

### 3. ストア `addComponentToFixture(fixtureId, itemId, newFixtures = []): { error?: string; changed: number; skipped: number }`

- 検査（違反は `error` を返し、何も変えない）:
  - `fixtureId` が個数の項目で、連動でない。
  - `itemId` の項目（`newFixtures` を含む）が個数の項目で、連動でない。
  - `itemId !== fixtureId`。
  - `newFixtures` は `setCountComponents` と同じ検査（ID の重複・`serializeCountFixtures`）。
- 起点の項目の個数の印（`countMarkIdsOf(fixtureId)`）ごとに処理する:
  - すでにその `itemId` の構成要素があれば変えない。
  - 構成要素が 10 件あれば足さずに `skipped` を数える。
  - それ以外は末尾に `{ itemId, count: 1 }` を足す。
  - 検査・保存の形は `setCountComponents` と同じ（`parseCount` の往復）。
- `lastCountComponents` の `fixtureId` の値に同じ規則で足す（無ければ `[{ itemId, count: 1 }]`）。印が0個でも、これからの印に入るように記録する。
- 項目の追加・印の変更・記憶の変更を**1つの履歴**にまとめる（Undo 1回で全部戻る）。`setCountComponents` の `before` / `after`（`fixtures`、`pickupMemory`、印）の作りにならう。
- 変更が無い（全部すでにある）ときは履歴を作らない。

### 4. 判断の取消

判断を取り消しても構成要素は外さない（利用者が構成要素の一覧で外す。Ctrl+Z でも戻せる）。

## 試験

- 単体（ストア）:
  - 印3個のうち1個はすでに構成要素ありのとき、2個に足して `changed = 2`。
  - 10件ある印は `skipped`。
  - `lastCountComponents` に入り、次に置いた印に入る。
  - `newFixtures` の項目が足される。
  - Undo 1回で全部（項目・印・記憶）戻り、Redo で戻る。
  - 個数でない・連動の項目は `error`。
- e2e（`e2e/related-suggestions.annotate.spec.ts` に追加）:
  - コンセントの項目（分類が E-039 の起点に当たるもの）を登録し、印を2個置く。
  - 右のパネルの関連の候補で、ボックスの候補の「ほかの判断」から「構成要素で拾う」を選ぶ。
  - 印を選ぶと構成要素にボックスがある。ボックスの数量が 2 になる。
  - Ctrl+Z で戻る。

## 受入条件・停止条件

- 「構成要素で拾う」を選ばない限り、印・構成要素・数量は変わらない。
- 関係する e2e（構成要素・関連・数量パネル）と単体試験全件が合格。
- 戻し方: この段階のコミットの revert。

## 禁止事項

- 個数の印の保存形式（`CountMark` v2）を変えない。長さ・面積の項目には足さない。
- 外部通信を足さない。`https://` を含む文字列を足さない。git 操作をしない。
