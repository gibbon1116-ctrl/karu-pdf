import { quantityValue } from '../core/quantity'
import { quantityKind, QUANTITY_UNITS } from '../core/countFixtures'
import { scaleLabel, PT_MM } from '../core/measure'
import { issueStatusLabel, issueColor } from '../core/issues'
import { countFixtureId } from '../core/counts'
import type { CountFixture } from '../core/countFixtures'
import { SYMBOL_OPTIONS } from '../core/annotations'
import type { EditableAnnotation } from '../editor/AnnotationStore'

const PT_TO_MM = 25.4 / 72

export const ANNOTATION_CSV_HEADER = ['種類', '番号', 'ページ', '図面番号', '内容', '色', '位置（x, y mm）', '大きさ（幅, 高さ mm）']
export const CSV_KINDS = ['issue', 'count', 'text', 'callout', 'measure', 'shape', 'symbol', 'pen', 'markup'] as const
export type CsvKind = typeof CSV_KINDS[number]
export const CSV_KIND_LABELS: Record<CsvKind, string> = {
  issue: '指摘', count: '数量拾い', text: '文字', callout: '吹き出し', measure: '計測',
  shape: '図形（雲・線・矢印・四角・丸）', symbol: '記号', pen: 'ペン（蛍光ペン・手書き）', markup: '文字への印',
}
export interface CsvOptions { firstPage?: number; lastPage?: number; issueStatus?: 'all' | 'open' | 'confirmed'; fixtures?: readonly CountFixture[] }
export function csvKind(annotation: EditableAnnotation): CsvKind | null {
  if (annotation.legacyChange || annotation.issue?.recordKind === 'change') return null
  if (annotation.issue) return 'issue'
  if (annotation.count || annotation.quantity) return 'count'
  if (annotation.measure) return 'measure'
  if (annotation.kind === 'freetext') return 'text'
  if (annotation.kind === 'callout' || annotation.kind === 'symbol') return annotation.kind
  if (annotation.kind === 'highlight' || annotation.kind === 'ink') return 'pen'
  if (['textHighlight', 'underline', 'strikeout'].includes(annotation.kind)) return 'markup'
  if (['cloudSquare', 'cloudPolygon', 'line', 'arrow', 'square', 'circle'].includes(annotation.kind)) return 'shape'
  return null
}
export function csvAnnotations(annotations: readonly EditableAnnotation[], kinds: readonly string[], options: CsvOptions = {}): EditableAnnotation[] {
  return annotations.filter(a => {
    const kind = csvKind(a)
    return kind !== null && kinds.includes(kind)
      && a.pageIndex + 1 >= (options.firstPage ?? 1) && a.pageIndex + 1 <= (options.lastPage ?? Infinity)
      && (kind !== 'issue' || !options.issueStatus || options.issueStatus === 'all'
        || (options.issueStatus === 'confirmed' ? a.issue!.status === 'confirmed' : a.issue!.status !== 'confirmed'))
  }).sort((a, b) => CSV_KINDS.indexOf(csvKind(a)!) - CSV_KINDS.indexOf(csvKind(b)!)
    || (a.issue && b.issue ? a.issue.number - b.issue.number : 0)
    || a.pageIndex - b.pageIndex || a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0])
}

export function annotationKindLabel(kind: EditableAnnotation['kind']): string {
  const labels: Record<EditableAnnotation['kind'], string> = {
    cloudSquare: '雲（四角）', cloudPolygon: '雲（多角形）', issue: '指摘', distance: '距離', perimeter: '連続した長さ', area: '面積', freetext: '文字', callout: '吹き出し', line: '線', arrow: '矢印', square: '四角',
    circle: '丸', highlight: '蛍光ペン', ink: '手書き', textHighlight: '文字ハイライト',
    underline: '文字に下線', strikeout: '文字に取り消し線', symbol: '記号',
  }
  return labels[kind]
}

export function annotationBody(annotation: EditableAnnotation): string {
  if (annotation.issue) return `№ ${annotation.issue.number} ${annotation.text}`
  if (annotation.measure) return annotation.text
  if (annotation.kind === 'freetext' || annotation.kind === 'callout') return annotation.text
  if (annotation.kind === 'textHighlight' || annotation.kind === 'underline' || annotation.kind === 'strikeout') return annotation.text
  if (annotation.kind === 'symbol') return SYMBOL_OPTIONS.find((option) => option.name === annotation.symbol)?.label ?? '記号'
  return annotationKindLabel(annotation.kind)
}

export function annotationColorHex(annotation: EditableAnnotation): string {
  const color = annotation.issue ? issueColor(annotation.issue, annotation.color) : annotation.kind === 'square' || annotation.kind === 'circle'
    ? annotation.interiorColor ?? annotation.borderColor ?? annotation.color
    : annotation.color
  return `#${color.map((component) => Math.round(Math.max(0, Math.min(1, component)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

function decimal(value: number): string {
  return (value * PT_TO_MM).toFixed(2)
}

export function quote(value: string | number): string {
  // Quoting alone does not stop spreadsheet formula evaluation. Only protect
  // strings; real numeric fields must remain numbers.
  const unsafe = typeof value === 'string' && (/^[\t\r\n]/.test(value) || /^[\s\u0000-\u001f]*[=+\-@＝＋－＠]/.test(value))
  const text = (unsafe ? `'${value}` : String(value)).replace(/\r?\n/g, '\r\n')
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function createAnnotationCsv(annotations: readonly EditableAnnotation[]): string {
  return createCsv(annotations, CSV_KINDS)
}

export function createCsv(annotations: readonly EditableAnnotation[], kinds: readonly string[], options: CsvOptions = {}): string {
  const header = [...ANNOTATION_CSV_HEADER]
  if (kinds.includes('issue')) header.push('状態', '分野', '回答', '修正確認', '引継ぎ元番号', '引継ぎ元文書')
  if (kinds.includes('measure') || kinds.includes('count')) header.push('縮尺')
  if (kinds.includes('count')) header.push('名称', '略号', '分類')
  const fixtures = new Map(options.fixtures?.map(f => [f.id, f]))
  const rows = csvAnnotations(annotations, kinds, options).map((annotation) => {
    const [left, top, right, bottom] = annotation.rect
    const issue = annotation.issue
    const fixture = annotation.quantity ? fixtures.get(annotation.quantity.itemId) : annotation.count ? fixtures.get(countFixtureId(annotation.count)) : undefined
    const fixtureName = fixture?.name ?? (annotation.count?.version === 1 ? annotation.count.group : '')
    const row: (string | number)[] = [
      annotation.quantity ? quantityAnnotationLabel(annotation) : annotation.count ? '数量拾い' : annotationKindLabel(annotation.kind),
      issue?.number ?? '',
      annotation.pageIndex + 1,
      issue?.drawingNumber ?? '',
      issue ? annotation.text : annotation.count ? fixtureName : annotationBody(annotation),
      annotationColorHex(annotation),
      `${decimal(left)}, ${decimal(top)}`,
      `${decimal(right - left)}, ${decimal(bottom - top)}`,
    ]
    if (kinds.includes('issue')) row.push(issue ? issueStatusLabel(issue.status) : '', issue?.discipline ?? '', issue?.answer ?? '', issue?.verification ?? '', issue?.sourceNumber ?? '', issue?.sourceDocument ?? '')
    if (kinds.includes('measure') || kinds.includes('count')) row.push(annotation.measure ? scaleLabel({ ...annotation.measure, denominator: annotation.measure.mmPerPoint / PT_MM, paper: 'PDF', source: 'standard' }) : '')
    if (kinds.includes('count')) row.push(annotation.count || annotation.quantity ? fixtureName : '', annotation.count || annotation.quantity ? fixture?.code ?? '' : '', annotation.count || annotation.quantity ? fixture?.category ?? (annotation.count?.version === 1 ? 'その他' : '') : '')
    return row.map(quote).join(',')
  })
  return `\uFEFF${[header.map(quote).join(','), ...rows].join('\r\n')}\r\n`
}

export function annotationCsvFileName(pdfName: string): string {
  return `${pdfName.replace(/\.pdf$/i, '')}_書き込み一覧.csv`
}

export const ISSUE_CSV_HEADER = [...ANNOTATION_CSV_HEADER, '状態', '分野', '回答', '修正確認', '引継ぎ元番号', '引継ぎ元文書']
export function createIssueCsv(annotations: readonly EditableAnnotation[]): string {
  return createCsv(annotations, ['issue'])
}
export function issueCsvFileName(pdfName: string): string { return pdfName.replace(/\.pdf$/i, '') + '_指摘一覧.csv' }

export function createCountCsv(annotations: readonly Pick<EditableAnnotation, 'count' | 'quantity' | 'measure' | 'vertices' | 'pageIndex'>[], fixtures: readonly CountFixture[], currentPageIndex: number): string {
  const totals = new Map<string, Map<number, number>>(), pages = new Set<number>()
  for (const a of annotations) if (a.count || a.quantity) {
    const id = a.quantity?.itemId ?? countFixtureId(a.count!), byPage = totals.get(id) ?? new Map<number, number>()
    byPage.set(a.pageIndex, (byPage.get(a.pageIndex) ?? 0) + (a.quantity && a.vertices && a.measure ? quantityValue(a.vertices, a.measure.mmPerPoint, a.quantity) : 1)); totals.set(id, byPage); pages.add(a.pageIndex)
  }
  const columns = [...pages].sort((a, b) => a - b)
  const header = ['分類', '略号', '名称', '種別', '単位', `表示中の図面（p.${currentPageIndex + 1}）`, '全図面の合計', ...columns.map(p => `p.${p + 1}`)]
  const rows = [...fixtures].sort((a, b) => a.order - b.order).map(f => {
    const counts = totals.get(f.id)
    const kind = quantityKind(f), format = (n: number) => kind === 'count' ? n : n.toFixed(2)
    return [f.category, f.code, f.name, { count: '個数', length: '長さ', area: '面積', volume: '体積' }[kind], QUANTITY_UNITS[kind], format(counts?.get(currentPageIndex) ?? 0), format([...(counts?.values() ?? [])].reduce((a, b) => a + b, 0)), ...columns.map(p => format(counts?.get(p) ?? 0))]
  })
  return '\uFEFF' + [header, ...rows].map(row => row.map(quote).join(',')).join('\r\n') + '\r\n'
}


export function quantityAnnotationLabel(annotation: Pick<EditableAnnotation, 'quantity'>): string {
  const method = annotation.quantity?.method
  return '数量拾い（' + (method === 'polyline' ? '長さ' : method === 'polygon' || method === 'lengthHeight' ? '面積' : '体積') + '）'
}
