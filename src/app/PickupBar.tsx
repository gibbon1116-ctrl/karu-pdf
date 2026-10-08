import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { fixtureCode, quantityKind, QUANTITY_UNITS } from '../core/countFixtures'
import { FixtureUiContext, type DocumentSession } from './documentModel'
import FixtureQuickList, { FixtureSwatch, pickupFixtureId } from './fixtureQuickList'
import { groupFixtures } from './fixtureOrder'
import LinePicker, { changeRouteCount, routeEntries, routeHighlighted, useRouteFeedback } from './LinePicker'
import { conditionSuffix } from '../core/quantity'
import { routeConditionSummary } from './routeSets'
import { QuantitySwatch } from '../editor/countMarkers'
import type { AnnotationStore, EditableAnnotation } from '../editor/AnnotationStore'
import { SymbolSearchContext } from './symbolSearchContext'

export default function PickupBar({ session }: { session: DocumentSession }) {
  const store = session.annotationStore, ui = useContext(FixtureUiContext)
  const symbolSearch = useContext(SymbolSearchContext)
  const version = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const fixtures = useMemo(() => store.getCountFixtures(), [store, version])
  const currentId = pickupFixtureId(store)
  const current = fixtures.find(f => f.id === currentId)
  const ordered = useMemo(() => groupFixtures(fixtures).flatMap(group => group.items), [fixtures])
  const selectedIndex = ordered.findIndex(f => f.id === currentId)
  const previous = selectedIndex < 0 ? undefined : ordered[selectedIndex - 1], next = selectedIndex < 0 ? undefined : ordered[selectedIndex + 1]
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<'top' | 'bottom'>(() => {
    try { return localStorage.getItem('karu-pdf:pickup-bar-position') === 'bottom' ? 'bottom' : 'top' } catch { return 'top' }
  })
  const root = useRef<HTMLDivElement>(null), chooser = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [open])
  const select = (id: string) => { store.selectFixture(id); ui?.select() }
  const index = store.quantityIndex()
  const format = (n: number) => current ? `${quantityKind(current) === 'count' ? String(n) : n.toFixed(2)} ${QUANTITY_UNITS[quantityKind(current)]}` : ''
  return <div ref={root} className={`pickup-bar-anchor pickup-bar-${position}`} onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
    onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
    <div className="pickup-bar" role="toolbar" aria-label="拾いバー">
      <button type="button" aria-label="前の項目" title="前の項目（[）" disabled={!previous} onClick={() => previous && select(previous.id)}>◀</button>
      <button ref={chooser} type="button" className="pickup-bar-current" aria-label="今の項目を選ぶ" aria-expanded={open} aria-haspopup="dialog"
        title={current ? `${fixtureCode(current)} ${current.name}` : undefined} onClick={() => setOpen(value => !value)}>
        {current ? <><FixtureSwatch fixture={current} /><span><strong>{fixtureCode(current)}</strong> {current.name}</span></> : store.selectedPickupsOnly() ? `${store.selectedIds().length}件を選択中` : '項目を選んでください'}
      </button>
      <button type="button" aria-label="次の項目" title="次の項目（]）" disabled={!next} onClick={() => next && select(next.id)}>▶</button>
      {current && <span className="pickup-bar-totals" aria-live="polite"><span title={`この図面 ${format(index.byPage(current.id).get(session.view.page - 1) ?? 0)}`}>この図面 <strong>{format(index.byPage(current.id).get(session.view.page - 1) ?? 0)}</strong></span><span title={`全図面 ${format(index.total(current.id))}`}>全図面 <strong>{format(index.total(current.id))}</strong></span></span>}
      {current && quantityKind(current) === 'count' && symbolSearch && <button type="button" aria-label="同じ記号を探す" onClick={() => symbolSearch.start(session, current.id)}>同じ記号を探す</button>}
      <button type="button" aria-label="元に戻す" title="元に戻す（Ctrl+Z）" disabled={!store.canUndo()} onClick={event => {
        // Reuse App's Ctrl+Z path, including selection clearing and tab refresh.
        event.currentTarget.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }))
      }}>↶</button>
      <button type="button" aria-label={position === 'top' ? '拾いバーを下に移す' : '拾いバーを上に移す'} onClick={() => {
        const nextPosition = position === 'top' ? 'bottom' : 'top'; setPosition(nextPosition)
        try { localStorage.setItem('karu-pdf:pickup-bar-position', nextPosition) } catch { /* Optional preference storage. */ }
      }}>{position === 'top' ? '↓' : '↑'}</button>
    </div>
    {current && store.lastRouteConditions.has(current.id) && <div className="pickup-template" title={'直前の条件: ' + (conditionSuffix(store.lastRouteConditions.get(current.id)).slice(1, -1) || '未設定')}>直前の条件: {routeConditionSummary(store.lastRouteConditions.get(current.id)).slice(1, -1) || '未設定'}<button type="button" aria-label="直前の条件の引継ぎをやめる" onClick={() => store.clearRouteInheritance(current.id)}>×</button></div>}
    {store.routeTemplate && <div className="pickup-template">構成: {store.routeTemplate.name}<button type="button" aria-label="構成を外す" onClick={() => store.setRouteTemplate(null)}>×</button></div>}
    {store.selectedIds().length === 1 && store.get(store.selectedIds()[0])?.quantity?.method === 'polyline' && <PickupRoute key={store.selectedIds()[0]} store={store} annotation={store.get(store.selectedIds()[0])!} />}
    {open && <FixtureQuickList fixtures={fixtures} recentIds={store.recentFixtureIds} onSelect={select} onClose={() => setOpen(false)} onDismiss={() => { setOpen(false); chooser.current?.focus() }} />}
  </div>
}

function PickupRoute({ store, annotation: a }: { store: AnnotationStore; annotation: EditableAnnotation }) {
  const entries = routeEntries(a), feedback = useRouteFeedback(store)
  const [open, setOpen] = useState(false), [visible, setVisible] = useState(entries.length)
  const close = useCallback(() => setOpen(false), [])
  const root = useRef<HTMLDivElement>(null), measure = useRef<HTMLDivElement>(null), summary = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const fit = () => {
      if (!root.current || !measure.current || !summary.current) return
      const widths = Array.from(measure.current.children).map(e => e.getBoundingClientRect().width + 4)
      // Measure against the bar's own maximum (70% of the drawing area), not the first row's
      // current width, or the second row could never grow past the first row.
      const region = root.current.closest<HTMLElement>('.pickup-bar-region')
      const maxWidth = region ? Math.min(region.clientWidth * .7, region.clientWidth - 16) : root.current.clientWidth
      const available = maxWidth - summary.current.getBoundingClientRect().width - 40
      const total = widths.reduce((n, w) => n + w, 0)
      let count = widths.length, used = 0
      if (total > available) { count = 0; for (const width of widths) { if (used + width > available - 52) break; used += width; count++ } }
      setVisible(count)
    }
    fit(); const observer = new ResizeObserver(fit); if (root.current) observer.observe(root.current)
    return () => observer.disconnect()
  }, [a, entries.length])
  const chip = (e: typeof entries[number], measuring = false) => {
    const f = store.getCountFixture(e.itemId), code = f ? fixtureCode(f) : e.itemId
    const added = routeHighlighted(feedback, a.id, e.itemId)
    return <span key={e.itemId} className={`pickup-route-chip${added ? ' route-item-added' : ''}`} title={code + conditionSuffix(e.cond)}>
      {f && <QuantitySwatch fixture={f} />}<strong>{code}</strong><span>×{e.count}{conditionSuffix(e.cond)}</span>
      <button type="button" tabIndex={measuring ? -1 : undefined} aria-label={'拾いバーの' + code + 'の条数を減らす'} disabled={e.count <= 1} onClick={() => changeRouteCount(store, a, e.itemId, e.count - 1)}>−</button>
      <button type="button" tabIndex={measuring ? -1 : undefined} aria-label={'拾いバーの' + code + 'の条数を増やす'} disabled={e.count >= 99} onClick={() => changeRouteCount(store, a, e.itemId, e.count + 1)}>+</button>
    </span>
  }
  return <div className="pickup-route" ref={root}>
    <div className="pickup-route-row"><span ref={summary}>{entries.length}種類・{entries.reduce((n, e) => n + e.count, 0)}条</span>
      {entries.slice(0, visible).map(e => chip(e))}{visible < entries.length && <span className="pickup-route-more" title={entries.slice(visible).map(e => { const f = store.getCountFixture(e.itemId); return (f ? fixtureCode(f) : e.itemId) + '×' + e.count + conditionSuffix(e.cond) }).join('、')}>ほか {entries.length - visible}</span>}
      <button type="button" aria-label="拾いバーで線要素を追加" aria-expanded={open} onClick={() => setOpen(v => !v)}>＋</button>
    </div>
    <div ref={measure} className="pickup-route-measure" aria-hidden="true">{entries.map(e => chip(e, true))}</div>
    {open && <LinePicker store={store} annotation={a} onClose={close} />}
    <span className="visually-hidden" aria-live="polite">{feedback.routeId === a.id ? feedback.message : ''}</span>
  </div>
}
