import type { Point, Rect, StructuredText } from 'mupdf'

export interface ExtractedTextLine {
  line: number
  text: string
  rect: Rect
  writingMode: number
  direction: Point
}

export interface ExtractedPageText {
  bounds: Rect
  rotation: number
  lines: ExtractedTextLine[]
  truncated: boolean
  invalidPositions: number
  uncertainCharacters: boolean
}

export const TEXT_PAGE_LIMITS = { characters: 200_000, lines: 20_000 } as const

// A page is visited only on an explicit extraction request. Bound the message
// size, preserve MuPDF reading order, and never invent characters or locations.
export function extractTextLines(
  structured: StructuredText,
  bounds: Rect,
  rotation: number,
  limits: { characters?: number; lines?: number } = {},
): ExtractedPageText {
  if (!bounds.every(Number.isFinite) || bounds[2] <= bounds[0] || bounds[3] <= bounds[1]) throw new Error('ページの寸法を取得できませんでした。')
  const maxCharacters = Math.max(1, Math.min(TEXT_PAGE_LIMITS.characters, limits.characters ?? TEXT_PAGE_LIMITS.characters))
  const maxLines = Math.max(1, Math.min(TEXT_PAGE_LIMITS.lines, limits.lines ?? TEXT_PAGE_LIMITS.lines))
  const result: ExtractedPageText = { bounds, rotation, lines: [], truncated: false, invalidPositions: 0, uncertainCharacters: false }
  let line = 0, characters = 0
  let rect: Rect | null = null, direction: Point = [1, 0], writingMode = 0
  let values: string[] = [], partial = false
  structured.walk({
    beginLine: (box, mode, dir) => {
      line++
      rect = [...box] as Rect
      direction = [...dir] as Point
      writingMode = mode
      values = []; partial = false
    },
    onChar: (value, _origin, font) => {
      // MuPDF 1.28.1 constructs an owned Font wrapper for every character.
      // Release that reference immediately instead of waiting for finalizers.
      try {
        if (characters + value.length > maxCharacters || result.lines.length >= maxLines) {
          result.truncated = true; partial = true; return
        }
        characters += value.length
        values.push(value)
        if (/[\uFFFD\uE000-\uF8FF]/.test(value)) result.uncertainCharacters = true
      } finally {
        font.destroy()
      }
    },
    endLine: () => {
      const text = values.join('')
      // A partial line's original bbox would describe text not exported.
      if (partial || !text.trim() || !rect) return
      if (![...rect, ...direction].every(Number.isFinite) || rect[2] < rect[0] || rect[3] < rect[1]) { result.invalidPositions++; return }
      result.lines.push({ line, text, rect, writingMode, direction })
    },
  })
  // Do not mix unverified character decoding with partial geometry. Native
  // text for an over-limit page could itself allocate an unbounded string.
  if (result.truncated || result.invalidPositions) { result.lines = []; return result }
  if (!result.truncated && !result.invalidPositions) {
    // This MuPDF version's JS walk uses String.fromCharCode for Unicode
    // codepoints. Native UTF-8 output preserves supplementary characters.
    // Associate only matching, non-empty native lines with the walked boxes.
    const native = structured.asText().split(/\r?\n/).filter(text => text.trim())
    if (native.length !== result.lines.length) throw new Error('文字列と図面上の位置を安全に対応付けられないページです。')
    result.uncertainCharacters = false
    let count = 0
    for (let index = 0; index < native.length; index++) {
      count += native[index].length
      if (count > maxCharacters) { result.lines.splice(index); result.truncated = true; break }
      result.lines[index].text = native[index]
      if (/[\uFFFD\uE000-\uF8FF]/.test(native[index])) result.uncertainCharacters = true
    }
  }
  return result
}
