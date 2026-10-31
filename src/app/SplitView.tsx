import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import { RenderScheduler } from '../client/RenderScheduler'
import { AnnotationStore } from '../editor/AnnotationStore'
import type { FormatDefaults } from '../editor/formatDefaults'
import { BitmapCache } from '../viewer/BitmapCache'
import { Viewer, type ViewerHandle } from '../viewer/Viewer'
import { ViewSyncDriver, type ViewPosition } from '../viewer/viewSync'
import type { DocumentSession, DocumentViewState } from './documentModel'
import { prepareSplitDisplays } from './splitRendering'

export interface SplitSettings {
  enabled: boolean
  rightId: string | null
  rightName: string | null
  ratio: number
  synced: boolean
}
const STORAGE_KEY = 'karu-pdf:split-view'
export function loadSplitSettings(): SplitSettings {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return { enabled: false, rightId: typeof value.rightId === 'string' ? value.rightId : null,
      rightName: typeof value.rightName === 'string' ? value.rightName : null,
      ratio: typeof value.ratio === 'number' && Number.isFinite(value.ratio) ? Math.max(.25, Math.min(.75, value.ratio)) : .5,
      synced: value.synced !== false }
  } catch { return { enabled: false, rightId: null, rightName: null, ratio: .5, synced: true } }
}
export function saveSplitSettings(value: SplitSettings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)) } catch { /* Optional preference storage. */ }
}
export interface SplitController {
  change(): void
  interact(): void
}
export interface SplitWorkspaceProps {
  settings: SplitSettings
  documents: readonly DocumentSession[]
  views: Map<string, DocumentViewState>
  positions: Map<string, ViewPosition>
  onChange(settings: SplitSettings): void
  onSwap(right: DocumentSession, rightPosition: ViewPosition, leftPosition: ViewPosition): Promise<void>
}
interface Props extends SplitWorkspaceProps {
  left: DocumentSession
  pool: PdfWorkerPool
  scheduler: RenderScheduler
  leftRef: RefObject<ViewerHandle | null>
  containerRef: RefObject<HTMLDivElement | null>
  controllerRef: RefObject<SplitController | null>
  formatDefaults: FormatDefaults
  onStatus(message: string): void
}
const noop = () => undefined
const noSelection = () => undefined
const subscribeNothing = () => noop
const zero = () => 0

export function SplitView(props: Props) {
  const right = props.documents.find(doc => doc.docId === props.settings.rightId) ?? null
  const sourceVersion = useSyncExternalStore(right?.annotationStore.subscribe ?? subscribeNothing, right?.annotationStore.getSnapshot ?? zero)
  const rightRef = useRef<ViewerHandle>(null)
  const driver = useRef(new ViewSyncDriver())
  const frame = useRef(0)
  const [ready, setReady] = useState('')
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [failure, setFailure] = useState('')
  const readOnlyStore = useMemo(() => new AnnotationStore(), [])
  const separateScheduler = useMemo(() => right && right !== props.left
    ? new RenderScheduler(props.pool, new BitmapCache(), new BitmapCache(64 * 1024 * 1024)) : null,
  [props.pool, right?.docId, right?.pageRevision, right?.savedRevision, props.left.docId])
  const scheduler = separateScheduler ?? props.scheduler
  const token = `${props.left.docId}:${right?.docId}:${right?.pageRevision}:${right?.savedRevision}`
  const initialView = useMemo(() => right ? { ...(props.views.get(right.docId) ?? right.view) } : null, [right?.docId, right?.pageRevision, right?.savedRevision])

  useEffect(() => () => {
    separateScheduler?.destroy()
    separateScheduler?.cache.clear()
    separateScheduler?.warmCache.clear()
  }, [separateScheduler])
  useEffect(() => {
    let cancelled = false
    setFailure('')
    if (!right) return
    // The pool holds two display documents. Load the reference then restore the editing
    // document as its active document; the UI's active tab is never changed here.
    void (async () => {
      await prepareSplitDisplays(props.pool, props.left, right, () => cancelled)
      if (!cancelled) setReady(token)
    })().catch(error => { if (!cancelled) setFailure(`右の表示を開けませんでした: ${String(error)}`) })
    return () => { cancelled = true }
  }, [props.pool, token, props.left.savedRevision])

  const synchronize = useCallback((side: 'left' | 'right') => {
    if (!props.settings.synced || !right || ready !== token || !driver.current.accepts(side) || frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      const source = side === 'left' ? props.leftRef.current : rightRef.current
      const target = side === 'left' ? rightRef.current : props.leftRef.current
      if (source && target) target.applyViewPosition(source.getViewPosition())
    })
  }, [props.settings.synced, right, ready, token, props.leftRef])
  const interact = useCallback((side: 'left' | 'right') => {
    driver.current.drive(side)
    cancelAnimationFrame(frame.current)
    frame.current = 0
  }, [])
  useEffect(() => {
    props.controllerRef.current = { change: () => synchronize('left'), interact: () => interact('left') }
    return () => { props.controllerRef.current = null; cancelAnimationFrame(frame.current); frame.current = 0 }
  }, [props.controllerRef, synchronize, interact])
  useLayoutEffect(() => {
    if (!right || ready !== token || !rightRef.current) return
    const pending = props.positions.get(right.docId)
    if (!pending) return
    props.positions.delete(right.docId)
    rightRef.current.applyViewPosition(pending)
  }, [right?.docId, ready, token, props.positions])
  useEffect(() => {
    interact('left')
    synchronize('left')
  }, [props.settings.synced, ready, synchronize, interact])

  const choose = (id: string) => {
    const chosen = props.documents.find(doc => doc.docId === id)
    props.onChange({ ...props.settings, rightId: id, rightName: chosen?.name ?? null, synced: id !== props.left.docId })
  }
  void sourceVersion
  return <>
    <div className="split-divider" role="separator" aria-label="左右の境目" aria-orientation="vertical" aria-valuemin={25} aria-valuemax={75} aria-valuenow={Math.round(props.settings.ratio * 100)} tabIndex={0}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
        event.preventDefault(); event.stopPropagation()
        props.onChange({ ...props.settings, ratio: Math.max(.25, Math.min(.75, props.settings.ratio + (event.key === 'ArrowLeft' ? -.02 : .02))) })
      }}
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId) }}
      onPointerMove={event => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        const rect = props.containerRef.current?.getBoundingClientRect()
        if (rect) props.onChange({ ...props.settings, ratio: Math.max(.25, Math.min(.75, (event.clientX - rect.left) / rect.width)) })
      }}
      onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)} />
    <section className="split-reference" data-testid="split-reference" aria-label="右の閲覧用文書">
      <header className="split-header">
        <select aria-label="右に表示する文書" value={right?.docId ?? ''} onChange={event => choose(event.target.value)}>
          {!right && <option value="">表示する文書を選んでください</option>}
          <option value={props.left.docId}>同じ文書 — {props.left.name}</option>
          {props.documents.filter(doc => doc !== props.left).map(doc => <option key={doc.docId} value={doc.docId}>{doc.name}</option>)}
        </select>
        {right && <>
          <label>p.<input aria-label="右のページ番号" type="number" min={1} max={right.pageSizes.length} value={page} onChange={event => {
            const next = Number(event.target.value)
            if (next >= 1 && next <= right.pageSizes.length) rightRef.current?.scrollToPage(next - 1)
          }} />/{right.pageSizes.length}</label>
          <button type="button" aria-label="右を縮小" onClick={() => rightRef.current?.zoomOut()}>−</button>
          <span data-testid="right-zoom">{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="右を拡大" onClick={() => rightRef.current?.zoomIn()}>＋</button>
          <button type="button" aria-label="右を幅に合わせる" onClick={() => rightRef.current?.fitWidth()}>幅</button>
        </>}
        <label className="split-sync"><input type="checkbox" checked={props.settings.synced} onChange={event => props.onChange({ ...props.settings, synced: event.target.checked })} />ページを合わせて動かす</label>
        <button type="button" disabled={!right || ready !== token} onClick={() => {
          const rightPosition = rightRef.current?.getViewPosition(), leftPosition = props.leftRef.current?.getViewPosition()
          if (!right || !rightPosition || !leftPosition) return
          if (right === props.left) {
            interact('left')
            props.leftRef.current?.applyViewPosition(rightPosition)
            rightRef.current?.applyViewPosition(leftPosition)
          } else void props.onSwap(right, rightPosition, leftPosition).catch(error => props.onStatus(String(error)))
        }}>⇄ 入れ替え</button>
        <button type="button" aria-label="左右に並べるのをやめる" onClick={() => props.onChange({ ...props.settings, enabled: false })}>×</button>
        {right?.annotationStore.isDirty() && <small>未保存の書き込みは表示されません</small>}
      </header>
      {!right ? <p>表示する文書を選んでください</p> : failure ? <p role="alert">{failure}</p> : ready === token ? <Viewer
        key={`${right.docId}:${right.pageRevision}:${right.savedRevision}`}
        ref={rightRef} readOnly renderRevisions={right.savedPageRevisions}
        docId={right.docId} pageSizes={right.pageSizes} pool={props.pool} scheduler={scheduler}
        annotationStore={readOnlyStore} formatDefaults={props.formatDefaults} tool="select"
        selectedAnnotationId={null} searchMatches={[]} activeSearchIndex={-1}
        onSelectAnnotation={noSelection} onToolChange={noop} initialView={initialView}
        onZoomChange={value => { setZoom(value); const view = props.views.get(right.docId) ?? { ...right.view }; view.zoom = value; props.views.set(right.docId, view) }}
        onPageChange={value => { setPage(value); const view = props.views.get(right.docId) ?? { ...right.view }; view.page = value; props.views.set(right.docId, view) }}
        onScrollPositionChange={(left, top) => { const view = props.views.get(right.docId) ?? { ...right.view }; view.scrollLeft = left; view.scrollTop = top; props.views.set(right.docId, view) }}
        onViewChange={() => synchronize('right')} onViewInteraction={() => interact('right')}
        onFirstBitmap={noop} onFirstSharp={noop} onStatus={props.onStatus}
      /> : <p>右の表示を準備しています…</p>}
    </section>
  </>
}
