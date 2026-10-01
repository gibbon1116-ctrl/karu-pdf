import type { PDFDocument, Point, Quad, Rect, StructuredText } from 'mupdf'

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

  constructor(
    private readonly document: PDFDocument,
    private readonly limit = 20,
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
  }

  get size(): number { return this.entries.size }

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
