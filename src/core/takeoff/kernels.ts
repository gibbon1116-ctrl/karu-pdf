import type { FormulaId } from './types'
import {
  calcResult,
  constant,
  createReader,
  isRecord,
  own,
  type CalcResult,
} from './calcTypes'
import {
  add,
  compare,
  decimalToString,
  divPow10,
  isNegative,
  mul,
  mulPi,
  sub,
  ZERO,
  type Decimal,
} from './decimal'
import { convertUnit, normalizeUnit, sameUnit, unitDimension } from './units'

export interface KernelInput {
  formula: FormulaId
  targetUnit: string
  body: unknown
}

const STOP_MESSAGES: Readonly<Partial<Record<FormulaId, string>>> = {
  F_UNION: '対象面の和集合（座標系・図面版・穴の検証）は未実装です',
  F_DESIGN: '明細から計算します（明細の入力が必要）',
  F_DUCT_RECT_EST: 'ダクトの積算規則は明細から計算します',
}

const SI_ROWS: Readonly<Partial<Record<FormulaId, readonly string[]>>> = {
  F_RECT: ['w', 'h', 'L'],
  F_ROUND: ['D', 'L'],
  F_WALL: ['L', 'h'],
  F_UP: ['L', 'h'],
  F_THICK: ['A', 't'],
  F_SAND: ['A', 't'],
  F_TRENCH: ['L', 'w', 'd'],
  F_PIT: ['A', 'd'],
  F_SURFACE: ['A'],
}

const NATURAL_UNITS: Readonly<Partial<Record<FormulaId, string>>> = {
  F_RECT: 'm2',
  F_ROUND: 'm2',
  F_WALL: 'm2',
  F_UP: 'm2',
  F_SURFACE: 'm2',
  F_THICK: 'm3',
  F_SAND: 'm3',
  F_TRENCH: 'm3',
  F_PIT: 'm3',
  F_BACK: 'm3',
  F_EDGE: 'm',
  F_UNIQUE: 'm',
}

export function calculateFormula(input: KernelInput): CalcResult {
  const { formula, targetUnit, body } = input
  const stop = Object.prototype.hasOwnProperty.call(STOP_MESSAGES, formula)
    ? STOP_MESSAGES[formula]
    : undefined

  if (stop) {
    return calcResult({ status: 'UNSUPPORTED', unit: targetUnit, errors: [stop] })
  }
  if (formula === 'F_CHECK') {
    return calcResult({
      status: 'NO_QUANTITY',
      unit: targetUnit,
      warnings: ['確認の記録だけで数量を持ちません'],
    })
  }

  const reader = createReader(targetUnit)
  if (!isRecord(body)) {
    if (body === null || body === undefined) reader.missing('body')
    else reader.fail('body は入力項目のオブジェクトで指定してください。')
    return reader.finish(null)
  }

  const n = (key: string) => reader.number(own(body, key), key)
  const t = (key: string) => reader.text(own(body, key), key)

  function requireTrue(key: string, message: string): void {
    if (own(body, key) !== true) {
      reader.missing(key)
      reader.error(message)
    }
  }

  function requireSameUnit(sourceKey: string): void {
    const source = t(sourceKey)
    if (source !== null && !sameUnit(source, targetUnit)) {
      reader.fail(`${sourceKey}: ${source} と ${targetUnit} は同一単位ではありません。`)
    }
  }

  function negative(value: Decimal): void {
    if (isNegative(value)) {
      reader.fail('控除が対象を超えています。負の数量・0 への丸めはしません。')
    }
  }

  const natural = NATURAL_UNITS[formula]
  if (natural && unitDimension(targetUnit) !== unitDimension(natural)) {
    reader.fail(`${formula} の出力単位は ${natural} の次元です。${targetUnit} では計算できません。`)
  }

  function finish(value: Decimal | null): CalcResult {
    if (value !== null) negative(value)
    if (value !== null && natural) {
      const conversion = convertUnit(value, natural, targetUnit)
      if (!conversion.ok) {
        reader.fail(conversion.reason)
        return reader.finish(null)
      }
      value = conversion.value
    }
    return reader.finish(value)
  }

  function rows(
    arrayKey: string,
    keys: readonly string[],
    calculate: (values: readonly Decimal[]) => Decimal,
    duplicate: 'reject' | 'unique' = 'reject',
    positive = false,
  ): Decimal | null {
    const entries = reader.array(own(body, arrayKey), arrayKey)
    if (!entries) return null

    let total = ZERO
    const seen = new Map<string, Decimal>()

    entries.forEach((entry, index) => {
      const path = `${arrayKey}[${index}]`
      if (!isRecord(entry)) {
        reader.fail(`${path} は明細オブジェクトで入力してください。`)
        return
      }
      const id = reader.text(own(entry, 'id'), `${path}.id`)
      const values = keys.map(key =>
        reader.number(
          own(entry, key),
          `${path}.${key}`,
          positive ? 'positive' : 'nonNegative',
        ),
      )
      if (id === null || values.some(value => value === null)) return
      const validValues = values as Decimal[]
      const value = calculate(validValues)

      if (seen.has(id)) {
        if (duplicate === 'unique') {
          const previous = seen.get(id)!
          if (compare(previous, value) !== 0) {
            reader.fail(`${path}.id: 同じ区間IDで長さが違います（${id}）。`)
          } else {
            reader.result.warnings.push(`${path}.id: ${id} は1回だけ加算します。`)
          }
        } else {
          reader.fail(
            formula === 'F_EDGE'
              ? `${path}.id: 同じ辺を二重に数えません（${id}）。`
              : `${path}.id: ID ${id} が重複しています。二重に加算しません。`,
          )
        }
        return
      }

      seen.set(id, value)
      total = add(total, value)
      reader.result.steps.push(
        `${id}: ${validValues.map(decimalToString).join(' / ')} → ${decimalToString(value)}`,
      )
    })
    return total
  }

  const siKeys = SI_ROWS[formula]
  if (siKeys) {
    const dimensionsUnit = t('dimensions_unit')
    if (dimensionsUnit !== null && dimensionsUnit !== 'SI') {
      reader.fail('dimensions_unit は SI を明示してください。')
    }
    const deductions = n('deductions')
    const additions = n('additions')

    const total = rows('rows', siKeys, values => {
      const first = values[0]!
      const second = values[1]!
      if (formula === 'F_RECT') {
        return mul(mul(constant('2'), add(first, second)), values[2]!)
      }
      if (formula === 'F_ROUND') return mulPi(mul(first, second))
      return values.reduce((product, value) => mul(product, value), constant('1'))
    }, 'reject', true)

    if (formula === 'F_ROUND') {
      reader.result.warnings.push('π は 30 桁で打ち切り')
    }
    if (total === null || deductions === null || additions === null) return finish(null)

    // 控除超過を加算で隠さない。
    const net = sub(total, deductions)
    negative(net)
    const value = add(net, additions)
    reader.result.steps.push(
      `${decimalToString(total)} − ${decimalToString(deductions)} + ${decimalToString(additions)} = ${decimalToString(value)}`,
    )
    return finish(value)
  }

  switch (formula) {
    case 'F_MANUAL': {
      const value = n('value')
      const source = t('input_unit')
      t('measurement_evidence_id')
      if (value === null || source === null) return finish(null)
      const conversion = convertUnit(value, source, targetUnit)
      if (!conversion.ok) {
        reader.fail(conversion.reason)
        return finish(null)
      }
      reader.result.steps.push(
        `${decimalToString(value)} ${source} → ${decimalToString(conversion.value)} ${targetUnit}`,
      )
      return finish(conversion.value)
    }

    case 'F_SAME': {
      const value = n('value')
      requireSameUnit('source_unit')
      requireTrue(
        'same_object_scope_basis',
        '同一現物・範囲・数量基準の確認が必要です。単位が同じだけでは同一数量にしません。',
      )
      return finish(value)
    }

    case 'F_SUBSET':
      requireSameUnit('source_unit')
      return finish(rows('rows', ['value'], values => values[0]!))

    case 'F_UNIQUE':
      return finish(rows('rows', ['value'], values => values[0]!, 'unique'))

    case 'F_EDGE':
      return finish(rows('rows', ['value'], values => values[0]!))

    case 'F_COUNT': {
      if (unitDimension(targetUnit) !== 'count') {
        reader.fail(`${targetUnit} は件数の単位ではありません。`)
      }
      requireTrue('survey_complete', 'survey_complete: 現物の調査完了を確認してください。')
      const ids = reader.ids(own(body, 'object_ids'), 'object_ids', true)
      if (!ids) return finish(null)
      reader.result.steps.push(`一意な現物ID: ${ids.length}件`)
      return finish(constant(String(ids.length)))
    }

    case 'F_FACTOR': {
      const source = t('source_unit')
      const factorUnit = t('factor_unit')
      requireTrue('coefficient_approved', 'coefficient_approved: 構成数量の係数の承認が必要です。')
      if (source !== null && factorUnit !== null) {
        const expected = `${normalizeUnit(targetUnit)}/${normalizeUnit(source)}`
        const actual = factorUnit.split('/').map(normalizeUnit).join('/')
        if (actual !== expected) {
          reader.fail(`factor_unit は ${expected} が必要です。${factorUnit} では計算しません。`)
        }
      }
      return finish(rows('rows', ['source', 'factor'], values =>
        mul(values[0]!, values[1]!),
      ))
    }

    case 'F_BACK': {
      const excavation = n('excavation')
      const displacement = rows('displacements', ['volume'], values => values[0]!)
      if (excavation === null || displacement === null) return finish(null)
      return finish(sub(excavation, displacement))
    }

    case 'F_DIFF': {
      const a = n('A')
      const b = n('B')
      requireTrue(
        'same_dimension_scope_basis',
        'same_dimension_scope_basis: 同一次元・範囲・数量基準の確認が必要です。',
      )
      return finish(a !== null && b !== null ? sub(a, b) : null)
    }

    case 'F_MASS': {
      const value = n('value')
      const mass = n('unit_mass')
      const source = t('source_unit')
      const basis = t('unit_mass_basis')
      if (!sameUnit(targetUnit, 'kg')) {
        reader.fail('F_MASS の targetUnit は kg が必要です。')
      }
      if (source !== null && basis !== null) {
        const expected = `kg/${normalizeUnit(source)}`
        if (basis.split('/').map(normalizeUnit).join('/') !== expected) {
          reader.fail(`unit_mass_basis は ${expected} が必要です。`)
        }
      }
      return finish(value !== null && mass !== null ? mul(value, mass) : null)
    }

    case 'F_TON': {
      const value = n('value')
      const source = t('source_unit')
      if (source !== null && !sameUnit(source, 'kg')) {
        reader.fail('source_unit は kg が必要です。')
      }
      if (!sameUnit(targetUnit, 't')) reader.fail('F_TON の targetUnit は t が必要です。')
      return finish(value !== null ? divPow10(value, 3) : null)
    }

    default:
      return calcResult({
        status: 'UNSUPPORTED',
        unit: targetUnit,
        errors: [`未対応の算出方式 ${String(formula)} です。`],
      })
  }
}
