import {
  CHECK_APPROX_TOLERANCE,
  CHECK_BASIS_SUGGESTIONS,
  CHECK_EQUAL_TOLERANCE,
  CHECK_QUANTITY_GROUPS,
  CHECK_ROWS,
  type CheckBasisKey,
  type CheckQuantityGroup,
  type CheckRow,
} from './breakdown/checkSheets'
import { quantityUnit, type CountFixture } from './countFixtures'
import {
  parseQuantityCheckBasics,
  type QuantityCheckBasics,
} from './quantityCheckBasics'

export {
  parseQuantityCheckBasics,
  serializeQuantityCheckBasics,
} from './quantityCheckBasics'
export type { QuantityCheckBasics } from './quantityCheckBasics'

export interface QuantityCheckResult {
  row: CheckRow
  group: CheckQuantityGroup
  quantity: number | undefined
  items: Array<{ id: string; code: string; name: string; total: number }>
  skippedUnits: string[]
  basis: number | undefined
  expected: { min?: number; max?: number } | undefined
  verdict: 'ok' | 'out' | 'noQuantity' | 'noBasis'
}

export const QUANTITY_CHECK_VERDICT_TEXT: Record<
  QuantityCheckResult['verdict'],
  string
> = {
  ok: 'OK',
  out: '範囲外',
  noQuantity: '数量なし',
  noBasis: '基本の値なし',
}

export function normalizeCheckUnit(unit: string): string {
  const value = unit.normalize('NFKC').replace(/\s+/gu, '').replace(/\^/gu, '')
  switch (value) {
    case 'm2': return '㎡'
    case 'm3': return '㎥'
    case 'm': return 'm'
    case 't': return 't'
    case 'か所':
    case 'ヶ所':
    case '箇所': return 'か所'
    default: return value
  }
}

/** 名前の一致・部分一致は OR、それ以外の指定条件とは AND。 */
export function matchesQuantityCheckGroup(
  fixture: CountFixture,
  group: CheckQuantityGroup,
): boolean {
  const position = fixture.breakdown
  if (position?.book !== '建築') return false
  if (!(group.sections ?? ['庁舎']).includes(position.section)) return false
  if (group.subjects && !group.subjects.includes(position.subject)) return false
  if (group.middles && !group.middles.includes(position.middle ?? '')) return false

  const name = fixture.name
  if (group.names !== undefined || group.nameIncludes !== undefined) {
    if (!group.names?.includes(name)
      && !group.nameIncludes?.some(word => name.includes(word))) return false
  }
  if (group.nameStartsWith
    && !group.nameStartsWith.some(word => name.startsWith(word))) return false
  if (group.nameExcludes?.some(word => name.includes(word))) return false
  return true
}

interface GroupQuantity {
  quantity: number | undefined
  items: QuantityCheckResult['items']
  skippedUnits: string[]
}

function collectQuantities(
  fixtures: readonly CountFixture[],
  total: (id: string) => number,
): Map<string, GroupQuantity> {
  // 同じ項目が複数の判定の根拠になる場合も、全図面の数量を一度だけ取得する。
  const totals = new Map<string, number>()
  const result = new Map<string, GroupQuantity>()
  for (const group of CHECK_QUANTITY_GROUPS) {
    const items: QuantityCheckResult['items'] = []
    const skippedUnits: string[] = []
    for (const fixture of fixtures) {
      if (!matchesQuantityCheckGroup(fixture, group)) continue
      if (normalizeCheckUnit(quantityUnit(fixture)) !== group.unit) {
        skippedUnits.push(fixture.name)
        continue
      }
      let value = totals.get(fixture.id)
      if (value === undefined) {
        value = total(fixture.id)
        if (!Number.isFinite(value)) {
          throw new RangeError(`${fixture.name}の全図面の数量が有限の数ではありません。`)
        }
        totals.set(fixture.id, value)
      }
      items.push({
        id: fixture.id,
        code: fixture.code,
        name: fixture.name,
        total: value,
      })
    }
    const quantity = items.length
      ? items.reduce((sum, item) => sum + item.total, 0) * (group.factor ?? 1)
      : undefined
    if (quantity !== undefined && !Number.isFinite(quantity)) {
      throw new RangeError(`${group.label}の合計が有限の数ではありません。`)
    }
    result.set(group.id, { quantity, items, skippedUnits })
  }
  return result
}

function expectedRange(
  row: CheckRow,
  basis: number | undefined,
): QuantityCheckResult['expected'] {
  if (basis === undefined) return
  let expected: NonNullable<QuantityCheckResult['expected']>
  switch (row.operator) {
    case '∈':
      if (!row.range) return
      expected = { min: basis * row.range[0], max: basis * row.range[1] }
      break
    case '≒':
      expected = {
        min: basis * (1 - CHECK_APPROX_TOLERANCE),
        max: basis * (1 + CHECK_APPROX_TOLERANCE),
      }
      break
    case '＝':
      expected = {
        min: basis * (1 - CHECK_EQUAL_TOLERANCE),
        max: basis * (1 + CHECK_EQUAL_TOLERANCE),
      }
      break
    case '≧':
      expected = { min: basis }
      break
    case '＜':
      expected = { max: basis }
      break
  }
  return Object.values(expected).every(Number.isFinite) ? expected : undefined
}

export function computeQuantityChecks(
  fixtures: readonly CountFixture[],
  total: (id: string) => number,
  basics: QuantityCheckBasics,
): QuantityCheckResult[] {
  const quantities = collectQuantities(fixtures, total)
  const groups = new Map(CHECK_QUANTITY_GROUPS.map(group => [group.id, group]))
  const valid = parseQuantityCheckBasics(basics)
  const values = {
    basis: (key: CheckBasisKey) => valid.values[key],
    quantity: (id: string) => quantities.get(id)?.quantity,
  }
  return CHECK_ROWS.map(row => {
    const group = groups.get(row.group)
    const collected = quantities.get(row.group)
    if (!group || !collected) {
      throw new Error(`チェックシートの内訳数量が見つかりません：${row.group}`)
    }
    const rawBasis = row.basis(values)
    const basis = rawBasis !== undefined && Number.isFinite(rawBasis)
      ? rawBasis : undefined
    const expected = expectedRange(row, basis)
    const quantity = collected.quantity
    let verdict: QuantityCheckResult['verdict']
    if (quantity === undefined) verdict = 'noQuantity'
    else if (basis === undefined || expected === undefined) verdict = 'noBasis'
    else {
      const inRange = (expected.min === undefined || quantity >= expected.min)
        && (expected.max === undefined
          || (row.operator === '＜'
            ? quantity < expected.max
            : quantity <= expected.max))
      verdict = inRange ? 'ok' : 'out'
    }
    return { row, group, ...collected, basis, expected, verdict }
  })
}

export function suggestCheckBasics(
  fixtures: readonly CountFixture[],
  total: (id: string) => number,
): Partial<Record<CheckBasisKey, number>> {
  const quantities = collectQuantities(fixtures, total)
  const suggestions: Partial<Record<CheckBasisKey, number>> = {}
  for (const [key, groupIds] of Object.entries(CHECK_BASIS_SUGGESTIONS)) {
    const candidates = groupIds.flatMap(id => {
      const value = quantities.get(id)?.quantity
      return value === undefined ? [] : [value]
    })
    if (candidates.length) {
      suggestions[key as CheckBasisKey] = Math.max(...candidates)
    }
  }
  return suggestions
}
