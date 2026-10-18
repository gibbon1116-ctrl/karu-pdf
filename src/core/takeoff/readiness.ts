import {
  deepEqual,
  evaluateCondition,
  isMissingFact,
  type ConditionOutcome,
} from './conditions'
import { validateSchema, type SchemaIssue } from './jsonSchema'
import type { MasterView } from './master'
import type { ConditionalRequired, MasterDefinition } from './types'

export type StageName = 'proposal' | 'quantity' | 'billing'

export type StageStatus =
  | 'SATISFIED'
  | 'INPUT_REQUIRED'
  | 'CONDITION_FALSE'
  | 'CONDITION_UNKNOWN'
  | 'UNSUPPORTED'
  | 'NOT_APPLICABLE'
  | 'BLOCKED'

export interface ValidatorResult {
  name: string
  status: 'OK' | 'FAILED' | 'UNSUPPORTED'
  message: string
}

export interface StageOutcome {
  stage: StageName
  status: StageStatus
  missing: string[]
  falseFields: string[]
  unknownFields: string[]
  unsupported: string[]
  schemaErrors: SchemaIssue[]
  validators: ValidatorResult[]
  reasons: string[]
}

export type Facts = Readonly<Record<string, unknown>>

export interface Readiness {
  definitionId: string
  proposal: StageOutcome
  quantity: StageOutcome
  billing: StageOutcome
  formalOutputAllowed: boolean
  formalOutputBlockers: string[]
}

export interface ReadinessInput {
  view: MasterView
  definitionId: string
  systemFacts: Facts
  userFacts: Facts
  validators: readonly ValidatorResult[]
  approvedForProject: boolean
  stale: boolean
}

export const SYSTEM_FACT_KEYS: readonly string[] = Object.freeze([
  'dependency_acyclic',
  'formula_supported',
  'geometry_topology_verified',
  'origin_match',
  'overlap_resolved',
  'price_compatible',
  'source_active',
  'source_current',
  'source_not_orphaned',
  'work_mode_match',
])

const systemFactKeys = new Set(SYSTEM_FACT_KEYS)

export function droppedUserSystemKeys(userFacts: Facts): string[] {
  return Object.keys(userFacts).filter(key => systemFactKeys.has(key))
}

export function mergeFacts(
  systemFacts: Facts,
  userFacts: Facts,
): Record<string, unknown> {
  return {
    ...Object.fromEntries(
      Object.entries(userFacts).filter(([key]) => !systemFactKeys.has(key)),
    ),
    ...systemFacts,
  }
}

function fact(facts: Facts, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(facts, key)
    ? facts[key]
    : undefined
}

function append(target: string[], values: readonly string[]): void {
  for (const value of values) {
    if (!target.includes(value)) target.push(value)
  }
}

function outcome(
  stage: StageName,
  status: StageStatus = 'SATISFIED',
  reasons: readonly string[] = [],
): StageOutcome {
  return {
    stage,
    status,
    missing: [],
    falseFields: [],
    unknownFields: [],
    unsupported: [],
    schemaErrors: [],
    validators: [],
    reasons: [...reasons],
  }
}

interface PredicateState {
  false: boolean
  unknown: boolean
}

function collectCondition(
  target: StageOutcome,
  evaluated: ConditionOutcome,
  state: PredicateState,
): void {
  append(target.falseFields, evaluated.falseFields)
  append(target.unknownFields, evaluated.unknownFields)
  append(target.unsupported, evaluated.unsupported)
  state.false ||= evaluated.truth === 'false'
  state.unknown ||= evaluated.truth === 'unknown'
}

function collectMissing(
  target: StageOutcome,
  required: readonly string[],
  facts: Facts,
): void {
  append(
    target.missing,
    required.filter(key => isMissingFact(fact(facts, key))),
  )
}

function resolveStatus(
  target: StageOutcome,
  state: PredicateState,
): StageStatus {
  if (target.unsupported.length > 0) return 'UNSUPPORTED'
  if (state.false) return 'CONDITION_FALSE'
  if (target.missing.length > 0
    || target.schemaErrors.length > 0
    || target.validators.some(result => result.status === 'FAILED')) {
    return 'INPUT_REQUIRED'
  }
  if (state.unknown) return 'CONDITION_UNKNOWN'
  return 'SATISFIED'
}

const fallbackProposal = {
  all: [
    { field: 'source_active', op: 'eq', value: true },
    { field: 'origin_match', op: 'eq', value: true },
    { field: 'work_mode_match', op: 'eq', value: true },
  ],
}

function evaluateProposal(
  view: MasterView,
  definition: MasterDefinition,
  facts: Facts,
): StageOutcome {
  const result = outcome('proposal')
  const state: PredicateState = { false: false, unknown: false }
  const predicate = view.condition(definition.stages.proposal)

  if (predicate !== undefined) {
    collectCondition(result, evaluateCondition(predicate, facts), state)
  } else if (definition.quantityRole === 'ROUTER'
    || definition.quantityRole === 'RECORD_ONLY') {
    collectCondition(result, evaluateCondition(fallbackProposal, facts), state)
  } else {
    result.unsupported.push('提案段階の条件が定義されていません。')
  }

  result.status = resolveStatus(result, state)
  return result
}

function collectConditionalRequired(
  target: StageOutcome,
  clauses: readonly ConditionalRequired[],
  facts: Facts,
  state: PredicateState,
): void {
  for (const clause of clauses) {
    const trigger = evaluateCondition(clause.if, facts)
    append(target.unsupported, trigger.unsupported)

    // 発動条件が未確認なら、then の入力はまだ要求しない。
    if (trigger.truth !== 'true') continue

    collectMissing(target, clause.required, facts)

    for (const [key, requiredValue] of Object.entries(
      clause.require_values ?? {},
    )) {
      const actual = fact(facts, key)
      if (!isMissingFact(actual) && !deepEqual(actual, requiredValue)) {
        append(target.falseFields, [key])
        state.false = true
      }
    }
  }
}

function evaluateQuantity(
  input: ReadinessInput,
  definition: MasterDefinition,
  facts: Facts,
): StageOutcome {
  const { view } = input

  if (definition.quantityRole === 'ROUTER') {
    const children = view.condition<readonly string[]>(
      definition.stages.children,
    ) ?? definition.reverse.children

    return outcome('quantity', 'NOT_APPLICABLE', [
      `親の定義は数量を作りません。子の定義（${children.join('、')}）を選んでください。`,
    ])
  }

  if (definition.quantityRole === 'RECORD_ONLY') {
    const result = outcome('quantity', 'NOT_APPLICABLE', [
      '確認の記録だけです。',
    ])
    collectMissing(
      result,
      view.condition<readonly string[]>(definition.stages.required)
        ?? view.requiredKeys(definition),
      facts,
    )
    return result
  }

  const result = outcome('quantity')
  const state: PredicateState = { false: false, unknown: false }
  const stage = view.quantityStage(definition)

  const required = definition.stages.quantityRequired === undefined
    ? view.requiredKeys(definition)
    : view.keys(definition.stages.quantityRequired)

  collectMissing(result, required, facts)

  const clauses = definition.stages.quantityConditionalRequired === undefined
    ? view.conditionalRequired(definition)
    : view.condition<readonly ConditionalRequired[]>(
      definition.stages.quantityConditionalRequired,
    ) ?? []

  collectConditionalRequired(result, clauses, facts, state)

  if (stage?.predicate !== undefined) {
    collectCondition(
      result,
      evaluateCondition(stage.predicate, facts),
      state,
    )
  }

  // 生成データでは通常 predicate にも含まれる。独立した AST も取りこぼさない。
  if (definition.conditionAst !== undefined) {
    collectCondition(
      result,
      evaluateCondition(view.condition(definition.conditionAst), facts),
      state,
    )
  }

  const schema = validateSchema(view.inputSchema(definition), facts)
  result.schemaErrors = schema.errors.filter(issue =>
    issue.keyword !== 'required',
  )
  append(
    result.unsupported,
    schema.unsupported.map(issue =>
      `${issue.path}: ${issue.keyword}: ${issue.message}`,
    ),
  )

  for (const name of stage?.external_validators ?? []) {
    const matches = input.validators.filter(value => value.name === name)
    const validator: ValidatorResult = matches.length === 1
      ? matches[0]!
      : {
          name,
          status: 'UNSUPPORTED',
          message: matches.length === 0
            ? `外部検証器 ${name} の結果がありません。`
            : `外部検証器 ${name} の結果が重複しています。`,
        }

    result.validators.push({ ...validator })

    if (validator.status === 'UNSUPPORTED') {
      append(result.unsupported, [
        `${name}: ${validator.message || '未対応の検証器です。'}`,
      ])
    } else if (validator.status === 'FAILED') {
      append(result.reasons, [
        `${name}: ${validator.message || '検証条件を満たしていません。'}`,
      ])
    }
  }

  result.status = resolveStatus(result, state)

  if (definition.role === '未確定方式'
    && isMissingFact(fact(input.userFacts, 'selected_method_id'))) {
    result.status = 'INPUT_REQUIRED'
    result.missing = [
      'selected_method_id',
      ...result.missing.filter(key => key !== 'selected_method_id'),
    ]
    result.reasons.unshift(
      `方式・単位を選ぶまで算定しません（元単位: ${definition.unit}）`,
    )
  }

  return result
}

function evaluateBilling(
  view: MasterView,
  definition: MasterDefinition,
  facts: Facts,
  quantity: StageOutcome,
): StageOutcome {
  if (quantity.status !== 'SATISFIED') {
    return outcome('billing', 'BLOCKED', [
      '数量の段階が未成立です。',
    ])
  }

  const stage = view.billingStage(definition)

  if (definition.role === '補助量/照査') {
    return outcome('billing', 'NOT_APPLICABLE', [
      '補助量は正式な物量へ転記しません。',
    ])
  }

  if (definition.role === '親/確認記録') {
    return outcome('billing', 'NOT_APPLICABLE', [
      '親・確認記録は正式な物量として計上しません。',
    ])
  }

  if (definition.role === '工数') {
    return outcome('billing', 'NOT_APPLICABLE', [
      '工数は物量と別に集計し、工数表の確認後に扱います。',
    ])
  }

  if (stage?.cost_role_allowed === false) {
    return outcome('billing', 'NOT_APPLICABLE', [
      'この定義は正式な物量として計上する役割ではありません。',
    ])
  }

  const result = outcome('billing')
  const state: PredicateState = { false: false, unknown: false }

  if (!stage) {
    result.unsupported.push('課金段階の条件が定義されていません。')
  } else {
    collectMissing(result, stage.required ?? [], facts)
    if (stage.predicate !== undefined) {
      collectCondition(
        result,
        evaluateCondition(stage.predicate, facts),
        state,
      )
    }
  }

  const inclusion = fact(facts, 'inclusion_state')
  if (!isMissingFact(inclusion) && inclusion !== 'separate') {
    state.false = true
    append(result.falseFields, ['inclusion_state'])
    result.reasons.push(
      '単価包含・他契約のため別計上しません（物理数量は保持）。',
    )
  }

  result.status = resolveStatus(result, state)
  return result
}

export function evaluateReadiness(input: ReadinessInput): Readiness {
  const { view, definitionId } = input
  const definition = view.definition(definitionId)
  const conflicts = view.conflicts(definitionId)

  if (!definition || conflicts.length > 0) {
    const reasons = !definition
      ? [`数量定義 ${definitionId} がマスターにありません。`]
      : conflicts.map(conflict =>
          `マスターの競合（MASTER_CONFLICT）: ${conflict.reason}`
          + `（${conflict.property}・${conflict.cells.join('、')}）`,
        )

    const blockers = [...reasons]
    if (!input.approvedForProject) {
      blockers.push('案件での採用が未確認（REVIEW_PENDING）')
    }
    if (input.stale) {
      blockers.push('根拠の版が変わったため再確認が必要（STALE）')
    }

    return {
      definitionId,
      proposal: outcome('proposal', 'BLOCKED', reasons),
      quantity: outcome('quantity', 'BLOCKED', reasons),
      billing: outcome('billing', 'BLOCKED', reasons),
      formalOutputAllowed: false,
      formalOutputBlockers: blockers,
    }
  }

  const facts = mergeFacts(input.systemFacts, input.userFacts)
  const proposal = evaluateProposal(view, definition, facts)
  const quantity = evaluateQuantity(input, definition, facts)
  const billing = evaluateBilling(view, definition, facts, quantity)
  const blockers: string[] = []

  const methodSelected = !isMissingFact(
    fact(input.userFacts, 'selected_method_id'),
  )

  if (definition.role !== '数量候補'
    && !(definition.role === '未確定方式' && methodSelected)) {
    blockers.push(
      definition.role === '未確定方式'
        ? '方式・単位が未選択のため正式な物量へ出力できません。'
        : `役割「${definition.role}」は正式な物量へ出力しません。`,
    )
  }

  if (proposal.status !== 'SATISFIED') {
    blockers.push(`提案の段階が未成立です（${proposal.status}）。`)
  }
  if (quantity.status !== 'SATISFIED') {
    blockers.push(`数量の段階が未成立です（${quantity.status}）。`)
  }
  if (billing.status !== 'SATISFIED') {
    blockers.push(`課金の段階が未成立です（${billing.status}）。`)
  }
  if (!input.approvedForProject) {
    blockers.push('案件での採用が未確認（REVIEW_PENDING）')
  }
  if (input.stale) {
    blockers.push('根拠の版が変わったため再確認が必要（STALE）')
  }

  return {
    definitionId,
    proposal,
    quantity,
    billing,
    formalOutputAllowed: blockers.length === 0,
    formalOutputBlockers: blockers,
  }
}
