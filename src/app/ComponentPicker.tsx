import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  fixtureCode,
  fixtureIdentity,
  fixtureLabelCode,
  nextCountStyle,
  quantityMethod,
  type CountFixture,
  type FixturePreset,
} from '../core/countFixtures'
import { componentSuggestions } from '../core/breakdown/componentSuggestions'
import type { AnnotationStore, EditableAnnotation } from '../editor/AnnotationStore'
import { QuantitySwatch } from '../editor/countMarkers'
import { groupFixtures } from './fixtureOrder'
import FixtureHoverCard, { useFixtureHover } from './FixtureHoverCard'
import { linkRelations } from './linkRelations'

type CatalogComponentCandidate = {
  key: string
  label: string
  preset: FixturePreset
}
type Candidate = CountFixture | CatalogComponentCandidate

const isCountOption = (option: { method?: string; kind?: string }) =>
  (option.method ?? 'click') === 'click' && (option.kind ?? 'count') === 'count'

export default function ComponentPicker({ store, annotation, onClose, onAdded }: {
  store: AnnotationStore
  annotation: EditableAnnotation
  onClose(): void
  onAdded(code: string): void
}) {
  const root = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [suggested, setSuggested] = useState<Candidate[]>([])
  const [master, setMaster] = useState<CatalogComponentCandidate[]>([])
  const [active, setActive] = useState(-1)
  const [error, setError] = useState('')
  const version = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const fixtures = store.getCountFixtures()
  const relations = useMemo(() => linkRelations(fixtures), [fixtures])
  const { hover, show, hide } = useFixtureHover()
  const current = store.get(annotation.id)
  const main = store.fixtureForCount(current?.count)
  const extra = current?.count?.version === 2 ? current.count.extra ?? [] : []
  const full = extra.length >= 10
  const term = query.trim().normalize('NFKC').toLocaleLowerCase()
  const matches = (f: CountFixture) =>
    `${fixtureCode(f)} ${f.name} ${f.category}`.normalize('NFKC').toLocaleLowerCase().includes(term)
  const counts = fixtures.filter(f => quantityMethod(f) === 'click' && f.id !== main?.id)
  const recent = store.recentFixtureIds
    .map(id => counts.find(f => f.id === id))
    .filter((f): f is CountFixture => !!f && matches(f))
  const groups = groupFixtures(counts.filter(matches))

  useEffect(() => {
    search.current?.focus()
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onClose()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', escape, true)
    }
  }, [onClose])

  useEffect(() => {
    let alive = true
    setSuggested([])
    setMaster([])
    setActive(-1)
    setError('')

    const a = store.get(annotation.id)
    const mainFixture = store.fixtureForCount(a?.count)
    if (!a?.count || a.quantity || !mainFixture) return
    const names = componentSuggestions(mainFixture)
    if (!query.trim() && !names.length) return

    // The catalog is loaded only while this explicit addition dialog is open.
    void import('../core/catalog').then(catalog => {
      const all = store.getCountFixtures()
      const existing = new Set(all.map(fixtureIdentity))
      const seen = new Set<string>()

      if (!query.trim()) {
        const result: Candidate[] = []
        for (const name of names) {
          const local = all
            .filter(f => quantityMethod(f) === 'click' && f.name === name)
            .sort((left, right) => left.order - right.order)
          if (local.length) {
            result.push(...local.filter(f => f.id !== mainFixture.id))
            continue
          }
          for (const item of catalog.catalogItems()) {
            if (item.name !== name) continue
            const option = item.options.find(isCountOption)
            if (!option) continue
            const preset = catalog.catalogPresets(item, { options: [option.key] })[0]
            if (!preset) continue
            const identity = fixtureIdentity(preset)
            if (!existing.has(identity) && !seen.has(identity)) {
              seen.add(identity)
              result.push({
                key: JSON.stringify([item.key, option.key]),
                label: option.label,
                preset,
              })
            }
            break
          }
        }
        if (alive) setSuggested(result)
      } else {
        const result: CatalogComponentCandidate[] = []
        for (const { item, options } of catalog.searchCatalog(query, Number.MAX_SAFE_INTEGER).results) {
          for (const option of options) {
            if (!isCountOption(option)) continue
            const preset = catalog.catalogPresets(item, { options: [option.key] })[0]
            if (!preset) continue
            const identity = fixtureIdentity(preset)
            if (existing.has(identity) || seen.has(identity)) continue
            seen.add(identity)
            result.push({
              key: JSON.stringify([item.key, option.key]),
              label: option.label,
              preset,
            })
            if (result.length === 30) break
          }
          if (result.length === 30) break
        }
        if (alive) setMaster(result)
      }
    }).catch(() => {
      if (alive) setError('標準マスタを読み込めませんでした')
    })

    return () => { alive = false }
  }, [query, store, annotation.id, version])

  const add = (candidate: Candidate) => {
    hide()
    try {
      const a = store.get(annotation.id)
      const mainFixture = store.fixtureForCount(a?.count)
      if (!a?.count || a.quantity || a.legacyChange || !mainFixture) {
        setError('構成要素を追加できる個数の印がありません。')
        return
      }
      const components = a.count.version === 2 ? a.count.extra ?? [] : []
      if (components.length >= 10) {
        setError('これ以上足せません（最大 10 項目）')
        return
      }

      const all = store.getCountFixtures()
      let f: CountFixture
      let newFixtures: CountFixture[] = []
      if ('id' in candidate) {
        const existing = store.getCountFixture(candidate.id)
        if (!existing || quantityMethod(existing) !== 'click') {
          setError('構成要素の項目が見つかりません。')
          return
        }
        f = existing
      } else {
        const existing = all.find(item =>
          quantityMethod(item) === 'click'
          && fixtureIdentity(item) === fixtureIdentity(candidate.preset))
        if (existing) f = existing
        else {
          const preset = structuredClone(candidate.preset)
          f = {
            ...preset,
            conditions: [...(preset.conditions ?? [])],
            id: crypto.randomUUID(),
            order: all.reduce((order, item) => Math.max(order, item.order + 1), 0),
            style: nextCountStyle(all),
          }
          delete f.line
          newFixtures = [f]
        }
      }

      if (f.id === mainFixture.id || components.some(e => e.itemId === f.id)) {
        setError('この項目は追加済みです。')
        return
      }

      const mainCondition = a.count.version === 2 ? a.count.condition : undefined
      const condition = store.lastCondition.has(f.id)
        ? store.lastCondition.get(f.id)
        : mainCondition !== undefined && f.conditions?.includes(mainCondition)
          ? mainCondition
          : f.defaultCondition
      const next = [
        ...components,
        { itemId: f.id, count: 1, ...(condition !== undefined ? { condition } : {}) },
      ]
      const reason = store.setCountComponents([a.id], next, newFixtures)
      if (reason) { setError(reason); return }

      const saved = store.get(a.id)?.count
      if (saved?.version !== 2 || !saved.extra?.some(e => e.itemId === f.id)) {
        setError('構成要素を追加できませんでした。')
        return
      }
      store.rememberRouteFixture(f.id)
      onAdded(fixtureLabelCode(f))
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const isAdded = (candidate: Candidate) =>
    'id' in candidate && extra.some(e => e.itemId === candidate.id)
  const suggestions = query.trim() ? [] : suggested
  const candidates = [
    ...suggestions,
    ...recent,
    ...groups.flatMap(group => group.items),
    ...master,
  ].filter(candidate => !isAdded(candidate))

  useEffect(() => {
    root.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  let index = 0
  const button = (candidate: Candidate, prefix: string) => {
    const added = isAdded(candidate)
    const position = added ? -1 : index++
    const code = 'id' in candidate ? fixtureLabelCode(candidate) : candidate.label
    const name = 'id' in candidate ? candidate.name : candidate.preset.name
    return <button key={JSON.stringify([prefix, 'id' in candidate ? candidate.id : candidate.key])}
      type="button" aria-label={code + (added ? ' 追加済み' : '')}
      disabled={full || added}
      className={active >= 0 && active === position ? 'active' : ''}
      onPointerEnter={event => {
        const fixture: CountFixture = 'id' in candidate ? candidate : {
          ...candidate.preset,
          id: `catalog:${candidate.key}`,
          order: -1,
          style: nextCountStyle([]),
        }
        show(fixture, event.currentTarget.getBoundingClientRect())
      }}
      onPointerLeave={hide}
      onClick={() => add(candidate)}>
      {'id' in candidate && <QuantitySwatch fixture={candidate} />}
      <strong>{code}</strong><small title={name}>{name}</small>
      {added && <span>追加済み</span>}
    </button>
  }

  return <div ref={root} role="dialog" aria-label="構成要素を追加" className="line-picker"
    onKeyDown={event => {
      if (event.nativeEvent.isComposing) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        const direction = event.key === 'ArrowDown' ? 1 : -1
        setActive(position => candidates.length
          ? position < 0
            ? direction === 1 ? 0 : candidates.length - 1
            : (position + direction + candidates.length) % candidates.length
          : -1)
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        const candidate = candidates[Math.max(0, active)]
        if (candidate) add(candidate)
      }
    }}>
    <input ref={search} aria-label="構成要素を検索" value={query}
      onChange={event => { hide(); setQuery(event.currentTarget.value); setActive(-1) }} />
    {full && <p role="status">これ以上足せません（最大 10 項目）</p>}
    {error && <p role="alert">{error}</p>}
    <div className="line-picker-results">
      {suggestions.length > 0 && <section>
        <h4>よく組み合わせる</h4>
        {suggestions.map(candidate => button(candidate, 'suggested'))}
      </section>}
      {recent.length > 0 && <section>
        <h4>最近使った</h4>
        {recent.map(candidate => button(candidate, 'recent'))}
      </section>}
      <section>
        <h4>この PDF の項目</h4>
        {groups.map(group => <div key={group.category}>
          <h5>{group.category}</h5>
          {group.items.map(candidate => button(candidate, 'pdf'))}
        </div>)}
      </section>
      {query.trim() && <section>
        <h4>標準マスタ</h4>
        {master.map(candidate => button(candidate, 'master'))}
      </section>}
    </div>
    {hover && <FixtureHoverCard fixture={hover.fixture} fixtures={fixtures}
      anchorRect={hover.anchorRect} relations={relations} />}
  </div>
}
