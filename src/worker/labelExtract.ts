import type { Document, StructuredText, Rect as MuRect } from 'mupdf'
import { normalizeSymbolLabel, type SymbolLabel } from '../core/symbolLabels'
import type { Rect } from '../core/annotations'

/** MuPDF structured text already includes /Rotate, like the vector display list.
 * Subtract the displayed page origin; use character quads for individual words. */
export function labelsFromStructuredText(structured: StructuredText, bounds: MuRect): SymbolLabel[] {
  const labels: SymbolLabel[] = []
  let text = '', rect: Rect = [Infinity, Infinity, -Infinity, -Infinity]
  const flush = () => {
    const normalized = normalizeSymbolLabel(text)
    if (normalized && rect.every(Number.isFinite)) labels.push({ text: normalized, rect })
    text = ''; rect = [Infinity, Infinity, -Infinity, -Infinity]
  }
  structured.walk({
    beginLine: flush,
    onChar: (value, _origin, font, _size, quad) => {
      try {
        for (const c of value.normalize('NFKC')) {
          if (/\s/.test(c)) { flush(); continue }
          text += c
          for (let i = 0; i < 8; i += 2) {
            rect[0] = Math.min(rect[0], quad[i] - bounds[0]); rect[2] = Math.max(rect[2], quad[i] - bounds[0])
            rect[1] = Math.min(rect[1], quad[i + 1] - bounds[1]); rect[3] = Math.max(rect[3], quad[i + 1] - bounds[1])
          }
        }
      } finally { font.destroy() }
    },
    endLine: flush,
  })
  flush()
  return labels
}
export function extractLabelPage(document: Document, pageIndex: number): SymbolLabel[] {
  const page = document.loadPage(pageIndex)
  let list: ReturnType<typeof page.toDisplayList> | undefined, structured: StructuredText | undefined
  try {
    list = page.toDisplayList(false)
    structured = list.toStructuredText('preserve-whitespace')
    return labelsFromStructuredText(structured, page.getBounds())
  } finally { structured?.destroy(); list?.destroy(); page.destroy() }
}
