import type { PDFPage, Quad } from 'mupdf'

export interface SearchOptions {
  caseSensitive: boolean
  normalizeWidth: boolean
}

export interface SearchMatch {
  pageIndex: number
  quads: Quad[]
  before: string
  match: string
  after: string
}

export interface SearchPageResult {
  hasText: boolean
  matches: SearchMatch[]
}

interface TextCharacter {
  value: string
  quad: Quad | null
}

interface NormalizedText {
  value: string
  originalIndexes: number[]
}

export interface TextMatchRange { start: number; end: number }

function normalize(value: string, options: SearchOptions): string {
  const widthNormalized = options.normalizeWidth ? value.normalize('NFKC') : value
  return options.caseSensitive ? widthNormalized : widthNormalized.toLocaleLowerCase()
}

function normalizeCharacters(characters: readonly TextCharacter[], options: SearchOptions): NormalizedText {
  let value = ''
  const originalIndexes: number[] = []
  characters.forEach((character, originalIndex) => {
    const normalized = normalize(character.value, options)
    value += normalized
    for (let index = 0; index < normalized.length; index += 1) originalIndexes.push(originalIndex)
  })
  return { value, originalIndexes }
}

export function findTextMatchRanges(text: string, needle: string, options: SearchOptions): TextMatchRange[] {
  const characters = Array.from(text).map((value) => ({ value, quad: null }))
  const haystack = normalizeCharacters(characters, options)
  const normalizedNeedle = normalize(needle, options)
  if (!normalizedNeedle) return []
  const ranges: TextMatchRange[] = []
  let offset = 0
  for (;;) {
    const found = haystack.value.indexOf(normalizedNeedle, offset)
    if (found < 0) break
    const start = haystack.originalIndexes[found]
    const end = (haystack.originalIndexes[found + normalizedNeedle.length - 1] ?? start) + 1
    ranges.push({ start, end })
    offset = found + Math.max(1, normalizedNeedle.length)
  }
  return ranges
}

function collectCharacters(page: PDFPage): TextCharacter[] {
  const structured = page.toStructuredText('preserve-whitespace')
  const characters: TextCharacter[] = []
  let lineHasText = false
  try {
    structured.walk({
      beginLine: () => { lineHasText = false },
      onChar: (value, _origin, _font, _size, quad) => {
        characters.push({ value, quad: [...quad] as Quad })
        lineHasText = true
      },
      endLine: () => {
        if (lineHasText) characters.push({ value: '\n', quad: null })
      },
    })
  } finally {
    structured.destroy()
  }
  while (characters.at(-1)?.value === '\n') characters.pop()
  return characters
}

function mergeQuads(quads: readonly Quad[]): Quad[] {
  const lines: Array<{ top: number; bottom: number; left: number; right: number }> = []
  for (const quad of quads) {
    const left = Math.min(quad[0], quad[2], quad[4], quad[6])
    const right = Math.max(quad[0], quad[2], quad[4], quad[6])
    const top = Math.min(quad[1], quad[3], quad[5], quad[7])
    const bottom = Math.max(quad[1], quad[3], quad[5], quad[7])
    const line = lines.find((candidate) => Math.abs(candidate.top - top) < 2 && Math.abs(candidate.bottom - bottom) < 2)
    if (line) {
      line.left = Math.min(line.left, left)
      line.right = Math.max(line.right, right)
      line.top = Math.min(line.top, top)
      line.bottom = Math.max(line.bottom, bottom)
    } else lines.push({ left, right, top, bottom })
  }
  return lines.map(({ left, right, top, bottom }) => [left, top, right, top, left, bottom, right, bottom])
}

export function searchContext(text: string, start: number, end: number, radius = 15): Pick<SearchMatch, 'before' | 'match' | 'after'> {
  const characters = Array.from(text)
  const clean = (value: string) => value.replace(/\s+/g, ' ').trim()
  return {
    before: clean(characters.slice(Math.max(0, start - radius), start).join('')),
    match: clean(characters.slice(start, end).join('')),
    after: clean(characters.slice(end, Math.min(characters.length, end + radius)).join('')),
  }
}

function fallbackSearch(
  characters: readonly TextCharacter[],
  needle: string,
  options: SearchOptions,
  pageIndex: number,
  limit: number,
): SearchMatch[] {
  const haystack = normalizeCharacters(characters, options)
  const normalizedNeedle = normalize(needle, options)
  if (!normalizedNeedle) return []
  const originalText = characters.map((character) => character.value).join('')
  const matches: SearchMatch[] = []
  let offset = 0
  while (matches.length < limit) {
    const found = haystack.value.indexOf(normalizedNeedle, offset)
    if (found < 0) break
    const originalStart = haystack.originalIndexes[found]
    const originalEnd = (haystack.originalIndexes[found + normalizedNeedle.length - 1] ?? originalStart) + 1
    const quads = characters.slice(originalStart, originalEnd).flatMap((character) => character.quad ? [character.quad] : [])
    matches.push({ pageIndex, quads: mergeQuads(quads), ...searchContext(originalText, originalStart, originalEnd) })
    offset = found + Math.max(1, normalizedNeedle.length)
  }
  return matches
}

function needsFallback(needle: string, options: SearchOptions): boolean {
  if (options.normalizeWidth && needle.normalize('NFKC') !== needle) return true
  return !options.caseSensitive && needle.toLocaleLowerCase() !== needle.toLocaleUpperCase()
}

export function searchPage(
  page: PDFPage,
  pageIndex: number,
  needle: string,
  options: SearchOptions,
  limit = Number.POSITIVE_INFINITY,
): SearchPageResult {
  const characters = collectCharacters(page)
  const hasText = characters.some((character) => character.value.trim().length > 0)
  if (!needle || !hasText || limit <= 0) return { hasText, matches: [] }
  if (needsFallback(needle, options)) {
    return { hasText, matches: fallbackSearch(characters, needle, options, pageIndex, limit) }
  }

  const found = page.search(needle, {}).slice(0, limit)
  const originalText = characters.map((character) => character.value).join('')
  const contexts: Array<Pick<SearchMatch, 'before' | 'match' | 'after'>> = []
  let offset = 0
  while (contexts.length < found.length) {
    const index = originalText.indexOf(needle, offset)
    if (index < 0) break
    contexts.push(searchContext(originalText, index, index + Array.from(needle).length))
    offset = index + needle.length
  }
  return {
    hasText,
    matches: found.map((quads, index) => ({
      pageIndex,
      quads: quads.map((quad) => [...quad] as Quad),
      ...(contexts[index] ?? { before: '', match: needle, after: '' }),
    })),
  }
}
