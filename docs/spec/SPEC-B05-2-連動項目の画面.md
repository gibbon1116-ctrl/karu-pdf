# SPEC-B05-2: 連動項目の画面（項目の編集・数量タブ・根拠）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 項目の編集画面の新しい欄（元の選択・係数・施工条件・上書き・見本の計算）、数量タブ・内訳の表示、拾いの道具との整合、e2e にまたがる

---

## 背景

計画: 非公開の調査資料。B05-1 で `CountFixture.link`（`src/core/fixtureLink.ts`）と、数量の索引の連動の計算（`QuantityIndex.linkResult(id)`）、店の `linkDependents(id)` ができた。この SPEC で画面を作る。集計表・Excel は B05-3。

## 対象

- 変更: `src/core/countFixtures.ts`（単位・小数の桁）、`src/app/FixtureDialog.tsx`、`src/app/FixturePanel.tsx`、`src/app/QuantityBreakdown.tsx`、`src/app/PickupBar.tsx`、`src/editor/AnnotationLayer.tsx`（抜粋の2か所）、`src/styles.css`
- 新規: `e2e/linked-fixtures.annotate.spec.ts`
- 試験: `tests/fixtureLink.test.ts` に単位の試験を足す
- 変えない: `src/core/fixtureLink.ts` の計算、`quantityIndex.ts`、集計表・Excel・CSV

## 1. 連動項目の単位（`countFixtures.ts`）

- `quantityUnit(f)`: `f.link?.kind === 'mass'` なら、`f.link.densityTPerM3` があれば `'㎥'`、無ければ `'t'`。それ以外は今と同じ。
- `quantityDecimals(f)`: `link.kind === 'mass'` なら 2。それ以外は今と同じ（係数の連動は、項目の種別・単位どおり。個数なら 0）。
- `quantityOutputKind(f)`: `link.kind === 'mass'` なら `densityTPerM3` があれば `'volume'`、無ければ `'mass'`。
- 引数の型（`Pick<…>`）に `link` を足す。呼び出し元の型が通るようにする。

## 2. 項目の編集画面（`FixtureDialog.tsx`）

### 2.1 「連動（ほかの項目から数量を計算する）」の欄

`<details className="fixture-link">`、`<summary>連動（ほかの項目から数量を計算する）</summary>`。今の「数量の換算」の欄の直前に置く。項目に `link` があれば開いた状態で始める。

- `<label><input type="checkbox" aria-label="連動にする">連動にする（図面には拾わず、ほかの項目の数量から計算する）</label>`
  - 拾いのある項目（`hasMarks`）は押せない。その下に `拾いがある項目は連動にできません`。
  - オンにすると `link = { kind: 'factor', sources: [] }`。`convert` があれば外し、`連動にすると数量の換算は使えません（換算を外しました）` を出す。連動の間は「数量の換算」の欄の入力を押せなくする。
  - オフにすると `link` を外す。
- 種類: ラジオ `係数で計算する`（`factor`）／`質量に換算する（t・㎥）`（`mass`）。
- **元の項目**:
  - 検索の入力（`aria-label="元の項目を検索"`、略号・名称・分類で絞る）と、今ある項目（自分自身を除く）の分類ごとのチェックの一覧。チェックの `aria-label` は `${fixtureCode(f)} ${f.name}を元にする`。連動項目も元にできる（名前の後ろに「（連動）」）。
  - 選んだ元の行（選んだ順）:
    - 名称と、計算の方法の選択 `aria-label="${code}の計算"`: `× 係数`／`÷ 間隔（m）`。数値の入力 `aria-label="${code}の係数"` または `"${code}の間隔（m）"`（既定 係数 1、間隔 1.5）。
    - 元の項目に施工条件の候補があれば、`施工条件で絞る` のチェック（`未設定` と各候補。`aria-label="${code}を${条件}だけにする"`）。どれも付けなければ全部。
    - 種類が質量のとき: 元の質量を表示（個数の項目は `attributes.massKg` の「単体 ○ kg」、それ以外は `attributes.unitMassKg` の「1${単位}あたり ○ kg」）。無ければ `質量が未設定です（その項目の編集の「質量・寸法」で入れてください）`。
    - `×`（`aria-label="${code}を元から外す"`）。
  - 50 項目を超えては選べない。
- 施工条件: ラジオ `元の施工条件を引き継ぐ`（既定）／`固定する`。固定のときは、この項目の施工条件の候補から選ぶ（`aria-label="連動の施工条件"`。候補が無ければ「施工条件の候補を先に入れてください」）。
- 切り上げ（係数の連動で、元に `÷ 間隔` があるか、項目が個数のときだけ出す）: `aria-label="切り上げ"` の選択 `合計で切り上げる`（既定）／`拾いごとに切り上げる`／`切り上げない`。
- 質量のとき: `見かけ比重（t/㎥）` の入力（空なら t のまま、入れると ㎥）。単位の表示（t／㎥）を更新する。
- 上書き: `<label><input type="checkbox" aria-label="数量を手で上書きする">数量を手で上書きする</label>`。オンで数値（`aria-label="上書きの数量"`）とメモ（`aria-label="上書きの理由"`、200字）。
- **見本**: 欄の下に、今の拾いで計算した結果（`合計 ○ ${単位}`、元ごとの `数量 × 係数 = 小計` の短い一覧、誤り・警告）。計算は新しい省略可能な props `previewLink?(draft: CountFixture): LinkResult | undefined` で受け取る（数量タブから開くときに渡す。無ければ見本を出さない）。
- 保存の検査: `fixtureLinkError` の文。加えて、元が 0 件なら `元の項目を1つ以上選んでください`、見本の計算が循環の誤りなら `連動の元が循環しています。` で保存しない。

### 2.2 「質量・寸法（搬入・発生材の計算に使う）」の欄

`<details className="fixture-attributes">`。`attributes` の入力: 個数の項目は `単体質量（kg）`（`massKg`）、それ以外は `1${単位}あたりの質量（kg）`（`unitMassKg`）。共通に `幅（mm）`・`奥行（mm）`・`高さ（mm）`・`外径（mm）`・`発生材の種類`（自由入力 20 字）。空は持たない。検査は今の `fixtureBreakdownError` の属性の検査に従う。

## 3. 数量タブ（`FixturePanel.tsx`）

- 連動項目の行: 略号の後ろに札 `連動`（`className="fixture-link-badge"`）。`index.linkResult(id)` に誤りがあれば札を `連動の誤り`（`title` に文）、上書きなら `上書き` の札も。数量（この図面・全図面）は今と同じく索引から。
- 連動項目の行・最近使った・よく使う構成から連動項目を選んだときは、項目を選ぶ（`store.selectFixture`）が、**拾いの道具に切り替えない**（`ui?.select()` を呼ばない）。状態の文 `連動の項目は図面に拾いません（ほかの項目の拾いから計算します）`。
- 項目の削除の確認: その項目を元にする連動項目（`store.linkDependents(id)`）があれば、確認の文に `連動項目「A」「B」の元から外れ` を足す。
- 項目の編集画面を開くとき、`previewLink` に「下書きの項目でほかの項目を置き換えた一覧で `computeLinks` を計算し、その項目の結果を返す」関数を渡す（`store.quantityIndex().entries` を元の行に使う）。

## 4. 数量の内訳（`QuantityBreakdown.tsx`）

- 連動項目のとき、今の内訳（図面・階・部屋ごと）の上に「計算の根拠」を出す（`index.linkResult(fixture.id)`）:
  - 元ごとに `${略号} ${名称}  ${数量}${元の単位} × ${係数}`（または `÷ ${間隔} m`、質量は `× ${単位質量} kg`）`＝ ${小計}`。
  - 合計の行（切り上げがあれば `合計で切り上げ` などを添える）。上書きなら `上書き ${値}（計算値 ${computed}、差 ${差}）` とメモ。誤り・警告の文。
- 内訳の行から位置へ移動するとき（`revealPickup`）、連動項目の行は元の拾いを指すので、移動先の拾いの**その拾い自身の項目**を選ぶ（連動項目を拾いの道具に選ばない）。

## 5. 拾いの道具（`PickupBar.tsx`・`AnnotationLayer.tsx`）

- 拾いバーの項目の候補から連動項目を除く。
- `AnnotationLayer.tsx`: 拾いの道具で選ばれている項目が連動項目なら、図面を押しても何も作らず `props.onStatus('連動の項目は図面に拾いません（ほかの項目の拾いから計算します）')`。線・面の拾い（`useMeasurementInteraction` の `quantityItem`）にも連動項目を渡さない（抜粋の2か所）。

## 6. 試験

`tests/fixtureLink.test.ts`: 質量の連動の単位 `t`・`㎥`、桁 2、`quantityOutputKind`。

e2e（新規 `e2e/linked-fixtures.annotate.spec.ts`。`e2e/count-components.annotate.spec.ts` の作り方に倣う）:
1. 個数の項目 `DL`（印 3 個）と `SL`（印 1 個）を作る。項目 `器具取付`（個数）を追加し、連動にして DL と SL を元にし、SL の係数を 2 にする → 見本が `合計 5`。保存すると数量タブの行に `連動` の札、全図面 `5`。
2. `器具取付` を一覧で押しても拾いの道具に切り替わらず、状態の文が出る。図面を押しても印は増えない。
3. 内訳を開くと計算の根拠に DL・SL の行と合計 5。
4. SL を削除すると確認の文に `連動項目「器具取付」の元から外れ` が入る。削除後は 3。Ctrl+Z で 5 に戻る。
5. 上書き 10 → 全図面 `10`、`上書き` の札、内訳に `計算値 5、差 +5`。
6. DL の「質量・寸法」で単体質量 2 kg。項目 `発生材` を連動（質量）にして DL を元にする → `0.01 t`（3×2÷1000 = 0.006 → 表示は 2 桁で `0.01`）。見かけ比重 0.5 で `㎥` に変わる。
7. 拾いのある DL の編集画面で「連動にする」が押せない。
8. 循環（器具取付 → 発生材 → 器具取付）は保存できず `連動の元が循環しています。`。

## 禁止事項

- `fixtureLink.ts` の計算・`quantityIndex.ts` を変えないこと（足りない関数があれば報告）。
- 連動項目が無い文書の画面・数量を変えないこと。
- 依存パッケージを足さないこと。指定外のファイルを変えないこと。

## 検証項目（Claude Code が実行する）

- [ ] 型検査、単体（全件）、`npm run build` の後 e2e（新規・数量拾い関係・内訳書・拾いバー・書式欄の幅）
- [ ] 画面で、連動の欄と根拠の表示を確認
