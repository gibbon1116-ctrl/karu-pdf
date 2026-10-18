import { describe, expect, it } from 'vitest'
import master from '../src/core/takeoff/master.data'
import { isRecord } from '../src/core/takeoff/calcTypes'
import { evaluateCondition } from '../src/core/takeoff/conditions'
import { createMasterView } from '../src/core/takeoff/master'
import {
  droppedUserSystemKeys,
  evaluateReadiness,
  mergeFacts,
  SYSTEM_FACT_KEYS,
  type Facts,
  type Readiness,
  type ReadinessInput,
  type ValidatorResult,
} from '../src/core/takeoff/readiness'
import type { MasterDefinition } from '../src/core/takeoff/types'

const view = createMasterView(master)
const systemKeys = new Set(SYSTEM_FACT_KEYS)

function definition(id: string): MasterDefinition {
  const found = view.definition(id)
  if (!found) throw new Error(`定義がありません: ${id}`)
  return found
}

function findDefinition(
  predicate: (value: MasterDefinition) => boolean,
): MasterDefinition {
  const found = master.definitions.find(predicate)
  if (!found) throw new Error('試験対象の定義がありません。')
  return found
}

function sampleValue(schema: unknown, key: string): unknown {
  if (!isRecord(schema)) return `test:${key}`

  if (Object.prototype.hasOwnProperty.call(schema, 'const')) {
    return schema.const
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    if (key === 'measurement_input_mode'
      && schema.enum.includes('manual_schedule')) {
      return 'manual_schedule'
    }
    return schema.enum[0]
  }

  const type = Array.isArray(schema.type)
    ? schema.type.find(value => value !== 'null')
    : schema.type

  if (type === 'boolean') return true
  if (type === 'number' || type === 'integer') {
    const minimum = typeof schema.minimum === 'number' ? schema.minimum : 0
    const exclusive = typeof schema.exclusiveMinimum === 'number'
      ? schema.exclusiveMinimum + 1
      : minimum
    return Math.max(1, Math.ceil(minimum), Math.ceil(exclusive))
  }
  if (type === 'array') {
    const count = typeof schema.minItems === 'number'
      ? Math.max(1, schema.minItems)
      : 1
    return Array.from({ length: count }, (_, index) =>
      sampleValue(schema.items, `${key}:${index}`),
    )
  }
  if (type === 'object' || isRecord(schema.properties)) {
    const properties = isRecord(schema.properties) ? schema.properties : {}
    const required = Array.isArray(schema.required)
      ? schema.required.filter((value): value is string =>
          typeof value === 'string',
        )
      : Object.keys(properties)

    return Object.fromEntries(required.map(name => [
      name,
      sampleValue(properties[name], `${key}:${name}`),
    ]))
  }

  const minimum = typeof schema.minLength === 'number' ? schema.minLength : 1
  return `test:${key}`.padEnd(minimum, 'x')
}

function satisfyPredicate(
  node: unknown,
  facts: Record<string, unknown>,
): void {
  if (!isRecord(node)) return

  if (Array.isArray(node.all)) {
    node.all.forEach(child => satisfyPredicate(child, facts))
    return
  }
  if (Array.isArray(node.any)) {
    satisfyPredicate(node.any[0], facts)
    return
  }
  if (typeof node.field !== 'string') return

  if (node.op === 'eq') {
    facts[node.field] = node.value
  } else if (node.op === 'in') {
    const values = node.values ?? node.value
    if (Array.isArray(values)) facts[node.field] = values[0]
  } else if (node.op === 'contains') {
    const previous = facts[node.field]
    facts[node.field] = Array.isArray(previous)
      ? [...new Set([...previous, node.value])]
      : [node.value]
  }
}

function factsFor(entry: MasterDefinition): {
  systemFacts: Record<string, unknown>
  userFacts: Record<string, unknown>
} {
  const facts: Record<string, unknown> = {}
  const schemaFor = (key: string): unknown =>
    entry.schemaOverrides?.[key] ?? master.propertyTypes[key]

  const fill = (keys: readonly string[]): void => {
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(facts, key)) {
        facts[key] = sampleValue(schemaFor(key), key)
      }
    }
  }

  // 必須キーは番号を決め打ちせず、マスターから取得する。
  fill(view.requiredKeys(entry))
  if (entry.stages.quantityRequired !== undefined) {
    fill(view.keys(entry.stages.quantityRequired))
  }
  fill(view.billingStage(entry)?.required ?? [])
  fill(view.condition<readonly string[]>(entry.stages.required) ?? [])

  for (const key of SYSTEM_FACT_KEYS) facts[key] = true

  for (const key of [
    'uses_geometry',
    'uses_source_quantity',
    'has_openings',
    'uses_coefficient',
    'has_shared_roles',
  ]) {
    const schema = schemaFor(key)
    if (!(isRecord(schema) && schema.const === true)) facts[key] = false
  }

  satisfyPredicate(view.condition(entry.stages.proposal), facts)
  satisfyPredicate(view.quantityStage(entry)?.predicate, facts)
  satisfyPredicate(view.condition(entry.conditionAst), facts)
  satisfyPredicate(view.billingStage(entry)?.predicate, facts)

  const clauses = view.conditionalRequired(entry)
  for (let pass = 0; pass <= clauses.length; pass += 1) {
    for (const clause of clauses) {
      if (evaluateCondition(clause.if, facts).truth !== 'true') continue
      fill(clause.required)
      Object.assign(facts, clause.require_values ?? {})
    }
  }

  return {
    systemFacts: Object.fromEntries(
      Object.entries(facts).filter(([key]) => systemKeys.has(key)),
    ),
    userFacts: Object.fromEntries(
      Object.entries(facts).filter(([key]) => !systemKeys.has(key)),
    ),
  }
}

function validatorsFor(entry: MasterDefinition): ValidatorResult[] {
  return (view.quantityStage(entry)?.external_validators ?? []).map(name => ({
    name,
    status: 'OK',
    message: '段階判定の試験用検証結果',
  }))
}

function run(
  entry: MasterDefinition,
  overrides: Partial<ReadinessInput> = {},
): Readiness {
  return evaluateReadiness({
    view,
    definitionId: entry.id,
    ...factsFor(entry),
    validators: validatorsFor(entry),
    approvedForProject: false,
    stale: false,
    ...overrides,
  })
}

describe('takeoff readiness', () => {
  it('SYSTEM_FACT_KEYSはマスターのsystem:trueの10キーと一致する', () => {
    expect(SYSTEM_FACT_KEYS).toHaveLength(10)
    expect([...SYSTEM_FACT_KEYS].sort()).toEqual(
      Object.entries(master.keyLabels)
        .filter(([, label]) => label.system)
        .map(([key]) => key)
        .sort(),
    )
  })

  it('利用者のシステム事実を捨て、systemFactsを優先する', () => {
    const user: Facts = {
      origin_match: true,
      source_active: true,
      scope_verified: false,
      zero: 0,
    }
    const merged = mergeFacts({ source_active: false }, user)

    expect(merged).not.toHaveProperty('origin_match')
    expect(merged.source_active).toBe(false)
    expect(merged.scope_verified).toBe(false)
    expect(merged.zero).toBe(0)
    expect(droppedUserSystemKeys(user)).toEqual([
      'origin_match',
      'source_active',
    ])

    const entry = definition('REL-001')
    const facts = factsFor(entry)
    delete facts.systemFacts.origin_match
    facts.userFacts.origin_match = true

    const evaluated = run(entry, facts)
    expect(evaluated.proposal.status).toBe('CONDITION_UNKNOWN')
    expect(evaluated.proposal.unknownFields).toContain('origin_match')
  })

  it('親は全入力を満たしても数量を生成しない（CC26-08）', () => {
    const entry = findDefinition(value => value.quantityRole === 'ROUTER')
    const evaluated = run(entry, { approvedForProject: true })

    expect(evaluated.proposal.status).toBe('SATISFIED')
    expect(evaluated.quantity.status).toBe('NOT_APPLICABLE')
    expect(evaluated.quantity.reasons.join('')).toContain('子の定義')
    expect(evaluated.formalOutputAllowed).toBe(false)
  })

  it('記録は全入力を満たしても数量を生成せず、不足も表示する', () => {
    const entry = findDefinition(value => value.quantityRole === 'RECORD_ONLY')
    const evaluated = run(entry, { approvedForProject: true })

    expect(evaluated.quantity.status).toBe('NOT_APPLICABLE')
    expect(evaluated.quantity.missing).toEqual([])
    expect(evaluated.formalOutputAllowed).toBe(false)

    const required = view.condition<readonly string[]>(entry.stages.required)
    if (!required?.length) throw new Error('記録の必須キーがありません。')

    const empty = run(entry, { systemFacts: {}, userFacts: {} })
    expect(empty.quantity.status).toBe('NOT_APPLICABLE')
    expect(empty.quantity.missing).toEqual(required)
  })

  it('補助量は数量成立後も正式物量へ転記しない（CC26-09）', () => {
    const entry = definition('REL-055')
    const evaluated = run(entry, { approvedForProject: true })

    expect(evaluated.quantity.status).toBe('SATISFIED')
    expect(evaluated.billing.status).toBe('NOT_APPLICABLE')
    expect(evaluated.billing.reasons.join('')).toContain('補助量')
    expect(evaluated.formalOutputAllowed).toBe(false)
  })

  it('未確定方式は選択まで停止し、元単位を保持する（CC26-10）', () => {
    const entry = definition('REL-039')
    const facts = factsFor(entry)
    delete facts.userFacts.selected_method_id

    const evaluated = run(entry, {
      ...facts,
      validators: [],
    })

    expect(evaluated.quantity.status).toBe('INPUT_REQUIRED')
    expect(evaluated.quantity.missing[0]).toBe('selected_method_id')
    expect(evaluated.quantity.reasons.join('')).toContain('元単位: 未確定')
    expect(entry.unit).toBe('未確定')
    expect(evaluated.formalOutputAllowed).toBe(false)
  })

  it('空の事実は必須入力を要求し、0やfalseへ置換しない', () => {
    const entry = definition('REL-001')
    const evaluated = run(entry, { systemFacts: {}, userFacts: {} })

    expect(evaluated.quantity.status).toBe('INPUT_REQUIRED')
    expect(evaluated.quantity.missing).toEqual(view.requiredKeys(entry))
    expect(evaluated.quantity.unknownFields).toContain('scope_required')
    expect(evaluated.quantity.falseFields).not.toContain('scope_required')
  })

  it('geometry使用時だけ条件付き必須が増える', () => {
    const entry = definition('REL-001')
    const baseline = run(entry, { systemFacts: {}, userFacts: {} })
    const geometry = run(entry, {
      systemFacts: {},
      userFacts: { uses_geometry: true },
    })

    expect(geometry.quantity.missing).toEqual(expect.arrayContaining([
      'geometry_id',
      'drawing_page_id',
      'drawing_revision',
      'coordinate_frame_id',
      'scale_m_per_pdf_unit',
      'scale_evidence_id',
      'geometry_topology_verified',
    ]))
    expect(geometry.quantity.missing.length).toBeGreaterThan(
      baseline.quantity.missing.length,
    )
    expect(new Set(geometry.quantity.missing).size).toBe(
      geometry.quantity.missing.length,
    )

    const facts = factsFor(entry)
    facts.userFacts.uses_geometry = true
    facts.systemFacts.geometry_topology_verified = false
    const evaluated = run(entry, facts)
    expect(evaluated.quantity.falseFields).toContain('geometry_topology_verified')
  })

  it('未確認の述語とfalseの述語を区別する', () => {
    const entry = definition('REL-001')
    const facts = factsFor(entry)
    delete facts.userFacts.scope_required
    delete facts.systemFacts.scope_required

    const unknown = run(entry, facts)
    expect(unknown.quantity.unknownFields).toContain('scope_required')
    expect(unknown.quantity.falseFields).not.toContain('scope_required')

    // 必須入力の不足は、述語のunknownより優先する。
    expect(unknown.quantity.status).toBe(
      view.requiredKeys(entry).includes('scope_required')
        ? 'INPUT_REQUIRED'
        : 'CONDITION_UNKNOWN',
    )

    facts.userFacts.scope_required = false
    const denied = run(entry, facts)
    expect(denied.quantity.status).toBe('CONDITION_FALSE')
    expect(denied.quantity.falseFields).toContain('scope_required')
    expect(denied.quantity.missing).not.toContain('scope_required')
  })

  it('全入力があっても案件採用と版の確認を要求する（CC26-17/24）', () => {
    const entry = definition('REL-001')
    const pending = run(entry)

    expect(pending.proposal.status).toBe('SATISFIED')
    expect(pending.quantity.status).toBe('SATISFIED')
    expect(pending.billing.status).toBe('SATISFIED')
    expect(pending.formalOutputAllowed).toBe(false)
    expect(pending.formalOutputBlockers.join('')).toContain('REVIEW_PENDING')

    const approved = run(entry, { approvedForProject: true })
    expect(approved.formalOutputAllowed).toBe(true)
    expect(approved.formalOutputBlockers).toEqual([])

    const stale = run(entry, { approvedForProject: true, stale: true })
    expect(stale.formalOutputAllowed).toBe(false)
    expect(stale.formalOutputBlockers.join('')).toContain('STALE')
  })

  it('単価包含では物理数量を保持し、別計上を止める（CC26-19）', () => {
    const entry = definition('REL-001')
    const facts = factsFor(entry)
    facts.userFacts.inclusion_state = 'included'

    const evaluated = run(entry, { ...facts, approvedForProject: true })

    expect(evaluated.quantity.status).toBe('SATISFIED')
    expect(evaluated.billing.status).toBe('CONDITION_FALSE')
    expect(evaluated.billing.falseFields).toContain('inclusion_state')
    expect(evaluated.billing.reasons.join('')).toContain('物理数量は保持')
    expect(evaluated.formalOutputAllowed).toBe(false)
  })

  it('外部検証結果なし・未対応・失敗をOK扱いしない', () => {
    const entry = definition('REL-001')

    const absent = run(entry, { validators: [] })
    expect(absent.quantity.status).toBe('UNSUPPORTED')
    expect(absent.quantity.unsupported.length).toBeGreaterThan(0)

    const validators = validatorsFor(entry)
    if (!validators[0]) throw new Error('外部検証器がありません。')

    validators[0] = {
      ...validators[0],
      status: 'UNSUPPORTED',
      message: '未対応の試験',
    }
    expect(run(entry, { validators }).quantity.status).toBe('UNSUPPORTED')

    validators[0] = {
      ...validators[0],
      status: 'FAILED',
      message: '案件入力の不足',
    }
    const failed = run(entry, { validators })
    expect(failed.quantity.status).toBe('INPUT_REQUIRED')
    expect(failed.quantity.reasons.join('')).toContain('案件入力の不足')
  })

  it('未対応の条件演算子は数量成立にしない', () => {
    const entry = definition('REL-001')
    const customEntry: MasterDefinition = {
      ...entry,
      conditionAst: master.conditions.length,
    }
    const custom = createMasterView({
      ...master,
      definitions: [customEntry],
      conditions: [
        ...master.conditions,
        { field: 'scope_required', op: 'future_operator', value: true },
      ],
    })

    const evaluated = run(entry, { view: custom })
    expect(evaluated.quantity.status).toBe('UNSUPPORTED')
    expect(evaluated.quantity.unsupported.join('')).toContain('future_operator')
  })

  it('競合は3段階ともBLOCKEDにし、プロパティとセルを表示する', () => {
    const entry = definition('REL-001')
    const custom = createMasterView({
      ...master,
      conflicts: [{
        definitionId: entry.id,
        property: 'unit',
        reason: '原本間で不一致',
        cells: ['数量算定949対応!6'],
      }],
    })

    const evaluated = run(entry, {
      view: custom,
      approvedForProject: true,
    })

    for (const stage of [
      evaluated.proposal,
      evaluated.quantity,
      evaluated.billing,
    ]) {
      expect(stage.status).toBe('BLOCKED')
      expect(stage.reasons.join('')).toContain('MASTER_CONFLICT')
      expect(stage.reasons.join('')).toContain('unit')
      expect(stage.reasons.join('')).toContain('数量算定949対応!6')
    }
    expect(evaluated.formalOutputAllowed).toBe(false)
  })
})
