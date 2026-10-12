# SPEC-B03b: 数量の換算（塗装の㎡）と、略号の無い項目の札

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 数量の集計の中心（QuantityIndex）に換算を入れる変更で、集計表・Excel・CSV・一覧・拾いバーの数値の書式と単位にまたがる。保存形式の拡張もある

---

## 利用者の要望（試用版 第1版、2026-10-11）

> E25の配管塗装を入力してみたが、登録できない。長さを設定すると、平米に変換して数量が出てくるようにしたい。また、ケーブルの付帯で入力し、立上り部分のみ配管を利用し、塗装を行う等の際にも、塗装が選択できるようにしたい。

利用者の決定: 配管塗装は **拾った長さ × 外径 × π の㎡** で集計表・内訳書に出し、別紙明細の摘要に延長（m）と根拠を併記する。

## 現状（Claude Code が確かめたこと）

- 内訳書から選ぶの「塗装工事」の「配管塗装」は単位 m の長さの項目で、呼び径は摘要の入力欄（データリスト）だった。呼び径を入れないと略号も規格も空の「配管塗装」になり、どの管の塗装か分からない。㎡ にもならない。
- 経路構成に足すと、略号が空なので図面の札が `EM-CE 5.5sq-3C, （立上り）` のように名前の無い札になる（Claude が e2e で再現）。
- 利用者の画面に出た「画面の処理で問題が起きました」は、同じ手順（経路に配管塗装を足し、平面を数えない・立上りに条件を追加）では再現しなかった。原因の手掛かりのため、表示する文に例外の内容を足す（下の 5）。
- データは Claude が更新済み（変えないこと）:
  - `src/core/breakdown/pipeDiameters.ts` — 電線管・鋼管の外径（JIS）
  - `src/core/breakdown/types.ts` — `DetailVariant`、`DetailTemplate.pick`・`variants`
  - `src/core/breakdown/electricalDetails.ts` — 「塗装工事」を、規格ごとの換算の係数を持つ `variants` に変えた（配管塗装 = 電線管の呼び径ごと、ボックス塗装 = プルボックスの寸法ごと、ポール塗装 = 外径×地上高ごと）。単位は ㎡、拾い方は `pick`（配管は長さ、ボックス・ポールは個数）。

## 対象

- 対象フォルダ: リポジトリのルート
- 変更: `src/core/countFixtures.ts`、`src/core/quantityIndex.ts`、`src/core/breakdownMaster.ts`、`src/app/BreakdownPicker.tsx`、`src/app/FixtureDialog.tsx`、`src/app/FixturePanel.tsx`、`src/app/PickupBar.tsx`、`src/app/QuantityBreakdown.tsx`、`src/app/QuantityTable.tsx`、`src/app/quantityXlsx.ts`、`src/app/annotationCsv.ts`、`src/app/breakdownXlsx.ts`、`src/app/RouteItems.tsx`、`src/App.tsx`、図面の札を作る所（`fixtureDrawingCode` を使う所。`AnnotationStore.ts`・`MeasurementOverlay.tsx` など）、`src/styles.css`（必要なら）
- 試験: `tests/fixtureConvert.test.ts`（新規）、`tests/breakdownMaster.test.ts`・`tests/breakdownXlsx.test.ts`（足す）、`e2e/breakdown-master.annotate.spec.ts`（足す）
- 変えない: `src/core/breakdown/*`（データ）

## 変更内容

### 1. 項目の換算（`countFixtures.ts`）

```ts
export const CONVERT_UNITS = ['m', '㎡', '㎥', 'kg', 't'] as const
export type ConvertUnit = typeof CONVERT_UNITS[number]
/** 拾った数量（長さ m・面積・体積・個数）× factor を unit の数量として集計する */
export interface FixtureConvert { factor: number; unit: ConvertUnit; basis: string }
```

- `CountFixture` と `FixturePreset` に `convert?: FixtureConvert` を足す。
- 規則（`fixtureBreakdownError` に足すか、同じ形の `fixtureConvertError` を作って `serializeCountFixtures` で確かめる）: `factor` は有限の数で 0 より大きく 1,000,000 以下、`unit` は `CONVERT_UNITS`、`basis` は 0〜60 字（改行・タブなし）。文: 「数量の換算は、係数を0より大きい数で、単位を候補から入れてください。」
- 読み込み（`parseCountFixtures`）: 正しければ複製して取り込み、正しくなければこの欄だけ捨てる（B01 の新しい欄と同じ扱い）。
- `quantityUnit(f)`: `convert` があれば `convert.unit`。
- 新しい関数 `quantityDecimals(f): 0 | 2`: `convert` の無い個数は 0、それ以外は 2。数値の書式を「個数かどうか」で決めている所（下記）をこれに置き換える。
- 新しい関数 `quantityOutputKind(f): QuantityKind | 'mass'`: `convert` が無ければ `quantityKind(f)`。あれば unit が m → `'length'`、㎡ → `'area'`、㎥ → `'volume'`、kg・t → `'mass'`。内訳書の丸め（別紙明細の小数の桁）に使う。

### 2. 集計（`quantityIndex.ts`）

- `QuantityIndex.build` で、項目に `convert` があれば、その項目の各 `QuantityEntry.value` を **`元の値 × factor`** にし、`raw`（元の値）を持たせる（`QuantityEntry` に `raw?: number` を足す。換算の無い項目は持たない）。
- 合計・図面別・条件別・場所別はすべて換算後の値になる。`ConditionTotal` に `raw: number`（換算前の合計。換算の無い項目は `total` と同じ）を足す。
- `rawTotal(itemId): number` を足す（換算前の合計）。
- 個数の印のページ別の一覧（`countPages`）を使う所が、値を「1個」と見なしていないか確かめ、印の数として使う所には影響しないようにする（値ではなく件数を数えているなら変えない）。

### 3. 数値の書式と単位

- 次の「`quantityKind(f) === 'count'` なら整数、それ以外は小数2桁」を `quantityDecimals(f)` に置き換える: `FixturePanel.tsx` 107 行付近、`PickupBar.tsx` 36 行付近、`QuantityBreakdown.tsx` 74 行付近、`QuantityTable.tsx` 323 行付近、`annotationCsv.ts` 177 行付近（明細の CSV の数量の列の書式も同じ）、`quantityXlsx.ts` の数値の書式（`borderedInteger`／`borderedDecimal`）。
- `FixturePanel.tsx` の行で、単位を「個数でないときだけ」出している条件は、`convert` のある項目でも単位（㎡）を出す。
- `RouteItems.tsx` の経路の行の長さの式（`… ＝ 2.00 m`）の後に、`convert` のある項目では `（≒ 0.16 ㎡）`（長さ×条数×係数、小数2桁）を足す。

### 4. 内訳書の塗装（`breakdownMaster.ts`・`BreakdownPicker.tsx`・`breakdownXlsx.ts`）

- `kindForUnit` は変えない。`variants` のある明細の拾い方は `pick` で決める（`'length'` → 長さ・polyline、`'count'` → 個数）。
- `presetsFromDetail(entry, template, values, masterChoices, variants?)`: 引数 `variants?: readonly DetailVariant[]` を足す。`template.variants` があるときは、選んだ `variants` ごとに1つ作る: `name` = `template.name`、`code` = `variant.code`、`spec` = `variant.spec`、拾い方は `pick`、`convert` = `variant.convert` の複製、`unit` は持たせない（個数でも単位は convert の ㎡）、`breakdown`・`summary`（values の値のあるもの）、`category` は今と同じ規則、`aggregation` は `'document'`。`variants` が空なら `[]`。`template.variants` に無いものが渡されたら `Error`。
- `BreakdownPicker.tsx`: `variants` のある明細は、`master` のある明細と同じ見た目で、規格（variant）のチェックボックスを並べる（`aria-label` は `${variant.code} ${template.name}`、横に `variant.convert.basis` を小さく）。「すべて選ぶ」「選択を解除」のボタンを明細ごとに置く。摘要（塗料）の入力欄は今の形のまま（B03c で全体をチェック方式にする）。
- `breakdownXlsx.ts`: 別紙明細の行で、`convert` のある項目は、摘要の末尾に `延長 ${換算前の数量（長さは小数1位）}m、${basis}`（個数で拾ったものは `${個数}か所、${basis}`）を「、」で足す。数量は換算後の値で、丸めは `quantityOutputKind` で決める（㎡ は小数2位）。換算前の数量は `byCondition` の `raw`。
- 細目別内訳の丸め・単位も `quantityOutputKind`・`quantityUnit` に合わせる。

### 5. 項目の編集画面（`FixtureDialog.tsx`）

「内訳書」の `<details>` の下に、もう1つ `<details className="fixture-convert">`（要約 `数量の換算（塗装の㎡など）`。`convert` があれば開いた状態）:

- `<input type="checkbox" aria-label="数量を換算する">`。オンのとき:
  - 単位 `<select aria-label="換算後の単位">`（`CONVERT_UNITS`）、係数 `<input aria-label="換算の係数" inputMode="decimal">`、根拠 `<input aria-label="換算の根拠" maxLength={60}>`。
  - 係数を作る計算の補助（ボタンで係数と根拠を入れる）:
    - 長さの項目: 「管の外径から」 外径 mm を入れて「係数にする」→ 係数 = π×外径/1000、根拠 `外径 {D}mm × π`、単位 ㎡。「角の周長から」 幅・高さ mm → 係数 = 2×(幅+高さ)/1000、根拠 `周長 2×({W}+{H})mm`、単位 ㎡。
    - 個数の項目: 「箱の寸法から」 幅・高さ・奥行 mm と面（`背面を除く5面`／`6面`／`前面のみ`）→ 面積、根拠 `{W}×{H}×{D} {面}`、単位 ㎡。「ポールから」 外径 mm・地上高 m → 係数 = π×外径/1000×地上高、根拠 `外径 {D}mm × π × 地上高 {H}m`、単位 ㎡。
  - 下に見本の式: `1 m → {係数} ㎡`（個数は `1 か所 → …`）。
- オフで保存すると `convert` を持たない。係数が数でない・0 以下などは保存せず、1 の文を出す。

### 6. 略号の無い項目の札

- `fixtureDrawingCode` を使って図面の札（長さの札・経路の追加の項目の表示・経路の数のバッジの説明など）を作る所で、略号が空のときは **名称**（`f.name`）を使う。新しい関数 `fixtureLabelCode(f) = fixtureDrawingCode(f) || f.name` を `countFixtures.ts` に作り、札に使う所だけ置き換える（項目の選択の一覧・CSV・Excel の「略号」の列は変えない）。
- 個数の印の横の文字（略号が空なら今は何も出ない）は変えない。

### 7. 例外の内容を表示する（`App.tsx`）

- 「画面の処理で問題が起きました。書き込みは保持されています。」の後に、例外の文を 120 字以内で `（詳細: …）` と足す（`event.error?.message ?? event.message`、Promise は `reason?.message ?? String(reason)`）。文が無ければ今のまま。

### 8. 試験

単体 `tests/fixtureConvert.test.ts`:
1. `convert` の保存・読み込みの往復、不正な値はその欄だけ捨てる、保存は誤り。
2. `QuantityIndex`: 長さ 2.0 m の線（E25塗装、係数 π×25.4/1000）→ 合計 ≒ 0.1596、`rawTotal` 2.0、条件別の `raw`。個数 3 か所 × 0.12 → 0.36。換算の無い項目は今と同じ値。
3. `quantityUnit`・`quantityDecimals`・`quantityOutputKind`。
4. `presetsFromDetail` で配管塗装の E25 と E19 → 2件、`code` `E25塗装`、`spec` `E25`、`kind: 'length'`、`convert.unit` `㎡`。ボックス塗装 → 個数・`convert`。
5. `breakdownXlsx`: 配管塗装（長さ 4.0 m）の別紙明細の行の数量が ㎡（小数2位）、摘要に `延長 4.0m、外径 25.4mm × π`。

e2e（`e2e/breakdown-master.annotate.spec.ts` に1件）: 内訳書から「塗装工事 → 配管塗装」の `E25塗装` を追加し、ケーブルの経路の「線要素を追加」から `E25塗装` を足し、平面を数えない・立上り 2 m にする。数量の一覧の `E25塗装` の行が ㎡ で `0.16`、図面の札に `E25塗装` が出る。

## 禁止事項

- `src/core/breakdown/*` のデータを変えないこと（誤りに気付いたら報告）。
- 換算の無い項目の数値・書式・単位を変えないこと。
- 依存パッケージを足さないこと。指示していないリファクタをしないこと。

## 検証項目（Claude Code が実行する）

- [ ] 型検査、単体（新規・変更分・全件）、`npm run build` の後の e2e（数量拾い関係・内訳書）
- [ ] 画面で、配管塗装を経路の立上りだけに付けて ㎡ が出ること
