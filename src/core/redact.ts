import mupdf, { PDFPage, type PDFDocument, type PDFObject, type Quad, type Rect } from 'mupdf'
import { configureRedact } from './annotations'

export type RedactLineArtMode = 'covered' | 'touched'
export interface RedactOptions { lineArt: RedactLineArtMode; removeDocumentInfo: boolean }
export interface RedactStats { areas: number; pages: number; removedLinks: number }

interface Area { rect: Rect; quads: Quad[] | null }

function quadBounds(quad: Quad): Rect {
  return [Math.min(quad[0], quad[2], quad[4], quad[6]), Math.min(quad[1], quad[3], quad[5], quad[7]),
    Math.max(quad[0], quad[2], quad[4], quad[6]), Math.max(quad[1], quad[3], quad[5], quad[7])]
}
function regions(areas: readonly Area[]): Rect[] {
  return areas.flatMap(area => area.quads?.length ? area.quads.map(quadBounds) : [area.rect])
}
function overlaps(a: Rect, b: Rect): boolean {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]
}
function removeKaruKeys(object: PDFObject): void {
  const keys: string[] = []
  object.forEach((value, key) => {
    try { if (typeof key === 'string' && key.startsWith('Karu')) keys.push(key) } finally { value.destroy() }
  })
  for (const key of keys) object.delete(key)
}

// Links are not included in PDFPage.getAnnotations(). Work on the Annots array,
// in page coordinates, including rotated pages. Count before MuPDF can remove them.
function overlappingLinks(page: PDFPage, boxes: readonly Rect[], remove: boolean): number {
  const object = page.getObject(), annots = object.get('Annots')
  let count = 0
  try {
    for (let index = annots.length - 1; index >= 0; index--) {
      const annot = annots.get(index), subtype = annot.get('Subtype'), raw = annot.get('Rect')
      try {
        if (subtype.asName() !== 'Link' || raw.length !== 4) continue
        const rect = Array.from({ length: 4 }, (_, i) => {
          const value = raw.get(i)
          try { return value.asNumber() } finally { value.destroy() }
        }) as Rect
        if (!boxes.some(box => overlaps(mupdf.Rect.transform(rect, page.getTransform()), box))) continue
        count++
        if (remove) annots.delete(index)
      } finally { raw.destroy(); subtype.destroy(); annot.destroy() }
    }
  } finally { annots.destroy(); object.destroy() }
  return count
}

/** Mutates only the caller's disposable output copy. Never save this incrementally. */
export function redactDocument(document: PDFDocument, options: RedactOptions): RedactStats {
  if (options.lineArt !== 'covered' && options.lineArt !== 'touched') throw new Error('線の消し方が正しくありません。')
  const byPage = new Map<number, Area[]>()
  const stats: RedactStats = { areas: 0, pages: 0, removedLinks: 0 }
  // Collect every page before making changes; malformed redactions must fail closed.
  for (let index = 0; index < document.countPages(); index++) {
    const page = document.loadPage(index)
    try {
      const areas: Area[] = []
      for (const annotation of [...page.getAnnotations()]) {
        try {
          if (annotation.getType() !== 'Redact') continue
          const rect = annotation.getRect(), quads = annotation.getQuadPoints()
          if (!rect.every(Number.isFinite) || rect[0] >= rect[2] || rect[1] >= rect[3]
            || quads.some(quad => quad.length !== 8 || !quad.every(Number.isFinite))) {
            throw new Error(`${index + 1}ページの墨消しの範囲が正しくありません。`)
          }
          areas.push({ rect: [...rect], quads: quads.length ? quads.map(quad => [...quad] as Quad) : null })
        } finally { annotation.destroy() }
      }
      if (areas.length) {
        byPage.set(index, areas)
        stats.areas += areas.length
        stats.removedLinks += overlappingLinks(page, regions(areas), false)
      }
    } finally { page.destroy() }
  }
  if (!stats.areas) throw new Error('墨消しの範囲がありません。')
  stats.pages = byPage.size

  for (const index of byPage.keys()) {
    const page = document.loadPage(index)
    try {
      for (const annotation of [...page.getAnnotations()]) {
        try { if (annotation.getType() === 'Redact') page.deleteAnnotation(annotation) }
        finally { annotation.destroy() }
      }
    } finally { page.destroy() }
  }
  document.bake(true, true)

  for (const [index, areas] of byPage) {
    const page = document.loadPage(index)
    try {
      for (const area of areas) {
        const annotation = page.createAnnotation('Redact')
        try { configureRedact(annotation, area.rect, area.quads, page) } finally { annotation.destroy() }
      }
      page.applyRedactions(true, PDFPage.REDACT_IMAGE_PIXELS,
        options.lineArt === 'covered' ? PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED : PDFPage.REDACT_LINE_ART_REMOVE_IF_TOUCHED,
        PDFPage.REDACT_TEXT_REMOVE)
      overlappingLinks(page, regions(areas), true)
      for (const annotation of [...page.getAnnotations()]) {
        try { if (annotation.getType() === 'Redact') page.deleteAnnotation(annotation) }
        finally { annotation.destroy() }
      }
    } finally { page.destroy() }
  }

  const trailer = document.getTrailer(), root = trailer.get('Root')
  try {
    removeKaruKeys(root)
    if (options.removeDocumentInfo) {
      const info = trailer.get('Info')
      try { if (!info.isNull()) for (const key of ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer']) info.delete(key) }
      finally { info.destroy() }
      root.delete('Metadata')
    }
  } finally { root.destroy(); trailer.destroy() }
  for (let index = 0; index < document.countPages(); index++) {
    const object = document.findPage(index)
    try { removeKaruKeys(object) } finally { object.destroy() }
  }

  for (const [index, areas] of byPage) {
    const page = document.loadPage(index)
    try {
      const text = page.toStructuredText({}), boxes = regions(areas)
      try {
        text.walk({ onChar: (_char, _origin, _font, _size, quad) => {
          const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4
          const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4
          if (boxes.some(box => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3])) {
            throw new Error(`墨消しを確認できませんでした（${index + 1}ページの範囲に文字が残っています）。`)
          }
        } })
      } finally { text.destroy() }
    } finally { page.destroy() }
  }
  return stats
}
