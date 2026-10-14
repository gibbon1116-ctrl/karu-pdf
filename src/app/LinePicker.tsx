import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { fixtureCode, fixtureChoiceLabel, fixtureIdentity, nextCountStyle, nextQuantityLineStyle, quantityMethod, type CountFixture, type FixturePreset } from '../core/countFixtures'
import { routeMembers, conditionScope, conditionSuffix } from '../core/quantity'
import { isRouteSurfaceFixture, surfacePerimeterM } from '../core/routeSurface'

type CatalogLineCandidate = { key: string; label: string; preset: FixturePreset; surface: boolean }
import type { AnnotationStore, EditableAnnotation } from '../editor/AnnotationStore'
import { QuantitySwatch } from '../editor/countMarkers'
import { groupFixtures } from './fixtureOrder'
import FixtureHoverCard, { useFixtureHover } from './FixtureHoverCard'
import { linkRelations } from './linkRelations'

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
  store.setRouteMembers(a.id, entries.map(e => e.itemId === itemId ? { ...e, count } : e))
  announceRoute(store, a.id, null, `${fixtureCode(store.getCountFixture(itemId)!)} を ${count}条にしました`)
}

export default function LinePicker({ store, annotation, onClose }: { store: AnnotationStore; annotation: EditableAnnotation; onClose(): void }) {
  const root = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState(''), [master, setMaster] = useState<CatalogLineCandidate[]>([]), [active, setActive] = useState(-1), [error, setError] = useState('')
  const version = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const fixtures = store.getCountFixtures(), entries = routeEntries(annotation), full = entries.length >= 11
  const relations = useMemo(() => linkRelations(fixtures), [fixtures])
  const { hover, show, hide } = useFixtureHover()
  const matches = (f: CountFixture) => `${fixtureCode(f)} ${f.name} ${f.category}`.normalize('NFKC').toLocaleLowerCase().includes(query.trim().normalize('NFKC').toLocaleLowerCase())
  const lines = fixtures.filter(f => !f.link && !isRouteSurfaceFixture(f)
    && (quantityMethod(f) === 'polyline' || quantityMethod(f) === 'lengthWidthDepth'))
  const surfaces = fixtures.filter(isRouteSurfaceFixture)
  const recent = store.recentFixtureIds.map(id => lines.find(f => f.id === id)).filter((f): f is CountFixture => !!f && matches(f))
  const groups = groupFixtures(lines.filter(matches))
  const surfaceRecent = store.recentFixtureIds.map(id => surfaces.find(f => f.id === id))
    .filter((f): f is CountFixture => !!f && matches(f))
  const surfaceGroups = groupFixtures(surfaces.filter(matches))
  const masterLines = master.filter(candidate => !candidate.surface)
  const masterSurfaces = master.filter(candidate => candidate.surface)
  useEffect(() => {
    search.current?.focus()
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) onClose() }
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape, true)
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true) }
  }, [onClose])
  useEffect(() => {
    let alive = true; setMaster([]); setActive(-1); setError('')
    if (query.trim()) void import('../core/catalog').then(catalog => {
      const existing = new Set(fixtures.map(fixtureIdentity))
      const seen = new Set<string>()
      const result: CatalogLineCandidate[] = []
      for (const { item, options } of catalog.searchCatalog(query, Number.MAX_SAFE_INTEGER).results) {
        for (const option of options) {
          const surface = option.method === 'polygon' || option.method === 'lengthHeight'
          if (option.method !== 'polyline' && option.method !== 'lengthWidthDepth'
            && !surface) continue
          const preset = catalog.catalogPresets(item, { options: [option.key] })[0]
          if (!preset) continue
          const identity = fixtureIdentity(preset)
          if (existing.has(identity) || seen.has(identity)) continue
          seen.add(identity)
          result.push({
            key: JSON.stringify([item.key, option.key]),
            label: option.label,
            preset,
            surface,
          })
          if (result.length === 30) break
        }
        if (result.length === 30) break
      }
      if (alive) setMaster(result)
    }).catch(() => { if (alive) setError('標準マスタを読み込めませんでした') })
    return () => { alive = false }
  }, [query, store, annotation, version])
  const add = (candidate: CountFixture | CatalogLineCandidate) => {
    hide()
    if (full) return
    try {
      let f: CountFixture, newFixtures: CountFixture[] = []
      if ('id' in candidate) f = candidate
      else {
        const appearance = nextQuantityLineStyle(fixtures)
        const preset = structuredClone(candidate.preset)
        f = {
          ...preset,
          conditions: [...(preset.conditions ?? [])],
          id: crypto.randomUUID(),
          order: fixtures.reduce((n, fixture) => Math.max(n, fixture.order + 1), 0),
          style: { ...nextCountStyle([]), color: appearance.color },
          line: appearance.line,
        }
        newFixtures = [f]
      }
      if (entries.some(e => e.itemId === f.id)) return
      const remembered = structuredClone(
        store.lastRouteConditions.get(f.id) ?? f.routeDefaults ?? {},
      )
      const cond = quantityMethod(f) === 'lengthWidthDepth'
        ? { ...remembered, rise: null, slack: null }
        : remembered
      const main = store.getCountFixture(entries[0]?.itemId ?? '')
      const perM = isRouteSurfaceFixture(f) && main ? surfacePerimeterM(main) : undefined
      const next = [...entries, {
        itemId: f.id, count: 1, cond,
        ...(perM !== undefined ? { perM } : {}),
      }]
      if (newFixtures.length) store.addFixturesAndSetRouteItems(newFixtures, annotation.id, next)
      else store.setRouteItems(annotation.id, next)
      if (!store.get(annotation.id)?.quantity?.extra?.some(e => e.itemId === f.id)) return
      // Selecting a picker result must leave the current drawing tool and template intact.
      store.rememberRouteFixture(f.id)
      announceRoute(store, annotation.id, f.id, `${fixtureCode(f)} を足しました（1条・${conditionSuffix(next[next.length - 1].cond).slice(1, -1) || '未設定'}）`); onClose()
    } catch (reason) { setError(String(reason)) }
  }
  const candidates: Array<CountFixture | CatalogLineCandidate> = [
    ...recent, ...groups.flatMap(g => g.items), ...masterLines,
    ...surfaceRecent, ...surfaceGroups.flatMap(g => g.items), ...masterSurfaces,
  ].filter(f => !('id' in f) || !entries.some(e => e.itemId === f.id))
  useEffect(() => { root.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' }) }, [active])
  let index = 0
  const button = (f: CountFixture | CatalogLineCandidate, prefix: string) => {
    const added = 'id' in f && entries.some(e => e.itemId === f.id)
    const i = added ? -1 : index++
    const code = 'id' in f ? fixtureCode(f) : f.label
    const choice = fixtureChoiceLabel('id' in f ? f : f.preset)
    return <button key={prefix + ('id' in f ? f.id : f.key)} type="button" aria-label={code + (added ? ' 追加済み' : '')} disabled={full || added} className={active === i ? 'active' : ''}
      onPointerEnter={event => {
        const fixture: CountFixture = 'id' in f ? f : {
          ...f.preset,
          id: `catalog:${f.key}`,
          order: -1,
          style: nextCountStyle([]),
        }
        show(fixture, event.currentTarget.getBoundingClientRect())
      }}
      onPointerLeave={hide} onClick={() => add(f)}>
      {'style' in f && <QuantitySwatch fixture={f} />}
      <span className="line-picker-choice-label">
        {choice.code && <strong>{choice.code}</strong>}
        <small title={choice.name}>{choice.name}</small>
        {choice.detail && <small className="line-picker-detail">{choice.detail}</small>}
      </span>
      {added && <span>追加済み</span>}
    </button>
  }
  return <div ref={root} role="dialog" aria-label="線要素を追加" className="line-picker" onKeyDown={e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const direction = e.key === 'ArrowDown' ? 1 : -1; setActive(i => candidates.length ? i < 0 ? direction === 1 ? 0 : candidates.length - 1 : (i + direction + candidates.length) % candidates.length : -1) }
    // Enter right after typing adds the first match, so the common case is type → Enter.
    if (e.key === 'Enter' && candidates[Math.max(0, active)]) { e.preventDefault(); add(candidates[Math.max(0, active)]) }
  }}>
    <input ref={search} aria-label="線要素を検索" value={query} onChange={e => { hide(); setQuery(e.currentTarget.value) }} />
    {full && <p role="status">これ以上足せません（最大 11 項目）</p>}
    {error && <p role="alert">{error}</p>}
    <div className="line-picker-results">
      {recent.length > 0 && <section><h4>最近使った</h4>{recent.map(f => button(f, 'recent'))}</section>}
      <section><h4>この PDF の項目</h4>{groups.map(g => <div key={g.category}><h5>{g.category}</h5>{g.items.map(f => button(f, 'pdf'))}</div>)}</section>
      {query.trim() && <section><h4>標準マスタ</h4>{masterLines.map(f => button(f, 'master'))}</section>}
      {(surfaceGroups.length > 0 || masterSurfaces.length > 0) && <section>
        <h4>表面積（周長×長さ）</h4>
        {surfaceRecent.length > 0 && <div><h5>最近使った</h5>
          {surfaceRecent.map(f => button(f, 'surface-recent'))}
        </div>}
        {surfaceGroups.length > 0 && <div><h5>この PDF の項目</h5>
          {surfaceGroups.map(g => <div key={g.category}><h5>{g.category}</h5>
            {g.items.map(f => button(f, 'surface-pdf'))}
          </div>)}
        </div>}
        {query.trim() && masterSurfaces.length > 0 && <div><h5>標準マスタ</h5>
          {masterSurfaces.map(f => button(f, 'surface-master'))}
        </div>}
      </section>}
    </div>
    {hover && <FixtureHoverCard fixture={hover.fixture} fixtures={fixtures}
      anchorRect={hover.anchorRect} relations={relations} />}
  </div>
}
