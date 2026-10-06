import type { PDFDocument, PDFPage, Rect } from 'mupdf'
import type { ExtractedTextLine } from './textExtract'

export interface DrawingInfo {
  number?: string
  name?: string
  numberManual?: boolean
  nameManual?: boolean
  scanned?: boolean
}
export interface DrawingCandidate { value: string; score: number; reasons: string[]; rect: Rect }
export interface DrawingDetection {
  number?: string
  name?: string
  numbers: DrawingCandidate[]
  names: DrawingCandidate[]
  reasons: string[]
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
const numberHeading = /^(?:図\s*面\s*(?:番\s*号|No\.?)|図\s*番|DWG\.?\s*No\.?|Drawing\s*No\.?|番\s*号)/i
const nameHeading = /^(?:図\s*面\s*(?:名\s*称|名)|図\s*名|名\s*称)/
// Broader forms are whole field values and require a number heading. Never
// extract a partial number from dimensions, multiple choices or longer codes.
const labelledNumber = /^(?:\d{2,5}|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{1,2}-?\d{1,4}|[A-Za-z]{1,3}-?\d{2,4})(?:-[A-Za-z0-9]{1,3}){0,2}$/u
const unlabelledNumber = /^[A-Za-z]{1,3}-?\d{2,4}(?:-[A-Za-z0-9]{1,3})?$/
function normalizeNumberValue(text: string): string {
  return text.replace(/^\s*[:：]\s*/, '').replace(/^\s*(?:No\.?|№|#)\s*/i, '').replace(/\s*-\s*/g, '-').trim()
}
const nameEnding = /(?:平面図|立面図|断面図|詳細図|系統図|配置図|展開図|姿図|結線図|配線図|リスト|凡例|特記仕様書|図)$/
// Input coordinates are unrotated top-left coordinates unless already displayed
// (MuPDF's structured text and page bounds already include /Rotate).
export function detectDrawingInfo(lines: readonly ExtractedTextLine[], bounds: Rect, rotation = 0, displayedCoordinates = false): DrawingDetection {
  const w = bounds[2] - bounds[0], h = bounds[3] - bounds[1], r = displayedCoordinates ? 0 : ((rotation % 360) + 360) % 360
  const point = (x: number, y: number): [number, number] => r === 90 ? [h - y, x] : r === 180 ? [w - x, h - y] : r === 270 ? [y, w - x] : [x, y]
  const width = r % 180 ? h : w, height = r % 180 ? w : h
  const rows = lines.filter(l => l.rect.every(Number.isFinite)).map(l => {
    const corners = [point(l.rect[0] - bounds[0], l.rect[1] - bounds[1]), point(l.rect[2] - bounds[0], l.rect[3] - bounds[1])]
    return { text: normalizeDrawingText(l.text), rect: [Math.min(...corners.map(p => p[0])), Math.min(...corners.map(p => p[1])), Math.max(...corners.map(p => p[0])), Math.max(...corners.map(p => p[1]))] as Rect }
  })
  const verticalLabels = new Set<typeof rows[number]>()
  // Some title blocks emit each character of a vertical label as its own line.
  for (const first of [...rows]) for (const [a, b, text] of [['名', '称', '名称'], ['番', '号', '番号']]) {
    if (first.text !== a || !inBottomRight(first.rect)) continue
    const second = rows.find(l => l.text === b && Math.abs(l.rect[0] - first.rect[0]) < 3 && l.rect[1] >= first.rect[3] - 2 && l.rect[1] - first.rect[3] < 20)
    if (second) { const label = { text, rect: [first.rect[0], first.rect[1], Math.max(first.rect[2], second.rect[2]), second.rect[3]] as Rect }; rows.push(label); verticalLabels.add(label) }
  }
  function inBottomRight(b: Rect) { return (b[0] + b[2]) / 2 >= width * .5 && (b[1] + b[3]) / 2 >= height * .5 }
  const heights = rows.map(l => l.rect[3] - l.rect[1]).sort((a, b) => a - b), median = heights[Math.floor(heights.length / 2)] || 1
  const inTitle = (b: Rect) => (b[0] + b[2]) / 2 >= width * .5 && (b[1] + b[3]) / 2 >= height * .5
  const numberLabels = rows.filter(l => numberHeading.test(l.text) && !l.text.replace(numberHeading, '').replace(/[:：]/g, '').trim())
  const nameLabels = rows.filter(l => nameHeading.test(l.text) && !l.text.replace(nameHeading, '').replace(/[:：]/g, '').trim())
  const titleNames = rows.filter(l => inTitle(l.rect) && nameEnding.test(l.text) && l.text.length > 4)
  const headingsFor = (row: typeof rows[number], pattern: RegExp) => (pattern === numberHeading ? numberLabels : nameLabels).filter(label => {
    if (label === row || !pattern.test(label.text) || label.text.replace(pattern, '').replace(/[:：]/g, '').trim()) return false
    if (label.text.replace(/\s/g, '') === '名称' && (!inTitle(label.rect) || label.rect[1] < height * .75 || !verticalLabels.has(label) && !nameEnding.test(row.text))) return false
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
    if (headingNearby && rows.some(other => other !== row && other.text.toUpperCase() !== value && /^[A-Za-z0-9]{1,3}$/.test(other.text)
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
  for (const row of rows) {
    const label = nameHeading.exec(row.text)
    let value = (label ? row.text.slice(label.index + label[0].length) : row.text).replace(/^\s*[:：]\s*/, '').trim()
    if (/^(?:名|称|番|号|所在地|日付|縮尺|用紙|摘\s*要|頁|変更|一部変更|仕様等一部変更|図面内容一部変更|図面内容追加.*|[A-Za-z0-9 .()-]+)$/.test(value)) continue
    if (!value || [...value].length > 40 || /。/.test(value) || nameHeading.test(value) || numberHeading.test(value) || labelledNumber.test(normalizeNumberValue(value))) continue
    const relatedLabels = headingsFor(row, nameHeading)
    const verticalLabel = relatedLabels.find(l => verticalLabels.has(l))
    if (verticalLabel) {
      const cellRows = rows.filter(l => !verticalLabels.has(l) && l.rect[0] >= verticalLabel.rect[2] - 1 && l.rect[3] >= verticalLabel.rect[1] && l.rect[1] <= verticalLabel.rect[3] && Math.abs(l.rect[0] - row.rect[0]) < width * .08).sort((a, b) => a.rect[1] - b.rect[1])
      value = [...new Map(cellRows.map(l => [l.text + ':' + l.rect.map(n => Math.round(n)).join(','), l.text])).values()].join(' ')
      if ([...value].length > 40 || /。/.test(value)) continue
    }
    let score = 0; const reasons: string[] = []
    const headingNearby = Boolean(label || relatedLabels.length)
    if (!headingNearby && (!inTitle(row.rect) || row.rect[3] < height * .9 || !numbers.some(n => n.score >= 50))) continue
    if (!headingNearby && /^(?:[A-Z]部)?(?:平面図|立面図|断面図|詳細図|結線図|配線要領図|取付要領図|参考図)$/.test(value)) continue
    if (headingNearby) { score += 80; reasons.push('名称見出しの右・直下') }
    if (nameEnding.test(value)) { score += 25; reasons.push('図面名称の語尾') }
    if (inTitle(row.rect)) { score += 25; reasons.push('右下の表題欄') }
    if (numbers.some(n => n.score >= 50 && Math.abs(n.rect[1] - row.rect[1]) < height * .12 && Math.abs(n.rect[0] - row.rect[0]) < width * .3)) { score += 10; reasons.push('図面番号の近く') }
    if (score) names.push({ value, score, reasons, rect: row.rect })
  }
  names.sort((a, b) => b.score - a.score)
  // Equal strongest values are ambiguous; keep the candidates for diagnostics.
  const numberAmbiguous = numbers.some(n => n.value !== numbers[0]?.value && n.score === numbers[0]?.score)
  const nameAmbiguous = names.some(n => n.value !== names[0]?.value && n.score === names[0]?.score)
  return { number: !numberAmbiguous && numbers[0]?.score >= DRAWING_THRESHOLDS.number ? numbers[0].value : undefined, name: !nameAmbiguous && names[0]?.score >= DRAWING_THRESHOLDS.name ? names[0].value : undefined, numbers: numbers.slice(0, 32), names: names.slice(0, 32), reasons: ['番号50点・名称50点以上'] }
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
  return pages.map(p => {
    const numbers = p.numbers.filter(n => !repeated.has(n.value)).map(n => ({ ...n, score: n.score + (majority && shape(n.value) === majority ? 20 : 0), reasons: [...n.reasons, ...(majority && shape(n.value) === majority ? ['多数派の形式'] : [])] })).sort((a, b) => b.score - a.score)
    const ambiguous = numbers.some(n => n.value !== numbers[0]?.value && n.score === numbers[0]?.score)
    return { ...p, numbers, number: !ambiguous && numbers[0]?.score >= DRAWING_THRESHOLDS.number ? numbers[0].value : undefined, reasons: [...p.reasons, ...(repeated.size ? ['全ページ共通の番号を除外'] : [])] }
  })
}
