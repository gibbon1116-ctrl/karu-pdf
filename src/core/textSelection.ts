import type { PDFDocument, Point, Quad, Rect, StructuredText } from 'mupdf'
import { extractTextLines, type ExtractedPageText } from './textExtract'

export type TextSelectionMode = 'chars' | 'words' | 'lines'

export interface TextSelectionResult {
  quads: Quad[]
  text: string
}

interface CachedText {
  structured: StructuredText
  hasText: boolean
}

function pointInsideLeft(quad: Quad): Point {
  return [quad[0] + 0.5, (quad[1] + quad[5]) / 2]
}

function pointInsideRight(quad: Quad): Point {
  return [quad[2] - 0.5, (quad[3] + quad[7]) / 2]
}

export class StructuredTextCache {
  private readonly entries = new Map<number, CachedText>()
  private exports: Map<number, { text: ExtractedPageText; bytes: number }> | undefined
  private exportBytes = 0

  constructor(
    private readonly document: PDFDocument,
    private readonly limit = 20,
    private readonly exportLimitBytes = 4 * 1024 * 1024,
  ) {}

  pageHasText(pageIndex: number): boolean {
    return this.get(pageIndex).hasText
  }

  pageTextLines(pageIndex: number): Rect[] {
    const { structured, hasText } = this.get(pageIndex)
    if (!hasText) return []
    const lines: Rect[] = []
    let bbox: Rect | null = null
    let hasVisibleText = false
    structured.walk({
      beginLine: (lineBox) => {
        bbox = [...lineBox] as Rect
        hasVisibleText = false
      },
      onChar: (value) => {
        if (value.trim().length > 0) hasVisibleText = true
      },
      endLine: () => {
        if (bbox && hasVisibleText) lines.push(bbox)
        bbox = null
      },
    })
    return lines
  }

  extractPage(pageIndex: number): ExtractedPageText {
    if (!this.document.hasPermission('copy')) throw new Error('PDFの文字コピーが許可されていません。')
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= this.document.countPages()) throw new Error('抽出するページがありません。')
    const exported = this.exports?.get(pageIndex)
    if (exported) {
      this.exports!.delete(pageIndex); this.exports!.set(pageIndex, exported)
      return exported.text
    }
    const page = this.document.loadPage(pageIndex)
    const cached = this.entries.get(pageIndex)
    let structured: StructuredText | null = null
    try {
      structured = cached?.structured ?? page.toStructuredText('preserve-whitespace')
      const pageObject = page.getObject()
      const rotation = pageObject.getInheritable('Rotate')
      try {
        const text = extractTextLines(structured, page.getBounds(), rotation.asNumber())
        // Keep only bounded JS results, not whole-document StructuredText pages.
        const bytes = 256 + text.lines.reduce((sum, line) => sum + 320 + line.text.length * 2, 0)
        if (bytes <= this.exportLimitBytes) {
          this.exports ??= new Map()
          this.exports.set(pageIndex, { text, bytes }); this.exportBytes += bytes
          while (this.exportBytes > this.exportLimitBytes) {
            const oldest = this.exports.entries().next().value!
            this.exports.delete(oldest[0]); this.exportBytes -= oldest[1].bytes
          }
        }
        return text
      }
      finally { rotation.destroy(); pageObject.destroy() }
    } finally {
      // Reuse a selection's cached page, but do not fill that cache by exporting
      // a whole document. At most one uncached page is alive for this operation.
      if (!cached) structured?.destroy()
      page.destroy()
    }
  }

  select(
    pageIndex: number,
    from: Point,
    to: Point,
    mode: TextSelectionMode,
  ): TextSelectionResult {
    const { structured, hasText } = this.get(pageIndex)
    if (!hasText) return { quads: [], text: '' }
    if (mode === 'chars') {
      return {
        quads: structured.highlight(from, to, 10_000),
        text: structured.copy(from, to),
      }
    }
    const snapped = structured.snap(from, to, mode)
    const start = pointInsideLeft(snapped)
    const end = pointInsideRight(snapped)
    return {
      quads: structured.highlight(start, end, 10_000),
      text: structured.copy(start, end),
    }
  }

  destroy(): void {
    for (const entry of this.entries.values()) entry.structured.destroy()
    this.entries.clear()
    this.exports?.clear(); this.exports = undefined; this.exportBytes = 0
  }

  get size(): number { return this.entries.size }
  get extractedCacheBytes(): number { return this.exportBytes }

  private get(pageIndex: number): CachedText {
    const cached = this.entries.get(pageIndex)
    if (cached) {
      this.entries.delete(pageIndex)
      this.entries.set(pageIndex, cached)
      return cached
    }
    const page = this.document.loadPage(pageIndex)
    let structured: StructuredText
    try {
      structured = page.toStructuredText('preserve-whitespace')
    } finally {
      page.destroy()
    }
    const entry = { structured, hasText: structured.asText().trim().length > 0 }
    this.entries.set(pageIndex, entry)
    while (this.entries.size > this.limit) {
      const oldest = this.entries.entries().next().value as [number, CachedText] | undefined
      if (!oldest) break
      this.entries.delete(oldest[0])
      oldest[1].structured.destroy()
    }
    return entry
  }
}
