import mupdf, { type Font } from 'mupdf'

export interface FontMetrics {
  unitsPerEm: number
  ascender: number
  ascent: number
}

export interface FontResource extends FontMetrics {
  font: Font
}

export interface EncodedCharacter {
  character: string
  glyph: number
  unicode: number
  advance: number
  replaced: boolean
}

function tableOffset(bytes: Uint8Array, wanted: string): number {
  if (bytes.byteLength < 12) throw new Error('TTF のオフセットテーブルが壊れています。')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tableCount = view.getUint16(4, false)
  for (let index = 0; index < tableCount; index += 1) {
    const record = 12 + index * 16
    if (record + 16 > bytes.byteLength) break
    const tag = String.fromCharCode(
      bytes[record], bytes[record + 1], bytes[record + 2], bytes[record + 3],
    )
    if (tag === wanted) return view.getUint32(record + 8, false)
  }
  throw new Error(`TTF に ${wanted} 表がありません。`)
}

export function readFontMetrics(bytes: Uint8Array): FontMetrics {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const head = tableOffset(bytes, 'head')
  const hhea = tableOffset(bytes, 'hhea')
  if (head + 20 > bytes.byteLength || hhea + 6 > bytes.byteLength) {
    throw new Error('TTF のメトリクス表が壊れています。')
  }
  const unitsPerEm = view.getUint16(head + 18, false)
  const ascender = view.getInt16(hhea + 4, false)
  if (unitsPerEm === 0) throw new Error('TTF の unitsPerEm が 0 です。')
  return { unitsPerEm, ascender, ascent: ascender / unitsPerEm }
}

export function createFontResource(bytes: Uint8Array): FontResource {
  return {
    font: new mupdf.Font('BIZUDGothic', bytes),
    ...readFontMetrics(bytes),
  }
}

export function encodeCharacter(font: Font, character: string): EncodedCharacter {
  let rendered = character
  let glyph = font.encodeCharacter(rendered)
  let replaced = false
  if (glyph === 0) {
    rendered = '〓'
    glyph = font.encodeCharacter(rendered)
    replaced = true
  }
  // MuPDF.js の advanceGlyph は実測でも型定義どおり em 単位
  // （BIZ UDゴシックでは全角が 1、半角 A が 0.5）を返す。
  return {
    character: rendered,
    glyph,
    unicode: rendered.codePointAt(0) ?? 0,
    advance: font.advanceGlyph(glyph),
    replaced,
  }
}

export function replaceMissingCharacters(font: Font, text: string): {
  text: string
  replacedCharacters: number
} {
  let replacedCharacters = 0
  let rendered = ''
  for (const character of [...text]) {
    if (character === '\n' || character === '\r' || character === '\t') {
      rendered += character
      continue
    }
    const encoded = encodeCharacter(font, character)
    rendered += encoded.character
    if (encoded.replaced) replacedCharacters += 1
  }
  return { text: rendered, replacedCharacters }
}
