export interface LayoutInput {
  text: string
  fontSize: number
  boxWidth: number
  advance: (ch: string) => number
  ascent: number
}

export interface LayoutLine {
  text: string
  x: number
  baseline: number
}

export interface LayoutResult {
  lines: LayoutLine[]
  height: number
}

export const PADDING = 2
export const LINE_HEIGHT_RATIO = 1.2

const CANNOT_START_LINE = new Set([
  ...'、。，．・：；？！゛゜ヽヾゝゞ々ー）］｝」』】〕〉》”’ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ',
  ')', ']', '}', ',', '.', ':', ';', '!', '?',
])

const CANNOT_END_LINE = new Set([
  ...'（［｛「『【〔〈《“‘',
  '(', '[', '{',
])

function lineWidth(text: string, advance: (ch: string) => number): number {
  let width = 0
  for (const ch of [...text]) width += advance(ch)
  return width
}

function wrapParagraph(
  paragraph: string,
  maxWidthEm: number,
  advance: (ch: string) => number,
): string[] {
  const characters = [...paragraph]
  if (characters.length === 0) return ['']

  const lines: string[] = []
  let current: string[] = []
  let currentWidth = 0

  for (const character of characters) {
    const width = advance(character)
    if (current.length === 0 || currentWidth + width <= maxWidthEm) {
      current.push(character)
      currentWidth += width
      continue
    }

    let next = [character]
    if (
      current.length > 1
      && (CANNOT_START_LINE.has(character) || CANNOT_END_LINE.has(current[current.length - 1]))
    ) {
      next = [current.pop()!, character]
    }

    lines.push(current.join(''))
    current = next
    currentWidth = lineWidth(current.join(''), advance)
  }

  lines.push(current.join(''))
  return lines
}

export function layoutText(input: LayoutInput): LayoutResult {
  const normalized = input.text.replace(/\r\n?/g, '\n').replace(/\t/g, ' ')
  const availableWidth = Math.max(0, input.boxWidth - 2 * PADDING)
  const maxWidthEm = input.fontSize > 0 ? availableWidth / input.fontSize : 0
  const textLines = normalized
    .split('\n')
    .flatMap((paragraph) => wrapParagraph(paragraph, maxWidthEm, input.advance))
  const lineHeight = input.fontSize * LINE_HEIGHT_RATIO
  const baseline = PADDING + input.ascent * input.fontSize
  const lines = textLines.map((text, index) => ({
    text,
    x: PADDING,
    baseline: baseline + index * lineHeight,
  }))

  return {
    lines,
    height: 2 * PADDING + lines.length * lineHeight,
  }
}
