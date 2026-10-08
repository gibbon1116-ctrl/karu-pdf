import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { fixtureCode, quantityAggregation, quantityKind, QUANTITY_UNITS, type CountFixture } from '../core/countFixtures'
import type { DrawingInfo } from '../core/drawingInfo'
import type { Rect } from '../core/annotations'
import { compareFloors, type QuantityEntry, type QuantityIndex } from '../core/quantityIndex'
import type { DocumentSession } from './documentModel'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import { nextReview, refreshReview, reviewOrder, type ReviewCursor } from './reviewCursor'

export const QuantityNavigationContext = createContext<{
  navigate(pageIndex: number, rect?: Rect): void
  drawingInfo(pageIndex: number): DrawingInfo | null
} | null>(null)

// UI requests only; none of these are document data.
export const QuantityTableContext = createContext<{
  open(): void
  showBreakdown(id: string): void
  showCsv(): void
  bindPanel(actions: { breakdown(id: string): void; csv(): void }): () => void
} | null>(null)

export async function revealPickup(session: DocumentSession, pool: PdfWorkerPool, itemId: string,
  annotationId: string, pageIndex: number, navigate: (page: number, rect?: Rect) => void,
  current: () => boolean = () => true): Promise<boolean> {
  const revision = session.pageRevision, store = session.annotationStore
  await store.ensurePageLoaded(pageIndex, () => pool.listAnnotations(session.docId, pageIndex))
  if (!current() || revision !== session.pageRevision) return false
  const mark = store.get(annotationId)
  if (!mark || mark.pageIndex !== pageIndex) return false
  store.selectFixture(itemId); store.setFixtureVisible([itemId], true)
  store.selectOnly(mark.id)
  navigate(pageIndex, mark.rect)
  store.flashPickup(mark.id)
  return true
}

export default function QuantityBreakdown({ fixture, index, session, pool, onClose }: {
  fixture: CountFixture; index: QuantityIndex; session: DocumentSession; pool: PdfWorkerPool; onClose(): void
}) {
  const navigation = useContext(QuantityNavigationContext)
  const [mode, setMode] = useState<'page' | 'location'>(quantityAggregation(fixture) === 'location' ? 'location' : 'page')
  const [location, setLocation] = useState<{ floor: string; room?: string } | null>(null)
  const [cursor, setCursor] = useState<(ReviewCursor & { page: number }) | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const close = useRef<HTMLButtonElement>(null), alive = useRef(true)
  useEffect(() => {
    alive.current = true; close.current?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || document.querySelector('dialog[open], [role="dialog"], [role="menu"]')) return
      e.preventDefault(); e.stopImmediatePropagation(); onClose()
    }
    window.addEventListener('keydown', key, true)
    return () => { alive.current = false; window.removeEventListener('keydown', key, true) }
  }, [onClose])
  const entries = useMemo(() => index.entries(fixture.id), [index, fixture.id])
  const filtered = useMemo(() => location ? entries.filter(e => (e.floor ?? '') === location.floor && (location.room === undefined || (e.room ?? '') === location.room)) : entries, [entries, location])
  const pages = useMemo(() => {
    const result = new Map<number, QuantityEntry[]>()
    for (const e of filtered) { const list = result.get(e.pageIndex) ?? []; list.push(e); result.set(e.pageIndex, list) }
    return [...result].sort((a, b) => a[0] - b[0])
  }, [filtered])
  useEffect(() => {
    setCursor(previous => {
      if (!previous) return previous
      const list = pages.find(([page]) => page === previous.page)?.[1] ?? []
      return { ...refreshReview(reviewOrder(list, id => session.annotationStore.get(id)), previous), page: previous.page }
    })
  }, [pages, session])
  const floors = useMemo(() => [...index.byFloorRoom(fixture.id)].sort((a, b) => compareFloors(a[0], b[0])), [index, fixture.id])
  const format = (n: number) => `${quantityKind(fixture) === 'count' ? n : n.toFixed(2)} ${QUANTITY_UNITS[quantityKind(fixture)]}`
  const go = async (pageIndex: number, list: readonly QuantityEntry[]) => {
    setBusy(true); setError('')
    try {
      const revision = session.pageRevision
      await session.annotationStore.ensurePageLoaded(pageIndex, () => pool.listAnnotations(session.docId, pageIndex))
      if (!alive.current || revision !== session.pageRevision) return
      const store = session.annotationStore
      const next = nextReview(reviewOrder(list, id => store.get(id)), cursor?.page === pageIndex ? cursor : null)
      if (!next) return
      const mark = store.get(next.id)
      if (mark && await revealPickup(session, pool, fixture.id, mark.id, pageIndex,
        (page, rect) => navigation?.navigate(page, rect), () => alive.current)) setCursor({ ...next, page: pageIndex })
    } catch (e) { if (alive.current) setError(String(e)) }
    finally { if (alive.current) setBusy(false) }
  }
  const filterLocation = (floor: string, room?: string) => { setLocation({ floor, ...(room === undefined ? {} : { room }) }); setMode('page'); setCursor(null) }
  return <section className="quantity-breakdown" aria-label={`${fixtureCode(fixture)} ${fixture.name}の内訳`} data-testid="quantity-breakdown">
    <div className="quantity-breakdown-heading"><strong>{fixtureCode(fixture)} {fixture.name}</strong><button ref={close} onClick={onClose}>閉じる</button></div>
    <p>全図面 {format(index.total(fixture.id))}</p>
    <div className="quantity-breakdown-tabs">
      <button aria-pressed={mode === 'page'} onClick={() => { setMode('page'); setLocation(null); setCursor(null) }}>ページ別</button>
      <button aria-pressed={mode === 'location'} onClick={() => { setMode('location'); setLocation(null); setCursor(null) }}>階・部屋別</button>
    </div>
    {mode === 'page' ? <>
      {location && <p>{location.floor || '（階なし）'}{location.room !== undefined && ` ／ ${location.room || '（部屋なし）'}`}<button onClick={() => { setLocation(null); setCursor(null) }}>絞り込みを解除</button></p>}
      <div className="quantity-breakdown-list">{pages.map(([page, list]) => {
        const info = session.annotationStore.getDrawingInfo(page)
        return <button key={page} className="quantity-breakdown-page" disabled={busy} data-page-index={page} onClick={() => void go(page, list)}>
          <span>{info?.number || `p.${page + 1}`}</span><span>{info?.number ? info.name ?? '' : ''}</span>
          <span>{format(list.reduce((n, e) => n + e.value, 0))}</span><small>{cursor?.page === page ? `${cursor.position} / ${cursor.count}` : ''}</small>
        </button>
      })}</div>
      <p className="quantity-breakdown-total">合計 {format(filtered.reduce((n, e) => n + e.value, 0))}</p>
    </> : <div className="quantity-breakdown-list">{floors.map(([floor, rooms]) => <div key={floor}>
      <button className="quantity-breakdown-floor" onClick={() => filterLocation(floor)}>{floor || '（階なし）'} {format([...rooms.values()].reduce((a, b) => a + b, 0))}</button>
      {[...rooms].sort((a, b) => a[0].localeCompare(b[0], 'ja')).map(([room, value]) => <button className="quantity-breakdown-room" key={room} onClick={() => filterLocation(floor, room)}>{room || '（部屋なし）'} {format(value)}</button>)}
    </div>)}</div>}
    {error && <p role="alert">{error}</p>}
  </section>
}
