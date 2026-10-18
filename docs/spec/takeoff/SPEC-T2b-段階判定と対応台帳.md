# SPEC-T2b: 拾い範囲と関連数量 — マスターの読込・段階判定・外部検証・949定義の対応台帳

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 条件付き必須・段階条件・役割による停止を正しく組み合わせる判定ロジックの新規設計のため既定の sol-high。

---

## 目的

統合実装指示書 §3〜§5・§11 の P1・P2 として、生成データ（949定義）を実行時に引ける形にし、
定義ごとに「提案」「数量」「正式採用（課金）」の3段階が **満たされているか・何が足りないか** を判定する純粋関数を作る。
あわせて、949定義すべてを「実行可能」「案件入力待ち」「実装待ち」「親／記録／補助」等へ漏れなく対応付ける台帳を作る。

## 既にあるもの（変更しない）

- `src/core/takeoff/types.ts`（生成データの型）、`master.data.ts`（`export default` の `TakeoffMaster`）、`ruleScopes.data.ts`（`export default` の `TakeoffRuleScopes`）。
- T2a の `decimal.ts`・`units.ts`・`calcTypes.ts`・`conditions.ts`（`evaluateCondition`, `isMissingFact`）・`jsonSchema.ts`（`validateSchema`）・`kernels.ts`・`schedules.ts`・`unitMethods.ts`・`capabilities.ts`。

## 作るもの

### 1. `src/core/takeoff/master.ts`（マスターの参照）

```ts
export interface MasterView {
  readonly master: TakeoffMaster
  text(ref: TextRef | undefined): string                     // 番号なら texts、文字列ならそのまま、undefined は ''
  keys(index: number | undefined): readonly string[]          // keysets → keyNames
  condition<T = unknown>(index: number | undefined): T | undefined
  definition(id: string): MasterDefinition | undefined
  definitionsForRule(ruleId: string): readonly MasterDefinition[]  // definition.rules に ruleId を含む定義（元の順）
  requiredKeys(definition: MasterDefinition): readonly string[]
  conditionalRequired(definition: MasterDefinition): readonly ConditionalRequired[]
  quantityStage(definition: MasterDefinition): MasterQuantityStage | undefined
  billingStage(definition: MasterDefinition): MasterBillingStage | undefined
  inputSchema(definition: MasterDefinition): Record<string, unknown>      // 再構成した入力型スキーマ
  scheduleSchema(definition: MasterDefinition): Record<string, unknown> | undefined // 明細の schema（形式の schema の properties を scheduleOverrides で上書き）
  conflicts(definitionId: string): readonly MasterConflict[]
  keyLabel(key: string): MasterKeyLabel | undefined
}
export function createMasterView(master: TakeoffMaster): MasterView
export function ruleScopeText(scopes: TakeoffRuleScopes, ref: TextRef | undefined): string
```

- 索引（id → 定義、ruleId → 定義の配列）は `createMasterView` で一度だけ作る。
- `inputSchema` の再構成（変換器 `scripts/takeoff/build-master.mjs` の `rebuildSchema` と同じ）:
  `{ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', required: requiredKeys, properties: schemaKeys の各キー → schemaOverrides[key] ?? propertyTypes[key], allOf: conditionalRequired を { if: { required: [field], properties: { [field]: { const: value } } }, then: { required, properties: require_values の各キー → { const } } } にしたもの, additionalProperties: true }`。
  `if.op` が `eq` 以外の条件付き必須はスキーマへ入れず、`conditionalRequired` の判定（下の §2）で扱う（現在のデータは全件 eq）。
- `scheduleSchema`: `{ ...template.schema, properties: { ...template.schema.properties, ...detail.scheduleOverrides } }`。

### 2. `src/core/takeoff/readiness.ts`（段階判定）

```ts
export type StageName = 'proposal' | 'quantity' | 'billing'
export type StageStatus =
  | 'SATISFIED'          // 満たしている
  | 'INPUT_REQUIRED'     // 入力が足りない
  | 'CONDITION_FALSE'    // 事実が条件に合わない（施工しない・不要と確認された等。数量を作らない）
  | 'CONDITION_UNKNOWN'  // 事実が未確認（質問はできるが採用・数量生成へ進めない）
  | 'UNSUPPORTED'        // 未対応の演算子・キーワード・検証器・方式
  | 'NOT_APPLICABLE'     // 役割上この段階が無い（親・記録・補助の課金 等）
  | 'BLOCKED'            // マスターの競合（MASTER_CONFLICT）・前段階が未成立
export interface ValidatorResult { name: string; status: 'OK' | 'FAILED' | 'UNSUPPORTED'; message: string }
export interface StageOutcome {
  stage: StageName
  status: StageStatus
  missing: string[]              // 未入力のキー（重複なし・定義の順）
  falseFields: string[]          // 条件に合わない事実
  unknownFields: string[]        // 未確認の事実
  unsupported: string[]          // 未対応の理由
  schemaErrors: SchemaIssue[]    // 型・範囲の違反（required 以外）
  validators: ValidatorResult[]
  reasons: string[]              // 画面に出す日本語の説明（役割による停止・競合など）
}
export type Facts = Readonly<Record<string, unknown>>
export interface Readiness {
  definitionId: string
  proposal: StageOutcome
  quantity: StageOutcome
  billing: StageOutcome
  /** 正式内訳へ出してよいか（役割・3段階・案件の採用の全部。案件の採用は呼び出し側が渡す） */
  formalOutputAllowed: boolean
  formalOutputBlockers: string[]
}
export interface ReadinessInput {
  view: MasterView
  definitionId: string
  /** システムが作る事実（下の SYSTEM_FACT_KEYS とアプリが導く事実） */
  systemFacts: Facts
  /** 利用者が入力した事実 */
  userFacts: Facts
  /** 外部検証器の結果（§3。呼び出し側が runExternalValidators で作る） */
  validators: readonly ValidatorResult[]
  /** 案件で明示的に採用したか（APPROVED_FOR_PROJECT）。欄が埋まっただけでは false */
  approvedForProject: boolean
  /** 依存の版が古い（STALE） */
  stale: boolean
}
export function evaluateReadiness(input: ReadinessInput): Readiness
export const SYSTEM_FACT_KEYS: readonly string[]
export function mergeFacts(systemFacts: Facts, userFacts: Facts): Record<string, unknown>
```

- **`SYSTEM_FACT_KEYS`** = マスターの `keyLabels` で `system: true` の10キー（`dependency_acyclic`, `formula_supported`, `geometry_topology_verified`, `origin_match`, `overlap_resolved`, `price_compatible`, `source_active`, `source_current`, `source_not_orphaned`, `work_mode_match`）。
  `mergeFacts` は userFacts からこれらのキーを **捨ててから** systemFacts を上に重ねる（利用者が true を直接入れられない）。捨てたキーがあれば戻り値とは別に分かるようにする（`mergeFacts` は値だけ返し、`droppedUserSystemKeys(userFacts): string[]` を別に用意）。
- 事実の未入力は `isMissingFact`。`false` と `0` は入力済み（未入力を false/0 に変えない）。
- **競合**: `view.conflicts(id)` があれば3段階とも `BLOCKED`、reasons に「マスターの競合（MASTER_CONFLICT）: …（プロパティ・セル）」。
- **proposal**: `conditions[stages.proposal]` を `evaluateCondition`。true → SATISFIED、false → CONDITION_FALSE、unknown → CONDITION_UNKNOWN（unsupported があれば UNSUPPORTED）。proposal の条件が無い定義（親・記録）は、親は `source_active`/`origin_match`/`work_mode_match` が true なら SATISFIED（同様に評価）、記録も同じ。
- **quantity**（定義の役割で先に分ける）:
  - `quantityRole === 'ROUTER'`（親31）: `NOT_APPLICABLE`、reasons「親の定義は数量を作りません。子の定義（…）を選んでください」（children の ID を conditions から出す）。
  - `quantityRole === 'RECORD_ONLY'`（記録10）: `NOT_APPLICABLE`、reasons「確認の記録だけです」。記録の必須（`stages.required` の conditions）の不足は `missing` に入れる（記録の完成度の表示用）。
  - それ以外:
    1. 必須キー（`view.requiredKeys`）の未入力 → `missing`。
    2. 条件付き必須: 各 clause の `if` を `evaluateCondition` で評価し、true なら `required` の未入力を `missing` へ、`require_values` と値が違うものを `falseFields` へ。unknown（if の事実が未入力）のときは then を問わない。
    3. 数量段階の述語 `quantityStage.predicate`（定義固有の条件 AST を含む）を評価し、false/unknown の事実を集める。
    4. `validateSchema(view.inputSchema(def), mergeFacts(...))`: `required` キーワードのエラーは 1. と重なるので捨て、それ以外を `schemaErrors` へ。unsupported は `unsupported` へ。
    5. 外部検証器: `quantityStage.external_validators` の名前ごとに `input.validators` から結果を探す。無い・`UNSUPPORTED` → `unsupported`、`FAILED` → reasons に message。
    6. 状態の優先: UNSUPPORTED（unsupported が1件でも）> CONDITION_FALSE（述語が false）> INPUT_REQUIRED（missing・schemaErrors・FAILED がある）> CONDITION_UNKNOWN（述語が unknown）> SATISFIED。
  - `role === '未確定方式'` で `userFacts.selected_method_id` が未入力 → 上の結果に関係なく `INPUT_REQUIRED`、missing の先頭に `selected_method_id`、reasons「方式・単位を選ぶまで算定しません（元単位: 未確定）」（CC26-10）。
- **billing**:
  - quantity が SATISFIED でない → `BLOCKED`（reasons「数量の段階が未成立です」）。
  - `billingStage.cost_role_allowed === false`、又は役割が `補助量/照査`・`親/確認記録`・`工数`（工数は物量と別。課金は工数表の確認後） → `NOT_APPLICABLE`（reasons「補助量は正式な物量へ転記しません」等。PA08）。
  - それ以外: `billingStage.required` の未入力 → missing、`billingStage.predicate` を評価（`inclusion_state` が `separate` 以外なら CONDITION_FALSE で reasons「単価包含・他契約のため別計上しません（物理数量は保持）」。CC26-19）。
- **formalOutputAllowed**（指示書 §9 の照合を全部）: 競合なし、役割が `数量候補`（未確定方式は方式選択済みなら可、工数は不可）、quantity SATISFIED、billing SATISFIED、`approvedForProject === true`、`stale === false`。
  一つでも欠けたら false にし、`formalOutputBlockers` に日本語の理由を全部入れる（「案件での採用が未確認（REVIEW_PENDING）」「根拠の版が変わったため再確認が必要（STALE）」等）。**入力欄が全部埋まっても approvedForProject が false なら false**（CC26-17）。

### 3. `src/core/takeoff/validators.ts`（外部検証器）

原本の外部検証器7種を、呼び出し側が渡す文脈から判定する。名前の無いもの・判定材料の無いものは `UNSUPPORTED`（OK にしない）。

```ts
export interface ValidatorContext {
  definition: MasterDefinition
  facts: Facts                                   // mergeFacts 済み
  /** 定義固有の施工条件（definition.checks）への回答。check id → 回答 */
  checkAnswers: Readonly<Record<string, { answer: 'true' | 'false' | 'unknown'; evidence?: string }>>
  calc?: CalcResult                              // 最新の計算結果
  targetUnit?: string                            // 採用する単位（未確定方式は選んだ方式の単位）
  dependencies?: { cycle: boolean; staleIds: readonly string[]; orphanIds: readonly string[] }
  coexistence?: { conflicts: readonly string[] } // 同じ範囲で両立しない選択（排他の方式・子の同時採用）
  geometry?: { source: 'none' | 'fixture' | 'manual' | 'rows' | 'schedule' | 'method'; supported: boolean; note?: string }
}
export function runExternalValidators(names: readonly string[], context: ValidatorContext): ValidatorResult[]
```

| 名前 | OK の条件 | FAILED | UNSUPPORTED |
|---|---|---|---|
| condition_checks_complete | definition.checks の全 id に回答があり、`APPLY`（effect `PHYSICAL_APPLICABILITY`）が true で evidence がある | 回答の不足・APPLY が false/unknown・evidence なし（どの check か message に） | checks が空の定義は OK |
| scope_contract | facts の `scope_id`・`physical_object_id`・`scope_verified === true` がそろう | 不足（キー名を message に） | — |
| method_profile | `calc?.status === 'CALCULATED'` | calc が INPUT_REQUIRED/INVALID（理由を message に） | calc が無い・UNSUPPORTED |
| dependency_graph | dependencies があり cycle=false・staleIds/orphanIds が空 | 循環・古い・失効 | dependencies が無い |
| selection_coexistence | coexistence があり conflicts が空 | conflicts あり | coexistence が無い |
| units_and_dimensions | targetUnit と calc.unit が `sameUnit`、かつ targetUnit が定義の元単位と同じ（元単位が `未確定`/`''`/`—` の定義は選んだ方式の単位と同じ） | 不一致 | targetUnit が無い |
| formula_geometry_support | geometry があり supported=true | supported=false | geometry が無い |

### 4. `src/core/takeoff/ledger.ts`（949定義の対応台帳）

```ts
export type CoverageClass =
  | 'EXECUTABLE'             // 数量候補・方式実装済み。案件の入力・確認が揃えば参考値を計算できる
  | 'DETAIL_SCHEDULE'        // 詳細数量（22形式）の明細から計算（案件の明細待ち）
  | 'METHOD_SELECTION'       // 方式未確定（19）。方式を選んだ後に計算
  | 'HATSURI_METHOD'         // 貫通口はつり（BR-E-017-01）。方式（か所/体積/施工なし）を選んで計算
  | 'NEEDS_ADOPTED_BASIS'    // ダクト13。採用した積算基準の確認が前提
  | 'AUXILIARY_ONLY'         // 補助量/照査（46）。補助として保存し正式物量へ転記しない
  | 'PARENT_ONLY'            // 親（31）。子を選ぶ
  | 'RECORD_ONLY'            // 記録（10）
  | 'LABOR'                  // 工数（1）。物量と別に集計
  | 'IMPLEMENTATION_PENDING' // 方式が未実装（F_UNION 等）
  | 'MASTER_CONFLICT'
export interface LedgerRow {
  definitionId: string; trade: string; label: string; unit: string
  role: ImplementationRole; sourceState: SourceExecutionState; formula: FormulaId
  coverage: CoverageClass
  runtimePath: 'formula' | 'schedule' | 'method' | 'hatsuri' | 'duct' | 'router' | 'record' | 'none'
  capability: CapabilityStatus | 'N/A'
  /** 技術的な未実装（実装担当が直すもの） */
  implementationGaps: string[]
  /** 利用者が案件で入れる資料・事実（review.project・detail.missing・duct.remaining 等から） */
  projectMaterials: string[]
  /** 再開条件 */
  resumeCondition: string
  rules: readonly string[]
  sourceCells: string        // 例: 「数量算定949対応!6 / 定義949行_必須入力!6 / 949定義の再検証!8 / 単価分担949照合!8」
}
export function buildCoverageLedger(view: MasterView): LedgerRow[]
export function ledgerSummary(rows: readonly LedgerRow[]): Record<CoverageClass, number>
export function ledgerToCsv(rows: readonly LedgerRow[]): string     // UTF-8 BOM 付き、RFC 4180 の引用、改行 CRLF
```

- 分類の順（最初に当たったもの）: 競合 → `MASTER_CONFLICT`、quantityRole ROUTER → `PARENT_ONLY`、RECORD_ONLY → `RECORD_ONLY`、role `工数` → `LABOR`、role `補助量/照査` → `AUXILIARY_ONLY`、role `未確定方式` → `METHOD_SELECTION`、`hatsuri` あり → `HATSURI_METHOD`、`duct` あり → `NEEDS_ADOPTED_BASIS`、`detail` あり → `DETAIL_SCHEDULE`（形式の能力が IMPLEMENTED でなければ `IMPLEMENTATION_PENDING`）、それ以外は formula の能力が IMPLEMENTED なら `EXECUTABLE`、でなければ `IMPLEMENTATION_PENDING`。
- 補助量の定義でも方式が計算できる（例 F_COUNT）なら capability は IMPLEMENTED だが coverage は AUXILIARY_ONLY のまま（直接出力しない）。
- `implementationGaps`: 能力が IMPLEMENTED でない方式・形式の理由、F_UNION の「対象面の和集合の幾何」等。**定義固有の施工条件（checks）が文章のまま（compiled=false）であること** は全件の gap として「施工条件は文章のまま。利用者の回答（true/false/不明）と根拠で確認する」と入れる（指示書 §3.2）。
- `projectMaterials`: `view.text(def.review.project)`、`detail.missing`、`duct.remaining`、`unresolved.check`、`auxiliary.missing` の空でないもの。
- `resumeCondition`: coverage ごとの定型文（例 DETAIL_SCHEDULE「明細（配筋表・部材表等）と根拠IDを入力し、案件で採用を確認したとき」）。

### 5. `src/app/takeoffModel.ts`（遅延読込の入口）

```ts
export function loadTakeoffMaster(): Promise<MasterView>        // import('../core/takeoff/master.data') を一度だけ。失敗したら次回やり直せる
export function loadRuleScopes(): Promise<TakeoffRuleScopes>    // import('../core/takeoff/ruleScopes.data') を一度だけ
```

- `src/app/relatedModel.ts` と同じ書き方（Promise を保持、catch で pending を捨てて再送出）。
- **起動時・PDF を開いたとき・描画のたびに読み込まない**（呼び出しは T4 の画面だけ）。

## 試験（vitest）

1. `tests/takeoff.master.test.ts`: 949定義・916ルール、ID 一意、`inputSchema` の再構成が master と整合（required = requiredKeys、allOf の数 = conditionalRequired の数）、`definitionsForRule('E-001')` が REL-001 を含む、`text` の番号解決、`scheduleSchema('REL-028')` の quantity_definition_id が const、競合 0 件。
2. `tests/takeoff.readiness.test.ts`:
   - 親（ROUTER の定義を1つ）: 入力欄を全部埋めても quantity は NOT_APPLICABLE、formalOutputAllowed=false（CC26-08）。
   - 記録（RECORD_ONLY の定義）: 同上。
   - 補助（補助量/照査の定義）: quantity が SATISFIED でも billing は NOT_APPLICABLE、formalOutputAllowed=false（CC26-09）。
   - 未確定（REL-039）: selected_method_id なし → INPUT_REQUIRED、元単位は `未確定` のまま（CC26-10）。
   - REL-001: 事実が空 → INPUT_REQUIRED で missing に必須キー、`uses_geometry=true` にすると geometry_id 等が missing に増える（条件付き必須）、`geometry_topology_verified=false` → falseFields、`scope_required` 未入力 → CONDITION_UNKNOWN（false にしない）、`scope_required=false` → CONDITION_FALSE。
   - 利用者の事実で `origin_match: true` を入れても使われない（SYSTEM_FACT_KEYS）。
   - 全部そろえた REL-001（試験用の事実を組み立てる）で quantity SATISFIED、billing の欄を全部埋めても approvedForProject=false なら formalOutputAllowed=false（CC26-17）、true で許可、stale=true で不許可（CC26-24 の判定側）。
   - `inclusion_state: 'included'` → billing CONDITION_FALSE、物理数量（quantity）は SATISFIED のまま（CC26-19）。
   - 外部検証器の結果が無い → UNSUPPORTED（OK 扱いしない）。
3. `tests/takeoff.validators.test.ts`: 7種の OK/FAILED/UNSUPPORTED。
4. `tests/takeoff.ledger.test.ts`: 949 行・各行1分類、役割の件数（数量候補842 等）と分類の整合（補助46は全部 AUXILIARY_ONLY、親31は PARENT_ONLY、記録10は RECORD_ONLY、未確定19は METHOD_SELECTION、工数1は LABOR、ダクト13は NEEDS_ADOPTED_BASIS、F_UNION の補助は AUXILIARY_ONLY のまま gap に記載）、EXECUTABLE＋DETAIL_SCHEDULE＋HATSURI＋NEEDS_ADOPTED_BASIS＋IMPLEMENTATION_PENDING＋MASTER_CONFLICT の合計が数量候補842 と一致、CSV の1行目が見出しで BOM 付き。
   - 環境変数 `TAKEOFF_LEDGER_OUT` があれば、その path に CSV を書き出す（`fs.writeFileSync`）。無ければ書かない。
5. `tests/takeoff.lazyLoad.test.ts`: `src/app/takeoffModel.ts` を2回呼んで同じ Promise／同じ view。

## 守ること

- 既存のファイル（T2a を含む）を変更しない。足りない関数は新しいファイルに書く。
- 生成データ（master.data.ts 等）を app の通常経路から静的 import しない（`takeoffModel.ts` の動的 import だけ）。試験からの静的 import はよい。
- 原本の auto_enable / export_enabled に相当する判断を勝手に true にしない。formalOutputAllowed は上の全条件。
