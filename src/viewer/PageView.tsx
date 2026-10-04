import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import type { RenderScheduler } from '../client/RenderScheduler'
import type { PageSize } from '../core/mupdfDoc'
import type { SearchMatch } from '../core/search'
import { AnnotationLayer, type EditorTool } from '../editor/AnnotationLayer'
import type { AnnotationStore } from '../editor/AnnotationStore'
import type { FormatDefaults } from '../editor/formatDefaults'
import type { DeviceRect, Priority } from '../worker/protocol'
import { completedBandsCover, isBandedRender, makeRenderBands, type RenderBand } from './bandedRender'
import { computeDetailRegion, computeVisibleRegion, visiblePartOfPage, type Box } from './detailRegion'
import {
  DetailRequestSync,
  getDetailRecoveryCount,
  recordDetailRecovery,
  type DetailRequest,
  type DetailRequestPlan,
  type DetailSyncEvent,
} from './detailRequestSync'
import { CSS_PX_PER_PT, type PageLayout } from './pageLayout'

interface Props {
  renderVariant?: string
  compareRegions?: readonly import('../core/compare').CompareRect[]
  activeCompareIndex?: number
  readOnly?: boolean
  deferPreview?: boolean
  renderRevision?: number
  docId: string
  pool: PdfWorkerPool
  scheduler: RenderScheduler
  annotationStore: AnnotationStore
  formatDefaults: FormatDefaults
  tool: EditorTool
  selectedAnnotationId: string | null
  searchMatches: Array<{ match: SearchMatch; active: boolean }>
  editingAnnotationId: string | null
  onSelectAnnotation(id: string | null): void
  onEditAnnotation(id: string | null): void
  registerEditorCommit(commit: (() => Promise<void>) | null): void
  layout: PageLayout
  pageSize: PageSize
  zoom: number
  priority: Priority
  visible: boolean
  viewport: Box
  pageLeft: number
  warmEnabled: boolean
  onFirstBitmap(): void
  onSharpChange(pageIndex: number, sharp: boolean): void
  onRenderRequest(pageIndex: number, priority: Priority, key: string): () => void
  onStatus(message: string): void
}

interface DetailState {
  baseKey: string
  stage: 'visible' | 'full'
  renderScale: number
  region: DeviceRect
  bands: RenderBand[]
  completed: boolean[]
  complete: boolean
  canvas: HTMLCanvasElement
}

interface DetailTransitionLogEntry {
  pageIndex: number
  event: DetailSyncEvent | 'want' | 'release' | 'complete'
  key: string | null
  at: number
}

type DetailLogWindow = Window & typeof globalThis & {
  __karuDetailTransitions?: DetailTransitionLogEntry[]
}

function logDetailTransition(pageIndex: number, event: DetailTransitionLogEntry['event'], key: string | null): void {
  const target = window as DetailLogWindow
  const log = target.__karuDetailTransitions ?? []
  log.push({ pageIndex, event, key, at: performance.now() })
  if (log.length > 5_000) log.splice(0, log.length - 5_000)
  target.__karuDetailTransitions = log
}

function draw(canvas: HTMLCanvasElement | null, bitmap: ImageBitmap): void {
  if (!canvas) return
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d', { alpha: false })?.drawImage(bitmap, 0, 0)
}

function drawCanvas(canvas: HTMLCanvasElement | null, source: HTMLCanvasElement): void {
  if (!canvas) return
  canvas.width = source.width
  canvas.height = source.height
  canvas.getContext('2d')?.drawImage(source, 0, 0)
}

export function PageView(props: Props) {
  useSyncExternalStore(props.annotationStore.subscribe, props.annotationStore.getSnapshot)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const detailRef = useRef<HTMLCanvasElement>(null)
  const qualityRef = useRef(0)
  const activeDetailRequestRef = useRef<{ key: string; stage: 'visible' | 'full' } | null>(null)
  const visibleDeviceRef = useRef<DeviceRect | null>(null)
  const safetyStateRef = useRef({ watch: false, hasDetail: false })
  const [hasBitmap, setHasBitmap] = useState(false)
  const [drawnPreviewKey, setDrawnPreviewKey] = useState('')
  const [detailRequest, setDetailRequest] = useState<DetailRequest | null>(null)
  const [detail, setDetail] = useState<DetailState | null>(null)
  const detailRequestSyncRef = useRef<DetailRequestSync | null>(null)
  if (!detailRequestSyncRef.current) {
    detailRequestSyncRef.current = new DetailRequestSync(
      setDetailRequest,
      (event, request) => logDetailTransition(props.layout.index, event, request?.key ?? null),
    )
  }

  useEffect(() => {
    if (props.readOnly) return
    void props.annotationStore.ensurePageLoaded(
      props.layout.index,
      () => props.pool.listAnnotations(props.docId, props.layout.index),
    ).catch((error) => console.error('注釈の読み込みに失敗しました。', error))
  }, [props.annotationStore, props.docId, props.layout.index, props.pool])

  const dpr = window.devicePixelRatio || 1
  const renderScale = props.zoom * CSS_PX_PER_PT * dpr
  const pageDeviceSize = useMemo(() => ({
    width: Math.ceil(props.pageSize.width * renderScale),
    height: Math.ceil(props.pageSize.height * renderScale),
  }), [props.pageSize, renderScale])
  const usesDetail = Math.max(pageDeviceSize.width, pageDeviceSize.height) > 2048
  const previewScale = usesDetail ? 2048 / Math.max(props.pageSize.width, props.pageSize.height) : renderScale
  const lowScale = 512 / Math.max(props.pageSize.width, props.pageSize.height)
  const warmScale = 256 / Math.max(props.pageSize.width, props.pageSize.height)
  const excludedObjNums = props.readOnly ? props.annotationStore.drawingHiddenObjNums(props.layout.index) : [...new Set([...props.annotationStore.touchedObjNums(props.layout.index), ...props.annotationStore.countOverlayObjNums(props.layout.index), ...props.annotationStore.issueOverlayObjNums(props.layout.index), ...props.annotationStore.drawingHiddenObjNums(props.layout.index)])].sort((a, b) => a - b)
  const excludeKey = `:x=${excludedObjNums.join('.')}${props.renderRevision ? `:v=${props.renderRevision}` : ''}${props.renderVariant ? `:variant=${props.renderVariant}` : ''}`
  const previewKey = `${props.layout.index}:${previewScale.toFixed(6)}:full${excludeKey}`
  const lowKey = `${props.layout.index}:${lowScale.toFixed(6)}:full${excludeKey}`
  const warmKey = `warm:${props.layout.index}:${warmScale.toFixed(6)}:full${excludeKey}`

  const zoomStable = Math.abs(props.layout.width - props.pageSize.width * CSS_PX_PER_PT * props.zoom) < 0.5
  const visibleDevice = useMemo<DeviceRect | null>(() => {
    if (!props.visible || !zoomStable) return null
    const localCss = visiblePartOfPage({
      x: props.pageLeft,
      y: props.layout.top,
      width: props.layout.width,
      height: props.layout.height,
    }, props.viewport)
    if (!localCss) return null
    return [
      Math.floor(localCss[0] * dpr),
      Math.floor(localCss[1] * dpr),
      Math.ceil(localCss[2] * dpr),
      Math.ceil(localCss[3] * dpr),
    ]
  }, [props.visible, props.pageLeft, props.layout, props.viewport, zoomStable, dpr])

  const detailSharp = props.visible && zoomStable
    && detail?.renderScale === renderScale
    && detail.baseKey.endsWith(excludeKey)
    && completedBandsCover(detail.region, detail.bands, detail.completed, visibleDevice)
  const detailFull = detailSharp && detail?.stage === 'full' && detail.complete
  visibleDeviceRef.current = visibleDevice

  const desiredDetailRequest = useMemo<DetailRequestPlan | null>(() => {
    if (!usesDetail || !visibleDevice) return null
    const validDetail = detail?.renderScale === renderScale && detail.baseKey.endsWith(excludeKey)
    let stage: 'visible' | 'full'
    let region: DeviceRect
    let delayMs = 0
    if (validDetail && completedBandsCover(detail.region, detail.bands, detail.completed, visibleDevice)) {
      stage = 'full'
      region = detail.stage === 'full' ? detail.region : computeDetailRegion(visibleDevice, pageDeviceSize)
    } else {
      stage = 'visible'
      region = computeVisibleRegion(visibleDevice, pageDeviceSize)
      // 同じ倍率の古い詳細を表示できるスクロールだけを間引く。倍率変更後は即時に出す。
      delayMs = validDetail ? 60 : 0
    }
    return {
      key: `${props.layout.index}:${renderScale.toFixed(6)}:detail-${stage}:${region.join(',')}${excludeKey}`,
      stage,
      region,
      delayMs,
    }
  }, [usesDetail, visibleDevice, detail, renderScale, excludeKey, pageDeviceSize, props.layout.index])

  useLayoutEffect(() => {
    detailRequestSyncRef.current?.sync(desiredDetailRequest)
  })

  useEffect(() => () => {
    detailRequestSyncRef.current?.dispose()
    detailRequestSyncRef.current = null
  }, [])

  safetyStateRef.current = {
    watch: props.visible && zoomStable && usesDetail && visibleDevice !== null,
    hasDetail: Boolean(detailSharp),
  }

  useEffect(() => {
    let missingSince: number | null = null
    const timer = window.setInterval(() => {
      const state = safetyStateRef.current
      const hasVisibleRequest = activeDetailRequestRef.current?.stage === 'visible'
      if (!state.watch || state.hasDetail || hasVisibleRequest) {
        missingSince = null
        return
      }
      const now = performance.now()
      if (missingSince === null) {
        missingSince = now
        return
      }
      if (now - missingSince < 500) return
      if (detailRequestSyncRef.current?.recover()) recordDetailRecovery()
      missingSince = now
    }, 100)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!props.warmEnabled) return
    const finishLog = props.onRenderRequest(props.layout.index, props.visible ? 0 : 3, warmKey)
    const params = {
      docId: props.docId,
      pageIndex: props.layout.index,
      renderScale: warmScale,
      deviceRect: null,
      excludeAnnotObjNums: excludedObjNums,
    }
    const release = props.scheduler.want(warmKey, params, props.visible ? 0 : 3, (bitmap) => {
      finishLog()
      if (qualityRef.current > 0) return
      draw(previewRef.current, bitmap)
      qualityRef.current = 0.5
      setHasBitmap(true)
      props.onFirstBitmap()
    })
    return () => {
      finishLog()
      release()
    }
  }, [props.scheduler, warmKey, warmScale, props.layout.index, props.visible, props.warmEnabled, props.onRenderRequest])

  useEffect(() => {
    if (usesDetail && hasBitmap) return
    const priority = usesDetail ? 0 : props.priority
    const finishLog = props.onRenderRequest(props.layout.index, priority, lowKey)
    const params = {
      docId: props.docId,
      pageIndex: props.layout.index,
      renderScale: lowScale,
      deviceRect: null,
      excludeAnnotObjNums: excludedObjNums,
    }
    const release = props.scheduler.want(lowKey, params, priority, (bitmap) => {
      finishLog()
      if (qualityRef.current > 1) return
      draw(previewRef.current, bitmap)
      qualityRef.current = 1
      setHasBitmap(true)
      props.onFirstBitmap()
    })
    return () => {
      finishLog()
      release()
    }
  }, [props.scheduler, lowKey, lowScale, props.layout.index, props.priority, props.onRenderRequest, usesDetail, hasBitmap])

  useEffect(() => {
    // With two panes, preserve the low-resolution first paint while scrolling.
    // New sharp whole-page requests would compete with both panes' first paints
    // and prefetch. Cached sharp images remain available immediately.
    if (!props.visible || (usesDetail && !detailFull)
      || (props.deferPreview && !props.scheduler.has(previewKey))) return
    const priority: Priority = usesDetail ? 2 : 0
    const previewRegion: DeviceRect = [
      0,
      0,
      Math.ceil(props.pageSize.width * previewScale),
      Math.ceil(props.pageSize.height * previewScale),
    ]
    const bands = usesDetail ? makeRenderBands(previewKey, previewRegion) : makeRenderBands(previewKey, [0, 0, 1, 1])
    const banded = usesDetail && isBandedRender(bands)
    const buffer = document.createElement('canvas')
    buffer.width = previewRegion[2]
    buffer.height = previewRegion[3]
    const bufferContext = buffer.getContext('2d', { alpha: false })
    if (previewRef.current && bufferContext) {
      bufferContext.drawImage(previewRef.current, 0, 0, buffer.width, buffer.height)
    }
    let completed = 0
    let displayed = false
    let active = true
    const releases: Array<{ finishLog(completed?: boolean): void; release(): void }> = []
    const requestBand = (index: number) => {
      if (!active || index >= bands.length) return
      const band = bands[index]
      const finishLog = props.onRenderRequest(props.layout.index, priority, band.key)
      const params = {
        docId: props.docId,
        pageIndex: props.layout.index,
        renderScale: previewScale,
        deviceRect: banded ? band.rect : null,
        excludeAnnotObjNums: excludedObjNums,
      }
      const item = {
        finishLog,
        release: props.scheduler.want(band.key, params, priority, (bitmap) => {
          finishLog()
          const x = band.rect[0] - previewRegion[0]
          const y = band.rect[1] - previewRegion[1]
          bufferContext?.drawImage(bitmap, x, y)
          const canvas = previewRef.current
          if (canvas) {
            if (!displayed) {
              drawCanvas(canvas, buffer)
              displayed = true
            } else {
              canvas.getContext('2d', { alpha: false })?.drawImage(bitmap, x, y)
            }
          }
          completed += 1
          qualityRef.current = 2
          setHasBitmap(true)
          props.onFirstBitmap()
          if (completed === bands.length) setDrawnPreviewKey(previewKey)
          else requestBand(index + 1)
        }),
      }
      releases.push(item)
    }
    requestBand(0)
    return () => {
      active = false
      for (const item of releases) {
        item.finishLog()
        item.release()
      }
    }
  }, [props.scheduler, previewKey, previewScale, props.layout.index, props.pageSize, props.visible, props.onRenderRequest, usesDetail, detailFull, props.deferPreview])

  const detailKey = detailRequest?.key ?? ''

  useEffect(() => {
    if (!detailRequest || !detailKey) return
    const priority: Priority = detailRequest.stage === 'visible' ? 0 : 1
    const bands = detailRequest.stage === 'full'
      ? makeRenderBands(detailKey, detailRequest.region)
      : [{ key: detailKey, rect: detailRequest.region }]
    const completed = bands.map(() => false)
    const buffer = document.createElement('canvas')
    buffer.width = detailRequest.region[2] - detailRequest.region[0]
    buffer.height = detailRequest.region[3] - detailRequest.region[1]
    const context = buffer.getContext('2d')
    let active = true
    let displayed = false
    activeDetailRequestRef.current = { key: detailKey, stage: detailRequest.stage }
    logDetailTransition(props.layout.index, 'want', detailKey)
    const releases: Array<{ finishLog(completed?: boolean): void; release(): void }> = []
    const requestBand = (index: number) => {
      if (!active || index >= bands.length) return
      const band = bands[index]
      const finishLog = props.onRenderRequest(props.layout.index, priority, band.key)
      const params = {
        docId: props.docId,
        pageIndex: props.layout.index,
        renderScale,
        deviceRect: band.rect,
        excludeAnnotObjNums: excludedObjNums,
      }
      const item = {
        finishLog,
        release: props.scheduler.want(band.key, params, priority, (bitmap) => {
          finishLog()
          if (!active) return
          context?.drawImage(
            bitmap,
            band.rect[0] - detailRequest.region[0],
            band.rect[1] - detailRequest.region[1],
          )
          completed[index] = true
          const complete = completed.every(Boolean)
          const coversRequestedVisible = completedBandsCover(
            detailRequest.region,
            bands,
            completed,
            visibleDeviceRef.current,
          )
          if (detailRequest.stage === 'visible' || displayed || coversRequestedVisible) {
            displayed = true
            setDetail({
              baseKey: detailKey,
              stage: detailRequest.stage,
              renderScale,
              region: detailRequest.region,
              bands,
              completed: [...completed],
              complete,
              canvas: buffer,
            })
          }
          setHasBitmap(true)
          if (!complete) requestBand(index + 1)
          else logDetailTransition(props.layout.index, 'complete', detailKey)
        }),
      }
      releases.push(item)
    }
    requestBand(0)
    return () => {
      active = false
      if (activeDetailRequestRef.current?.key === detailKey) activeDetailRequestRef.current = null
      logDetailTransition(props.layout.index, 'release', detailKey)
      for (const item of releases) {
        item.finishLog()
        item.release()
      }
    }
  }, [props.scheduler, props.layout.index, props.onRenderRequest, renderScale, detailKey, detailRequest?.generation])

  useEffect(() => {
    if (detail) drawCanvas(detailRef.current, detail.canvas)
  }, [detail])

  const sharp = props.visible && zoomStable && (usesDetail
    ? detailSharp
    : drawnPreviewKey === previewKey)

  useEffect(() => {
    props.onSharpChange(props.layout.index, Boolean(sharp))
  }, [props.layout.index, props.onSharpChange, sharp])

  const showDetail = detail && detail.renderScale === renderScale

  return (
    <div
      className="page-view"
      data-page-index={props.layout.index}
      data-has-bitmap={hasBitmap ? 'true' : 'false'}
      data-sharp={sharp ? 'true' : 'false'}
      data-visible={props.visible ? 'true' : 'false'}
      data-zoom-stable={zoomStable ? 'true' : 'false'}
      data-uses-detail={usesDetail ? 'true' : 'false'}
      data-detail-stage={showDetail ? (detail.complete ? detail.stage : `${detail.stage}-partial`) : 'none'}
      data-detail-request-key={activeDetailRequestRef.current?.key ?? ''}
      data-detail-desired-key={desiredDetailRequest?.key ?? ''}
      data-detail-sync-key={detailRequestSyncRef.current?.desiredKey ?? ''}
      data-detail-sync-disposed={detailRequestSyncRef.current?.isDisposed ? 'true' : 'false'}
      data-detail-safety-watch={safetyStateRef.current.watch ? 'true' : 'false'}
      data-detail-recovery-count={getDetailRecoveryCount()}
      style={{ top: props.layout.top, left: props.pageLeft, width: props.layout.width, height: props.layout.height }}
    >
      <span className="page-placeholder">{props.layout.index + 1}</span>
      <canvas ref={previewRef} className="preview-canvas" style={{ width: '100%', height: '100%' }} />
      {showDetail && <canvas
        ref={detailRef}
        className="detail-canvas"
        data-detail-key={detail.baseKey}
        style={{
          left: detail.region[0] / dpr,
          top: detail.region[1] / dpr,
          width: (detail.region[2] - detail.region[0]) / dpr,
          height: (detail.region[3] - detail.region[1]) / dpr,
        }}
      />}
      {props.searchMatches.length > 0 && <svg
        className="search-highlight-layer"
        viewBox={`0 0 ${props.pageSize.width} ${props.pageSize.height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {props.searchMatches.flatMap(({ match, active }, matchIndex) => match.quads.map((quad, quadIndex) => (
          <polygon
            key={`${matchIndex}-${quadIndex}`}
            className={active ? 'active' : ''}
            points={`${quad[0]},${quad[1]} ${quad[2]},${quad[3]} ${quad[6]},${quad[7]} ${quad[4]},${quad[5]}`}
          />
        )))}
      </svg>}
      {props.compareRegions && <svg className="compare-region-layer" viewBox={`0 0 ${props.pageSize.width} ${props.pageSize.height}`} preserveAspectRatio="none" aria-hidden="true">
        {props.compareRegions.map((r, i) => <rect key={i} className={i === props.activeCompareIndex ? 'active' : ''} x={r[0]} y={r[1]} width={r[2] - r[0]} height={r[3] - r[1]} />)}
      </svg>}
      {!props.readOnly && <AnnotationLayer
        docId={props.docId}
        pageIndex={props.layout.index}
        pageSize={props.pageSize}
        zoom={props.zoom}
        pool={props.pool}
        store={props.annotationStore}
        tool={props.tool}
        selectedId={props.selectedAnnotationId}
        editingId={props.editingAnnotationId}
        onSelect={props.onSelectAnnotation}
        onEdit={props.onEditAnnotation}
        registerCommit={props.registerEditorCommit}
        formatDefaults={props.formatDefaults}
        onStatus={props.onStatus}
      />}
    </div>
  )
}
