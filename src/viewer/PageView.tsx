import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import type { RenderScheduler } from '../client/RenderScheduler'
import type { PageSize } from '../core/mupdfDoc'
import { AnnotationLayer, type EditorTool } from '../editor/AnnotationLayer'
import type { AnnotationStore } from '../editor/AnnotationStore'
import type { DeviceRect, Priority } from '../worker/protocol'
import { computeDetailRegion, computeVisibleRegion, regionCovers, visiblePartOfPage, type Box } from './detailRegion'
import { CSS_PX_PER_PT, type PageLayout } from './pageLayout'

interface Props {
  pool: PdfWorkerPool
  scheduler: RenderScheduler
  annotationStore: AnnotationStore
  tool: EditorTool
  selectedAnnotationId: string | null
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
}

interface DetailState {
  key: string
  stage: 'visible' | 'full'
  renderScale: number
  region: DeviceRect
  bitmap: ImageBitmap
}

interface DetailRequest {
  stage: 'visible' | 'full'
  region: DeviceRect
}

function sameRegion(left: DeviceRect, right: DeviceRect): boolean {
  return left.every((value, index) => value === right[index])
}

function draw(canvas: HTMLCanvasElement | null, bitmap: ImageBitmap): void {
  if (!canvas) return
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d', { alpha: false })?.drawImage(bitmap, 0, 0)
}

export function PageView(props: Props) {
  useSyncExternalStore(props.annotationStore.subscribe, props.annotationStore.getSnapshot)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const detailRef = useRef<HTMLCanvasElement>(null)
  const qualityRef = useRef(0)
  const lastScaleRef = useRef<number | null>(null)
  const [hasBitmap, setHasBitmap] = useState(false)
  const [drawnPreviewKey, setDrawnPreviewKey] = useState('')
  const [detailRequest, setDetailRequest] = useState<DetailRequest | null>(null)
  const [detail, setDetail] = useState<DetailState | null>(null)

  useEffect(() => {
    void props.annotationStore.ensurePageLoaded(
      props.layout.index,
      () => props.pool.listAnnotations(props.layout.index),
    ).catch((error) => console.error('注釈の読み込みに失敗しました。', error))
  }, [props.annotationStore, props.layout.index, props.pool])

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
  const excludedObjNums = props.annotationStore.touchedObjNums(props.layout.index)
  const excludeKey = `:x=${excludedObjNums.join('.')}`
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
    && detail.key.endsWith(excludeKey)
    && regionCovers(detail.region, visibleDevice)
  const detailFull = detailSharp && detail?.stage === 'full'

  useEffect(() => {
    if (!props.warmEnabled) return
    const finishLog = props.onRenderRequest(props.layout.index, props.visible ? 0 : 3, warmKey)
    const params = {
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
    if (usesDetail && !detailFull) return
    const priority = usesDetail ? 2 : props.priority
    const finishLog = props.onRenderRequest(props.layout.index, priority, previewKey)
    const params = {
      pageIndex: props.layout.index,
      renderScale: previewScale,
      deviceRect: null,
      excludeAnnotObjNums: excludedObjNums,
    }
    const release = props.scheduler.want(previewKey, params, priority, (bitmap) => {
      finishLog()
      draw(previewRef.current, bitmap)
      qualityRef.current = 2
      setHasBitmap(true)
      setDrawnPreviewKey(previewKey)
      props.onFirstBitmap()
    })
    return () => {
      finishLog()
      release()
    }
  }, [props.scheduler, previewKey, previewScale, props.layout.index, props.priority, props.onRenderRequest, usesDetail, detailFull])

  useEffect(() => {
    const scaleChanged = lastScaleRef.current !== null && Math.abs(lastScaleRef.current - renderScale) > 0.000001
    lastScaleRef.current = renderScale
    if (scaleChanged) {
      setDetail(null)
      setDetailRequest(null)
    }
    if (!usesDetail || !visibleDevice) {
      setDetailRequest(null)
      return
    }
    if (!scaleChanged && detail?.renderScale === renderScale && regionCovers(detail.region, visibleDevice)) return
    const next: DetailRequest = {
      stage: 'visible',
      region: computeVisibleRegion(visibleDevice, pageDeviceSize),
    }
    const timer = window.setTimeout(() => setDetailRequest((current) => (
      current?.stage === next.stage && sameRegion(current.region, next.region) ? current : next
    )), scaleChanged ? 0 : 60)
    return () => window.clearTimeout(timer)
  }, [usesDetail, visibleDevice, renderScale, pageDeviceSize, detail])

  useEffect(() => {
    if (!usesDetail || !visibleDevice || !detailSharp || detail?.stage !== 'visible' || detailRequest?.stage === 'full') return
    const next: DetailRequest = {
      stage: 'full',
      region: computeDetailRegion(visibleDevice, pageDeviceSize),
    }
    setDetailRequest(next)
  }, [usesDetail, visibleDevice, detailSharp, detail, detailRequest, pageDeviceSize])

  const detailKey = detailRequest
    ? `${props.layout.index}:${renderScale.toFixed(6)}:detail-${detailRequest.stage}:${detailRequest.region.join(',')}${excludeKey}`
    : ''

  useEffect(() => {
    if (!detailRequest || !detailKey || !props.visible) return
    const priority: Priority = detailRequest.stage === 'visible' ? 0 : 1
    const finishLog = props.onRenderRequest(props.layout.index, priority, detailKey)
    const params = {
      pageIndex: props.layout.index,
      renderScale,
      deviceRect: detailRequest.region,
      excludeAnnotObjNums: excludedObjNums,
    }
    const release = props.scheduler.want(detailKey, params, priority, (bitmap) => {
      finishLog()
      setDetail({ key: detailKey, stage: detailRequest.stage, renderScale, region: detailRequest.region, bitmap })
      setHasBitmap(true)
    })
    return () => {
      finishLog()
      release()
    }
  }, [props.scheduler, props.layout.index, props.visible, props.onRenderRequest, renderScale, detailKey, detailRequest])

  useEffect(() => {
    if (detail) draw(detailRef.current, detail.bitmap)
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
      data-detail-stage={showDetail ? detail.stage : 'none'}
      style={{ top: props.layout.top, left: props.pageLeft, width: props.layout.width, height: props.layout.height }}
    >
      <span className="page-placeholder">{props.layout.index + 1}</span>
      <canvas ref={previewRef} className="preview-canvas" style={{ width: '100%', height: '100%' }} />
      {showDetail && <canvas
        ref={detailRef}
        className="detail-canvas"
        data-detail-key={detail.key}
        style={{
          left: detail.region[0] / dpr,
          top: detail.region[1] / dpr,
          width: (detail.region[2] - detail.region[0]) / dpr,
          height: (detail.region[3] - detail.region[1]) / dpr,
        }}
      />}
      <AnnotationLayer
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
      />
    </div>
  )
}
