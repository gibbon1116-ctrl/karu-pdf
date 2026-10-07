import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { fixtureCode, quantityKind, QUANTITY_UNITS } from '../core/countFixtures'
import { FixtureUiContext, type DocumentSession } from './documentModel'
import FixtureQuickList, { FixtureSwatch, pickupFixtureId } from './fixtureQuickList'
import { groupFixtures } from './fixtureOrder'

export default function PickupBar({ session }: { session: DocumentSession }) {
  const store = session.annotationStore, ui = useContext(FixtureUiContext)
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
      <button type="button" aria-label="元に戻す" title="元に戻す（Ctrl+Z）" disabled={!store.canUndo()} onClick={event => {
        // Reuse App's Ctrl+Z path, including selection clearing and tab refresh.
        event.currentTarget.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }))
      }}>↶</button>
      <button type="button" aria-label={position === 'top' ? '拾いバーを下に移す' : '拾いバーを上に移す'} onClick={() => {
        const nextPosition = position === 'top' ? 'bottom' : 'top'; setPosition(nextPosition)
        try { localStorage.setItem('karu-pdf:pickup-bar-position', nextPosition) } catch { /* Optional preference storage. */ }
      }}>{position === 'top' ? '↓' : '↑'}</button>
    </div>
    {open && <FixtureQuickList fixtures={fixtures} recentIds={store.recentFixtureIds} onSelect={select} onClose={() => setOpen(false)} onDismiss={() => { setOpen(false); chooser.current?.focus() }} />}
  </div>
}
