export interface Decimal {
  readonly sign: 1 | -1
  readonly digits: bigint
  readonly scale: number
}

export type DecimalParse =
  | { ok: true; value: Decimal }
  | { ok: false; reason: string }

export const ZERO: Decimal = Object.freeze({
  sign: 1,
  digits: 0n,
  scale: 0,
})

function power10(exponent: number): bigint {
  if (!Number.isSafeInteger(exponent) || exponent < 0) {
    throw new RangeError('指数は0以上の安全な整数で指定してください')
  }
  return 10n ** BigInt(exponent)
}

function canonical(sign: 1 | -1, digits: bigint, scale: number): Decimal {
  if (!Number.isSafeInteger(scale) || scale < 0 || digits < 0n) {
    throw new RangeError('10進数の内部表現が不正です')
  }
  if (digits === 0n) return ZERO
  while (scale > 0 && digits % 10n === 0n) {
    digits /= 10n
    scale -= 1
  }
  return { sign, digits, scale }
}

function expandNumber(value: number): string {
  const text = String(value)
  if (!/[eE]/.test(text)) return text

  const match = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(text)
  if (!match) throw new Error('有限数の指数表記を展開できません')

  const sign = match[1] ?? ''
  const integer = match[2] ?? ''
  const fraction = match[3] ?? ''
  const exponent = Number(match[4])
  const digits = integer + fraction
  const point = integer.length + exponent

  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`
  if (point >= digits.length) {
    return sign + digits + '0'.repeat(point - digits.length)
  }
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`
}

export function parseDecimal(input: unknown): DecimalParse {
  let text: string

  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      return { ok: false, reason: '有限の数ではありません' }
    }
    text = expandNumber(input)
  } else if (typeof input === 'string') {
    text = input.trim()
    if (text === '') return { ok: false, reason: '空欄です' }
  } else {
    return { ok: false, reason: '数値ではありません' }
  }

  if (!/^[+-]?\d+(\.\d+)?$/.test(text)) {
    return { ok: false, reason: '数値ではありません' }
  }

  const sign: 1 | -1 = text.startsWith('-') ? -1 : 1
  const unsigned = text.replace(/^[+-]/, '')
  const [integer = '', fraction = ''] = unsigned.split('.')

  return {
    ok: true,
    value: canonical(sign, BigInt(integer + fraction), fraction.length),
  }
}

export function decimalToString(value: Decimal): string {
  const normalized = canonical(value.sign, value.digits, value.scale)
  if (normalized.digits === 0n) return '0'

  const digits = normalized.digits.toString()
    .padStart(normalized.scale + 1, '0')
  const prefix = normalized.sign === -1 ? '-' : ''
  if (normalized.scale === 0) return prefix + digits

  const point = digits.length - normalized.scale
  return `${prefix}${digits.slice(0, point)}.${digits.slice(point)}`
}

function signedAt(value: Decimal, scale: number): bigint {
  return BigInt(value.sign) * value.digits * power10(scale - value.scale)
}

function fromSigned(value: bigint, scale: number): Decimal {
  return canonical(value < 0n ? -1 : 1, value < 0n ? -value : value, scale)
}

export function add(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.scale, b.scale)
  return fromSigned(signedAt(a, scale) + signedAt(b, scale), scale)
}

export function sub(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.scale, b.scale)
  return fromSigned(signedAt(a, scale) - signedAt(b, scale), scale)
}

export function mul(a: Decimal, b: Decimal): Decimal {
  return canonical(a.sign === b.sign ? 1 : -1, a.digits * b.digits, a.scale + b.scale)
}

export function divPow10(a: Decimal, exponent: number): Decimal {
  power10(exponent)
  return canonical(a.sign, a.digits, a.scale + exponent)
}

const PI: Decimal = {
  sign: 1,
  digits: 31415926535897932384626433832795028841971n,
  scale: 40,
}

export function mulPi(a: Decimal): Decimal {
  const product = mul(a, PI)
  if (product.scale <= 30) return product
  return canonical(
    product.sign,
    product.digits / power10(product.scale - 30),
    30,
  )
}

export function compare(a: Decimal, b: Decimal): -1 | 0 | 1 {
  const scale = Math.max(a.scale, b.scale)
  const left = signedAt(a, scale)
  const right = signedAt(b, scale)
  return left < right ? -1 : left > right ? 1 : 0
}

export function isZero(a: Decimal): boolean {
  return a.digits === 0n
}

export function isNegative(a: Decimal): boolean {
  return a.sign === -1 && !isZero(a)
}

export function roundForDisplay(value: string, digits: number): string {
  if (!Number.isSafeInteger(digits) || digits < 0) {
    throw new RangeError('表示桁数は0以上の安全な整数で指定してください')
  }

  const parsed = parseDecimal(value)
  if (!parsed.ok) throw new TypeError(parsed.reason)

  const decimal = parsed.value
  let magnitude: bigint

  if (decimal.scale <= digits) {
    magnitude = decimal.digits * power10(digits - decimal.scale)
  } else {
    const divisor = power10(decimal.scale - digits)
    magnitude = decimal.digits / divisor
    if ((decimal.digits % divisor) * 2n >= divisor) magnitude += 1n
  }

  const prefix = decimal.sign === -1 && magnitude !== 0n ? '-' : ''
  const text = magnitude.toString().padStart(digits + 1, '0')
  if (digits === 0) return prefix + text

  return `${prefix}${text.slice(0, -digits)}.${text.slice(-digits)}`
}
