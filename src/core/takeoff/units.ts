import { divPow10, mul, type Decimal } from './decimal'

export type Dimension =
  | 'length'
  | 'area'
  | 'volume'
  | 'mass'
  | 'count'
  | 'composite'
  | 'labor'
  | 'energy'
  | 'none'

const ALIASES: Readonly<Record<string, string>> = {
  '㎡': 'm2',
  'm²': 'm2',
  '㎥': 'm3',
  'm³': 'm3',
  '㎏': 'kg',
  'ｍ': 'm',
}

export function normalizeUnit(unit: string): string {
  return unit.trim().split('・').map(part =>
    Object.prototype.hasOwnProperty.call(ALIASES, part)
      ? ALIASES[part]!
      : part,
  ).join('・')
}

const DIMENSIONS: Readonly<Record<string, Dimension>> = {
  m: 'length',
  mm: 'length',
  cm: 'length',
  m2: 'area',
  mm2: 'area',
  m3: 'volume',
  kg: 'mass',
  t: 'mass',
  '個': 'count',
  '台': 'count',
  '組': 'count',
  '面': 'count',
  '本': 'count',
  '枚': 'count',
  'か所': 'count',
  '箇所': 'count',
  '基': 'count',
  '式': 'count',
  '台・日': 'composite',
  '人・日': 'composite',
  'm2・日': 'composite',
  'm3・日': 'composite',
  '台・回': 'composite',
  '工数': 'labor',
  kWh: 'energy',
  '': 'none',
  '—': 'none',
  '未確定': 'none',
}

export function unitDimension(unit: string): Dimension | undefined {
  const normalized = normalizeUnit(unit)
  return Object.prototype.hasOwnProperty.call(DIMENSIONS, normalized)
    ? DIMENSIONS[normalized]
    : undefined
}

export function sameUnit(a: string, b: string): boolean {
  return normalizeUnit(a) === normalizeUnit(b)
}

export function convertUnit(
  value: Decimal,
  from: string,
  to: string,
): { ok: true; value: Decimal } | { ok: false; reason: string } {
  const source = normalizeUnit(from)
  const target = normalizeUnit(to)

  if (source === target) return { ok: true, value }
  if (source === 'mm' && target === 'm') return { ok: true, value: divPow10(value, 3) }
  if (source === 'cm' && target === 'm') return { ok: true, value: divPow10(value, 2) }
  if (source === 'mm2' && target === 'm2') return { ok: true, value: divPow10(value, 6) }
  if (source === 'kg' && target === 't') return { ok: true, value: divPow10(value, 3) }
  if (source === 't' && target === 'kg') {
    return { ok: true, value: mul(value, { sign: 1, digits: 1000n, scale: 0 }) }
  }

  return { ok: false, reason: `${from} と ${to} は換算できません` }
}
