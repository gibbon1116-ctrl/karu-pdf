import type { RGB } from '../core/annotations'
import type { FontName } from '../core/fontMetrics'
import { parsePageRange } from '../organize/organizeUtils'

export type HeaderFooterField = 'topLeft' | 'topCenter' | 'topRight' | 'bottomLeft' | 'bottomCenter' | 'bottomRight'
export type HeaderFooterDateFormat = 'japanese' | 'slash' | 'era'

export interface HeaderFooterSettings {
  fields: Record<HeaderFooterField, string>
  startNumber: number
  target: 'all' | 'range'
  range: string
  font: FontName
  fontSize: number
  color: RGB
  verticalMarginMm: number
  horizontalMarginMm: number
  dateFormat: HeaderFooterDateFormat
}

export const DEFAULT_HEADER_FOOTER_SETTINGS: HeaderFooterSettings = {
  fields: { topLeft: '', topCenter: '', topRight: '', bottomLeft: '', bottomCenter: '- {ページ} -', bottomRight: '' },
  startNumber: 1,
  target: 'all',
  range: '',
  font: 'BIZUDGothic',
  fontSize: 10.5,
  color: [0, 0, 0],
  verticalMarginMm: 10,
  horizontalMarginMm: 15,
  dateFormat: 'japanese',
}

export function targetPages(settings: HeaderFooterSettings, pageCount: number): { pages: number[]; error: string | null } {
  if (!Number.isInteger(settings.startNumber) || settings.startNumber < 1) return { pages: [], error: '開始番号は1以上の整数にしてください。' }
  if (!(settings.fontSize >= 6 && settings.fontSize <= 72)) return { pages: [], error: '文字の大きさは6〜72ptにしてください。' }
  const parsed = settings.target === 'all'
    ? { pages: Array.from({ length: pageCount }, (_, index) => index), error: null }
    : parsePageRange(settings.range, pageCount)
  return parsed.error ? parsed : { pages: [...parsed.pages].sort((a, b) => a - b), error: null }
}

export function pageNumberMap(settings: HeaderFooterSettings, pageCount: number): { numbers: Map<number, number>; total: number; error: string | null } {
  const parsed = targetPages(settings, pageCount)
  const numbers = new Map<number, number>()
  parsed.pages.forEach((pageIndex, index) => numbers.set(pageIndex, settings.startNumber + index))
  return { numbers, total: settings.startNumber + Math.max(0, parsed.pages.length - 1), error: parsed.error }
}

export function composeHeaderFooterText(template: string, values: { page: number; total: number; date: string; fileName: string }): string {
  return template
    .replaceAll('{ページ}', String(values.page))
    .replaceAll('{総ページ}', String(values.total))
    .replaceAll('{日付}', values.date)
    .replaceAll('{ファイル名}', values.fileName.replace(/\.pdf$/i, ''))
}

export function formatHeaderFooterDate(date: Date, format: HeaderFooterDateFormat): string {
  if (format === 'slash') {
    const parts = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    return `${value.year}/${value.month}/${value.day}`
  }
  if (format === 'era') return new Intl.DateTimeFormat('ja-JP-u-ca-japanese', { era: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(date)
  return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }).format(date)
}

export function hasHeaderFooterText(settings: HeaderFooterSettings): boolean {
  return Object.values(settings.fields).some((value) => value.length > 0)
}
