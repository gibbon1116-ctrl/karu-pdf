import { useEffect, useMemo, useState, type RefObject } from 'react'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import { RenderScheduler } from '../client/RenderScheduler'
import type { EditorTool } from '../editor/AnnotationLayer'
import type { FormatDefaults } from '../editor/formatDefaults'
import { DebugPanel } from '../perf/DebugPanel'
import { BitmapCache } from '../viewer/BitmapCache'
import { Viewer, type ViewerHandle } from '../viewer/Viewer'
import type { DocumentSession, SidePanelTab } from './documentModel'
import { FormatPanel } from './FormatPanel'
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
  organize: OrganizeWorkspaceState | null
}

export function DocumentWorkspace(props: Props) {
  const [searchHighlights, setSearchHighlights] = useState<SearchHighlightState>({ matches: [], activeIndex: -1 })
  const scheduler = useMemo(() => new RenderScheduler(
    props.pool,
    new BitmapCache(),
    new BitmapCache(64 * 1024 * 1024),
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSearchHighlights({ matches: [], activeIndex: -1 })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

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
    <div className={`document-workspace${props.showThumbnails ? '' : ' thumbnails-hidden'}${props.showFormat ? '' : ' format-hidden'}`}>
      {props.showThumbnails && <SidePanel
        session={props.session}
        pool={props.pool}
        scheduler={scheduler}
        activeTab={props.activeSideTab}
        focusSearchVersion={props.focusSearchVersion}
        onTabChange={props.onSideTabChange}
        onPageClick={(index) => props.viewerRef.current?.scrollToPage(index)}
        onNavigate={(pageIndex, x, y) => props.viewerRef.current?.scrollToPosition(pageIndex, x, y)}
        onSearchNavigate={(match) => {
          const quad = match.quads[0]
          props.viewerRef.current?.scrollToPosition(match.pageIndex, quad ? Math.min(quad[0], quad[4]) : null, quad ? Math.min(quad[1], quad[3]) : null)
        }}
        onSearchHighlights={setSearchHighlights}
        onSelectAnnotation={(annotation) => {
          props.session.annotationStore.selectOnly(annotation.id)
          props.onToolChange('select')
          props.viewerRef.current?.scrollToPosition(annotation.pageIndex, annotation.rect[0], annotation.rect[1])
        }}
      />}
      <Viewer
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
      />
      {props.showFormat && <FormatPanel
        selected={selected}
        tool={props.tool}
        store={props.session.annotationStore}
        pool={props.pool}
        defaults={props.formatDefaults}
        onDefaultsChange={props.onFormatDefaultsChange}
      />}
      {props.debug && <DebugPanel pool={props.pool} cache={scheduler.cache} />}
    </div>
  )
}
