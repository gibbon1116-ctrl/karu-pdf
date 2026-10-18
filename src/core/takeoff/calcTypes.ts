import {
  compare,
  decimalToString,
  parseDecimal,
  ZERO,
  type Decimal,
} from './decimal'
import { isMissingFact } from './conditions'

export type CalcStatus =
  | 'CALCULATED'
  | 'INPUT_REQUIRED'
  | 'INVALID'
  | 'UNSUPPORTED'
  | 'NO_QUANTITY'

export interface CalcResult {
  status: CalcStatus
  value: string | null
  unit: string
  missing: string[]
  errors: string[]
  warnings: string[]
  reviewConditions: string[]
  steps: string[]
  laterRequired: string[]
}

export function calcResult(
  partial: Partial<CalcResult> & Pick<CalcResult, 'status' | 'unit'>,
): CalcResult {
  return {
    status: partial.status,
    value: partial.status === 'CALCULATED' ? partial.value ?? null : null,
    unit: partial.unit,
    missing: [...(partial.missing ?? [])],
    errors: [...(partial.errors ?? [])],
    warnings: [...(partial.warnings ?? [])],
    reviewConditions: [...(partial.reviewConditions ?? [])],
    steps: [...(partial.steps ?? [])],
    laterRequired: [...(partial.laterRequired ?? [])],
  }
}

/** 以下は計算モジュール内で共有する入力検査。生成マスターには依存しない。 */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function own(value: unknown, key: string): unknown {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key)
    ? value[key]
    : undefined
}

export function constant(value: string): Decimal {
  const parsed = parseDecimal(value)
  if (!parsed.ok) throw new TypeError(`内部定数が不正です: ${value}`)
  return parsed.value
}

export type NumberKind = 'decimal' | 'positive' | 'nonNegative'

export function createReader(unit: string) {
  const result = calcResult({ status: 'INPUT_REQUIRED', unit })

  function missing(path: string, label = path): void {
    if (!result.missing.includes(path)) {
      result.missing.push(path)
      result.errors.push(`${label}（${path}）が未入力です。0 として計算しません。`)
    }
  }

  function error(message: string): void {
    if (!result.errors.includes(message)) result.errors.push(message)
  }

  let invalid = false

  function fail(message: string): void {
    invalid = true
    error(message)
  }

  function text(value: unknown, path: string): string | null {
    if (isMissingFact(value)) {
      missing(path)
      return null
    }
    if (typeof value !== 'string') {
      fail(`${path} は空でない文字列で入力してください。`)
      return null
    }
    return value
  }

  function number(
    value: unknown,
    path: string,
    kind: NumberKind = 'nonNegative',
    label = path,
  ): Decimal | null {
    if (isMissingFact(value)) {
      missing(path, label)
      return null
    }

    const parsed = parseDecimal(value)
    if (!parsed.ok) {
      fail(`${path}: ${parsed.reason}。有限の10進数で入力してください。`)
      return null
    }

    const comparison = compare(parsed.value, ZERO)
    if ((kind === 'positive' && comparison <= 0)
      || (kind === 'nonNegative' && comparison < 0)) {
      fail(`${path} は ${kind === 'positive' ? '0 より大きい値' : '0 以上'}で入力してください。`)
      return null
    }
    return parsed.value
  }

  function array(value: unknown, path: string): readonly unknown[] | null {
    if (isMissingFact(value)) {
      missing(path)
      return null
    }
    if (!Array.isArray(value)) {
      fail(`${path} は1件以上の配列で入力してください。`)
      return null
    }
    return value
  }

  function ids(
    value: unknown,
    path: string,
    allowDuplicates = false,
  ): readonly string[] | null {
    const entries = array(value, path)
    if (!entries) return null

    const seen = new Set<string>()
    let valid = true
    entries.forEach((entry, index) => {
      const id = text(entry, `${path}[${index}]`)
      if (id === null) {
        valid = false
      } else if (seen.has(id)) {
        if (allowDuplicates) {
          result.warnings.push(`${path}: 重複ID ${id} は1回だけ数えます。`)
        } else {
          fail(`${path}: 同じ現物IDが2回あります（${id}）。`)
          valid = false
        }
      } else {
        seen.add(id)
      }
    })
    return valid ? [...seen] : null
  }

  function finish(value: Decimal | null): CalcResult {
    if (invalid) return calcResult({ ...result, status: 'INVALID' })
    if (result.missing.length > 0) {
      return calcResult({ ...result, status: 'INPUT_REQUIRED' })
    }
    if (value === null) {
      return calcResult({
        ...result,
        status: 'INVALID',
        errors: [...result.errors, '計算結果を確定できません。入力を確認してください。'],
      })
    }
    return calcResult({
      ...result,
      status: 'CALCULATED',
      value: decimalToString(value),
    })
  }

  return { result, missing, error, fail, text, number, array, ids, finish }
}
