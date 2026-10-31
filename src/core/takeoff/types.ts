// 拾い範囲と関連数量のマスター（生成データ）の形。Claude が作成（2026-10-18）。
// 生成元: scripts/takeoff/build-master.mjs（引継ぎパックの抽出スナップショットから開発時に変換）。
// このファイルは生成データ master.data.json / ruleScopes.data.json との契約。実行時の判断・計算は別モジュール。
//
// 表示用の文は、2回以上出る長い文を texts へまとめてあるため `TextRef`（文字列又は texts の番号）になっている。
// 読むときは masterText(master, value) / ruleText(scopes, value) で文字列へ戻す。
// 条件・段階条件・必須キーの組は共有表（conditions / keysets）の番号で参照する。
// 原本の auto_enable / export_enabled はすべて false（変換時に照合済み）なので、データには持たない。

/** 文字列、又は texts の番号 */
export type TextRef = string | number

/** 実装用の役割（原本の排他的な5区分） */
export type ImplementationRole = '数量候補' | '親/確認記録' | '未確定方式' | '補助量/照査' | '工数'
export const IMPLEMENTATION_ROLES: readonly ImplementationRole[] = ['数量候補', '親/確認記録', '未確定方式', '補助量/照査', '工数']

/** 原本の計算契約上の実行状態 */
export type SourceExecutionState =
  | 'KERNEL_CANDIDATE' | 'NEEDS_DESIGN' | 'PARENT_BLOCKED' | 'PLAN_UNRESOLVED'
  | 'NEEDS_GEOMETRY' | 'RECORD_ONLY' | 'NEEDS_STANDARD_RULE'

/** 原本の数量の役割 */
export type SourceQuantityRole = 'QUANTITY_DEFINITION' | 'ROUTER' | 'PLAN_PENDING_UNIT' | 'RECORD_ONLY'

/** 原本の算出方式ID（数量算定24方式） */
export type FormulaId =
  | 'F_MANUAL' | 'F_SAME' | 'F_SUBSET' | 'F_UNIQUE' | 'F_COUNT' | 'F_FACTOR' | 'F_RECT' | 'F_ROUND'
  | 'F_WALL' | 'F_UP' | 'F_THICK' | 'F_TRENCH' | 'F_PIT' | 'F_BACK' | 'F_DIFF' | 'F_MASS' | 'F_TON'
  | 'F_UNION' | 'F_EDGE' | 'F_SURFACE' | 'F_DESIGN' | 'F_CHECK' | 'F_SAND' | 'F_DUCT_RECT_EST'

/** 明細形式ID（詳細数量の22形式） */
export type DetailFormatId =
  | 'REBAR' | 'STEEL' | 'CONCRETE' | 'ANCHOR' | 'SWITCH' | 'VENT' | 'GLASS' | 'FORM' | 'STEEL_PAINT'
  | 'FIRE' | 'JOINT' | 'BOLT' | 'WASTE_MASS' | 'OIL_BUND' | 'EARTH_HAUL' | 'EARTH_DISPOSE' | 'BEDDING'
  | 'LABOR' | 'DEMO' | 'GROUT' | 'STRIP' | 'COEFF'

/**
 * 条件式（原本の AST）。使われている演算子は eq / in / contains と all / predicate / if だけ（変換時に照合済み）。
 * 文字列の式は持たない。評価は型付きの評価器で行い、eval / Function は使わない。
 */
export type ConditionNode =
  | { field: string; op: 'eq'; value: unknown }
  | { field: string; op: 'in'; values?: readonly unknown[]; value?: readonly unknown[] }
  | { field: string; op: 'contains'; value: unknown }
  | { field: string; op: string; [key: string]: unknown } // 未知の演算子（評価器は UNSUPPORTED を返す）
  | { all: readonly ConditionNode[] }
  | { any: readonly ConditionNode[] }

/** 条件付き必須（JSON Schema の if/then と同じ意味） */
export interface ConditionalRequired {
  if: { field: string; op: string; value: unknown }
  required: readonly string[]
  require_values?: Readonly<Record<string, unknown>>
}

/** 範囲の再検証などで適用した訂正・追加（元値と由来を履歴として残す） */
export interface MasterPatch {
  property: string
  from?: string
  to?: string
  added?: readonly string[]
  cell: string
}

export interface MasterDefinitionScope {
  /** 実際に拾う対象・場所 */
  target: TextRef
  /** 面・線・位置の種類 */
  kind: TextRef
  /** 拾う範囲・分け方 */
  split: TextRef
  /** 含めない場所・取り違え注意 */
  exclude: TextRef
  /** 関連元と異なる点・拾い直し */
  difference: TextRef
  /** 関連元の項目 */
  origin: TextRef
  /** 範囲の分類（名称） */
  className: TextRef
  /** 範囲の分類ID（拾い範囲47分類） */
  classId: string
  /** 確定に必要な確認 */
  confirm: TextRef
  /** 元定義の除外（保持） */
  keptExclude: TextRef
}

export interface MasterDefinitionReview {
  /** 再検証の状態 */
  status: TextRef
  /** 範囲を決めるときに確認すること */
  checks: TextRef
  /** 取り違え・誤用 */
  mistakes: TextRef
  /** 案件で確定すること */
  project: TextRef
  /** 拾う場所の説明 */
  place: TextRef
}

/**
 * 段階条件。値が number のものは conditions の番号（object / array）。
 * 通常の定義: proposal / quantity（required・conditional_required を除いた残り）/ billing。
 * 親（31）: router_only / children（子定義IDの配列）/ parent_quantity_enabled。
 * 記録（10）: record_only / required（必須キーの配列）/ quantity_enabled / billing_enabled。
 */
export interface MasterStages {
  proposal?: number
  quantity?: number
  /** 数量段階の条件付き必須が定義の条件付き必須と異なる場合だけ（conditions の番号） */
  quantityConditionalRequired?: number
  /** 数量段階の必須キーが定義の必須キーの部分集合でない場合だけ（keysets の番号） */
  quantityRequired?: number
  billing?: number
  router_only?: boolean
  children?: number
  parent_quantity_enabled?: boolean
  record_only?: boolean
  required?: number
  quantity_enabled?: boolean
  billing_enabled?: boolean
}

/** 数量段階の条件（conditions[stages.quantity] の中身） */
export interface MasterQuantityStage {
  predicate?: ConditionNode
  external_validators?: readonly string[]
  schema_review_required?: boolean
}

/** 課金段階の条件（conditions[stages.billing] の中身） */
export interface MasterBillingStage {
  requires_quantity_valid?: boolean
  required?: readonly string[]
  predicate?: ConditionNode
  cost_role_allowed?: boolean
}

export interface MasterDetail {
  format: DetailFormatId
  scope: TextRef
  recordFields: readonly string[]
  method: TextRef
  split: TextRef
  exclude: TextRef
  missing: TextRef
  unit: string
  /** 定義別の明細 schema = 形式の schema の properties をこれで上書きしたもの */
  scheduleOverrides: Readonly<Record<string, unknown>>
  row: number
  id: string
}

export interface MasterUnresolved {
  category: string
  /** 案件条件で選べる方式（unitMethods の ID） */
  methods: readonly string[]
  /** 包含照合の参照専用の方式（選べない） */
  referenceMethods?: readonly string[]
  /** 候補単位（合計不可） */
  units: readonly string[]
  target: TextRef
  exclusivity: TextRef
  check: TextRef
  auxiliary: readonly string[]
  dedupe: TextRef
  row: number
}

export interface MasterAuxiliary {
  category: TextRef
  scope: TextRef
  method: TextRef
  inputs: readonly string[]
  use: TextRef
  difference: TextRef
  target: TextRef
  referCondition: TextRef
  forbidden: TextRef
  dedupe: TextRef
  missing: TextRef
  row: number
}

export interface MasterDuct {
  profile: TextRef
  meaning: TextRef
  unit: string
  scope: TextRef
  rules: TextRef
  structure: TextRef
  inputs: readonly string[]
  split: TextRef
  caution: TextRef
  remaining: TextRef
  row: number
}

export interface MasterDefinition {
  id: string
  trade: '建築' | '電気設備' | '機械設備' | '共通'
  label: string
  /** 元単位。'' / '—' / '未確定' もそのまま保持（勝手に変えない） */
  unit: string
  role: ImplementationRole
  state: SourceExecutionState
  quantityRole: SourceQuantityRole
  formula: FormulaId
  /** 入力形状（原本の body 入力契約の説明。値は説明文） */
  shape: Readonly<Record<string, string>>
  scopeText: TextRef
  /** 品目ID案（KRI-…。正式単価コードではない） */
  item: string
  /** 既存の関連ルール（rules.ts の id）。4表で一致したものだけ */
  rules: readonly string[]
  scope: MasterDefinitionScope
  review: MasterDefinitionReview
  /** keysets の番号（数量段階の必須キー） */
  requiredKeys: number
  /** conditions の番号（ConditionalRequired[]）。無いときは undefined */
  conditionalRequired?: number
  /** conditions の番号（定義固有の条件 AST）。無いときは undefined */
  conditionAst?: number
  stages: MasterStages
  /** keysets の番号（入力型スキーマの properties のキー） */
  schemaKeys: number
  /** 入力型スキーマで共通の型表と異なるプロパティ */
  schemaOverrides?: Readonly<Record<string, unknown>>
  /** 定義固有の施工条件（原文。compiled はすべて false = 型付き事実への分解待ち） */
  checks: readonly { id: string; text: TextRef; effect: string }[]
  continuation: {
    /** CONFIRM_THEN_REEVALUATE / STOP_IDENTITY_MAPPING / STOP_AUXILIARY / STOP_ROUTER / STOP_PLAN / STOP_RECORD */
    policy: string
    reason: TextRef
    /** 確認後に一段だけ再評価する既存ルール */
    nextRules: readonly string[]
    catalogKeyCount: number
  }
  reverse: {
    status: string
    rootRules: readonly string[]
    candidateRules: readonly string[]
    contextRules: readonly string[]
    children: readonly string[]
  }
  price: { family: TextRef; gate: TextRef; allocationRequired: boolean }
  policies: { auxiliary?: true; unitMethod?: true; detail?: true }
  detail?: MasterDetail
  unresolved?: MasterUnresolved
  auxiliary?: MasterAuxiliary
  duct?: MasterDuct
  /** 貫通口はつりの方式（hatsuriModes の ID） */
  hatsuri?: readonly string[]
  /** 整理後163対応（関係照会の条件プロファイルと、旧一律必須から除いたキー） */
  ac41?: { profile: string; classification: string; removedKeys: readonly string[] }
  patches?: readonly MasterPatch[]
  /** 原本の行番号（数量算定949対応・定義949行_必須入力・949定義の再検証・単価分担949照合・拾う対象949定義） */
  source: { calculation: number; inputs: number; review: number; price: number; scope: number }
}

export interface MasterFormula {
  id: FormulaId
  name: string
  expression: string
  inputs: string
  caution: string
  /** 原本の参照実装の状態（数値参照カーネル / 停止/記録専用） */
  sourceState: string
  /** body 入力契約（説明文の JSON） */
  contract: Readonly<Record<string, unknown>> | null
}

export interface MasterDetailTemplate {
  id: DetailFormatId
  name: string
  units: readonly string[]
  method: string
  recordFields: readonly string[]
  split: string
  exclude: string
  missing: string
  /** 明細の JSON Schema（形式の共通形。定義別は MasterDetail.scheduleOverrides で上書き） */
  schema: Readonly<Record<string, unknown>> | null
  evidence: readonly string[]
  definitionCount: number
}

export interface MasterUnitMethod {
  id: string
  name: string
  unit: string
  scope: string
  calculation: string
  requiredInputs: readonly string[]
  condition: string
  inclusion: string
  evidenceKind: string
  use: string
}

export interface MasterKeyLabel {
  type: string
  use: string
  meaning: string
  /** システム照合結果（利用者が true を直接入力しない） */
  system: boolean
  /** 辞書に無く、追加元のシートから説明を付けたもの */
  derived?: true
}

export interface MasterScopeProfile {
  name: string
  target: string
  kind: string
  confirm: string
  exclude: string
  howTo: string
  basis: string
}

export interface MasterScopeOption {
  classId: string
  id: string
  condition: string
  range: string
  kind: string
  unit: string
  locate: string
  exclude: string
  source: string
}

export interface MasterConflict {
  definitionId: string
  property: string
  reason: string
  cells: readonly string[]
}

export interface TakeoffMaster {
  format: 'karu-takeoff-master-1'
  masterVersion: string
  sourceSha256: string
  sourceLibraryVersion: number
  counts: {
    definitions: number
    rules: number
    executionStates: Readonly<Record<string, number>>
    implementationRoles: Readonly<Record<string, number>>
  }
  keyNames: readonly string[]
  /** keyNames の番号の配列 */
  keysets: readonly (readonly number[])[]
  conditions: readonly unknown[]
  texts: readonly string[]
  /** 入力型スキーマの共通の型表（キー → JSON Schema） */
  propertyTypes: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  keyLabels: Readonly<Record<string, MasterKeyLabel>>
  formulas: Readonly<Record<string, MasterFormula>>
  detailTemplates: Readonly<Record<string, MasterDetailTemplate>>
  unitMethods: Readonly<Record<string, MasterUnitMethod>>
  ductRules: readonly { id: string; target: string; rule: string; data: string; stop: string; status: string }[]
  hatsuriModes: readonly {
    id: string; definitionId: string; childId: string; name: string; unit: string; formula: string
    scope: string; method: string; requiredInputs: readonly string[]; condition: string; forbidden: string
  }[]
  hatsuriInputs: readonly { key: string; meaning: string; type: string; missing: string }[]
  reverseRules: readonly {
    id: string; name: string; originKind: string; targetKind: string; relation: string; operation: string; scope: string
  }[]
  basisRegistry: readonly { id: string; name: string; publisher: string; version: string; role: string; scope: string }[]
  projectSettings: readonly { key: string; meaning: string; howTo: string }[]
  definitions: readonly MasterDefinition[]
  /** 変換時に解けなかった競合（MASTER_CONFLICT）。該当の定義・プロパティは実行しない */
  conflicts: readonly MasterConflict[]
}

/** 既存ルール（rules.ts の id）ごとの拾う対象。候補カードで使う軽いデータ */
export interface RuleScope {
  /** 工事項目 / 確認事項 / 注意事項 */
  use: string
  /** 単位・扱い（例: ㎡（基準照合）/ 方式選択後に確認） */
  unit: TextRef
  /** 関連元の拾い範囲 */
  originScope: TextRef
  /** 関連先で拾う対象・場所 */
  target: TextRef
  /** 面・線・位置の種類 */
  kind: TextRef
  /** 拾う範囲・分け方 */
  split: TextRef
  /** 含めない場所・取り違え注意 */
  exclude: TextRef
  /** 関連元と異なる点・拾い直し */
  difference: TextRef
  /** 範囲の分類（名称） */
  className: TextRef
  /** 範囲の分類ID */
  classId: string
  /** 対応する数量定義ID（949定義） */
  definitions: readonly string[]
}

export interface TakeoffRuleScopes {
  format: 'karu-takeoff-rule-scopes-1'
  masterVersion: string
  sourceSha256: string
  texts: readonly string[]
  scopeProfiles: Readonly<Record<string, MasterScopeProfile>>
  /** 墨出し等の範囲分岐（条件別に数量を求める範囲を選ぶ） */
  scopeOptions: readonly MasterScopeOption[]
  rules: Readonly<Record<string, RuleScope>>
  /** 949定義の見出し（候補カードで本体を読まずに出す） */
  definitionHeads: Readonly<Record<string, { label: string; unit: string; role: ImplementationRole; classId: string }>>
}
