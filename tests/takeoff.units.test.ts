import { describe, expect, it } from 'vitest'
import { decimalToString, parseDecimal } from '../src/core/takeoff/decimal'
import {
  convertUnit,
  normalizeUnit,
  sameUnit,
  unitDimension,
} from '../src/core/takeoff/units'

function convert(value: string, from: string, to: string): string | null {
  const parsed = parseDecimal(value)
  if (!parsed.ok) throw new Error(parsed.reason)
  const result = convertUnit(parsed.value, from, to)
  return result.ok ? decimalToString(result.value) : null
}

describe('takeoff units', () => {
  it('normalizes only explicit aliases', () => {
    expect(normalizeUnit(' ㎡ ')).toBe('m2')
    expect(normalizeUnit('m²')).toBe('m2')
    expect(normalizeUnit('㎏')).toBe('kg')
    expect(normalizeUnit('ｍ')).toBe('m')
    expect(normalizeUnit('㎡・日')).toBe('m2・日')
    expect(normalizeUnit('m³・日')).toBe('m3・日')
    expect(normalizeUnit('箇所')).toBe('箇所')
    expect(sameUnit('㎡', 'm2')).toBe(true)
    expect(sameUnit('台', '個')).toBe(false)
  })

  it('converts the permitted directions exactly', () => {
    expect(convert('5285', 'mm', 'm')).toBe('5.285')
    expect(convert('125', 'cm', 'm')).toBe('1.25')
    expect(convert('1250000', 'mm2', 'm2')).toBe('1.25')
    expect(convert('1250', 'kg', 't')).toBe('1.25')
    expect(convert('1.25', 't', 'kg')).toBe('1250')
    expect(convert('1.25', 'm', 'm')).toBe('1.25')
  })

  it('does not infer conversions from dimensions or similar names', () => {
    expect(convert('1', '台', '個')).toBeNull()
    expect(convert('1', 'm2', 'm')).toBeNull()
    expect(convert('1', 'm', 'mm')).toBeNull()
    expect(convert('1', 'か所', '箇所')).toBeNull()
  })

  it('classifies all special dimensions', () => {
    expect(unitDimension('—')).toBe('none')
    expect(unitDimension('未確定')).toBe('none')
    expect(unitDimension('')).toBe('none')
    expect(unitDimension('工数')).toBe('labor')
    expect(unitDimension('台・日')).toBe('composite')
    expect(unitDimension('kWh')).toBe('energy')
    expect(unitDimension('個')).toBe('count')
    expect(unitDimension('unknown')).toBeUndefined()
    expect(unitDimension('__proto__')).toBeUndefined()
  })
})
