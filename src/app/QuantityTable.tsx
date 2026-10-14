import { lazy, Suspense, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { fixtureCode, quantityDecimals, quantityKind, quantityUnit, summaryText, type CountFixture, type QuantityKind } from '../core/countFixtures'
import { compareFloors, quantityPartSummary, type QuantityEntry, type QuantityIndex } from '../core/quantityIndex'
import type { DrawingInfo } from '../core/drawingInfo'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import { CountMarker, QuantitySwatch } from '../editor/countMarkers'
import { ensureSessionQuantityChecks, FixtureUiContext, type DocumentSession } from './documentModel'
import { groupFixtures } from './fixtureOrder'
import { QuantityNavigationContext, QuantityTableContext, revealPickup } from './QuantityBreakdown'
import { nextReview, refreshReview, reviewOrder, type ReviewCursor } from './reviewCursor'
import { breakdownHeadingPath, breakdownHeadingRows, createQuantityBreakdownOrder, orderByBreakdown, type QuantityBreakdownOrder } from './breakdownOutline'
import { getGroupByBreakdown, setGroupByBreakdown, subscribeGroupByBreakdown } from './breakdownGroupingPreference'
import type { QuantityCheckBasics } from '../core/quantityCheckBasics'
import { linkRelations, linkSourceText, linkSourceTitle, linkDependentTitle } from './linkRelations'
import { perfCount, perfTime } from '../perf/counters'
import type { RelatedReviewRow } from './relatedXlsx'

export { breakdownHeadingPath, breakdownHeadingRows, createQuantityBreakdownOrder, orderByBreakdown, quantityBreakdownGroupKey, quantityBreakdownRowKey } from './breakdownOutline'
export type { QuantityBreakdownOrder } from './breakdownOutline'

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
export type QuantityTableRow = {
  category: string
  groupKey?: string
  level?: 0 | 1 | 2 | 3 | 4
  item?: TableItem
  conditionKey?: string
  itemCount?: number
  groupExpanded?: boolean
}

export interface QuantityTableDisplay {
  allConditions?: boolean
  expanded?: Readonly<Record<string, boolean>>
  groupByBreakdown?: boolean
  breakdownOrder?: QuantityBreakdownOrder
  collapsed?: ReadonlySet<string>
  expandedFor?: string
}
export const QUANTITY_TABLE_FIXED_HEADERS = ['見本', '略号', '名称', '規格', '単位', '全図面'] as const
export const QUANTITY_TABLE_METADATA_HEADERS = ['摘要'] as const
const BASE_COLUMN_WIDTHS = [44, 100, 150, 90, 50, 90, 120] as const
const FIXED_COLUMN_COUNT = QUANTITY_TABLE_FIXED_HEADERS.length
const BASE_COLUMN_COUNT = BASE_COLUMN_WIDTHS.length
const BASE_TABLE_WIDTH = BASE_COLUMN_WIDTHS.reduce((total, width) => total + width, 0)



export function quantityTableFixtureText(fixture: CountFixture) {
  return { summary: summaryText(fixture) }
}



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
function quantityTableHeadingKeys(rows: readonly QuantityTableRow[], fixtureId: string): Set<string> {
  const ancestors: string[] = []
  for (const row of rows) {
    if (!row.item) {
      const level = row.level ?? 0
      ancestors.length = level
      ancestors[level] = row.groupKey ?? row.category
    } else if (row.conditionKey === undefined && row.item.fixture.id === fixtureId) {
      return new Set(ancestors.filter(key => key !== undefined))
    }
  }
  return new Set()
}

/** Project visibility only; never mutate aggregates or the saved collapsed keys. */
function collapseQuantityTableRows(
  rows: QuantityTableRow[],
  collapsed?: ReadonlySet<string>,
  expandedFor?: string,
  suppressed?: ReadonlySet<string>,
): QuantityTableRow[] {
  if (!collapsed?.size) return rows
  const autoExpanded = expandedFor === undefined
    ? new Set<string>()
    : quantityTableHeadingKeys(rows, expandedFor)
  const visible: QuantityTableRow[] = []
  let hiddenLevel: number | undefined
  for (const row of rows) {
    if (row.item) {
      if (hiddenLevel === undefined) visible.push(row)
      continue
    }
    const level = row.level ?? 0
    if (hiddenLevel !== undefined && level > hiddenLevel) continue
    const key = row.groupKey ?? row.category
    const groupExpanded = !collapsed.has(key)
      || (autoExpanded.has(key) && !suppressed?.has(key))
    visible.push({ ...row, groupExpanded })
    hiddenLevel = groupExpanded ? undefined : level
  }
  return visible
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
  drawingInfo: (page: number) => DrawingInfo | null, display: QuantityTableDisplay = {}, columnLimit = 80) {
  if (columnLimit !== Infinity && (!Number.isInteger(columnLimit) || columnLimit < 0)) {
    throw new RangeError('集計表の列の上限は0以上の整数またはInfinityで指定してください')
  }
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
  const columns: QuantityTableColumn[] = ordered.slice(0, columnLimit).map(key => {
    if (mode === 'page') {
      const pageIndex = Number(key), info = drawingInfo(pageIndex)
      return { key, pageIndex, heading: info?.number || `p.${pageIndex + 1}`, subheading: info?.name ?? '' }
    }
    if (mode === 'floor') return { key, floor: key, heading: key || '（階なし）', subheading: '' }
    const [floor, room] = JSON.parse(key) as string[]
    return { key, floor, room, heading: floor || '（階なし）', subheading: room || '（部屋なし）' }
  })
  // Until the lazy master order is available, retain the existing category order.
  const grouping = !!display.groupByBreakdown && display.breakdownOrder !== undefined
    && data.some(item => item.fixture.breakdown !== undefined)
  const projectedItems = grouping ? orderByBreakdown(items, item => item.fixture, display.breakdownOrder!) : items

  const rows: QuantityTableRow[] = []
  let previousGroup: string | undefined
  let previousPath: string[] | null | undefined
  for (const item of projectedItems) {
    const category = item.fixture.category
    if (grouping) {
      const path = breakdownHeadingPath(item.fixture, display.breakdownOrder!)
      rows.push(...breakdownHeadingRows(path, previousPath))
      previousPath = path
    } else if (category !== previousGroup) {
      previousGroup = category
      rows.push({ category })
    }
    rows.push({ category, item })
    if (filters.unsetOnly || (item.byCondition.size >= 2 && (display.expanded?.[item.fixture.id] ?? display.allConditions))) {
      for (const conditionKey of item.byCondition.keys()) {
        if (!filters.unsetOnly || conditionKey === '') rows.push({ category, item, conditionKey })
      }
    }
  }
  // Count fixtures, not condition rows, before removing collapsed descendants.
  const ancestors: QuantityTableRow[] = []
  for (const row of rows) {
    if (!row.item) {
      const level = row.level ?? 0
      ancestors.length = level
      ancestors[level] = row
      row.itemCount = 0
      row.groupExpanded = true
    } else if (row.conditionKey === undefined) {
      for (const heading of ancestors) {
        if (heading) heading.itemCount = (heading.itemCount ?? 0) + 1
      }
    }
  }
  return {
    rows: collapseQuantityTableRows(rows, display.collapsed, display.expandedFor),
    columns,
    omittedColumns: ordered.length - columns.length,
  }
}

export function buildQuantityTable(index: QuantityIndex, fixtures: readonly CountFixture[], mode: QuantityTableMode,
  filters: QuantityTableFilters, drawingInfo: (page: number) => DrawingInfo | null) {
  return projectQuantityTable(buildQuantityTableData(index, fixtures), mode, filters, drawingInfo)
}

const ROW_HEIGHT = 32, HEADER_HEIGHT = 56, OVERSCAN = 4
const HEIGHT_KEY = 'karu-pdf:quantity-table-height'
const COLLAPSED_KEY = 'karu-pdf:quantity-table-collapsed'
const CHECKS_KEY = 'karu-pdf:quantity-table-checks'
const CHECK_COLUMN_KEY = 'karu-pdf:quantity-table-check-column'
const CHECK_COLUMN_WIDTH = 260
const QuantityChecks = lazy(() => import('./QuantityChecks'))

function readCollapsedHeadings(): ReadonlySet<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]')
    if (Array.isArray(value) && value.every(key => typeof key === 'string')) {
      return new Set(value as string[])
    }
  } catch { /* Optional UI preference; unreadable storage means all expanded. */ }
  return new Set()
}

interface QuantityWorkbookWritable {
  write(data: Blob): Promise<void>
  close(): Promise<void>
  abort?(): Promise<void>
}
interface QuantityWorkbookFileHandle {
  createWritable(): Promise<QuantityWorkbookWritable>
}
interface QuantityWorkbookPickerOptions {
  suggestedName: string
  types: { description: string; accept: Record<string, string[]> }[]
}
type QuantityWorkbookPicker = (options: QuantityWorkbookPickerOptions) => Promise<QuantityWorkbookFileHandle>

export default function QuantityTable({ session, pool, height, onHeightChange, onClose }: {
  session: DocumentSession; pool: PdfWorkerPool; height: number; onHeightChange(n: number): void; onClose(): void
}) {
  perfCount('QuantityTable.render')
  const store = session.annotationStore, navigation = useContext(QuantityNavigationContext)
  const controls = useContext(QuantityTableContext), fixtureUi = useContext(FixtureUiContext)
  // This component is mounted only while open.
  useSyncExternalStore(store.subscribe, store.getSnapshot)
  const index = store.quantityIndex()
  const fixtures = store.getCountFixturesSnapshot()
  const relatedReviews = store.getRelatedReviewsSnapshot()
  const relatedFixturesRevision = store.getFixturesRevision()
  const relatedReviewsRevision = store.getRelatedReviewsRevision()
  const relatedEnabled = useMemo(() =>
    relatedReviews.projectMode !== undefined
      || Object.keys(relatedReviews.decisions).length > 0,
  [relatedReviews])
  const [relatedAttempt, setRelatedAttempt] = useState(0)
  const relatedInput = useMemo(() =>
    relatedEnabled && store.fixturesReady && store.relatedReviewsReady
      ? {
        store,
        fixtures,
        reviews: relatedReviews,
        fixturesRevision: relatedFixturesRevision,
        reviewsRevision: relatedReviewsRevision,
        pageRevision: session.pageRevision,
      }
      : undefined,
  [
    relatedEnabled, store, fixtures, relatedReviews,
    relatedFixturesRevision, relatedReviewsRevision, session.pageRevision,
    store.fixturesReady, store.relatedReviewsReady, relatedAttempt,
  ])
  const [relatedEvaluation, setRelatedEvaluation] = useState<{
    input: NonNullable<typeof relatedInput>
    pending?: number
    error?: string
  }>()
  const relatedResult = relatedEvaluation?.input === relatedInput
    ? relatedEvaluation : undefined
  const relations = useMemo(() => perfTime('QuantityTable.linkRelations', () => linkRelations(fixtures)), [fixtures])
  const data = useMemo(() => perfTime('QuantityTable.buildData', () => buildQuantityTableData(index, fixtures)), [index, fixtures])
  const hasArchitecture = data.some(item => item.fixture.breakdown?.book === '建築')
  const hasBreakdown = data.some(item => item.fixture.breakdown !== undefined)
  const [showChecks, setShowChecks] = useState(() => {
    try { return localStorage.getItem(CHECKS_KEY) === 'true' }
    catch { return false }
  })
  const checksVisible = hasArchitecture && showChecks
  const [showCheckColumn, setShowCheckColumn] = useState(() => {
    try { return localStorage.getItem(CHECK_COLUMN_KEY) !== 'false' }
    catch { return true }
  })
  const checkColumnVisible = hasArchitecture && showCheckColumn
  const [checkColumnModule, setCheckColumnModule] = useState<typeof import('./quantityCheckColumn')>()
  const [checksLoadError, setChecksLoadError] = useState('')
  const [checksAttempt, setChecksAttempt] = useState(0)
  const revision = session.pageRevision
  const quantityChecksReady = hasArchitecture && store.quantityChecksReady
  const basicsKey = hasArchitecture ? JSON.stringify(store.getQuantityChecks().values) : '{}'
  const basics = useMemo<QuantityCheckBasics>(() => ({
    values: JSON.parse(basicsKey) as QuantityCheckBasics['values'],
  }), [basicsKey])
  const checksCalculations = useMemo(() => {
    if (!hasArchitecture || !quantityChecksReady || !checkColumnModule) return undefined
    return checkColumnModule.computeQuantityCheckColumn(
      data.map(item => item.fixture), id => index.total(id), basics,
    )
  }, [hasArchitecture, quantityChecksReady, checkColumnModule, data, index, basics])
  const [mode, setMode] = useState<QuantityTableMode>('page')
  const [filters, setFilters] = useState<QuantityTableFilters>({})
  const [allConditions, setAllConditions] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const groupByBreakdown = useSyncExternalStore(
    subscribeGroupByBreakdown, getGroupByBreakdown, getGroupByBreakdown,
  )
  const [breakdownOrder, setBreakdownOrder] = useState<QuantityBreakdownOrder>()
  const selectedFixtureId = store.selectedFixtureId ?? undefined
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(readCollapsedHeadings)
  const [selectionCollapse, setSelectionCollapse] = useState(() => ({
    fixtureId: selectedFixtureId,
    keys: new Set<string>(),
  }))
  // Reset during rendering so a changed selection never uses an old override.
  if (selectionCollapse.fixtureId !== selectedFixtureId) {
    setSelectionCollapse({ fixtureId: selectedFixtureId, keys: new Set<string>() })
  }
  // Metadata edits do not invalidate the quantity index. Selection and flashes
  // must not recreate the table: compare only the page headings.
  const pages = useMemo(() => [...new Set(data.flatMap(item => [...item.values.page.keys()].map(Number)))], [data])
  const headings = pages.map(page => { const info = store.getDrawingInfo(page); return [page, info?.number ?? '', info?.name ?? ''] as const })
  const headingKey = JSON.stringify(headings)
  const info = useMemo(() => new Map(headings.map(([page, number, name]) => [page, { number, name } as DrawingInfo])), [headingKey])
  const outline = useMemo(() => perfTime('QuantityTable.project', () => projectQuantityTable(data, mode, filters, page => info.get(page) ?? null,
    { allConditions, expanded, groupByBreakdown, breakdownOrder })),
  [data, mode, filters, info, allConditions, expanded, groupByBreakdown, breakdownOrder])
  const table = useMemo(() => ({
    ...outline,
    rows: collapseQuantityTableRows(
      outline.rows, collapsed, selectedFixtureId,
      selectionCollapse.fixtureId === selectedFixtureId ? selectionCollapse.keys : undefined,
    ),
  }), [outline, collapsed, selectedFixtureId, selectionCollapse])
  const categories = useMemo(() => [...new Set(data.map(item => item.fixture.category))], [data])
  const [viewport, setViewport] = useState({ top: 0, height: 0 })
  const [checksPanelMaxHeight, setChecksPanelMaxHeight] = useState(0)
  const tableRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null), closeRef = useRef<HTMLButtonElement>(null)
  const followedSelection = useRef<{ fixtureId: string | undefined } | null>(null)
  const alive = useRef(true), busyRef = useRef(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const xlsxBusyRef = useRef(false)
  const [xlsxBusy, setXlsxBusy] = useState(false)
  const [cursors, setCursors] = useState<Record<string, ReviewCursor>>({})
  useEffect(() => {
    if (!relatedInput) return
    let current = true
    const isCurrent = () => current
      && relatedInput.pageRevision === session.pageRevision
      && relatedInput.fixturesRevision === store.getFixturesRevision()
      && relatedInput.reviewsRevision === store.getRelatedReviewsRevision()
      && store.fixturesReady && store.relatedReviewsReady
    // 未使用文書では import も評価もしない。評価は描画後に行う。
    const timer = setTimeout(() => {
      if (!isCurrent()) return
      void import('./relatedReviewRows')
        .then(module => module.evaluateRelatedReviewRows(
          relatedInput.fixtures, relatedInput.reviews, isCurrent,
        ))
        .then(rows => {
          if (rows === undefined || !isCurrent()) return
          setRelatedEvaluation({
            input: relatedInput,
            pending: rows.filter(row => row.status === '未判断').length,
          })
        })
        .catch(reason => {
          if (!isCurrent()) return
          setRelatedEvaluation({
            input: relatedInput,
            error: reason instanceof Error ? reason.message : String(reason),
          })
        })
    }, 0)
    return () => { current = false; clearTimeout(timer) }
  }, [relatedInput, session, store])
  useEffect(() => {
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed])) }
    catch { /* Optional UI preference. */ }
  }, [collapsed])
  const toggleChecks = () => {
    setShowChecks(previous => {
      const next = !previous
      try { localStorage.setItem(CHECKS_KEY, String(next)) }
      catch { /* Optional UI preference. */ }
      return next
    })
  }
  const toggleCheckColumn = () => {
    setShowCheckColumn(previous => {
      const next = !previous
      try { localStorage.setItem(CHECK_COLUMN_KEY, String(next)) }
      catch { /* Optional UI preference. */ }
      return next
    })
  }
  useEffect(() => {
    if (!hasArchitecture) return
    let current = true
    setChecksLoadError('')
    // The calculation module and saved basics can be loaded independently.
    void Promise.all([
      import('./quantityCheckColumn'),
      ensureSessionQuantityChecks(session, pool),
    ]).then(([module]) => {
      if (current) setCheckColumnModule(module)
    }).catch(error => {
      if (current) {
        setChecksLoadError(`数量チェックを読み込めませんでした：${error instanceof Error ? error.message : String(error)}`)
      }
    })
    return () => { current = false }
  }, [hasArchitecture, session, pool, store, revision, checksAttempt])
  const toggleHeading = (row: QuantityTableRow) => {
    const key = row.groupKey ?? row.category
    const isExpanded = row.groupExpanded !== false
    setCollapsed(previous => {
      const next = new Set(previous)
      if (isExpanded) next.add(key); else next.delete(key)
      return next
    })
    setSelectionCollapse(previous => {
      const keys = new Set(previous.fixtureId === selectedFixtureId ? previous.keys : [])
      if (isExpanded) keys.add(key); else keys.delete(key)
      return { fixtureId: selectedFixtureId, keys }
    })
  }
  const collapseAllHeadings = () => {
    setCollapsed(previous => {
      const next = new Set(previous)
      for (const row of outline.rows) {
        if (!row.item) next.add(row.groupKey ?? row.category)
      }
      return next
    })
    setSelectionCollapse({
      fixtureId: selectedFixtureId,
      keys: new Set(outline.rows.filter(row => !row.item)
        .map(row => row.groupKey ?? row.category)),
    })
  }
  const expandAllHeadings = () => {
    setCollapsed(new Set<string>())
    setSelectionCollapse({ fixtureId: selectedFixtureId, keys: new Set<string>() })
  }
  useEffect(() => {
    if (!hasBreakdown || !groupByBreakdown || breakdownOrder !== undefined) return
    let current = true
    void import('../core/breakdownMaster').then(({ breakdownEntries }) => {
      if (current) setBreakdownOrder(createQuantityBreakdownOrder(breakdownEntries()))
    }).catch(e => {
      if (current) setError(`内訳書の位置の並び順を読み込めませんでした：${e instanceof Error ? e.message : String(e)}`)
    })
    return () => { current = false }
  }, [hasBreakdown, groupByBreakdown, breakdownOrder])
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
    const scroll = scrollRef.current!, region = tableRef.current!
    const measure = () => {
      setViewport({ top: scroll.scrollTop, height: scroll.clientHeight })
      setChecksPanelMaxHeight(region.clientHeight / 2)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(scroll); observer.observe(region); measure()
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    setViewport(v => ({ ...v, top: 0 })); setCursors({})
  }, [mode, filters, groupByBreakdown, breakdownOrder])
  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    const selectionChanged = followedSelection.current === null
      || followedSelection.current.fixtureId !== selectedFixtureId
    const selectionReady = !hasBreakdown || !groupByBreakdown
      || breakdownOrder !== undefined
    if (selectionChanged && selectionReady) {
      // 選択ごとに一度だけ追従する。数量更新や手動スクロールでは追従しない。
      followedSelection.current = { fixtureId: selectedFixtureId }
      const selectedRow = selectedFixtureId === undefined ? -1 : table.rows.findIndex(row =>
        row.item?.fixture.id === selectedFixtureId && row.conditionKey === undefined,
      )
      if (selectedRow >= 0) {
        const rowTop = selectedRow * ROW_HEIGHT
        if (rowTop < scroll.scrollTop) scroll.scrollTop = rowTop
        else if (HEADER_HEIGHT + rowTop + ROW_HEIGHT > scroll.scrollTop + scroll.clientHeight) {
          scroll.scrollTop = HEADER_HEIGHT + rowTop + ROW_HEIGHT - scroll.clientHeight
        }
      }
    }
    // Synchronize virtualization after the browser clamps a shortened table.
    scroll.scrollTop = Math.min(scroll.scrollTop,
      Math.max(0, HEADER_HEIGHT + table.rows.length * ROW_HEIGHT - scroll.clientHeight))
    const top = scroll.scrollTop, height = scroll.clientHeight
    setViewport(previous => previous.top === top && previous.height === height
      ? previous : { top, height })
  }, [selectedFixtureId, table.rows, checksVisible, hasBreakdown, groupByBreakdown, breakdownOrder])
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
  const exportXlsx = async () => {
    if (xlsxBusyRef.current) return
    xlsxBusyRef.current = true; setXlsxBusy(true); setError('')
    let writable: QuantityWorkbookWritable | undefined
    try {
      const revision = session.pageRevision
      const pdfName = session.name
      const fileName = `${pdfName.replace(/\.pdf$/i, '')}_数量集計表.xlsx`
      const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      const fixtures = [...store.getCountFixtures()]
      const exportReviews = store.getRelatedReviewsSnapshot()
      const exportFixturesRevision = store.getFixturesRevision()
      const exportReviewsRevision = store.getRelatedReviewsRevision()
      const includeRelated = exportReviews.projectMode !== undefined
        || Object.keys(exportReviews.decisions).length > 0
      const drawingInfo = (page: number) => info.get(page) ?? null
      const options = { data, mode, filters, display: { allConditions, expanded, groupByBreakdown, breakdownOrder }, drawingInfo, pdfName, index, fixtures }
      const picker = (window as unknown as { showSaveFilePicker?: QuantityWorkbookPicker }).showSaveFilePicker
      // Invoke the picker before awaiting import(), while user activation is present.
      const handle = picker ? await picker.call(window, {
        suggestedName: fileName,
        types: [{ description: 'Excelのブック', accept: { [mime]: ['.xlsx'] } }],
      }) : undefined
      if (!alive.current) return
      const { createQuantityWorkbook } = await import('./quantityXlsx')
      if (!alive.current) return
      if (options.display.groupByBreakdown && options.display.breakdownOrder === undefined) {
        const { breakdownEntries } = await import('../core/breakdownMaster')
        if (!alive.current) return
        options.display.breakdownOrder = createQuantityBreakdownOrder(breakdownEntries())
      }
      let quantityChecks: import('../core/quantityCheckBasics').QuantityCheckBasics | undefined
      if (fixtures.some(fixture => fixture.breakdown?.book === '建築')) {
        await ensureSessionQuantityChecks(session, pool)
        if (!alive.current || revision !== session.pageRevision || !store.quantityChecksReady) return
        quantityChecks = store.getQuantityChecks()
      }
      let relatedReviewRows: RelatedReviewRow[] | undefined
      if (includeRelated) {
        if (!store.fixturesReady || !store.relatedReviewsReady) {
          throw new Error('関連候補の判断の読込が完了していません。')
        }
        const isCurrent = () => alive.current
          && revision === session.pageRevision
          && exportFixturesRevision === store.getFixturesRevision()
          && exportReviewsRevision === store.getRelatedReviewsRevision()
          && store.fixturesReady && store.relatedReviewsReady
        if (!isCurrent()) return
        const { evaluateRelatedReviewRows } = await import('./relatedReviewRows')
        if (!isCurrent()) return
        relatedReviewRows = await evaluateRelatedReviewRows(
          fixtures, exportReviews, isCurrent,
        )
        if (relatedReviewRows === undefined || !isCurrent()) return
      }
      const bytes = createQuantityWorkbook({
        ...options,
        quantityChecks,
        ...(relatedReviewRows !== undefined ? { relatedReviews: relatedReviewRows } : {}),
      })
      const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime })
      if (handle) {
        writable = await handle.createWritable()
        await writable.write(blob)
        await writable.close()
        writable = undefined
      } else {
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url; link.download = fileName
        try {
          document.body.appendChild(link)
          link.click()
        } finally {
          link.remove()
          window.setTimeout(() => URL.revokeObjectURL(url), 1000)
        }
      }
    } catch (e) {
      if (writable?.abort) {
        try { await writable.abort() } catch { /* Keep the original failure. */ }
      }
      const cancelled = typeof e === 'object' && e !== null && 'name' in e && e.name === 'AbortError'
      if (!cancelled && alive.current) {
        setError(`Excelへの書き出しに失敗しました：${e instanceof Error ? e.message : String(e)}`)
      }
    } finally {
      xlsxBusyRef.current = false
      if (alive.current) setXlsxBusy(false)
    }
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
  const format = (f: CountFixture, n: number) => quantityDecimals(f) === 0 ? String(Math.round(n)) : n.toFixed(2)
  return <section ref={tableRef} className="quantity-table" role="region" aria-label="数量の集計表">
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
      {hasArchitecture && <>
        <button aria-pressed={checkColumnVisible} onClick={toggleCheckColumn}>チェック</button>
        <button aria-pressed={checksVisible} aria-expanded={checksVisible} onClick={toggleChecks}>チェックシート</button>
      </>}
      {(['page', 'floor', 'room'] as const).map((value, i) => <button key={value} aria-pressed={mode === value}
        onClick={() => setMode(value)}>{['図面別', '階別', '階・部屋別'][i]}</button>)}
      <button aria-pressed={allConditions} onClick={() => { setAllConditions(value => !value); setExpanded({}) }}>施工条件別</button>
      <button onClick={collapseAllHeadings}>すべてたたむ</button>
      <button onClick={expandAllHeadings}>すべて開く</button>
      <label><input type="checkbox" style={{ width: 'auto', minWidth: 0 }} checked={!!filters.unsetOnly} onChange={e => setFilters(f => ({ ...f, unsetOnly: e.target.checked }))} />未設定だけ</label>
      <label><input type="checkbox" aria-label="内訳書の位置でまとめる" style={{ width: 'auto', minWidth: 0 }} checked={groupByBreakdown}
        onChange={e => setGroupByBreakdown(e.currentTarget.checked)} />内訳書の位置でまとめる</label>
      <select aria-label="集計表の分類" value={filters.category ?? ''} onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}>
        <option value="">すべて</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <select aria-label="集計表の種別" value={filters.kind ?? ''} onChange={e => setFilters(f => ({ ...f, kind: e.target.value as QuantityKind | '' }))}>
        <option value="">すべて</option>{(['count', 'length', 'area', 'volume'] as const).map((kind, i) => <option key={kind} value={kind}>{['個数', '長さ', '面積', '体積'][i]}</option>)}
      </select>
      <input type="search" aria-label="集計表の名称・略号を検索" placeholder="名称・略号を検索" value={filters.search ?? ''} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} />
      <button onClick={() => { fixtureUi?.open(); controls?.showCsv() }}>CSVに書き出す</button>
      <button disabled={xlsxBusy} onClick={() => void exportXlsx()}>Excelに書き出す</button>
      <button ref={closeRef} onClick={onClose} aria-label="集計表を閉じる">閉じる</button>
    </div>
    {relatedResult?.pending !== undefined && <p
      className="quantity-table-notice" role="status"
      data-testid="quantity-related-pending">
      関連候補：未判断 {relatedResult.pending}件
    </p>}
    {relatedResult?.error && <p role="alert">
      関連候補の件数を確認できませんでした：{relatedResult.error}
      {' '}<button onClick={() => setRelatedAttempt(value => value + 1)}>再試行</button>
    </p>}
    {table.omittedColumns > 0 && <p className="quantity-table-notice" role="status">ほか {table.omittedColumns} 列。分類・種別・検索で絞り込むか、CSV で確かめてください</p>}
    {error && <p role="alert">{error}</p>}
    {hasArchitecture && checksLoadError && <p role="alert">
      {checksLoadError} <button onClick={() => setChecksAttempt(value => value + 1)}>再試行</button>
    </p>}
    {!checksVisible && checksCalculations?.error && <p role="alert">{checksCalculations.error}</p>}
    {checksVisible && <section className="quantity-checks-panel" role="region" aria-label="チェックシート"
      style={{ maxHeight: checksPanelMaxHeight }}>
      <Suspense fallback={<p role="status">チェックシートを読み込んでいます</p>}>
        <QuantityChecks key={`${session.docId}:${revision}`} session={session}
          basics={basics} calculations={checksCalculations} />
      </Suspense>
    </section>}
    <div className="quantity-table-scroll" ref={scrollRef} onScroll={e => setViewport({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}>
      <table aria-label="数量の集計" aria-rowcount={table.rows.length + 1}
        style={{ width: BASE_TABLE_WIDTH + table.columns.length * 140 + (checkColumnVisible ? CHECK_COLUMN_WIDTH : 0) }}>
        <colgroup>
          {BASE_COLUMN_WIDTHS.map((width, i) => <col key={i} style={{ width }} />)}
          {table.columns.map(c => <col key={c.key} style={{ width: 140 }} />)}
          {checkColumnVisible && <col style={{ width: CHECK_COLUMN_WIDTH }} />}
        </colgroup>
        <thead><tr aria-rowindex={1}>{QUANTITY_TABLE_FIXED_HEADERS.map((label, i) => <th key={label} scope="col" className={`quantity-table-fixed quantity-table-fixed-${i}`}>{label}</th>)}
          <th scope="col" className="quantity-table-summary">{QUANTITY_TABLE_METADATA_HEADERS[0]}</th>
          {table.columns.map(c => <th key={c.key} scope="col" data-column-key={c.key}><span title={c.heading}>{c.heading}</span><small title={c.subheading}>{c.subheading}</small></th>)}
          {checkColumnVisible && <th scope="col" className="quantity-table-check-header">チェック</th>}
        </tr></thead>
        <tbody>
          {first > 0 && <tr className="quantity-table-spacer" aria-hidden="true"><td colSpan={BASE_COLUMN_COUNT + table.columns.length + (checkColumnVisible ? 1 : 0)} style={{ height: first * ROW_HEIGHT }} /></tr>}
          {table.rows.slice(first, end).map((row, offset) => {
            const item = row.item
            if (!item) return <tr key={JSON.stringify(['category', row.level ?? null, row.groupKey ?? row.category])}
              className="quantity-table-category" data-level={row.level} aria-rowindex={first + offset + 2}>
              <th colSpan={FIXED_COLUMN_COUNT} className="quantity-table-fixed" scope="rowgroup">
                <button className="quantity-table-heading-toggle" aria-expanded={row.groupExpanded !== false}
                  aria-label={`${row.category}を${row.groupExpanded !== false ? 'たたむ' : '開く'}`}
                  onClick={() => toggleHeading(row)}>{row.groupExpanded !== false ? '▾' : '▸'}</button>
                <span className="quantity-table-heading-label">{row.category}</span>
                <span className="quantity-table-heading-count">（{row.itemCount ?? 0}）</span>
              </th><td colSpan={QUANTITY_TABLE_METADATA_HEADERS.length + table.columns.length} />
              {checkColumnVisible && <td className="quantity-table-check-cell" />}
            </tr>
            const f = item.fixture
            const sources = relations.sources.get(f.id) ?? []
            const dependents = relations.dependents.get(f.id) ?? []
            const linkResult = f.link !== undefined ? index.linkResult(f.id) : undefined
            const texts = quantityTableFixtureText(f)
            const condition = row.conditionKey, isCondition = condition !== undefined
            const checkLines = isCondition ? undefined : checksCalculations?.byFixture.get(f.id)
            const aggregate = isCondition ? item.byCondition.get(condition)! : item
            const isExpanded = !!filters.unsetOnly || (expanded[f.id] ?? allConditions)
            const allKey = JSON.stringify([mode, f.id, null, condition ?? null])
            return <tr key={JSON.stringify([f.id, condition ?? null])} data-fixture-id={f.id} data-condition={condition}
              className={isCondition ? 'quantity-table-condition' : undefined} aria-rowindex={first + offset + 2}>
              <td className="quantity-table-fixed quantity-table-fixed-0">{isCondition ? null : quantityKind(f) === 'count' ? f.sample
                ? <img src={`data:image/png;base64,${f.sample.png}`} alt={`${f.name}の見本`} />
                : <svg viewBox="-14 -14 28 28" aria-hidden="true"><CountMarker style={{ ...f.style, size: 24, opacity: 1 }} showCode={false} /></svg>
                : <QuantitySwatch fixture={f} />}</td>
              <th scope="row" title={isCondition ? '' : f.code} className="quantity-table-fixed quantity-table-fixed-1">
                {isCondition ? '' : <>{f.code}{f.link !== undefined && <span
                  className={`fixture-link-badge${linkResult?.overridden && !linkResult.error ? ' fixture-link-override' : ''}`}
                  title={[linkResult?.error, linkSourceTitle(sources)].filter(Boolean).join('\n') || undefined}>
                  {linkResult?.error ? '連動の誤り' : linkResult?.overridden ? '上書き' : '連動'}
                </span>}{f.link !== undefined && sources.length > 0
                  && <span className="fixture-link-source-text" title={linkSourceTitle(sources)}>
                    {linkSourceText(sources)}
                  </span>}</>}
              </th>
              <td title={isCondition ? condition || '未設定' : f.name} className="quantity-table-fixed quantity-table-fixed-2">
                {isCondition ? `└ ${condition || '未設定'}` : <>{item.byCondition.size >= 2 && <button aria-label={`${f.name}の施工条件を${isExpanded ? '折りたたむ' : '展開'}`}
                  aria-expanded={isExpanded} disabled={!!filters.unsetOnly} onClick={() => setExpanded(previous => ({ ...previous, [f.id]: !isExpanded }))}>{isExpanded ? '▾' : '▸'}</button>}{f.name}{dependents.length > 0
                    && <span className="fixture-link-dependent-count" title={linkDependentTitle(dependents)}>
                      {' → '}{dependents.length}件
                    </span>}</>}
              </td>
              <td title={isCondition ? '' : f.spec ?? ''} className="quantity-table-fixed quantity-table-fixed-3">{isCondition ? '' : f.spec ?? ''}</td>
              <td className="quantity-table-fixed quantity-table-fixed-4">{quantityUnit(f)}</td>
              <td className="quantity-table-fixed quantity-table-fixed-5" title={isCondition && quantityKind(f) === 'length' ? quantityPartSummary(aggregate, true, f.convert ? quantityDecimals(f) : 1) : undefined}>
                <button disabled={aggregate.total === 0 || (isCondition && busy)} aria-label={`${fixtureCode(f)} ${f.name}${isCondition ? ` ${condition || '未設定'}` : ''}の全図面の内訳`}
                  onClick={() => { if (isCondition) void go(item, null, condition); else { fixtureUi?.open(); controls?.showBreakdown(f.id) } }}>
                  {aggregate.total === 0 && !(linkResult?.overridden && !isCondition) ? '' : format(f, aggregate.total)}
                  {isCondition && cursors[allKey] && <small className="quantity-table-cursor">{cursors[allKey].position} / {cursors[allKey].count}</small>}
                </button>
                {isCondition && quantityKind(f) === 'length' && <small className="quantity-table-parts">{quantityPartSummary(aggregate, false, f.convert ? quantityDecimals(f) : 1)}</small>}
              </td>
              <td title={isCondition ? '' : texts.summary} className="quantity-table-summary">{isCondition ? '' : texts.summary}</td>
              {table.columns.map(c => {
                const value = aggregate.values[mode].get(c.key) ?? 0, key = JSON.stringify([mode, f.id, c.key, condition ?? null])
                return <td key={c.key}><button disabled={value === 0 || busy} data-column-key={c.key}
                  aria-label={`${fixtureCode(f)} ${f.name}${isCondition ? ` ${condition || '未設定'}` : ''} ${c.heading}${c.subheading ? `／${c.subheading}` : ''} ${format(f, value)}`}
                  onClick={() => void go(item, c, condition)}>{value === 0 ? '' : format(f, value)}
                  {cursors[key] && <small className="quantity-table-cursor">{cursors[key].position} / {cursors[key].count}</small>}
                </button></td>
              })}
              {checkColumnVisible && <td className="quantity-table-check-cell"
                title={checkLines?.map(line => line.title).join('\n\n')}>
                {!!checkLines?.length && <div className="quantity-table-check-lines">
                  {checkLines.map(line => <span key={line.id}
                    className={`quantity-table-check-line${line.out ? ' quantity-check-out' : ''}`}>
                    {line.text}
                  </span>)}
                </div>}
              </td>}
            </tr>
          })}
          {end < table.rows.length && <tr className="quantity-table-spacer" aria-hidden="true"><td colSpan={BASE_COLUMN_COUNT + table.columns.length + (checkColumnVisible ? 1 : 0)} style={{ height: (table.rows.length - end) * ROW_HEIGHT }} /></tr>}
        </tbody>
      </table>
      {table.rows.length === 0 && <p>該当する項目はありません</p>}
    </div>
  </section>
}
