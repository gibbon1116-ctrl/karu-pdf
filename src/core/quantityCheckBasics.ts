import type { PDFDocument } from 'mupdf'
import type { CheckBasisKey } from './breakdown/checkSheets'

export interface QuantityCheckBasics {
  values: Partial<Record<CheckBasisKey, number>>
}

// 保存・読込ではチェックシートのデータを実行時に読み込まない。
const BASIS_KEYS: readonly CheckBasisKey[] = [
  'buildingArea',
  'totalFloorArea',
  'perimeter',
  'parapetHeight',
  'floorsAbove',
  'firstFloorArea',
  'steelFloorArea',
  'stairCount',
  'gravelThickness',
  'leanConcreteThickness',
]

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

export function parseQuantityCheckBasics(raw: unknown): QuantityCheckBasics {
  let decoded = raw
  if (typeof decoded === 'string') {
    try { decoded = JSON.parse(decoded) }
    catch { return { values: {} } }
  }
  const envelope = record(decoded)
  if (!envelope) return { values: {} }

  // アプリ内の { values } と、PDF の version 1 の保存形式を受け付ける。
  const source = envelope.version === 1
    ? record(envelope.basics)
    : envelope.version === undefined
      ? record(envelope.values)
      : undefined
  const values: QuantityCheckBasics['values'] = {}
  if (!source) return { values }
  for (const key of BASIS_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      values[key] = value
    }
  }
  return { values }
}

export function serializeQuantityCheckBasics(basics: QuantityCheckBasics): string {
  return JSON.stringify({
    version: 1,
    basics: parseQuantityCheckBasics(basics).values,
  })
}

export function readQuantityChecks(doc: PDFDocument): QuantityCheckBasics {
  const trailer = doc.getTrailer()
  const root = trailer.get('Root')
  try {
    const value = root.get('KaruQuantityChecks')
    try {
      return value.isString()
        ? parseQuantityCheckBasics(value.asString())
        : { values: {} }
    } finally { value.destroy() }
  } finally { root.destroy(); trailer.destroy() }
}

export function writeQuantityChecks(
  doc: PDFDocument,
  basics: QuantityCheckBasics,
): void {
  const valid = parseQuantityCheckBasics(basics)
  const trailer = doc.getTrailer()
  const root = trailer.get('Root')
  try {
    if (!Object.keys(valid.values).length) {
      root.delete('KaruQuantityChecks')
      return
    }
    const value = doc.newString(serializeQuantityCheckBasics(valid))
    try { root.put('KaruQuantityChecks', value) }
    finally { value.destroy() }
  } finally { root.destroy(); trailer.destroy() }
}
