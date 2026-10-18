import { describe, expect, it } from 'vitest'
import data from '../tests/fixtures/takeoff/acceptance.json'
import master from '../src/core/takeoff/master.data'
import {
  methodInputDifferences,
  runMethodAcceptance,
  type MethodAcceptanceCase,
} from '../src/core/takeoff/acceptance'
import { isMissingFact } from '../src/core/takeoff/conditions'
import {
  calculateUnitMethod,
  UNIT_METHOD_SPECS,
} from '../src/core/takeoff/unitMethods'

type FixtureCase = (typeof data.methodCases)[number]

const NON_NUMERIC_REVIEW_IDS = [
  'UAT-21-N', 'UAT-35-N',
  'UAT-X-01', 'UAT-X-05', 'UAT-X-06', 'UAT-X-07', 'UAT-X-08',
  'UAT-X-09', 'UAT-X-10', 'UAT-X-11', 'UAT-X-12', 'UAT-X-13',
  'UAT-X-14', 'UAT-X-15', 'UAT-X-16', 'UAT-X-17', 'UAT-X-18', 'UAT-X-19',
] as const

// 自由記述の変更を自動解釈しない差分の明示一覧。
// 欠落、空欄、配列変更、他のキーの変更には適用しない。
const FREE_TEXT_REVIEW_DIFFERENCES = [
  {
    key: 'inclusion_resolution',
    reason: '包含・分担の照査で扱う。計算器は自由記述を判定しない',
  },
  {
    key: 'dimensions',
    reason: '寸法の自由記述（例: 厚さ未入力）は計算器が解釈しない。数値欄が空なら停止する',
  },
  {
    key: 'openings',
    reason: '開口・除外の自由記述（例: 除外幅が全長超過）は計算器が解釈しない。数値で入れた除外が全長を超えれば停止する',
  },
] as const

const NUMERICAL_BOUNDARY_IDS = ['UAT-X-02', 'UAT-X-03', 'UAT-X-04']

function baselineFor(entry: FixtureCase): FixtureCase | undefined {
  return data.methodCases.find(candidate =>
    candidate.methodId === entry.methodId && candidate.kind === '正常・算定',
  )
}

function freeTextReviewReason(entry: FixtureCase): string | undefined {
  if (entry.kind !== '異常・停止') return undefined
  const baseline = baselineFor(entry)
  if (!baseline) return undefined

  const differences = methodInputDifferences(baseline.input, entry.input)
  if (differences.length === 0) return undefined

  const baselineInput = baseline.input as Readonly<Record<string, unknown>>
  const currentInput = entry.input as Readonly<Record<string, unknown>>

  const rules = differences.map(key =>
    FREE_TEXT_REVIEW_DIFFERENCES.find(rule => rule.key === key),
  )
  if (rules.some(rule => rule === undefined)) return undefined

  const onlyNonemptyText = differences.every(key =>
    typeof baselineInput[key] === 'string'
    && typeof currentInput[key] === 'string'
    && !isMissingFact(baselineInput[key])
    && !isMissingFact(currentInput[key]),
  )
  return onlyNonemptyText ? rules[0]?.reason : undefined
}

/**
 * 原本の UAT-24 は長方形基礎4側面を明示した例。
 * エンジンには寸法から推定させず、試験側で選択済み4面に変換する。
 */
function baseFormInputs(entry: FixtureCase): Readonly<Record<string, unknown>> | undefined {
  if (entry.methodId !== 'U19:BASE_FORM') return undefined
  const normal = entry.kind === '正常・算定' ? entry : baselineFor(entry)
  if (!normal) throw new Error('BASE_FORM の正常ケースがありません')
  const [length, width, height, count] = normal.values
  if (length === undefined || width === undefined || height === undefined
    || count === undefined) throw new Error('BASE_FORM の試験寸法が不足しています')

  const repetitions = Number(count)
  if (!Number.isSafeInteger(repetitions) || repetitions < 1) {
    throw new Error('BASE_FORM の試験基数が不正です')
  }

  const faces: Record<string, unknown>[] = []
  for (let index = 0; index < repetitions; index += 1) {
    for (const [suffix, faceLength] of [
      ['L1', length], ['L2', length], ['W1', width], ['W2', width],
    ] as const) {
      faces.push({
        id: `TEST-FOUNDATION-${index}-${suffix}`,
        length_m: faceLength,
        height_m: height,
      })
    }
  }
  return { faces }
}

const cases: MethodAcceptanceCase[] = data.methodCases.map(entry => {
  const numericalBoundary = NUMERICAL_BOUNDARY_IDS.includes(entry.caseId)
  const method = master.unitMethods[entry.methodId]
  const requiredInputs = numericalBoundary
    ? [] // 合成境界例は物理計算単体の検査。案件根拠の充足を主張しない。
    : method?.requiredInputs ?? []

  return {
    ...entry,
    requiredInputs,
    calculationInputs: baseFormInputs(entry),
    notAutomatableReason: freeTextReviewReason(entry),
  }
})

const rows = runMethodAcceptance(cases)

describe('takeoff 35 unit methods and acceptance table', () => {
  it('runs all 89 cases and preserves source statuses', () => {
    expect(data.methodCases).toHaveLength(89)
    expect(rows).toHaveLength(89)
    expect(new Set(rows.map(row => row.caseId)).size).toBe(89)
    for (const row of rows) {
      expect(row.sourceStatus).toBe(
        data.methodCases.find(entry => entry.caseId === row.caseId)?.sourceStatus,
      )
    }
  })

  it('passes every normal numerical case', () => {
    const normalIds = new Set(
      cases.filter(entry => entry.kind === '正常・算定').map(entry => entry.caseId),
    )
    const failures = rows.filter(row => normalIds.has(row.caseId) && row.verdict !== 'PASS')
    expect(failures).toEqual([])
  })

  it('lists the stop cases deferred to adoption and the free-text cases explicitly', () => {
    // 原本は数量 null の停止だが、欠けた入力が価格・分担・採用の根拠なので参考値を算定し正式採用で止める（CC26-16）。
    expect(rows.filter(row => row.verdict === 'DEFERRED_TO_ADOPTION').map(row => row.caseId).sort())
      .toEqual(['UAT-22-E', 'UAT-25-E', 'UAT-33-E'])
    for (const row of rows.filter(entry => entry.verdict === 'DEFERRED_TO_ADOPTION')) {
      expect(row.result?.laterRequired).toEqual(expect.arrayContaining(row.changedKeys))
    }
    expect(rows.filter(row => row.verdict === 'NOT_AUTOMATABLE'
      && data.methodCases.find(entry => entry.caseId === row.caseId)?.kind === '異常・停止')
      .map(row => row.caseId).sort())
      .toEqual(['UAT-12-E', 'UAT-13-E', 'UAT-23-E', 'UAT-28-E'])
  })

  it('has no failed stop case and reports reason matching separately', () => {
    const stopIds = new Set(
      cases.filter(entry => entry.kind === '異常・停止').map(entry => entry.caseId),
    )
    expect(rows.filter(row => stopIds.has(row.caseId) && row.verdict === 'FAIL')).toEqual([])
    for (const row of rows.filter(entry =>
      stopIds.has(entry.caseId) && entry.verdict === 'PASS',
    )) {
      expect(row.result?.status).not.toBe('CALCULATED')
      expect(typeof row.reasonMatched).toBe('boolean')
    }
  })

  it('limits NOT_AUTOMATABLE to the explicit review lists', () => {
    const freeTextIds = cases.filter(entry => entry.notAutomatableReason)
      .map(entry => entry.caseId)
    const allowed = [...NON_NUMERIC_REVIEW_IDS, ...freeTextIds].sort()
    const actual = rows.filter(row => row.verdict === 'NOT_AUTOMATABLE')
      .map(row => row.caseId).sort()
    expect(actual).toEqual(allowed)
  })

  it('calculates the three numerical boundary cases', () => {
    for (const caseId of NUMERICAL_BOUNDARY_IDS) {
      expect(rows.find(row => row.caseId === caseId)?.verdict).toBe('PASS')
    }
  })

  it('provides all 35 method specs', () => {
    expect(Object.keys(UNIT_METHOD_SPECS)).toHaveLength(35)
    expect(UNIT_METHOD_SPECS['U19:MOVE_MASS']?.variables.map(entry => entry.key))
      .toEqual(['mass_kg', 'mass_correction', 'single_factor'])
  })

  it('does not default a missing riser or extra length to zero', () => {
    const result = calculateUnitMethod({
      methodId: 'U19:POWER_CABLE',
      inputs: {},
      requiredInputs: [],
      values: { route_m: 18 },
    })
    expect(result.status).toBe('INPUT_REQUIRED')
    expect(result.missing).toEqual(['riser_m', 'extra_m'])
    expect(result.errors.join(' ')).toContain('立上り長さ')
  })

  it('accepts explicit zero riser and extra lengths', () => {
    expect(calculateUnitMethod({
      methodId: 'U19:POWER_CABLE',
      inputs: {}, requiredInputs: [],
      values: { route_m: 18, riser_m: 0, extra_m: 0 },
    }).value).toBe('18')
  })

  it('keeps later price/adoption requirements separate from physical quantity', () => {
    const result = calculateUnitMethod({
      methodId: 'U19:POWER_EQUIP',
      inputs: { equipment_ids: ['TEST-EQ'] },
      values: {},
      requiredInputs: [
        'equipment_ids', 'price_basis_id', 'inclusion_resolution',
        'allocation_id', 'adoption_evidence_id',
      ],
    })
    expect(result.status).toBe('CALCULATED')
    expect(result.value).toBe('1')
    expect(result.laterRequired).toEqual([
      'price_basis_id', 'inclusion_resolution', 'allocation_id', 'adoption_evidence_id',
    ])
  })

  it('rejects duplicated IDs and differing price units', () => {
    expect(calculateUnitMethod({
      methodId: 'U19:POWER_EQUIP',
      inputs: { equipment_ids: ['a', 'a'] },
      values: {}, requiredInputs: [],
    }).status).toBe('INVALID')
    expect(calculateUnitMethod({
      methodId: 'U19:POWER_EQUIP',
      inputs: { equipment_ids: ['a'], price_unit: '台・日' },
      values: {}, requiredInputs: [],
    }).status).toBe('INVALID')
  })

  it('rejects reversed dates and nonpositive equipment volume', () => {
    expect(calculateUnitMethod({
      methodId: 'U19:POWER_HIRE',
      inputs: {
        equipment_ids: ['a'],
        rental_start_end: ['2026-10-18', '2026-10-17'],
      },
      values: { charge_days: 1 }, requiredInputs: [],
    }).status).toBe('INVALID')

    for (const equipmentVolume of [0, -1, '0m³', '-1m³']) {
      expect(calculateUnitMethod({
        methodId: 'U19:MOVE_VOLUME',
        inputs: { equipment_volume: equipmentVolume },
        values: { mass_kg: 1000, density_correction: 1, single_factor: 1 },
        requiredInputs: [],
      }).status).toBe('INVALID')
    }
  })

  it('requires PACKAGE quote and breakdown instead of inserting one', () => {
    const result = calculateUnitMethod({
      methodId: 'U19:PACKAGE', inputs: {},
      values: { agreed_quantity: 1 }, requiredInputs: [],
    })
    expect(result.status).toBe('INPUT_REQUIRED')
    expect(result.missing).toEqual(['quote_id', 'quantity_breakdown'])
  })

  it('records NO_SEPARATE without a numerical value', () => {
    expect(calculateUnitMethod({
      methodId: 'U19:NO_SEPARATE', inputs: {}, values: {}, requiredInputs: [],
    }).status).toBe('INPUT_REQUIRED')
    const result = calculateUnitMethod({
      methodId: 'U19:NO_SEPARATE',
      inputs: {
        reason_code: 'INCLUDED',
        counterpart_definition_or_trade: 'TEST-COUNTERPART',
        inclusion_or_allocation_evidence: 'TEST-EVIDENCE',
      },
      values: {}, requiredInputs: [],
    })
    expect(result.status).toBe('NO_QUANTITY')
    expect(result.value).toBeNull()
  })

  it('rejects the reference-only AHU method and repeated BASE_FORM faces', () => {
    expect(calculateUnitMethod({
      methodId: 'U19:AHU_INSTALL', inputs: {}, values: {}, requiredInputs: [],
    }).status).toBe('INVALID')
    expect(calculateUnitMethod({
      methodId: 'U19:BASE_FORM',
      inputs: {
        faces: [
          { id: 'f1', length_m: 2, height_m: 3 },
          { id: 'f1', length_m: 2, height_m: 3 },
        ],
      },
      values: {}, requiredInputs: [],
    }).status).toBe('INVALID')
  })

  it('rejects fence exclusions exceeding the measured length', () => {
    expect(calculateUnitMethod({
      methodId: 'U19:FENCE_AREA', inputs: {}, requiredInputs: [],
      values: { plan_length_m: 2, excluded_m: 3, height_m: 1 },
    }).status).toBe('INVALID')
  })
})
