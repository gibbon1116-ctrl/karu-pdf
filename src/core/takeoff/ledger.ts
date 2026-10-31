import {
  FORMULA_CAPABILITIES,
  METHOD_CAPABILITIES,
  SCHEDULE_CAPABILITIES,
  type Capability,
  type CapabilityStatus,
} from './capabilities'
import type { MasterView } from './master'
import type {
  FormulaId,
  ImplementationRole,
  MasterDefinition,
  SourceExecutionState,
} from './types'

export type CoverageClass =
  | 'EXECUTABLE'
  | 'DETAIL_SCHEDULE'
  | 'METHOD_SELECTION'
  | 'HATSURI_METHOD'
  | 'NEEDS_ADOPTED_BASIS'
  | 'AUXILIARY_ONLY'
  | 'PARENT_ONLY'
  | 'RECORD_ONLY'
  | 'LABOR'
  | 'IMPLEMENTATION_PENDING'
  | 'MASTER_CONFLICT'

export interface LedgerRow {
  definitionId: string
  trade: string
  label: string
  unit: string
  role: ImplementationRole
  sourceState: SourceExecutionState
  formula: FormulaId
  coverage: CoverageClass
  runtimePath:
    | 'formula'
    | 'schedule'
    | 'method'
    | 'hatsuri'
    | 'duct'
    | 'router'
    | 'record'
    | 'none'
  capability: CapabilityStatus | 'N/A'
  implementationGaps: string[]
  projectMaterials: string[]
  resumeCondition: string
  rules: readonly string[]
  sourceCells: string
}

interface RuntimeSupport {
  path: LedgerRow['runtimePath']
  capability: LedgerRow['capability']
  gaps: string[]
}

interface NamedCapability {
  name: string
  capability: Capability | undefined
}

const RESUME_CONDITIONS: Readonly<Record<CoverageClass, string>> = {
  EXECUTABLE:
    '必須入力・範囲・施工条件・根拠IDを確認し、案件で採用を確認したとき',
  DETAIL_SCHEDULE:
    '明細（配筋表・部材表等）と根拠IDを入力し、案件で採用を確認したとき',
  METHOD_SELECTION:
    '案件の方式・単位を選択し、その方式の入力と包含関係を確認したとき',
  HATSURI_METHOD:
    'か所・体積・施工なしの方式を選び、対象と施工根拠を確認したとき',
  NEEDS_ADOPTED_BASIS:
    '採用する積算基準・版・適用範囲とダクト明細を確認したとき',
  AUXILIARY_ONLY:
    '補助量の対象・入力・根拠を確認したとき。正式物量への転記は行わない',
  PARENT_ONLY:
    '子の定義を選び、その子の範囲と数量条件を確認したとき',
  RECORD_ONLY:
    '判断・理由・確認者・根拠を記録したとき。数量は生成しない',
  LABOR:
    '工数表・作業条件・根拠を確認し、物量と分けて集計するとき',
  IMPLEMENTATION_PENDING:
    '未実装の方式・形式を実装し、関連試験に合格した後に案件入力を確認したとき',
  MASTER_CONFLICT:
    '原本とセルを照合してマスターの競合を解消したとき',
}

function aggregateCapabilities(
  path: RuntimeSupport['path'],
  entries: readonly NamedCapability[],
): RuntimeSupport {
  const gaps: string[] = []

  for (const entry of entries) {
    if (!entry.capability) {
      gaps.push(`${entry.name}: 能力表に登録されていません。`)
    } else if (entry.capability.status !== 'IMPLEMENTED') {
      gaps.push(
        `${entry.name}: ${entry.capability.note || entry.capability.status}`,
      )
    }
  }

  const capability: LedgerRow['capability'] =
    entries.some(entry => entry.capability?.status === 'IMPLEMENTED')
      ? 'IMPLEMENTED'
      : entries.length > 0
        && entries.every(entry => entry.capability?.status === 'NO_QUANTITY')
        ? 'NO_QUANTITY'
        : 'UNSUPPORTED'

  return { path, capability, gaps }
}

function runtimeSupport(definition: MasterDefinition): RuntimeSupport {
  if (definition.quantityRole === 'ROUTER') {
    return { path: 'router', capability: 'N/A', gaps: [] }
  }

  if (definition.quantityRole === 'RECORD_ONLY') {
    return { path: 'record', capability: 'NO_QUANTITY', gaps: [] }
  }

  if (definition.role === '未確定方式') {
    return aggregateCapabilities(
      'method',
      (definition.unresolved?.methods ?? []).map(id => ({
        name: id,
        capability: Object.prototype.hasOwnProperty.call(METHOD_CAPABILITIES, id)
          ? METHOD_CAPABILITIES[id]
          : undefined,
      })),
    )
  }

  if (definition.hatsuri !== undefined) {
    return aggregateCapabilities('hatsuri', [
      { name: 'F_COUNT', capability: FORMULA_CAPABILITIES.F_COUNT },
      {
        name: 'HATSURI_VOL',
        capability: SCHEDULE_CAPABILITIES.HATSURI_VOL,
      },
    ])
  }

  if (definition.duct) {
    return aggregateCapabilities('duct', [
      { name: 'DUCT', capability: SCHEDULE_CAPABILITIES.DUCT },
    ])
  }

  if (definition.detail) {
    return aggregateCapabilities('schedule', [{
      name: definition.detail.format,
      capability: SCHEDULE_CAPABILITIES[definition.detail.format],
    }])
  }

  const support = aggregateCapabilities('formula', [{
    name: definition.formula,
    capability: FORMULA_CAPABILITIES[definition.formula],
  }])

  if (definition.formula === 'F_UNION') {
    support.gaps.push('対象面の和集合の幾何の計算・検証が未実装です。')
  }

  return support
}

function classify(
  definition: MasterDefinition,
  conflict: boolean,
  support: RuntimeSupport,
): CoverageClass {
  if (conflict) return 'MASTER_CONFLICT'
  if (definition.quantityRole === 'ROUTER') return 'PARENT_ONLY'
  if (definition.quantityRole === 'RECORD_ONLY') return 'RECORD_ONLY'
  if (definition.role === '工数') return 'LABOR'
  if (definition.role === '補助量/照査') return 'AUXILIARY_ONLY'
  if (definition.role === '未確定方式') return 'METHOD_SELECTION'
  if (definition.hatsuri !== undefined) return 'HATSURI_METHOD'
  if (definition.duct) return 'NEEDS_ADOPTED_BASIS'
  if (definition.detail) {
    return support.capability === 'IMPLEMENTED'
      ? 'DETAIL_SCHEDULE'
      : 'IMPLEMENTATION_PENDING'
  }
  return support.capability === 'IMPLEMENTED'
    ? 'EXECUTABLE'
    : 'IMPLEMENTATION_PENDING'
}

export function buildCoverageLedger(view: MasterView): LedgerRow[] {
  return view.master.definitions.map(definition => {
    const conflicts = view.conflicts(definition.id)
    const support = runtimeSupport(definition)
    const coverage = classify(definition, conflicts.length > 0, support)

    const implementationGaps = [
      ...support.gaps,
      '施工条件は文章のまま。利用者の回答（true/false/不明）と根拠で確認する',
      ...conflicts.map(conflict =>
        `MASTER_CONFLICT: ${conflict.property}: ${conflict.reason}`
        + `（${conflict.cells.join('、')}）`,
      ),
    ]

    const projectMaterials = [
      view.text(definition.review.project),
      view.text(definition.detail?.missing),
      view.text(definition.duct?.remaining),
      view.text(definition.unresolved?.check),
      view.text(definition.auxiliary?.missing),
    ].filter(text => text.trim() !== '')

    const source = definition.source

    return {
      definitionId: definition.id,
      trade: definition.trade,
      label: definition.label,
      unit: definition.unit,
      role: definition.role,
      sourceState: definition.state,
      formula: definition.formula,
      coverage,
      runtimePath: conflicts.length > 0 ? 'none' : support.path,
      capability: conflicts.length > 0 ? 'N/A' : support.capability,
      implementationGaps: [...new Set(implementationGaps)],
      projectMaterials: [...new Set(projectMaterials)],
      resumeCondition: RESUME_CONDITIONS[coverage],
      rules: definition.rules,
      sourceCells: [
        `数量算定949対応!${source.calculation}`,
        `定義949行_必須入力!${source.inputs}`,
        `949定義の再検証!${source.review}`,
        `単価分担949照合!${source.price}`,
        `拾う対象949定義!${source.scope}`,
      ].join(' / '),
    }
  })
}

export function ledgerSummary(
  rows: readonly LedgerRow[],
): Record<CoverageClass, number> {
  const summary: Record<CoverageClass, number> = {
    EXECUTABLE: 0,
    DETAIL_SCHEDULE: 0,
    METHOD_SELECTION: 0,
    HATSURI_METHOD: 0,
    NEEDS_ADOPTED_BASIS: 0,
    AUXILIARY_ONLY: 0,
    PARENT_ONLY: 0,
    RECORD_ONLY: 0,
    LABOR: 0,
    IMPLEMENTATION_PENDING: 0,
    MASTER_CONFLICT: 0,
  }

  for (const row of rows) summary[row.coverage] += 1
  return summary
}

const CSV_COLUMNS: readonly (keyof LedgerRow)[] = [
  'definitionId',
  'trade',
  'label',
  'unit',
  'role',
  'sourceState',
  'formula',
  'coverage',
  'runtimePath',
  'capability',
  'implementationGaps',
  'projectMaterials',
  'resumeCondition',
  'rules',
  'sourceCells',
]

function csvField(value: unknown): string {
  const text = Array.isArray(value)
    ? value.map(String).join(' / ')
    : String(value ?? '')

  // フィールド内の改行も CRLF に統一する。
  const normalized = text.replace(/\r\n|\r|\n/g, '\r\n')
  return `"${normalized.replace(/"/g, '""')}"`
}

export function ledgerToCsv(rows: readonly LedgerRow[]): string {
  const lines = [
    CSV_COLUMNS.map(csvField).join(','),
    ...rows.map(row =>
      CSV_COLUMNS.map(column => csvField(row[column])).join(','),
    ),
  ]
  return `\uFEFF${lines.join('\r\n')}\r\n`
}
