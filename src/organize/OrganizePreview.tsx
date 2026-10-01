import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RenderScheduler } from '../client/RenderScheduler'
import type { PageSize } from '../core/mupdfDoc'
import type { AnnotationStore } from '../editor/AnnotationStore'
import { computeDetailRegion } from '../viewer/detailRegion'
import type { DeviceRect } from '../worker/protocol'
import type { PageCard } from './OrganizeDraft'

export const PREVIEW_ZOOM_STEPS = [1, 1.5, 2, 3, 4, 6, 8] as const
export const MAX_PREVIEW_FULL_PIXELS = 8_000_000
const DETAIL_DEBOUNCE_MS = 150

interface Props {
  card: PageCard
  pageSize: PageSize
  targetDocId: string
  scheduler: RenderScheduler
  annotationStore: AnnotationStore
  fit: 'width' | 'contain'
  zoom?: number
  onZoomChange?(zoom: number): void
  onBackgroundClick?(): void
  debounceMs?: number
  className?: string
  testId: string
}

interface DetailPlacement {
  left: number
  top: number
  width: number
  height: number
}

type PreviewRequestWindow = Window & { __karuOrganizePreviewRequests?: number[] }

export function nextPreviewZoom(zoom: number, direction: -1 | 1): number {
  if (direction > 0) return PREVIEW_ZOOM_STEPS.find((value) => value > zoom + 0.001) ?? PREVIEW_ZOOM_STEPS.at(-1)!
  return [...PREVIEW_ZOOM_STEPS].reverse().find((value) => value < zoom - 0.001) ?? PREVIEW_ZOOM_STEPS[0]
}

export function zoomedScrollPosition(scroll: number, cursor: number, oldZoom: number, newZoom: number): number {
  return Math.max(0, (scroll + cursor) * newZoom / oldZoom - cursor)
}

export function cappedFullRenderScale(pageSize: PageSize, desiredScale: number): number {
  const pageArea = Math.max(1, pageSize.width * pageSize.height)
  const safeLimit = Math.sqrt(MAX_PREVIEW_FULL_PIXELS / pageArea) * 0.999
  return Math.min(desiredScale, safeLimit)
}

function drawRotated(canvas: HTMLCanvasElement, bitmap: ImageBitmap, rotation: PageCard['rotation']): void {
  const turned = rotation === 90 || rotation === 270
  canvas.width = turned ? bitmap.height : bitmap.width
  canvas.height = turned ? bitmap.width : bitmap.height
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) return
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  if (rotation === 90) {
    context.translate(canvas.width, 0)
    context.rotate(Math.PI / 2)
  } else if (rotation === 180) {
    context.translate(canvas.width, canvas.height)
    context.rotate(Math.PI)
  } else if (rotation === 270) {
    context.translate(0, canvas.height)
    context.rotate(-Math.PI / 2)
  }
  context.drawImage(bitmap, 0, 0)
}

function clampRect(rect: DeviceRect, width: number, height: number): DeviceRect {
  return [
    Math.max(0, Math.min(width, Math.floor(rect[0]))),
    Math.max(0, Math.min(height, Math.floor(rect[1]))),
    Math.max(0, Math.min(width, Math.ceil(rect[2]))),
    Math.max(0, Math.min(height, Math.ceil(rect[3]))),
  ]
}

function toUnrotatedRect(rect: DeviceRect, width: number, height: number, rotation: PageCard['rotation']): DeviceRect {
  if (rotation === 90) return clampRect([rect[1], height - rect[2], rect[3], height - rect[0]], width, height)
  if (rotation === 180) return clampRect([width - rect[2], height - rect[3], width - rect[0], height - rect[1]], width, height)
  if (rotation === 270) return clampRect([width - rect[3], rect[0], width - rect[1], rect[2]], width, height)
  return clampRect(rect, width, height)
}

function toRotatedRect(rect: DeviceRect, width: number, height: number, rotation: PageCard['rotation']): DeviceRect {
  if (rotation === 90) return [height - rect[3], rect[0], height - rect[1], rect[2]]
  if (rotation === 180) return [width - rect[2], height - rect[3], width - rect[0], height - rect[1]]
  if (rotation === 270) return [rect[1], width - rect[2], rect[3], width - rect[0]]
  return [...rect]
}

function limitedDetailRegion(region: DeviceRect, visible: DeviceRect, pageWidth: number, pageHeight: number): DeviceRect {
  const width = region[2] - region[0]
  const height = region[3] - region[1]
  if (width * height <= MAX_PREVIEW_FULL_PIXELS) return region
  const visibleWidth = Math.max(1, visible[2] - visible[0])
  const visibleHeight = Math.max(1, visible[3] - visible[1])
  if (visibleWidth * visibleHeight >= MAX_PREVIEW_FULL_PIXELS) return visible
  const scale = Math.sqrt(MAX_PREVIEW_FULL_PIXELS / (width * height))
  let targetWidth = Math.max(visibleWidth, Math.floor(width * scale))
  let targetHeight = Math.max(visibleHeight, Math.floor(height * scale))
  if (targetWidth * targetHeight > MAX_PREVIEW_FULL_PIXELS) {
    targetHeight = Math.max(visibleHeight, Math.floor(MAX_PREVIEW_FULL_PIXELS / targetWidth))
  }
  targetWidth = Math.min(pageWidth, targetWidth)
  targetHeight = Math.min(pageHeight, targetHeight)
  const centerX = (visible[0] + visible[2]) / 2
  const centerY = (visible[1] + visible[3]) / 2
  const left = Math.max(0, Math.min(pageWidth - targetWidth, Math.floor(centerX - targetWidth / 2)))
  const top = Math.max(0, Math.min(pageHeight - targetHeight, Math.floor(centerY - targetHeight / 2)))
  return [left, top, left + targetWidth, top + targetHeight]
}

export function OrganizePagePreview({
  card,
  pageSize,
  targetDocId,
  scheduler,
  annotationStore,
  fit,
  zoom = 1,
  onZoomChange,
  onBackgroundClick,
  debounceMs = DETAIL_DEBOUNCE_MS,
  className = '',
  testId,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const baseCanvasRef = useRef<HTMLCanvasElement>(null)
  const detailCanvasRef = useRef<HTMLCanvasElement>(null)
  const baseReadyRef = useRef(false)
  const releaseRenderRef = useRef<(() => void) | null>(null)
  const requestIdentityRef = useRef(`${card.id}:${card.rotation}`)
  const renderTimerRef = useRef<number | null>(null)
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const viewCenterRef = useRef({ x: 0.5, y: 0.5 })
  const zoomAnchorRef = useRef<{ x: number; y: number; clientX: number; clientY: number } | null>(null)
  const previousLayoutRef = useRef({ cardId: card.id, rotation: card.rotation, zoom })
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [renderRevision, setRenderRevision] = useState(0)
  const [rendered, setRendered] = useState(false)
  const [baseRendered, setBaseRendered] = useState(false)
  const [detailRendered, setDetailRendered] = useState(false)
  const [basePixels, setBasePixels] = useState(0)
  const [detailPixels, setDetailPixels] = useState(0)
  const [detailPlacement, setDetailPlacement] = useState<DetailPlacement | null>(null)
  const page = card.source.kind === 'page' ? card.source : null
  const excluded = page?.docId === targetDocId ? annotationStore.touchedObjNums(page.pageIndex) : []
  const excludeKey = excluded.join('.')
  const turned = card.rotation === 90 || card.rotation === 270
  const shownWidth = turned ? pageSize.height : pageSize.width
  const shownHeight = turned ? pageSize.width : pageSize.height
  const availableWidth = Math.max(0, box.width - 24)
  const availableHeight = Math.max(0, box.height - 24)
  const fitScale = fit === 'width'
    ? availableWidth / Math.max(1, shownWidth)
    : Math.min(availableWidth / Math.max(1, shownWidth), availableHeight / Math.max(1, shownHeight))
  const cssScale = Math.max(0, fitScale) * zoom
  const dpr = window.devicePixelRatio || 1
  const desiredRenderScale = cssScale * dpr

  const updateViewCenter = useCallback(() => {
    const host = hostRef.current
    const stage = stageRef.current
    if (!host || !stage) return
    const hostRect = host.getBoundingClientRect()
    const stageRect = stage.getBoundingClientRect()
    if (stageRect.width <= 0 || stageRect.height <= 0) return
    viewCenterRef.current = {
      x: Math.max(0, Math.min(1, (hostRect.left + hostRect.width / 2 - stageRect.left) / stageRect.width)),
      y: Math.max(0, Math.min(1, (hostRect.top + hostRect.height / 2 - stageRect.top) / stageRect.height)),
    }
  }, [])

  const scheduleRender = useCallback((delay = Math.max(DETAIL_DEBOUNCE_MS, debounceMs)) => {
    if (renderTimerRef.current !== null) window.clearTimeout(renderTimerRef.current)
    renderTimerRef.current = window.setTimeout(() => {
      renderTimerRef.current = null
      setRenderRevision((value) => value + 1)
    }, delay)
  }, [debounceMs])

  useEffect(() => () => {
    if (renderTimerRef.current !== null) window.clearTimeout(renderTimerRef.current)
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const update = () => {
      setBox({ width: host.clientWidth, height: host.clientHeight })
      updateViewCenter()
    }
    const observer = new ResizeObserver(update)
    observer.observe(host)
    update()
    return () => observer.disconnect()
  }, [updateViewCenter])

  useEffect(() => {
    setRendered(false)
    setBaseRendered(false)
    setDetailRendered(false)
    const identity = `${card.id}:${card.rotation}`
    if (requestIdentityRef.current !== identity) {
      releaseRenderRef.current?.()
      releaseRenderRef.current = null
      requestIdentityRef.current = identity
    }
    scheduleRender()
  }, [card.id, card.rotation, desiredRenderScale, excludeKey, scheduleRender])

  useLayoutEffect(() => {
    const previous = previousLayoutRef.current
    const changedPage = previous.cardId !== card.id || previous.rotation !== card.rotation
    const changedZoom = previous.zoom !== zoom
    previousLayoutRef.current = { cardId: card.id, rotation: card.rotation, zoom }
    if (!changedPage && !changedZoom) return
    if (changedPage) {
      baseReadyRef.current = false
      setBasePixels(0)
      setDetailPixels(0)
      setDetailPlacement(null)
      const base = baseCanvasRef.current
      const detail = detailCanvasRef.current
      if (base) { base.width = 0; base.height = 0 }
      if (detail) { detail.width = 0; detail.height = 0 }
    }
    const frame = requestAnimationFrame(() => {
      const host = hostRef.current
      const stage = stageRef.current
      if (!host || !stage) return
      const hostRect = host.getBoundingClientRect()
      const anchor = zoomAnchorRef.current
      const x = anchor?.x ?? viewCenterRef.current.x
      const y = anchor?.y ?? viewCenterRef.current.y
      const clientX = anchor?.clientX ?? hostRect.left + hostRect.width / 2
      const clientY = anchor?.clientY ?? hostRect.top + hostRect.height / 2
      if (changedZoom && previous.zoom > 0) {
        host.scrollLeft = zoomedScrollPosition(host.scrollLeft, clientX - hostRect.left, previous.zoom, zoom)
        host.scrollTop = zoomedScrollPosition(host.scrollTop, clientY - hostRect.top, previous.zoom, zoom)
      }
      const stageRect = stage.getBoundingClientRect()
      host.scrollLeft += stageRect.left + stageRect.width * x - clientX
      host.scrollTop += stageRect.top + stageRect.height * y - clientY
      zoomAnchorRef.current = null
      updateViewCenter()
    })
    return () => cancelAnimationFrame(frame)
  }, [card.id, card.rotation, updateViewCenter, zoom])

  const thumbnail = useMemo(() => {
    if (!page) return null
    const scale = 512 / Math.max(pageSize.width, pageSize.height)
    const baseKey = `${page.pageIndex}:${scale.toFixed(6)}:full:x=${excludeKey}`
    return {
      key: page.docId === targetDocId ? baseKey : `source:${page.docId}:${baseKey}`,
      params: { docId: page.docId, pageIndex: page.pageIndex, renderScale: scale, deviceRect: null, excludeAnnotObjNums: excluded },
    }
  }, [excludeKey, page?.docId, page?.pageIndex, pageSize.height, pageSize.width, targetDocId])

  useEffect(() => {
    if (!thumbnail) return
    return scheduler.want(thumbnail.key, thumbnail.params, 3, (bitmap) => {
      if (baseReadyRef.current || !baseCanvasRef.current) return
      drawRotated(baseCanvasRef.current, bitmap, card.rotation)
      setBasePixels(bitmap.width * bitmap.height)
    })
  }, [card.rotation, scheduler, thumbnail])

  useEffect(() => {
    if (!page || !Number.isFinite(desiredRenderScale) || desiredRenderScale <= 0) return
    releaseRenderRef.current?.()
    releaseRenderRef.current = null
    const host = hostRef.current
    const stage = stageRef.current
    if (!host || !stage) return
    const hostRect = host.getBoundingClientRect()
    const stageRect = stage.getBoundingClientRect()
    const unrotatedWidth = Math.max(1, Math.ceil(pageSize.width * desiredRenderScale))
    const unrotatedHeight = Math.max(1, Math.ceil(pageSize.height * desiredRenderScale))
    const rotatedWidth = turned ? unrotatedHeight : unrotatedWidth
    const rotatedHeight = turned ? unrotatedWidth : unrotatedHeight
    const visibleRotated = clampRect([
      (hostRect.left - stageRect.left) * dpr,
      (hostRect.top - stageRect.top) * dpr,
      (hostRect.right - stageRect.left) * dpr,
      (hostRect.bottom - stageRect.top) * dpr,
    ], rotatedWidth, rotatedHeight)
    const baseScale = cappedFullRenderScale(pageSize, desiredRenderScale)
    const needsDetail = baseScale < desiredRenderScale * 0.9999
    let active = true
    const releases: Array<() => void> = []
    setDetailRendered(false)

    if (needsDetail && visibleRotated[2] > visibleRotated[0] && visibleRotated[3] > visibleRotated[1]) {
      const visible = toUnrotatedRect(visibleRotated, unrotatedWidth, unrotatedHeight, card.rotation)
      const expanded = computeDetailRegion(visible, { width: unrotatedWidth, height: unrotatedHeight })
      const region = limitedDetailRegion(expanded, visible, unrotatedWidth, unrotatedHeight)
      const rotated = toRotatedRect(region, unrotatedWidth, unrotatedHeight, card.rotation)
      const key = `organize-preview-detail:${page.docId}:${page.pageIndex}:${desiredRenderScale.toFixed(6)}:${region.join(',')}:x=${excludeKey}`
      if (new URLSearchParams(window.location.search).has('test')) {
        const testWindow = window as PreviewRequestWindow
        ;(testWindow.__karuOrganizePreviewRequests ??= []).push(page.pageIndex)
      }
      releases.push(scheduler.want(key, {
        docId: page.docId,
        pageIndex: page.pageIndex,
        renderScale: desiredRenderScale,
        deviceRect: region,
        excludeAnnotObjNums: excluded,
      }, 0, (bitmap) => {
        if (!active || !detailCanvasRef.current) return
        drawRotated(detailCanvasRef.current, bitmap, card.rotation)
        setDetailPlacement({
          left: rotated[0] / rotatedWidth * 100,
          top: rotated[1] / rotatedHeight * 100,
          width: (rotated[2] - rotated[0]) / rotatedWidth * 100,
          height: (rotated[3] - rotated[1]) / rotatedHeight * 100,
        })
        setDetailPixels(bitmap.width * bitmap.height)
        setDetailRendered(true)
        setRendered(true)
      }))
    } else {
      setDetailPlacement(null)
      setDetailPixels(0)
      if (new URLSearchParams(window.location.search).has('test')) {
        const testWindow = window as PreviewRequestWindow
        ;(testWindow.__karuOrganizePreviewRequests ??= []).push(page.pageIndex)
      }
    }

    const baseKey = `organize-preview-base:${page.docId}:${page.pageIndex}:${baseScale.toFixed(6)}:x=${excludeKey}`
    releases.push(scheduler.want(baseKey, {
      docId: page.docId,
      pageIndex: page.pageIndex,
      renderScale: baseScale,
      deviceRect: null,
      excludeAnnotObjNums: excluded,
    }, needsDetail ? 1 : 0, (bitmap) => {
      if (!active || !baseCanvasRef.current) return
      drawRotated(baseCanvasRef.current, bitmap, card.rotation)
      baseReadyRef.current = true
      setBasePixels(bitmap.width * bitmap.height)
      setBaseRendered(true)
      if (!needsDetail) setRendered(true)
    }))

    const releaseAll = () => {
      if (!active) return
      active = false
      for (const release of releases) release()
    }
    releaseRenderRef.current = releaseAll
    return releaseAll
  }, [renderRevision, scheduler])

  const style = { width: shownWidth * cssScale, height: shownHeight * cssScale }
  const detailStyle = detailPlacement ? {
    left: `${detailPlacement.left}%`, top: `${detailPlacement.top}%`,
    width: `${detailPlacement.width}%`, height: `${detailPlacement.height}%`,
  } : undefined

  return <div
    ref={hostRef}
    className={`organize-preview-paper${zoom > 1 ? ' zoomed' : ''} ${className}`.trim()}
    onScroll={() => {
      updateViewCenter()
      setRendered(false)
      setDetailRendered(false)
      scheduleRender()
    }}
    onWheel={(event) => {
      if (!event.ctrlKey || !onZoomChange) return
      event.preventDefault()
      const next = nextPreviewZoom(zoom, event.deltaY < 0 ? 1 : -1)
      if (next === zoom) return
      const stage = stageRef.current
      if (stage) {
        const rect = stage.getBoundingClientRect()
        zoomAnchorRef.current = {
          x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
          y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))),
          clientX: event.clientX,
          clientY: event.clientY,
        }
      }
      onZoomChange(next)
    }}
    onPointerDown={(event) => {
      if (zoom <= 1 || event.button !== 0) return
      const host = event.currentTarget
      host.setPointerCapture(event.pointerId)
      host.classList.add('panning')
      panRef.current = { x: event.clientX, y: event.clientY, left: host.scrollLeft, top: host.scrollTop }
    }}
    onPointerMove={(event) => {
      const start = panRef.current
      if (!start) return
      event.currentTarget.scrollLeft = start.left - (event.clientX - start.x)
      event.currentTarget.scrollTop = start.top - (event.clientY - start.y)
    }}
    onPointerUp={(event) => {
      panRef.current = null
      event.currentTarget.classList.remove('panning')
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    }}
    onPointerCancel={(event) => {
      panRef.current = null
      event.currentTarget.classList.remove('panning')
    }}
    onClick={(event) => { if (event.target === event.currentTarget) onBackgroundClick?.() }}
  >
    <div ref={stageRef} className="organize-preview-stage" style={style}>
      {card.source.kind === 'blank'
        ? <div className="organize-preview-blank" data-testid={testId} />
        : <>
          <canvas
            ref={baseCanvasRef}
            className="organize-preview-canvas"
            data-testid={testId}
            data-rendered={rendered ? 'true' : 'false'}
            data-base-rendered={baseRendered ? 'true' : 'false'}
            data-detail-rendered={detailRendered ? 'true' : 'false'}
            data-base-pixels={basePixels}
            data-detail-pixels={detailPixels}
          />
          <canvas ref={detailCanvasRef} className="organize-preview-detail" style={detailStyle} />
        </>}
    </div>
  </div>
}
