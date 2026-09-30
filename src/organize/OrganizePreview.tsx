import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RenderScheduler } from '../client/RenderScheduler'
import type { PageSize } from '../core/mupdfDoc'
import type { AnnotationStore } from '../editor/AnnotationStore'
import type { PageCard } from './OrganizeDraft'

interface Props {
  card: PageCard
  pageSize: PageSize
  targetDocId: string
  scheduler: RenderScheduler
  annotationStore: AnnotationStore
  fit: 'width' | 'contain'
  zoom?: number
  debounceMs?: number
  className?: string
  testId: string
}

type PreviewRequestWindow = Window & { __karuOrganizePreviewRequests?: number[] }

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

export function OrganizePagePreview({
  card,
  pageSize,
  targetDocId,
  scheduler,
  annotationStore,
  fit,
  zoom = 1,
  debounceMs = 0,
  className = '',
  testId,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const highReadyRef = useRef(false)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [rendered, setRendered] = useState(false)
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
  const renderScale = cssScale * dpr

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const update = () => setBox({ width: host.clientWidth, height: host.clientHeight })
    const observer = new ResizeObserver(update)
    observer.observe(host)
    update()
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    highReadyRef.current = false
    setRendered(false)
  }, [card.id, card.rotation, renderScale])

  const draw = useCallback((bitmap: ImageBitmap, high: boolean) => {
    if (!high && highReadyRef.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    drawRotated(canvas, bitmap, card.rotation)
    if (high) {
      highReadyRef.current = true
      setRendered(true)
    }
  }, [card.rotation])

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
    return scheduler.want(thumbnail.key, thumbnail.params, 3, (bitmap) => draw(bitmap, false))
  }, [draw, scheduler, thumbnail])

  useEffect(() => {
    if (!page || !Number.isFinite(renderScale) || renderScale <= 0) return
    let release: (() => void) | undefined
    const timer = window.setTimeout(() => {
      const key = `organize-preview:${page.docId}:${page.pageIndex}:${renderScale.toFixed(6)}:x=${excludeKey}`
      if (new URLSearchParams(window.location.search).has('test')) {
        const testWindow = window as PreviewRequestWindow
        ;(testWindow.__karuOrganizePreviewRequests ??= []).push(page.pageIndex)
      }
      release = scheduler.want(key, {
        docId: page.docId,
        pageIndex: page.pageIndex,
        renderScale,
        deviceRect: null,
        excludeAnnotObjNums: excluded,
      }, 0, (bitmap) => draw(bitmap, true))
    }, debounceMs)
    return () => {
      window.clearTimeout(timer)
      release?.()
    }
  }, [debounceMs, draw, excludeKey, page?.docId, page?.pageIndex, renderScale, scheduler])

  const style = { width: shownWidth * cssScale, height: shownHeight * cssScale }
  return <div ref={hostRef} className={`organize-preview-paper ${className}`.trim()}>
    {card.source.kind === 'blank'
      ? <div className="organize-preview-blank" data-testid={testId} style={style} />
      : <canvas ref={canvasRef} className="organize-preview-canvas" data-testid={testId} data-rendered={rendered ? 'true' : 'false'} style={style} />}
  </div>
}
