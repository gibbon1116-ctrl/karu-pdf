# SPEC-T2a: 拾い範囲と関連数量 — 計算エンジン（10進演算・単位・条件・JSON Schema・24方式・22明細・35方式）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 新しい計算モジュール群の設計（誤差の無い10進演算、検証器、方式ごとの停止条件）を含むため既定の sol-high。

---

## 目的

統合実装指示書（2026-10-18）の P2・P4 の中核として、**React・ストア・PDF に依存しない純粋関数**で、
定義の算出方式（24方式）、詳細数量の明細（22形式＋ダクト＋はつり）、方式未確定の定義の方式（35方式）の数量を計算する。
数量を作れないときは **null と理由** を返し、0・式1・既定係数・既定密度で補わない。

この SPEC では画面・保存・ストアは作らない（T3・T4）。

## 既にあるもの（変更しない）

- `src/core/takeoff/types.ts` — 生成データの型（`FormulaId`、`DetailFormatId`、`TakeoffMaster`、`MasterUnitMethod` 等）。**変更しない**。
- `src/core/takeoff/master.data.ts` — 生成データ（約2.9MB。`export default` の TakeoffMaster。中身は JSON.parse）。**このモジュール群から import しない**（計算は呼び出し側が渡す値だけで行う。データの読み込みは T2b）。
- `tests/fixtures/takeoff/acceptance.json` — 原本の受入仕様から抽出した試験用データ（値は架空の TEST 値）。形は末尾の付録 C。

## 共通の約束

- `eval`・`new Function`・動的なプロパティ参照で文字列を実行しない。原本の式文字列（「I*J*K」等）は使わず、方式ごとに TypeScript で書く。
- 入力は `unknown` として受け取り、型・有限数・符号を確かめてから使う。`NaN`・`Infinity`・空文字・`null`・`undefined` を 0 にしない。
- 数値は **10進の文字列** で扱う（`decimal.ts`）。JavaScript の浮動小数点で足し算・掛け算をしない（0.1+0.2 の誤差を出さない）。
- 単位は `units.ts` の明示した換算だけ。名前が似ている単位（台と個、m2 と m 等）を変換しない。
- 結果は未丸めの値。表示の丸めは別関数（`roundForDisplay`）で、計算の入力に戻さない。
- メッセージは日本語。利用者に見せる文は「何が足りないか・何が矛盾しているか」を具体的に（例:「立上り長さ（riser_m）が未入力です。0 として計算しません。」）。

## 作るもの

### 1. `src/core/takeoff/decimal.ts`（10進演算）

BigInt で実装する。外部ライブラリは足さない。

```ts
export interface Decimal { readonly sign: 1 | -1; readonly digits: bigint; readonly scale: number } // 値 = sign * digits / 10^scale, digits >= 0
export type DecimalParse = { ok: true; value: Decimal } | { ok: false; reason: string }
export function parseDecimal(input: unknown): DecimalParse
export function decimalToString(value: Decimal): string          // 末尾の 0 を落とした正規形。'-0' は '0'
export function add(a: Decimal, b: Decimal): Decimal
export function sub(a: Decimal, b: Decimal): Decimal
export function mul(a: Decimal, b: Decimal): Decimal
export function divPow10(a: Decimal, exponent: number): Decimal  // 10^n で割る（kg→t、mm→m 用。正確）
export function mulPi(a: Decimal): Decimal                        // π を 40 桁の定数で掛け、小数 30 桁で切り捨てる（無理数を含む唯一の演算。結果の warnings に「π は 30 桁で打ち切り」を付けるのは呼び出し側）
export function compare(a: Decimal, b: Decimal): -1 | 0 | 1
export function isZero(a: Decimal): boolean
export function isNegative(a: Decimal): boolean                    // 0 は負ではない
export const ZERO: Decimal
export function roundForDisplay(value: string, digits: number): string // 四捨五入（HALF_UP）。表示専用
```

- `parseDecimal` が受け付けるもの: `/^[+-]?\d+(\.\d+)?$/` の文字列（前後の空白は除く、全角数字は受け付けない）と、有限の `number`（`String()` が指数表記になる値は指数を正しく展開する。例: `1e-7` → `0.0000001`）。`bigint` は受け付けない。それ以外は `ok: false`（理由: 「数値ではありません」「空欄です」「有限の数ではありません」）。
- 割り算は `divPow10` だけ（一般の除算は作らない）。

### 2. `src/core/takeoff/units.ts`（単位）

```ts
export type Dimension = 'length' | 'area' | 'volume' | 'mass' | 'count' | 'composite' | 'labor' | 'energy' | 'none'
export function normalizeUnit(unit: string): string   // 表示の別名だけを正規化
export function unitDimension(unit: string): Dimension | undefined
export function sameUnit(a: string, b: string): boolean
export function convertUnit(value: Decimal, from: string, to: string): { ok: true; value: Decimal } | { ok: false; reason: string }
```

- 正規化（原本「数量算定24方式」H4UnitPolicy）: `㎡`・`m²` → `m2`、`㎥`・`m³` → `m3`、`㎏` → `kg`、全角 `ｍ` → `m`、前後の空白除去。`㎡・日` → `m2・日`、`m³・日` → `m3・日`。
  それ以外は変えない。**台・個・組・面・本・枚・か所・基・式 を同じものとして扱わない。**
- 次元: `m`/`mm`/`cm` = length、`m2`/`mm2` = area、`m3` = volume、`kg`/`t` = mass、`個`/`台`/`組`/`面`/`本`/`枚`/`か所`/`基`/`式`/`箇所` = count（ただし count 同士でも単位が違えば換算不可）、`台・日`/`人・日`/`m2・日`/`m3・日`/`台・回` = composite、`工数` = labor、`kWh` = energy、`''`/`—`/`未確定` = none。
- 換算（明示したものだけ）: mm→m（÷1000）、cm→m（÷100）、m→m、mm2→m2（÷1,000,000）、kg→t（÷1000）、t→kg（×1000）、同じ単位は恒等。ほかは `ok: false`（理由:「m2 と m は換算できません」等）。

### 3. `src/core/takeoff/calcTypes.ts`（結果の型）

```ts
export type CalcStatus =
  | 'CALCULATED'      // 値あり（参考値。採用・出力は別判断）
  | 'INPUT_REQUIRED'  // 必要な入力が足りない（値は null）
  | 'INVALID'         // 入力が矛盾（負の結果、ID重複、単位不一致、日付の前後逆転 等。値は null）
  | 'UNSUPPORTED'     // 方式が未実装・停止方式（値は null）
  | 'NO_QUANTITY'     // 数量を持たない方式（別計上しない・記録だけ・参照専用。値は null）
export interface CalcResult {
  status: CalcStatus
  value: string | null           // 未丸めの10進文字列。CALCULATED のときだけ非 null
  unit: string                   // 出力の単位（呼び出し側が渡した目標単位。正規化前の表記を保持）
  missing: string[]              // 足りない入力のキー（明細は `records[2].length_m` のような path）
  errors: string[]               // 矛盾の説明
  warnings: string[]             // 計算はできたが確認が必要なこと
  reviewConditions: string[]     // 自動では確かめない照査条件（明細 schema の x-review-conditions 等）
  steps: string[]                // 内訳（例: 「r1: 5 × 3 = 15」）
  /** 価格・採用の段階で必要になる入力（計算は止めない。CC26-16） */
  laterRequired: string[]
}
export function calcResult(partial: Partial<CalcResult> & Pick<CalcResult, 'status' | 'unit'>): CalcResult // 既定値を埋める補助
```

### 4. `src/core/takeoff/conditions.ts`（条件の評価）

```ts
export type Truth = 'true' | 'false' | 'unknown'
export interface ConditionOutcome { truth: Truth; unsupported: string[]; unknownFields: string[]; falseFields: string[] }
export function evaluateCondition(node: unknown, facts: Readonly<Record<string, unknown>>): ConditionOutcome
export function isMissingFact(value: unknown): boolean   // undefined / null / '' / 空白だけの文字列 / 空配列
```

- ノード: `{ all: [...] }`（全部 true で true、一つでも false で false、それ以外は unknown）、`{ any: [...] }`（一つでも true で true、全部 false で false、それ以外は unknown）、
  `{ field, op: 'eq', value }`（事実が未入力なら unknown。深い等価比較）、`{ field, op: 'in', values | value: [...] }`（配列のどれかと等しい）、`{ field, op: 'contains', value }`（事実が配列でその要素を含む。未入力は unknown、配列でなければ false）。
- 上記以外の形・演算子は **評価しない**: truth を `'unknown'` にし、`unsupported` に「未対応の演算子 gt（field=…）」のように入れる。false にしない。
- `facts` は `Object.prototype.hasOwnProperty` で読む（`__proto__` 等を辿らない）。
- `unknownFields` / `falseFields` は画面で「何を確かめればよいか」を出すために集める（重複なし・出現順）。

### 5. `src/core/takeoff/jsonSchema.ts`（JSON Schema の部分実装）

原本の入力型スキーマ・明細 schema が使うキーワードだけを実装する。**未対応のキーワードを黙って通さない。**

```ts
export interface SchemaIssue { path: string; keyword: string; message: string }
export interface SchemaOutcome {
  valid: boolean                 // errors も unsupported も無いときだけ true
  errors: SchemaIssue[]
  unsupported: SchemaIssue[]     // 実装していないキーワード
  annotations: { path: string; keyword: string; value: unknown }[] // x-* と description
}
export function validateSchema(schema: unknown, value: unknown): SchemaOutcome
```

- 実装するキーワード: `$schema`（無視）、`description`（注釈）、`type`（string/number/integer/boolean/object/array/null と配列指定）、`required`、`properties`、`additionalProperties`（boolean とスキーマ）、`const`、`enum`、`minLength`、`minimum`、`exclusiveMinimum`、`items`（単一スキーマ）、`minItems`、`uniqueItems`（深い等価）、`allOf`、`if` / `then` / `else`（`if` の評価結果は errors に入れない）。
- `x-` で始まるキーワードは検証しない注釈として `annotations` に入れる（`x-review-conditions` は呼び出し側が照査条件として表示する）。
- それ以外のキーワードは `unsupported` に入れ、`valid` を false にする。
- `number`・`integer` の判定は JSON の数値（`typeof === 'number'` かつ有限）。10進文字列は number ではない（明細の数値は JSON の数値で入る）。
- path の書き方: ルート `''`、プロパティ `records[0].length_m`。
- 再帰の深さは 64 で打ち切り、超えたら errors（「入れ子が深すぎます」）。

### 6. `src/core/takeoff/kernels.ts`（24方式）

```ts
export interface KernelInput { formula: FormulaId; targetUnit: string; body: unknown }
export function calculateFormula(input: KernelInput): CalcResult
```

body の形は原本「数量算定24方式」の body 入力契約（付録 A）。行の数値は 10進文字列又は有限数を受け付ける（`parseDecimal`）。
**共通**: 行配列は 1 行以上。各行の `id` は空でない文字列。行の数値は 0 以上（寸法 w/h/L/D/A/t/d は 0 より大）。
`deductions`・`additions` は `dimensions_unit: 'SI'` の方式で **必須**（0 も明示。未入力は `missing`）。控除が対象を超えて結果が負 → `INVALID`（「控除が対象を超えています。負の数量・0 への丸めはしません」。CC26-14）。

| 方式 | 計算 | 方式固有の停止 |
|---|---|---|
| F_MANUAL | value を input_unit から targetUnit へ `convertUnit` | `measurement_evidence_id` が空 → INPUT_REQUIRED。換算不可 → INVALID |
| F_SAME | value | `same_object_scope_basis !== true` → INPUT_REQUIRED（「同一現物・範囲・数量基準の確認が必要です。単位が同じだけでは同一数量にしません」）。`source_unit` と targetUnit が `sameUnit` でない → INVALID |
| F_SUBSET | Σ value | 行の id 重複 → INVALID。`source_unit` と targetUnit が違う → INVALID |
| F_UNIQUE | 同じ id の行は1回だけ数える | 同じ id で値が違う → INVALID（「同じ区間IDで長さが違います」） |
| F_COUNT | 一意な `object_ids` の件数 | `survey_complete !== true` → INPUT_REQUIRED。重複 id があっても一意件数（warnings に重複 id を出す） |
| F_FACTOR | Σ source × factor | `coefficient_approved !== true` → INPUT_REQUIRED。`factor_unit` が `${targetUnit}/${source_unit}` と一致しない → INVALID |
| F_RECT | Σ 2×(w+h)×L − deductions + additions | |
| F_ROUND | Σ π×D×L − deductions + additions（`mulPi`） | warnings に「π は 30 桁で打ち切り」 |
| F_WALL / F_UP | Σ L×h − deductions + additions | |
| F_THICK / F_SAND | Σ A×t − deductions + additions | |
| F_TRENCH | Σ L×w×d − deductions + additions | |
| F_PIT | Σ A×d − deductions + additions | |
| F_BACK | excavation − Σ displacements.volume | 負 → INVALID |
| F_DIFF | A − B | `same_dimension_scope_basis !== true` → INPUT_REQUIRED。負 → INVALID |
| F_MASS | value × unit_mass（kg） | `unit_mass_basis` が `kg/${source_unit}` でない → INVALID。targetUnit が kg でない → INVALID |
| F_TON | value（kg）÷1000 → t | `source_unit` が kg でない → INVALID。targetUnit が t でない → INVALID |
| F_EDGE | Σ value（m） | 行の id 重複 → INVALID（「同じ辺を二重に数えません」） |
| F_SURFACE | Σ A − deductions + additions | |
| F_UNION | UNSUPPORTED（「対象面の和集合（座標系・図面版・穴の検証）は未実装です」） | |
| F_DESIGN | UNSUPPORTED（「明細から計算します（明細の入力が必要）」）— 明細は schedules.ts | |
| F_CHECK | NO_QUANTITY（「確認の記録だけで数量を持ちません」） | |
| F_DUCT_RECT_EST | UNSUPPORTED（「ダクトの積算規則は明細から計算します」）— 明細は schedules.ts の DUCT | |

- 行の入力の不足は `missing` に `rows[1].h` のように入れる。複数の不足をまとめて返す（最初の1つで止めない）。
- 計算した値が単位の次元と合わないこと（例: F_WALL の targetUnit が m）→ INVALID。各方式の出力次元: F_RECT/F_ROUND/F_WALL/F_UP/F_SURFACE = area、F_THICK/F_SAND/F_TRENCH/F_PIT/F_BACK = volume、F_EDGE/F_UNIQUE = length、F_MASS = kg、F_TON = t、F_COUNT は count（targetUnit の単位をそのまま使う）、F_MANUAL/F_SAME/F_SUBSET/F_DIFF/F_FACTOR は targetUnit のまま。

### 7. `src/core/takeoff/schedules.ts`（詳細数量の明細 22形式＋DUCT＋HATSURI_VOL）

```ts
export interface ScheduleInput {
  format: DetailFormatId | 'DUCT' | 'HATSURI_VOL'
  targetUnit: string
  schedule: unknown              // { quantity_definition_id, target_unit, basis_id, drawing_revision, schedule_id, records: [...] }
  schema?: unknown               // 定義別の明細 schema（T2b が形式の schema と上書きから作って渡す）。あれば validateSchema で先に検証
}
export function calculateSchedule(input: ScheduleInput): CalcResult
```

- `schema` があれば `validateSchema` する。errors → INPUT_REQUIRED（required 不足は `missing` へ、型・範囲の違反は errors）。unsupported → UNSUPPORTED。
  `annotations` の `x-review-conditions`（文字列配列）は `reviewConditions` へ入れる（「これらは照査仕様で、実装済のバリデーターではない」のとおり、自動で満たしたことにしない）。
- `schema` が無いときも、下表の「明細の必須」を自分で確かめる（schema が無いことを理由に検査を省かない）。
- `target_unit` と `targetUnit` が `sameUnit` でない → INVALID。
- 各明細の ID（表の「ID」列）が同じ明細の中で重複 → INVALID（「同じ部材IDが2回あります。二重に加算しません。別工程なら別の明細にしてください」。CC26-15）。
- 「根拠」の欄（`*_evidence_id`・`*_basis_id`・`detail_id` 等、表の必須に入っているもの）が空 → INPUT_REQUIRED（付録 C の MISS ケース）。

| 形式 | ID | 計算（Σ は明細の合計） | 明細の必須（schema と同じ） | 追加の停止 |
|---|---|---|---|---|
| REBAR | bar_id | count×length_m×unit_mass_kg_per_m（kg）。targetUnit t なら ÷1000 | bar_id, diameter_spec, count, length_m, length_basis_id, unit_mass_kg_per_m, unit_mass_evidence_id | 固定の鉄筋率・継手率・ロスを足さない |
| STEEL | member_id | mass_model 別: LINEAR = count×length_m×unit_mass_kg_per_m、PLATE = count×width_m×length_m×thickness_m×density_kg_per_m3、DIRECT = count×member_mass_kg | member_id, count, mass_model, material, section_id, mass_evidence_id ＋ モデル別（LINEAR: length_m, unit_mass_kg_per_m / PLATE: width_m, length_m, thickness_m, density_kg_per_m3, density_evidence_id / DIRECT: member_mass_kg） | PLATE に unit_mass_kg_per_m だけがあっても使わない（CC26-11）。既定密度を入れない |
| CONCRETE | solid_id | count×plan_area_m2×height_m − deduction_volume_m3（任意。あれば 0 以上） | solid_id, count, plan_area_m2, height_m, geometry_basis_id, deduction_schedule_id, concrete_spec | 明細の控除が明細の体積を超える → INVALID。deduction_volume_m3 が無い明細は warnings「控除量の入力なし（控除なしで算定）」 |
| ANCHOR | anchor_id | 一意な anchor_id の件数（個） | anchor_id, support_id, diameter_spec, anchor_method, installation_detail_id | 機器1台=4本等の割当てをしない |
| SWITCH | equipment_id | 件数（台） | equipment_id, network_system_id, port_schedule_id, poe_budget_evidence_id, equipment_schedule_id | |
| VENT | device_id | 件数（個） | device_id, roof_zone_id, waterproof_method, layout_evidence_id | |
| GLASS | glass_id | count×design_width_m×design_height_m | glass_id, count, design_width_m, design_height_m, glass_spec, dimension_basis_id | |
| FORM | face_id | face_area_m2 | face_id, member_id, face_area_m2, formwork_spec, contact_basis_id, deduction_schedule_id | |
| STEEL_PAINT | member_id | developed_perimeter_m×length_m | member_id, selected_surface_ids（1件以上）, developed_perimeter_m, length_m, paint_spec, surface_basis_id | |
| FIRE | member_id | measured_area_m2 | member_id, covering_method, fire_rating, thickness_m, measurement_dimension_basis_id, surface_schedule_id ＋ **measured_area_m2（>0、被覆工法の計測寸法による面積。この実装で追加）** | 厚さ×面積をしない |
| JOINT | joint_id | 件数（個） | joint_id, bar_diameter, joint_method, connection_detail_id | |
| BOLT | bolt_id | 件数（個） | bolt_id, diameter_spec, joint_id, bolt_grade, bolt_detail_id | |
| WASTE_MASS | waste_object_id | count×component_mass_kg | waste_object_id, material, count, component_mass_kg, mass_evidence_id, disposal_scope_id | |
| OIL_BUND | bund_solid_id | (outer_plan_area_m2 − inner_plan_area_m2)×height_m | bund_solid_id, outer_plan_area_m2, inner_plan_area_m2, height_m, wall_floor_scope_id, detail_id | inner ≥ outer → INVALID |
| EARTH_HAUL | earthwork_id | excavation_volume_m3 − reuse_volume_m3 | earthwork_id, excavation_volume_m3, reuse_volume_m3, volume_state, soil_class, haul_destination, haul_distance_basis_id | 負 → INVALID。明細の volume_state が混在 → INVALID（「体積の状態（地山/ほぐし等）が混ざっています」） |
| EARTH_DISPOSE | earthwork_id | disposal_volume_m3 | earthwork_id, disposal_volume_m3, volume_state, soil_class, acceptance_destination, disposal_evidence_id | volume_state 混在 → INVALID |
| BEDDING | bedding_face_id | plan_area_m2×thickness_m | bedding_face_id, plan_area_m2, thickness_m, material, compaction_state, dimension_basis_id | |
| LABOR | work_scope_id | base_work_value×correction_value（工数） | work_scope_id, adopted_labor_table_id, base_work_value, correction_value, correction_evidence_id, area_schedule_id | 物量と合算しない（結果の unit は 工数） |
| DEMO | existing_solid_id | plan_area_m2×thickness_m − void_volume_m3 | existing_solid_id, plan_area_m2, thickness_m, void_volume_m3, removal_boundary_id, deduction_basis_id | 負 → INVALID |
| GROUT | grout_zone_id | fill_area_m2×gap_m − deduction_volume_m3 | grout_zone_id, fill_area_m2, gap_m, deduction_volume_m3, material, detail_basis_id | 負 → INVALID |
| STRIP | strip_face_id | area_m2×depth_m | strip_face_id, area_m2, depth_m, ground_datum_id, soil_state, scope_evidence_id | |
| COEFF | object_id | base_quantity×coefficient_value（m2） | object_id, base_quantity, base_unit, coefficient_value, coefficient_unit, coefficient_basis_id, applicability_evidence_id | coefficient_unit が `m2/${base_unit}`、又は base_unit が m2 で coefficient_unit が `-`・`無次元`・`dimensionless` のどれか、でなければ INVALID。係数 1 を既定にしない |
| DUCT | segment_id | perimeter_basis_m×length_basis_m（m2） | segment_id, spec_group, perimeter_basis_m, length_basis_m, rule_ids（D01〜D18 の配列、1件以上）, segment_evidence_id ＋ schedule 直下の adopted_basis_id | adopted_basis_id が空 → INPUT_REQUIRED（「採用した積算基準（国 R7 等）を案件で確認してください」）。spec_group が混在する明細は warnings（「仕様群ごとに分けて集計してください」）。F_RECT の幾何補助量で代用しない |
| HATSURI_VOL | opening_id | shape=rect: width_m×height_m×thickness_m、shape=round: π×diameter_m²/4×thickness_m（m3） | opening_id, host_id, shape（rect/round）, thickness_m, ＋形状別（rect: width_m, height_m / round: diameter_m）, existing_void_m3（0 以上・明示） ＋ schedule 直下の quote_line_id | 既存空洞を引いて負 → INVALID |

- 件数の形式（ANCHOR/SWITCH/VENT/JOINT/BOLT）の値は一意 ID の件数で、count 欄があっても掛けない（ID 1つが現物1つ）。
- 各明細の内訳を `steps` に入れる（「b1: 10 × 2 × 1 = 20 kg」）。

### 8. `src/core/takeoff/unitMethods.ts`（方式未確定の定義の35方式）

```ts
export interface MethodVariable { key: string; label: string; unit: string; kind: 'decimal' | 'positive' | 'nonNegative' | 'ids' }
export interface MethodSpec { id: string; unit: string; variables: readonly MethodVariable[]; selectable: boolean }
export const UNIT_METHOD_SPECS: Readonly<Record<string, MethodSpec>>
export interface MethodInput {
  methodId: string
  /** 方式固有の必須入力（原本の required_inputs のキー → 値）と、その他の入力 */
  inputs: Readonly<Record<string, unknown>>
  /** 計算に使う数値（variables の key → 10進） */
  values: Readonly<Record<string, unknown>>
  /** 方式固有の必須入力のキー一覧（マスターの MasterUnitMethod.requiredInputs を呼び出し側が渡す） */
  requiredInputs: readonly string[]
}
export function calculateUnitMethod(input: MethodInput): CalcResult
```

- `requiredInputs` の各キーが `inputs` に無い・`isMissingFact` → INPUT_REQUIRED（`missing` にそのキー）。
  **ただし** 価格・採用の段階のキー（`price_basis_id`, `inclusion_resolution`, `allocation_id`, `adoption_evidence_id`）は計算を止めず `laterRequired` に入れる（CC26-16: 価格資料が無くても物理数量の計測・参考検算はできる）。PACKAGE の `quote_id` は数量そのものの根拠なので計算を止める。
- `inputs.price_unit` があり、`normalizeUnit` して方式の単位と一致しない → INVALID（「方式の単位（台）と価格の単位（台・日）が違います。暗黙に換算しません」）。
- `inputs` に `*_start_end`（2要素の配列）があり、両方が日付として読めて終了が開始より前 → INVALID（「終了が開始より前です。負の日数・絶対値で算定しません」）。
- `inputs.equipment_volume` が数値 0 以下、又は先頭の数値が 0 以下の文字列 → INVALID（「容積が0以下です。密度区分ができません」）。
- `ids` 変数: 配列の文字列。重複があれば INVALID（「同じ現物IDが2回あります」）。値は一意件数。
- 方式表（variables の順序は付録 C の受入ケースの `variables` の順と同じにする）:

| 方式 | 単位 | variables（key: kind） | 計算 |
|---|---|---|---|
| U19:POWER_EQUIP | 台 | equipment_ids: ids | 件数 |
| U19:POWER_PANEL | 面 | panel_ids: ids | 件数 |
| U19:POWER_CABLE | m | route_m: nonNegative, riser_m: nonNegative, extra_m: nonNegative | 和（3つとも必須。0 は明示） |
| U19:POWER_HIRE | 台・日 | equipment_ids: ids, charge_days: positive | 件数×日数 |
| U19:POWER_ENERGY | kWh | load_kw: positive, hours: positive, load_factor: positive | 積 |
| U19:SCAFF_FULL | ㎡ | centerline_m: positive, height_m: positive | 積 |
| U19:SCAFF_SINGLE | ㎡ | centerline_m: positive, height_m: positive | 積 |
| U19:SCAFF_MACHINE | 台 | machine_ids: ids | 件数 |
| U19:SCAFF_LOCATION | か所 | location_ids: ids | 件数 |
| U19:MOVE_MASS | t | mass_kg: positive, mass_correction: positive, single_factor: positive | mass_kg÷1000×mass_correction×single_factor |
| U19:MOVE_VOLUME | t | mass_kg: positive, density_correction: positive, single_factor: positive | 同上 |
| U19:CRANE_DAY | 台・日 | machine_count: positive, days: positive | 積 |
| U19:LABOUR_DAY | 人・日 | workers: positive, days: positive | 積 |
| U19:INSTALL_PANEL | 面 | panel_ids: ids | 件数 |
| U19:INSTALL_CUBICLE | 基 | equipment_assembly_ids: ids | 件数 |
| U19:STORE_AREA | ㎡・日 | area_m2: positive, days: positive | 積 |
| U19:STORE_VOLUME | m³・日 | volume_m3: positive, days: positive | 積 |
| U19:STORE_UNIT | 台・日 | equipment_ids: ids, days: positive | 件数×日数 |
| U19:RELOCATE_UNIT | 台 | equipment_ids: ids | 件数 |
| U19:RELOCATE_PANEL | 面 | panel_ids: ids | 件数 |
| U19:AHU_INSTALL | 台 | （なし） | **選べない**（`selectable: false`）。計算を求められたら INVALID（「参照専用の方式で、採用方式として選べません」） |
| U19:LIFT_UNIT | 台 | equipment_ids: ids | 件数 |
| U19:BASE_CONCRETE | m³ | length_m: positive, width_m: positive, thickness_m: positive, count: positive | 積 |
| U19:BASE_FORM | ㎡ | faces: 行配列 `[{ id, length_m, height_m }]`（1行以上・id 重複は INVALID） | Σ length_m×height_m |
| U19:BASE_REBAR_T | t | length_m: positive, unit_mass_kg_per_m: positive | 積÷1000 |
| U19:BASE_REBAR_KG | kg | length_m: positive, unit_mass_kg_per_m: positive | 積 |
| U19:BASE_MORTAR | ㎡ | length_m: positive, width_m: positive | 積 |
| U19:FENCE_LENGTH | m | plan_length_m: positive, excluded_m: nonNegative | 差（負 → INVALID） |
| U19:FENCE_AREA | ㎡ | plan_length_m: positive, excluded_m: nonNegative, height_m: positive | (差)×高さ（差が負 → INVALID） |
| U19:BASE_PREFAB | 基 | prefab_ids: ids | 件数 |
| U19:STEEL_TRANSPORT | t | mass_t: positive | そのまま |
| U19:STEEL_TRIP | 台・回 | vehicles: positive, trips_per_vehicle: positive | 積（inputs.trip_ids に重複 → INVALID） |
| U19:STEEL_ERECT | t | mass_t: positive | そのまま |
| U19:PACKAGE | 式 | agreed_quantity: positive | そのまま。`inputs.quote_id` と `inputs.quantity_breakdown` が無ければ INPUT_REQUIRED（「方式を選んだだけで式1にしません」） |
| U19:NO_SEPARATE | — | （なし） | NO_QUANTITY。`reason_code`・`counterpart_definition_or_trade`・`inclusion_or_allocation_evidence` のどれかが無ければ INPUT_REQUIRED（「別計上しない根拠が必要です。0 や不要に置き換えません」） |

- `ids` 変数は `inputs` の同名キーから読む（例: `equipment_ids`）。`values` には入れない。
- 付録 C の受入ケースの `values` を variables の順に当てると正常ケースの期待値になること（試験で確かめる）。

### 9. `src/core/takeoff/capabilities.ts`（能力表）

```ts
export type CapabilityStatus = 'IMPLEMENTED' | 'UNSUPPORTED' | 'NO_QUANTITY'
export interface Capability { status: CapabilityStatus; revision: string; note: string }
export const FORMULA_CAPABILITIES: Readonly<Record<FormulaId, Capability>>
export const SCHEDULE_CAPABILITIES: Readonly<Record<DetailFormatId | 'DUCT' | 'HATSURI_VOL', Capability>>
export const METHOD_CAPABILITIES: Readonly<Record<string, Capability>>   // U19 の35方式
export const ENGINE_REVISION: string   // 'takeoff-engine-1'
```

- 実装した方式は `IMPLEMENTED`、F_UNION・F_DESIGN（明細なし）・F_DUCT_RECT_EST（明細なし）は `UNSUPPORTED`、F_CHECK・U19:NO_SEPARATE は `NO_QUANTITY`、U19:AHU_INSTALL は `UNSUPPORTED`（note: 参照専用）。
- `revision` は方式ごとの版（最初は全部 `'1'`）。計算結果に `formula_revision` として残す（T2b）。
- **能力表と実装の対応を試験する**（IMPLEMENTED なのに UNSUPPORTED を返す方式が無いこと、逆も無いこと）。

## 試験（vitest。`tests/takeoff.*.test.ts`）

既存の試験の書き方（`import { describe, it, expect } from 'vitest'`）に合わせる。node:test や独自の試験枠を作らない。

1. `tests/takeoff.decimal.test.ts`: 0.1+0.2=0.3、1e-7 の展開、`'1.250'` → `'1.25'`、`'-0'`、`''`・`null`・`NaN`・`Infinity`・`'1e3'`（文字列の指数は不可）・全角数字を拒否、divPow10、mulPi の桁、roundForDisplay（HALF_UP、表示だけ）。
2. `tests/takeoff.units.test.ts`: ㎡→m2、m³・日→m3・日、台と個は換算不可、m2 と m は換算不可、mm→m、kg↔t、`—`・`未確定` は none。
3. `tests/takeoff.conditions.test.ts`: all/any の三値、未入力は unknown（false にしない）、contains、in の `values`/`value` 両方、未知の演算子は unsupported＋unknown、`__proto__` を辿らない。
4. `tests/takeoff.jsonSchema.test.ts`: allOf+if/then の条件付き必須（PLATE を選んで密度不足 → 不足を出す。CC26-11）、if が false なら then を問わない、x-review-conditions は annotations、未知キーワード（例 `pattern`）は unsupported で valid=false、uniqueItems、exclusiveMinimum。
5. `tests/takeoff.kernels.test.ts`: 24方式すべての正常・不足・境界（付録 A の正常系入力を使い、期待値は表の計算どおり）、F_MANUAL の mm→m（5285mm → 5.285m）、F_SAME で単位一致だけでは不可（CC26-02 の計算側）、F_WALL で控除超過 → INVALID（CC26-14）、F_UNIQUE の同一IDは1回、F_TON 1250kg→1.25t、F_COUNT の survey_complete。
6. `tests/takeoff.schedules.test.ts`: 付録 C の `detailExamples` 46件をすべて実行する（正常23件は期待値と一致、入力不足23件は INPUT_REQUIRED で `missing` に該当キーを含む）。明細 ID 重複（CC26-15）、STEEL LINEAR 2本×3m×4kg/m=24kg（CC26-12）、REBAR 10本×2m×1kg/m=20kg と t で 0.02（CC26-13）、PLATE で密度・根拠欠落（CC26-11）、DUCT の採用基準なし、HATSURI_VOL。
   - 付録 C の変数名（`count`, `length_m`, `unique_anchor_count` 等）から明細を組み立てる小さな変換を試験の中に書く（件数系は `unique_*_count` 件の ID を作る、FIRE は `member_count` 件×`area_per_member_m2`、FORM は `count_of_selected_faces` 件×幅×高さの面 等）。根拠の欄は `'TEST-…'` で埋める。MISS ケースは対応する正常ケースの明細から `missing` のキーを消して作る。
7. `tests/takeoff.unitMethods.test.ts`: 付録 C の `methodCases` 89件を実行し、結果を **ケースID別の表** で返す関数 `runMethodAcceptance(cases): MethodAcceptanceRow[]` を `src/core/takeoff/acceptance.ts` に作って試験する。
   - 正常（`kind` が「正常・算定」）: `values` を variables の順に当て、`input` を inputs に、`requiredInputs` は付録 C の `input` に対応する方式の必須（試験では `UNIT_METHOD_REQUIRED_INPUTS` として `acceptance.json` から渡せないので、試験側で `import master from '../src/core/takeoff/master.data'` の `master.unitMethods[methodId].requiredInputs` を読む）。期待数量と一致（10進で完全一致、又は差が 1e-9 以下）→ `PASS`。
   - 停止（「異常・停止」）: 同じ方式の正常ケースの `values` と、停止ケースの `input` で計算する。CALCULATED 以外 → `PASS`（`reasonMatched`: 正常ケースとの差分キーが `missing`/`errors` に現れたか）。CALCULATED になった → `FAIL`。
     ただし差分が自由記述の値の違いだけ（例: inclusion_resolution の文が「包含済」に変わる）で計算器が判断しない種類は `NOT_AUTOMATABLE`（理由:「包含・分担の照査で扱う。計算器は自由記述を判定しない」）として `FAIL` にしない。どの差分を NOT_AUTOMATABLE にするかは試験側に一覧で書く（推測で増やさない）。
   - 「正常・参照」「横断・境界」: 数値の期待があるもの（UAT-X-02/03/04）は計算して比較、それ以外は `NOT_AUTOMATABLE`（理由: 方式をまたぐ重複・工程・丸めの照査で、T3/T4 の試験で扱う）。
   - 試験は「正常は全件 PASS」「停止で FAIL は 0 件」「NOT_AUTOMATABLE は一覧に挙げたものだけ」を確かめる。原本の NOT_RUN を PASS に書き換えない（実行した結果だけを返す）。
8. `tests/takeoff.capabilities.test.ts`: 能力表と実装の一致。

## 守ること

- 既存のファイルを変更しない（新しいファイルだけ）。
- 依存パッケージを足さない。
- 浮動小数点で数量を計算しない。
- 未対応・不足を false・0・既定値で置き換えない。

## 付録 A: 24方式の body 入力契約（原本「数量算定24方式」）

（実装時に Claude が master.data.ts の `formulas` から貼り付ける）

## 付録 B: 22明細形式の schema（原本「詳細数量103定義」）

（実装時に Claude が master.data.ts の `detailTemplates` から貼り付ける）

## 付録 C: 受入仕様の fixture の形（`tests/fixtures/takeoff/acceptance.json`）

（実装時に Claude が抜粋を貼り付ける）
