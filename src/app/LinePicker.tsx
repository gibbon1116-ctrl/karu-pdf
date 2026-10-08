import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { fixtureCode, nextCountStyle, nextQuantityLineStyle, quantityMethod, type CountFixture } from '../core/countFixtures'
import { routeMembers, conditionScope, conditionsFromScope } from '../core/quantity'
import type { MasterEntry } from '../core/quantityMaster'
import type { AnnotationStore, EditableAnnotation } from '../editor/AnnotationStore'
import { QuantitySwatch } from '../editor/countMarkers'
import { groupFixtures } from './fixtureOrder'
import { scopeShort } from './routeSets'

// Scope is a derived display projection for PickupBar (which remains unchanged in 07a).
export const routeEntries = (a: EditableAnnotation) => routeMembers(a.quantity!).map(e => ({ ...e, scope: conditionScope(e.cond) }))
type Feedback = { routeId: string; message: string; serial: number; highlights: Readonly<Record<string, number>> }
const empty: Feedback = { routeId: '', message: '', serial: 0, highlights: {} }
const feedback = new WeakMap<AnnotationStore, Feedback>(), listeners = new WeakMap<AnnotationStore, Set<() => void>>()
export const routeHighlighted = (value: Feedback, routeId: string, itemId: string) => value.highlights[JSON.stringify([routeId, itemId])] !== undefined
export function announceRoute(store: AnnotationStore, routeId: string, itemId: string | null, message: string): void {
  const previous = feedback.get(store) ?? empty, serial = previous.serial + 1, key = JSON.stringify([routeId, itemId])
  const value = { routeId, message, serial, highlights: itemId ? { ...previous.highlights, [key]: serial } : previous.highlights }
  feedback.set(store, value); listeners.get(store)?.forEach(l => l())
  if (itemId) setTimeout(() => {
    const current = feedback.get(store)
    if (current?.highlights[key] === serial) {
      const highlights = { ...current.highlights }; delete highlights[key]
      feedback.set(store, { ...current, highlights }); listeners.get(store)?.forEach(l => l())
    }
  }, 2500)
}
export function useRouteFeedback(store: AnnotationStore) {
  return useSyncExternalStore(listener => { let set = listeners.get(store); if (!set) listeners.set(store, set = new Set()); set.add(listener); return () => { set.delete(listener) } }, () => feedback.get(store) ?? empty)
}
export function changeRouteCount(store: AnnotationStore, a: EditableAnnotation, itemId: string, count: number): void {
  const entries = routeEntries(a), current = entries.find(e => e.itemId === itemId)
  if (!current || count < 1 || count > 99 || !Number.isInteger(count) || count === current.count) return
  store.setRouteItems(a.id, entries.map(e => e.itemId === itemId ? { ...e, count } : e))
  announceRoute(store, a.id, null, `${fixtureCode(store.getCountFixture(itemId)!)} を ${count}条にしました`)
}

export default function LinePicker({ store, annotation, onClose }: { store: AnnotationStore; annotation: EditableAnnotation; onClose(): void }) {
  const root = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState(''), [master, setMaster] = useState<MasterEntry[]>([]), [active, setActive] = useState(-1), [error, setError] = useState('')
  const fixtures = store.getCountFixtures(), entries = routeEntries(annotation), full = entries.length >= 11
  const matches = (f: CountFixture) => `${fixtureCode(f)} ${f.name} ${f.category}`.normalize('NFKC').toLocaleLowerCase().includes(query.trim().normalize('NFKC').toLocaleLowerCase())
  const lines = fixtures.filter(f => quantityMethod(f) === 'polyline')
  const recent = store.recentFixtureIds.map(id => lines.find(f => f.id === id)).filter((f): f is CountFixture => !!f && matches(f))
  const groups = groupFixtures(lines.filter(matches))
  useEffect(() => {
    search.current?.focus()
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) onClose() }
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape, true)
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true) }
  }, [onClose])
  useEffect(() => {
    let alive = true; setMaster([]); setActive(-1)
    if (query.trim()) void import('../core/quantityMaster').then(m => {
      const result = m.searchQuantityMaster(query, Number.MAX_SAFE_INTEGER).entries.filter(e => e.kind === 'length' && !fixtures.some(f => quantityMethod(f) === 'polyline' && f.code === e.code && (f.spec ?? '') === (e.spec ?? '') && f.name === e.name)).slice(0, 30)
      if (alive) setMaster(result)
    }).catch(() => { if (alive) setError('標準マスタを読み込めませんでした') })
    return () => { alive = false }
  }, [query, store, annotation])
  const add = (candidate: CountFixture | MasterEntry) => {
    if (full) return
    try {
      let f: CountFixture, newFixtures: CountFixture[] = []
      if ('id' in candidate) f = candidate
      else {
        const appearance = nextQuantityLineStyle(fixtures)
        const { code, spec, name, category, kind, method, defaults, aggregation } = candidate
        f = { id: crypto.randomUUID(), code, spec, name, category, kind, method, defaults, aggregation, order: fixtures.reduce((n, f) => Math.max(n, f.order + 1), 0), style: { ...nextCountStyle([]), color: appearance.color }, line: appearance.line }
        newFixtures = [f]
      }
      if (entries.some(e => e.itemId === f.id)) return
      const next = [...entries, { itemId: f.id, count: 1, cond: structuredClone(store.lastRouteConditions.get(f.id) ?? conditionsFromScope(f.routeScope)) }]
      if (newFixtures.length) store.addFixturesAndSetRouteItems(newFixtures, annotation.id, next)
      else store.setRouteItems(annotation.id, next)
      if (!store.get(annotation.id)?.quantity?.extra?.some(e => e.itemId === f.id)) return
      // Selecting a picker result must leave the current drawing tool and template intact.
      store.rememberRouteFixture(f.id)
      announceRoute(store, annotation.id, f.id, `${fixtureCode(f)} を足しました（1条・${scopeShort(conditionScope(next[next.length - 1].cond))}）`); onClose()
    } catch (reason) { setError(String(reason)) }
  }
  const candidates: Array<CountFixture | MasterEntry> = [...recent, ...groups.flatMap(g => g.items), ...master].filter(f => !('id' in f) || !entries.some(e => e.itemId === f.id))
  useEffect(() => { root.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' }) }, [active])
  let index = 0
  const button = (f: CountFixture | MasterEntry, prefix: string) => {
    const added = 'id' in f && entries.some(e => e.itemId === f.id), i = added ? -1 : index++, code = fixtureCode(f)
    return <button key={prefix + ('id' in f ? f.id : f.key)} type="button" aria-label={code + (added ? ' 追加済み' : '')} disabled={full || added} className={active === i ? 'active' : ''} onClick={() => add(f)}>
      {'style' in f && <QuantitySwatch fixture={f} />}<strong>{code}</strong><small title={f.name}>{f.name}</small>{added && <span>追加済み</span>}
    </button>
  }
  return <div ref={root} role="dialog" aria-label="線要素を追加" className="line-picker" onKeyDown={e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const direction = e.key === 'ArrowDown' ? 1 : -1; setActive(i => candidates.length ? i < 0 ? direction === 1 ? 0 : candidates.length - 1 : (i + direction + candidates.length) % candidates.length : -1) }
    // Enter right after typing adds the first match, so the common case is type → Enter.
    if (e.key === 'Enter' && candidates[Math.max(0, active)]) { e.preventDefault(); add(candidates[Math.max(0, active)]) }
  }}>
    <input ref={search} aria-label="線要素を検索" value={query} onChange={e => setQuery(e.currentTarget.value)} />
    {full && <p role="status">これ以上足せません（最大 11 項目）</p>}
    {error && <p role="alert">{error}</p>}
    <div className="line-picker-results">
      {recent.length > 0 && <section><h4>最近使った</h4>{recent.map(f => button(f, 'recent'))}</section>}
      <section><h4>この PDF の項目</h4>{groups.map(g => <div key={g.category}><h5>{g.category}</h5>{g.items.map(f => button(f, 'pdf'))}</div>)}</section>
      {query.trim() && <section><h4>標準マスタ</h4>{master.map(f => button(f, 'master'))}</section>}
    </div>
  </div>
}
