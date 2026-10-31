export type OutlineViewType = 'XYZ' | 'Fit' | 'FitH' | 'FitV' | 'FitR' | 'FitB' | 'FitBH' | 'FitBV'
/** PDF user-space values after the page reference; null represents PDF null. */
export interface OutlineView { type: OutlineViewType; params: (number | null)[] }
export type OutlineTarget =
  | { kind: 'page'; pageIndex: number; view: OutlineView | null; source: 'dest' | 'named' | 'goto'; name?: string }
  | { kind: 'external'; uri: string }
  | { kind: 'special'; action: string }
  | { kind: 'broken'; reason: string }
  | { kind: 'none' }
export interface OutlineStyle { bold: boolean; italic: boolean; color: [number, number, number] | null }
export interface OutlineItem { id: string; title: string; open: boolean; target: OutlineTarget; style: OutlineStyle; children: OutlineItem[] }
export interface OutlineSnapshot { revision: string; items: OutlineItem[]; editable: boolean; problems: string[]; itemCount: number }
export type OutlineTargetEdit = { kind: 'keep' } | { kind: 'page'; pageIndex: number; view: OutlineView | null } | { kind: 'none' }
export interface OutlinePlanItem { id: string; title: string; open: boolean; target: OutlineTargetEdit; children: OutlinePlanItem[] }
export interface OutlineApplyPlan { baseRevision: string; items: OutlinePlanItem[] }
export interface OutlineApplyResult { snapshot: OutlineSnapshot; idMap: Record<string, string> }
export type OutlineInsertPosition = { kind: 'before' | 'after' | 'child'; id: string } | { kind: 'end' }
export interface OutlineLayoutImpactItem { id: string; title: string; pageIndex: number; path: string[]; hasChildren: boolean }
export interface OutlineLayoutDuplicate { id: string; title: string; pageIndex: number; newPositions: number[]; originalFirst: boolean }
export interface OutlineLayoutImpact { hasOutline: boolean; editable: boolean; problems: string[]; revision: string; removed: OutlineLayoutImpactItem[]; duplicated: OutlineLayoutDuplicate[] }
export interface OutlineLayoutPlan { baseRevision: string; remove: string[]; retarget: Array<{ id: string; cardIndex: number }> }
export const OUTLINE_MAX_ITEMS = 10_000
export const OUTLINE_MAX_DEPTH = 64
export const OUTLINE_MAX_TITLE = 1_000
export const NEW_OUTLINE_TITLE = '新しい目次'

export function findOutlineItem(items: OutlineItem[], id: string): { item: OutlineItem; parent: OutlineItem | null; siblings: OutlineItem[]; index: number; depth: number } | null {
  const visit = (siblings: OutlineItem[], parent: OutlineItem | null, depth: number): ReturnType<typeof findOutlineItem> => {
    for (let index = 0; index < siblings.length; index++) {
      const item = siblings[index]
      if (item.id === id) return { item, parent, siblings, index, depth }
      const found = visit(item.children, item, depth + 1)
      if (found) return found
    }
    return null
  }
  return visit(items, null, 0)
}

export function flattenOutline(items: OutlineItem[], isExpanded?: (item: OutlineItem) => boolean): { item: OutlineItem; depth: number; parentId: string | null; hasChildren: boolean }[] {
  const result: ReturnType<typeof flattenOutline> = []
  const visit = (list: OutlineItem[], depth: number, parentId: string | null) => {
    for (const item of list) {
      result.push({ item, depth, parentId, hasChildren: item.children.length > 0 })
      if (!isExpanded || isExpanded(item)) visit(item.children, depth + 1, item.id)
    }
  }
  visit(items, 0, null)
  return result
}
export function countOutlineItems(items: OutlineItem[]): number { return flattenOutline(items).length }
export function isOutlineDescendant(items: OutlineItem[], ancestorId: string, id: string): boolean {
  const ancestor = findOutlineItem(items, ancestorId)
  return !!ancestor && (ancestorId === id || !!findOutlineItem(ancestor.item.children, id))
}
function changeSiblings(items: OutlineItem[], parentId: string | null, action: (siblings: OutlineItem[]) => OutlineItem[]): OutlineItem[] {
  if (parentId === null) return action(items)
  return items.map(item => item.id === parentId ? { ...item, children: action(item.children) } : { ...item, children: changeSiblings(item.children, parentId, action) })
}
export function insertOutlineItem(items: OutlineItem[], position: OutlineInsertPosition, item: OutlineItem): OutlineItem[] {
  if (position.kind === 'end') return [...items, item]
  const found = findOutlineItem(items, position.id)
  if (!found) throw new Error('目次の項目が見つかりません。')
  if (position.kind === 'child') return changeSiblings(items, found.item.id, list => [...list, item])
  const index = found.index + (position.kind === 'after' ? 1 : 0)
  return changeSiblings(items, found.parent?.id ?? null, list => [...list.slice(0, index), item, ...list.slice(index)])
}
export function removeOutlineItem(items: OutlineItem[], id: string, mode: 'withChildren' | 'keepChildren'): OutlineItem[] {
  const found = findOutlineItem(items, id)
  if (!found) return items
  return changeSiblings(items, found.parent?.id ?? null, list => list.flatMap(item => item.id !== id ? [item] : mode === 'keepChildren' ? item.children : []))
}
export function moveOutlineItem(items: OutlineItem[], id: string, to: { parentId: string | null; index: number }): OutlineItem[] {
  if (to.parentId !== null && isOutlineDescendant(items, id, to.parentId)) throw new Error('目次を自分自身や子項目の下へは移動できません。')
  const found = findOutlineItem(items, id)
  if (!found) return items
  if (to.parentId !== null && !findOutlineItem(items, to.parentId)) throw new Error('目次の項目が見つかりません。')
  const remaining = removeOutlineItem(items, id, 'withChildren')
  return changeSiblings(remaining, to.parentId, list => {
    const index = Math.max(0, Math.min(list.length, Math.trunc(to.index) || 0))
    return [...list.slice(0, index), found.item, ...list.slice(index)]
  })
}
export function moveOutlineItemUp(items: OutlineItem[], id: string): OutlineItem[] {
  const f = findOutlineItem(items, id)
  return !f || f.index === 0 ? items : moveOutlineItem(items, id, { parentId: f.parent?.id ?? null, index: f.index - 1 })
}
export function moveOutlineItemDown(items: OutlineItem[], id: string): OutlineItem[] {
  const f = findOutlineItem(items, id)
  return !f || f.index === f.siblings.length - 1 ? items : moveOutlineItem(items, id, { parentId: f.parent?.id ?? null, index: f.index + 1 })
}
export function indentOutlineItem(items: OutlineItem[], id: string): OutlineItem[] {
  const f = findOutlineItem(items, id), previous = f?.siblings[(f?.index ?? 0) - 1]
  return !previous ? items : moveOutlineItem(items, id, { parentId: previous.id, index: previous.children.length })
}
export function outdentOutlineItem(items: OutlineItem[], id: string): OutlineItem[] {
  const f = findOutlineItem(items, id)
  if (!f?.parent) return items
  const p = findOutlineItem(items, f.parent.id)!
  return moveOutlineItem(items, id, { parentId: p.parent?.id ?? null, index: p.index + 1 })
}
export function updateOutlineItem(items: OutlineItem[], id: string, patch: Partial<Pick<OutlineItem, 'title' | 'open' | 'target'>>): OutlineItem[] {
  return items.map(item => item.id === id ? { ...item, ...patch } : { ...item, children: updateOutlineItem(item.children, id, patch) })
}
export function normalizeOutlineTitle(title: string): string {
  const result = title.replace(/[\r\n\t]+/g, ' ').trim()
  if (!result) throw new Error('目次の名称を入力してください。')
  if (result.length > OUTLINE_MAX_TITLE) throw new Error(`目次の名称は${OUTLINE_MAX_TITLE}文字以内にしてください。`)
  return result
}
export function outlineTargetLocked(target: OutlineTarget): boolean { return target.kind === 'external' || target.kind === 'special' }
export function outlinePageLabel(target: OutlineTarget): string {
  return target.kind === 'page' ? `${target.pageIndex + 1}` : ({ external: '外部', special: '特殊', broken: '不明', none: '—' })[target.kind]
}
export function remapOutlineIds(items: OutlineItem[], idMap: Record<string, string>): OutlineItem[] {
  return items.map(item => ({ ...item, id: item.id.startsWith('new:') ? idMap[item.id] ?? item.id : item.id, children: remapOutlineIds(item.children, idMap) }))
}
// Object property order is not significant when comparing targets or drafts.
export function outlineEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && outlineEqual(left[key], right[key]))
}
export function buildOutlineApplyPlan(baseline: OutlineSnapshot, items: OutlineItem[]): OutlineApplyPlan {
  const original = new Map(flattenOutline(baseline.items).map(({ item }) => [item.id, item]))
  const visit = (list: OutlineItem[]): OutlinePlanItem[] => list.map(item => {
    const before = original.get(item.id)
    let target: OutlineTargetEdit
    if (before && outlineEqual(before.target, item.target)) target = { kind: 'keep' }
    else if (item.target.kind === 'page') target = { kind: 'page', pageIndex: item.target.pageIndex, view: item.target.view }
    else if (item.target.kind === 'none') target = { kind: 'none' }
    else throw new Error('この目次の移動先は設定できません。')
    return { id: item.id, title: item.title, open: item.open, target, children: visit(item.children) }
  })
  return { baseRevision: baseline.revision, items: visit(items) }
}
/** `keptTitles` lists existing items whose stored title is written back unchanged, even if empty. */
export function validateOutlineItems(items: OutlineItem[], pageCount: number, keptTitles?: ReadonlySet<string>): string[] {
  const errors = new Set<string>(), ids = new Set<string>()
  let count = 0
  const visit = (list: OutlineItem[], depth: number) => {
    if (depth > OUTLINE_MAX_DEPTH) { errors.add('目次の階層が深すぎます。'); return }
    for (const item of list) {
      if (++count > OUTLINE_MAX_ITEMS) { errors.add('目次の項目が多すぎます。'); return }
      if (ids.has(item.id)) errors.add('目次のIDが重複しています。')
      ids.add(item.id)
      if (!keptTitles?.has(item.id)) try { normalizeOutlineTitle(item.title) } catch (e) { errors.add((e as Error).message) }
      if (item.target.kind === 'page' && (!Number.isInteger(item.target.pageIndex) || item.target.pageIndex < 0 || item.target.pageIndex >= pageCount)) errors.add('目次のページ番号が範囲外です。')
      if (item.children.length) visit(item.children, depth + 1)
    }
  }
  visit(items, 1)
  return [...errors]
}
export function outlineRevision(parts: string): string {
  let a = 0x811c9dc5, b = 0x9e3779b9
  for (let i = 0; i < parts.length; i++) {
    const c = parts.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193)
    b = Math.imul(b ^ c, 0x01000193)
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}
