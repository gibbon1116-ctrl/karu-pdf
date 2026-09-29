import { useEffect, useMemo, useState, type RefObject } from 'react'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import { RenderScheduler } from '../client/RenderScheduler'
import type { EditorTool } from '../editor/AnnotationLayer'
import type { FormatDefaults } from '../editor/formatDefaults'
import { DebugPanel } from '../perf/DebugPanel'
import { BitmapCache } from '../viewer/BitmapCache'
import { Viewer, type ViewerHandle } from '../viewer/Viewer'
import type { DocumentSession } from './documentModel'
import { FormatPanel } from './FormatPanel'
import { ThumbnailPanel } from './ThumbnailPanel'
import { OrganizeView, type ExtractOptions, type OrganizeSourceInfo } from '../organize/OrganizeView'
import type { OrganizeDraft } from '../organize/OrganizeDraft'
import type { PageCard } from '../organize/OrganizeDraft'
import type { OrganizeSplitMode } from '../organize/organizeUtils'

export interface OrganizeWorkspaceState {
  draft: OrganizeDraft
  sources: ReadonlyMap<string, OrganizeSourceInfo>
  busy: boolean
  onLoadFiles(files: File[]): Promise<OrganizeSourceInfo[]>
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
  debug: boolean
  onToolChange(tool: EditorTool): void
  onFormatDefaultsChange(value: FormatDefaults): void
  onPageChange(page: number): void
  onZoomChange(zoom: number): void
  onFirstBitmap(): void
  onFirstSharp(): void
  organize: OrganizeWorkspaceState | null
}

export function DocumentWorkspace(props: Props) {
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = selectedId ? props.session.annotationStore.get(selectedId) ?? null : null

  useEffect(() => () => {
    scheduler.destroy()
    scheduler.cache.clear()
    scheduler.warmCache.clear()
  }, [scheduler])

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
        onLoadFiles={props.organize.onLoadFiles}
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
      {props.showThumbnails && <ThumbnailPanel
        docId={props.session.docId}
        pageSizes={props.session.pageSizes}
        currentPage={props.session.view.page}
        scheduler={scheduler}
        annotationStore={props.session.annotationStore}
        onPageClick={(index) => props.viewerRef.current?.scrollToPage(index)}
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
        onSelectAnnotation={setSelectedId}
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
