import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { fixtureCode, quantityKind, QUANTITY_UNITS, type CountFixture, type QuantityKind } from '../core/countFixtures'
import { compareFloors, type QuantityIndex } from '../core/quantityIndex'
import type { DrawingInfo } from '../core/drawingInfo'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import { CountMarker, QuantitySwatch } from '../editor/countMarkers'
import { FixtureUiContext, type DocumentSession } from './documentModel'
import { groupFixtures } from './fixtureOrder'
import { QuantityNavigationContext, QuantityTableContext, revealPickup } from './QuantityBreakdown'
import { nextReview, refreshReview, reviewOrder, type ReviewCursor } from './reviewCursor'

export type QuantityTableMode = 'page' | 'floor' | 'room'
export interface QuantityTableFilters { category?: string; kind?: QuantityKind | ''; search?: string }
export interface QuantityTableColumn { key: string; pageIndex?: number; floor?: string; room?: string; heading: string; subheading: string }
interface TableItem { fixture: CountFixture; total: number; values: Record<QuantityTableMode, Map<string, number>> }
export type QuantityTableRow = { category: string; item?: TableItem }
const pageKey = (page: number) => String(page)
const roomKey = (floor: string, room: string) => JSON.stringify([floor, room])

function columnEntries(index: QuantityIndex, itemId: string, mode: QuantityTableMode, key: string) {
  const [floor, room] = mode === 'room' ? JSON.parse(key) as string[] : [key, '']
  return index.entries(itemId).filter(e => mode === 'page' ? e.pageIndex === Number(key)
    : (e.floor ?? '') === floor && (mode === 'floor' || (e.room ?? '') === room))
}

/** Read index entries, never annotations. Build all three modes once per index. */
export function buildQuantityTableData(index: QuantityIndex, fixtures: readonly CountFixture[]): TableItem[] {
  return groupFixtures(fixtures).flatMap(group => group.items.map(fixture => {
    const values = { page: new Map<string, number>(), floor: new Map<string, number>(), room: new Map<string, number>() }
    for (const [page, value] of index.byPage(fixture.id)) values.page.set(pageKey(page), value)
    for (const entry of index.entries(fixture.id)) {
      const floor = entry.floor ?? '', room = roomKey(floor, entry.room ?? '')
      values.floor.set(floor, (values.floor.get(floor) ?? 0) + entry.value)
      values.room.set(room, (values.room.get(room) ?? 0) + entry.value)
    }
    return { fixture, total: index.total(fixture.id), values }
  }))
}

/** Filtering is a projection of cached aggregates; no entries are revisited. */
export function projectQuantityTable(data: readonly TableItem[], mode: QuantityTableMode, filters: QuantityTableFilters,
  drawingInfo: (page: number) => DrawingInfo | null) {
  const search = (filters.search ?? '').trim().toLocaleLowerCase()
  const items = data.filter(({ fixture: f }) => (!filters.category || f.category === filters.category)
    && (!filters.kind || quantityKind(f) === filters.kind)
    && (!search || `${fixtureCode(f)} ${f.name}`.toLocaleLowerCase().includes(search)))
  const keys = new Set<string>()
  for (const item of items) for (const key of item.values[mode].keys()) keys.add(key)
  const floorOrder = (a: string, b: string) => a === '' ? (b === '' ? 0 : 1) : b === '' ? -1 : compareFloors(a, b)
  const ordered = [...keys].sort((a, b) => {
    if (mode === 'page') return Number(a) - Number(b)
    if (mode === 'floor') return floorOrder(a, b)
    const [af, ar] = JSON.parse(a) as string[], [bf, br] = JSON.parse(b) as string[]
    return floorOrder(af, bf) || ar.localeCompare(br, 'ja', { numeric: true })
  })
  const columns: QuantityTableColumn[] = ordered.slice(0, 80).map(key => {
    if (mode === 'page') {
      const pageIndex = Number(key), info = drawingInfo(pageIndex)
      return { key, pageIndex, heading: info?.number || `p.${pageIndex + 1}`, subheading: info?.name ?? '' }
    }
    if (mode === 'floor') return { key, floor: key, heading: key || '（階なし）', subheading: '' }
    const [floor, room] = JSON.parse(key) as string[]
    return { key, floor, room, heading: floor || '（階なし）', subheading: room || '（部屋なし）' }
  })
  const rows: QuantityTableRow[] = []
  let category: string | undefined
  for (const item of items) {
    if (item.fixture.category !== category) { category = item.fixture.category; rows.push({ category }) }
    rows.push({ category, item })
  }
  return { rows, columns, omittedColumns: ordered.length - columns.length }
}

export function buildQuantityTable(index: QuantityIndex, fixtures: readonly CountFixture[], mode: QuantityTableMode,
  filters: QuantityTableFilters, drawingInfo: (page: number) => DrawingInfo | null) {
  return projectQuantityTable(buildQuantityTableData(index, fixtures), mode, filters, drawingInfo)
}

const ROW_HEIGHT = 32, HEADER_HEIGHT = 56, OVERSCAN = 4
const HEIGHT_KEY = 'karu-pdf:quantity-table-height'

export default function QuantityTable({ session, pool, height, onHeightChange, onClose }: {
  session: DocumentSession; pool: PdfWorkerPool; height: number; onHeightChange(n: number): void; onClose(): void
}) {
  const store = session.annotationStore, navigation = useContext(QuantityNavigationContext)
  const controls = useContext(QuantityTableContext), fixtureUi = useContext(FixtureUiContext)
  // This component is mounted only while open.
  useSyncExternalStore(store.subscribe, store.getSnapshot)
  const index = store.quantityIndex()
  const data = useMemo(() => buildQuantityTableData(index, store.getCountFixtures()), [index, store])
  const [mode, setMode] = useState<QuantityTableMode>('page')
  const [filters, setFilters] = useState<QuantityTableFilters>({})
  // Metadata edits do not invalidate the quantity index. Selection and flashes
  // must not recreate the table: compare only the page headings.
  const pages = useMemo(() => [...new Set(data.flatMap(item => [...item.values.page.keys()].map(Number)))], [data])
  const headings = pages.map(page => { const info = store.getDrawingInfo(page); return [page, info?.number ?? '', info?.name ?? ''] as const })
  const headingKey = JSON.stringify(headings)
  const info = useMemo(() => new Map(headings.map(([page, number, name]) => [page, { number, name } as DrawingInfo])), [headingKey])
  const table = useMemo(() => projectQuantityTable(data, mode, filters, page => info.get(page) ?? null), [data, mode, filters, info])
  const categories = useMemo(() => [...new Set(data.map(item => item.fixture.category))], [data])
  const [viewport, setViewport] = useState({ top: 0, height: 0 })
  const scrollRef = useRef<HTMLDivElement>(null), closeRef = useRef<HTMLButtonElement>(null)
  const alive = useRef(true), busyRef = useRef(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [cursors, setCursors] = useState<Record<string, ReviewCursor>>({})
  useEffect(() => {
    alive.current = true; closeRef.current?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || document.querySelector('dialog[open], [role="dialog"], [role="menu"]')) return
      e.preventDefault(); e.stopImmediatePropagation(); onClose()
    }
    window.addEventListener('keydown', key, true)
    return () => { alive.current = false; window.removeEventListener('keydown', key, true) }
  }, [onClose])
  useEffect(() => {
    const scroll = scrollRef.current!
    const measure = () => setViewport({ top: scroll.scrollTop, height: scroll.clientHeight })
    const observer = new ResizeObserver(measure); observer.observe(scroll); measure()
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    setViewport(v => ({ ...v, top: 0 })); setCursors({})
  }, [mode, filters])
  useEffect(() => {
    setCursors(previous => {
      const keys = Object.keys(previous)
      if (!keys.length) return previous
      const refreshed: Record<string, ReviewCursor> = {}
      for (const key of keys) {
        const [cursorMode, itemId, columnKey] = JSON.parse(key) as [QuantityTableMode, string, string]
        if (cursorMode !== mode || !table.columns.some(c => c.key === columnKey)) continue
        const entries = columnEntries(index, itemId, mode, columnKey)
        if (!entries.length || entries.reduce((n, e) => n + e.value, 0) === 0) continue
        refreshed[key] = refreshReview(reviewOrder(entries, id => store.get(id)), previous[key])
      }
      return refreshed
    })
  }, [index, table, mode, store])
  const resize = (n: number) => {
    const clamped = Math.max(20, Math.min(70, n)); onHeightChange(clamped)
    try { localStorage.setItem(HEIGHT_KEY, String(clamped)) } catch { /* Optional UI preference. */ }
  }
  const go = async (item: TableItem, column: QuantityTableColumn) => {
    if (busyRef.current || !navigation) return
    busyRef.current = true; setBusy(true); setError('')
    const revision = session.pageRevision
    try {
      const entries = columnEntries(index, item.fixture.id, mode, column.key)
      for (const page of new Set(entries.map(e => e.pageIndex))) {
        await store.ensurePageLoaded(page, () => pool.listAnnotations(session.docId, page))
        if (!alive.current || revision !== session.pageRevision) return
      }
      const key = JSON.stringify([mode, item.fixture.id, column.key])
      const next = nextReview(reviewOrder(entries, id => store.get(id)), cursors[key] ?? null)
      if (!next) return
      const mark = store.get(next.id)
      if (mark && await revealPickup(session, pool, item.fixture.id, mark.id, mark.pageIndex, navigation.navigate,
        () => alive.current && revision === session.pageRevision)) {
        setCursors(previous => ({ ...previous, [key]: next }))
      }
    } catch (e) { if (alive.current) setError(String(e)) }
    finally { busyRef.current = false; if (alive.current) setBusy(false) }
  }
  const first = Math.min(Math.max(0, table.rows.length - 1), Math.max(0, Math.floor(Math.max(0, viewport.top - HEADER_HEIGHT) / ROW_HEIGHT) - OVERSCAN))
  const end = Math.min(table.rows.length, first + Math.ceil(viewport.height / ROW_HEIGHT) + OVERSCAN * 2 + 1)
  const format = (f: CountFixture, n: number) => quantityKind(f) === 'count' ? String(Math.round(n)) : n.toFixed(2)
  return <section className="quantity-table" role="region" aria-label="数量の集計表">
    <div className="quantity-table-resizer" role="separator" aria-label="集計表の高さ" aria-orientation="horizontal"
      aria-valuemin={20} aria-valuemax={70} aria-valuenow={Math.round(height)} tabIndex={0}
      onKeyDown={e => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return
        e.preventDefault(); resize(e.key === 'Home' ? 20 : e.key === 'End' ? 70 : height + (e.key === 'ArrowUp' ? 5 : -5))
      }}
      onPointerDown={e => { if (e.button === 0) { e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault() } }}
      onPointerMove={e => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
        const bounds = e.currentTarget.closest('.quantity-viewer-stack')!.getBoundingClientRect()
        if (bounds.height) resize((bounds.bottom - e.clientY) / bounds.height * 100)
      }} onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId) }} />
    <div className="quantity-table-toolbar">
      <strong>集計表</strong>
      {(['page', 'floor', 'room'] as const).map((value, i) => <button key={value} aria-pressed={mode === value}
        onClick={() => setMode(value)}>{['図面別', '階別', '階・部屋別'][i]}</button>)}
      <select aria-label="集計表の分類" value={filters.category ?? ''} onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}>
        <option value="">すべて</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <select aria-label="集計表の種別" value={filters.kind ?? ''} onChange={e => setFilters(f => ({ ...f, kind: e.target.value as QuantityKind | '' }))}>
        <option value="">すべて</option>{(['count', 'length', 'area', 'volume'] as const).map((kind, i) => <option key={kind} value={kind}>{['個数', '長さ', '面積', '体積'][i]}</option>)}
      </select>
      <input type="search" aria-label="集計表の名称・略号を検索" placeholder="名称・略号を検索" value={filters.search ?? ''} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} />
      <button onClick={() => { fixtureUi?.open(); controls?.showCsv() }}>CSVに書き出す</button>
      <button ref={closeRef} onClick={onClose} aria-label="集計表を閉じる">閉じる</button>
    </div>
    {table.omittedColumns > 0 && <p className="quantity-table-notice" role="status">ほか {table.omittedColumns} 列。分類・種別・検索で絞り込むか、CSV で確かめてください</p>}
    {error && <p role="alert">{error}</p>}
    <div className="quantity-table-scroll" ref={scrollRef} onScroll={e => setViewport({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}>
      <table aria-label="数量の集計" aria-rowcount={table.rows.length + 1} style={{ width: 434 + table.columns.length * 140 }}>
        <colgroup>{[44, 100, 150, 50, 90].map((width, i) => <col key={i} style={{ width }} />)}{table.columns.map(c => <col key={c.key} style={{ width: 140 }} />)}</colgroup>
        <thead><tr aria-rowindex={1}>{['見本', '略号', '名称', '単位', '全図面'].map((label, i) => <th key={label} scope="col" className={`quantity-table-fixed quantity-table-fixed-${i}`}>{label}</th>)}
          {table.columns.map(c => <th key={c.key} scope="col" data-column-key={c.key}><span title={c.heading}>{c.heading}</span><small title={c.subheading}>{c.subheading}</small></th>)}
        </tr></thead>
        <tbody>
          {first > 0 && <tr className="quantity-table-spacer" aria-hidden="true"><td colSpan={5 + table.columns.length} style={{ height: first * ROW_HEIGHT }} /></tr>}
          {table.rows.slice(first, end).map((row, offset) => {
            const item = row.item
            if (!item) return <tr key={`category:${row.category}`} className="quantity-table-category" aria-rowindex={first + offset + 2}>
              <th colSpan={5} className="quantity-table-fixed" scope="rowgroup">{row.category}</th>{table.columns.length > 0 && <td colSpan={table.columns.length} />}
            </tr>
            const f = item.fixture
            return <tr key={f.id} data-fixture-id={f.id} aria-rowindex={first + offset + 2}>
              <td className="quantity-table-fixed quantity-table-fixed-0">{quantityKind(f) === 'count' ? f.sample
                ? <img src={`data:image/png;base64,${f.sample.png}`} alt={`${f.name}の見本`} />
                : <svg viewBox="-14 -14 28 28" aria-hidden="true"><CountMarker style={{ ...f.style, size: 24, opacity: 1 }} showCode={false} /></svg>
                : <QuantitySwatch fixture={f} />}</td>
              <th scope="row" title={fixtureCode(f)} className="quantity-table-fixed quantity-table-fixed-1">{fixtureCode(f)}</th>
              <td title={f.name} className="quantity-table-fixed quantity-table-fixed-2">{f.name}</td>
              <td className="quantity-table-fixed quantity-table-fixed-3">{QUANTITY_UNITS[quantityKind(f)]}</td>
              <td className="quantity-table-fixed quantity-table-fixed-4"><button disabled={item.total === 0} aria-label={`${fixtureCode(f)} ${f.name}の全図面の内訳`}
                onClick={() => { fixtureUi?.open(); controls?.showBreakdown(f.id) }}>{item.total === 0 ? '' : format(f, item.total)}</button></td>
              {table.columns.map(c => {
                const value = item.values[mode].get(c.key) ?? 0, key = JSON.stringify([mode, f.id, c.key])
                return <td key={c.key}><button disabled={value === 0 || busy} data-column-key={c.key}
                  aria-label={`${fixtureCode(f)} ${f.name} ${c.heading}${c.subheading ? `／${c.subheading}` : ''} ${format(f, value)}`}
                  onClick={() => void go(item, c)}>{value === 0 ? '' : format(f, value)}
                  {cursors[key] && <small className="quantity-table-cursor">{cursors[key].position} / {cursors[key].count}</small>}
                </button></td>
              })}
            </tr>
          })}
          {end < table.rows.length && <tr className="quantity-table-spacer" aria-hidden="true"><td colSpan={5 + table.columns.length} style={{ height: (table.rows.length - end) * ROW_HEIGHT }} /></tr>}
        </tbody>
      </table>
      {table.rows.length === 0 && <p>該当する項目はありません</p>}
    </div>
  </section>
}
