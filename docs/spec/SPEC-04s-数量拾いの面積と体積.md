# SPEC-04s: 数量拾いの面積と体積（第2段）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 4つの拾い方（囲む／長さ×高さ／囲む×深さ／長さ×幅×深さ）を、操作・外観・書式欄・項目の画面・見本・CSV へ横断して足すため（判定表「新規機能の実装」）

> Codex デスクトップアプリへ貼り付けて実行する場合は、モデルセレクタを上記に合わせてから貼り付けること。

---

## 目的

SPEC-04r（第1段）で、器具リストを「数量拾い」に改め、項目に種別（個数・長さ・面積・体積）を持たせ、長さの拾いを作った。この第2段では、利用者が選んだ**面積と体積の4つの拾い方**を使えるようにする。

| 種別 | 拾い方（method） | 図面での操作 | 値 | 使いどころ（利用者の例） |
|---|---|---|---|---|
| 面積 | 囲む（`polygon`） | 多角形で囲む | 面積 m² | 内部足場、床の撤去範囲 |
| 面積 | 長さ×高さ（`lengthHeight`） | 折れ線でなぞる | 長さ × 高さ m² | 外部足場、壁面 |
| 体積 | 囲む×深さ（`polygonDepth`） | 多角形で囲む | 面積 × 深さ m³ | 根切り、床掘り |
| 体積 | 長さ×幅×深さ（`lengthWidthDepth`） | 折れ線でなぞる | 長さ × 幅 × 深さ m³ | ケーブル・配管の埋設の溝掘削 |

最初に SPEC-04r と、その実装（コミット `d67a787`）を読むこと。第1段の要点（Claude Code が確認したこと）:

- `src/core/quantity.ts`: `parseQuantityMark`・`quantityPoints`・`quantityValue`・`quantityLabel`・`quantityDashes` は6つの method すべてに対応済み。
- `src/core/countFixtures.ts`: `QuantityKind`・`QuantityMethod`・`QUANTITY_METHODS`・`QUANTITY_UNITS`・`quantityKind`・`quantityMethod`・`quantityLine`・`sameFixtureAppearance`。見本は `presets`（個数）と `lengthPresets`（長さ）の2つの表から `FIXTURE_PRESETS` を作っている。面積・体積の見本も同じ形で足す（初期値を持たせられるようにする）。
- `src/editor/AnnotationStore.ts`: `quantityText`（文字列の作り直しの入口）、`applyFixtureToQuantity`、`updateQuantityAdd`（加算の更新。`Ctrl+Z` 対応）、`selectedQuantitiesOnly`、`fixtureMarkCount`。高さ・幅・深さの更新は `updateQuantityAdd` を一般化して作る（例: `updateQuantityValues(id, { heightM, widthM, depthM })`）。加算の呼び出しはそれに寄せてよい。
- `src/app/FormatPanel.tsx`: 拾いの欄と `QuantityAddInput`。入力と単位は `<span className="quantity-input-unit">` で横に並べている（Claude Code のレビューで直した）。高さ・幅・深さの入力も同じ部品を一般化して使う。
- `src/core/annotations.ts`: 破線は `drawMeasurement` の `StrokeState.dashes` に加え、MuPDF が破線を落とすため外観ストリームに `[..] 0 d` を補っている。Polygon でも同じ処理が効くことを確かめる。
- `src/editor/MeasurementOverlay.tsx`: 道具 `count` で長さの項目を選んだときに `quantityItem` を渡して折れ線の操作を使っている。囲む拾い方では、面積の操作に同じく `quantityItem` を渡す。

## 対象

- 対象フォルダ: `C:\Users\gibbo\Desktop\PDF編集アプリ\.claude\worktrees\quantity-pickup-expansion-ea43cf`
- 新しく作るファイル: `e2e/quantity-area-volume.annotate.spec.ts`
- 変更してよいファイル: SPEC-04r と同じ範囲（`src/core/`、`src/editor/`、`src/app/`、`src/ui/ToolIcon.tsx`、`src/App.tsx`、`src/styles.css`、`tests/`、`e2e/`）
- 変更しないファイル: `docs/`、`public/`、`LICENSE`、設定ファイル、`src/organize/`、`scripts/`、`src/viewer/`、`src/worker/`（第1段で足した受け渡しで足りないときだけ最小限）

## 変更内容

### 1. 拾う操作

- 道具 `count`（数量拾い）で選んだ項目の method で操作を分ける（第1段の分岐に足す）。
  - `polygon`・`polygonDepth`: 今の「面積」の計測と同じ操作（クリックで点を足す、ダブルクリックか `Enter` で閉じて終える、3点以上、`Backspace`・`Esc`・`Shift`）。
  - `lengthHeight`・`lengthWidthDepth`: 長さ（`polyline`）と同じ操作。
- なぞっている間の値（カーソルのそば）は、項目の `defaults`（高さ・幅・深さ）で計算した `quantityLabel`。
- 終えたら、項目の `defaults` の値を拾いの印（`KaruQuantity`）に写す。
  - 必要な値（`lengthHeight` の高さ、`polygonDepth` の深さ、`lengthWidthDepth` の幅と深さ）が項目の `defaults` に無いか 0 のときは、拾いを作る前に、小さな入力の画面を出して聞く（「高さ [    ] m」など。［決定］［やめる］。`Enter` で決定、`Esc` でやめる）。入れた値はその拾いだけに使う（項目の `defaults` は変えない）。
- 縮尺の無いページでは、今の計測・長さの拾いと同じく縮尺のダイアログを開く。

### 2. 図面での表示

- 囲む拾い（`polygon`・`polygonDepth`）の塗り: 項目の色を、項目の透明度 × 0.15 で塗る（今の計測の面積と同じ考え方）。輪郭は項目の線の種類・太さ。
- 長さ×高さ、長さ×幅×深さ: 長さの拾いと同じく折れ線だけ（塗らない）。
- 値の文字の位置: 囲む拾いは今の面積の計測と同じ（`polygonLabelPoint`）。折れ線の拾いは、今の連続した長さと同じ（最後の点の近く）。
- 重ね描き・PDF の描画からの除外・表示の切替・保存した外観は、第1段の長さと同じ仕組みに乗せる（Polygon の注釈は `/IT /PolygonDimension`、`MeasureSettings.kind` は `area`）。保存した外観でも、塗り・破線・値の文字が出ること。

### 3. 選んだ拾いの書式欄

第1段の欄に、method ごとの入力を足す。入力の決まり（0〜1,000、小数2桁まで、確定で反映、`Ctrl+Z` で戻せる）は加算の欄と同じ。

| method | 表示のみ | 入力 |
|---|---|---|
| polygon | 面積 `48.00 m²` | なし |
| lengthHeight | 長さ `24.00 m` | 高さ [3.50] m |
| polygonDepth | 面積 `12.00 m²` | 深さ [1.20] m |
| lengthWidthDepth | 長さ `10.00 m` | 幅 [0.60] m、深さ [0.80] m |

最後に「この拾い」として `quantityLabel` の値（単位付き）を出す。「項目を変更」は第1段どおり、同じ method の項目だけを出す。

### 4. 項目を追加・編集する画面

- 種別のラジオボタンに `面積` `体積` を足す（個数・長さ・面積・体積の4つ）。拾いがある項目は種別も拾い方も変えられない（第1段と同じ）。
- 面積・体積のとき、「拾い方」を選ぶラジオボタンを出す:
  - 面積: `囲む` ／ `長さ×高さ`
  - 体積: `囲む×深さ` ／ `長さ×幅×深さ`
- 拾い方に応じて、新しく拾うときの初期値の欄を出す: 高さ（長さ×高さ）、深さ（囲む×深さ）、幅と深さ（長さ×幅×深さ）。空欄を許す（空欄なら、拾うときに聞く。上の 1.）。
- 線の種類・線の太さ・色・透明度・文字の大きさ・略号を図面に表示 は長さと同じ。形・塗り・見本の切り取りは出さない。
- プレビュー: 囲む拾い方は塗った四角形、折れ線の拾い方は折れ線。値の見本は `quantityLabel` の形（初期値が空欄なら、高さ等を `?` で出す。例 `外部足場 24.00×H?=? m²`）。
- 見た目の重なりの判定は、第1段の「長さ以上どうしは、種別・色・線の種類・線の太さ」に、拾い方も加える。

### 5. 見本から追加

`FIXTURE_PRESETS` に分野「仮設・土工」を足す。

| 分類 | 略号 名称 | 種別・拾い方 | 初期値 |
|---|---|---|---|
| 仮設 | `外部足場 外部足場（長さ×高さ）` | 面積・lengthHeight | 高さは空欄 |
| 仮設 | `内部足場 内部足場（囲む）` | 面積・polygon | — |
| 仮設 | `養生 養生（囲む）` | 面積・polygon | — |
| 土工 | `根切り 根切り（囲む×深さ）` | 体積・polygonDepth | 深さは空欄 |
| 土工 | `床掘り 床掘り（囲む×深さ）` | 体積・polygonDepth | 深さは空欄 |
| 土工 | `溝掘削 ケーブル・配管の溝掘削（長さ×幅×深さ）` | 体積・lengthWidthDepth | 幅 0.60、深さ 0.80 |
| 撤去 | `床撤去 床仕上げの撤去（囲む）` | 面積・polygon | — |
| 撤去 | `天井撤去 天井の撤去（囲む）` | 面積・polygon | — |

略号は 16 文字以内であること（今の上限）。見本の一覧では、第1段と同じく `（面積・m²）`・`（体積・m³）` を添える。

### 6. 集計・CSV・書き込みタブ

- 一覧の「この図面」「全図面」は、面積は m²、体積は m³ の小数2桁。行の名前の後ろの単位、上の要約、`title` も単位を合わせる。
- 一覧の「印」の欄: 囲む拾い方は塗った小さな四角、折れ線の拾い方は短い線。
- 数量表 CSV: 種別 `面積`・`体積`、単位 `m²`・`m³`。値は小数2桁。
- 書き込みタブの一覧の種類の名前: `数量拾い（面積）`・`数量拾い（体積）`。
- ヘルプ（`HelpDialog.tsx`）の数量拾いの説明に、面積・体積の4つの拾い方と、高さ・幅・深さを後から書式欄で直せることを足す。

## 動作の軽さ

第1段と同じ。通常の読込に何も足さない。なぞっている間は画面側の計算と SVG の書き換えだけ。

## テスト

- **単体**: 項目の画面の組（種別と拾い方）の読み書き、見本「仮設・土工」の追加、数量表 CSV の面積・体積の行、`quantityLabel` の初期値が空のときの見本の文字（`?`）。
- **Node の結合（`tests/quantity.integration.test.ts` に足す）**:
  1. 4つの拾い方の拾いを作って保存し、開き直す。注釈の種類（PolyLine／Polygon）、`/IT`、頂点、`/KaruQuantity` の値（高さ・幅・深さ）、`/Contents` が戻ること。
  2. 囲む拾いの外観に塗り（`f` の演算子）と値の文字があること。
  3. 書式欄の値の変更にあたる編集（深さを変える）を保存すると、`/Contents` と `/KaruQuantity` が変わること。
- **画面（`e2e/quantity-area-volume.annotate.spec.ts`）**: 縮尺 1/100 のページで、
  1. 見本「内部足場」で 72pt 四方の四角を囲む → `2.54 × 2.54 = 6.45 m²`（表示 `6.45`）。
  2. 見本「外部足場」（高さ空欄）で 72pt の線をなぞる → 高さを聞かれ、3.5 を入れる → `2.54×H3.50=8.89 m²`。書式欄で高さを 4 にすると `10.16 m²`。`Ctrl+Z` で戻る。
  3. 見本「根切り」で 72pt 四方を囲み、深さ 1.2 → `7.74 m³`。
  4. 見本「溝掘削」で 72pt の線 → `2.54×W0.60×D0.80=1.22 m³`。
  5. 数量表 CSV に面積・体積の行と値。
  6. 保存して開き直すと、拾い・値・合計が戻る。

## 禁止事項

- SPEC-04r の禁止事項をすべて守ること。
- 第1段で作った長さの拾いと、個数カウント、計測（距離・連続した長さ・面積）の動きと保存の形を壊さないこと。
- 埋戻し・残土などの差し引きの計算、割増率は作らないこと（Excel で行う）。

## 検証項目

- [ ] `npm run build`、`npm test` が成功する。
- [ ] 新しい e2e と、第1段の `e2e/quantity-length.annotate.spec.ts`、`e2e/count-fixtures.annotate.spec.ts`、`e2e/measure.annotate.spec.ts` が成功する。サンドボックスでブラウザーが起動できないときは「未実行」と報告する。

## 報告してほしいこと

- 作成・変更したファイルと要点
- 検証の結果（実行したコマンドと件数。未実行のものはそう書く）
- SPEC から逸脱した箇所と理由、残課題
