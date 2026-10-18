import { describe, expect, it } from 'vitest'
import {
  add,
  compare,
  decimalToString,
  divPow10,
  isNegative,
  isZero,
  mul,
  mulPi,
  parseDecimal,
  roundForDisplay,
  sub,
  ZERO,
  type Decimal,
} from '../src/core/takeoff/decimal'

function d(value: unknown): Decimal {
  const parsed = parseDecimal(value)
  if (!parsed.ok) throw new Error(parsed.reason)
  return parsed.value
}

describe('takeoff decimal', () => {
  it('calculates exact decimal arithmetic', () => {
    expect(decimalToString(add(d('0.1'), d('0.2')))).toBe('0.3')
    expect(decimalToString(sub(d('0.3'), d('0.1')))).toBe('0.2')
    expect(decimalToString(mul(d('1.2'), d('0.3')))).toBe('0.36')
    expect(decimalToString(add(d('-2'), d('0.5')))).toBe('-1.5')
    expect(compare(d('1.20'), d('1.2'))).toBe(0)
    expect(compare(d('-2'), d('-1'))).toBe(-1)
  })

  it('expands number exponents and canonicalizes strings', () => {
    expect(decimalToString(d(1e-7))).toBe('0.0000001')
    expect(decimalToString(d(1e21))).toBe('1000000000000000000000')
    expect(decimalToString(d(-1.25e-7))).toBe('-0.000000125')
    expect(decimalToString(d('  +1.250  '))).toBe('1.25')
    expect(decimalToString(d('-0'))).toBe('0')
    expect(decimalToString(d('-0.000'))).toBe('0')
    expect(isNegative(d('-0'))).toBe(false)
    expect(isZero(ZERO)).toBe(true)
  })

  it.each(['', ' ', null, undefined, NaN, Infinity, -Infinity, '1e3', '１２', 1n, true])(
    'rejects invalid input %s',
    value => expect(parseDecimal(value).ok).toBe(false),
  )

  it('distinguishes empty, nonnumeric and nonfinite inputs', () => {
    expect(parseDecimal('')).toEqual({ ok: false, reason: '空欄です' })
    expect(parseDecimal(null)).toEqual({ ok: false, reason: '数値ではありません' })
    expect(parseDecimal(NaN)).toEqual({ ok: false, reason: '有限の数ではありません' })
  })

  it('divides only by powers of ten', () => {
    expect(decimalToString(divPow10(d('5285'), 3))).toBe('5.285')
    expect(decimalToString(divPow10(d('1250'), 3))).toBe('1.25')
    expect(() => divPow10(d('1'), -1)).toThrow()
  })

  it('truncates pi products at 30 fractional places', () => {
    expect(decimalToString(mulPi(d('1'))))
      .toBe('3.141592653589793238462643383279')
    expect(decimalToString(mulPi(d('-1'))))
      .toBe('-3.141592653589793238462643383279')
    expect(decimalToString(mulPi(ZERO))).toBe('0')
  })

  it('rounds HALF_UP for display without changing the source', () => {
    const source = d('1.245')
    expect(roundForDisplay(decimalToString(source), 2)).toBe('1.25')
    expect(roundForDisplay('-1.245', 2)).toBe('-1.25')
    expect(roundForDisplay('9.995', 2)).toBe('10.00')
    expect(roundForDisplay('-0.004', 2)).toBe('0.00')
    expect(roundForDisplay('1', 2)).toBe('1.00')
    expect(decimalToString(source)).toBe('1.245')
    expect(() => roundForDisplay('1', -1)).toThrow()
  })
})
