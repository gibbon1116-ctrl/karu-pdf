import { issueStatusChoice, issueStatusLabel, unresolvedIssue, type IssueStatusChoice } from '../core/issues'
import type { EditableAnnotation } from './AnnotationStore'

export const ANNOTATION_FILTER_LABELS = {
  all: 'すべて', text: '文字', callout: '吹き出し', count: '数量拾い',
  issue: '指摘', issueOpen: '指摘（未確認）', issueDone: '指摘（修正確認）',
  measure: '計測', shape: '図形', symbol: '記号', pen: 'ペン', markup: '文字への印',
} as const
export type AnnotationFilterKind = keyof typeof ANNOTATION_FILTER_LABELS
export interface AnnotationFilter {
  kind: AnnotationFilterKind
  discipline: string
  status: '' | IssueStatusChoice
}
export const DEFAULT_ANNOTATION_FILTER: Readonly<AnnotationFilter> = Object.freeze({ kind: 'all', discipline: '', status: '' })
type FilterAnnotation = Pick<EditableAnnotation, 'legacyChange' | 'kind' | 'count' | 'quantity' | 'issue' | 'measure'>

export function matchesAnnotationFilter(annotation: FilterAnnotation, filter: Readonly<AnnotationFilter>): boolean {
  // Legacy change records appeared only under "all", independently of issue fields.
  if (annotation.legacyChange) return filter.kind === 'all'
  // Quantity marks follow the existing count-mark filters, including the symbol bucket.
  const kind = filter.kind
  const matchesKind = kind === 'all' ? true
    : kind === 'count' ? !!annotation.count || !!annotation.quantity
    : kind === 'issue' ? !!annotation.issue
    : kind === 'issueOpen' ? !!annotation.issue && unresolvedIssue(annotation.issue)
    : kind === 'issueDone' ? annotation.issue?.status === 'confirmed'
    : kind === 'measure' ? !!annotation.measure && !annotation.quantity
    : kind === 'text' ? annotation.kind === 'freetext'
    : kind === 'callout' ? annotation.kind === 'callout'
    : kind === 'symbol' ? annotation.kind === 'symbol' || !!annotation.quantity
    : kind === 'pen' ? annotation.kind === 'highlight' || annotation.kind === 'ink'
    : kind === 'markup' ? annotation.kind === 'textHighlight' || annotation.kind === 'underline' || annotation.kind === 'strikeout'
    : ['cloudSquare', 'cloudPolygon', 'line', 'arrow', 'square', 'circle'].includes(annotation.kind)
  return matchesKind
    && (!filter.discipline || !!annotation.issue?.discipline?.includes(filter.discipline))
    && (!filter.status || !!annotation.issue && issueStatusChoice(annotation.issue.status) === filter.status)
}

const COUNT_MARK: FilterAnnotation = { kind: 'symbol', count: { version: 2, id: '', fixtureId: '' } }
// Whether the filter keeps count marks, judged by the same rule as the list.
export function filterShowsCountMarks(filter: Readonly<AnnotationFilter>): boolean {
  return matchesAnnotationFilter(COUNT_MARK, filter)
}

export function annotationFilterLabel(filter: Readonly<AnnotationFilter>): string {
  return [ANNOTATION_FILTER_LABELS[filter.kind], filter.discipline ? `分野「${filter.discipline}」` : '', filter.status ? issueStatusLabel(filter.status) : ''].filter(Boolean).join('・')
}
