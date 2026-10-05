# SPEC-04r: 数量拾いへの改名と、長さの拾い（第1段）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 器具リストのデータ型の拡張、新しい注釈の印（`KaruQuantity`）の保存と読込、図面の重ね描き、道具の段、左の欄、書式欄、CSV にまたがる新機能のため（判定表「新規機能の実装」）

> Codex デスクトップアプリへ貼り付けて実行する場合は、モデルセレクタを上記に合わせてから貼り付けること。

---

## 目的

利用者の要望（2026-10-05）:

> 個数カウントで現在、器具の数量のみを数えられるようになっているが、ケーブルや配管、ダクトの長さや、掘削するときの立米や足場等の面積についても数えられるようにしたい。器具リストの名称では器具の個数のみ数えるものと勘違いするので、タイトルを「数量拾い」等に変更し、「距離」や「選択」、「指摘」の並びに「数量拾い」を追加して、個数カウントの構成をそちらに移し、上記の機能を追加したい。

利用者の回答（同日）:

| 問い | 回答 |
|---|---|
| 数量拾いの一覧の場所 | **左の欄のタブ**。今の「器具」タブを「数量」タブに改名し、「数量拾い」ボタンを押すとこのタブを開く |
| 長さに加えるもの | **立上り・立下りの加算**（1本の拾いごとに m で足す）。割増率は作らない（Excel で行う） |
| 面積・体積の拾い方 | 面積: 囲む／長さ×高さ。体積: 囲む×深さ／長さ×幅×深さ（**4つとも**） |
| 今の「計測▼」（距離・連続した長さ・面積） | **残す**。寸法の確認用の単発の計測で、数量拾いの集計には入らない。「計測▼」から個数カウントだけを外す |

作業は2段に分ける。**この SPEC は第1段**で、次を行う。

1. 「器具リスト」「個数カウント」を「数量拾い」に改名し、道具の段に単独のボタン「数量拾い」を置く。
2. 一覧の項目に**種別**（個数・長さ・面積・体積）を持たせるデータ型を作る（面積・体積の入力の画面と描画は第2段の SPEC-04s）。
3. **長さ**の項目（ケーブル・配管・ダクト）を、折れ線でなぞって拾えるようにする。立上り・立下りの加算を1本ごとに入れられる。

## 現状（Claude Code が確認したこと）

- 道具の段（`src/app/ToolRow.tsx`）: ［選択］［文字▼］［図形▼］［ペン▼］［文字に印▼］［計測▼］［記号］。「計測▼」の中に「個数カウント」（道具 `count`）、距離（`distance`、キー K）、連続した長さ（`perimeter`）、面積（`area`）、縮尺の設定…がある。
- 器具リスト: 左の欄の「器具」タブ（`src/app/SidePanel.tsx` の `tabs`、`FixturePanel` を遅延読込）。器具の型は `CountFixture`（`src/core/countFixtures.ts`）。カタログの `KaruCountFixtures`（JSON。`version: 1`）に保存。読込は `ensureSessionFixtures`（`src/app/documentModel.ts`）で、器具タブ・保存・CSV などで必要になったときだけ行う。
- 個数の印: Stamp 注釈に `KaruCount`（`{version:2,id,fixtureId}`）。器具リストの読込後は重ね描き（`AnnotationLayer.tsx` の `CountMarker`）で描き、PDF の描画からは `countOverlayObjNums`（`AnnotationStore.ts:425`）で除く。除く番号は `PageView.tsx:137`、`Viewer.tsx:448`・`:478` で組み立てる。
- 計測（距離・連続した長さ・面積）: `src/core/measure.ts`、`src/editor/MeasurementOverlay.tsx`（点を足す操作、`Enter`・ダブルクリックで終える、`Backspace`・`Esc`・`Shift`）。注釈は Line/PolyLine/Polygon で `/IT` が `*Dimension`、`/Measure`、`/KaruMeasure`（`MeasureSettings` の JSON）、`/KaruMeasureFontSize` を持つ（`src/core/annotations.ts:1478-1514` の `createMeasure`・`updateMeasure`、読込は `:364-429`）。外観は `drawMeasurement`（`annotations.ts:1024`）。ページの縮尺は `/VP`（`writePageScale`）。縮尺の無いページで計測を始めると縮尺のダイアログが開く。縮尺を変えると、既存の計測を計算し直すか聞く（`AnnotationStore.ts:479` 付近）。
- 書式欄（`src/app/FormatPanel.tsx:175-183`）: 個数の印を選ぶと「器具を編集…」「器具を変更」（付け替え。`store.reassignCounts`）。
- 書き込みタブの絞り込み（`src/editor/annotationFilter.ts`）: 種類「個数カウント（器具の印）」は `!!annotation.count`、「計測」は `!!annotation.measure`。
- 数量表 CSV（`src/app/annotationCsv.ts:122` の `createCountCsv`）。

## 対象

- 対象フォルダ: `C:\Users\gibbo\Desktop\PDF編集アプリ\.claude\worktrees\quantity-pickup-expansion-ea43cf`
- 新しく作るファイル:
  - `src/core/quantity.ts` — 拾いの印の型・読み書き・値の計算・表示の文字列（純粋な関数）
  - `tests/quantity.test.ts`、`tests/quantity.integration.test.ts`
  - `e2e/quantity-length.annotate.spec.ts`
- 変更してよいファイル: `src/core/countFixtures.ts`、`src/core/annotations.ts`、`src/core/measure.ts`（必要な最小限）、`src/editor/`、`src/app/`、`src/ui/ToolIcon.tsx`、`src/App.tsx`、`src/viewer/PageView.tsx`・`src/viewer/Viewer.tsx`（除く番号の組み立てだけ）、`src/worker/`・`src/client/PdfWorkerPool.ts`（読込の情報の受け渡しに必要な最小限）、`src/styles.css`、`tests/`、`e2e/`
- 変更しないファイル: `docs/`、`public/`、`LICENSE`、設定ファイル（`package.json`・`vite.config.ts`・`playwright.config.ts`・`tsconfig.json`）、`src/organize/`、`scripts/`

## 事前確認

- 上の「現状」に挙げた箇所を読み、個数カウントと計測の今の流れ（作成・選択・移動・頂点の編集・削除・`Ctrl+Z`・コピーと貼り付け・保存・開き直し・縮尺の変更・ページの整理）を把握する。
- 計測の操作（`MeasurementOverlay.tsx`）、外観（`drawMeasurement`）、注釈の保存（`createMeasure`・`updateMeasure`）は**作り直さずに使い回す**。拾いは「計測の注釈に `KaruQuantity` を足したもの」として作る。

## 変更内容

### 1. 呼び名（画面に出る文字）

内部の識別子（道具 `count`、型 `CountFixture`、カタログのキー `KaruCountFixtures`、ファイル名 `FixturePanel.tsx` など、`data-testid`）は**変えない**。画面に出る文字だけを次のように変える。

| 今 | 新 |
|---|---|
| 左の欄のタブ「器具」 | 「数量」 |
| 見出し「器具リスト」、`aria-label="器具リスト"` | 「数量拾い」 |
| 器具（一般） | 項目 |
| 器具を追加／器具を編集（ボタン・画面の見出し・`aria-label`） | 項目を追加／項目を編集 |
| 器具名称（入力欄・一覧の見出し） | 名称 |
| 器具リストで器具を選んでください | 数量拾いの一覧で項目を選んでください |
| 選択中の器具だけ表示 | 選択中の項目だけ表示 |
| 個数をCSVに書き出す（ファイル名 `_個数.csv`） | 数量をCSVに書き出す（`_数量.csv`） |
| 選んだ器具を追加（見本・他のPDFの画面） | 選んだ項目を追加 |
| 器具リストを持つPDFがありません。 | 数量拾いの一覧を持つPDFがありません。 |
| 書式欄の「器具を編集…」「器具を変更」 | 「項目を編集…」「項目を変更」 |
| 書式欄・道具名の「個数カウント」 | 「数量拾い」 |
| 書き込みタブの種類「個数カウント（器具の印）」 | 「数量拾い」 |
| 状態の文・警告・確認の文の「器具」「器具の印」 | 「項目」「数量拾いの印」 |
| 「器具リストを開いています…」「器具と個数を読み込んでいます…」 | 「数量拾いを開いています…」「数量拾いを読み込んでいます…」 |

- `src/app/HelpDialog.tsx` の個数カウントの説明を「数量拾い」の説明に書き直す（個数・長さの拾い方、立上り・立下りの加算、表示の切替、数量表 CSV。面積・体積は第2段で足すので、ここでは書かない）。
- 図面の記号を切り取った「見本」は、個数の項目だけの機能のまま。呼び名「見本」も変えない。
- 文字を `grep` で探し、`器具` が画面に残らないようにする。ただし、見本の項目の名称（「照明器具」の分類、「衛生器具」など）と、コード中のコメントは変えなくてよい。

### 2. 道具の段

- 「計測▼」の中から「個数カウント」を外す（距離・連続した長さ・面積・縮尺の設定… は残す）。`DEFAULT_LAST_TOOLS.measure` は `distance` のまま。保存済みの `karu-pdf:last-tools` に `measure: 'count'` が残っていても、今の `loadLastTools` の仕組みで `distance` に戻ることを確かめる。
- ［計測▼］と［記号］の間に、単独のボタン「数量拾い」を置く（分割ボタンにしない）。道具は今の `count` を使う。
  - 並び: ［選択］［文字▼］［図形▼］［ペン▼］［文字に印▼］［計測▼］［数量拾い］［記号］
  - `title`: `数量拾い: 一覧で選んだ項目の個数・長さ・面積・体積を拾う（Q）`
  - アイコン: `ToolIcon.tsx` に、今の `count` の絵を「物差しと正の字（集計）」を合わせた絵に替える（16×16、線だけ。他のアイコンと同じ太さ）。
  - キー `Q` で `changeTool('count')`（今 `q` が使われていないことを確かめる）。
  - 押したときの動き（読込、`prepareCountTool`、「数量」タブを開く）は、今の `count` を選んだときと同じ。

### 3. 項目の種別（データ型）

`src/core/countFixtures.ts` の `CountFixture` に、省略可能な欄を足す。**欄が無い項目は今までどおりの個数の項目**として扱う（既存の PDF との互換）。

```ts
export type QuantityKind = 'count' | 'length' | 'area' | 'volume'
export type QuantityMethod =
  | 'click'             // 個数: クリックで数える
  | 'polyline'          // 長さ: 折れ線の長さ ＋ 加算
  | 'polygon'           // 面積: 囲んだ面積（第2段）
  | 'lengthHeight'      // 面積: 折れ線の長さ × 高さ（第2段）
  | 'polygonDepth'      // 体積: 囲んだ面積 × 深さ（第2段）
  | 'lengthWidthDepth'  // 体積: 折れ線の長さ × 幅 × 深さ（第2段）
export const QUANTITY_METHODS: Record<QuantityKind, readonly QuantityMethod[]> = {
  count: ['click'], length: ['polyline'], area: ['polygon', 'lengthHeight'], volume: ['polygonDepth', 'lengthWidthDepth'],
}
export const QUANTITY_UNITS: Record<QuantityKind, string> = { count: '個', length: 'm', area: 'm²', volume: 'm³' }
export const QUANTITY_LINE_WIDTHS = [0.5, 1, 1.5, 2, 3, 4] as const
export const QUANTITY_DASHES = ['solid', 'dashed', 'dashDot', 'dotted'] as const
export interface QuantityDefaults { addM?: number; heightM?: number; widthM?: number; depthM?: number }
export interface QuantityLineStyle { width: typeof QUANTITY_LINE_WIDTHS[number]; dash: typeof QUANTITY_DASHES[number] }

export interface CountFixture {
  // 今の欄はそのまま
  kind?: QuantityKind          // 省略 = 'count'
  method?: QuantityMethod      // 省略 = その kind の先頭
  defaults?: QuantityDefaults  // 新しく引く拾いに入れる値（m）
  line?: QuantityLineStyle     // 長さ・面積・体積の線（省略 = { width: 1.5, dash: 'solid' }）
}
export function quantityKind(f: CountFixture): QuantityKind      // 省略なら 'count'
export function quantityMethod(f: CountFixture): QuantityMethod  // 省略なら kind の先頭
```

- `parseCountFixtures`: 新しい欄を検査して読む。`kind` と `method` の組が `QUANTITY_METHODS` に合わないもの、`defaults` の値が 0 以上 1,000 以下の有限の数でないもの、`line` の値が上の一覧に無いものは、**その欄を捨てずに項目ごと捨てる**（今の検査と同じ方針）。`version` は 1 のまま（欄の追加だけなので、古い版のかるPDFでも読める。古い版で保存し直すと新しい欄は消えるが、それは許容する）。
- `serializeCountFixtures`: 新しい欄も書く。`kind: 'count'` で他の欄が無い項目は、今と同じ JSON になるようにする（欄を書かない）。
- `style`（形・塗り・色・大きさ・透明度・略号の表示）は全種別で持つ。長さ等では `style.color`（線の色）、`style.opacity`（線の透明度）、`style.size`（図面の値の文字の大きさ。pt）、`style.showCode`（値の前に略号を出す）を使い、`shape`・`fill` は使わない（値は残す）。
- 見た目の重なりの判定（`FixtureDialog` の「同じ見た目の項目があります」）: 個数どうしは今のまま。長さ以上どうしは「種別・色・線の種類・線の太さ」が同じとき。種別が違うものどうしは比べない。
- 新しい長さの項目の色: `nextCountStyle(fixtures)` の色を使い、線は `{ width: 1.5, dash: 'solid' }`。

### 4. 拾いの印（注釈）

`src/core/quantity.ts` に作る。

```ts
export interface QuantityMark { version: 1; id: string; itemId: string; method: Exclude<QuantityMethod, 'click'>; addM?: number; heightM?: number; widthM?: number; depthM?: number }
export function parseQuantityMark(raw: string | null): QuantityMark | null   // 400文字まで。値は 0〜1,000 の有限の数。id・itemId は 1〜80 文字
export function quantityPoints(method): 'polyline' | 'polygon'               // polyline・lengthHeight・lengthWidthDepth → 'polyline'、polygon・polygonDepth → 'polygon'
export function quantityValue(points: readonly Point[], mmPerPoint: number, mark: QuantityMark): number   // 項目の単位（m・m²・m³）の値。丸めない
export function quantityLabel(points, mmPerPoint, mark, code: string, showCode: boolean): string           // 図面と /Contents に出す文字列
```

- 値の計算（`planM` = 折れ線の長さ × `mmPerPoint` ÷ 1000、`areaM2` = 多角形の面積 × `mmPerPoint`² ÷ 10⁶。今の `polylineLength`・`polygonArea` を使う）:

| method | 値 | 単位 |
|---|---|---|
| polyline | `planM + (addM ?? 0)` | m |
| polygon | `areaM2` | m² |
| lengthHeight | `planM × heightM` | m² |
| polygonDepth | `areaM2 × depthM` | m³ |
| lengthWidthDepth | `planM × widthM × depthM` | m³ |

- 表示の文字列（数字は `ja-JP` の書式、**小数2桁固定**、3桁ごとのカンマ。略号は `showCode` のときだけ前に付け、半角空白で区切る）:

| method | 例 |
|---|---|
| polyline（加算 0） | `CV 12.35 m` |
| polyline（加算あり） | `CV 9.35+3.00=12.35 m` |
| polygon | `内部足場 48.00 m²` |
| lengthHeight | `外部足場 24.00×H3.50=84.00 m²` |
| polygonDepth | `根切り 12.00×D1.20=14.40 m³` |
| lengthWidthDepth | `溝掘削 10.00×W0.60×D0.80=4.80 m³` |

  第1段では polyline だけを画面から作れるが、`quantityValue`・`quantityLabel` と単体試験は6種類すべてを作る。

- PDF への保存: 拾いは**計測の注釈**（`createMeasure`・`updateMeasure`）として作る。`quantityPoints` が `'polyline'` なら PolyLine（`/IT /PolyLineDimension`）、`'polygon'` なら Polygon（`/IT /PolygonDimension`）。`MeasureSettings.kind` はそれぞれ `perimeter`・`area`。これに加えて:
  - `/KaruQuantity`: `QuantityMark` の JSON
  - `/Contents`: `quantityLabel` の文字列
  - `/KaruQuantityDash`: 線の種類（`solid` 以外のときだけ）。外観の線を破線にするのに使う（下の6.）
  - 他のソフトや古いかるPDFでは、ふつうの計測（連続した長さ・面積）として見える。
- `EditableAnnotation`（`AnnotationStore.ts`）と読込の情報（`annotations.ts` の読込、Worker からの受け渡し）に `quantity?: QuantityMark | null` を足す。`/KaruQuantity` が読めない（壊れている）ときは `null` にして、ふつうの計測として扱う。
- 拾いの注釈の `text` は、計測の `measureText` ではなく `quantityLabel` で作る。頂点を動かしたとき（`AnnotationStore.ts:493` 付近）、縮尺の計算し直し（`:479` 付近）、開き直し（`annotations.ts:426` 付近）、項目の略号・`showCode` を変えたとき、のすべてで `quantityLabel` を使う。境界（`rect`）は今の `measureBounds` を、`kind` に `perimeter`・`area` を渡して使う。

### 5. 拾う操作（道具 `count` で、選んだ項目が長さのとき）

- 一覧で選んだ項目（`store.selectedFixtureId`）の `quantityMethod` で操作を分ける。
  - `click`: 今の個数カウントのまま。
  - `polyline`: 今の「連続した長さ」と**同じ操作**（クリックで点を足す、ダブルクリックか `Enter` で終える、`Backspace` で最後の点を消す、`Esc` でやめる、`Shift` で水平・垂直・45°）。`MeasurementOverlay.tsx` の仕組みに「拾いの項目」を渡せるようにして使い回す。
  - 第2段の method が選ばれたとき（第1段の時点では作れないので起きないはずだが、他のPDFから読み込んだ場合など）: 状態の文に「この種別の拾いは、まだ使えません」と出して何もしない。
- 縮尺の無いページで長さを拾い始めたら、今の計測と同じく縮尺のダイアログを開く。決めたら、そのまま拾える。
- なぞっている間、カーソルのそばに今の値を出す（`quantityLabel` で、項目の `defaults` を使う）。計算は画面側だけ。マウスの動きごとに React の state を更新しない（今の計測と同じ決まり）。
- 終えたら、項目の `defaults.addM`（無ければ 0。0 のときは `addM` を書かない）を入れた拾いの注釈を作り、選んだ状態にする。道具は `count` のまま（続けて拾える）。`Esc` で選択に戻る。
- 線の見た目: 項目の色・透明度・`line.width`・`line.dash`。値の文字は項目の `style.size`。今の計測の書式欄の色・太さ・文字の大きさは、拾いには使わない（項目で決める）。
- 項目が非表示（目のボタン）のときに拾い始めたら、今の個数カウントの `prepareCountTool` と同じく、その項目を表示に戻す。

### 6. 図面での表示

- 個数の印と同じく、**数量拾いの読込後は、拾いの注釈を重ね描きで描き、PDF の描画からは除く**。
  - `AnnotationStore.countOverlayObjNums(pageIndex)` が、拾いの注釈（`quantity` があり、項目が一覧にあるもの）の番号も返すようにする（関数名は変えない）。`PageView.tsx`・`Viewer.tsx` の組み立ては変えずに済むはず。
  - 重ね描き: 今の `MeasurementShape`（`MeasurementOverlay.tsx`）で描き、線の種類（破線など）と、値の文字の前の略号に対応させる。破線の間隔は線の太さに比例させる（例: 破線 `6w 3w`、一点鎖線 `8w 2w 1.5w 2w`、点線 `1w 2w`。`w` は線の太さで、最小 1）。
- 表示の切替（目のボタン、分類ごと、「選択中の項目だけ表示」「すべて表示」）と、書き込みタブの「図面にもこの種類だけ表示」（SPEC-04q）は、拾いの注釈にも個数の印と同じく効くようにする（`isCountVisible`・`isShownOnDrawing` が拾いも見る）。
- 保存した PDF の外観: 今の `drawMeasurement` を使う。`/KaruQuantityDash` があれば線を破線にする（MuPDF の `strokePath` の `StrokeState` に `dashes` を渡す）。文字は `/Contents` の文字列。
- 数量拾いを読み込む前（通常の閲覧）は、何も新しく動かさない。拾いの注釈は PDF の外観のまま描かれる。

### 7. 選んだ拾いの編集（書式欄）

拾いの注釈を1つ選んだとき、書式欄（`FormatPanel.tsx`）に次を出す（今の個数の印の欄と同じ並び）。

```
数量拾い
 [線の見本] CV ケーブル（CV）        [項目を編集…]
 項目を変更 [CV ケーブル（CV） ▼]    ← 同じ method の項目だけ
 平面の長さ  9.35 m                  （表示のみ）
 立上り・立下りの加算 [ 3.00 ] m     ← polyline のとき
 この拾い    12.35 m                 （表示のみ）
```

- 加算の欄: 0〜1,000 の数、小数2桁まで。入力を確定したとき（`blur`・`Enter`）に `store` へ反映し、文字列・合計を計算し直す。`Ctrl+Z` で戻せる。
- 「項目を変更」: 選んでいる拾いを別の項目へ付け替える（今の `reassignCounts` と同じ考え方。複数選んでいるときは、同じ method の拾いだけを付け替える）。
- 個数の印と拾いを混ぜて選んだときは、今の複数選択の書式欄のまま（拾いの欄は出さない）。
- 移動（ドラッグ・方向キー）、頂点のつかみ、コピーと貼り付け、削除、`Ctrl+Z` は、今の計測と同じ。貼り付けた拾いは新しい `id`、同じ `itemId`・値。

### 8. 数量の集計と一覧

- `AnnotationStore.countTotals()` を、拾いの値も足すように広げる（戻り値の形 `Map<項目id, Map<ページ, 数>>` は同じ。個数は個数、長さは m の合計）。丸めは表示のときだけ。
- 一覧（`FixturePanel.tsx`）:
  - 各行の「この図面」「全図面」: 個数は今のまま整数。長さは小数2桁（例 `12.35`）。`title` に単位付き（`表示中の図面: 12.35 m`）。
  - 行の「印」の欄: 長さの項目は、項目の色・線の種類の短い線（`<svg>` で 24×24 の中に横線）を描く。
  - 「見本」の欄: 長さの項目は空。
  - 上の要約: `表示中の図面（p.23）: 12.35 m ／ 全図面: 120.50 m`（個数は今どおり「個」）。
  - 見出し行に「単位」の列は足さない（幅が足りない）。代わりに、項目の名前の後ろに単位を小さく添える（`<span class="fixture-row-unit">m</span>`。個数の項目には付けない）。
- 項目の削除: 今の「この器具の印 N 個も削除します」を、`この項目の拾い N 件も削除します。よろしいですか？` にする（N は個数の印と拾いの注釈の件数の合計）。

### 9. 項目を追加・編集する画面（`FixtureDialog.tsx`）

- 名称の上に「種別」を置く: `個数` `長さ` の2つのラジオボタン（第2段で `面積` `体積` を足す）。
  - **その項目の印・拾いが図面に1つでもあるとき**は、種別を変えられないようにし（`disabled`）、「拾いがあるため種別は変えられません」と添える。
- 種別が「長さ」のとき:
  - 形・塗り・大きさ・見本（図面から切り取る）の欄を隠す。
  - 「線の種類」（実線・破線・一点鎖線・点線。見本の線を描いたボタン）と「線の太さ」（`QUANTITY_LINE_WIDTHS`、pt）を出す。
  - 「色」「任意の色」「透明度」「略号を図面に表示」は今の欄を使う。「文字の大きさ」は `COUNT_SIZES` から選ぶ（`style.size`）。
  - 「立上り・立下りの加算（新しく拾うときの初期値）」[ 0.00 ] m。
  - プレビュー: 線の見本と、`CV 9.35+3.00=12.35 m` のような値の見本。
- 種別を「個数」から「長さ」に切り替えたとき、線は `{ width: 1.5, dash: 'solid' }`、`defaults` は `{}` で始める。「長さ」から「個数」に戻したら、`line`・`defaults` は保存しない。

### 10. 見本から追加（`FIXTURE_PRESETS`）

- 見本の型に `kind?`・`method?`・`defaults?` を足し、`FixturePresetDialog` の `addMany`（`FixturePanel.tsx`）がそれを項目へ写すようにする。長さの見本には `line: { width: 1.5, dash: 'solid' }` を付ける。
- 見本の一覧で、個数以外の項目は名前の後ろに `（長さ・m）` のように種別と単位を添える。
- 電気設備に足す（`kind: 'length'`）:
  - 電線・ケーブル: `CV ケーブル（CV）`、`CVT ケーブル（CVT）`、`EM-CE ケーブル（EM-CE）`、`EM-EEF ケーブル（EM-EEF）`、`VVF ケーブル（VVF）`、`IV 電線（IV）`
  - 電線管: `E 薄鋼電線管（E）`、`G 厚鋼電線管（G）`、`PF 合成樹脂製可とう電線管（PF）`、`CD 合成樹脂製可とう電線管（CD）`、`VE 硬質ビニル電線管（VE）`、`FEP 波付硬質合成樹脂管（FEP）`
  - ケーブルラック: `CR ケーブルラック`
- 機械設備に足す（`kind: 'length'`）:
  - ダクト: `SD 角ダクト`、`RD 丸ダクト（スパイラル）`
  - 配管: `SGP 配管用炭素鋼鋼管`、`VP 硬質ポリ塩化ビニル管`、`RP 冷媒管`、`DP ドレン管`
- 今の個数の見本は変えない。見本を書く形は、今の `'略号 名称'` の文字列の並びに倣い、種別を持つ分類を区別できるようにする（書き方は任せる）。

### 11. CSV

- 数量表（`createCountCsv`）:
  - 見出し: `分類, 略号, 名称, 種別, 単位, 表示中の図面（p.N）, 全図面の合計, p.1, p.2, …`
  - 種別は `個数`・`長さ`（第2段で `面積`・`体積`）。単位は `QUANTITY_UNITS`。
  - 値: 個数は整数。長さ以上は小数2桁（`12.35`。カンマ区切りにしない）。
  - BOM・CRLF・数式化の抑止（`quote`）は今のまま。
- 書き込みの CSV（`createCsv`）: 種類「数量拾い」に拾いの注釈も入れる（本文は `quantityLabel` の文字列、`縮尺` の列も今の計測と同じく入れる）。種類「計測」には拾いの注釈を**入れない**。

### 12. 書き込みタブ

- 絞り込み「数量拾い」（今の `count`）は `!!annotation.count || !!annotation.quantity`。「計測」は `!!annotation.measure && !annotation.quantity`。`filterShowsCountMarks` は今の判定のままで、拾いの注釈にも同じ答えになることを試験で確かめる。
- 一覧の種類の名前: 拾いは `数量拾い（長さ）`（第2段で面積・体積）。本文は `quantityLabel` の文字列。

## 動作の軽さ（最重要）

- 通常の読込に何も足さない。`/KaruQuantity` の読み取りは、今の `/KaruCount`・`/KaruMeasure` と同じく、ページの注釈を読むときの文字列1つの読み取りだけにする。
- 数量拾いの一覧（カタログの JSON）は、今と同じく数量タブ・数量拾いの道具・保存・CSV で必要になったときだけ読む。
- なぞっている間は画面側の計算と SVG の書き換えだけ。Worker に問い合わせない。

## テスト

- **単体（`tests/quantity.test.ts`）**:
  - `quantityValue`: 縮尺 1/100（`mmPerPoint` = 25.4/72×100）で 72pt の折れ線 → 2.54 m、加算 3 → 5.54 m。6つの method すべての値（四角・L 字の多角形を含む）。
  - `quantityLabel`: 上の表の6つの例の形（加算 0 のとき `+` を出さない、`showCode: false` で略号なし、3桁カンマ）。
  - `parseQuantityMark`: 正しいもの、壊れた JSON、範囲外の値、長すぎる id、知らない method を捨てる。
- **単体（`tests/countFixtures.test.ts` に追加）**: `kind`・`method`・`defaults`・`line` の読み書きが往復すること。欄の無い項目の JSON が今と同じになること。組の合わない `kind`/`method`、範囲外の `defaults`、知らない `dash` の項目を捨てること。見本の長さの項目が追加されること。
- **単体（`tests/annotationCsv.test.ts`・`tests/annotationFilter.test.ts` に追加）**: 数量表の見出しと、個数・長さが混じったときの値。絞り込み「数量拾い」「計測」での拾いの扱い。
- **Node の結合（`tests/quantity.integration.test.ts`）**:
  1. 長さの項目を持つ一覧と、拾いの注釈（加算あり・なし、破線）を作って保存し、開き直す。`/IT /PolyLineDimension`、頂点、`/Measure`、`/KaruMeasure`、`/KaruQuantity`、`/Contents`（`CV 9.35+3.00=12.35 m` の形）、項目の `kind`・`line`・`defaults` が戻ること。
  2. 外観に値の文字があること（`toStructuredText` で文字列が読める）。破線の項目の外観の内容ストリームに `d`（破線）の演算子があること。
  3. 頂点を動かす・加算を変える編集を保存すると、`/Contents` と `/KaruQuantity` が新しい値になること。
  4. ページの整理（並べ替え）で、一覧と拾いの注釈が残ること（今の `preserveCatalog` の試験に倣う）。
- **画面（`e2e/quantity-length.annotate.spec.ts`）**:
  1. 道具の段に「数量拾い」があり、「計測▼」の中に個数カウントが無いこと。左の欄のタブが「数量」、見出しが「数量拾い」であること。
  2. 見本から「CV ケーブル（CV）」を追加して選び、縮尺 1/100 を決め、ページ座標で 72pt 離れた2点をクリックして `Enter` → 一覧の CV の「この図面」が `2.54`、図面の値が `CV 2.54 m`。
  3. 書式欄で加算に 3 を入れる → `CV 2.54+3.00=5.54 m`、一覧が `5.54`。`Ctrl+Z` で `2.54` に戻る。
  4. 頂点を動かすと値が変わる。
  5. 目のボタンで CV を隠すと拾いの線が消え、出すと戻る。
  6. 数量表 CSV に `電線・ケーブル,CV,ケーブル（CV）,長さ,m,` の行があり、値が合う。
  7. 保存して開き直すと、拾い・値・一覧の合計が戻る。
  8. キー `Q` で数量拾いの道具になる。
- 既存の `e2e/count-fixtures.annotate.spec.ts` などで、画面の文字（「器具」→「項目」など）や「計測▼ → 個数カウント」の操作に依っている箇所を、新しい文字・新しいボタンに合わせて直す。**試験の意図（確かめていること）は変えない。**

## 禁止事項

- 対象外のファイルを変更しないこと。git の変更操作（commit・add・reset・checkout・stash など）をしないこと。
- 内部の識別子（道具 `count`、`CountFixture`、`KaruCountFixtures`、`KaruCount`、ファイル名、`data-testid`）を改名しないこと。
- 計測の操作・外観・保存を別に作り直さないこと（使い回す）。今の距離・連続した長さ・面積の動きと保存の形を変えないこと。
- 個数カウントの今の動き（印の形・塗り・色、二重計数の警告、見本の切り取り、付け替え、表示の切替、1,000個を超えたときの略号の省略）を壊さないこと。
- 割増率、図面の線への吸い付き（スナップ）、自動の拾い（記号や線の自動検索）を作らないこと。
- 通常の読込に、全ページの注釈の走査や一覧の読込を足さないこと。
- マウスの動きごとに React の state を更新しないこと。
- python・pytest は使わない。自分で起動したサーバーは必ず止め、一時ファイルは削除すること。

## 検証項目

- [ ] `npm run build` が成功する。
- [ ] `npm test` が成功する（新しい単体・結合を含む）。
- [ ] 新しい e2e と、文字を直した既存の e2e（`count-fixtures`・`drawing-filter`・`measure`・`menu`・`sidebar` など、変更が及ぶもの）が成功する。サンドボックスでブラウザーが起動できないときは、実行せずに「未実行」と報告する（Claude Code 側で実行する）。
- [ ] 画面に「器具」の文字が残っていない（見本の項目名・分類名を除く）ことを `grep` で確かめ、残したものを報告する。

## 報告してほしいこと

- 作成・変更したファイルと要点
- 拾いの注釈の保存の形（実際に書いたキーと値の例）
- 計測の操作・外観をどう使い回したか（足した引数など）
- 検証の結果（実行したコマンドと件数。未実行のものはそう書く）
- SPEC から逸脱した箇所と理由、残課題
