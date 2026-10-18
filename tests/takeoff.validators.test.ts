import { describe, expect, it } from 'vitest'
import master from '../src/core/takeoff/master.data'
import { calcResult, isRecord } from '../src/core/takeoff/calcTypes'
import { createMasterView } from '../src/core/takeoff/master'
import { mergeFacts, SYSTEM_FACT_KEYS } from '../src/core/takeoff/readiness'
import { UNIT_METHOD_SPECS } from '../src/core/takeoff/unitMethods'
import {
  runExternalValidators,
  type ValidatorContext,
} from '../src/core/takeoff/validators'
import type { MasterDefinition } from '../src/core/takeoff/types'

const view = createMasterView(master)

const names = [
  'condition_checks_complete',
  'scope_contract',
  'method_profile',
  'dependency_graph',
  'selection_coexistence',
  'units_and_dimensions',
  'formula_geometry_support',
] as const

function definition(id: string): MasterDefinition {
  const found = view.definition(id)
  if (!found) throw new Error(`定義がありません: ${id}`)
  return found
}

function sample(schema: unknown, key: string): unknown {
  if (!isRecord(schema)) return `test:${key}`
  if (Object.prototype.hasOwnProperty.call(schema, 'const')) return schema.const
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0]
  }
  if (schema.type === 'boolean') return true
  if (schema.type === 'number' || schema.type === 'integer') {
    return Math.max(
      1,
      typeof schema.minimum === 'number' ? Math.ceil(schema.minimum) : 1,
      typeof schema.exclusiveMinimum === 'number'
        ? Math.floor(schema.exclusiveMinimum) + 1
        : 1,
    )
  }
  if (schema.type === 'array') return [sample(schema.items, `${key}:0`)]
  if (schema.type === 'object') {
    const properties = isRecord(schema.properties) ? schema.properties : {}
    const keys = Array.isArray(schema.required)
      ? schema.required.filter((value): value is string =>
          typeof value === 'string',
        )
      : Object.keys(properties)
    return Object.fromEntries(keys.map(name => [
      name,
      sample(properties[name], name),
    ]))
  }
  return `test:${key}`
}

function contextFor(
  entry: MasterDefinition = definition('REL-001'),
): ValidatorContext {
  const requiredFacts = Object.fromEntries(
    view.requiredKeys(entry).map(key => [
      key,
      sample(entry.schemaOverrides?.[key] ?? master.propertyTypes[key], key),
    ]),
  )
  const systemKeys = new Set(SYSTEM_FACT_KEYS)
  const systemFacts = Object.fromEntries(
    Object.entries(requiredFacts).filter(([key]) => systemKeys.has(key)),
  )
  const userFacts = Object.fromEntries(
    Object.entries(requiredFacts).filter(([key]) => !systemKeys.has(key)),
  )

  return {
    definition: entry,
    facts: mergeFacts(systemFacts, {
      ...userFacts,
      scope_id: 'scope:test',
      physical_object_id: 'object:test',
      scope_verified: true,
    }),
    checkAnswers: Object.fromEntries(entry.checks.map(check => [
      check.id,
      { answer: 'true' as const, evidence: `evidence:${check.id}` },
    ])),
    calc: calcResult({
      status: 'CALCULATED',
      value: '1',
      unit: entry.unit,
    }),
    targetUnit: entry.unit,
    dependencies: { cycle: false, staleIds: [], orphanIds: [] },
    coexistence: { conflicts: [] },
    geometry: { source: 'manual', supported: true },
  }
}

function run(name: string, context: ValidatorContext) {
  const evaluated = runExternalValidators([name], context)[0]
  if (!evaluated) throw new Error('検証結果がありません。')
  return evaluated
}

describe('takeoff external validators', () => {
  it('7種すべて、材料が成立している場合だけOKになる', () => {
    const results = runExternalValidators(names, contextFor())
    expect(results.map(value => value.name)).toEqual([...names])
    expect(results.every(value => value.status === 'OK')).toBe(true)
  })

  it('施工条件の回答不足・APPLYのfalse/unknown・根拠不足を検出する', () => {
    const context = contextFor()
    const first = context.definition.checks[0]
    const apply = context.definition.checks.find(check =>
      check.effect === 'PHYSICAL_APPLICABILITY',
    )
    if (!first || !apply) throw new Error('施工条件がありません。')

    const missing = { ...context.checkAnswers }
    delete missing[first.id]
    const absent = run('condition_checks_complete', {
      ...context,
      checkAnswers: missing,
    })
    expect(absent.status).toBe('FAILED')
    expect(absent.message).toContain(first.id)

    for (const answer of ['false', 'unknown'] as const) {
      const failed = run('condition_checks_complete', {
        ...context,
        checkAnswers: {
          ...context.checkAnswers,
          [apply.id]: { answer, evidence: 'evidence:test' },
        },
      })
      expect(failed.status).toBe('FAILED')
      expect(failed.message).toContain(apply.id)
    }

    expect(run('condition_checks_complete', {
      ...context,
      checkAnswers: {
        ...context.checkAnswers,
        [apply.id]: { answer: 'true', evidence: '   ' },
      },
    }).status).toBe('FAILED')

    expect(run('condition_checks_complete', {
      ...context,
      definition: { ...context.definition, checks: [] },
      checkAnswers: {},
    }).status).toBe('OK')
  })

  it('範囲契約の不足キーを表示する', () => {
    const evaluated = run('scope_contract', {
      ...contextFor(),
      facts: { scope_verified: false },
    })
    expect(evaluated.status).toBe('FAILED')
    expect(evaluated.message).toContain('scope_id')
    expect(evaluated.message).toContain('physical_object_id')
    expect(evaluated.message).toContain('scope_verified')
  })

  it('計算方式の未入力・不正・未対応・結果なしを区別する', () => {
    const context = contextFor()

    for (const status of ['INPUT_REQUIRED', 'INVALID'] as const) {
      const evaluated = run('method_profile', {
        ...context,
        calc: calcResult({
          status,
          unit: context.definition.unit,
          errors: ['寸法の確認が必要'],
        }),
      })
      expect(evaluated.status).toBe('FAILED')
      expect(evaluated.message).toContain('寸法の確認が必要')
    }

    expect(run('method_profile', {
      ...context,
      calc: calcResult({
        status: 'UNSUPPORTED',
        unit: context.definition.unit,
      }),
    }).status).toBe('UNSUPPORTED')

    expect(run('method_profile', {
      ...context,
      calc: undefined,
    }).status).toBe('UNSUPPORTED')

    expect(run('method_profile', {
      ...context,
      calc: calcResult({
        status: 'NO_QUANTITY',
        unit: context.definition.unit,
      }),
    }).status).toBe('FAILED')
  })

  it('依存の循環・古い版・失効参照を検出し、材料なしは未対応にする', () => {
    const context = contextFor()
    const evaluated = run('dependency_graph', {
      ...context,
      dependencies: {
        cycle: true,
        staleIds: ['stale:1'],
        orphanIds: ['orphan:1'],
      },
    })
    expect(evaluated.status).toBe('FAILED')
    expect(evaluated.message).toContain('循環')
    expect(evaluated.message).toContain('stale:1')
    expect(evaluated.message).toContain('orphan:1')
    expect(run('dependency_graph', {
      ...context,
      dependencies: undefined,
    }).status).toBe('UNSUPPORTED')
  })

  it('排他的な選択を検出し、材料なしは未対応にする', () => {
    const context = contextFor()
    const evaluated = run('selection_coexistence', {
      ...context,
      coexistence: { conflicts: ['PACKAGEと構成明細が重複'] },
    })
    expect(evaluated.status).toBe('FAILED')
    expect(evaluated.message).toContain('PACKAGE')
    expect(run('selection_coexistence', {
      ...context,
      coexistence: undefined,
    }).status).toBe('UNSUPPORTED')
  })

  it('対象・計算・元定義の単位を照合する', () => {
    const context = contextFor()

    expect(run('units_and_dimensions', {
      ...context,
      targetUnit: 'm2',
    }).status).toBe('FAILED')

    expect(run('units_and_dimensions', {
      ...context,
      targetUnit: 'm2',
      calc: calcResult({ status: 'CALCULATED', value: '1', unit: 'm2' }),
    }).status).toBe('FAILED')

    expect(run('units_and_dimensions', {
      ...context,
      targetUnit: undefined,
    }).status).toBe('UNSUPPORTED')

    expect(run('units_and_dimensions', {
      ...context,
      calc: undefined,
    }).status).toBe('UNSUPPORTED')

    const auxiliary = contextFor(definition('REL-055'))
    expect(run('units_and_dimensions', {
      ...auxiliary,
      targetUnit: '㎡',
      calc: calcResult({ status: 'CALCULATED', value: '1', unit: 'm2' }),
    }).status).toBe('OK')
  })

  it('未確定単位は選択可能な方式の単位と照合する', () => {
    const entry = definition('REL-039')
    const methodId = entry.unresolved?.methods.find(id => {
      const spec = UNIT_METHOD_SPECS[id]
      return spec?.selectable && spec.unit !== '' && id !== 'U19:NO_SEPARATE'
    })
    if (!methodId) throw new Error('選択可能な方式がありません。')

    const method = UNIT_METHOD_SPECS[methodId]
    if (!method) throw new Error('方式がありません。')

    const context = contextFor(entry)
    const selected: ValidatorContext = {
      ...context,
      facts: { ...context.facts, selected_method_id: methodId },
      targetUnit: method.unit,
      calc: calcResult({
        status: 'CALCULATED',
        value: '1',
        unit: method.unit,
      }),
    }

    expect(run('units_and_dimensions', selected).status).toBe('OK')
    expect(entry.unit).toBe('未確定')

    expect(run('units_and_dimensions', {
      ...selected,
      facts: { ...context.facts },
    }).status).toBe('UNSUPPORTED')

    expect(run('units_and_dimensions', {
      ...selected,
      facts: { ...context.facts, selected_method_id: 'U19:AHU_INSTALL' },
    }).status).toBe('FAILED')
  })

  it('形状の対応・非対応・材料なしを区別する', () => {
    const context = contextFor()
    const failed = run('formula_geometry_support', {
      ...context,
      geometry: {
        source: 'rows',
        supported: false,
        note: '曲り部の算定に未対応',
      },
    })
    expect(failed.status).toBe('FAILED')
    expect(failed.message).toContain('曲り部')

    expect(run('formula_geometry_support', {
      ...context,
      geometry: undefined,
    }).status).toBe('UNSUPPORTED')
  })

  it('未知の検証器をOK扱いしない', () => {
    expect(run('future_validator', contextFor()).status).toBe('UNSUPPORTED')
  })
})
