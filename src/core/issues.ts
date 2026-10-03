import type { PDFDocument } from 'mupdf'
import type { RGB, Rect } from './annotations'

export const ISSUE_STATUSES = ['open', 'answered', 'revised', 'confirmed', 'done'] as const
export interface Issue {
  number: number; status: typeof ISSUE_STATUSES[number]
  version?: 1; id?: string; discipline?: string; answer?: string; verification?: string; drawingNumber?: string
  sourceId?: string; sourceDocument?: string
}
export function parseIssue(json: string | null): Issue | null {
  try {
    if (!json || json.length > 24000) return null
    const value = JSON.parse(json) as Issue
    if (!value || !Number.isSafeInteger(value.number) || value.number <= 0 || !ISSUE_STATUSES.includes(value.status)) return null
    const result: Issue = { number: value.number, status: value.status }
    if (value.version !== undefined) { if (value.version !== 1) return null; result.version = 1 }
    for (const key of ['id', 'discipline', 'answer', 'verification', 'drawingNumber', 'sourceId', 'sourceDocument'] as const) {
      if (value[key] === undefined) continue
      const maximum = key === 'answer' || key === 'verification' ? 8000 : 200
      if (typeof value[key] !== 'string' || value[key]!.length > maximum) return null
      result[key] = value[key]
    }
    return result
  } catch { return null }
}
export const issueStatusLabel = (status: Issue['status']) => ({ open: '未回答', answered: '回答済', revised: '修正済', confirmed: '確認済', done: '対応済（旧版）' })[status]
export const unresolvedIssue = (issue: Issue): boolean => issue.status !== 'confirmed'
export const issueColor = (issue: Issue, color: RGB): RGB => issue.status === 'done' || issue.status === 'confirmed' ? [.5, .5, .5] : color
export function issueFontSize(number: number, size: number): number {
  // BIZ UD Gothic has half-em digits; leave room inside the circle for any digit count.
  return Math.min(size * .62, size * 1.1 / String(number).length)
}
export function issueOrder<T extends { pageIndex: number; rect: Rect }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.pageIndex - b.pageIndex || a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0])
}
export class IssueNumbers {
  private maximum = 0
  get current(): number { return this.maximum }
  renumber(maximum: number): void { this.maximum = maximum }
  private initialized: Promise<void> | null = null
  initialize(load: () => Promise<number>): Promise<void> {
    // Keep the promise, including rejection: at most one scan per document.
    return this.initialized ??= Promise.resolve().then(load).then(n => { this.observe(n) })
  }
  observe(number: number): void { if (Number.isSafeInteger(number) && number > 0) this.maximum = Math.max(this.maximum, number) }
  next(): number {
    if (this.maximum >= Number.MAX_SAFE_INTEGER) throw new Error('指摘の番号が上限に達しました。')
    return ++this.maximum
  }
}
export function maxIssueNumber(doc: PDFDocument): number {
  let maximum = 0
  // Only inspect page dictionaries /Annots. No loadPage, rendering, text or font work.
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.findPage(i), annots = page.get('Annots')
    try {
      for (let j = 0; j < annots.length; j++) {
        const annotation = annots.get(j), subtype = annotation.get('Subtype'), raw = annotation.get('KaruIssue')
        try {
          const issue = subtype.asName() === 'Stamp' && raw.isString() ? parseIssue(raw.asString()) : null
          if (issue) maximum = Math.max(maximum, issue.number)
        } finally { raw.destroy(); subtype.destroy(); annotation.destroy() }
      }
    } finally { annots.destroy(); page.destroy() }
  }
  return maximum
}
