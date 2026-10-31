import { normalizeOutlineTitle, type OutlineItem } from './outlineModel'

export interface TocLine { text: string; rect: [number, number, number, number] }
export interface TocPageText { pageIndex: number; width: number; height: number; lines: TocLine[]; unreliable?: boolean }
export interface TocBodyPage { pageIndex: number; lines: string[]; positions?: number[] }
export interface TocRow { pageIndex: number; text: string; parts: TocLine[]; x: number; y: number; height: number; right: number }
export type TocLabelShape = string
export interface TocEntry {
  id: string; sourcePage: number; label: string | null; shape: TocLabelShape; title: string
  printed: string | null; printedNumber: number | null; indent: number
}
export interface TocShapeInfo { shape: TocLabelShape; example: string; count: number; level: number | null }

export function normalizeTocText(text: string): string { return text.normalize('NFKC').replace(/\s+/g, ' ').trim() }
export interface TocDrawingRow { number: string; name: string }

export function stripScaleSuffix(name: string): string {
  const original = normalizeTocText(name)
  let result = original
  const suffix = /(?:^|\s+)(?:N\.?S\.?|NON\s+SCALE|ノンスケール|(?:S\s*=\s*)?1\s*[:/]\s*\d+|A[13]|-)$/i
  for (;;) {
    const match = suffix.exec(result)
    if (!match) return result
    const next = result.slice(0, match.index).trimEnd()
    // A scale-only title must survive intact, including repeated scales.
    if (!next) return original
    result = next
  }
}

export function splitDrawingListTitle(title: string): TocDrawingRow | null {
  const match = /^((?:[A-Za-z]{1,3}-?\d{1,4}(?:-[A-Za-z0-9]+){0,2}|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]{1,2}-?\d{1,4}))\s+(.+)$/u.exec(normalizeTocText(title))
  return match ? { number: match[1], name: stripScaleSuffix(match[2]) } : null
}

export function isDrawingList(entries: readonly TocEntry[]): boolean {
  const drawings = entries.map(entry => splitDrawingListTitle(entry.title)).filter(row => row !== null)
  const prefixes = new Set(drawings.map(row => row.number.match(/^[^\d-]+/)![0].toUpperCase()))
  return entries.length > 0 && drawings.length >= entries.length * .6 && prefixes.size >= 1 && prefixes.size <= 3
}
/** Join justified titles typeset one character apart ("適 用" → "適用"); multi-character words keep their spaces. */
export function joinSpacedCharacters(title: string): string {
  const single = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々]$/u
  const out: string[] = []
  let run: string[] = []
  const flush = () => { if (run.length >= 2) out.push(run.join('')); else out.push(...run); run = [] }
  for (const token of title.split(' ')) {
    if (single.test(token)) run.push(token)
    else { flush(); out.push(token) }
  }
  flush()
  return out.join(' ')
}

export function buildTocRows(page: TocPageText): TocRow[] {
  if (page.unreliable || page.width <= 0 || page.height <= 0) return []
  const unique: TocLine[] = [], byText = new Map<string, TocLine[]>()
  // Split before collapsing whitespace: one MuPDF block can span two columns.
  const startsHeading = (text: string) => {
    const item = splitTocLabel(text)
    // A bare right-aligned digit is the printed page column in SPEC-O4.
    return item.label !== null && !!item.title
  }
  const columnStarts = new Set<TocLine>()
  const fragments = page.lines.flatMap(line => {
    const cuts = [0]
    for (const match of line.text.matchAll(/\s{2,}(?=\S)/gu)) {
      const at = match.index + match[0].length
      if (line.text.slice(cuts[cuts.length - 1], match.index).trim() && startsHeading(line.text.slice(at))) cuts.push(at)
    }
    return cuts.map((at, i) => {
      const fragment: TocLine = { text: line.text.slice(at, cuts[i + 1]), rect: [
        line.rect[0] + (line.rect[2] - line.rect[0]) * at / Math.max(1, line.text.length), line.rect[1],
        line.rect[0] + (line.rect[2] - line.rect[0]) * (cuts[i + 1] ?? line.text.length) / Math.max(1, line.text.length), line.rect[3],
      ] }
      if (i) columnStarts.add(fragment)
      return fragment
    })
  })
  for (const line of fragments) {
    const text = line.text.replace(/\s+/g, ' ').trim()
    if (!text || !line.rect.every(Number.isFinite) || line.rect[2] < line.rect[0] || line.rect[3] <= line.rect[1]) continue
    const same = byText.get(text) ?? []
    if (same.some(other => other.rect.every((v, i) => Math.abs(v - line.rect[i]) <= 1.5))) continue
    const part = { text, rect: line.rect }
    if (columnStarts.has(line)) columnStarts.add(part)
    same.push(part); byText.set(text, same); unique.push(part)
  }
  unique.sort((a, b) => (a.rect[1] + a.rect[3]) / 2 - (b.rect[1] + b.rect[3]) / 2 || a.rect[0] - b.rect[0])
  const groups: TocLine[][] = []
  for (const part of unique) {
    // Compare to the first part, rather than allowing a chain of overlapping
    // boxes to join neighbouring rows. Sweep only nearby row centres.
    const centre = (part.rect[1] + part.rect[3]) / 2, height = part.rect[3] - part.rect[1]
    let found: TocLine[] | undefined
    for (let i = groups.length - 1; i >= 0; i--) {
      const anchor = groups[i][0], delta = centre - (anchor.rect[1] + anchor.rect[3]) / 2
      if (delta > height * 0.6) break
      if (delta <= Math.min(height, anchor.rect[3] - anchor.rect[1]) * 0.6) { found = groups[i]; break }
    }
    if (found) found.push(part); else groups.push([part])
  }
  const rows = groups.flatMap(parts => {
    parts.sort((a, b) => a.rect[0] - b.rect[0])
    const height = Math.max(...parts.map(p => p.rect[3])) - Math.min(...parts.map(p => p.rect[1]))
    const columns: TocLine[][] = []
    parts.forEach((part, i) => {
      if (!i || columnStarts.has(part) || startsHeading(parts.slice(i).map(p => p.text).join(' ')) && part.rect[0] - parts[i - 1].rect[2] >= height * 2) columns.push([])
      columns[columns.length - 1].push(part)
    })
    return columns.map(parts => {
      const x = Math.min(...parts.map(p => p.rect[0])), y = Math.min(...parts.map(p => p.rect[1]))
      return { pageIndex: page.pageIndex, text: parts.map(p => p.text).join(' '), parts, x, y,
        height: Math.max(...parts.map(p => p.rect[3])) - y, right: Math.max(...parts.map(p => p.rect[2])) }
    })
  })
  const heights = rows.map(row => row.height).sort((a, b) => a - b), median = heights[Math.floor(heights.length / 2)] ?? 0
  return rows.filter(row => {
    const text = normalizeTocText(row.text).replace(/\s/g, '')
    // A contents page's own "目次" heading is never an entry, wherever it sits.
    if (/^(?:目次|もくじ|contents)$/i.test(text)) return false
    // Ruby (furigana) is a separate row of small kana above a word; it is not an entry.
    if (row.height < median * .7 && /^[ぁ-ゖァ-ヺー]+$/.test(text)) return false
    if (row.y + row.height / 2 >= page.height * .07 && row.y + row.height / 2 <= page.height * .93) return true
    return !/^(?:[-‐−–—]*(?:目次)?[-‐−–—]*\d+[-‐−–—]*|(?:p\.?)(?:\d+))$/i.test(text)
  })
}

/** Extract only a separated trailing number, never a digit embedded in a title. */
export function tocRowPage(row: TocRow, width: number): { body: string; printed: string | null } {
  const text = row.text, match = /([\s.．…‥・･]+)([0-9０-９]{1,4})\s*$/.exec(text)
  if (match && (/[.．…‥・･]{3,}/.test(normalizeTocText(match[1])) || /\s/.test(match[1]) && row.right > width * .7) && !/^[0-9０-９]+(?:\s*[.．\-‐・,]\s*[0-9０-９]+){1,5}[.．\-‐・,]?$/.test(text)) {
    return { body: text.slice(0, match.index).replace(/[\s.．…‥・･]+$/, ''), printed: normalizeTocText(match[2]) }
  }
  return { body: text, printed: null }
}
export function isTocLikePage(page: TocPageText): boolean {
  const rows = buildTocRows(page), matches = rows.filter(row => tocRowPage(row, page.width).printed !== null).length
  return matches >= 5 && matches >= rows.length * .3
}
export function detectTocPageRange(pages: readonly TocPageText[]): { first: number; last: number } | null {
  const ordered = [...pages].sort((a, b) => a.pageIndex - b.pageIndex)
  const start = ordered.findIndex(isTocLikePage)
  if (start < 0) {
    const fallback = ordered.findIndex(page => hasTocHeading(page) && numberlessTocRows(page, buildTocRows(page)).length >= 4)
    if (fallback < 0) return null
    let end = fallback
    while (end + 1 < ordered.length && ordered[end + 1].pageIndex === ordered[end].pageIndex + 1
      && (hasTocHeading(ordered[end + 1]) && numberlessTocRows(ordered[end + 1], buildTocRows(ordered[end + 1])).length >= 4 || isTocLikePage(ordered[end + 1]))) end++
    return { first: ordered[fallback].pageIndex, last: ordered[end].pageIndex }
  }
  let last = ordered[start].pageIndex
  for (let i = start + 1; i < ordered.length; i++) {
    if (ordered[i].pageIndex !== ordered[i - 1].pageIndex + 1) break
    if (isTocLikePage(ordered[i])) last = ordered[i].pageIndex
    else if (i + 1 >= ordered.length || ordered[i + 1].pageIndex !== ordered[i].pageIndex + 1 || !isTocLikePage(ordered[i + 1])) break
  }
  return { first: ordered[start].pageIndex, last }
}

function hasTocHeading(page: TocPageText): boolean {
  return !page.unreliable && page.height > 0 && page.lines.some(line => line.rect[1] >= 0 && line.rect[3] <= page.height * .3
    && /^(?:目次|もくじ|contents)$/i.test(normalizeTocText(line.text).replace(/\s/g, '')))
}

/** Apply only to numberless TOCs: printed TOCs and body extraction keep their margins. */
function numberlessTocRows(page: TocPageText, rows: TocRow[]): TocRow[] {
  const headings = page.lines.filter(line => line.rect[1] >= 0 && line.rect[3] <= page.height * .3
    && /^(?:目次|もくじ|contents)$/i.test(normalizeTocText(line.text).replace(/\s/g, '')))
  const headingY = headings.length ? Math.min(...headings.map(line => line.rect[1])) : 0
  return rows.filter(row => row.y >= Math.max(headingY, page.height * .07) && row.y + row.height <= page.height * .93
    && (row.x <= page.width * .55 || tocRowPage(row, page.width).printed !== null))
}

// Keep Unicode circled/Roman markers until after classification: NFKC would
// otherwise make both indistinguishable from plain numeric/alphabetic labels.
export function splitTocLabel(raw: string): { label: string | null; title: string } {
  const special = /^([①-⑳Ⅰ-Ⅻⅰ-ⅻ])(?:[.．、)]|\s)*(.*)$/.exec(raw.trim())
  if (special) return { label: special[1], title: normalizeTocText(special[2]) }
  const text = normalizeTocText(raw), number = '[0-9〇零一二三四五六七八九十百千万壱弐参]+'
  const patterns = [
    new RegExp(`^第\\s*${number}\\s*[^\\s0-9.(),-]{1,2}(?=\\s|$)`),
    new RegExp(`^第\\s*${number}\\s*[^\\s0-9.(),-]`),
    /^(?:Part|Chapter|Section|Article|Appendix)\s+[0-9IVXLCDMivxlcdmA-Za-z]+(?:[.)])?(?=\s|$)/i,
    /^(?:付録|附録|資料|別表)\s*(?:[0-9一二三四五六七八九十IVX]+|[A-Z])?/,
    /^\([0-9A-Za-zァ-ヺぁ-ゖ]+\)/,
    /^(?:\d+|[A-Za-zァ-ヺぁ-ゖ])\)/,
    /^(?:[IVXLCDM]+|[ivxlcdm]+)\.(?=\s|[^A-Za-z]|$)/,
    /^[A-Za-z][.](?=\s|[^A-Za-z]|$)/,
    /^[ァ-ヺぁ-ゖ](?:[.、)]|(?=\s+\S.{1,}$))/,
    /^\d+(?:\s*[.\-‐・,]\s*\d+){0,5}[.\-‐・,](?=[^\s\d])/,
    /^\d+(?:\s*[.\-‐・,]\s*\d+){0,5}(?:[.\-‐・,])?(?=\s|$)/,
  ]
  const label = patterns.map(pattern => pattern.exec(text)?.[0]).find(Boolean)?.trim() ?? null
  return { label: label && /^(?:第|\d)/.test(label) ? label.replace(/\s/g, '') : label, title: label ? text.slice(label.length).trim() : text }
}
export function tocLabelShape(label: string | null): TocLabelShape {
  if (!label) return 'none'
  if (/^[①-⑳]$/.test(label)) return 'circled'
  if (/^[Ⅰ-Ⅻⅰ-ⅻ]$/.test(label)) return 'roman'
  const text = normalizeTocText(label).replace(/\s/g, '')
  const dai = /^第[0-9〇零一二三四五六七八九十百千万壱弐参]+(.{1,2})$/.exec(text)
  if (dai) return `dai:${dai[1]}`
  const english = /^(Part|Chapter|Section|Article|Appendix)/i.exec(text)
  if (english) return `en:${english[1].toLowerCase()}`
  const word = /^(付録|附録|資料|別表)/.exec(text)
  if (word) return `word:${word[1]}`
  if (/^\(?[\dA-Za-zァ-ヺぁ-ゖ]+\)$/.test(text)) return `paren:${/\d/.test(text) ? 'num' : /[ァ-ヺぁ-ゖ]/.test(text) ? 'kana' : 'alpha'}`
  if (/^[IVXLCDMivxlcdm]+\.$/.test(text)) return 'roman'
  if (/^[A-Za-z]\.$/.test(text)) return `alpha:${text[0] === text[0].toUpperCase() ? 'upper' : 'lower'}`
  if (/^[ァ-ヺぁ-ゖ]/.test(text)) return 'kana'
  if (/^\d/.test(text)) return `num:${text.match(/\d+/g)!.length}:${text.match(/[.\-‐・,]/)?.[0] ?? '.'}`
  return 'none'
}
export function tocLevelsByIndent(entries: readonly TocEntry[], maxLevels = 6): number[] {
  const clusters: number[] = []
  for (const indent of entries.map(e => e.indent).sort((a, b) => a - b)) {
    if (!clusters.length || indent - clusters[clusters.length - 1] > .015) clusters.push(indent)
  }
  return entries.map(e => Math.min(Math.max(1, maxLevels), clusters.findIndex(indent => e.indent - indent <= .015) + 1))
}
export function tocEntryShapeKeys(entries: readonly TocEntry[]): string[] {
  const plain = entries.filter(e => e.shape === 'none'), levels = tocLevelsByIndent(plain, 8)
  const split = new Set(levels).size > 1, keys = new Map(plain.map((e, i) => [e.id, split ? `none:indent:${levels[i]}` : 'none']))
  // The same marker at clearly different indents is a different level
  // (e.g. "1." for chapters at the margin and "1." for items in a second column).
  for (const shape of new Set(entries.map(e => e.shape).filter(s => s !== 'none'))) {
    const group = entries.filter(e => e.shape === shape), clusters: number[] = []
    for (const indent of group.map(e => e.indent).sort((a, b) => a - b)) {
      if (!clusters.length || indent - clusters[clusters.length - 1] > .05) clusters.push(indent)
      else clusters[clusters.length - 1] = indent
    }
    if (clusters.length < 2) continue
    for (const e of group) keys.set(e.id, `${shape}:indent:${clusters.findIndex(edge => e.indent <= edge + 1e-9) + 1}`)
  }
  return entries.map(e => keys.get(e.id) ?? e.shape)
}
export function parseTocEntries(pages: readonly TocPageText[]): TocEntry[] {
  const entries: TocEntry[] = []
  const ordered = [...pages].sort((a, b) => a.pageIndex - b.pageIndex).map(page => ({ page, rows: buildTocRows(page) }))
  const rows = ordered.flatMap(({ page, rows }) => rows.map(row => tocRowPage(row, page.width)))
  const numberless = rows.length > 0 && rows.filter(row => row.printed !== null).length < rows.length * .3
  for (const { page, rows } of ordered) for (const row of numberless ? numberlessTocRows(page, rows) : rows) {
    const { body, printed } = tocRowPage(row, page.width)
    if (printed === null && /^(?:図面番号|図面名称|図番|図名|縮尺|番号|名称|備考|枚数|頁|ページ)+$/.test(normalizeTocText(body).replace(/\s/g, ''))) continue
    const { label, title } = numberless && splitDrawingListTitle(body) ? { label: null, title: normalizeTocText(body) } : splitTocLabel(body)
    const previous = entries[entries.length - 1]
    if (!label && previous && previous.printed === null && (!numberless || !previous.title) && (printed === null || !previous.title)) {
      previous.title = normalizeTocText(`${previous.title} ${title}`)
      previous.printed = printed; previous.printedNumber = printed === null ? null : Number(printed)
      continue
    }
    if (!label && !title) continue
    entries.push({ id: `toc-${entries.length + 1}`, sourcePage: page.pageIndex, label, shape: tocLabelShape(label), title,
      printed, printedNumber: printed === null ? null : Number(printed), indent: Math.min(1, Math.max(0, row.x / page.width)) })
  }
  const keys = tocEntryShapeKeys(entries)
  return entries.map((entry, i) => ({ ...entry, title: joinSpacedCharacters(numberless
    ? entry.title.replace(/(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々])/gu, '') : entry.title), shape: keys[i] }))
}

/** Keep middle dots significant; width variants, punctuation and spacing are not. */
export function normalizeTocSearchText(text: string): string {
  return text.normalize('NFKC').replace(/(?!・)[\s\p{P}\p{S}]/gu, '')
}
export function tocSearchKeys(entry: TocEntry): string[] {
  const title = normalizeTocSearchText(entry.title)
  // A parenthesized numeral alone is a marker, rather than a one-character title.
  if (!title || /^\s*[（(][〇零一二三四五六七八九十]+[）)]\s*$/.test(entry.title)) return []
  return [title, ...(/[書表編等]$/.test(title) && title.length > 2 ? [title.slice(0, -1)] : [])]
}
export function tocNeedsBodySearch(entries: readonly TocEntry[]): boolean {
  return entries.length > 0 && entries.filter(entry => entry.printedNumber !== null).length < entries.length * .3
}
export function bodyPageLines(page: TocPageText): string[] {
  return bodyPageEntries(page).lines
}
export function bodyPageEntries(page: TocPageText): TocBodyPage {
  // Only the outer 5% is margin: running headers sit near 4%, while form
  // titles such as "（種目別内訳）" can start as high as 7.5%.
  const centre = (row: TocRow) => (row.y + row.height / 2) / page.height
  const rows = buildTocRows(page).filter(row => centre(row) >= .05 && centre(row) <= .95)
  return { pageIndex: page.pageIndex, lines: rows.map(row => row.text), positions: rows.map(row => Math.max(0, (row.y / page.height - .05) / .9)) }
}
/** Count once per page, so repeated cells on a single sheet cannot hide a heading. */
export function removeCommonBodyLines(pages: readonly TocBodyPage[]): TocBodyPage[] {
  const counts = new Map<string, number>()
  for (const page of pages) for (const key of new Set(page.lines.map(normalizeTocSearchText).filter(Boolean))) counts.set(key, (counts.get(key) ?? 0) + 1)
  return pages.map(page => {
    const keep = page.lines.map(line => (counts.get(normalizeTocSearchText(line)) ?? 0) < pages.length * .5)
    return { ...page, lines: page.lines.filter((_, i) => keep[i]),
      ...(page.positions ? { positions: page.positions.filter((_, i) => keep[i]) } : {}) }
  })
}
export function locateTocEntries(entries: readonly TocEntry[], pages: readonly TocBodyPage[], startPageIndex: number): (number | null)[] {
  // Index keys once; each body line visits only its matching prefixes.
  interface KeyNode { children: Map<string, KeyNode>; entries: number[] }
  const root: KeyNode = { children: new Map(), entries: [] }
  entries.forEach((entry, index) => {
    for (const key of tocSearchKeys(entry)) {
      let node = root
      for (const char of key) {
        if (!node.children.has(char)) node.children.set(char, { children: new Map(), entries: [] })
        node = node.children.get(char)!
      }
      node.entries.push(index)
    }
  })
  const labels = entries.map(entry => normalizeTocSearchText(entry.label ?? '').toLowerCase())
  const scores = entries.map(() => new Map<number, number>())
  for (const page of pages) {
    if (page.pageIndex < startPageIndex) continue
    page.lines.forEach((line, lineIndex) => {
      // Remove markers while their separators are visible; preserve enclosed form titles.
      const heading = splitTocLabel(line.replace(/[〔〕［］【】「」\[\]]/g, ' '))
      const text = normalizeTocSearchText(heading.title.normalize('NFKC').replace(/^(?:\d+(?:[.\-]\d+)*(?:[.)、]\s*|\s+)|[IVXLCDMivxlcdm]+(?:[.)、]\s*|\s+))/, ''))
      const label = normalizeTocSearchText(heading.label ?? '').toLowerCase()
      const position = page.positions?.[lineIndex]
      const base = 1 + (position !== undefined && position >= 0 && position <= .2 ? 2 : 0)
        + (/^[（(〔［【「\[].*[）)〕］】」\]]$/.test(line.trim()) ? 1 : 0)
      let node = root, length = 0
      for (const char of text) {
        const child = node.children.get(char)
        if (!child) break
        node = child; length += char.length
        if (length === 1 && text !== char) continue
        const score = base + (text.length <= length * 1.6 ? 1 : 0)
        for (const index of node.entries) {
          const total = score + (label && label === labels[index] ? 1 : 0)
          scores[index].set(page.pageIndex, Math.max(scores[index].get(page.pageIndex) ?? 0, total))
        }
      }
    })
  }

  return selectOrderedPages(scores, startPageIndex)
}

export function locateDrawingNumbers(rows: readonly TocDrawingRow[], pages: readonly TocPageText[], startPageIndex: number): (number | null)[] {
  const normalize = (text: string) => text.normalize('NFKC').replace(/\s/g, '').toUpperCase()
  const indices = new Map<string, number[]>()
  rows.forEach((row, i) => {
    const key = normalize(row.number), group = indices.get(key) ?? []
    group.push(i); indices.set(key, group)
  })
  const scores = rows.map(() => new Map<number, number>())
  for (const page of pages) {
    if (page.pageIndex < startPageIndex || page.unreliable || page.width <= 0 || page.height <= 0) continue
    const consider = (text: string, rect: TocLine['rect']) => {
      if (!rect.every(Number.isFinite) || rect[2] < rect[0] || rect[3] <= rect[1]) return
      const matching = indices.get(normalize(text))
      if (!matching) return
      const x = (rect[0] + rect[2]) / 2, y = (rect[1] + rect[3]) / 2
      const score = 3 + (x >= page.width * .5 && y >= page.height * .5 ? 2 : 0) + (y >= page.height * .85 ? 1 : 0)
      for (const i of matching) scores[i].set(page.pageIndex, Math.max(scores[i].get(page.pageIndex) ?? 0, score))
    }
    // Match whole blocks, never a number mentioned inside a sentence.
    page.lines.forEach(part => consider(part.text, part.rect))
    for (const row of buildTocRows(page)) for (let i = 0; i < row.parts.length; i++) {
      for (let count = 2; count <= 3 && i + count <= row.parts.length; count++) {
        const parts = row.parts.slice(i, i + count)
        consider(parts.map(part => part.text).join(''), [Math.min(...parts.map(p => p.rect[0])), Math.min(...parts.map(p => p.rect[1])),
          Math.max(...parts.map(p => p.rect[2])), Math.max(...parts.map(p => p.rect[3]))])
      }
    }
  }
  return selectOrderedPages(scores, startPageIndex)
}

function selectOrderedPages(scores: readonly ReadonlyMap<number, number>[], startPageIndex: number): (number | null)[] {
  // Suffix DP over candidate pages only. Fenwick suffix maxima avoid a dense
  // entries × pages table, and deferred updates permit at most one choice per entry.
  const candidatePages = [...new Set(scores.flatMap(score => [...score.keys()]))].sort((a, b) => a - b)
  const coordinates = new Map(candidatePages.map((page, i) => [page, candidatePages.length - i]))
  interface Value { score: number; count: number }
  const empty: Value = { score: 0, count: 0 }, tree: Value[] = Array(candidatePages.length + 1).fill(empty)
  const better = (a: Value, b: Value) => a.score > b.score || a.score === b.score && a.count > b.count
  const query = (at: number) => {
    let best = empty
    for (; at > 0; at -= at & -at) if (better(tree[at], best)) best = tree[at]
    return best
  }
  const candidates = scores.map(score => [...score].sort((a, b) => a[0] - b[0]).map(([page, score]) => ({ page, score, best: empty })))
  for (let i = scores.length - 1; i >= 0; i--) {
    for (const candidate of candidates[i]) {
      const suffix = query(coordinates.get(candidate.page)!)
      candidate.best = { score: candidate.score + suffix.score, count: suffix.count + 1 }
    }
    for (const candidate of candidates[i]) {
      for (let at = coordinates.get(candidate.page)!; at < tree.length; at += at & -at) {
        if (better(candidate.best, tree[at])) tree[at] = candidate.best
      }
    }
  }
  // Reconstruct from the front: prefer the earliest page on equal score/count;
  // unresolved is ordered after all pages. No full paths are copied in the DP.
  let remaining = query(candidatePages.length), from = startPageIndex
  return candidates.map(choices => {
    const found = choices.find(candidate => candidate.page >= from && candidate.best.score === remaining.score && candidate.best.count === remaining.count)
    if (!found) return null
    remaining = { score: remaining.score - found.score, count: remaining.count - 1 }
    from = found.page
    return from
  })
}
export function inferTocShapeLevels(entries: readonly TocEntry[]): TocShapeInfo[] {
  const keys = tocEntryShapeKeys(entries), stack: string[] = [], info = new Map<string, { example: string; count: number; votes: Map<number, number>; indents: number[] }>()
  entries.forEach((entry, i) => {
    const shape = keys[i], at = stack.indexOf(shape)
    if (at >= 0) stack.splice(at + 1); else stack.push(shape)
    const data = info.get(shape) ?? { example: entry.label ?? entry.title, count: 0, votes: new Map<number, number>(), indents: [] as number[] }
    data.count++; data.votes.set(stack.length, (data.votes.get(stack.length) ?? 0) + 1); data.indents.push(entry.indent); info.set(shape, data)
  })
  const result = [...info].map(([shape, data]) => ({ shape, example: data.example, count: data.count,
    level: [...data.votes].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0] }))
  const indent = (shape: string) => { const values = info.get(shape)!.indents.slice().sort((a, b) => a - b); return values[Math.floor(values.length / 2)] }
  // Shapes with clear indentation receive the corresponding relative order.
  // Equal indentation retains the observed shape stack (common in printed TOCs).
  const distinct = [...new Set(result.map(item => indent(item.shape)))].sort((a, b) => a - b)
  if (distinct.length > 1 && distinct[distinct.length - 1] - distinct[0] > .015) {
    result.sort((a, b) => Math.abs(indent(a.shape) - indent(b.shape)) > .015 ? indent(a.shape) - indent(b.shape) : a.level - b.level)
    result.forEach((item, i) => { item.level = i + 1 })
  }
  // Numeric depth has meaning only within the same separator family.
  for (const separator of new Set(result.filter(r => r.shape.startsWith('num:')).map(r => r.shape.split(':')[2]))) {
    const family = result.filter(r => r.shape.startsWith('num:') && r.shape.split(':')[2] === separator)
    const ordered = family.slice().sort((a, b) => Number(a.shape.split(':')[1]) - Number(b.shape.split(':')[1]))
    const levels = family.map(r => r.level).sort((a, b) => a - b)
    ordered.forEach((r, i) => { r.level = levels[i] })
  }
  const levels = [...new Set(result.map(r => r.level))].sort((a, b) => a - b)
  result.forEach(r => { r.level = Math.min(8, levels.indexOf(r.level) + 1) })
  return [...info.keys()].map(shape => result.find(r => r.shape === shape)!)
}
export function detectPrintedPageNumber(page: TocPageText): number | null {
  const candidates = page.unreliable ? [] : page.lines.filter(line => line.rect[1] + (line.rect[3] - line.rect[1]) / 2 < page.height * .08 || line.rect[1] + (line.rect[3] - line.rect[1]) / 2 > page.height * .92)
  for (const line of [...candidates].sort((a, b) => b.rect[1] - a.rect[1])) {
    const text = normalizeTocText(line.text).replace(/\s/g, '')
    if (text.includes('目次')) continue
    const match = /^(?:[-‐−–—]+)?(?:p\.?)?(\d{1,4})(?:\/\d{1,4})?(?:[-‐−–—]+)?$/i.exec(text)
    if (match) return Number(match[1])
  }
  return null
}
export function estimatePageOffset(samples: readonly { pageIndex: number; printed: number | null }[]): { offset: number; agreeing: number; total: number } | null {
  const votes = new Map<number, number>()
  let total = 0
  for (const sample of samples) if (sample.printed !== null && Number.isInteger(sample.printed) && Number.isInteger(sample.pageIndex)) {
    const offset = sample.pageIndex - sample.printed
    votes.set(offset, (votes.get(offset) ?? 0) + 1); total++
  }
  if (!total) return null
  const [offset, agreeing] = [...votes].sort((a, b) => b[1] - a[1])[0]
  return { offset, agreeing, total }
}
export function buildTocOutline(entries: readonly TocEntry[], levels: readonly (number | null)[], options: { offset: number; pageCount: number; maxDepth: number; includeLabel: boolean; included: ReadonlySet<string>; titles?: ReadonlyMap<string, string>; pages?: readonly (number | null)[] }): { items: OutlineItem[]; unresolved: string[] } {
  // Preserve structural boundaries even for excluded rows. A null level inherits
  // the last inferred shape level, so its children can be promoted safely.
  const inferred = new Map(inferTocShapeLevels(entries).map(r => [r.shape, r.level!]))
  const keys = tocEntryShapeKeys(entries)
  const depths = entries.map((_, i) => levels[i] ?? inferred.get(keys[i]) ?? 1)
  const eligible = entries.map((e, i) => levels[i] != null && depths[i] <= options.maxDepth && options.included.has(e.id))
  const pages: (number | null)[] = entries.map((e, i) => {
    const page = options.pages ? options.pages[i] ?? NaN : e.printedNumber === null ? NaN : e.printedNumber + options.offset
    return Number.isInteger(page) && page >= 0 && page < options.pageCount ? page : null
  })
  // A reverse boundary stack finds the first descendant with a page, included or
  // not: a heading starts where its content starts, even if the depth limit
  // leaves the children out. Invalid explicit page numbers stay unresolved
  // rather than silently borrowing a page.
  const boundaries: number[] = []
  let nearest: number | null = null
  for (let i = entries.length - 1; i >= 0; i--) {
    while (boundaries.length && depths[boundaries[boundaries.length - 1]] > depths[i]) boundaries.pop()
    const end = boundaries[boundaries.length - 1] ?? entries.length
    if ((options.pages ? options.pages[i] == null : entries[i].printedNumber === null) && nearest !== null && nearest < end) pages[i] = pages[nearest]
    if (pages[i] !== null) nearest = i
    boundaries.push(i)
  }
  const items: OutlineItem[] = [], unresolved: string[] = [], parents: { depth: number; item: OutlineItem }[] = []
  let serial = 0
  entries.forEach((entry, i) => {
    while (parents.length && parents[parents.length - 1].depth >= depths[i]) parents.pop()
    if (!eligible[i]) return
    if (pages[i] === null) { unresolved.push(entry.id); return }
    const title = options.titles?.get(entry.id) ?? entry.title
    const item: OutlineItem = { id: `new:toc-${++serial}`, title: normalizeOutlineTitle(`${options.includeLabel && entry.label ? entry.label + ' ' : ''}${title}`),
      target: { kind: 'page', pageIndex: pages[i]!, view: null, source: 'dest' }, style: { bold: false, italic: false, color: null }, open: parents.length === 0, children: [] }
    ;(parents[parents.length - 1]?.item.children ?? items).push(item)
    parents.push({ depth: depths[i], item })
  })
  return { items, unresolved }
}
