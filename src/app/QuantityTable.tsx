import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { fixtureCode, quantityKind, QUANTITY_UNITS, type CountFixture, type QuantityKind } from '../core/countFixtures'
import { compareFloors, quantityPartSummary, type QuantityEntry, type QuantityIndex } from '../core/quantityIndex'
import type { DrawingInfo } from '../core/drawingInfo'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import { CountMarker, QuantitySwatch } from '../editor/countMarkers'
import { FixtureUiContext, type DocumentSession } from './documentModel'
import { groupFixtures } from './fixtureOrder'
import { QuantityNavigationContext, QuantityTableContext, revealPickup } from './QuantityBreakdown'
import { nextReview, refreshReview, reviewOrder, type ReviewCursor } from './reviewCursor'

export type QuantityTableMode = 'page' | 'floor' | 'room'
export interface QuantityTableFilters { category?: string; kind?: QuantityKind | ''; search?: string; unsetOnly?: boolean }
export interface QuantityTableColumn { key: string; pageIndex?: number; floor?: string; room?: string; heading: string; subheading: string }
interface TableAggregate {
  total: number; plan: number; rise: number; slack: number
  values: Record<QuantityTableMode, Map<string, number>>
  entries: readonly QuantityEntry[]
  reviewEntries: Record<QuantityTableMode, Map<string, QuantityEntry[]>>
}
interface TableItem extends TableAggregate { fixture: CountFixture; byCondition: Map<string, TableAggregate>; hasUnset: boolean }
export type QuantityTableRow = { category: string; item?: TableItem; conditionKey?: string }
export interface QuantityTableDisplay { allConditions?: boolean; expanded?: Readonly<Record<string, boolean>> }
const pageKey = (page: number) => String(page)
const roomKey = (floor: string, room: string) => JSON.stringify([floor, room])

export function columnEntries(item: TableItem, mode: QuantityTableMode, key: string | null, condition?: string) {
  const aggregate = condition === undefined ? item : item.byCondition.get(condition)
  const entries = aggregate?.entries ?? []
  if (key === null) return entries
  if (mode === 'page') return entries.filter(entry => pageKey(entry.pageIndex) === key)
  if (mode === 'floor') return entries.filter(entry => (entry.floor ?? '') === key)
  const [floor, room] = JSON.parse(key) as [string, string]
  return entries.filter(entry => (entry.floor ?? '') === floor && (entry.room ?? '') === room)
}
class Aggregate implements TableAggregate {
  total = 0; plan = 0; rise = 0; slack = 0
  entries: readonly QuantityEntry[] = []
  values: TableAggregate['values'] = { page: new Map(), floor: new Map(), room: new Map() }
  // Share the lazy accessor on the prototype instead of allocating one per item.
  // Compatibility for existing consumers; the UI uses columnEntries directly.
  get reviewEntries(): TableAggregate['reviewEntries'] {
    const result: TableAggregate['reviewEntries'] = { page: new Map(), floor: new Map(), room: new Map() }
    for (const entry of this.entries) {
      const keys = { page: pageKey(entry.pageIndex), floor: entry.floor ?? '', room: roomKey(entry.floor ?? '', entry.room ?? '') }
      for (const mode of ['page', 'floor', 'room'] as const) {
        const key = keys[mode], list = result[mode].get(key)
        if (list) list.push(entry); else result[mode].set(key, [entry])
      }
    }
    Object.defineProperty(this, 'reviewEntries', { value: result, enumerable: true, configurable: true })
    return result
  }
}
function emptyAggregate(): TableAggregate {
  return new Aggregate()
}

function addEntry(aggregate: TableAggregate, entry: QuantityEntry, page: string, floor: string, room: string) {
  aggregate.total += entry.value
  if (entry.part) aggregate[entry.part] += entry.value
  const values = aggregate.values
  values.page.set(page, (values.page.get(page) ?? 0) + entry.value)
  values.floor.set(floor, (values.floor.get(floor) ?? 0) + entry.value)
  values.room.set(room, (values.room.get(room) ?? 0) + entry.value)
}

/** Read index entries, never annotations. Build all three modes once per index. */
export function buildQuantityTableData(index: QuantityIndex, fixtures: readonly CountFixture[]): TableItem[] {
  const roomKeys = new Map<string, Map<string, string>>()
  return groupFixtures(fixtures).flatMap(group => group.items.map(fixture => {
    const item: TableItem = Object.assign(emptyAggregate(), { fixture, byCondition: new Map<string, TableAggregate>(), hasUnset: false })
    const entries = index.entries(fixture.id)
    item.entries = entries
    let entryIndex = 0
    for (const entry of entries) {
      const conditionKey = entry.condition ?? ''
      let condition = item.byCondition.get(conditionKey)
      if (!condition) {
        if (item.byCondition.size === 0) condition = item
        else {
          if (item.byCondition.size === 1) {
            // Share the item until a second condition appears, then detach only
            // the prefix already accumulated for the first condition.
            const firstKey = item.byCondition.keys().next().value!
            const first = Object.assign(emptyAggregate(), {
              total: item.total, plan: item.plan, rise: item.rise, slack: item.slack,
              entries: entries.slice(0, entryIndex),
              values: { page: new Map(item.values.page), floor: new Map(item.values.floor), room: new Map(item.values.room) },
            })
            item.byCondition.set(firstKey, first)
          }
          condition = emptyAggregate()
        }
        item.byCondition.set(conditionKey, condition)
      }
      if (entry.condition === undefined && fixture.conditions?.length) item.hasUnset = true
      const page = pageKey(entry.pageIndex), floor = entry.floor ?? '', room = entry.room ?? ''
      let keys = roomKeys.get(floor)
      if (!keys) { keys = new Map(); roomKeys.set(floor, keys) }
      let key = keys.get(room)
      if (key === undefined) { key = roomKey(floor, room); keys.set(room, key) }
      addEntry(item, entry, page, floor, key)
      if (condition !== item) {
        ;(condition.entries as QuantityEntry[]).push(entry)
        addEntry(condition, entry, page, floor, key)
      }
      entryIndex++
    }
    // Retain occupied zero-quantity pages of fully excluded routes.
    item.values.page = new Map([...index.byPage(fixture.id)].map(([page, value]) => [pageKey(page), value]))
    item.total = index.total(fixture.id)
    return item
  }))
}

/** Filtering is a projection of cached aggregates; no entries are revisited. */
export function projectQuantityTable(data: readonly TableItem[], mode: QuantityTableMode, filters: QuantityTableFilters,
  drawingInfo: (page: number) => DrawingInfo | null, display: QuantityTableDisplay = {}) {
  const search = (filters.search ?? '').trim().toLocaleLowerCase()
  const items = data.filter(({ fixture: f, hasUnset }) => (!filters.unsetOnly || hasUnset) && (!filters.category || f.category === filters.category)
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
    if (filters.unsetOnly || (item.byCondition.size >= 2 && (display.expanded?.[item.fixture.id] ?? display.allConditions))) {
      for (const conditionKey of item.byCondition.keys()) {
        if (!filters.unsetOnly || conditionKey === '') rows.push({ category, item, conditionKey })
      }
    }
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
  const [allConditions, setAllConditions] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  // Metadata edits do not invalidate the quantity index. Selection and flashes
  // must not recreate the table: compare only the page headings.
  const pages = useMemo(() => [...new Set(data.flatMap(item => [...item.values.page.keys()].map(Number)))], [data])
  const headings = pages.map(page => { const info = store.getDrawingInfo(page); return [page, info?.number ?? '', info?.name ?? ''] as const })
  const headingKey = JSON.stringify(headings)
  const info = useMemo(() => new Map(headings.map(([page, number, name]) => [page, { number, name } as DrawingInfo])), [headingKey])
  const table = useMemo(() => projectQuantityTable(data, mode, filters, page => info.get(page) ?? null, { allConditions, expanded }), [data, mode, filters, info, allConditions, expanded])
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
        const [cursorMode, itemId, columnKey, condition] = JSON.parse(key) as [QuantityTableMode, string, string | null, string | null]
        const item = data.find(item => item.fixture.id === itemId)
        if (cursorMode !== mode || !item) continue
        const entries = columnEntries(item, mode, columnKey, condition ?? undefined)
        if (!entries.length || entries.reduce((n, e) => n + e.value, 0) === 0) continue
        refreshed[key] = refreshReview(reviewOrder(entries, id => store.get(id)), previous[key])
      }
      return refreshed
    })
  }, [data, mode, store])
  const resize = (n: number) => {
    const clamped = Math.max(20, Math.min(70, n)); onHeightChange(clamped)
    try { localStorage.setItem(HEIGHT_KEY, String(clamped)) } catch { /* Optional UI preference. */ }
  }
  const go = async (item: TableItem, column: QuantityTableColumn | null, condition?: string) => {
    if (busyRef.current || !navigation) return
    busyRef.current = true; setBusy(true); setError('')
    const revision = session.pageRevision
    try {
      const entries = columnEntries(item, mode, column?.key ?? null, condition)
      for (const page of new Set(entries.map(e => e.pageIndex))) {
        await store.ensurePageLoaded(page, () => pool.listAnnotations(session.docId, page))
        if (!alive.current || revision !== session.pageRevision) return
      }
      const key = JSON.stringify([mode, item.fixture.id, column?.key ?? null, condition ?? null])
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
      <button aria-pressed={allConditions} onClick={() => { setAllConditions(value => !value); setExpanded({}) }}>施工条件別</button>
      <label><input type="checkbox" style={{ width: 'auto', minWidth: 0 }} checked={!!filters.unsetOnly} onChange={e => setFilters(f => ({ ...f, unsetOnly: e.target.checked }))} />未設定だけ</label>
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
            const condition = row.conditionKey, isCondition = condition !== undefined
            const aggregate = isCondition ? item.byCondition.get(condition)! : item
            const isExpanded = !!filters.unsetOnly || (expanded[f.id] ?? allConditions)
            const allKey = JSON.stringify([mode, f.id, null, condition ?? null])
            return <tr key={JSON.stringify([f.id, condition ?? null])} data-fixture-id={f.id} data-condition={condition}
              className={isCondition ? 'quantity-table-condition' : undefined} aria-rowindex={first + offset + 2}>
              <td className="quantity-table-fixed quantity-table-fixed-0">{isCondition ? null : quantityKind(f) === 'count' ? f.sample
                ? <img src={`data:image/png;base64,${f.sample.png}`} alt={`${f.name}の見本`} />
                : <svg viewBox="-14 -14 28 28" aria-hidden="true"><CountMarker style={{ ...f.style, size: 24, opacity: 1 }} showCode={false} /></svg>
                : <QuantitySwatch fixture={f} />}</td>
              <th scope="row" title={isCondition ? '' : fixtureCode(f)} className="quantity-table-fixed quantity-table-fixed-1">{isCondition ? '' : fixtureCode(f)}</th>
              <td title={isCondition ? condition || '未設定' : f.name} className="quantity-table-fixed quantity-table-fixed-2">
                {isCondition ? `└ ${condition || '未設定'}` : <>{item.byCondition.size >= 2 && <button aria-label={`${f.name}の施工条件を${isExpanded ? '折りたたむ' : '展開'}`}
                  aria-expanded={isExpanded} disabled={!!filters.unsetOnly} onClick={() => setExpanded(previous => ({ ...previous, [f.id]: !isExpanded }))}>{isExpanded ? '▾' : '▸'}</button>}{f.name}</>}
              </td>
              <td className="quantity-table-fixed quantity-table-fixed-3">{QUANTITY_UNITS[quantityKind(f)]}</td>
              <td className="quantity-table-fixed quantity-table-fixed-4" title={isCondition && quantityKind(f) === 'length' ? quantityPartSummary(aggregate) : undefined}>
                <button disabled={aggregate.total === 0 || (isCondition && busy)} aria-label={`${fixtureCode(f)} ${f.name}${isCondition ? ` ${condition || '未設定'}` : ''}の全図面の内訳`}
                  onClick={() => { if (isCondition) void go(item, null, condition); else { fixtureUi?.open(); controls?.showBreakdown(f.id) } }}>
                  {aggregate.total === 0 ? '' : format(f, aggregate.total)}
                  {isCondition && cursors[allKey] && <small className="quantity-table-cursor">{cursors[allKey].position} / {cursors[allKey].count}</small>}
                </button>
                {isCondition && quantityKind(f) === 'length' && <small className="quantity-table-parts">{quantityPartSummary(aggregate, false)}</small>}
              </td>
              {table.columns.map(c => {
                const value = aggregate.values[mode].get(c.key) ?? 0, key = JSON.stringify([mode, f.id, c.key, condition ?? null])
                return <td key={c.key}><button disabled={value === 0 || busy} data-column-key={c.key}
                  aria-label={`${fixtureCode(f)} ${f.name}${isCondition ? ` ${condition || '未設定'}` : ''} ${c.heading}${c.subheading ? `／${c.subheading}` : ''} ${format(f, value)}`}
                  onClick={() => void go(item, c, condition)}>{value === 0 ? '' : format(f, value)}
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
