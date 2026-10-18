import type { CalcResult } from './calcTypes'
import { constant, own } from './calcTypes'
import { deepEqual } from './conditions'
import { compare, isNegative, parseDecimal, sub, ZERO } from './decimal'
import { calculateUnitMethod, UNIT_METHOD_SPECS } from './unitMethods'

export interface MethodAcceptanceCase {
  caseId: string
  methodId: string
  kind: string
  input: Readonly<Record<string, unknown>>
  variables: readonly string[]
  values: readonly (number | string)[]
  expectedQuantity: number | null
  expectedUnit: string
  sourceStatus: string
  /** 呼び出し側がマスターから渡す。合成境界試験では明示的に [] を渡せる。 */
  requiredInputs: readonly string[]
  /** 試験側で明示した変換だけを追加する。例: BASE_FORM の対象面。 */
  calculationInputs?: Readonly<Record<string, unknown>>
  /** 自動判定対象外の一覧は試験側が管理する。実行器は推測しない。 */
  notAutomatableReason?: string
}

export interface MethodAcceptanceRow {
  caseId: string
  methodId: string
  /**
   * DEFERRED_TO_ADOPTION: 停止ケースだが、欠けた入力が価格・分担・採用の段階のもの（laterRequired）。
   * 指示書 CC26-16 に従い物理数量の参考検算は行い、正式採用の段階で止める（原本の停止ケースとの設計上の違いとして区別して記録）。
   */
  verdict: 'PASS' | 'FAIL' | 'NOT_AUTOMATABLE' | 'DEFERRED_TO_ADOPTION'
  reason: string
  reasonMatched: boolean | null
  changedKeys: string[]
  result: CalcResult | null
  /** 原本の状態は実行結果で上書きしない。 */
  sourceStatus: string
}

export function methodInputDifferences(
  baseline: Readonly<Record<string, unknown>>,
  current: Readonly<Record<string, unknown>>,
): string[] {
  const keys = [...new Set([...Object.keys(baseline), ...Object.keys(current)])]
  return keys.filter(key => !deepEqual(own(baseline, key), own(current, key)))
}

function matchesQuantity(actual: string | null, expected: number | null): boolean {
  if (actual === null || expected === null) return false
  const left = parseDecimal(actual)
  const right = parseDecimal(expected)
  if (!left.ok || !right.ok) return false

  const difference = sub(left.value, right.value)
  const absolute = isNegative(difference) ? sub(ZERO, difference) : difference
  return compare(absolute, constant('0.000000001')) <= 0
}

export function runMethodAcceptance(
  cases: readonly MethodAcceptanceCase[],
): MethodAcceptanceRow[] {
  const normalCases = new Map<string, MethodAcceptanceCase>()
  for (const entry of cases) {
    if (entry.kind === '正常・算定') normalCases.set(entry.methodId, entry)
  }

  return cases.map(entry => {
    const baseline = normalCases.get(entry.methodId)
    const changedKeys = baseline
      ? methodInputDifferences(baseline.input, entry.input)
      : []

    const baseRow = {
      caseId: entry.caseId,
      methodId: entry.methodId,
      changedKeys,
      sourceStatus: entry.sourceStatus,
    }

    if (entry.notAutomatableReason) {
      return {
        ...baseRow,
        verdict: 'NOT_AUTOMATABLE',
        reason: entry.notAutomatableReason,
        reasonMatched: null,
        result: null,
      }
    }

    const numericalBoundary = entry.kind === '横断・境界'
      && ['UAT-X-02', 'UAT-X-03', 'UAT-X-04'].includes(entry.caseId)

    if (entry.kind === '正常・参照'
      || (entry.kind === '横断・境界' && !numericalBoundary)) {
      return {
        ...baseRow,
        verdict: 'NOT_AUTOMATABLE',
        reason: '方式をまたぐ重複・工程・丸めの照査で、T3/T4 の試験で扱う。',
        reasonMatched: null,
        result: null,
      }
    }

    const method = Object.prototype.hasOwnProperty.call(UNIT_METHOD_SPECS, entry.methodId)
      ? UNIT_METHOD_SPECS[entry.methodId]
      : undefined

    const sourceValues = entry.kind === '異常・停止'
      ? baseline?.values ?? []
      : entry.values

    const values: Record<string, unknown> = {}
    method?.variables.forEach((variable, index) => {
      if (variable.kind !== 'ids' && index < sourceValues.length) {
        values[variable.key] = sourceValues[index]
      }
    })

    const result = calculateUnitMethod({
      methodId: entry.methodId,
      inputs: { ...entry.input, ...entry.calculationInputs },
      values,
      requiredInputs: entry.requiredInputs,
    })

    if (entry.kind === '異常・停止') {
      const messages = [...result.missing, ...result.errors]
      const reasonMatched = changedKeys.some(key =>
        messages.some(message => message.includes(key)),
      )
      const passed = result.status !== 'CALCULATED'
      const deferred = !passed && changedKeys.length > 0
        && changedKeys.every(key => result.laterRequired.includes(key))
      if (deferred) {
        return {
          ...baseRow,
          verdict: 'DEFERRED_TO_ADOPTION',
          reason: '参考値は算定し、価格・分担・採用の根拠の不足として正式採用の段階で停止する（CC26-16）。',
          reasonMatched: true,
          result,
        }
      }
      return {
        ...baseRow,
        verdict: passed ? 'PASS' : 'FAIL',
        reason: passed
          ? '実行して数量を停止した。'
          : '停止ケースから数量が算定された。',
        reasonMatched,
        result,
      }
    }

    const passed = result.status === 'CALCULATED'
      && matchesQuantity(result.value, entry.expectedQuantity)

    return {
      ...baseRow,
      verdict: passed ? 'PASS' : 'FAIL',
      reason: passed
        ? '実行した数量が期待数量と一致した。'
        : '算定状態または数量が期待と一致しない。',
      reasonMatched: null,
      result,
    }
  })
}
