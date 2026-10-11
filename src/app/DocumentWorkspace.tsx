import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { QuantityTableContext } from './QuantityBreakdown'
const QuantityTable = lazy(() => import('./QuantityTable'))
import { SplitView, type SplitController, type SplitWorkspaceProps } from './SplitView'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import { RenderScheduler } from '../client/RenderScheduler'
import type { EditorTool } from '../editor/AnnotationLayer'
import { CLEAR_EDITOR_SELECTION } from '../editor/interaction'
import type { FormatDefaults } from '../editor/formatDefaults'
import { DebugPanel } from '../perf/DebugPanel'
import { BitmapCache } from '../viewer/BitmapCache'
import { Viewer, type ViewerHandle } from '../viewer/Viewer'
import type { DocumentSession, SidePanelTab } from './documentModel'
import { FormatPanel } from './FormatPanel'
import PickupBar from './PickupBar'
import { SidePanel } from './SidePanel'
import type { SearchHighlightState } from './SearchPanel'
import { OrganizeView, type ExtractOptions, type OrganizeSourceInfo } from '../organize/OrganizeView'
import type { OrganizeDraft } from '../organize/OrganizeDraft'
import type { PageCard } from '../organize/OrganizeDraft'
import type { OrganizeSplitMode } from '../organize/organizeUtils'

export interface OrganizeWorkspaceState {
  draft: OrganizeDraft
  sources: ReadonlyMap<string, OrganizeSourceInfo>
  busy: boolean
  onLoadFile(file: File): Promise<OrganizeSourceInfo>
  onImageDrop(files: File[]): void
  onPrepareSources(docIds: string[]): void
  onDiscardSources(docIds: string[]): void
  onCopy(cards: readonly PageCard[]): void
  onPaste(beforeIndex: number): PageCard[]
  onApply(): void
  onCancel(): void
  onExtract(cardIds: string[], options: ExtractOptions): void
  onSplit(mode: OrganizeSplitMode): void
}

interface Props {
  onNavigate(): void
  split: SplitWorkspaceProps | null
  session: DocumentSession
  pool: PdfWorkerPool
  viewerRef: RefObject<ViewerHandle | null>
  tool: EditorTool
  formatDefaults: FormatDefaults
  showThumbnails: boolean
  showFormat: boolean
  activeSideTab: SidePanelTab
  focusSearchVersion: number
  debug: boolean
  onToolChange(tool: EditorTool): void
  onFormatDefaultsChange(value: FormatDefaults): void
  onSideTabChange(tab: SidePanelTab): void
  onPageChange(page: number): void
  onZoomChange(zoom: number): void
  onFirstBitmap(): void
  onFirstSharp(): void
  onRenderError(error: unknown): void
  onStatus(message: string): void
  organize: OrganizeWorkspaceState | null
}

const FORMAT_WIDTH_KEY = 'karu-pdf:format-panel-width'
const FORMAT_MIN_WIDTH = 210
const FORMAT_MAX_WIDTH = 560
const FORMAT_VIEWER_WIDTH = 500

function formatPanelMaximumWidth(): number {
  return Math.max(FORMAT_MIN_WIDTH, Math.min(FORMAT_MAX_WIDTH, Math.floor(window.innerWidth * .45)))
}

function initialFormatPanelWidth(): number {
  try {
    const stored = localStorage.getItem(FORMAT_WIDTH_KEY)
    if (stored === null || !stored.trim()) return FORMAT_MIN_WIDTH
    const value = Number(stored)
    if (!Number.isFinite(value) || value < FORMAT_MIN_WIDTH || value > FORMAT_MAX_WIDTH) return FORMAT_MIN_WIDTH
    return Math.min(Math.round(value), formatPanelMaximumWidth())
  } catch { return FORMAT_MIN_WIDTH }
}

export function DocumentWorkspace(props: Props) {
  const workspaceRef = useRef<HTMLDivElement>(null)
  const [formatWidth, setFormatWidth] = useState(initialFormatPanelWidth)
  const [formatMaximum, setFormatMaximum] = useState(formatPanelMaximumWidth)
  const formatWidthRef = useRef(formatWidth)
  // The width the user chose; a narrow window only clamps it, so it comes back when the window widens.
  const formatPreferredRef = useRef(formatWidth)
  const formatDragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
  const formatWidthLimit = useCallback(() => {
    const maximum = formatPanelMaximumWidth()
    const workspace = workspaceRef.current
    if (!workspace) return maximum
    const side = workspace.querySelector<HTMLElement>(':scope > .side-panel')
    const available = Math.floor(workspace.clientWidth - (side?.getBoundingClientRect().width ?? 0) - FORMAT_VIEWER_WIDTH)
    return Math.max(FORMAT_MIN_WIDTH, Math.min(maximum, available))
  }, [])
  const resizeFormatPanel = useCallback((value: number) => {
    const maximum = formatWidthLimit()
    const next = Math.max(FORMAT_MIN_WIDTH, Math.min(maximum, Math.round(value)))
    formatWidthRef.current = next
    setFormatWidth(next)
    setFormatMaximum(maximum)
  }, [formatWidthLimit])
  const saveFormatPanelWidth = useCallback(() => {
    formatPreferredRef.current = formatWidthRef.current
    try { localStorage.setItem(FORMAT_WIDTH_KEY, String(formatWidthRef.current)) } catch { /* 表示は続ける。 */ }
  }, [])
  const finishFormatPanelDrag = useCallback(() => {
    if (!formatDragRef.current) return
    formatDragRef.current = null
    saveFormatPanelWidth()
  }, [saveFormatPanelWidth])

  useEffect(() => {
    const resize = () => resizeFormatPanel(formatPreferredRef.current)
    resize()
    window.addEventListener('resize', resize)
    const observer = new ResizeObserver(resize)
    const workspace = workspaceRef.current
    if (workspace) {
      observer.observe(workspace)
      const side = workspace.querySelector<HTMLElement>(':scope > .side-panel')
      if (side) observer.observe(side)
    }
    return () => {
      window.removeEventListener('resize', resize)
      observer.disconnect()
    }
  }, [resizeFormatPanel, props.showThumbnails, props.organize])

  const [tableOpen, setTableOpen] = useState(false), [tableHeight, setTableHeight] = useState(40)
  const panelActions = useRef<{ breakdown(id: string): void; csv(): void } | null>(null)
  const pendingPanelAction = useRef<((actions: NonNullable<typeof panelActions.current>) => void) | null>(null)
  const closeTable = useCallback(() => {
    setTableOpen(false)
    document.querySelector<HTMLButtonElement>('[aria-label="集計表を開く"]')?.focus()
  }, [])
  const tableControls = useMemo(() => ({
    open: () => {
      try {
        const stored = localStorage.getItem('karu-pdf:quantity-table-height'), n = stored === null ? 40 : Number(stored)
        setTableHeight(Number.isFinite(n) ? Math.max(20, Math.min(70, n)) : 40)
      } catch { setTableHeight(40) }
      setTableOpen(true)
    },
    showBreakdown: (id: string) => {
      if (panelActions.current) panelActions.current.breakdown(id)
      else pendingPanelAction.current = actions => actions.breakdown(id)
    },
    showCsv: () => {
      if (panelActions.current) panelActions.current.csv()
      else pendingPanelAction.current = actions => actions.csv()
    },
    bindPanel: (actions: NonNullable<typeof panelActions.current>) => {
      panelActions.current = actions
      const pending = pendingPanelAction.current; pendingPanelAction.current = null; pending?.(actions)
      return () => { if (panelActions.current === actions) panelActions.current = null }
    },
  }), [])
  const viewerSlotRef = useRef<HTMLDivElement>(null)
  const splitControllerRef = useRef<SplitController>(null)
  const renderErrorRef = useRef(props.onRenderError)
  renderErrorRef.current = props.onRenderError
  const [searchHighlights, setSearchHighlights] = useState<SearchHighlightState>({ matches: [], activeIndex: -1 })
  const scheduler = useMemo(() => new RenderScheduler(
    props.pool,
    new BitmapCache(),
    new BitmapCache(64 * 1024 * 1024),
    '',
    (error, _params, priority) => { if (priority === 0) renderErrorRef.current(error) },
  ), [props.pool, props.session.docId, props.session.pageRevision])
  const initialView = useMemo(() => {
    const value = props.session.fitOnFirstView
      ? null
      : props.session.restorePageOnFirstView
        ? { page: props.session.view.page, zoom: props.session.view.zoom }
        : { ...props.session.view }
    props.session.fitOnFirstView = false
    props.session.restorePageOnFirstView = false
    return value
  }, [props.session])
  const selectedIds = props.session.annotationStore.selectedIds()
  const selectedId = props.session.annotationStore.primarySelection()
  const selected = selectedIds.length === 1 && selectedId
    ? props.session.annotationStore.get(selectedId) ?? null
    : null

  useEffect(() => () => {
    scheduler.destroy()
    scheduler.cache.clear()
    scheduler.warmCache.clear()
  }, [scheduler])

  useEffect(() => {
    const onClear = (event: Event) => {
      if ((event.target as HTMLElement)?.dataset.docId === props.session.docId) setSearchHighlights({ matches: [], activeIndex: -1 })
    }
    window.addEventListener(CLEAR_EDITOR_SELECTION, onClear)
    return () => window.removeEventListener(CLEAR_EDITOR_SELECTION, onClear)
  }, [props.session.docId])

  if (props.organize) return (
    <div className="document-workspace organize-mode">
      <OrganizeView
        docId={props.session.docId}
        draft={props.organize.draft}
        pageSizes={props.session.pageSizes}
        sources={props.organize.sources}
        scheduler={scheduler}
        annotationStore={props.session.annotationStore}
        busy={props.organize.busy}
        onLoadFile={props.organize.onLoadFile}
        onImageDrop={props.organize.onImageDrop}
        onPrepareSources={props.organize.onPrepareSources}
        onDiscardSources={props.organize.onDiscardSources}
        onCopy={props.organize.onCopy}
        onPaste={props.organize.onPaste}
        onApply={props.organize.onApply}
        onCancel={props.organize.onCancel}
        onExtract={props.organize.onExtract}
        onSplit={props.organize.onSplit}
      />
    </div>
  )

  return (
    <QuantityTableContext.Provider value={tableControls}>
    <div ref={workspaceRef} className={`document-workspace${props.showThumbnails ? '' : ' thumbnails-hidden'}${props.showFormat ? '' : ' format-hidden'}`}
      style={{ '--format-panel-width': `${formatWidth}px` } as CSSProperties}>
      {props.showThumbnails && <SidePanel
        session={props.session}
        pool={props.pool}
        scheduler={scheduler}
        activeTab={props.activeSideTab}
        focusSearchVersion={props.focusSearchVersion}
        onTabChange={props.onSideTabChange}
        onPageClick={(index) => props.viewerRef.current?.scrollToPage(index)}
        onSearchNavigate={(match) => {
          const quad = match.quads[0]
          props.viewerRef.current?.scrollToPosition(match.pageIndex, quad ? Math.min(quad[0], quad[4]) : null, quad ? Math.min(quad[1], quad[3]) : null)
        }}
        onSearchHighlights={setSearchHighlights}
        onEditAnnotation={(annotation) => {
          if (props.session.editRestriction) { props.onStatus(props.session.editRestriction); return }
          props.session.annotationStore.touch(annotation.id)
          props.session.annotationStore.selectOnly(annotation.id)
          props.onToolChange('select')
          props.viewerRef.current?.scrollToPosition(annotation.pageIndex, annotation.rect[0], annotation.rect[1])
          props.viewerRef.current?.editAnnotation(annotation.id)
        }}
        onSelectAnnotation={(annotation) => {
          props.session.annotationStore.selectOnly(annotation.id)
          props.onToolChange('select')
          props.viewerRef.current?.scrollToPosition(annotation.pageIndex, annotation.rect[0], annotation.rect[1])
        }}
      />}
      <div className="quantity-viewer-stack" style={{ gridTemplateRows: tableOpen ? `minmax(0, ${100 - tableHeight}fr) minmax(0, ${tableHeight}fr)` : 'minmax(0, 1fr)' }}>
      <div ref={viewerSlotRef} className={props.split ? 'viewer-slot split-view' : 'viewer-slot'} style={props.split ? { gridTemplateColumns: `minmax(0, ${props.split.settings.ratio}fr) 6px minmax(0, ${1 - props.split.settings.ratio}fr)` } : undefined}>
      <Viewer
        readOnly={!!props.session.editRestriction}
        onNavigate={props.onNavigate}
        ref={props.viewerRef}
        docId={props.session.docId}
        pool={props.pool}
        scheduler={scheduler}
        annotationStore={props.session.annotationStore}
        formatDefaults={props.formatDefaults}
        tool={props.tool}
        selectedAnnotationId={selectedId}
        searchMatches={searchHighlights.matches}
        activeSearchIndex={searchHighlights.activeIndex}
        onSelectAnnotation={(id) => {
          if (id === null) props.session.annotationStore.clearSelection()
          else if (!props.session.annotationStore.isSelected(id)) props.session.annotationStore.selectOnly(id)
        }}
        initialView={initialView}
        onViewChange={props.split ? () => splitControllerRef.current?.change() : undefined}
        onViewInteraction={props.split ? () => splitControllerRef.current?.interact() : undefined}
        onToolChange={props.onToolChange}
        pageSizes={props.session.pageSizes}
        onZoomChange={(zoom) => {
          props.session.view.zoom = zoom
          props.onZoomChange(zoom)
        }}
        onPageChange={(page) => {
          props.session.view.page = page
          props.onPageChange(page)
        }}
        onScrollPositionChange={(scrollLeft, scrollTop) => {
          props.session.view.scrollLeft = scrollLeft
          props.session.view.scrollTop = scrollTop
        }}
        onFirstBitmap={props.onFirstBitmap}
        onFirstSharp={props.onFirstSharp}
        onStatus={props.onStatus}
      />
      {props.split && <SplitView {...props.split} left={props.session} pool={props.pool} scheduler={scheduler}
        leftRef={props.viewerRef} containerRef={viewerSlotRef} controllerRef={splitControllerRef}
        formatDefaults={props.formatDefaults} onStatus={props.onStatus} />}
      {!props.session.editRestriction && (props.tool === 'count' || props.session.annotationStore.selectedPickupsOnly()) &&
        <div className="pickup-bar-region" style={{ width: props.split ? `calc((100% - 6px) * ${props.split.settings.ratio})` : '100%' }}><PickupBar key={props.session.docId} session={props.session} /></div>}
      </div>
      {tableOpen && <Suspense fallback={<div role="status">集計表を読み込んでいます…</div>}>
        <QuantityTable session={props.session} pool={props.pool} height={tableHeight} onHeightChange={setTableHeight} onClose={closeTable} />
      </Suspense>}
      </div>
      {props.showFormat && !props.session.editRestriction && <div className="format-panel-slot">
        <FormatPanel
          selected={selected}
          tool={props.tool}
          store={props.session.annotationStore}
          pool={props.pool}
          defaults={props.formatDefaults}
          onDefaultsChange={props.onFormatDefaultsChange}
        />
        <div className="format-panel-resizer" role="separator" aria-label="右の欄の幅" aria-orientation="vertical"
          aria-valuemin={FORMAT_MIN_WIDTH} aria-valuemax={formatMaximum} aria-valuenow={formatWidth} tabIndex={0}
          onKeyDown={event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            event.stopPropagation()
            resizeFormatPanel(formatWidthRef.current + (event.key === 'ArrowLeft' ? 10 : -10))
            saveFormatPanelWidth()
          }}
          onPointerDown={event => {
            if (event.button !== 0) return
            event.preventDefault()
            event.stopPropagation()
            event.currentTarget.setPointerCapture(event.pointerId)
            formatDragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: formatWidthRef.current }
          }}
          onPointerMove={event => {
            const drag = formatDragRef.current
            if (!drag || drag.pointerId !== event.pointerId) return
            resizeFormatPanel(drag.startWidth + drag.startX - event.clientX)
          }}
          onPointerUp={event => {
            if (formatDragRef.current?.pointerId !== event.pointerId) return
            finishFormatPanelDrag()
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onPointerCancel={event => {
            if (formatDragRef.current?.pointerId === event.pointerId) finishFormatPanelDrag()
          }}
          onLostPointerCapture={event => {
            if (formatDragRef.current?.pointerId === event.pointerId) finishFormatPanelDrag()
          }}
        />
      </div>}
      {props.debug && <DebugPanel pool={props.pool} cache={scheduler.cache} />}
    </div>
    </QuantityTableContext.Provider>
  )
}
