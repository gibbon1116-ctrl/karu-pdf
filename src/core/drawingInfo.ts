import type { PDFDocument, PDFPage, Rect } from 'mupdf'
import type { ExtractedTextLine } from './textExtract'

export interface DrawingInfo {
  number?: string
  name?: string
  numberManual?: boolean
  nameManual?: boolean
  scanned?: boolean
}
type TitleRow = { text: string; rect: Rect }
export interface DrawingCandidate { value: string; score: number; reasons: string[]; rect: Rect; rows?: TitleRow[] }
export interface DrawingDetection {
  number?: string
  name?: string
  numbers: DrawingCandidate[]
  names: DrawingCandidate[]
  reasons: string[]
  titleRows?: TitleRow[]
}
export const DRAWING_THRESHOLDS = { number: 50, name: 50 }
export function normalizeDrawingText(text: string): string {
  return text.normalize('NFKC').replace(/[‐‑‒–—−－]/g, '-').replace(/(?<=[A-Za-z0-9])\s*ー\s*(?=[A-Za-z0-9])/g, '-').replace(/\s+/g, ' ').trim()
}
function validInfo(value: unknown): value is DrawingInfo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return ['number', 'name'].every(k => v[k] === undefined || typeof v[k] === 'string' && [...v[k] as string].length <= 80)
    && ['numberManual', 'nameManual', 'scanned'].every(k => v[k] === undefined || typeof v[k] === 'boolean')
}
export function readDrawingInfo(page: PDFPage): DrawingInfo | null {
  const obj = page.getObject(), raw = obj.get('KaruDrawing')
  try {
    if (!raw.isString()) return null
    const json = raw.asString()
    if (new TextEncoder().encode(json).length > 2048) return null
    const value = JSON.parse(json)
    if (value.version !== 1 || !validInfo(value)) return null
    const { number, name, numberManual, nameManual, scanned } = value
    return { number, name, numberManual, nameManual, scanned }
  } catch { return null } finally { raw.destroy(); obj.destroy() }
}
export function writeDrawingInfo(doc: PDFDocument, page: PDFPage, info: DrawingInfo | null): void {
  const obj = page.getObject()
  try {
    if (!info) { obj.delete('KaruDrawing'); return }
    if (!validInfo(info)) throw new Error('図面情報は各80文字までです。')
    const json = JSON.stringify({ version: 1, number: info.number, name: info.name, numberManual: info.numberManual, nameManual: info.nameManual, scanned: info.scanned })
    if (new TextEncoder().encode(json).length > 2048) throw new Error('図面情報は2KBまでです。')
    const raw = doc.newString(json)
    try { obj.put('KaruDrawing', raw) } finally { raw.destroy() }
  } finally { obj.destroy() }
}
export function readDocumentDrawingInfos(doc: PDFDocument): (DrawingInfo | null)[] {
  return Array.from({ length: doc.countPages() }, (_, i) => {
    const page = doc.loadPage(i)
    try { return readDrawingInfo(page) } finally { page.destroy() }
  })
}
export function mergeAutomaticDrawingInfo(current: DrawingInfo | null, result: Pick<DrawingInfo, 'number' | 'name'>): DrawingInfo {
  return { ...current, number: current?.numberManual ? current.number : result.number, name: current?.nameManual ? current.name : result.name, scanned: true }
}
const numberHeading = /^(?:図\s*面\s*(?:番\s*号|No\.?)|通\s*し\s*番\s*号|図\s*番|DWG\.?\s*No\.?|Drawing\s*No\.?|番\s*号)/i
const nameHeading = /^(?:図\s*面\s*(?:名\s*称|名)|図\s*名|名\s*称|DRAWING\s*TITLE|TITLE)/i
const projectHeading = /^(?:工\s*事\s*名(?:\s*称)?|件\s*名)/
const fieldLabels = new Set('縮尺 縮 尺 作図 製図 設計 担当 照査 承認 検図 審査 区分 種別 図番 図面番号 番号 通し番号 図面名 図面名称 図名 名称 工事名 工事名称 件名 日付 年月日 作成日 作成年月 設計年月 設計年月日 変更年月 製作年月日 用紙 頁 版 改訂 備考 事務所 会社名 DRAWINGNO DRAWINGTITLE TITLE SCALE DATE DRAWN CHECKED APPROVED DESIGNED 所在地 摘要 変更 一部変更 仕様等一部変更 図面内容一部変更'.split(' '))
const isFieldLabel = (text: string) => fieldLabels.has(text.replace(/[\s.:：]/g, '').toUpperCase())
const isHeading = (text: string, pattern: RegExp) => pattern.test(text) && !text.replace(pattern, '').replace(/[:：]/g, '').trim()
const isField = (text: string) => isFieldLabel(text) || isHeading(text, numberHeading) || isHeading(text, nameHeading)
// Broader forms are whole field values and require a number heading. Never
// extract a partial number from dimensions, multiple choices or longer codes.
const labelledNumber = /^(?:\d{2,5}|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{1,2}-?\d{1,4}|[A-Za-z]{1,3}-?\d{2,4}|[A-Za-z]{1,3}-?\d{1,4}\([A-Za-z]{1,3}\))(?:-[A-Za-z0-9]{1,3}){0,2}$/u
const unlabelledNumber = /^[A-Za-z]{1,3}-?\d{2,4}(?:-[A-Za-z0-9]{1,3})?$/
function normalizeNumberValue(text: string): string {
  return text.replace(/^\s*[:：]\s*/, '').replace(/^\s*(?:No\.?|№|#)\s*/i, '').replace(/\s*-\s*/g, '-').trim()
}
const nameEnding = /(?:平面図|立面図|断面図|詳細図|系統図|配置図|展開図|姿図|結線図|配線図|リスト|凡例|特記仕様書|図)$/
function hasNameEnding(text: string): boolean {
  let value = normalizeDrawingText(text), previous: string
  do { previous = value; value = value.replace(/(?:\([^()]*\)|その\s*\d+|\d+)\s*$/, '').trim() } while (value !== previous)
  return nameEnding.test(value)
}
function isNameValue(value: string): boolean {
  return [...value].length <= 40 && isNameText(value)
}
function isNameText(value: string): boolean {
  return Boolean(value) && !/。/.test(value) && !isField(value)
    && !/^\p{L}$/u.test(value) && !/^(?:名|称|番|号|図面内容追加.*|[A-Za-z0-9 .()-]+)$/.test(value)
    && !nameHeading.test(value) && !numberHeading.test(value) && !projectHeading.test(value) && !labelledNumber.test(normalizeNumberValue(value))
}
const unionRect = (rows: TitleRow[]): Rect => [Math.min(...rows.map(r => r.rect[0])), Math.min(...rows.map(r => r.rect[1])), Math.max(...rows.map(r => r.rect[2])), Math.max(...rows.map(r => r.rect[3]))]
function bestValue(candidates: DrawingCandidate[], threshold: number): string | undefined {
  const best = candidates[0]
  return best && best.score >= threshold && !candidates.some(c => c.value !== best.value && c.score === best.score) ? best.value : undefined
}
// Input coordinates are unrotated top-left coordinates unless already displayed
// (MuPDF's structured text and page bounds already include /Rotate).
export function detectDrawingInfo(lines: readonly ExtractedTextLine[], bounds: Rect, rotation = 0, displayedCoordinates = false): DrawingDetection {
  const w = bounds[2] - bounds[0], h = bounds[3] - bounds[1], r = displayedCoordinates ? 0 : ((rotation % 360) + 360) % 360
  const point = (x: number, y: number): [number, number] => r === 90 ? [h - y, x] : r === 180 ? [w - x, h - y] : r === 270 ? [y, w - x] : [x, y]
  const width = r % 180 ? h : w, height = r % 180 ? w : h
  const normalized = lines.filter(l => l.rect.every(Number.isFinite)).map(l => {
    const corners = [point(l.rect[0] - bounds[0], l.rect[1] - bounds[1]), point(l.rect[2] - bounds[0], l.rect[3] - bounds[1])]
    return { text: normalizeDrawingText(l.text), rect: [Math.min(...corners.map(p => p[0])), Math.min(...corners.map(p => p[1])), Math.max(...corners.map(p => p[0])), Math.max(...corners.map(p => p[1]))] as Rect }
  })
  // CAD can paint the same text repeatedly. Deduplicate before computing sizes,
  // joining fragments or collecting evidence across pages.
  const originals: TitleRow[] = []
  const byText = new Map<string, TitleRow[]>()
  for (const row of normalized) {
    if (!row.text || row.rect[2] <= row.rect[0] || row.rect[3] <= row.rect[1]) continue
    const matches = byText.get(row.text) ?? []
    if (matches.some(other => other.rect.every((v, i) => Math.abs(v - row.rect[i]) <= 1.5))) continue
    matches.push(row); byText.set(row.text, matches); originals.push(row)
  }
  const rows = [...originals], parts = new Map<TitleRow, TitleRow[]>()
  const ordered = [...originals].sort((a, b) => a.rect[0] - b.rect[0])
  const neighbourCache = new Map<TitleRow, TitleRow[]>()
  const neighbours = (left: TitleRow) => {
    const cached = neighbourCache.get(left)
    if (cached) return cached
    const lh = left.rect[3] - left.rect[1], result: TitleRow[] = []
    let low = 0, high = ordered.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (ordered[mid].rect[0] < left.rect[2]) low = mid + 1
      else high = mid
    }
    for (let i = low; i < ordered.length && ordered[i].rect[0] <= left.rect[2] + lh * .6; i++) {
      const right = ordered[i], rh = right.rect[3] - right.rect[1]
      if (right.rect[0] - left.rect[2] <= Math.min(lh, rh) * .6 && rh / lh >= .7 && rh / lh <= 1.4
        && Math.min(left.rect[3], right.rect[3]) - Math.max(left.rect[1], right.rect[1]) >= Math.min(lh, rh) * .7) result.push(right)
    }
    neighbourCache.set(left, result)
    return result
  }
  for (const first of ordered) {
    for (const second of neighbours(first)) {
      const chains = [[first, second], ...neighbours(second).filter(third => {
        const fh = first.rect[3] - first.rect[1], th = third.rect[3] - third.rect[1]
        return th / fh >= .7 && th / fh <= 1.4 && Math.min(first.rect[3], third.rect[3]) - Math.max(first.rect[1], third.rect[1]) >= Math.min(fh, th) * .7
      }).map(third => [first, second, third])]
      for (const chain of chains) {
        const joined = { text: chain.map(row => row.text).join(''), rect: unionRect(chain) }
        const matches = byText.get(joined.text) ?? []
        const existing = matches.find(row => row.rect.every((v, i) => Math.abs(v - joined.rect[i]) <= 1.5))
        if (existing) parts.set(existing, chain)
        else { rows.push(joined); parts.set(joined, chain); matches.push(joined); byText.set(joined.text, matches) }
      }
    }
  }
  // Uniformly spaced single characters are common in CAD title blocks. Keep
  // the original short-fragment joining above, and only add complete runs here.
  const singleCharacter = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z0-9]$/u
  const spacedUsed = new Set<TitleRow>()
  for (let start = 0; start < ordered.length; start++) {
    const first = ordered[start]
    if (spacedUsed.has(first) || !singleCharacter.test(first.text)) continue
    const chain = [first], gaps: number[] = [], fh = first.rect[3] - first.rect[1]
    spacedUsed.add(first)
    let index = start
    while (true) {
      const left = chain[chain.length - 1], lh = left.rect[3] - left.rect[1]
      let next = -1
      for (let i = index + 1; i < ordered.length && ordered[i].rect[0] <= left.rect[2] + lh * 2.5; i++) {
        const right = ordered[i], rh = right.rect[3] - right.rect[1]
        if (right.rect[0] < left.rect[2] || rh / lh < .7 || rh / lh > 1.4
          || Math.min(left.rect[3], right.rect[3]) - Math.max(left.rect[1], right.rect[1]) < Math.min(lh, rh) * .7) continue
        // Do not jump over a word or another field on the same physical line.
        if (singleCharacter.test(right.text) && !spacedUsed.has(right) && right.rect[0] - left.rect[2] <= Math.min(lh, rh) * 2.5
          && rh / fh >= .7 && rh / fh <= 1.4
          && Math.min(first.rect[3], right.rect[3]) - Math.max(first.rect[1], right.rect[1]) >= Math.min(fh, rh) * .7) next = i
        break
      }
      if (next < 0) break
      const right = ordered[next]
      gaps.push(right.rect[0] - left.rect[2]); chain.push(right); spacedUsed.add(right); index = next
    }
    if (chain.length < 3 || chain.length > 40 || Math.max(...gaps) > Math.min(...gaps) * 2) continue
    const joined = { text: chain.map(row => row.text).join(''), rect: unionRect(chain) }
    const matches = byText.get(joined.text) ?? []
    const existing = matches.find(row => row.rect.every((v, i) => Math.abs(v - joined.rect[i]) <= 1.5))
    if (existing) parts.set(existing, chain)
    else { rows.push(joined); parts.set(joined, chain); matches.push(joined); byText.set(joined.text, matches) }
  }
  // Original fragments stay available, but must not compete with a complete
  // heading/number/name assembled from those same fragments.
  const joinedName = (joined: TitleRow) => isNameValue(joined.text) && !(parts.get(joined) ?? []).some(part => isField(part.text) || unlabelledNumber.test(normalizeNumberValue(part.text)))
  const joinedNumber = (joined: TitleRow) => labelledNumber.test(normalizeNumberValue(joined.text.replace(numberHeading, '')))
    && !(parts.get(joined) ?? []).some(part => isField(part.text) && !isHeading(part.text, numberHeading))
  const extensions = new Map<TitleRow, TitleRow[]>()
  for (const [joined, members] of parts) for (const member of members) {
    const candidates = extensions.get(member) ?? []
    candidates.push(joined); extensions.set(member, candidates)
  }
  const covered = (row: TitleRow, accepts: (joined: TitleRow) => boolean) => {
    const own = parts.get(row) ?? [row]
    return (extensions.get(own[0]) ?? []).some(joined => {
      const members = parts.get(joined)!
      return members.length > own.length && own.every(part => members.includes(part)) && accepts(joined)
    })
  }
  const cellRows = rows.filter(row => (!parts.has(row) || isField(row.text) || joinedName(row) || joinedNumber(row)) && !covered(row, joined => isField(joined.text) || joinedName(joined)))
  const verticalLabels = new Set<typeof rows[number]>()
  // Some title blocks emit each character of a vertical label as its own line.
  for (const first of [...rows]) for (const [a, b, text] of [['名', '称', '名称'], ['番', '号', '番号']]) {
    if (first.text !== a || !inBottomRight(first.rect)) continue
    const second = rows.find(l => l.text === b && Math.abs(l.rect[0] - first.rect[0]) < 3 && l.rect[1] >= first.rect[3] - 2 && l.rect[1] - first.rect[3] < 20)
    if (second) { const label = { text, rect: [first.rect[0], first.rect[1], Math.max(first.rect[2], second.rect[2]), second.rect[3]] as Rect }; rows.push(label); verticalLabels.add(label) }
  }
  function inBottomRight(b: Rect) { return (b[0] + b[2]) / 2 >= width * .5 && (b[1] + b[3]) / 2 >= height * .5 }
  const heights = originals.map(l => l.rect[3] - l.rect[1]).sort((a, b) => a - b), median = heights[Math.floor(heights.length / 2)] || 1
  const inTitle = (b: Rect) => (b[0] + b[2]) / 2 >= width * .5 && (b[1] + b[3]) / 2 >= height * .5
  const numberLabels = rows.filter(l => isHeading(l.text, numberHeading))
  const nameLabels = rows.filter(l => isHeading(l.text, nameHeading))
  const titleNames = rows.filter(l => inTitle(l.rect) && hasNameEnding(l.text) && isNameValue(l.text) && l.text.length > 4)
  const headingsFor = (row: typeof rows[number], pattern: RegExp) => (pattern === numberHeading ? numberLabels : nameLabels).filter(label => {
    if (label === row || !pattern.test(label.text) || label.text.replace(pattern, '').replace(/[:：]/g, '').trim()) return false
    if (label.text.replace(/\s/g, '') === '名称' && (!inTitle(label.rect) || label.rect[1] < height * .75 || !verticalLabels.has(label) && !hasNameEnding(row.text))) return false
    const lh = Math.max(4, label.rect[3] - label.rect[1])
    const same = row.rect[3] >= label.rect[1] && row.rect[1] <= label.rect[3] && row.rect[0] >= label.rect[2] - 1
    // Large title-block numbers may sit slightly below their small heading.
    // Limit the extra tolerance to the right-hand field in the title block.
    const nearRight = pattern === numberHeading && inTitle(label.rect) && inTitle(row.rect)
      && row.rect[3] - row.rect[1] > lh * 1.2 && row.rect[0] >= label.rect[2] - 1
      && row.rect[0] - label.rect[2] <= width * .15
      && row.rect[1] <= label.rect[3] + lh && row.rect[3] >= label.rect[1] - lh
    const below = row.rect[1] >= label.rect[3] - 1 && row.rect[1] - label.rect[3] <= lh * 2 && Math.abs(row.rect[0] - label.rect[0]) <= lh * 2
    if (!same && !nearRight && !below) return false
    // A column's next field is not the value of this heading. Ignore colons.
    return !rows.some(other => other !== row && other !== label && !/^[:：]$/.test(other.text) && (
      (same || nearRight) && other.rect[0] >= label.rect[2] && other.rect[2] < row.rect[0]
        && other.rect[3] >= (nearRight ? Math.min(label.rect[1], row.rect[1]) : row.rect[1])
        && other.rect[1] <= (nearRight ? Math.max(label.rect[3], row.rect[3]) : row.rect[3])
      || below && Math.abs(other.rect[0] - row.rect[0]) < lh && other.rect[1] >= label.rect[3] && other.rect[3] < row.rect[1]
    ))
  })
  const nearHeading = (row: typeof rows[number], pattern: RegExp) => headingsFor(row, pattern).length > 0
  const numbers: DrawingCandidate[] = [], names: DrawingCandidate[] = []
  for (const row of rows) {
    if (isField(row.text) || parts.has(row) && !joinedNumber(row) || covered(row, joinedNumber)) continue
    const labelled = numberHeading.exec(row.text)
    const text = normalizeNumberValue(labelled ? row.text.slice(labelled[0].length) : row.text)
    if (!labelledNumber.test(text)) continue
    const headingNearby = Boolean(labelled || nearHeading(row, numberHeading))
    if (!headingNearby && !unlabelledNumber.test(text)) continue
    const value = text.toUpperCase()
    if (/^[A-Z]?[XY]-?\d{1,2}$/.test(value)) continue
    const rh = Math.max(4, row.rect[3] - row.rect[1])
    // A stacked choice may be partly merged into the number's text line
    // (e.g. "EF-104-2-B" with a separate "A" above B). Do not pick one branch.
    if (headingNearby && originals.some(other => other !== row && !parts.get(row)?.includes(other) && other.text.toUpperCase() !== value && /^[A-Za-z0-9]{1,3}$/.test(other.text)
      && other.rect[0] >= Math.max(row.rect[0], row.rect[2] - Math.max(rh, (row.rect[2] - row.rect[0]) / 4))
      && other.rect[0] <= row.rect[2] && other.rect[2] >= row.rect[2] - rh
      && other.rect[1] <= row.rect[3] + rh / 2 && other.rect[3] >= row.rect[1] - rh / 2)) continue
    const nearbyName = titleNames.some(l => Math.abs(l.rect[1] - row.rect[1]) < height * .08 && Math.abs(l.rect[0] - row.rect[0]) < width * .25)
    if (!headingNearby && !nearbyName) continue
    let score = 0; const reasons: string[] = []
    if (headingNearby) { score += 80; reasons.push('番号見出しの右・直下') }
    if (inTitle(row.rect)) { score += 35; reasons.push('右下の表題欄') }
    if (inTitle(row.rect) && row.rect[3] >= height * .85) { score += 15; reasons.push('下端') }
    if (row.rect[3] - row.rect[1] > median * 1.2) { score += 5; reasons.push('大きい文字') }
    numbers.push({ value, score, reasons, rect: row.rect })
  }
  numbers.sort((a, b) => b.score - a.score)
  const fields = rows.filter(row => isField(row.text))
  const claimed = new Set<TitleRow>()
  const nameCells: { row: TitleRow; value: string; rows: TitleRow[] }[] = []
  const fieldArea = (label: TitleRow) => {
    const lh = label.rect[3] - label.rect[1]
    const beside = fields.filter(other => other !== label && other.rect[3] > label.rect[1] && other.rect[1] < label.rect[3])
    const rightFields = beside.filter(other => other.rect[0] >= label.rect[2])
    const right = rightFields.length ? Math.min(...rightFields.map(other => other.rect[0])) : label.rect[0] + width * .25
    const left = Math.max(label.rect[0] - (label.rect[2] - label.rect[0]) * 1.5, ...beside.filter(other => other.rect[2] <= label.rect[0]).map(other => other.rect[2]))
    const bottom = Math.min(...fields.filter(other => other !== label && other.rect[1] >= label.rect[3] && other.rect[2] > left && other.rect[0] < right).map(other => other.rect[1]))
    return { lh, left, right, bottom }
  }
  const otherValues = new Set<TitleRow>()
  for (const label of fields.filter(l => inTitle(l.rect) && !nameLabels.includes(l) && !numberLabels.includes(l))) {
    const { lh, left, right, bottom } = fieldArea(label)
    cellRows.filter(row => row.rect[2] <= right && (
      row.rect[0] >= label.rect[2] && row.rect[1] < label.rect[3] && row.rect[3] > label.rect[1]
      || row.rect[0] >= left && row.rect[1] >= label.rect[3] && row.rect[3] <= bottom && row.rect[1] - label.rect[3] <= Math.max(lh, row.rect[3] - row.rect[1]) * 4
    )).forEach(row => { otherValues.add(row); parts.get(row)?.forEach(part => otherValues.add(part)) })
  }
  for (const label of nameLabels.filter(l => inTitle(l.rect) && !verticalLabels.has(l))) {
    // Keep the stricter generic "名称" guard used by the original detector.
    if (label.text.replace(/\s/g, '') === '名称' && label.rect[1] < height * .75) continue
    const { lh, left, right, bottom } = fieldArea(label)
    const sameColumn = fields.filter(other => other !== label && Math.abs(other.rect[0] - label.rect[0]) <= label.rect[2] - label.rect[0])
    // Only a heading just above closes a title-block cell; a matching word far up
    // in the drawing body must not stretch the cell over the drawing.
    const above = sameColumn.filter(other => other.rect[3] <= label.rect[1] && label.rect[1] - other.rect[3] <= Math.max(lh * 3, height * .03))
    const below = sameColumn.filter(other => other.rect[1] >= label.rect[3])
    // Extend upward only into a cell closed by another field heading above it;
    // without one, the space above a title block is the drawing itself.
    const top = above.length ? Math.max(...above.map(other => other.rect[3])) : label.rect[1]
    const lower = below.length ? Math.min(...below.map(other => other.rect[1])) : label.rect[3] + lh * 3
    const rightFields = fields.filter(other => other !== label && other.rect[0] >= label.rect[2]
      && other.rect[3] >= label.rect[1] - lh * 3 && other.rect[1] <= label.rect[3] + lh * 3)
    const upperRight = rightFields.length ? Math.min(...rightFields.map(other => other.rect[0])) : label.rect[0] + width * .25
    const selected = cellRows.filter(row => (
      row.rect[0] >= left && row.rect[2] <= right && row.rect[1] >= label.rect[3]
        && row.rect[3] <= bottom && row.rect[1] - label.rect[3] <= Math.max(lh, row.rect[3] - row.rect[1]) * 4
      || row.rect[0] >= label.rect[2] && row.rect[2] <= upperRight && row.rect[1] >= top && row.rect[3] <= lower
    ) && !otherValues.has(row) && isNameText(row.text) && !parts.get(row)?.some(part => isField(part.text)))
      .sort((a, b) => a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0])
    // Preserve physical lines for document-wide common-line removal.
    const physical: TitleRow[] = []
    for (const row of selected) {
      const last = physical.at(-1)
      if (last && Math.min(last.rect[3], row.rect[3]) - Math.max(last.rect[1], row.rect[1]) >= Math.min(last.rect[3] - last.rect[1], row.rect[3] - row.rect[1]) * .7) {
        last.text += ' ' + row.text; last.rect = unionRect([last, row])
      } else physical.push({ text: row.text, rect: [...row.rect] })
    }
    const value = physical.map(row => row.text).join(' ')
    // Even an overlong cell must not fall back to choosing just one of its rows.
    selected.forEach(row => { claimed.add(row); parts.get(row)?.forEach(part => claimed.add(part)) })
    if (!physical.length || [...value].length > (physical.length >= 2 ? 80 : 40) || !isNameText(value)) continue
    nameCells.push({ row: { text: value, rect: unionRect(physical) }, value, rows: physical })
  }
  const addName = (row: TitleRow, value: string, headingNearby: boolean, details?: TitleRow[]) => {
    let score = 0; const reasons: string[] = []
    if (!headingNearby && (!inTitle(row.rect) || row.rect[3] < height * .9 || !numbers.some(n => n.score >= 50))) return
    if (!headingNearby && /^(?:[A-Z]部)?(?:平面図|立面図|断面図|詳細図|結線図|配線要領図|取付要領図|参考図)$/.test(value)) return
    if (headingNearby) { score += 80; reasons.push('名称見出しの右・直下') }
    if (hasNameEnding(value)) { score += 25; reasons.push('図面名称の語尾') }
    if (inTitle(row.rect)) { score += 25; reasons.push('右下の表題欄') }
    if (numbers.some(n => n.score >= 50 && Math.abs(n.rect[1] - row.rect[1]) < height * .12 && Math.abs(n.rect[0] - row.rect[0]) < width * .3)) { score += 10; reasons.push('図面番号の近く') }
    if (score) names.push({ value, score, reasons, rect: row.rect, ...(details ? { rows: details } : {}) })
  }
  nameCells.forEach(cell => addName(cell.row, cell.value, true, cell.rows))
  for (const row of rows) {
    if (claimed.has(row) || otherValues.has(row) || isField(row.text) || parts.has(row) && !joinedName(row) || covered(row, joined => isField(joined.text) || joinedName(joined))) continue
    const label = nameHeading.exec(row.text)
    let value = (label ? row.text.slice(label.index + label[0].length) : row.text).replace(/^\s*[:：]\s*/, '').trim()
    if (!isNameValue(value)) continue
    const relatedLabels = headingsFor(row, nameHeading)
    const verticalLabel = relatedLabels.find(l => verticalLabels.has(l))
    if (verticalLabel) {
      const cellRows = rows.filter(l => !verticalLabels.has(l) && l.rect[0] >= verticalLabel.rect[2] - 1 && l.rect[3] >= verticalLabel.rect[1] && l.rect[1] <= verticalLabel.rect[3] && Math.abs(l.rect[0] - row.rect[0]) < width * .08).sort((a, b) => a.rect[1] - b.rect[1])
      value = [...new Map(cellRows.map(l => [l.text + ':' + l.rect.map(n => Math.round(n)).join(','), l.text])).values()].join(' ')
      if ([...value].length > 40 || /。/.test(value)) continue
    }
    const headingNearby = Boolean(label || relatedLabels.length)
    addName(row, value, headingNearby)
  }
  names.sort((a, b) => b.score - a.score)
  // Equal strongest values are ambiguous; keep the candidates for diagnostics.
  const titleRows = cellRows.filter(row => !otherValues.has(row) && (row.rect[0] + row.rect[2]) / 2 > width * .55 && (row.rect[1] + row.rect[3]) / 2 > height * .6).sort((a, b) => b.rect[1] - a.rect[1] || b.rect[0] - a.rect[0]).slice(0, 80)
  return { number: bestValue(numbers, DRAWING_THRESHOLDS.number), name: bestValue(names, DRAWING_THRESHOLDS.name), numbers: numbers.slice(0, 32), names: names.slice(0, 32), reasons: ['番号50点・名称50点以上'], titleRows }
}
export function reconcileDrawingInfos(pages: readonly DrawingDetection[]): DrawingDetection[] {
  const shape = (v: string) => {
    const numeric = v.match(/^(\d{2,5})(?:-[A-Za-z0-9]{1,3}){0,2}$/)
    if (numeric) return `numeric:${numeric[1].length}`
    return v.match(/^([A-Z]{1,3}|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{1,2})-?(\d{1,4})(?:-[A-Za-z0-9]{1,3}){0,2}$/u)?.slice(1).map((s, i) => i ? s.length : s).join(':')
  }
  const counts = new Map<string, number>()
  pages.forEach(p => { if (p.number) { const s = shape(p.number); if (s) counts.set(s, (counts.get(s) ?? 0) + 1) } })
  const majority = [...counts].sort((a, b) => b[1] - a[1]).find(([, n]) => n >= 2 && n > pages.length / 2)?.[0]
  const repeated = new Set(pages.length > 1 ? pages[0].numbers.filter(n => pages.every(p => p.numbers.some(c => c.value === n.value))).map(n => n.value) : [])
  const namePages = pages.filter(p => p.names.length)
  const lineCounts = new Map<string, number>()
  namePages.forEach(p => new Set(p.names.flatMap(n => n.rows?.map(row => row.text) ?? [n.value])).forEach(text => lineCounts.set(text, (lineCounts.get(text) ?? 0) + 1)))
  const commonLines = new Set([...lineCounts].filter(([, count]) => count >= namePages.length * .8).map(([text]) => text))
  const position = (rect: Rect) => rect.map(v => Math.round(v / 4)).join(',')
  const positions = new Map<string, { pages: Set<number>; texts: Set<string> }>()
  pages.forEach((p, i) => p.titleRows?.forEach(row => {
    const key = position(row.rect), entry = positions.get(key) ?? { pages: new Set<number>(), texts: new Set<string>() }
    entry.pages.add(i); entry.texts.add(row.text); positions.set(key, entry)
  }))
  const varying = new Set([...positions].filter(([, entry]) => pages.length >= 3 && entry.pages.size >= pages.length * .6 && entry.texts.size > 1).map(([key]) => key))
  const result = pages.map(p => {
    const numbers = p.numbers.filter(n => !repeated.has(n.value)).map(n => ({ ...n, score: n.score + (majority && shape(n.value) === majority ? 20 : 0), reasons: [...n.reasons, ...(majority && shape(n.value) === majority ? ['多数派の形式'] : [])] })).sort((a, b) => b.score - a.score)
    let removedCommon = false
    const mapped = p.names.map(candidate => {
      if (!candidate.rows || candidate.rows.length < 2) return candidate
      const remaining = candidate.rows.filter(row => !commonLines.has(row.text))
      if (!remaining.length || remaining.length === candidate.rows.length) return candidate
      removedCommon = true
      return { ...candidate, value: remaining.map(row => row.text).join(' '), rect: unionRect(remaining), rows: remaining, reasons: [...candidate.reasons, '全ページ共通の行を除外'] }
    })
    // A single-line candidate repeated on most pages is a building, project or
    // designer name; dropping it lets the page's own drawing name win a tie.
    // The candidate stays listed for diagnostics but cannot be chosen.
    const names = mapped.sort((a, b) => b.score - a.score)
    const eligible = namePages.length >= 3 ? names.filter(candidate => !commonLines.has(candidate.value)) : names
    const removedCommonCandidate = eligible.length < names.length
    const number = bestValue(numbers, DRAWING_THRESHOLDS.number)
    const name = names.length || p.titleRows ? bestValue(eligible, DRAWING_THRESHOLDS.name) : p.name
    const reasons = [...p.reasons, ...(repeated.size ? ['全ページ共通の番号を除外'] : []), ...(removedCommon ? ['全ページ共通の行を除外'] : []), ...(removedCommonCandidate ? ['全ページ共通の候補を除外'] : [])]
    return { ...p, numbers, number, names, name, reasons }
  })
  const suppressCommonNames = () => {
    const counts = new Map<string, number>()
    if (pages.length < 3) return new Set<string>()
    result.forEach(p => { if (p.name) counts.set(p.name, (counts.get(p.name) ?? 0) + 1) })
    const common = new Set([...counts].filter(([, count]) => count >= pages.length * .8).map(([value]) => value))
    result.forEach(p => {
      if (p.name && common.has(p.name)) {
        p.name = undefined; p.reasons.push('全ページ共通の名称を除外')
      }
    })
    return common
  }
  const commonNames = suppressCommonNames()
  for (const p of result) {
    if (p.name) continue
    const candidates = (p.titleRows ?? []).filter(row => varying.has(position(row.rect)) && !commonNames.has(row.text) && isNameValue(row.text) && hasNameEnding(row.text))
      .map(row => ({ value: row.text, rect: row.rect, score: 65, reasons: ['各ページで変わる欄'] }))
    p.names.push(...candidates); p.names.sort((a, b) => b.score - a.score)
    let name: string | undefined
    if (candidates.length === 1) name = candidates[0].value
    else if (p.number && candidates.length > 1) {
      const numberRect = p.numbers.find(n => n.value === p.number)!.rect
      const distance = (rect: Rect) => Math.hypot((rect[0] + rect[2] - numberRect[0] - numberRect[2]) / 2, (rect[1] + rect[3] - numberRect[1] - numberRect[3]) / 2)
      candidates.sort((a, b) => distance(a.rect) - distance(b.rect))
      if (distance(candidates[0].rect) + .001 < distance(candidates[1].rect)) name = candidates[0].value
    }
    // Preserve unresolved stronger evidence, except a rejected common name.
    if (name && p.names.some(candidate => candidate.score > 65 && candidate.value !== name && !commonNames.has(candidate.value)
      && !(namePages.length >= 3 && commonLines.has(candidate.value)))) name = undefined
    if (name) { p.name = name; p.reasons.push('各ページで変わる欄') }
  }
  suppressCommonNames()
  return result
}
