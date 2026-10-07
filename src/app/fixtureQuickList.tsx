import { useEffect, useMemo, useRef, useState } from 'react'
import { fixtureCode, quantityKind, type CountFixture } from '../core/countFixtures'
import { countFixtureId } from '../core/counts'
import type { AnnotationStore } from '../editor/AnnotationStore'
import { CountMarker, QuantitySwatch } from '../editor/countMarkers'
import { groupFixtures } from './fixtureOrder'

export function FixtureSwatch({ fixture }: { fixture: CountFixture }) {
  return quantityKind(fixture) === 'count'
    ? <svg className="fixture-swatch" viewBox="-14 -14 28 28" aria-hidden="true"><CountMarker style={{ ...fixture.style, size: 24, opacity: 1 }} showCode={false} /></svg>
    : <QuantitySwatch fixture={fixture} />
}

// Inspect only the selection; quantities always come from the existing index.
export function pickupFixtureId(store: AnnotationStore): string | null {
  if (!store.selectedPickupsOnly()) return store.selectedFixtureId
  const ids = store.selectedIds().map(id => {
    const mark = store.get(id)!
    return mark.quantity?.itemId ?? countFixtureId(mark.count!)
  })
  return ids.every(id => id === ids[0]) ? ids[0] : null
}

export function adjacentPickupFixture(store: AnnotationStore, direction: -1 | 1): CountFixture | undefined {
  const items = groupFixtures(store.getCountFixtures()).flatMap(group => group.items)
  const currentId = pickupFixtureId(store)
  const index = items.findIndex(item => item.id === currentId)
  return index < 0 ? undefined : items[index + direction]
}

export function RecentFixtures({ fixtures, ids, limit = 6, onSelect }: {
  fixtures: readonly CountFixture[]; ids: readonly string[]; limit?: number; onSelect(id: string): void
}) {
  const recent = ids.flatMap(id => { const fixture = fixtures.find(f => f.id === id); return fixture ? [fixture] : [] }).slice(0, limit)
  if (!recent.length) return null
  return <div className="fixture-recent" role="group" aria-label="最近使った項目"><span>最近</span>{recent.map(f =>
    <button key={f.id} type="button" title={f.name} aria-label={`最近の${fixtureCode(f)} ${f.name}`} onClick={() => onSelect(f.id)}><FixtureSwatch fixture={f} /><span>{fixtureCode(f)}</span></button>
  )}</div>
}

export default function FixtureQuickList({ fixtures, recentIds, onSelect, onClose, onDismiss }: {
  fixtures: readonly CountFixture[]; recentIds: readonly string[]; onSelect(id: string): void; onClose(): void; onDismiss(): void
}) {
  const [search, setSearch] = useState(''), [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null), root = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => {
    const matches = (f: CountFixture) => `${fixtureCode(f)} ${f.name}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())
    const recent = recentIds.flatMap(id => { const f = fixtures.find(item => item.id === id); return f && matches(f) ? [{ fixture: f, heading: '最近', key: `recent-${id}` }] : [] })
    const grouped = groupFixtures(fixtures).flatMap(group => group.items.filter(matches).map(fixture => ({ fixture, heading: group.category, key: fixture.id })))
    return [...recent, ...grouped]
  }, [fixtures, recentIds, search])
  const visible = rows.slice(0, 200)
  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => { root.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }) }, [active])
  return <div ref={root} className="fixture-quick-list" role="dialog" aria-label="項目を選ぶ" onKeyDown={event => {
    event.stopPropagation()
    if (event.key === 'Escape') { event.preventDefault(); onDismiss() }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); setActive(previous => Math.max(0, Math.min(visible.length - 1, previous + (event.key === 'ArrowDown' ? 1 : -1))))
    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault(); const row = visible[active]; if (row) { onSelect(row.fixture.id); onClose() }
    }
  }}>
    <input ref={input} type="search" aria-label="項目を検索" value={search} onChange={event => { setSearch(event.currentTarget.value); setActive(0) }}
      aria-controls="pickup-quick-options" aria-activedescendant={visible[active] ? `pickup-option-${active}` : undefined} />
    <div className="fixture-quick-options" id="pickup-quick-options" role="listbox" aria-label="数量の項目">
      {visible.map((row, index) => <div key={row.key}>
        {(index === 0 || visible[index - 1].heading !== row.heading) && <div className="fixture-quick-heading">{row.heading}</div>}
        <button id={`pickup-option-${index}`} type="button" role="option" aria-selected={index === active} data-active={index === active} title={`${fixtureCode(row.fixture)} ${row.fixture.name}`} onMouseEnter={() => setActive(index)}
          onClick={() => { onSelect(row.fixture.id); onClose() }}><FixtureSwatch fixture={row.fixture} /><span>{fixtureCode(row.fixture)} {row.fixture.name}</span></button>
      </div>)}
    </div>
    {!visible.length && <p>該当する項目がありません</p>}
    {rows.length > 200 && <p>検索で絞り込んでください</p>}
  </div>
}
