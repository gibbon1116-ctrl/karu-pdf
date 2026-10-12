# SPEC-B03f-2: 個数の印の構成要素の画面（構成要素の欄・「構成要素を追加」）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 書式欄の新しい部品と追加の画面（検索・標準マスタからの項目作成・キーボード操作）、店（store）の条件追加の拡張、e2e の新設にまたがる

---

## 背景

SPEC-B03f-1 で、個数の印（`CountMark` version 2）に構成要素 `extra?: CountComponent[]`（`{ itemId, count, condition? }`）を持たせ、集計・保存・取り消し・新しい印への引き継ぎを作った。店（`AnnotationStore`）には次がある:

- `setCountComponents(ids, extra, newFixtures = []): string | undefined`（1回の履歴。項目の追加も同じ履歴）
- `countMarkIdsOf(fixtureId): string[]`
- `lastCountComponents`（主の項目ごとに最後の構成。新しい印へ引き継ぐ）

この SPEC で画面を作る。経路の「経路構成」欄（`RouteItems.tsx`）と「線要素を追加」（`LinePicker.tsx`）を手本にする。

## 対象

- 新規: `src/app/CountItems.tsx`、`src/app/ComponentPicker.tsx`、`e2e/count-components.annotate.spec.ts`
- 変更: `src/app/FormatPanel.tsx`（欄を出す）、`src/editor/AnnotationStore.ts`（条件の追加つき設定のメソッド1つ）、`src/styles.css`（必要な分だけ）
- 使う（変えない）: `src/core/breakdown/componentSuggestions.ts`（Claude 作成のデータ。`componentSuggestions(fixture)` が「よく組み合わせる」品目の名称を返す）、`src/core/catalog.ts`

## 変更内容

### 1. 書式欄の「構成要素」（`CountItems.tsx`）

- 出す条件（`FormatPanel.tsx` の数量拾いの書式欄）: 選択が1つで、それが個数の印（`activeSelection.count && !activeSelection.quantity`）で、主の項目がある。`PickupCondition` の直後に置く。
- `<section className="count-items route-items" aria-label="構成要素">`。見出しは `構成要素` と `N種類`（主を含む種類の数）。
- 主の行: `主` の札・略号（`fixtureLabelCode`）・名称。主の施工条件は今の `PickupCondition` で選ぶので、ここには出さない。
- 構成要素の行（`extra` の順）:
  - `追加` の札・略号・名称。
  - 個数: `−`／数値／`+`（`RouteItems` の `RouteCount` と同じ作り。aria-label は `${code}の個数を減らす`・`${code}の個数`・`${code}の個数を増やす`。1〜99）。単位の文字は項目の `quantityUnit(f)`。
  - 施工条件: `ConditionSelect`（`RouteItems.tsx` から import）。label は `${code}の施工条件`、`allowExclude` なし、未設定あり。選ぶと `setCountComponents([id], 変更後の extra)`。
    「＋ 条件を追加…」は新しい店のメソッド `addConditionAndSetCountComponent(itemId, condition, [id])`（下の 3.）を呼ぶ。
  - `主にする` は作らない。`×`（aria-label `${code}を外す`）で外す。
  - 項目が見つからない構成要素は、`itemId` を出して `×` だけ出す。
- 下に `＋ 構成要素を追加`（aria-label `構成要素を追加`、`aria-expanded`）。押すと `ComponentPicker` を開く。10件あるときは押せない（`title` に `これ以上足せません（最大 10 項目）`）。
- その下に `同じ項目の印すべてにこの構成を反映（N 個）`（N = `countMarkIdsOf(主の項目).length`）。N が 1 以下なら押せない。押すと `setCountComponents(countMarkIdsOf(主), この印の extra)`。
- 状態の文（`role="status"`）: 足した・外した・反映したときに出す。
  - 足した: `${code} を足しました（1個）`
  - 外した: `${code} を外しました（Ctrl+Z で戻せます）`
  - 反映: `${N} 個の印を同じ構成にしました（Ctrl+Z で戻せます）`
  - 店が文を返したら（失敗）その文を `role="alert"` で出す。

### 2. 「構成要素を追加」（`ComponentPicker.tsx`）

`LinePicker.tsx` と同じ作り（外を押す・Esc で閉じる、検索の入力、↑↓・Enter、結果の分け方）にする。違う所:

- `role="dialog" aria-label="構成要素を追加"`、検索の入力は `aria-label="構成要素を検索"`。
- 対象は**個数の項目**（`quantityMethod(f) === 'click'`）。主の項目と、すでに足した項目は除く（足した項目は「追加済み」で押せない、は LinePicker と同じでよい）。
- 結果の並び:
  1. **よく組み合わせる**（検索語が空のときだけ）: `componentSuggestions(主の項目)` の名称ごとに、
     - この PDF の個数の項目で `name` が同じものがあれば、その項目（複数あれば `order` の若い方から全部）。
     - 無ければ、`catalogItems()` の `name` が同じ品目の、個数の option（`option.method ?? 'click'` が `'click'` で `option.kind ?? 'count'` が `'count'`）の最初の1つから `catalogPresets(item, { options: [option.key] })[0]` を作った候補（この PDF の項目と `fixtureIdentity` が同じなら出さない）。
     - `catalog` は `import('../core/catalog')` で遅延読込する（書式欄の通常の表示に入れない）。読み込むまでは見出しだけ出さない。
  2. **最近使った**（`store.recentFixtureIds` の個数の項目）
  3. **この PDF の項目**（分類ごと。`groupFixtures` を使う。`LinePicker` と同じ）
  4. **標準マスタ**（検索語があるとき。`searchCatalog` の結果から個数の option だけ。30件まで。`LinePicker` の線の絞り込みを個数に替えたもの）
- 足すとき:
  - 新しい項目（標準マスタ・よく組み合わせるの品目）: `LinePicker` と同じ作り方で項目を作る。ただし見た目は個数の項目の既定（`style: nextCountStyle(fixtures)`、`line` なし）。`conditions` は preset の写し。`order` は最大＋1。
  - 構成要素の施工条件の初期値: その項目に `store.lastCondition` の記憶があればそれ。無ければ、**主の印の施工条件が、その項目の候補（`conditions`）に含まれていれば同じ値**（例: スイッチが「隠ぺい（埋込）」ならボックスも「隠ぺい（埋込）」）。それも無ければ項目の `defaultCondition`。どれも無ければ未設定。
  - 個数は 1。
  - `store.setCountComponents([印の id], [...今の extra, 新しい構成要素], 新しい項目があれば [f])`。文が返れば画面に出して閉じない。成功したら `store.rememberRouteFixture(f.id)`（最近使ったに入れる）、状態の文を出して閉じる。

### 3. 店のメソッド（`AnnotationStore.ts`）

`addConditionAndSetCountComponent(itemId: string, condition: string, ids: readonly string[]): string | undefined`

- 既存の `addConditionAndApply` を使う（候補が無ければ候補に足し、同じ履歴で値を入れる）。対象は `ids` の中で `extra` に `itemId` を持つ個数の印。各印のその構成要素の `condition` を `condition` にする。
- 主の項目ごとの `lastCountComponents` も更新する（`setCountComponents` と同じ）。`lastCondition.set(itemId, condition)` もする。
- 対象が無ければ `条件を適用できる拾いがありません。`（既存の文）。

### 4. 見た目（`styles.css`）

- 経路構成の部品のクラス（`route-items`・`route-item`・`route-item-heading`・`route-role`・`route-count`・`line-picker` など）をそのまま使い、足すのは最小限（`count-items` の余白程度）。書式欄の幅で横にはみ出さないこと。

## 試験（e2e、新規 `e2e/count-components.annotate.spec.ts`）

`e2e/route-composition.annotate.spec.ts` の作り（白紙の PDF・`window.__karu.openBytes`・`point()`・項目の追加の手順）に倣う。項目の追加の画面で「個数」の項目 `S`／名称 `スイッチ` を作り、印を置く。

1. 印を選ぶ → 書式欄に「構成要素」→ `構成要素を追加` → 「よく組み合わせる」に `スイッチボックス` が出る → 押すと構成要素の行に `SB` が出て、個数 1。集計表で `スイッチボックス` の全図面が `1`。
2. 構成要素の個数を `+` で 2 → 集計表の SB が `2`。Ctrl+Z で `1` に戻る。
3. 2つ目のスイッチの印を置く → 選ぶと構成要素に SB が引き継がれている。（2.の取り消しで引き継ぎの記憶も 1個に戻っているので）2個目の SB は 1個で、集計表の SB が `2`。
4. 1個目の印の SB を 2個にしてから `同じ項目の印すべてにこの構成を反映` → 状態の文 `2 個の印を同じ構成にしました（Ctrl+Z で戻せます）`、集計表の SB が `4`。Ctrl+Z で `3`。
5. 構成要素の施工条件で `隠ぺい（埋込）` を選べる（スイッチボックスは標準マスタの品目なので候補がある）。
6. `SBを外す` で外れる。Ctrl+Z で戻る。
7. 保存（`window.__karu` の保存の手順。既存の e2e と同じ）→ `listAnnotations` で印の `KaruCount` に `extra` が残る。開き直しても集計表の SB の値が同じ。
8. 「構成要素を検索」に `プルボックス` と入れると標準マスタの候補が出て、Enter で足せる。

## 禁止事項

- 経路構成・線要素の追加の動き、主の施工条件の欄、集計の仕組みを変えないこと。
- `catalog` を書式欄の通常の読込に静的に入れないこと（遅延読込）。
- データ（`componentSuggestions.ts`）を変えないこと。依存パッケージを足さないこと。指定外のファイルを変えないこと。

## 検証項目（Claude Code が実行する）

- [ ] 型検査、単体（全件）、`npm run build` の後 e2e（新規・`route-composition`・`count-fixtures`・`quantity-table`・`format-panel-width`）
- [ ] 画面で、スイッチにスイッチボックスを足し、次の印に引き継がれることを確認
