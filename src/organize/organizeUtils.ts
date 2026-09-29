import type { PageLayoutCard } from '../core/pageOps'

export type InsertPosition = 'start' | 'end' | 'before' | 'after' | 'afterPage'

export type OrganizeSplitMode =
  | { kind: 'every'; count: number }
  | { kind: 'before'; cardIds: string[] }
  | { kind: 'single' }
  | { kind: 'equal'; files: number }

const FULL_WIDTH_FROM = '０１２３４５６７８９－ー―，、　'
const FULL_WIDTH_TO = '0123456789---,, '

export function normalizePageRange(value: string): string {
  return [...value].map((character) => {
    const index = FULL_WIDTH_FROM.indexOf(character)
    return index >= 0 ? FULL_WIDTH_TO[index] : character
  }).join('')
}

export function parsePageRange(value: string, pageCount: number): { pages: number[]; error: string | null } {
  const normalized = normalizePageRange(value).replace(/\s+/g, '')
  if (!normalized) return { pages: [], error: 'ページ番号を入力してください。' }
  const pages: number[] = []
  const seen = new Set<number>()
  for (const part of normalized.split(',')) {
    if (!part) return { pages: [], error: 'カンマの前後にページ番号を入力してください。' }
    const match = /^(\d+)(?:-(\d+))?$/.exec(part)
    if (!match) return { pages: [], error: `「${part}」を読み取れません。` }
    const start = Number(match[1])
    const end = Number(match[2] ?? match[1])
    if (start < 1 || end < 1 || start > pageCount || end > pageCount) {
      return { pages: [], error: `1〜${pageCount}の範囲で指定してください。` }
    }
    if (end < start) return { pages: [], error: `「${part}」の範囲は小さい番号から指定してください。` }
    for (let page = start; page <= end; page += 1) {
      const index = page - 1
      if (!seen.has(index)) { seen.add(index); pages.push(index) }
    }
  }
  return { pages, error: null }
}

export function insertionIndex(
  position: InsertPosition,
  cards: readonly PageLayoutCard[],
  selectedIds: readonly string[],
  afterPage: number,
): number {
  if (position === 'start') return 0
  if (position === 'end') return cards.length
  if (position === 'afterPage') return Math.max(0, Math.min(cards.length, Math.trunc(afterPage)))
  const selected = new Set(selectedIds)
  const indexes = cards.map((card, index) => selected.has(card.id) ? index : -1).filter((index) => index >= 0)
  if (indexes.length === 0) return cards.length
  return position === 'before' ? Math.min(...indexes) : Math.max(...indexes) + 1
}

export function selectionForMode(
  cards: readonly PageLayoutCard[],
  currentIds: readonly string[],
  mode: 'all' | 'invert' | 'odd' | 'even',
): string[] {
  if (mode === 'all') return cards.map((card) => card.id)
  if (mode === 'odd') return cards.filter((_, index) => index % 2 === 0).map((card) => card.id)
  if (mode === 'even') return cards.filter((_, index) => index % 2 === 1).map((card) => card.id)
  const current = new Set(currentIds)
  return cards.filter((card) => !current.has(card.id)).map((card) => card.id)
}

export function splitCardGroups(cards: readonly PageLayoutCard[], mode: OrganizeSplitMode): PageLayoutCard[][] {
  if (cards.length === 0) throw new Error('分割するページがありません。')
  if (mode.kind === 'single') return cards.map((card) => [card])
  if (mode.kind === 'every') {
    const count = Math.trunc(mode.count)
    if (count < 1) throw new Error('分割するページ数は1以上にしてください。')
    const groups: PageLayoutCard[][] = []
    for (let index = 0; index < cards.length; index += count) groups.push(cards.slice(index, index + count))
    return groups
  }
  if (mode.kind === 'equal') {
    const files = Math.trunc(mode.files)
    if (files < 1 || files > cards.length) throw new Error(`ファイル数は1〜${cards.length}で指定してください。`)
    const base = Math.floor(cards.length / files)
    const extra = cards.length % files
    const groups: PageLayoutCard[][] = []
    let start = 0
    for (let index = 0; index < files; index += 1) {
      const size = base + (index < extra ? 1 : 0)
      groups.push(cards.slice(start, start + size))
      start += size
    }
    return groups
  }
  const boundaries = new Set(mode.cardIds)
  const starts = cards.map((card, index) => boundaries.has(card.id) ? index : -1).filter((index) => index > 0)
  const points = [0, ...starts, cards.length]
  const groups = points.slice(0, -1).map((start, index) => cards.slice(start, points[index + 1])).filter((group) => group.length > 0)
  if (groups.length < 2) throw new Error('区切りにするページを選んでください。')
  return groups
}
