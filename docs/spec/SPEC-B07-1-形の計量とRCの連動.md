# SPEC-B07-1: 形の計量と、RC 部材・形の連動の計算

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 数量の索引への形の計量の追加（多角形の平行線の切り取りを含む）、RC 部材の式（5 種の部材 × コンクリート・型枠・鉄筋・継手）、連動の新しい種類・元の引き算・開口からの係数、保存形式の拡張にまたがる

---

## 背景

計画: `docs/調査/連動B07_計画.md`（§2 RC 部材の式、§3 形の連動）。データは Claude が作成済み（**変えないこと**）: `src/core/breakdown/rcData.ts`（`REBAR_MASS_KG_PER_M`、`rebarDiameterMm`、`REBAR_REQUIRED_FACTOR`、`DEFAULT_ANCHORAGE_D`・`DEFAULT_LAP_D`、`MAX_DIAMETER_WITHOUT_HOOK`、`MIN_DIAMETER_GAS_PRESSURE`、`rebarJoints`、`barCount`）。

この SPEC は計算（core）まで。画面は B07-2。

## 対象

- 新規: `src/core/shapeMetrics.ts`、`src/core/rcMember.ts`、`tests/shapeMetrics.test.ts`、`tests/rcMember.test.ts`
- 変更: `src/core/countFixtures.ts`（`rc` の型・読込・保存の検査）、`src/core/fixtureLink.ts`（新しい種類と元の設定）、`src/core/quantityIndex.ts`（形の計量を集めて渡す）
- 変えない: データのファイル、画面、RC・形の連動の無い文書の計算

## 1. 形の計量（`shapeMetrics.ts`）

```ts
export interface ShapeMetrics {
  itemId: string; annotationId: string; pageIndex: number; floor?: string; room?: string; condition?: string
  method: QuantityMethod          // click は個数の印
  count: number                   // 個数の印は 1、経路は条数など（今の索引の値の元）。面・線は 1
  areaM2: number                  // 囲む系: 穴・開口を引いた面積（今の quantityValue と同じ）。長さ×高さ: 面積（開口差引き後）
  grossAreaM2: number             // 穴・開口を引く前
  perimeterM: number              // 囲む系: 外形の周長（閉じた多角形）。線: 長さ
  lengthM: number                 // 線・長さ×高さ・長さ×幅×深さ: 線の長さ。囲む系: 0
  heightM?: number; widthM?: number; depthM?: number
  /** 床板の配筋用: 外形（m 単位の座標）と穴。囲む系だけ */
  polygonM?: { outer: Array<[number, number]>; holes: Array<Array<[number, number]>> }
}
export function collectShapeMetrics(annotations, fixtures, itemIds: ReadonlySet<string>): Map<string, ShapeMetrics[]>
/** 多角形（穴あり）に、向き x（水平）または y（垂直）の平行線を間隔ごとに引き、形の内側の長さ（m）を 1 本ずつ返す。端の 1 本目は形の端から半間隔ではなく端に置く（本数 = 長さ ÷ 間隔 の切り上げ ＋1 と同じ）。 */
export function clipParallelBars(polygon, direction: 'x' | 'y', spacingM: number): number[]
```

- 座標は PDF の点 × `mmPerPoint / 1000`（今の長さ・面積と同じ換算）。
- 平行線は even-odd で内側を判定し、穴の中は除く。1 本の線が形を複数回出入りするときは区間ごとに 1 本として返す。
- 集めるのは、RC 部材（`rc` を持つ項目）と、`shape`・`rc` の連動の元になる項目の拾いだけ。

## 2. RC 部材（`rcMember.ts`、`CountFixture.rc`）

```ts
export type RcMemberKind = 'slab' | 'foundationSlab' | 'wall' | 'beam' | 'foundationBeam' | 'column' | 'footing'
export interface RcBar {
  role: 'x' | 'y' | 'vertical' | 'horizontal' | 'top' | 'bottom' | 'stirrup' | 'hoop' | 'main' | 'base'
  size: string                 // 'D13' など。REBAR_MASS_KG_PER_M のキー
  spacingMm?: number           // 間隔で並べる筋（床板・壁・スタラップ・フープ・ベース筋）
  count?: number               // 本数で決める筋（梁の上端・下端、柱の主筋）
  layers?: 1 | 2               // シングル／ダブル、上端・下端の 2 段（既定 1）
}
export interface RcMember {
  kind: RcMemberKind
  thicknessMm?: number         // 床板・基礎スラブ・壁
  widthMm?: number; depthMm?: number   // 梁の b×D、柱の b×D、独立基礎の 幅×長さ（depthMm は長さ）
  heightMm?: number            // 柱の高さ（階高）、独立基礎の高さ。壁は拾いの高さ
  slabDeductMm?: number        // 梁: 控除する床板の厚さ
  bars: RcBar[]                // 20 本まで
  anchorageD?: number          // 既定 DEFAULT_ANCHORAGE_D
  lapD?: number                // 既定 DEFAULT_LAP_D
  joint?: 'lap' | 'gas'        // 既定: 径 16 以上はガス圧接、それ以下は重ね
}
export interface RcResult {
  concreteM3: number; formworkM2: number
  bars: Array<{ size: string; role: RcBar['role']; count: number; lengthM: number; massKg: number }>  // 設計数量
  lapJoints: number; gasJoints: Array<{ size: string; count: number }>
}
export function computeRcMember(member: RcMember, metrics: ShapeMetrics): RcResult
export function rcMemberError(member: unknown): string | undefined
```

式は計画 §2 の表のとおり（部材ごと）。要点:
- 床板・基礎スラブ: 鉄筋 `x`・`y` の筋は `clipParallelBars(polygonM, 向き, 間隔)` の各区間に、両端の定着（`anchorageD × d` mm）を足す。`layers` 2 なら倍。継手は区間ごとに `rebarJoints(長さ, d, 'slab')`。基礎スラブの型枠は 周長 × 厚さ、床板は底面（面積）。
- 壁: 拾いが「長さ × 高さ」（`lengthM`・`heightM`）。縦筋 本数 `barCount(長さ, 間隔)` × 層、1 本 = 高さ ＋ 定着、継手 `'perFloor'`。横筋 本数 `barCount(高さ, 間隔, true)` × 層、1 本 = 長さ ＋ 定着、継手 `'general'`。型枠 = 面積 × 2、コンクリート = 面積（開口差引き後）× 厚さ。
- 梁・基礎梁: 拾いが線（`lengthM`）。コンクリート = 長さ × b × (D − 床板厚)、型枠 = 長さ × (b ＋ 2(D − 床板厚))（基礎梁は 長さ × 2(D − 床板厚)、底面なし）。上端・下端 本数 × 層 × (長さ ＋ 2 × 定着)、継手 `'beam'`。スタラップ 本数 `barCount(長さ, 間隔)`、1 本 = 2(b＋D)。
- 柱: 個数の印（`count`）。コンクリート = 個数 × b × D × 高さ、型枠 = 個数 × 2(b＋D) × 高さ。主筋 本数 × 個数 × (高さ ＋ 重ね継手の長さ)（重ねのとき）、継手 `'perFloor'`。フープ 本数 `barCount(高さ, 間隔)` × 個数、1 本 = 2(b＋D)。
- 独立基礎: 個数。コンクリート = 個数 × 幅 × 長さ × 高さ、型枠 = 個数 × 2(幅＋長さ) × 高さ。ベース筋 両方向（`base` の筋 1 つで両方向）: `barCount(幅, 間隔)` × 長さ ＋ `barCount(長さ, 間隔)` × 幅、× 個数。
- 重ね継手のとき、継手の数 × 重ね継手の長さ（`lapD × d`）を長さに足す。ガス圧接のときは長さに足さず、径ごとのか所に数える。
- 質量 = 長さ × 単位質量。設計数量で持つ（所要数量は連動の出力で × `REBAR_REQUIRED_FACTOR`）。
- 単位はすべて m・㎡・㎥・kg（mm は 1000 で割る）。

`CountFixture` に `rc?: RcMember` を足す。読込: 形が誤りなら `rc` だけを捨てる。保存: `rcMemberError` で止める。

## 3. 連動の新しい種類（`fixtureLink.ts`）

- `kind: 'rc'`、`rc: { output: 'concrete' | 'formwork' | 'rebar' | 'gasJoint' | 'lapJoint'; sizes?: string[]; basis?: 'design' | 'required' }`
  - 元は RC 部材の項目（`rc` を持つ）。元の拾いごとに `computeRcMember` を計算し、出力の値を連動の行にする（図面・階・部屋・施工条件は元の拾いのまま）。
  - `rebar`: 単位 t。`sizes` があればその径だけ（無ければ全部）。`basis: 'required'` なら × 1.04（既定 design）。`gasJoint`・`lapJoint`: か所（`sizes` で絞れる）。`concrete` ㎥、`formwork` ㎡。
- `kind: 'shape'`、`shape: { output: 'area' | 'perimeter' | 'lengthTimesHeight' | 'excavation'; heightM?: number; marginM?: number; depthM?: number }`
  - `area`: `areaM2`。`perimeter`: `perimeterM`（線は長さ）。`lengthTimesHeight`: `lengthM`（囲む系は `perimeterM`）× `heightM`。`excavation`: `(areaM2 ＋ perimeterM × margin ＋ 4 × margin²) × depth`（depth は拾いの `depthM` があればそれ、無ければ `shape.depthM`）。
- どの種類でも、元ごとに:
  - `sign?: -1`（引き算。結果は 0 未満にしない — 合計で 0 に止める）
  - `factorFrom?: 'openingArea' | 'openingPerimeter' | 'openingWidth'`（元の項目の `opening`（幅・高さ m）から係数: 幅×高さ、2×(幅＋高さ)、幅。`factor` と掛け合わせる。`opening` が無ければ 0 と警告）
- 単位: `rc` は出力ごと（`quantityUnit`・`quantityDecimals`・`quantityOutputKind` を `countFixtures.ts` で: concrete ㎥/volume、formwork ㎡/area、rebar t/mass、joint か所/count（桁 0））。`shape` は項目の種別のまま（面積・周長・根切りは項目を面積・長さ・体積の種別にして作る）。
- 根拠（`LinkBasisSource`）に、RC は元ごとの部材の結果の要約（`note`: 例 `D13 x 12本 46.8m、y 10本 40.2m`）。
- 検査（`fixtureLinkError`）: 新しい項目の範囲（`marginM` 0〜5、`heightM`・`depthM` 0〜100、`sizes` は `REBAR_MASS_KG_PER_M` のキー）。

## 4. 索引（`quantityIndex.ts`）

- 連動に `rc` または `shape` の種類があるときだけ、`collectShapeMetrics` を呼び、`computeLinks(fixtures, entriesOf, metricsOf)` に渡す（第 3 引数は省略可能。無ければ今と同じ）。
- RC 部材の項目そのものの数量（拾いの面積・長さ・個数）は今のまま。

## 5. 試験（手計算と一致すること）

`tests/shapeMetrics.test.ts`:
- 4m×3m の長方形の周長 14、面積 12。L 字形・穴あきの面積・周長。
- `clipParallelBars`: 4m×3m、x 向き、間隔 0.2m → 本数 `ceil(3/0.2)+1 = 16`、各 4m。L 字形・穴をまたぐ線の区間分け。

`tests/rcMember.test.ts`:
- 床板 4m×3m、厚さ 150、D13@200 x・y、2 段、定着 35d: コンクリート 1.8㎥、型枠 12㎡、x: 16 本 × 2 段 × (4 ＋ 2×0.455) m、y: 21 本 × 2 段 × (3 ＋ 0.91) m、質量 = 長さ × 0.995。継手（床板の区分）。
- 壁 長さ 5m × 高さ 3m、厚さ 180、D10@200 ダブル: 縦筋 `barCount(5,0.2)=26` × 2、横筋 `barCount(3,0.2,true)=14` × 2。
- 梁 長さ 6m、b 400 × D 700、床板 150 控除、上端 4-D22、下端 4-D22、スタラップ D10@200: コンクリート 6×0.4×0.55 = 1.32、型枠 6×(0.4＋1.1) = 9.0、主筋の継手 1 か所/本（5〜10m）、径 22 はガス圧接 8 か所。
- 柱 2 本、600×600、高さ 3.5m、主筋 12-D25、フープ D13@100。
- 独立基礎 3 基、2.0×2.0×0.8、D16@200。
- 連動: `rc` concrete・formwork・rebar（径の絞り込み、required ×1.04）・gasJoint。`shape` area・perimeter・lengthTimesHeight・excavation。`sign: -1` の引き算（埋戻し = 根切り − 基礎の体積）。`factorFrom: 'openingPerimeter'`（建具 W1.8×H2.1 × 3 か所 → 23.4m）。
- RC・形の連動の無い文書では `collectShapeMetrics` を呼ばない（呼び出しを数える試験）。

## 禁止事項

- データを変えないこと。RC・形の連動の無い文書の計算を変えないこと。依存パッケージを足さないこと。指定外のファイルを変えないこと。

## 検証項目（Claude Code が実行する）

- [ ] 型検査、単体（全件）、e2e（連動・集計表・数量拾い）
- [ ] 計算の時間: 床板 200 枚・D13@200 2 方向 2 段で索引の作り直しを記録する
