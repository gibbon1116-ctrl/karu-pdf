# SPEC-S16: 面積の除外範囲・開口部・建具の寸法（データ・計算・保存・PDF の描画）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 保存データ（拾い・項目・計測）の形を足し、数量の計算と PDF の描画を変える。古い版との互換と上限の判断が要る

---

## 利用者の要望（計画書「面積の除外と計上方法」）

- 床・天井など「囲む」で拾う面積から、柱・吹抜・シャフトなどを、図面で囲んで除外する。
- 壁など「長さ×高さ」の面積から、開口部を「幅×高さ×箇所数」で除外する。分類で設定した建具（個数の項目）を指定しても除外できる。
- 「計測▼ → 面積」でも、除外範囲を囲める。
- 面積を「長さ×高さ」と「図面の範囲を囲む」のどちらで計上するかを、拾いごとに選べる（画面は S17）。

この SPEC は、データ・計算・保存・PDF の描画だけを作る。画面の操作は S17。

## 現状（Claude Code が確かめたこと）

- 拾いは `QuantityMark`（`src/core/quantity.ts`）。`method` は拾いごと（`polygon`・`lengthHeight`・`polygonDepth`・`lengthWidthDepth`・`polyline`）。PDF の注釈の `KaruQuantity` に JSON で保存（`parseQuantityMark`・`serializeQuantityMark`）。
  - 古い版は JSON が 2000 文字を超える拾いを読まない（`quantity.ts` 162 行付近のコメント）。
- 値は `quantityValue(points, mmPerPoint, mark)`、図面の札は `quantityLabel(...)`。呼ぶ場所：`quantityIndex.ts` 80 行、`AnnotationStore.ts` 1049 行、`MeasurementOverlay.tsx` 224・261 行、`FormatPanel.tsx` 198〜200 行、`FixtureDialog.tsx` 139 行。
- 項目は `CountFixture`（`src/core/countFixtures.ts`）。`QUANTITY_METHODS` は種別ごとの拾い方。`f.method` が項目の拾い方。
- 計測は `MeasureSettings { kind; unit; mmPerPoint; decimals }`（`src/core/measure.ts`）。注釈の `KaruMeasure` に JSON で保存。値と文字は `measureText(points, settings)`。
- 囲む拾い・計測の面積は、PDF の Polygon 注釈（頂点）。

## 変更内容

### 1. 拾いに除外範囲と開口部を足す（`src/core/quantity.ts`）

- `QuantityMark` に次を足す（どちらも省略できる）：
  - `holes?: Point[][]`：除外範囲（ページの pt 座標の多角形）。`method` が `polygon`・`polygonDepth` のときだけ。
  - `openings?: QuantityOpening[]`：開口部。`method` が `polygon`・`lengthHeight` のときだけ。
    - `QuantityOpening = { itemId?: string; widthM?: number; heightM?: number; count: number }`
    - `itemId` があれば建具の項目（寸法は項目から。下の 3）。`widthM`・`heightM` は、項目が無い・寸法が無いときの控え（指定した時点の寸法）。
    - `itemId` が無ければ `widthM`・`heightM` が必須。
- 読み書き（`parseQuantityMark`・`serializeQuantityMark`）：
  - `holes`：多角形は 3〜500 点、有限の数、50 個まで。
  - `openings`：50 件まで。`count` は 1〜999 の整数。`widthM`・`heightM` は 0 より大きく 100 以下。`itemId` は今の `itemId` と同じ決まり。
  - 決まりに合わないものは、その値（`holes` か `openings`）だけを捨て、拾いは残す。
  - `method` に合わない `holes`・`openings` も捨てる。
  - 新しい版の読み込みの文字数の上限を、`holes` が入っても足りるように上げる（例：64,000 文字）。上限を超える拾いは、今と同じく保存しない（例外にする）。
- 値（`quantityValue`）：
  - 引数に、建具の寸法を返す関数を足す（省略できる）：`openingSize?: (itemId: string) => { widthM: number; heightM: number } | undefined`。
  - 元の面積：`polygon` は外形の面積、`lengthHeight` は長さ×高さ、`polygonDepth` は外形の面積（深さを掛ける前）。
  - 除外範囲の面積：各 `holes` の面積（`polygonArea` × 縮尺）の合計。
  - 開口部の面積：各開口の 幅×高さ×箇所数 の合計。`itemId` があり `openingSize(itemId)` が寸法を返せばそれを、無ければ控えの `widthM`・`heightM` を使う。どちらも無ければ 0（下の札で「?」）。
  - `polygon`：元 − 除外 − 開口。`lengthHeight`：元 − 開口。`polygonDepth`：（元 − 除外）× 深さ。0 未満は 0。
  - `holes`・`openings` が無い拾いの値は、今と 1 つも変えない。
- 札（`quantityLabel`）：
  - 差し引きがあるときだけ、式に差し引きを入れる。例：
    - `polygon`：`25.00−3.20=21.80 m²`
    - `lengthHeight`：`12.00×H2.70−開口4.32=28.08 m²`
    - `polygonDepth`：`(25.00−3.20)×D0.30=6.54 m³`
  - 開口部の寸法が分からないもの（建具が消えた・寸法が無い、控えも無い）があれば、開口の値の後に「?」を付ける（例：`−開口4.32?`）。
  - 差し引きが無い拾いの札は、今と 1 つも変えない。
  - `openingSize` を `quantityLabel` にも渡せるようにする（省略できる）。

### 2. 建具の寸法（`src/core/countFixtures.ts`）

- `CountFixture` に `opening?: { widthM: number; heightM: number }` を足す。個数の項目（`kind` が `count`）だけ。
  - 0 より大きく 100 以下。合わなければ捨てる（項目は残す）。
- 保存・読込み・複製・他の PDF からの読込みで保持する（今のほかの値と同じ扱い）。
- 補助：`fixtureOpeningSize(fixtures)` のような関数で、`itemId` → 寸法を返す（`quantityValue` の `openingSize` に渡す）。

### 3. 数量の集計（`src/core/quantityIndex.ts`）

- `quantityValue` に、項目の一覧から作った `openingSize` を渡す。
- 建具の項目の寸法が変わったら、集計を作り直す（今の作り直しの条件に、項目の `opening` の変化を入れる。作り直しの仕組みは今のものを使う）。

### 4. 図面の札・書式欄の呼び出し

- `AnnotationStore.ts`・`MeasurementOverlay.tsx`・`FormatPanel.tsx`・`FixtureDialog.tsx` の `quantityLabel`・`quantityValue` の呼び出しに、`openingSize` を渡す（項目の一覧から）。`FormatPanel.tsx` 198 行の「面積」の表示は、元の面積のままでよい（この拾いの値の行が差し引き後を出す）。

### 5. 計測の面積の除外範囲（`src/core/measure.ts`、`src/core/annotations.ts`）

- `MeasureSettings` に `holes?: Point[][]` を足す。`kind` が `area` のときだけ。決まりは 1 と同じ。
- `measureText`：面積から除外範囲の面積を引いた値を出す。差し引きがあるときは `25.00−3.20=21.80 m²` の形（単位・小数の桁は今の設定どおり）。無ければ今と同じ。
- `KaruMeasure` の読み書きで `holes` を保持する。

### 6. PDF の描画（`src/core/annotations.ts`）

- 除外範囲がある囲む拾い・計測の面積は、PDF の見た目（外観）に除外範囲の輪郭を描く（他の PDF ビューアーでも分かるように）。
  - 外形は今と同じ。除外範囲は、外形と同じ色の細い破線と、斜線（または薄い塗り）で示す。
  - 外観の作り方は、今の Polygon 注釈の外観の作り方に合わせる（mupdf の表示リストで描く既存の方法があればそれを使う）。
- 除外範囲が無い注釈の外観は、今と 1 つも変えない。

### 7. アプリの図面の描画（`src/editor/AnnotationLayer.tsx`）

- 除外範囲がある囲む拾い・計測の面積は、外形の中に除外範囲を斜線で描く（PDF の外観と同じ見た目）。
- 札は 1・5 の値。

## 変えないこと

- 除外範囲・開口部が無い拾い・計測の値・札・PDF の外観・保存の中身。
- 数量の集計表・CSV・Excel（値が差し引き後になるだけ）。

## 試験

- `tests/quantity*.test.ts`（足す。無ければ新しい試験ファイル）：
  - 読み書き：`holes`・`openings` の保持、決まりに合わないものを捨てる、`method` に合わないものを捨てる、無い拾いは今と同じ文字列。
  - 値：`polygon` − 除外 − 開口、`lengthHeight` − 開口、`polygonDepth`（元 − 除外）× 深さ、0 未満にならない、建具の寸法の変更が値に効く、建具が無いときは控えの寸法、控えも無ければ 0。
  - 札：上の例の形。差し引きが無いときは今と同じ。寸法の分からない開口に「?」。
- `tests/countFixtures*.test.ts`：`opening` の保存・読込み・捨てる条件。
- `tests/quantityIndex*.test.ts`：開口部に建具を指定した拾いの値が、建具の寸法を変えると変わる。
- 計測：`measureText` の差し引き。
- PDF：除外範囲付きの拾い・計測を保存して読み直すと、値・除外範囲が同じ。外観に除外範囲の描画が入る（外観のストリームに破線などの描画がある）。

## 対象

- 変更：`src/core/quantity.ts`、`src/core/countFixtures.ts`、`src/core/quantityIndex.ts`、`src/core/measure.ts`、`src/core/annotations.ts`、`src/editor/AnnotationLayer.tsx`、`src/editor/AnnotationStore.ts`、`src/editor/MeasurementOverlay.tsx`、`src/app/FormatPanel.tsx`、`src/app/FixtureDialog.tsx`
- 試験ファイル
- 変更しないファイル：上以外。画面の操作（除外範囲を囲む・開口部の入力・建具の寸法の入力・計上方法の切替）は S17 で作るので、この SPEC では作らない。

## 禁止事項

- 既存の関数名・入力名を変えないこと（引数を足すのはよい）。既存の保存データの読み方を変えないこと。
- git の操作をしないこと。python・pytest は使わない。

## 報告してほしいこと

- 変更点、SPEC から逸脱した箇所と理由、Claude Code に実行してほしい試験。
