import type { CheckBasisKey } from '../core/breakdown/checkSheets'
import type { CountFixture } from '../core/countFixtures'
import {
  computeQuantityChecks,
  QUANTITY_CHECK_VERDICT_TEXT,
  suggestCheckBasics,
  type QuantityCheckBasics,
  type QuantityCheckResult,
} from '../core/quantityChecks'
import './QuantityChecks.css'

export interface QuantityCheckColumnLine {
  id: string
  text: string
  title: string
  out: boolean
}

export interface QuantityCheckColumnData {
  results: QuantityCheckResult[]
  suggestions: Partial<Record<CheckBasisKey, number>>
  byFixture: Map<string, QuantityCheckColumnLine[]>
  error: string
}

function format(value: number | undefined): string {
  return value === undefined ? '—' : value.toFixed(2)
}

function expectedText(result: QuantityCheckResult): string {
  const expected = result.expected
  if (!expected) return '—'
  const unit = result.group.unit
  if (expected.min !== undefined && expected.max !== undefined) {
    return `${format(expected.min)} 〜 ${format(expected.max)} ${unit}`
  }
  if (expected.min !== undefined) return `≧ ${format(expected.min)} ${unit}`
  return `${result.row.operator === '＜' ? '＜' : '≦'} ${format(expected.max)} ${unit}`
}

/** Reuse the existing calculations; index only results that actually include an item. */
export function computeQuantityCheckColumn(
  fixtures: readonly CountFixture[],
  total: (id: string) => number,
  basics: QuantityCheckBasics,
): QuantityCheckColumnData {
  try {
    const results = computeQuantityChecks(fixtures, total, basics)
    const suggestions = suggestCheckBasics(fixtures, total)
    const byFixture = new Map<string, QuantityCheckColumnLine[]>()
    for (const result of results) {
      const line: QuantityCheckColumnLine = {
        id: result.row.id,
        text: `${result.group.label}: ${QUANTITY_CHECK_VERDICT_TEXT[result.verdict]}`,
        title: [
          result.group.label,
          `チェック項目：${result.row.operator} ${result.row.basisText}`,
          `内訳数量（合計）：${format(result.quantity)} ${result.group.unit}`,
          `判定の範囲：${expectedText(result)}`,
        ].join('\n'),
        out: result.verdict === 'out',
      }
      for (const id of new Set(result.items.map(item => item.id))) {
        const lines = byFixture.get(id)
        if (lines) lines.push(line)
        else byFixture.set(id, [line])
      }
    }
    return { results, suggestions, byFixture, error: '' }
  } catch (error) {
    return {
      results: [],
      suggestions: {},
      byFixture: new Map(),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
