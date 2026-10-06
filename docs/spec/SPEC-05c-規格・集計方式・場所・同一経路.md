# SPEC-05c: 規格、集計方式、拾いの場所（階・部屋）、同一経路の複数項目、集計の索引

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 項目と拾いの保存の形の拡張（後方互換を保つ）、集計の作り直し、画面の入力にまたがる新機能のため（判定表「新規機能の実装」）

> Codex デスクトップアプリへ貼り付けて実行する場合は、モデルセレクタを上記に合わせてから貼り付けること。

---

## 目的

利用者の改修指示書（2026-10-06）の 5〜13 と、追加の要望・回答:

- 同じ項目を、拾いごとに**階・部屋**の違う場所で数えられる（場所は項目でなく**拾いの側**に持たせる）。入力の手間を増やさない（「現在の階・部屋」を一度決めれば、以後の拾いに付く。拾ったものをまとめて変更できる）。
- **集計方式**を項目に持たせる（名前で判定しない）: 器具・機器は**場所別**、ケーブル・電線管・ラック・配管・ダクト・土工・その他の長さ・面積・体積は**全図面**。どの項目も全図面の合計は見られる。
- **規格**（`3C-5.5sq`・`300W`・`25A`・`500×300` など）を項目に持たせ、規格違いを別の項目として集計する。基本の種類を見本として持ち、「複製 → 規格を入れる」で案件の項目を簡単に作れる。
- 追加の要望: **同じ経路を複数のケーブル・配管が通る**ことを反映する。利用者の回答: **1つの経路に複数の項目と条数**を付ける（例「CV 38sq-3C ×2条、EM-CE 5.5sq-3C ×1条、PF28 ×1」）。各項目の数量は「経路の長さ × 条数」。経路を動かすと、全部の項目の数量が変わる。
- **階の初期値**（利用者の回答）: 図面名称（SPEC-05b）に「1階」「B1階」「RF」などがあれば、そのページの拾いの階に自動で入れる。数量タブで「現在の階」を決めているときは、そちらを優先する。部屋は「現在の部屋」で入れる。

「全図面」の内訳の画面・ページへの移動・CSV は SPEC-05d、線状数量の「別の組合せを提案」は SPEC-05e で行う。この SPEC では、データと集計の索引と、入力の画面を作る。

## 現状（Claude Code が確認したこと）

- 項目: `CountFixture`（`src/core/countFixtures.ts`）。`category`・`code`・`name`・`memo`・`kind`・`method`・`defaults`・`line`・`style`・`sample`。カタログの `KaruCountFixtures`（`version: 1`）に保存。
- 個数の印: `CountMark`（`src/core/counts.ts`。`{version:2,id,fixtureId}`）を Stamp の `/KaruCount` に。`parseCount` は 400 文字まで。
- 長さ・面積・体積の拾い: `QuantityMark`（`src/core/quantity.ts`。`{version:1,id,itemId,method,addM?,heightM?,widthM?,depthM?}`）を計測の注釈の `/KaruQuantity` に。`parseQuantityMark` は 400 文字まで。
- 集計: `AnnotationStore.countTotals()`（`AnnotationStore.ts:420`）が、呼ばれるたびに全注釈を回って `Map<項目id, Map<ページ, 数>>` を作る。`FixturePanel` が `version` ごとに呼ぶ。
- 拾いの作成: 個数は `AnnotationLayer.tsx:657` 付近、長さ等は `MeasurementOverlay.tsx:142` 付近。
- 数量タブの読込で全ページの注釈を読む（`ensureCountFixtures` の `loadPages`）。

## 対象

- 対象フォルダ: `C:\Users\gibbo\Desktop\PDF編集アプリ\.claude\worktrees\quantity-pickup-expansion-ea43cf`
- 新しく作るファイル: `src/core/quantityIndex.ts`（集計の索引。純粋な関数かクラス）、`src/core/location.ts`（階の正規化と、図面名称からの階の読み取り）、`tests/quantityIndex.test.ts`、`tests/location.test.ts`、`e2e/quantity-location-route.annotate.spec.ts`
- 変更してよいファイル: `src/core/countFixtures.ts`、`src/core/counts.ts`、`src/core/quantity.ts`、`src/core/annotations.ts`（読み書きの検査の上限など、必要な最小限）、`src/editor/`、`src/app/`、`src/App.tsx`、`src/styles.css`、`tests/`、`e2e/`
- 変更しないファイル: `docs/`、`public/`、設定ファイル、`.env.*`、`scripts/`、`src/worker/`（受け渡しに必要な最小限は可）

## 変更内容

### 1. 項目（`CountFixture`）に足す欄

```ts
spec?: string                              // 規格。0〜40 文字。空なら書かない
aggregation?: 'location' | 'document'      // 集計方式。省略時: kind が count なら 'location'、それ以外は 'document'
export function quantityAggregation(f: CountFixture): 'location' | 'document'
```

- `parseCountFixtures`・`serializeCountFixtures` に足す（欄が無い既存の項目は今と同じに読める。値が不正な項目は、今の方針どおり項目ごと捨てる）。
- 項目の同一の判定（見本・他の PDF から足すときの重複の判定 `name`・`code`）に `spec` も入れる。
- **表示名**: `code` と `spec` を半角空白でつないだもの（例 `EM-CE 3C-5.5sq`）を、図面の値の文字の略号の部分、拾いの一覧の行、書式欄、「項目を変更」の選択肢に使う。`spec` が空なら今と同じ。
- 数量タブの一覧の行: 名称の列に「名称」と、その後ろに小さく規格（`<span class="fixture-row-spec">`）。検索の対象に規格を足す。
- 項目の画面（`FixtureDialog.tsx`）: 略号の下に「規格」の欄。「集計方式」のラジオボタン（`場所別（階・部屋ごと）`・`全図面の合計`）。
  - 新しい項目の集計方式の初期値は、種別から（個数→場所別、それ以外→全図面）。種別を変えたとき、利用者が集計方式を触っていなければ、それに合わせて変える。
  - 「複製」で開いたときは、規格の欄にカーソルを置き、規格を選んだ状態にする（すぐ打ち替えられる）。名前の「のコピー」は、規格があるときは付けない（規格を変えれば別の項目になるため）。
- 見本（`FIXTURE_PRESETS`）: 各見本に集計方式を明示する（個数の見本→場所別、長さ・面積・体積の見本→全図面）。規格は空のまま（全部の大きさは見本にしない）。

### 2. 拾いの場所（階・部屋）

- `CountMark`（version 2）と `QuantityMark` に省略可能な `floor?: string`・`room?: string`（各 0〜40 文字。空なら書かない）を足す。読み書きの検査を合わせる。保存の形の `version` は変えない（欄を足すだけ。古い版は欄を無視して読める）。
- `src/core/location.ts`:
  - `normalizeFloor(text)`: `１Ｆ`・`1F`・`1階`・`１階` → `1階`、`B1F`・`地下1階`・`B1階` → `B1階`、`RF`・`R階`・`屋上`・`屋階` → `RF`、`PH1`・`PH1階` → `PH1階`、`M2F`・`中2階` → `M2階`。それ以外はそのまま（前後の空白を除く）。
  - `floorFromDrawingName(name)`: 図面名称から階を1つ読む。2つ以上の階が書かれている（「1・2階平面図」「1～3階」）ときは読まない（推測しない）。読めなければ `undefined`。
- **現在の階・部屋**（数量タブ）: 一覧の上の方に2つの入力欄を置く。

```
現在の場所  階 [        ]（図面名から: 1階）   部屋 [        ]
```

  - 文書ごとに覚える（PDF には保存しない。`hiddenFixtures` と同じ扱いで、ページの整理の後も保つ）。
  - 入力欄の候補（`datalist`）に、その文書の拾いに既にある階・部屋を出す（入力欄は空から始まるので、候補が全部出る）。階は入力を確定したときに `normalizeFloor` で整える。
  - 「階」が空のときは、拾う**ページの図面名称**から `floorFromDrawingName` で読んだ階を使う。今のページで読めた階を、入力欄の横に薄く「（図面名から: 1階）」と出す。
  - 新しく拾う印・拾い（個数・長さ・面積・体積）には、作るときに「現在の階（空なら図面名から）」「現在の部屋」を入れる。どちらも無ければ欄を書かない。
- **後から変更**: 書式欄（`FormatPanel.tsx`）で、選んでいる印・拾い（1つでも複数でも。個数と長さなどが混じっていてもよい）に、「階」「部屋」の入力欄を出す。複数選んで値が揃っていないときは、入力欄を空にして「（いろいろ）」と薄く出す。確定すると、選んでいる全部に入れる（1回の `Ctrl+Z` で戻る）。空にして確定すると、その欄を消す。
- 階・部屋は、印・拾いの見た目（図面の文字）には出さない。

### 3. 同一経路の複数項目と条数（長さの拾いだけ）

- `QuantityMark` に足す:

```ts
count?: number                                    // 主の項目（itemId）の条数。1〜99 の整数。省略時 1
extra?: Array<{ itemId: string; count: number }>  // 同じ経路を通る他の項目。0〜10 件。各 count は 1〜99
```

  - `method` が `polyline` のときだけ使える（ほかの method で `count`・`extra` があれば、その欄を捨てて読む）。`extra` の項目は種別が長さ（`polyline`）の項目に限る。同じ項目を2回入れない（主の項目と同じものも不可）。
  - 古い版のかるPDFは `itemId` だけを読むので、主の項目を1条として数える（許容する）。
  - `/KaruQuantity` の文字数の上限を 2,000 に上げる（`parseQuantityMark`）。
- **数量**: 経路の長さ `L = 平面の長さ + 加算` として、主の項目に `L × count`、`extra` の各項目に `L × その count` を数える。
- **図面の文字**（`quantityLabel`）: 項目が1つで1条なら今のまま（`CV 12.35 m`）。それ以外は、項目と条数を並べてから経路の長さ:
  - `CV 38sq-3C×2, EM-CE 5.5sq-3C, PF28  12.35 m`（1条の項目は `×1` を付けない）
  - 加算があるとき: `CV 38sq-3C×2, PF28  9.35+3.00=12.35 m`
  - `/Contents` も同じ文字にする（他のソフトでも読めるように）。
  - 「図面に長さ・面積・体積の数値を表示」をオフにしたときは、今と同じく文字を出さない。
- **書式欄**（長さの拾いを1つ選んだとき）に「この経路の項目」の表を出す:

```
この経路の項目
 [線] CV 38sq-3C 幹線ケーブル   [ 2 ]条   12.35×2 = 24.70 m
 [線] EM-CE 5.5sq-3C             [ 1 ]条   12.35 m           [外す]
 [長さの項目を選ぶ ▼] [この経路に足す]
```

  - 先頭の行が主の項目（「項目を変更」で替えられる。外せない）。条数は 1〜99 の整数。
  - 「この経路に足す」の選択肢は、種別が長さの項目のうち、この経路にまだ無いもの。
  - 変更はすべて `Ctrl+Z` で戻せる。
- **表示の切替**: 経路は、主の項目か `extra` のどれかが表示中なら図面に出す（線の色・線種は主の項目のもの）。「選択中の項目だけ表示」では、選んだ項目を含む経路を出す。
- **項目の削除**: 削除する項目が、ある経路の `extra` にだけあるときは、その経路から外すだけ（経路は消さない）。主の項目のときは、`extra` があれば先頭の `extra` を主に繰り上げ（条数も引き継ぐ）、無ければ今と同じく経路を消す。削除の確認の文の件数は、消える経路と、外れる経路を分けて出す（例「この項目の拾い 3 件を削除し、2 件の経路から外します」）。
- **項目の付け替え**（`reassignCounts`）: 主の項目を替えるときに、替え先が同じ経路の `extra` にあれば、その `extra` を外して条数を足し合わせる。

### 4. 集計の索引（`src/core/quantityIndex.ts`）

`countTotals()` を、次の索引で置き換える（`countTotals()` は互換のため索引から作って返す形で残してよい）。

```ts
export interface QuantityEntry {
  itemId: string
  annotationId: string
  pageIndex: number
  floor?: string
  room?: string
  value: number        // 項目の単位（個・m・m²・m³）。経路の extra もそれぞれ1件の entry にする
  routeCount?: number  // 経路の条数（長さのとき）
}
export class QuantityIndex {
  static build(annotations, fixtures): QuantityIndex
  entries(itemId: string): readonly QuantityEntry[]
  total(itemId: string): number
  byPage(itemId: string): Map<number, number>            // ページの番号の順
  byFloor(itemId: string): Map<string, number>          // 階が無いものは '' に入れる
  byRoom(itemId: string): Map<string, number>
  byFloorRoom(itemId: string): Map<string, Map<string, number>>
  pagesOf(itemId: string): number[]                      // 数量のあるページ
}
```

- `AnnotationStore` が索引を持ち、**注釈・項目・縮尺が変わったときだけ**作り直す（`version` を見て、変わっていなければ前の索引を返す）。画面の再描画のたびに作らない。
- 数量タブ（`FixturePanel.tsx`）の「この図面」「全図面」は、この索引から出す。
- 集計方式（`aggregation`）は、索引の作り方を変えない（どの項目も全部の見方ができる）。SPEC-05d の内訳の画面で、どの見方を先に出すかに使う。
- ページを削除すると、そのページの注釈が消えるので、索引からも消える（作り直しで反映される）。並べ替えでは、数量は変わらず、ページの番号だけが変わる。

## 動作の軽さ（必須）

- 通常の読込・表示に何も足さない。索引は、数量タブ・数量拾いの道具・書式欄で必要になったときに作り、変わったときだけ作り直す。
- 1,000 項目・注釈 10,000 件で、索引の作り直しにかかる時間を単体試験の中で測り、報告する（目安 20ms 以下）。

## テスト

- **単体**
  - `tests/location.test.ts`: `normalizeFloor` の表記の揺れ、`floorFromDrawingName`（「1階 電灯設備平面図」→`1階`、「B1階平面図」→`B1階`、「屋上階平面図」→`RF`、「1・2階平面図」→無し、「配置図」→無し）。
  - `tests/quantityIndex.test.ts`（指示書の 24 の例）:
    - LED埋込形: 1階事務室 24・1階会議室 8・2階事務室 32 → 全体 64、1階 32、2階 32、1階/事務室 24。
    - ケーブル: p.1 30m・p.3 20m・p.8 50m（場所はばらばら）→ 全図面 100m。p.3 の注釈を除いて作り直すと 80m。
    - 根切り（`polygonDepth`）p.1 10・p.2 15・p.3 20m³ → 45m³。p.2 を除くと 30m³。溝掘削（`lengthWidthDepth`）も同じ。
    - 規格違い: EM-CE 3C-5.5sq 100m と EM-CE 3C-14sq 40m が別の項目として集計される。
    - 同一経路: 12.35m の経路に CV×2・EM-CE×1 → CV 24.70m、EM-CE 12.35m。
  - `tests/countFixtures.test.ts`・`tests/quantity.test.ts`・`tests/counts.test.ts`: 新しい欄の読み書きの往復、欄の無い古いデータが今と同じに読めること、不正な値（41 文字の階、条数 0・100、11 件の `extra`、長さ以外の method の `extra`）の扱い、`quantityLabel` の経路の文字。
- **結合**: 規格・集計方式を持つ項目、階・部屋を持つ個数の印、`extra` と条数を持つ経路を保存して開き直し、すべて戻ること。古い形（欄の無い `KaruCountFixtures`・`KaruCount`・`KaruQuantity`）の PDF を開いて、数量が変わらず、編集して保存し直せること。
- **画面（`e2e/quantity-location-route.annotate.spec.ts`）**:
  1. 数量タブで「現在の階」に `1F` と入れて確定すると `1階` になる。部屋に「事務室」。照明器具を3つ数えると、3つとも 1階・事務室。
  2. 「現在の階」を空にして、図面名称が「2階 電灯設備平面図」のページで数えると、階が `2階` になる（図面名称は試験の窓口で入れてよい）。
  3. 2つの印を選び、書式欄で部屋を「会議室」にする → 両方変わる。`Ctrl+Z` で戻る。
  4. 長さの経路を1本なぞり、書式欄で条数を 2 にし、別の長さの項目を「この経路に足す」→ 図面の文字と、両方の項目の「全図面」が合う。
  5. 項目の画面で規格を入れて複製し、規格を打ち替えて追加 → 別の項目になり、一覧に規格が出る。
  6. 保存して開き直すと、階・部屋・規格・集計方式・条数・経路の項目が戻る。
- 既存の数量拾い・計測の e2e が通ること。

## 禁止事項

- 名前（「ケーブル」を含むなど）で集計方式や種別を判定しないこと。
- 既存の数量（個数・長さ・面積・体積）が、古い PDF を開いたときに変わったり失われたりしないこと。
- 画面の再描画のたびに全注釈を回って集計しないこと。
- 対象外のファイルを変更しないこと。git の変更操作をしないこと。python・pytest は使わない。

## 検証項目

- [ ] `npx tsc --noEmit`、`npm test`、`npm run build` が成功する。
- [ ] 新しい e2e と、既存の `count-fixtures`・`quantity-*`・`measure`・`drawing-filter`・`organize` の e2e が成功する。
- [ ] 索引の作り直しの時間の測定の結果。

## 報告してほしいこと

- 保存の形の変更点（実際に書いた JSON の例）と、古い形との互換の確かめ方
- 変更したファイルと要点、検証の結果
- SPEC から逸脱した箇所と理由、残課題
