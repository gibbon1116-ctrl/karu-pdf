import { LocationInput } from './LocationInput'
import { lazy, Suspense, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent } from 'react'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import { fixtureCode, nextCountStyle, nextQuantityLineStyle, quantityDecimals, quantityKind, quantityUnit, type FixturePreset, type CountFixture } from '../core/countFixtures'
import { appendFixtures, type FixtureAppendOptions } from './fixtureAppend'
import { fixtureCrossingBarriers } from '../core/fixtureLink'
import FixtureHoverCard, { useFixtureHover } from './FixtureHoverCard'
import { linkRelations, linkSourceText, linkSourceTitle, linkDependentTitle } from './linkRelations'
import { collectShapeMetrics } from '../core/shapeMetrics'
import { createFixturePreviews } from './fixturePreviews'
import { CountMarker, QuantitySwatch } from '../editor/countMarkers'
import { ensureSessionFixtures, ensureSessionRelatedReviews, FixtureUiContext, SnapUiContext, type DocumentSession } from './documentModel'
import QuantityBreakdown, { QuantityTableContext } from './QuantityBreakdown'
import { floorFromDrawingName } from '../core/location'
import { annotationFilterLabel } from '../editor/annotationFilter'
import { groupFixtures, moveCategory, moveFixture, stepFixture } from './fixtureOrder'
import { breakdownHeadingPath, breakdownHeadingRows, createQuantityBreakdownOrder, fixtureOutlineDropError, fixtureOutlineMoveError, headingOutlineDropError, moveFixtureInOutline, moveFixturesToOutlinePosition, moveHeadingInOutline, orderByBreakdown, quantityBreakdownRowKey, sortByBreakdownMaster, type BreakdownHeading, type BreakdownHeadingLevel, type QuantityBreakdownOrder } from './breakdownOutline'
import { RecentFixtures } from './fixtureQuickList'
import { useRouteSets } from './RouteItems'
import { resolveRouteSet, routeSetSummary } from './routeSets'
import { SymbolSearchContext } from './symbolSearchContext'
import { RoomRegionDialog, RoomSetDialog, RoomSetPickupDialog } from '../editor/MeasurementOverlay'
import type { RoomRegion, RoomSet } from '../core/rooms'
import { getGroupByBreakdown, setGroupByBreakdown, subscribeGroupByBreakdown } from './breakdownGroupingPreference'
import { perfCount, perfTime } from '../perf/counters'
import { relatedSessionMemory } from './relatedState'

const QuantityCsvExportDialog = lazy(() => import('./CsvExportDialog').then(m => ({ default: m.QuantityCsvExportDialog })))
const FixtureDialog = lazy(() => import('./FixtureDialog'))
const FixturePresetDialog = lazy(() => import('./FixturePresetDialog'))
const BreakdownMoveDialog = lazy(() => import('./BreakdownMoveDialog'))

const BREAKDOWN_REORDER_STATUS = '科目より下の見出しか項目へ落としてください'
type FixtureDragKind = 'fixture' | 'category' | 'heading'
const fixtureDragType = (kind: FixtureDragKind) => kind === 'fixture'
  ? 'application/x-karu-fixture'
  : kind === 'category' ? 'application/x-karu-category' : 'application/x-karu-breakdown-heading'

interface FixtureOutlineGroup {
  key: string
  category: string
  level?: BreakdownHeadingLevel
  groupKey?: string
  categoryTarget?: string
  ancestors: string[]
  items: CountFixture[]
  directItems: CountFixture[]
  showHeading?: boolean
  parentKey?: string
}

function sameBreakdownPosition(a: CountFixture, b: CountFixture): boolean {
  return a.breakdown !== undefined && b.breakdown !== undefined
    && quantityBreakdownRowKey(a.breakdown) === quantityBreakdownRowKey(b.breakdown)
}

/** Reassign only the existing order slots of fixtures at the same position. */
function reorderLocatedFixture(
  fixtures: readonly CountFixture[],
  sourceId: string,
  targetId: string,
  side: 'before' | 'after',
): CountFixture[] | null {
  const source = fixtures.find(f => f.id === sourceId)
  const target = fixtures.find(f => f.id === targetId)
  if (!source || !target || sourceId === targetId || !sameBreakdownPosition(source, target)) return null
  const peers = fixtures.filter(f => sameBreakdownPosition(source, f)).sort((a, b) => a.order - b.order)
  const moved = [...peers]
  const [item] = moved.splice(moved.findIndex(f => f.id === sourceId), 1)
  const destination = moved.findIndex(f => f.id === targetId) + (side === 'after' ? 1 : 0)
  moved.splice(destination, 0, item)
  if (moved.every((f, i) => f.id === peers[i].id)) return null
  const orders = new Map(moved.map((f, i) => [f.id, peers[i].order]))
  return fixtures.map(f => {
    const order = orders.get(f.id)
    return order === undefined || order === f.order ? f : { ...f, order }
  })
}

function fixtureBreakdownGroups(
  fixtures: readonly CountFixture[],
  order: QuantityBreakdownOrder,
): FixtureOutlineGroup[] {
  const result: FixtureOutlineGroup[] = []
  let stack: FixtureOutlineGroup[] = []
  let previousPath: string[] | undefined
  const makeHeading = (heading: BreakdownHeading, ancestors: string[]): FixtureOutlineGroup => ({
    ...heading,
    key: JSON.stringify(['breakdown', heading.level, heading.groupKey]),
    ancestors,
    items: [],
    directItems: [],
  })
  for (const fixture of orderByBreakdown(fixtures.filter(f => f.breakdown !== undefined), f => f, order)) {
    const path = breakdownHeadingPath(fixture, order)!
    // Remove optional levels that disappeared even when no replacement heading is emitted.
    stack = stack.filter(group => {
      const level = group.level!
      return (level < 3 || !!path[level])
        && group.groupKey === JSON.stringify(path.slice(0, level + 1))
    })
    for (const heading of breakdownHeadingRows(path, previousPath)) {
      while (stack.length && stack[stack.length - 1].level! >= heading.level) stack.pop()
      const group = makeHeading(heading, stack.map(parent => parent.key))
      result.push(group)
      stack.push(group)
    }
    for (const group of stack) group.items.push(fixture)
    const parent = stack[stack.length - 1]
    const last = result[result.length - 1]
    if (last === parent || (last.showHeading === false && last.parentKey === parent.key)) {
      if (last !== parent) last.items.push(fixture)
      last.directItems.push(fixture)
    } else {
      // Preserve item order when returning to an ancestor without a new heading.
      result.push({
        key: JSON.stringify(['breakdown-items', fixture.id]),
        category: parent.category,
        ancestors: stack.map(group => group.key),
        items: [fixture],
        directItems: [fixture],
        showHeading: false,
        parentKey: parent.key,
      })
    }
    previousPath = path
  }
  const missing = groupFixtures(fixtures.filter(f => f.breakdown === undefined))
  if (missing.length) {
    const root = makeHeading(breakdownHeadingRows(null, previousPath)[0], [])
    root.items = missing.flatMap(group => group.items)
    result.push(root)
    for (const group of missing) {
      result.push({
        key: JSON.stringify(['breakdown-unlocated-category', group.category]),
        category: group.category,
        level: 1,
        categoryTarget: group.category,
        ancestors: [root.key],
        items: group.items,
        directItems: group.items,
      })
    }
  }
  return result
}

export default function FixturePanel({ session, pool }: { session: DocumentSession; pool: PdfWorkerPool }) {
  perfCount('FixturePanel.render')
  const store = session.annotationStore, ui = useContext(FixtureUiContext)
  const relatedMemory = useMemo(() => relatedSessionMemory(store), [store])
  const [presetQuery, setPresetQuery] = useState('')
  const previews = useMemo(() => createFixturePreviews(store), [store])
  const symbolSearch = useContext(SymbolSearchContext)
  const table = useContext(QuantityTableContext)
  const snap = useContext(SnapUiContext)
  const version = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [breakdownId, setBreakdownId] = useState<string | null>(null), [csvOpen, setCsvOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(() => {
    try { return localStorage.getItem('karu-pdf:fixture-panel-settings-open') === 'true' } catch { return false }
  })
  const routeSets = useRouteSets()
  const closeBreakdown = useRef(() => setBreakdownId(null)).current
  const [search, setSearch] = useState(''), [collapsed, setCollapsed] = useState(new Set<string>()), [error, setError] = useState('')
  const groupByBreakdown = useSyncExternalStore(
    subscribeGroupByBreakdown, getGroupByBreakdown, getGroupByBreakdown,
  )
  const [breakdownOrder, setBreakdownOrder] = useState<QuantityBreakdownOrder>()
  const [moveFixtureId, setMoveFixtureId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [revealFixtureId, setRevealFixtureId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{
    initial: CountFixture
    editing: boolean
    duplicate?: boolean
    initialSection?: 'rc'
  } | null>(null)
  const [editingRoom, setEditingRoom] = useState<{ pageIndex: number; region: RoomRegion } | null>(null)
  const [roomSetDialog, setRoomSetDialog] = useState<{ pageIndex: number; initial?: RoomSet } | null>(null)
  const [roomSetConfirmation, setRoomSetConfirmation] = useState<{ pageIndex: number; setId: string } | null>(null)
  const dragging = useRef<{ kind: FixtureDragKind; id: string } | null>(null)
  const [dropTarget, setDropTarget] = useState<{ kind: FixtureDragKind; id: string; side: 'before' | 'after' | 'inside' } | null>(null)
  const [status, setStatus] = useState('')
  const standardConditionsLoading = useRef(false)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const { hover: sampleHover, setHover: setSampleHover } = useFixtureHover()
  useEffect(() => {
    setDropTarget(null)
    dragging.current = null
    setSampleHover(null)
  }, [groupByBreakdown])
  const [preset, setPreset] = useState(false), [sources, setSources] = useState<Array<{ name: string; fixtures: CountFixture[] }> | null>(null), [busy, setBusy] = useState(false)
  useEffect(() => {
    if (dialog || moveFixtureId || csvOpen || breakdownId || preset || sources
      || editingRoom || roomSetDialog || roomSetConfirmation) setSampleHover(null)
  }, [dialog, moveFixtureId, csvOpen, breakdownId, preset, sources, editingRoom, roomSetDialog, roomSetConfirmation])

  useEffect(() => { let alive = true; void ensureSessionFixtures(session, pool).catch(e => { if (alive) setError(String(e)) }); return () => { alive = false } }, [session, pool, session.pageRevision])
  useEffect(() => {
    let alive = true
    void ensureSessionRelatedReviews(session, pool)
      .catch(e => { if (alive) setError(`関連候補の判断を読み込めませんでした：${String(e)}`) })
    return () => { alive = false }
  }, [session, pool, session.pageRevision])
  const drawingStatus = useSyncExternalStore(session.subscribeDrawingScan, session.getDrawingScanSnapshot)
  useEffect(() => { void session.scanDrawingInfos(pool) }, [session, pool, session.pageRevision])
  const fixtures = store.getCountFixturesSnapshot()
  const relations = useMemo(() => perfTime('FixturePanel.linkRelations', () => linkRelations(fixtures)), [fixtures])
  const missingLinkSources = useMemo(() => new Set(fixtures
    .filter(f => f.link && ['rc', 'shape', 'steel', 'crossing'].includes(f.link.kind)
      && (relations.sources.get(f.id)?.length ?? 0) === 0)
    .map(f => f.id)), [fixtures, relations])
  const hasBreakdown = useMemo(() => fixtures.some(f => f.breakdown !== undefined), [fixtures])
  useEffect(() => {
    if (!hasBreakdown || !groupByBreakdown || breakdownOrder !== undefined) return
    let current = true
    void import('../core/breakdownMaster').then(({ breakdownEntries }) => {
      if (current) setBreakdownOrder(createQuantityBreakdownOrder(breakdownEntries()))
    }).catch(reason => {
      if (current) setError(`内訳書の位置の並び順を読み込めませんでした：${reason instanceof Error ? reason.message : String(reason)}`)
    })
    return () => { current = false }
  }, [hasBreakdown, groupByBreakdown, breakdownOrder])
  const index = store.quantityIndex()
  const locations = useMemo(() => index.locations(), [index])
  const inferredFloor = floorFromDrawingName(store.getDrawingInfo(session.view.page - 1)?.name ?? '')
  const selected = fixtures.find(f => f.id === store.selectedFixtureId), pageIndex = session.view.page - 1
  const pageRoomRegions = store.getRoomRegions(pageIndex)
  const roomRegions = store.effectiveRoomRegions(pageIndex)
  const roomSets = store.getRoomSets()
  const roomSet = store.getPageRoomSet(pageIndex)
  const roomSetLink = store.getPageRoomSetLink(pageIndex)
  const aligningRoomSet = store.roomSetAlignPage === pageIndex
  const roomSetDx = roomSetLink?.dx ?? 0, roomSetDy = roomSetLink?.dy ?? 0
  const suggestedRoomSets = store.suggestedRoomSets(pageIndex)
  const roomSetPageCount = roomSet
    ? [...store.pageRoomSets.values()].filter(link => link.id === roomSet.id).length
    : 0
  const roomSetConfirmationCount = roomSetConfirmation?.pageIndex === pageIndex
    && roomSetConfirmation.setId === roomSet?.id
    ? store.roomSetPickupChanges(pageIndex).length : 0
  useEffect(() => {
    setEditingRoom(null)
    setRoomSetDialog(null)
    setRoomSetConfirmation(null)
    if (store.roomSetAlignPage !== null && store.roomSetAlignPage !== pageIndex) {
      store.endRoomSetAlign(false)
    }
  }, [session, pageIndex, session.pageRevision])
  useEffect(() => () => { store.endRoomSetAlign(false) }, [store])
  useEffect(() => {
    const completion = store.takeRoomSetAlignCompletion(pageIndex)
    if (!completion) return
    const link = store.getPageRoomSetLink(pageIndex)
    if (session.view.page - 1 !== pageIndex
      || link?.id !== completion.setId
      || (link.dx ?? 0) !== completion.dx || (link.dy ?? 0) !== completion.dy
      || store.roomCapturePage !== null || store.roomEditTarget !== null
      || store.areaHoleTarget !== null || store.roomSetAlignPage !== null) return
    if (store.roomSetPickupChanges(pageIndex).length) {
      setRoomSetConfirmation({ pageIndex, setId: completion.setId })
    }
  }, [store, version, pageIndex, session.pageRevision])
  useEffect(() => {
    if (roomSetConfirmation && (!roomSetConfirmationCount
      || store.roomSetAlignPage !== null || store.roomCapturePage !== null
      || store.roomEditTarget !== null || store.areaHoleTarget !== null)) {
      setRoomSetConfirmation(null)
    }
  }, [roomSetConfirmation, roomSetConfirmationCount, store, version])
  const useRoomSet = (setId: string) => {
    try {
      store.useRoomSet(pageIndex, setId)
      setError('')
      if (store.roomSetPickupChanges(pageIndex).length) {
        setRoomSetConfirmation({ pageIndex, setId })
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }
  const selectPanelFixture = (id: string) => {
    setSelectedCategory(null)
    store.selectFixture(id)
    if (store.getCountFixture(id)?.link) {
      store.setRouteTemplate(null)
      setStatus('連動の項目は図面に拾いません（ほかの項目の拾いから計算します）')
    } else ui?.select()
  }
  const total = (id: string) => index.total(id)
  const format = (f: CountFixture, n: number) => quantityDecimals(f) === 0 ? String(n) : n.toFixed(2)
  const unit = (f: CountFixture) => (quantityDecimals(f) === 0 ? '' : ' ') + quantityUnit(f)
  const pageTotal = (id: string) => index.byPage(id).get(pageIndex) ?? 0
  const groups = useMemo(() => perfTime('FixturePanel.groupFixtures', () => groupFixtures(fixtures)), [fixtures])
  const categories = useMemo(() => groups.map(g => ({ ...g, items: g.items.filter(f => `${fixtureCode(f)} ${f.name}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) })).filter(g => g.items.length), [groups, search])
  const grouping = groupByBreakdown && hasBreakdown && breakdownOrder !== undefined
  const outlineGroups = useMemo<FixtureOutlineGroup[]>(() => grouping
    ? fixtureBreakdownGroups(fixtures, breakdownOrder!)
    : groups.map(group => ({
      key: group.category,
      category: group.category,
      categoryTarget: group.category,
      ancestors: [],
      items: group.items,
      directItems: group.items,
    })), [grouping, fixtures, breakdownOrder, groups])
  const panelGroups = useMemo(() => {
    const query = search.toLocaleLowerCase()
    const matches = (f: CountFixture) => `${fixtureCode(f)} ${f.name}`.toLocaleLowerCase().includes(query)
    return outlineGroups.map(group => ({
      ...group,
      visibleItems: group.items.filter(matches),
      visibleDirectItems: group.directItems.filter(matches),
    })).filter(group => group.visibleItems.length)
  }, [outlineGroups, search])
  useEffect(() => {
    ui?.setBusy?.(busy)
    return () => { ui?.setBusy?.(false) }
  }, [session, busy])
  const canEdit = store.fixturesReady && !session.editRestriction && !busy
  const canReorder = canEdit && search.length === 0
  const reorderTitle = search.length ? '検索中は並べ替えできません' : 'ドラッグして並べ替え'
  const selectedItems = grouping && selected?.breakdown
    ? fixtures.filter(f => sameBreakdownPosition(selected, f)
      && `${fixtureCode(f)} ${f.name}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
      .sort((a, b) => a.order - b.order)
    : (categories.find(g => g.category === selected?.category)?.items ?? [])
      .filter(f => !grouping || f.breakdown === undefined)
  const selectedIndex = selectedItems.findIndex(f => f.id === selected?.id)
  useEffect(() => {
    if (!revealFixtureId) return
    const row = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-fixture-id]') ?? [])
      .find(element => element.dataset.fixtureId === revealFixtureId)
    if (!row) return
    row.scrollIntoView({ block: 'nearest' })
    row.querySelector<HTMLButtonElement>('.fixture-row')?.focus({ preventScroll: true })
    setRevealFixtureId(null)
  }, [revealFixtureId, panelGroups, collapsed])

  const revealPanelFixture = (
    id: string,
    next: readonly CountFixture[],
    order = breakdownOrder,
  ) => {
    const fixture = next.find(item => item.id === id)
    if (fixture?.breakdown && order) {
      setBreakdownOrder(order)
      setGroupByBreakdown(true)
      const keys = breakdownHeadingRows(breakdownHeadingPath(fixture, order))
        .map(heading => JSON.stringify(['breakdown', heading.level, heading.groupKey]))
      setCollapsed(previous => {
        const expanded = new Set(previous)
        keys.forEach(key => expanded.delete(key))
        return expanded
      })
    }
    setSearch('')
    selectPanelFixture(id)
    setRevealFixtureId(id)
  }

  const removeSelectedFixture = () => {
    if (!canEdit || !selected) return
    const current = store.getCountFixtures()
    const fixture = current.find(item => item.id === selected.id)
    if (!fixture) return
    const { deleted, detached } = store.fixtureRemovalCounts(fixture.id)
    const dependentNames = store.linkDependents(fixture.id).map(item => item.name)
    const parts = [
      deleted ? `この項目の拾い ${deleted} 件を削除し` : '',
      detached ? `${detached} 件の経路からこの項目を外し` : '',
      dependentNames.length ? `連動項目${dependentNames.map(name => `「${name}」`).join('')}の元から外れ` : '',
    ].filter(Boolean)
    if (!window.confirm(parts.length ? `${parts.join('、')}ます。よろしいですか？` : `${fixture.name}を削除しますか？`)) return

    const visible = panelGroups
      .filter(group => !collapsed.has(group.key) && !group.ancestors.some(key => collapsed.has(key)))
      .flatMap(group => group.visibleDirectItems)
    const index = visible.findIndex(item => item.id === fixture.id)
    const neighbor = index >= 0 ? visible[index + 1] ?? visible[index - 1] : visible[0]
    store.setCountFixtures(current.filter(item => item.id !== fixture.id), [fixture.id])
    if (neighbor) {
      selectPanelFixture(neighbor.id)
      setRevealFixtureId(neighbor.id)
    } else {
      store.selectFixture(null)
      setSelectedCategory(null)
      listRef.current?.focus({ preventScroll: true })
    }
  }

  const step = (direction: -1 | 1) => {
    if (!selected || selectedIndex < 0) return
    const neighbor = selectedItems[selectedIndex + direction]
    if (!neighbor) return
    // Keep hidden search results while moving past the adjacent visible item.
    const next = grouping && selected.breakdown
      ? reorderLocatedFixture(fixtures, selected.id, neighbor.id, direction === -1 ? 'before' : 'after')
      : grouping || search.length
        ? moveFixture(fixtures, selected.id, direction === -1 ? { beforeId: neighbor.id } : { afterId: neighbor.id })
        : stepFixture(fixtures, selected.id, direction)
    if (next) store.setCountFixtures(next)
  }
  const ownDrag = (event: DragEvent) => Boolean(dragging.current && event.dataTransfer.types.includes(fixtureDragType(dragging.current.kind)))
  const startDrag = (event: DragEvent, kind: FixtureDragKind, id: string) => {
    if (!canReorder || (grouping && kind === 'category') || (!grouping && kind === 'heading')) {
      event.preventDefault(); return
    }
    if (kind === 'heading' && !outlineGroups.some(group =>
      group.groupKey === id && group.level !== undefined && group.level >= 1 && group.showHeading !== false,
    )) { event.preventDefault(); return }
    dragging.current = { kind, id }
    event.dataTransfer.setData(fixtureDragType(kind), id)
    event.dataTransfer.effectAllowed = 'move'
    setSampleHover(null); setDropTarget(null)
  }
  const endDrag = () => { dragging.current = null; setDropTarget(null) }
  const targetAt = (event: DragEvent<HTMLElement>, kind: FixtureDragKind, id: string) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const side = kind !== 'fixture' && dragging.current?.kind === 'fixture' ? 'inside' : event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    return { kind, id, side } as const
  }
  const dragOver = (event: DragEvent<HTMLElement>, kind: FixtureDragKind, id: string) => {
    if (!canReorder || !ownDrag(event)) return
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'
    const target = targetAt(event, kind, id)
    setDropTarget(previous => previous?.kind === target.kind && previous.id === target.id && previous.side === target.side ? previous : target)
  }
  const drop = (event: DragEvent<HTMLElement>, kind: FixtureDragKind, id: string) => {
    if (!canReorder || !ownDrag(event)) return
    event.preventDefault(); event.stopPropagation()
    const active = dragging.current!, target = targetAt(event, kind, id)
    const source = fixtures.find(f => f.id === active.id)
    if (grouping) {

      if (active.kind === 'heading') {
        const sourceHeading = outlineGroups.find(group =>
          group.groupKey === active.id && group.showHeading !== false,
        )
        const outlineTarget = kind === 'heading'
          ? { kind: 'heading' as const, key: id, side: target.side }
          : { kind: 'fixture' as const, id, side: target.side === 'before' ? 'before' as const : 'after' as const }
        const reason = headingOutlineDropError(fixtures, active.id, outlineTarget, breakdownOrder!)
        if (reason) {
          setStatus(reason)
        } else {
          const next = moveHeadingInOutline(fixtures, active.id, {
            kind: 'heading', key: id, side: target.side === 'before' ? 'before' : 'after',
          }, breakdownOrder!)
          if (next) {
            store.setCountFixtures(next)
            const moved = next.find(fixture => fixture.id === sourceHeading!.items[0].id)!
            const position = moved.breakdown!
            const path = [position.section, position.subject, position.middle, position.item]
              .slice(0, sourceHeading!.level!)
              .filter(Boolean).join(' › ')
            setStatus(`${sourceHeading!.category}を「${path}」へ移しました（Ctrl+Z で戻せます）`)
          }
        }
        endDrag()
        return
      }

      if (kind !== 'category') {
        const outlineTarget = kind === 'heading'
          ? { kind: 'heading' as const, key: id, side: 'inside' as const }
          : { kind: 'fixture' as const, id, side: target.side === 'before' ? 'before' as const : 'after' as const }
        const reason = active.kind === 'fixture'
          ? fixtureOutlineDropError(fixtures, active.id, outlineTarget, breakdownOrder!)
          : BREAKDOWN_REORDER_STATUS
        if (reason || !source) {
          setStatus(reason ?? '移す項目が見つかりません')
          endDrag()
          return
        }
        const next = moveFixtureInOutline(fixtures, source.id, outlineTarget, breakdownOrder!)
        if (next) {
          store.setCountFixtures(next)
          revealPanelFixture(source.id, next)
          const position = next.find(fixture => fixture.id === source.id)!.breakdown
          const samePosition = source.breakdown === undefined || position === undefined
            ? source.breakdown === position
            : quantityBreakdownRowKey(source.breakdown) === quantityBreakdownRowKey(position)
          const path = position
            ? [position.section, position.subject, position.middle, position.item].filter(Boolean).join(' › ')
            : '（内訳書の位置なし）'
          setStatus(samePosition
            ? '並び替えました（Ctrl+Z で戻せます）'
            : `${source.name}を「${path}」へ移しました（Ctrl+Z で戻せます）`)
        }
        endDrag()
        return
      }

      if (active.kind !== 'fixture' || !source || source.breakdown !== undefined) {
        setStatus(BREAKDOWN_REORDER_STATUS)
        endDrag()
        return
      }
    }
    const category = kind === 'category' ? id : fixtures.find(f => f.id === id)!.category
    let next: CountFixture[]
    if (active.kind === 'fixture') {
      next = moveFixture(fixtures, active.id, kind === 'category' ? { endOfCategory: category } : target.side === 'before' ? { beforeId: id } : { afterId: id })
    } else {
      const index = groups.findIndex(g => g.category === category)
      const before = groups[index + (target.side === 'after' ? 1 : 0)]?.category
      next = moveCategory(fixtures, active.id, before === undefined ? { end: true } : { beforeCategory: before })
    }
    const previous = groups.flatMap(g => g.items)
    if (next.some((f, i) => f.id !== previous[i]?.id || f.category !== previous[i]?.category)) {
      store.setCountFixtures(next)
      if (active.kind === 'fixture' && source?.category !== category) setStatus(`${source?.name}を分類「${category}」へ移しました（Ctrl+Z で戻せます）`)
      else setStatus('並び替えました（Ctrl+Z で戻せます）')
    }
    if (active.kind === 'fixture') selectPanelFixture(active.id)
    else setSelectedCategory(active.id)
    endDrag()
  }
  const dropClass = (kind: FixtureDragKind, id: string) => dropTarget?.kind === kind && dropTarget.id === id ? ` fixture-drop-${dropTarget.side}` : ''
  const nextOrder = fixtures.reduce((n, f) => Math.max(n, f.order + 1), 0)
  const saveFixture = (f: CountFixture) => {
    const editing = dialog?.editing === true
    store.setCountFixtures(editing ? fixtures.map(p => p.id === f.id ? f : p) : [...fixtures, f], [], editing ? [f.id] : [])
    if (!editing) relatedMemory.update({ originIds: [f.id], closed: false })
    store.selectFixture(f.id)
    if (!editing && !f.link) ui?.select()
    if (f.link) {
      store.setRouteTemplate(null)
      setStatus('連動の項目は図面に拾いません（ほかの項目の拾いから計算します）')
    }
    setDialog(null)
  }
  const addMany = (items: Array<FixturePreset | CountFixture>, selectAdded = false, options?: FixtureAppendOptions) => {
    try {
      const next = appendFixtures(fixtures, items, options)
      if (next.length !== fixtures.length) {
        const existingIds = new Set(fixtures.map(fixture => fixture.id))
        const addedIds = next.filter(fixture => !existingIds.has(fixture.id))
          .map(fixture => fixture.id)
        store.setCountFixtures(next)
        relatedMemory.update({ originIds: addedIds, closed: false })
        if (selectAdded) {
          const added = next.find(fixture => !existingIds.has(fixture.id))!
          selectPanelFixture(added.id)
          setStatus(`${next.length - fixtures.length}件を追加しました`)
        }
      }
      setError('')
    } catch (reason) { setError(String(reason)); if (selectAdded) throw reason }
  }
  const addStandardConditions = async () => {
    if (!canEdit || standardConditionsLoading.current) return
    standardConditionsLoading.current = true
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const [master, catalog] = await Promise.all([
        import('../core/quantityMaster'),
        import('../core/catalog'),
      ])
      if (!store.fixturesReady || session.editRestriction) return
      let changed = 0
      const next = store.getCountFixtures().map(fixture => {
        const conditions = [...(fixture.conditions ?? [])]
        const additions = [...new Set([
          ...master.standardConditionsForFixture(fixture),
          ...catalog.catalogConditionsForFixture(fixture),
        ])].filter(condition => !conditions.includes(condition))
          .slice(0, Math.max(0, 30 - conditions.length))
        if (!additions.length) return fixture
        changed++
        return { ...fixture, conditions: [...conditions, ...additions] }
      })
      if (changed) {
        store.setCountFixtures(next)
        setStatus(`${changed} 項目に施工条件の候補を入れました（Ctrl+Z で戻せます）`)
      } else setStatus('足す候補はありませんでした')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      standardConditionsLoading.current = false
      setBusy(false)
    }
  }
  const csv = async (value: string, name: string) => {
    const blob = new Blob([value], { type: 'text/csv;charset=utf-8' })
    if (window.showSaveFilePicker) { const handle = await window.showSaveFilePicker({ suggestedName: name }); const writable = await handle.createWritable(); await writable.write(blob); await writable.close() }
    else { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 0) }
  }
  const hoverCard = sampleHover
    && !(dialog || moveFixtureId || csvOpen || breakdownId || preset || sources
      || editingRoom || roomSetDialog || roomSetConfirmation)
    ? <FixtureHoverCard fixture={sampleHover.fixture} fixtures={fixtures}
      anchorRect={sampleHover.anchorRect} relations={relations} />





    : null
  return <section className={`fixture-panel${store.drawingHidesCounts() ? ' drawing-hides-counts' : ''}`} aria-label="数量拾い" data-testid="fixture-panel">
    <div className="fixture-panel-controls">
    <div className="fixture-panel-heading">
      <h2>数量拾い</h2>
      <div className="fixture-panel-tools">
        <button type="button" aria-label="集計表を開く" onClick={() => table?.open()}
          ref={button => button ? table?.bindPanel({ breakdown: setBreakdownId, csv: () => setCsvOpen(true) }) : undefined}>集計表</button>
        <button disabled={!store.fixturesReady || busy} onClick={() => setCsvOpen(true)}>数量をCSVに書き出す</button>
        {selected && !selected.link && quantityKind(selected) === 'count' && symbolSearch && <button type="button" aria-label="同じ記号を探す" disabled={!!session.editRestriction} onClick={() => symbolSearch.start(session, selected.id)}>同じ記号を探す</button>}
      </div>
    </div>
    {store.drawingHidesCounts() && <div className="fixture-drawing-filter-warning" role="status">
      <p>書き込みタブの絞り込み（{annotationFilterLabel(store.annotationFilter)}）で、図面に数量拾いの印を出していません。</p>
      <button type="button" onClick={() => store.setDrawingFollowsFilter(false)}>図面への反映をやめる</button>
    </div>}
    {!store.fixturesReady && <p role="status">数量拾いを読み込んでいます…</p>}
    <div className="fixture-count-summary" aria-live="polite">{selected ? <>
      <span className="fixture-summary-name">{quantityKind(selected) === 'count' ? <svg className="fixture-swatch" viewBox="-14 -14 28 28" aria-hidden="true"><CountMarker style={{ ...selected.style, size: 24, opacity: 1 }} showCode={false} /></svg> : <QuantitySwatch fixture={selected} />}<span title={`${fixtureCode(selected)} ${selected.name}`}>{fixtureCode(selected)} {selected.name}{'　'}</span></span>
      <span className="fixture-summary-totals"><span>表示中の図面（p.{session.view.page}）: <strong>{format(selected, pageTotal(selected.id))}</strong>{unit(selected)}</span>{' ／ '}<button disabled={!selected.link && total(selected.id) === 0} aria-label={`${fixtureCode(selected)} ${selected.name}の全図面の内訳`} onClick={() => setBreakdownId(selected.id)}>全図面: <strong>{format(selected, total(selected.id))}</strong>{unit(selected)}</button></span>
    </> : '数量拾いの一覧で項目を選んでください'}
      <div className="fixture-action-row">
      <button disabled={!canEdit || !selected} onClick={() => selected && setDialog({ editing: true, initial: structuredClone(selected) })}>編集</button>
      <button disabled={!canEdit || !selected || fixtures.length >= 1000} onClick={() => {
        if (!selected) return
        try {
          const initial = { ...structuredClone(selected), id: crypto.randomUUID(), name: selected.spec ? selected.name : `${selected.name.slice(0, 74)} のコピー`, order: nextOrder }
          if (quantityKind(selected) === 'count') {
            const proposed = nextCountStyle(fixtures)
            initial.style = { ...selected.style, shape: proposed.shape, fill: proposed.fill, color: proposed.color }
          } else {
            const proposed = nextQuantityLineStyle(fixtures)
            initial.style = { ...selected.style, color: proposed.color }; initial.line = proposed.line
          }
          setDialog({ editing: false, duplicate: true, initial: structuredClone(initial) }); setError('')
        } catch (reason) { setError(String(reason)) }
      }}>複製</button>
      <button disabled={!canEdit || !selected} onClick={removeSelectedFixture}>削除</button>
      {selected?.breakdown && <button type="button" disabled={!canEdit}
        onClick={() => { setMoveFixtureId(selected.id); setSampleHover(null) }}>位置を移す…</button>}
      <button disabled={!canEdit || !selected || selectedIndex <= 0} title={selectedIndex === 0 ? grouping ? selected?.breakdown ? '同じ細目の先頭です' : '分類の先頭です' : '分類の先頭です。分類ごと動かすときは、分類の見出しをドラッグします' : undefined} onClick={() => step(-1)}>上へ</button>
      <button disabled={!canEdit || !selected || selectedIndex < 0 || selectedIndex === selectedItems.length - 1} title={selectedIndex >= 0 && selectedIndex === selectedItems.length - 1 ? grouping ? selected?.breakdown ? '同じ細目の末尾です' : '分類の末尾です' : '分類の末尾です。分類ごと動かすときは、分類の見出しをドラッグします' : undefined} onClick={() => step(1)}>下へ</button>
      </div>
    </div>

    {store.visibleCountTotal(pageIndex) > 1000 && <p role="status">印が多いため略号の表示を省略しています</p>}
    <div className="fixture-actions">
      <div className="fixture-action-row">
      <button disabled={!canEdit || fixtures.length >= 1000} onClick={() => setDialog({ editing: false, initial: structuredClone({ id: crypto.randomUUID(), name: '', code: '', category: selected?.category ?? groups[0]?.category ?? 'その他', style: nextCountStyle(fixtures), order: nextOrder }) })}>項目を追加</button>
      <button disabled={!canEdit} onClick={() => { setPresetQuery(''); setPreset(true) }}>標準マスタから追加</button>
      <button disabled={!canEdit} onClick={() => {
        setBusy(true); setError('')
        void Promise.all((ui?.documents ?? []).filter(d => d !== session).map(async d => ({ name: d.name, fixtures: d.annotationStore.fixturesReady ? d.annotationStore.getCountFixtures() : await pool.getCountFixtures(d.docId) })))
          .then(list => setSources(list.filter(s => s.fixtures.length))).catch(e => setError(String(e))).finally(() => setBusy(false))
      }}>他のPDFから読み込む</button>
      </div>
    </div>
    {(store.recentFixtureIds.some(id => fixtures.some(f => f.id === id)) || routeSets.length > 0) && <div className="fixture-quick-lists">
      <RecentFixtures fixtures={fixtures} ids={store.recentFixtureIds}
        relations={relations} onSelect={selectPanelFixture} />
      {routeSets.length > 0 && <section className="fixture-route-sets" aria-label="よく使う構成"><h3>よく使う構成</h3>{routeSets.slice(0, 5).map(set => <button type="button" key={set.id} disabled={!canEdit} title={routeSetSummary(set)} onClick={() => {
        try {
          const result = resolveRouteSet(set, store.getCountFixtures()), [main, ...extra] = result.items
          if (result.newFixtures.length) store.setCountFixtures([...store.getCountFixtures(), ...result.newFixtures])
          selectPanelFixture(main.itemId)
          if (!store.getCountFixture(main.itemId)?.link) {
            store.setRouteTemplate({
              ...main,
              extra: extra.filter(item => !store.getCountFixture(item.itemId)?.link),
              name: set.name,
            })
          }
          setError('')
        } catch (reason) { setError(String(reason)) }
      }}>{set.name}</button>)}</section>}
    </div>}
    <fieldset className="current-location"><legend>現在の場所</legend>
      <label>階<LocationInput value={store.currentFloor} label="現在の階" list="pickup-floors" commit={v => store.setCurrentLocation('floor', v)} /></label>
      {inferredFloor && !store.currentFloor && <small>（図面名から: {inferredFloor}）</small>}
      <label>部屋<LocationInput value={store.currentRoom} label="現在の部屋" list="pickup-rooms" commit={v => store.setCurrentLocation('room', v)} /></label>
      <datalist id="pickup-floors">{locations.floors.map(f => <option key={f} value={f} />)}</datalist>
      <datalist id="pickup-rooms">{locations.rooms.map(r => <option key={r} value={r} />)}</datalist>
      <button type="button" disabled={!canEdit || pageRoomRegions.length >= 200 && (!roomSet || roomSet.regions.length >= 200)}
        onClick={() => { store.startRoomCapture(pageIndex); setError('') }}>部屋の範囲を囲む</button>
    </fieldset>
    <section className="room-set-controls" aria-label="部屋の組">
      {!roomSet && <>
        {suggestedRoomSets.map(set => <button type="button" key={set.id} disabled={!canEdit}
          onClick={() => useRoomSet(set.id)}>部屋の組「{set.name}」を使う（{set.regions.length}室）</button>)}
        {roomSets.length > 0 && <label>部屋の組を使う<select aria-label="部屋の組を使う" value="" disabled={!canEdit}
          onChange={event => {
            if (event.currentTarget.value) useRoomSet(event.currentTarget.value)
          }}>
          <option value="">選んでください</option>
          {roomSets.map(set => <option key={set.id} value={set.id}>{set.name}（{set.regions.length}室）</option>)}
        </select></label>}
        {pageRoomRegions.length > 0 && <button type="button" disabled={!canEdit || roomSets.length >= 100}
          onClick={() => setRoomSetDialog({ pageIndex })}>この図面の範囲を部屋の組にする</button>}
      </>}
      {roomSet && <>
        <p>部屋の組「{roomSet.name}」を使っています（{roomSetPageCount} 図面で共通）</p>
        {(roomSetDx !== 0 || roomSetDy !== 0) && <small>
          （位置を合わせ済み：{roomSetDx < 0 ? '左' : '右'}へ {Math.abs(roomSetDx).toFixed(1)}pt・{roomSetDy < 0 ? '上' : '下'}へ {Math.abs(roomSetDy).toFixed(1)}pt）
        </small>}
        {!roomSet.anchor && <small>支点：未設定</small>}
        <div>
          <button type="button" disabled={!canEdit} aria-pressed={aligningRoomSet} onClick={() => {
            setRoomSetConfirmation(null)
            if (aligningRoomSet) store.endRoomSetAlign()
            else store.startRoomSetAlign(pageIndex)
            setError('')
          }}>{aligningRoomSet ? '合わせ終える' : '位置を合わせる'}</button>
          {(roomSetDx !== 0 || roomSetDy !== 0) && <button type="button" disabled={!canEdit} onClick={() => {
            store.setRoomSetOffset(pageIndex, 0, 0)
            setError('')
          }}>位置を戻す</button>}
          <button type="button" disabled={!canEdit} onClick={() => {
            store.useRoomSet(pageIndex, null)
            setRoomSetConfirmation(null)
          }}>組を外す</button>
          <button type="button" disabled={!canEdit}
            onClick={() => setRoomSetDialog({ pageIndex, initial: structuredClone(roomSet) })}>組の名前を変える</button>
          <button type="button" disabled={!canEdit} onClick={() => {
            if (window.confirm(`部屋の組「${roomSet.name}」を削除します。使っている ${roomSetPageCount} 図面から範囲が消えます（Ctrl+Z で戻せます）`)) {
              store.deleteRoomSet(roomSet.id)
              setRoomSetConfirmation(null)
            }
          }}>組を削除</button>
        </div>
      </>}
    </section>
    {roomRegions.length > 0 && <ul className="room-region-list" aria-label="このページの部屋の範囲">
      {roomRegions.map(({ region, setId }) => <li key={region.id}>
        <span>{[region.floor, region.name].filter(Boolean).join(' ')}{setId ? '（組）' : ''}</span>
        <button type="button" disabled={!canEdit}
          aria-pressed={store.roomEditTarget?.pageIndex === pageIndex && store.roomEditTarget.id === region.id}
          onClick={() => {
            if (store.roomEditTarget?.pageIndex === pageIndex && store.roomEditTarget.id === region.id) store.endRoomEdit()
            else store.startRoomEdit(pageIndex, region.id)
            setError('')
          }}>{store.roomEditTarget?.pageIndex === pageIndex && store.roomEditTarget.id === region.id ? '直し終える' : '範囲を直す'}</button>
        <button type="button" disabled={!canEdit} onClick={() => setEditingRoom({ pageIndex, region })}>名前を変える</button>
        <button type="button" disabled={!canEdit} onClick={() => {
          store.removeRoomRegion(pageIndex, region.id)
        }}>削除</button>
      </li>)}
    </ul>}
    {editingRoom && <RoomRegionDialog store={store} initial={editingRoom.region} complete={region => {
      if (region) {
        try {
          const current = store.effectiveRoomRegions(editingRoom.pageIndex)
            .find(entry => entry.region.id === region.id)?.region
          if (current) store.updateRoomRegion(editingRoom.pageIndex, { ...region, points: current.points })
          setError('')
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason))
          return
        }
      }
      setEditingRoom(null)
    }} />}
    {roomSetDialog && <RoomSetDialog initial={roomSetDialog.initial}
      name={inferredFloor || `部屋の組${roomSets.length + 1}`} floor={inferredFloor}
      complete={value => {
        if (!value) { setRoomSetDialog(null); return }
        try {
          if (roomSetDialog.initial) {
            if (!store.getRoomSets().some(set => set.id === roomSetDialog.initial!.id)) {
              return '部屋の組が見つかりません。'
            }
            store.renameRoomSet(roomSetDialog.initial.id, value.name, value.floor)
          } else {
            store.createRoomSetFromPage(roomSetDialog.pageIndex, value.name, value.floor)
          }
          setRoomSetDialog(null)
          setError('')
        } catch (reason) {
          return reason instanceof Error ? reason.message : String(reason)
        }
      }} />}
    {roomSetConfirmation && roomSetConfirmationCount > 0 && <RoomSetPickupDialog count={roomSetConfirmationCount}
      complete={apply => {
        if (apply) {
          store.applyRoomSetPickupLocations(roomSetConfirmation.pageIndex, roomSetConfirmation.setId)
        }
        setRoomSetConfirmation(null)
      }} />}
    {(session.drawingScanning || drawingStatus.includes('失敗')) && <p className="fixture-drawing-status" aria-live="polite" data-testid="drawing-scan-status" title={drawingStatus}>{drawingStatus}</p>}
    <details className="fixture-panel-settings" open={settingsOpen} onToggle={event => {
      const open = event.currentTarget.open
      setSettingsOpen(open)
      try { localStorage.setItem('karu-pdf:fixture-panel-settings-open', String(open)) } catch { /* Optional preference storage. */ }
    }}>
      <summary>表示の設定・図面番号</summary>
      <button type="button" disabled={!canEdit} onClick={() => void addStandardConditions()}>
        すべての項目に標準の施工条件の候補を入れる
      </button>
      <p className="fixture-drawing-status" aria-live="polite" data-testid={session.drawingScanning || drawingStatus.includes('失敗') ? 'drawing-scan-settings-status' : 'drawing-scan-status'} title={drawingStatus}>{drawingStatus}</p>
      <button type="button" disabled={session.drawingScanning} onClick={() => void session.scanDrawingInfos(pool, true)}>図面番号・図面名称を読み直す</button>
      <label><input type="checkbox" checked={store.onlySelectedFixture} onChange={e => store.setOnlySelectedFixture(e.currentTarget.checked)} />選択中の項目だけ表示</label>
      <label><input type="checkbox" checked={store.showQuantityValues} onChange={e => store.setShowQuantityValues(e.currentTarget.checked)} />図面に長さ・面積・体積の数値を表示</label>
      <label><input type="checkbox" checked={store.showRoomRegions} onChange={e => store.setShowRoomRegions(e.currentTarget.checked)} />部屋の範囲を表示</label>
      <label title="計測・数量拾い・縮尺のなぞりで、既存の頂点に吸い付く（Alt で一時解除）"><input type="checkbox" checked={snap?.enabled ?? false} onChange={() => snap?.toggle()} />スナップ（既存の頂点に合わせる）</label>
      <label><input type="checkbox" checked={snap?.drawingEndpoints ?? true} onChange={() => snap?.toggleDrawingEndpoints()} />図面の線の端点にも合わせる</label>
      <button onClick={() => store.showAllFixtures()}>すべて表示</button>
    </details>
    <label>名称・略号で検索<input type="search" value={search} onChange={e => setSearch(e.currentTarget.value)} /></label>
    {hasBreakdown && <div className="fixture-outline-controls"><label><input type="checkbox" aria-label="内訳書の構成で表示" style={{ width: 'auto', minWidth: 0 }} checked={groupByBreakdown}
      onChange={event => setGroupByBreakdown(event.currentTarget.checked)} />内訳書の構成で表示</label>
      {grouping && <button type="button" disabled={!canReorder} title={search.length ? '検索中は並べ替えできません' : undefined}
        onClick={() => {
          if (!canReorder || !breakdownOrder) return
          store.setCountFixtures(sortByBreakdownMaster(fixtures, breakdownOrder))
          endDrag()
          setStatus('内訳書の順に並べ直しました（Ctrl+Z で戻せます）')
        }}>内訳書の順に並べ直す</button>}
    </div>}
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{error}</p>}
    </div>
    <div className="fixture-groups" ref={listRef} tabIndex={0} role="region" aria-label="数量拾いの項目一覧"
      data-grouping={grouping ? 'breakdown' : 'category'}
      onKeyDownCapture={event => {
        if (event.key !== 'Delete' || !event.currentTarget.contains(document.activeElement)) return
        // A Delete originating in the list must not reach the drawing's Delete handler.
        event.stopPropagation()
        const target = event.target
        if (!(target instanceof HTMLElement)
          || target.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]')) return
        event.preventDefault()
        if (!canEdit || !selected || event.repeat
          || dialog || preset || sources || csvOpen || breakdownId || moveFixtureId
          || editingRoom || roomSetDialog || roomSetConfirmation
          || document.querySelector('[role="dialog"]:not([hidden]), dialog[open], [aria-modal="true"]:not([hidden])')) return
        removeSelectedFixture()
      }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null) }}
      onScroll={() => setSampleHover(null)}>
      <div className="fixture-list-heading"><span>表示</span><span>印</span><span>見本</span><span>略号</span><span>名称</span><span>この図面</span><span>全図面</span></div>
      {panelGroups.map(({ key, category, level, groupKey, categoryTarget, ancestors, items: allItems, visibleItems: list, visibleDirectItems: directItems, showHeading }) => ancestors.some(ancestor => collapsed.has(ancestor)) ? null : <section key={key}>
      {showHeading !== false && <div className={`fixture-category${categoryTarget !== undefined && selectedCategory === categoryTarget ? ' selected' : ''}${grouping && groupKey !== undefined ? dropClass('heading', groupKey) : categoryTarget !== undefined ? dropClass('category', categoryTarget) : ''}`} data-level={level} data-breakdown-heading={groupKey}
        onDragOver={grouping && groupKey !== undefined
          ? event => dragOver(event, 'heading', groupKey)
          : categoryTarget === undefined ? undefined : event => dragOver(event, 'category', categoryTarget)}
        onDrop={grouping && groupKey !== undefined
          ? event => drop(event, 'heading', groupKey)
          : categoryTarget === undefined ? undefined : event => drop(event, 'category', categoryTarget)}>
        <button className={grouping && groupKey !== undefined && level !== undefined && level >= 1 ? 'fixture-outline-heading' : undefined}
          {...(grouping ? groupKey !== undefined && level !== undefined && level >= 1 ? {
            draggable: canReorder,
            title: reorderTitle,
            onDragStart: (event: DragEvent<HTMLButtonElement>) => startDrag(event, 'heading', groupKey),
            onDragEnd: endDrag,
          } : {} : {
            draggable: canReorder,
            title: reorderTitle,
            onDragStart: (event: DragEvent<HTMLButtonElement>) => startDrag(event, 'category', categoryTarget!),
            onDragEnd: endDrag,
          })} aria-expanded={!collapsed.has(key)} onClick={() => {
          if (categoryTarget !== undefined) setSelectedCategory(categoryTarget)
          setCollapsed(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next })
        }}>{category}（{list.length}）</button>
        <button aria-label={`${category}の表示切替`} aria-pressed={(grouping ? allItems : list).every(f => store.isFixtureVisible(f.id))}
          onClick={() => store.setFixtureVisible(allItems.map(f => f.id), !(grouping ? allItems : list).every(f => store.isFixtureVisible(f.id)))}>
          <Eye visible={(grouping ? allItems : list).every(f => store.isFixtureVisible(f.id))} />
        </button>
      </div>}
      {!collapsed.has(key) && directItems.length > 0 && <ul>{directItems.map(f => <li key={f.id} className={(f.id === selected?.id ? 'selected' : '') + dropClass('fixture', f.id)} data-fixture-id={f.id} draggable={canReorder} title={reorderTitle}
        onDragStart={event => startDrag(event, 'fixture', f.id)} onDragEnd={endDrag} onDragOver={event => dragOver(event, 'fixture', f.id)} onDrop={event => drop(event, 'fixture', f.id)}
        onClick={event => {
          if (!(event.target as HTMLElement).closest('button')) {
            selectPanelFixture(f.id)
            event.currentTarget.querySelector<HTMLButtonElement>('.fixture-row')?.focus({ preventScroll: true })
          }
        }}
        onMouseEnter={event => {
          if (dragging.current) return
          const rect = event.currentTarget.getBoundingClientRect()
          setSampleHover({ fixture: f, anchorRect: { right: rect.right, top: rect.top } })
        }} onMouseLeave={() => setSampleHover(null)}>
        <span className="fixture-grip" aria-hidden="true">⠿</span>
        <button aria-label={`${fixtureCode(f)} ${f.name}の表示切替`} aria-pressed={store.isFixtureVisible(f.id)} onClick={() => store.setFixtureVisible([f.id], !store.isFixtureVisible(f.id))}><Eye visible={store.isFixtureVisible(f.id)} /></button>
        <button className="fixture-row" aria-label={`${fixtureCode(f)} ${f.name}`.trim()} aria-pressed={f.id === selected?.id} onClick={() => selectPanelFixture(f.id)}>
          {quantityKind(f) === 'count' ? <svg className="fixture-swatch" viewBox="-14 -14 28 28" aria-hidden="true"><CountMarker style={{ ...f.style, size: 24, opacity: 1 }} showCode={false} /></svg> : <QuantitySwatch fixture={f} />}
          <span className="fixture-sample-cell">{quantityKind(f) === 'count' && f.sample && <img className="fixture-sample-thumbnail" src={`data:image/png;base64,${f.sample.png}`} alt={`${f.name}の見本`} draggable={false} />}</span>
          <span className="fixture-row-code" title={fixtureCode(f)}>
          <span className="fixture-row-code-text">{f.code}</span>
          {f.link && <span className="fixture-row-code-badges">
            {missingLinkSources.has(f.id)
              ? <span className="fixture-link-badge fixture-link-missing"
                title="元になる項目がありません。項目を開くと案内が出ます。"
                style={{ color: '#b42318', backgroundColor: '#fff1f0' }}>元なし</span>
              : <span className="fixture-link-badge" title={index.linkResult(f.id)?.error}>
                {index.linkResult(f.id)?.error ? '連動の誤り' : '連動'}
              </span>}
            {index.linkResult(f.id)?.overridden && <span className="fixture-link-badge fixture-link-override">上書き</span>}
          </span>}
          </span><span className="fixture-row-name">{f.name}{f.spec && <span className="fixture-row-spec"> {f.spec}</span>}{(quantityKind(f) !== 'count' || f.convert || f.link?.kind === 'mass' || f.link?.kind === 'carry' || f.link?.kind === 'rc' || f.link?.kind === 'shape' || f.link?.kind === 'crossing' || f.link?.kind === 'steel') && <span className="fixture-row-unit">{quantityUnit(f)}</span>}{((f.link && !missingLinkSources.has(f.id) && !!relations.sources.get(f.id)?.length)
            || !!relations.dependents.get(f.id)?.length)
            && <span className="fixture-row-relation">
              {f.link && !missingLinkSources.has(f.id) && !!relations.sources.get(f.id)?.length
                && <span className="fixture-link-source-text"
                  title={linkSourceTitle(relations.sources.get(f.id)!)}>
                  {linkSourceText(relations.sources.get(f.id)!)}
                </span>}
              {!!relations.dependents.get(f.id)?.length
                && <span className="fixture-link-dependent-count"
                  title={linkDependentTitle(relations.dependents.get(f.id)!)}>
                  {'→ '}{relations.dependents.get(f.id)!.length}件
                </span>}
            </span>}</span><span className="fixture-row-count" title={`表示中の図面: ${format(f, pageTotal(f.id))}${unit(f)}`}>{format(f, pageTotal(f.id))}</span>
        </button>
        <button className="fixture-total-button fixture-row-count" disabled={!f.link && total(f.id) === 0} aria-label={`${fixtureCode(f)} ${f.name}の全図面の内訳`} title={`全図面: ${format(f, total(f.id))}${unit(f)}`} onClick={() => setBreakdownId(f.id)}>{format(f, total(f.id))}</button>
      </li>)}</ul>}
    </section>)}</div>
    {breakdownId && fixtures.find(f => f.id === breakdownId) && <QuantityBreakdown key={breakdownId} fixture={fixtures.find(f => f.id === breakdownId)!} index={index} session={session} pool={pool} onClose={closeBreakdown} />}
    {hoverCard}
    <Suspense fallback={<p>画面を開いています…</p>}>
      {csvOpen && <QuantityCsvExportDialog index={index} fixtures={fixtures} pdfName={session.name} pageIndex={pageIndex} onExport={csv} onClose={() => setCsvOpen(false)} />}
      {moveFixtureId && fixtures.find(fixture => fixture.id === moveFixtureId)?.breakdown && <BreakdownMoveDialog
        key={moveFixtureId}
        fixture={fixtures.find(fixture => fixture.id === moveFixtureId)!}
        canEdit={canEdit}
        onMove={(position, allAtPosition, order) => {
          if (!store.fixturesReady || session.editRestriction || busy) return '現在は編集できません'
          const current = store.getCountFixtures()
          const source = current.find(fixture => fixture.id === moveFixtureId)
          if (!source?.breakdown) return '移す項目が見つかりません'
          const reason = fixtureOutlineMoveError(source, position, order)
          if (reason) return reason
          const next = moveFixturesToOutlinePosition(current, source.id, position, order, allAtPosition)
          if (!next) return '移す先が今の位置と同じです'
          const count = allAtPosition
            ? current.filter(fixture => sameBreakdownPosition(source, fixture)).length : 1
          store.setCountFixtures(next)
          setMoveFixtureId(null)
          revealPanelFixture(source.id, next, order)
          setStatus(`${count}件を「${[position.section, position.subject, position.middle, position.item].filter(Boolean).join(' › ')}」へ移しました（Ctrl+Z で戻せます）`)
          return undefined
        }}
        onClose={() => setMoveFixtureId(null)}
      />}
      {dialog && <FixtureDialog key={dialog.initial.id}
        initial={dialog.initial} fixtures={fixtures} editing={dialog.editing}
        duplicate={dialog.duplicate} initialSection={dialog.initialSection}
        hasMarks={dialog.editing && store.fixtureMarkCount(dialog.initial.id) > 0}
        dimensionMarkCounts={draft => store.fixtureDimensionMarks(draft)}
        {...previews}
        previewCrossingBarrierCount={draft => {
          if (draft.link?.kind !== 'crossing') return 0
          const current = store.getCountFixtures()
          const next = current.some(f => f.id === draft.id)
            ? current.map(f => f.id === draft.id ? draft : f) : [...current, draft]
          // 平面の計算がオフでも、選んだ区画の拾いの合計を表示する。
          const fixture: CountFixture = {
            ...draft,
            link: {
              ...draft.link,
              crossing: { ...draft.link.crossing, planCrossings: true },
            },
          }
          const barriers = fixtureCrossingBarriers(next, fixture)
          const ids = new Set(barriers.map(barrier => barrier.id))
          if (!ids.size) return 0
          const metrics = collectShapeMetrics(
            store.quantityAnnotations(), next, ids, ids,
          )
          const pickups = new Set<string>()
          for (const barrier of barriers) {
            for (const metric of metrics.get(barrier.id) ?? []) {
              if (metric.pathPoints?.length) {
                pickups.add(JSON.stringify([metric.pageIndex, metric.annotationId]))
              }
            }
          }
          return pickups.size
        }}
        onOpenFixture={(id, section) => {
          if (!canEdit) return
          const fixture = store.getCountFixture(id)
          if (!fixture || fixture.link) return
          setDialog({
            initial: structuredClone(fixture), editing: true, initialSection: section,
          })
        }}
        onSave={saveFixture} onClose={() => setDialog(null)} />}
      {preset && <FixturePresetDialog initialQuery={presetQuery} fixtures={fixtures} onAdd={(items, options) => addMany(items, true, options)} onClose={() => setPreset(false)} />}
      {sources && <FixturePresetDialog sources={sources} onAdd={items => addMany(items)} onClose={() => setSources(null)} />}
    </Suspense>
  </section>
}
function Eye({ visible }: { visible: boolean }) { return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12Q12 1 22 12Q12 23 2 12Z" fill="none" stroke="currentColor" /><circle cx="12" cy="12" r="3" fill="currentColor" />{!visible && <path d="M3 3L21 21" stroke="currentColor" strokeWidth="2" />}</svg> }
