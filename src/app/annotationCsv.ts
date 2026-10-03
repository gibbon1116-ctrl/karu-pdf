import { scaleLabel, PT_MM } from '../core/measure'
import { issueStatusLabel, issueColor } from '../core/issues'
import { countSummary } from '../core/counts'
import { SYMBOL_OPTIONS } from '../core/annotations'
import type { EditableAnnotation } from '../editor/AnnotationStore'

const PT_TO_MM = 25.4 / 72

export const ANNOTATION_CSV_HEADER = ['番号', 'ページ', '種類', '本文', '色', '位置（x, y mm）', '大きさ（幅, 高さ mm）', '縮尺']

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
  const sorted = [...annotations].sort((left, right) => (
    left.pageIndex - right.pageIndex || left.rect[1] - right.rect[1] || left.rect[0] - right.rect[0]
  ))
  const rows = sorted.map((annotation, index) => {
    const [left, top, right, bottom] = annotation.rect
    return [
      index + 1,
      annotation.pageIndex + 1,
      annotationKindLabel(annotation.kind),
      annotationBody(annotation),
      annotationColorHex(annotation),
      `${decimal(left)}, ${decimal(top)}`,
      `${decimal(right - left)}, ${decimal(bottom - top)}`,
      annotation.measure ? scaleLabel({ ...annotation.measure, denominator: annotation.measure.mmPerPoint / PT_MM, paper: 'PDF', source: 'standard' }) : '',
    ].map(quote).join(',')
  })
  return `\uFEFF${[ANNOTATION_CSV_HEADER.map(quote).join(','), ...rows].join('\r\n')}\r\n`
}

export function annotationCsvFileName(pdfName: string): string {
  return `${pdfName.replace(/\.pdf$/i, '')}_書き込み一覧.csv`
}

export const ISSUE_CSV_HEADER = ['番号', 'ページ', '指摘の内容', '状態', '回答', '位置（x, y mm）', '分野', '修正確認', '図面番号', '指摘ID', '引継ぎ元ID', '引継ぎ元文書']
export function createIssueCsv(annotations: readonly EditableAnnotation[]): string {
  const rows = annotations.filter(a => a.issue && a.issue.recordKind !== 'change').sort((a, b) => a.issue!.number - b.issue!.number).map(a => [
    a.issue!.number, a.pageIndex + 1, a.text, issueStatusLabel(a.issue!.status), a.issue!.answer ?? '',
    `${decimal(a.rect[0])}, ${decimal(a.rect[1])}`,
    a.issue!.discipline ?? '', a.issue!.verification ?? '', a.issue!.drawingNumber ?? '', a.issue!.id ?? '', a.issue!.sourceId ?? '', a.issue!.sourceDocument ?? '',
  ].map(quote).join(','))
  return '\uFEFF' + [ISSUE_CSV_HEADER.map(quote).join(','), ...rows].join('\r\n') + '\r\n'
}
export function issueCsvFileName(pdfName: string): string { return pdfName.replace(/\.pdf$/i, '') + '_指摘一覧.csv' }

export function createCountCsv(annotations: readonly EditableAnnotation[]): string {
  return '\uFEFF' + [['種類', 'ページ', '個数'], ...countSummary(annotations).map(a => [a.group, a.pageIndex + 1, a.total])].map(row => row.map(quote).join(',')).join('\r\n') + '\r\n'
}

export function createChangeCsv(annotations: readonly EditableAnnotation[]): string {
  const rows = annotations.filter(a => a.issue?.recordKind === 'change').sort((a,b) => a.issue!.number-b.issue!.number).map(a => [
    a.issue!.number, a.pageIndex+1, a.text, a.issue!.changeReason ?? '', a.issue!.relatedIssueId ?? '', issueStatusLabel(a.issue!.status), a.issue!.drawingNumber ?? '', a.issue!.id ?? '', `${decimal(a.rect[0])}, ${decimal(a.rect[1])}`,
  ])
  return '\uFEFF' + [['番号', 'ページ', '変更内容', '変更理由', '関連指摘ID', '状態', '図面番号', '変更ID', '位置（x, y mm）'], ...rows].map(row => row.map(quote).join(',')).join('\r\n') + '\r\n'
}
