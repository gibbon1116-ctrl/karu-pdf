import mupdf, { type PDFDocument, type PDFObject } from 'mupdf'
import type { Rect } from './annotations'
import { saveDocument } from './save'
import { openDocument } from './mupdfDoc'
import { stripJpegMetadata } from './exif'

export interface RedactionRegion { pageIndex: number; rect: Rect }
export interface SafeOutputOptions { redactions: RedactionRegion[] }

// Page resources may themselves contain metadata, actions, file references,
// optional content or hidden alternate representations. Do not copy those.
const removedKeys = new Set(['Metadata', 'PieceInfo', 'AF', 'EF', 'EmbeddedFiles', 'OpenAction', 'AA', 'JS', 'JavaScript', 'RichMediaContent', 'RichMediaSettings', 'Alternates', 'OPI', 'ActualText', 'Alt', 'SpiderInfo', 'StructTreeRoot'])
const actions = new Set(['JavaScript', 'Launch', 'URI', 'GoToR', 'GoToE', 'SubmitForm', 'ImportData', 'Rendition', 'Movie', 'Sound'])

function cleanDirectObject(object: PDFObject, depth = 0): void {
  if (depth > 100) throw new Error('PDFの構造が複雑なため共有用の安全処理を完了できません。')
  if (object.isIndirect()) return // Every indirect object is visited once below.
  if (object.isArray()) {
    object.forEach(value => { try { cleanDirectObject(value, depth + 1) } finally { value.destroy() } })
  } else if (object.isDictionary()) {
    const action = object.get('S')
    let active = false
    try { active = action.isName() && actions.has(action.asName()) } finally { action.destroy() }
    const keys: string[] = []
    object.forEach((value, key) => { keys.push(String(key)); value.destroy() })
    for (const key of keys) {
      if (active || removedKeys.has(key)) object.delete(key)
      else {
        const value = object.get(key)
        try { cleanDirectObject(value, depth + 1) } finally { value.destroy() }
      }
    }
  }
}

function cleanStream(object: PDFObject): void {
  if (!object.isStream()) return
  object.delete('F'); object.delete('FFilter'); object.delete('FDecodeParms')
  const subtype = object.get('Subtype'), filter = object.get('Filter')
  try {
    if (subtype.asName() !== 'Image') return
    if (filter.isArray()) {
      let jpeg = false
      filter.forEach(value => { try { if (value.asName() === 'DCTDecode') jpeg = true } finally { value.destroy() } })
      if (!jpeg) return
      if (filter.length !== 1) {
        // Decode composite filters to pixels, so compressed JPEG metadata cannot survive.
        const decoded = object.readStream()
        try { object.writeStream(decoded); object.delete('Filter'); object.delete('DecodeParms') } finally { decoded.destroy() }
        return
      }
    } else if (filter.asName() !== 'DCTDecode') return
    const buffer = object.readRawStream()
    try {
      const original = buffer.asUint8Array(), cleaned = stripJpegMetadata(original)
      if (cleaned !== original) object.writeRawStream(cleaned)
    } finally { buffer.destroy() }
  } finally { subtype.destroy(); filter.destroy() }
}

/** Explicit export only. Never modifies the editor's original document. */
export function createSafeOutput(source: PDFDocument, options: SafeOutputOptions): Uint8Array {
  const regions = [...options.redactions]
  // Existing standard redaction marks must also be applied before baking.
  for (let index = 0; index < source.countPages(); index++) {
    const page = source.loadPage(index)
    try {
      for (const annotation of page.getAnnotations()) {
        try { if (annotation.getType() === 'Redact') regions.push({ pageIndex: index, rect: [...annotation.getRect()] as Rect }) } finally { annotation.destroy() }
      }
    } finally { page.destroy() }
  }
  // Bake both annotations and form appearances before redacting, so their
  // visible text cannot survive separately underneath the black rectangle.
  source.bake(true, true)
  const grouped = new Map<number, Rect[]>()
  for (const region of regions) {
    if (!Number.isInteger(region.pageIndex) || region.pageIndex < 0 || region.pageIndex >= source.countPages() || region.rect.some(value => !Number.isFinite(value)) || region.rect[2] <= region.rect[0] || region.rect[3] <= region.rect[1]) throw new Error('墨消し範囲が不正です。')
    const rectangles = grouped.get(region.pageIndex) ?? []
    rectangles.push(region.rect); grouped.set(region.pageIndex, rectangles)
  }
  for (const [index, rectangles] of grouped) {
    const page = source.loadPage(index)
    try {
      for (const rect of rectangles) {
        const annotation = page.createAnnotation('Redact')
        try { annotation.setRect(rect); annotation.setColor([0, 0, 0]); annotation.update() } finally { annotation.destroy() }
      }
      // Pixel removal for images; remove every touching vector path and text.
      page.applyRedactions(true, 2, 2, 0)
    } finally { page.destroy() }
  }
  const output = new mupdf.PDFDocument()
  const graft = output.newGraftMap()
  try {
    for (let index = 0; index < source.countPages(); index++) {
      graft.graftPage(-1, source, index)
      const page = output.findPage(index)
      try { page.delete('Annots'); page.delete('AA'); page.delete('Metadata'); page.delete('PieceInfo') } finally { page.destroy() }
    }
    for (let index = 1; index < output.countObjects(); index++) {
      const indirect = output.newIndirect(index), object = indirect.resolve()
      try { cleanDirectObject(object); cleanStream(object) } finally { object.destroy(); indirect.destroy() }
    }
    const bytes = saveDocument(output, 'full').bytes
    const reopened = openDocument(bytes)
    try {
      const pdf = reopened.document.asPDF()!
      const trailer = pdf.getTrailer(), info = trailer.get('Info')
      try {
        if (reopened.pageCount !== source.countPages() || Object.keys(pdf.getEmbeddedFiles()).length || !info.isNull()) throw new Error('共有用PDFの検証に失敗しました。')
      } finally { info.destroy(); trailer.destroy() }
    } finally { reopened.document.destroy() }
    return bytes
  } finally { graft.destroy(); output.destroy() }
}
