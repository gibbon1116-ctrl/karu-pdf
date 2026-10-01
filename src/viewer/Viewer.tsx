import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { PdfWorkerPool, WorkerRenderLogEntry } from '../client/PdfWorkerPool'
import type { RenderScheduler } from '../client/RenderScheduler'
import type { PageSize } from '../core/mupdfDoc'
import type { SearchMatch } from '../core/search'
import { EditorToolChangeContext, type EditorTool } from '../editor/AnnotationLayer'
import type { AnnotationStore } from '../editor/AnnotationStore'
import type { FormatDefaults } from '../editor/formatDefaults'
import { getMetrics, recordBlankFrame, recordMetric, resetBlankFrames, startMeasure } from '../perf/metrics'
import type { Priority } from '../worker/protocol'
import { BitmapCache } from './BitmapCache'
import { type Box } from './detailRegion'
import { getDetailRecoveryCount, subscribeDetailRecovery } from './detailRequestSync'
import { computePageLayout, CSS_PX_PER_PT, pagesInRange, type PageLayout } from './pageLayout'
import { PageView } from './PageView'
import { mapViewPosition, readViewPosition, type ViewPosition } from './viewSync'

export const ZOOM_STEPS = [0.25, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8]

export interface ViewerHandle {
  setZoom(zoom: number, anchor?: { x: number; y: number }): void
  zoomIn(): void
  zoomOut(): void
  fitWidth(): void
  scrollToPage(index: number): void
  scrollToPosition(index: number, x: number | null, y: number | null): void
  isIdle(): boolean
  isSharp(): boolean
  getZoom(): number
  getCache(): BitmapCache
  commitEditor(): Promise<void>
  editAnnotation(id: string): void
  clearSelection(): void
  getViewPosition(): ViewPosition
  applyViewPosition(position: ViewPosition): void
}

interface Props {
  readOnly?: boolean
  renderRevisions?: ReadonlyMap<number, number>
  onViewChange?(): void
  onViewInteraction?(): void
  docId: string
  pool: PdfWorkerPool
  scheduler: RenderScheduler
  annotationStore: AnnotationStore
  formatDefaults: FormatDefaults
  tool: EditorTool
  initialView: { page: number; zoom: number; scrollLeft?: number; scrollTop?: number } | null
  pageSizes: PageSize[]
  selectedAnnotationId: string | null
  searchMatches: SearchMatch[]
  activeSearchIndex: number
  onSelectAnnotation(id: string | null): void
  onToolChange(tool: EditorTool): void
  onZoomChange(zoom: number): void
  onPageChange(page: number): void
  onScrollPositionChange(left: number, top: number): void
  onFirstBitmap(): void
  onFirstSharp(): void
  onStatus(message: string): void
}

interface PrefetchEntry {
  priority: Priority
  key: string
  release(): void
}

interface RenderRequestLogEntry {
  worker: number
  priority: Priority
  key: string
  startMs: number
  endMs: number | null
}

function visiblePages(layout: ReturnType<typeof computePageLayout>, viewport: Box): PageLayout[] {
  const contentWidth = Math.max(layout.maxWidth, viewport.width)
  return pagesInRange(layout.pages, viewport.y, viewport.y + viewport.height).filter((page) => {
    const left = (contentWidth - page.width) / 2
    return page.top + page.height > viewport.y
      && page.top < viewport.y + viewport.height
      && left + page.width > viewport.x
      && left < viewport.x + viewport.width
  })
}

type RenderLogWindow = Window & typeof globalThis & {
  __karuRenderRequests?: RenderRequestLogEntry[]
  __karuWorkerRenderRequests?: readonly WorkerRenderLogEntry[]
  __karuGetDetailRecoveryCount?: () => number
}

export const Viewer = forwardRef<ViewerHandle, Props>(function Viewer(props, ref) {
  const initialZoom = Math.max(0.25, Math.min(8, props.initialView?.zoom ?? 1))
  const initialLayout = computePageLayout(props.pageSizes, initialZoom)
  const initialPageIndex = Math.max(0, Math.min(props.pageSizes.length - 1, (props.initialView?.page ?? 1) - 1))
  const initialTop = props.initialView?.scrollTop ?? initialLayout.pages[initialPageIndex]?.top ?? 0
  const annotationVersion = useSyncExternalStore(props.annotationStore.subscribe, props.annotationStore.getSnapshot)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const prefetchRef = useRef(new Map<number, PrefetchEntry>())
  const warmReleasesRef = useRef<Array<() => void>>([])
  const firstBitmapRef = useRef(false)
  const firstSharpRef = useRef(false)
  const zoomTimerRef = useRef<number | undefined>(undefined)
  const blankRafRef = useRef(0)
  const scrollStopTimerRef = useRef<number | undefined>(undefined)
  const panSequenceRef = useRef(0)
  const zoomSequenceRef = useRef(0)
  const lastPositionRef = useRef({ left: props.initialView?.scrollLeft ?? 0, top: initialTop })
  const horizontalScrollRef = useRef(false)
  const suppressPanUntilRef = useRef(0)
  const ignoreScrollForPrefetchRef = useRef(false)
  const scrollSampleRef = useRef({ top: initialTop, at: performance.now() })
  const renderRequestLogRef = useRef<RenderRequestLogEntry[]>([])
  const editorCommitRef = useRef<(() => Promise<void>) | null>(null)
  const initialPositionAppliedRef = useRef(false)
  const zoomRef = useRef(initialZoom)
  const syncMutedRef = useRef(false)
  const syncFrameRef = useRef(0)
  const layoutRef = useRef(initialLayout)
  const [zoom, setZoomState] = useState(initialZoom)
  const [committedZoom, setCommittedZoom] = useState(initialZoom)
  const [viewport, setViewport] = useState<Box>({ x: 0, y: initialTop, width: 800, height: 600 })
  const [scrollDirection, setScrollDirection] = useState<1 | -1>(1)
  const [isScrolling, setIsScrolling] = useState(false)
  const [prefetchDistance, setPrefetchDistance] = useState(4)
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null)
  const [debugPanelTarget, setDebugPanelTarget] = useState<HTMLElement | null>(null)
  const detailRecoveryCount = useSyncExternalStore(
    subscribeDetailRecovery,
    getDetailRecoveryCount,
    getDetailRecoveryCount,
  )

  const scheduler = props.scheduler
  ;(window as RenderLogWindow).__karuWorkerRenderRequests = props.pool.renderLog()
  const warmEnabled = new URLSearchParams(location.search).get('warm') === '1'
  const debugEnabled = new URLSearchParams(location.search).get('debug') === '1'
  const layout = useMemo(() => computePageLayout(props.pageSizes, zoom), [props.pageSizes, zoom])
  layoutRef.current = layout
  const scroller = scrollerRef.current
  const renderedViewport = scroller
    ? { x: scroller.scrollLeft, y: scroller.scrollTop, width: scroller.clientWidth, height: scroller.clientHeight }
    : viewport
  const contentWidth = Math.max(layout.maxWidth, viewport.width)
  const virtualPages = useMemo(
    () => pagesInRange(layout.pages, Math.max(0, renderedViewport.y - renderedViewport.height * 2), renderedViewport.y + renderedViewport.height * 3),
    [layout.pages, renderedViewport.y, renderedViewport.height],
  )
  const visibleIndexes = useMemo(() => new Set(
    visiblePages(layout, renderedViewport).map((page) => page.index),
  ), [layout, renderedViewport.x, renderedViewport.y, renderedViewport.width, renderedViewport.height])

  useEffect(() => {
    const target = window as RenderLogWindow
    const getter = () => getDetailRecoveryCount()
    target.__karuGetDetailRecoveryCount = getter
    return () => {
      if (target.__karuGetDetailRecoveryCount === getter) delete target.__karuGetDetailRecoveryCount
    }
  }, [])

  useEffect(() => {
    if (!debugEnabled) {
      setDebugPanelTarget(null)
      return
    }
    const frame = requestAnimationFrame(() => setDebugPanelTarget(document.querySelector<HTMLElement>('[data-testid="debug-panel"]')))
    return () => cancelAnimationFrame(frame)
  }, [debugEnabled])

  const onRenderRequest = useCallback((pageIndex: number, priority: Priority, key: string) => {
    const entry: RenderRequestLogEntry = {
      worker: props.pool.workerIndexForPage(props.docId, pageIndex),
      priority,
      key,
      startMs: performance.now(),
      endMs: null,
    }
    renderRequestLogRef.current.push(entry)
    ;(window as RenderLogWindow).__karuRenderRequests = renderRequestLogRef.current
    return () => {
      if (entry.endMs === null) entry.endMs = performance.now()
    }
  }, [props.docId, props.pool])

  const isSharpNow = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller || props.pageSizes.length === 0) return true
    const visible = visiblePages(layoutRef.current, {
      x: scroller.scrollLeft,
      y: scroller.scrollTop,
      width: scroller.clientWidth,
      height: scroller.clientHeight,
    })
    if (visible.length === 0) return true
    return visible.every((page) => scroller.querySelector<HTMLElement>(`.page-view[data-page-index="${page.index}"]`)?.dataset.sharp === 'true')
  }, [props.pageSizes.length])

  const waitForSharp = useCallback((metric: 'zoom-settle' | 'pan-settle', sequence: number, finish: () => number) => {
    const check = () => {
      const current = metric === 'zoom-settle' ? zoomSequenceRef.current : panSequenceRef.current
      if (current !== sequence) return
      if (isSharpNow()) {
        finish()
        return
      }
      requestAnimationFrame(check)
    }
    requestAnimationFrame(check)
  }, [isSharpNow])

  const commitZoom = useCallback((next: number) => {
    window.clearTimeout(zoomTimerRef.current)
    zoomTimerRef.current = window.setTimeout(() => {
      const sequence = ++zoomSequenceRef.current
      const finish = startMeasure('zoom-settle')
      setCommittedZoom(next)
      requestAnimationFrame(() => waitForSharp('zoom-settle', sequence, finish))
    }, 150)
  }, [waitForSharp])

  const beginInteraction = useCallback(() => {
    if (syncFrameRef.current) {
      cancelAnimationFrame(syncFrameRef.current)
      syncFrameRef.current = 0
    }
    syncMutedRef.current = false
    props.onViewInteraction?.()
  }, [props.onViewInteraction])

  const setZoom = useCallback((next: number, anchor?: { x: number; y: number }, positionFromSync = false) => {
    const scroller = scrollerRef.current
    const bounded = Math.max(0.25, Math.min(8, next))
    const previousZoom = zoomRef.current
    zoomRef.current = bounded
    for (const entry of prefetchRef.current.values()) entry.release()
    prefetchRef.current.clear()
    suppressPanUntilRef.current = performance.now() + 400
    if (scroller) {
      const x = anchor?.x ?? scroller.clientWidth / 2
      const y = anchor?.y ?? scroller.clientHeight / 2
      const ratio = bounded / previousZoom
      const previousLayout = layoutRef.current
      const nextLayout = computePageLayout(props.pageSizes, bounded)
      const anchorY = scroller.scrollTop + y
      const previousPage = previousLayout.pages.find((page) => page.top <= anchorY && page.top + page.height >= anchorY)
        ?? pagesInRange(previousLayout.pages, scroller.scrollTop, scroller.scrollTop + scroller.clientHeight)[0]
      const nextPage = previousPage ? nextLayout.pages[previousPage.index] : undefined
      const previousContentWidth = Math.max(previousLayout.maxWidth, scroller.clientWidth)
      const nextContentWidth = Math.max(nextLayout.maxWidth, scroller.clientWidth)
      const previousPageLeft = previousPage ? (previousContentWidth - previousPage.width) / 2 : 0
      const nextPageLeft = nextPage ? (nextContentWidth - nextPage.width) / 2 : 0
      const nextLeft = previousPage && nextPage
        ? nextPageLeft + (scroller.scrollLeft + x - previousPageLeft) * ratio - x
        : (scroller.scrollLeft + x) * ratio - x
      const nextTop = previousPage && nextPage
        ? nextPage.top + (anchorY - previousPage.top) * ratio - y
        : (scroller.scrollTop + y) * ratio - y
      lastPositionRef.current = { left: nextLeft, top: nextTop }
      setViewport({ x: nextLeft, y: nextTop, width: scroller.clientWidth, height: scroller.clientHeight })
      setZoomState(bounded)
      if (!positionFromSync) requestAnimationFrame(() => {
        scroller.scrollLeft = nextLeft
        scroller.scrollTop = nextTop
        const actual = { left: scroller.scrollLeft, top: scroller.scrollTop }
        lastPositionRef.current = actual
        setViewport({ x: actual.left, y: actual.top, width: scroller.clientWidth, height: scroller.clientHeight })
        props.onScrollPositionChange(actual.left, actual.top)
        if (!syncMutedRef.current) props.onViewChange?.()
      })
    } else setZoomState(bounded)
    props.onZoomChange(bounded)
    commitZoom(bounded)
  }, [commitZoom, props.onScrollPositionChange, props.onZoomChange, props.pageSizes, props.onViewChange])

  const fitWidth = useCallback(() => {
    beginInteraction()
    const scroller = scrollerRef.current
    if (!scroller || props.pageSizes.length === 0) return
    resetBlankFrames()
    const widest = Math.max(...props.pageSizes.map((page) => page.width))
    setZoom((scroller.clientWidth - 32) / (widest * 96 / 72))
  }, [props.pageSizes, setZoom, beginInteraction])

  const stepZoom = useCallback((direction: -1 | 1) => {
    beginInteraction()
    const currentZoom = zoomRef.current
    const next = direction > 0
      ? ZOOM_STEPS.find((step) => step > currentZoom + 0.001) ?? 8
      : [...ZOOM_STEPS].reverse().find((step) => step < currentZoom - 0.001) ?? 0.25
    setZoom(next)
  }, [setZoom, beginInteraction])

  const updateViewport = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const previous = lastPositionRef.current
    const next = { left: scroller.scrollLeft, top: scroller.scrollTop }
    if (next.top !== previous.top) setScrollDirection(next.top > previous.top ? 1 : -1)
    if (Math.abs(next.left - previous.left) > Math.abs(next.top - previous.top) && Math.abs(next.left - previous.left) > 0.5) {
      horizontalScrollRef.current = true
    }
    lastPositionRef.current = next
    props.onScrollPositionChange(next.left, next.top)
    setViewport({ x: next.left, y: next.top, width: scroller.clientWidth, height: scroller.clientHeight })
    let current = layoutRef.current.pages[0]
    for (const candidate of layoutRef.current.pages) {
      if (candidate.top > next.top + scroller.clientHeight / 3) break
      current = candidate
    }
    props.onPageChange((current?.index ?? 0) + 1)
    if (!syncMutedRef.current) props.onViewChange?.()
  }, [props.onPageChange, props.onScrollPositionChange, props.onViewChange])

  useLayoutEffect(() => {
    updateViewport()
  }, [layout, committedZoom, updateViewport])

  const sampleBlankFrame = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const visible = pagesInRange(layoutRef.current.pages, scroller.scrollTop, scroller.scrollTop + scroller.clientHeight)
    const blank = visible.length === 0 || visible.some((page) => {
      const element = scroller.querySelector<HTMLElement>(`.page-view[data-page-index="${page.index}"]`)
      return !element || element.dataset.hasBitmap !== 'true'
    })
    recordBlankFrame(blank)
  }, [])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const blankLoop = () => {
      sampleBlankFrame()
      blankRafRef.current = requestAnimationFrame(blankLoop)
    }
    const onScroll = () => {
      const now = performance.now()
      // In split mode a layout effect may already have updated the viewport
      // before the native scroll event. Keep the speed sample independent, or
      // the next small movement incorrectly includes the preceding page jump.
      const previousTop = props.onViewChange ? scrollSampleRef.current.top : lastPositionRef.current.top
      const verticalMovement = Math.abs(scroller.scrollTop - previousTop) > 0.5
      updateViewport()
      if (verticalMovement && !ignoreScrollForPrefetchRef.current && performance.now() >= suppressPanUntilRef.current) {
        const elapsed = Math.max(16, now - scrollSampleRef.current.at)
        const speed = Math.abs(scroller.scrollTop - scrollSampleRef.current.top) * 1000 / elapsed
        setPrefetchDistance(speed <= 2200 ? 10 : 4)
        setIsScrolling(true)
      }
      if (verticalMovement) scrollSampleRef.current = { top: scroller.scrollTop, at: now }
      if (!blankRafRef.current) blankRafRef.current = requestAnimationFrame(blankLoop)
      window.clearTimeout(scrollStopTimerRef.current)
      const settleScroll = () => {
        const suppressedFor = suppressPanUntilRef.current - performance.now()
        if (horizontalScrollRef.current && suppressedFor > 0) {
          scrollStopTimerRef.current = window.setTimeout(settleScroll, suppressedFor)
          return
        }
        setIsScrolling(false)
        setPrefetchDistance(4)
        cancelAnimationFrame(blankRafRef.current)
        blankRafRef.current = 0
        recordBlankFrame(false)
        if (horizontalScrollRef.current) {
          const sequence = ++panSequenceRef.current
          const finish = startMeasure('pan-settle')
          waitForSharp('pan-settle', sequence, finish)
        }
        horizontalScrollRef.current = false
      }
      scrollStopTimerRef.current = window.setTimeout(settleScroll, 100)
    }
    const resize = new ResizeObserver(updateViewport)
    resize.observe(scroller)
    scroller.addEventListener('scroll', onScroll, { passive: true })
    updateViewport()
    return () => {
      resize.disconnect()
      scroller.removeEventListener('scroll', onScroll)
      window.clearTimeout(scrollStopTimerRef.current)
      cancelAnimationFrame(blankRafRef.current)
      blankRafRef.current = 0
    }
  }, [sampleBlankFrame, updateViewport, waitForSharp])

  useEffect(() => {
    if (props.readOnly) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isInput = target?.matches('input, textarea, [contenteditable="true"]') ?? false
      if (isInput || editingAnnotationId) return
      if (event.key === 'Escape') {
        props.onSelectAnnotation(null)
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && props.selectedAnnotationId) {
        event.preventDefault()
        props.annotationStore.remove(props.selectedAnnotationId)
        props.onSelectAnnotation(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editingAnnotationId, props.annotationStore, props.onSelectAnnotation, props.selectedAnnotationId])

  useLayoutEffect(() => {
    if (props.pageSizes.length === 0 || initialPositionAppliedRef.current) return
    initialPositionAppliedRef.current = true
    if (props.initialView) {
      const target = layoutRef.current.pages[initialPageIndex]
      if (scrollerRef.current && target) {
        const top = props.initialView.scrollTop ?? target.top
        const left = props.initialView.scrollLeft ?? 0
        scrollerRef.current.scrollTop = top
        scrollerRef.current.scrollLeft = left
        lastPositionRef.current = { left, top }
        updateViewport()
      }
    } else {
      fitWidth()
    }
    firstBitmapRef.current = false
    firstSharpRef.current = false
  }, [fitWidth, initialPageIndex, props.initialView, props.pageSizes, updateViewport])

  useEffect(() => {
    const desired = new Map<number, { priority: Priority; key: string; excluded: number[] }>()
    const start = scrollDirection > 0
      ? Math.max(0, viewport.y - viewport.height)
      : Math.max(0, viewport.y - viewport.height * 3)
    const end = scrollDirection > 0
      ? viewport.y + viewport.height * (zoom > 1.5 ? 2 : isScrolling ? prefetchDistance : 4)
      : viewport.y + viewport.height * 2
    for (const page of pagesInRange(layout.pages, start, end)) {
      const behind = scrollDirection > 0
        ? page.top + page.height < viewport.y
        : page.top > viewport.y + viewport.height
      const priority: Priority = behind ? 2 : 1
      const size = props.pageSizes[page.index]
      const scale = 512 / Math.max(size.width, size.height)
      const excluded = props.readOnly ? [] : props.annotationStore.touchedObjNums(page.index)
      const revision = props.renderRevisions?.get(page.index)
      const key = `${page.index}:${scale.toFixed(6)}:full:x=${excluded.join('.')}${revision ? `:v=${revision}` : ''}`
      desired.set(page.index, { priority, key, excluded })
    }

    for (const [pageIndex, entry] of prefetchRef.current) {
      const wanted = desired.get(pageIndex)
      if (!wanted || wanted.priority !== entry.priority || wanted.key !== entry.key) {
        entry.release()
        prefetchRef.current.delete(pageIndex)
      }
    }
    for (const [pageIndex, wanted] of desired) {
      if (prefetchRef.current.has(pageIndex)) continue
      const size = props.pageSizes[pageIndex]
      const scale = 512 / Math.max(size.width, size.height)
      const params = { docId: props.docId, pageIndex, renderScale: scale, deviceRect: null, excludeAnnotObjNums: wanted.excluded }
      const release = scheduler.want(wanted.key, params, wanted.priority, () => undefined)
      prefetchRef.current.set(pageIndex, { priority: wanted.priority, key: wanted.key, release })
    }
  }, [scheduler, layout.pages, props.docId, props.pageSizes, props.annotationStore, annotationVersion, viewport.y, viewport.height, scrollDirection, zoom, isScrolling, prefetchDistance])

  useEffect(() => {
    if (!warmEnabled || props.pageSizes.length === 0) return
    const center = pagesInRange(layout.pages, viewport.y, viewport.y + viewport.height)[0]?.index ?? 0
    const order = props.pageSizes.map((_, index) => index).sort((a, b) => Math.abs(a - center) - Math.abs(b - center))
    warmReleasesRef.current = order.map((pageIndex) => {
      const size = props.pageSizes[pageIndex]
      const scale = 256 / Math.max(size.width, size.height)
      const excluded = props.readOnly ? [] : props.annotationStore.touchedObjNums(pageIndex)
      const revision = props.renderRevisions?.get(pageIndex)
      const key = `warm:${pageIndex}:${scale.toFixed(6)}:full:x=${excluded.join('.')}${revision ? `:v=${revision}` : ''}`
      const params = { docId: props.docId, pageIndex, renderScale: scale, deviceRect: null, excludeAnnotObjNums: excluded }
      return scheduler.want(key, params, 3, () => undefined)
    })
    return () => {
      for (const release of warmReleasesRef.current) release()
      warmReleasesRef.current = []
    }
  }, [warmEnabled, props.docId, props.pageSizes, props.annotationStore, annotationVersion, scheduler])

  useEffect(() => () => {
    window.clearTimeout(zoomTimerRef.current)
    cancelAnimationFrame(syncFrameRef.current)
    for (const entry of prefetchRef.current.values()) entry.release()
  }, [scheduler])

  const onSharpChange = useCallback((pageIndex: number, sharp: boolean) => {
    if (pageIndex === initialPageIndex && sharp && !firstSharpRef.current) {
      firstSharpRef.current = true
      props.onFirstSharp()
    }
  }, [initialPageIndex, props.onFirstSharp])

  const pending = scheduler.pendingCount()
  void pending

  useImperativeHandle(ref, () => ({
    setZoom: (value, anchor) => {
      beginInteraction()
      setZoom(value, anchor)
    },
    zoomIn: () => stepZoom(1),
    zoomOut: () => stepZoom(-1),
    fitWidth,
    scrollToPage: (index) => {
      beginInteraction()
      const page = layoutRef.current.pages[Math.max(0, Math.min(layoutRef.current.pages.length - 1, index))]
      ignoreScrollForPrefetchRef.current = true
      scrollerRef.current?.scrollTo({ top: page?.top ?? 0 })
      requestAnimationFrame(() => {
        updateViewport()
        ignoreScrollForPrefetchRef.current = false
      })
    },
    scrollToPosition: (index, x, y) => {
      beginInteraction()
      const currentLayout = layoutRef.current
      const page = currentLayout.pages[Math.max(0, Math.min(currentLayout.pages.length - 1, index))]
      const scroller = scrollerRef.current
      if (!page || !scroller) return
      const content = Math.max(currentLayout.maxWidth, scroller.clientWidth)
      const pageLeft = (content - page.width) / 2
      ignoreScrollForPrefetchRef.current = true
      scroller.scrollTo({
        top: Math.max(0, page.top + (y ?? 0) * CSS_PX_PER_PT * zoomRef.current - scroller.clientHeight / 3),
        left: Math.max(0, pageLeft + (x ?? 0) * CSS_PX_PER_PT * zoomRef.current - scroller.clientWidth / 2),
      })
      requestAnimationFrame(() => {
        updateViewport()
        ignoreScrollForPrefetchRef.current = false
      })
    },
    isIdle: () => scheduler.pendingCount() === 0,
    isSharp: isSharpNow,
    getZoom: () => zoomRef.current,
    getCache: () => scheduler.cache,
    editAnnotation: (id) => setEditingAnnotationId(id),
    commitEditor: () => editorCommitRef.current?.() ?? Promise.resolve(),
    clearSelection: () => {
      props.onSelectAnnotation(null)
      setEditingAnnotationId(null)
    },
    getViewPosition: () => {
      const el = scrollerRef.current
      return { ...readViewPosition(props.pageSizes, zoomRef.current, el?.scrollLeft ?? 0, el?.scrollTop ?? 0, el?.clientWidth ?? 800, el?.clientHeight ?? 600), scrolling: isScrolling }
    },
    applyViewPosition: (position) => {
      const el = scrollerRef.current
      if (!el) return
      syncMutedRef.current = true
      const mapped = mapViewPosition(position, props.pageSizes, el.clientWidth, el.clientHeight)
      // The target may render its new visible page before its native scroll
      // event arrives. Carry the driver's phase so it cannot enqueue a sharp
      // whole-page render ahead of the two panes' first paints.
      if (position.scrolling && Math.abs(mapped.top - el.scrollTop) > .5) setIsScrolling(true)
      if (Math.abs(mapped.zoom - zoomRef.current) > .00001) setZoom(mapped.zoom, undefined, true)
      else if (Math.abs(mapped.top - el.scrollTop) > .5) {
        // A new vertical move from the driver is scrolling, even if this pane
        // recently received a zoom. Do not let its old 400ms pan guard suppress
        // the native scroll handler's ordinary-scroll prefetch.
        suppressPanUntilRef.current = 0
      }
      cancelAnimationFrame(syncFrameRef.current)
      syncFrameRef.current = requestAnimationFrame(() => {
        syncFrameRef.current = 0
        const previousLeft = el.scrollLeft, previousTop = el.scrollTop
        el.scrollLeft = mapped.left
        el.scrollTop = mapped.top
        // Let the native scroll handler sample the actual movement and expand
        // prefetch for ordinary scrolling. Updating lastPosition here first
        // would make the following scroll event look motionless in this pane.
        if (el.scrollLeft === previousLeft && el.scrollTop === previousTop) updateViewport()
      })
    },
  }), [beginInteraction, fitWidth, isSharpNow, isScrolling, props.onSelectAnnotation, props.pageSizes, scheduler, setZoom, stepZoom, updateViewport])

  const registerEditorCommit = useCallback((commit: (() => Promise<void>) | null) => {
    editorCommitRef.current = commit
  }, [])

  const firstBitmap = () => {
    if (firstBitmapRef.current) return
    firstBitmapRef.current = true
    props.onFirstBitmap()
  }

  const pagePriority = (pageTop: number, pageHeight: number, visible: boolean): Priority => {
    if (visible) return 0
    if (scrollDirection > 0) return pageTop >= viewport.y + viewport.height ? 1 : 2
    return pageTop + pageHeight <= viewport.y ? 1 : 2
  }

  return (
    <EditorToolChangeContext.Provider value={props.onToolChange}>
      <div
      ref={scrollerRef}
      className="viewer"
      data-testid={props.readOnly ? 'right-viewer' : 'viewer'}
      data-doc-id={props.docId}
      data-zoom={zoom}
      tabIndex={0}
      aria-label={props.readOnly ? '右のPDF表示（閲覧専用）' : 'PDF表示'}
      onPointerDown={() => {
        beginInteraction()
        if (props.readOnly) scrollerRef.current?.focus({ preventScroll: true })
      }}
      onKeyDown={(event) => {
        if (!props.readOnly || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'].includes(event.key)) return
        event.preventDefault()
        event.stopPropagation()
        beginInteraction()
        const el = event.currentTarget
        const delta = event.key.startsWith('Page') ? el.clientHeight * .9 : 40
        el.scrollBy({ top: ['ArrowUp', 'PageUp'].includes(event.key) ? -delta : ['ArrowDown', 'PageDown'].includes(event.key) ? delta : 0, left: event.key === 'ArrowLeft' ? -40 : event.key === 'ArrowRight' ? 40 : 0 })
      }}
      onWheel={(event) => {
        beginInteraction()
        if (!event.ctrlKey) return
        event.preventDefault()
        const rect = event.currentTarget.getBoundingClientRect()
        setZoom(zoomRef.current * (event.deltaY < 0 ? 1.1 : 1 / 1.1), { x: event.clientX - rect.left, y: event.clientY - rect.top })
      }}
    >
      <div className="page-strip" style={{ width: contentWidth, height: layout.totalHeight }}>
        {layout.pages.map((page) => (
          <div key={`placeholder-${page.index}`} className="page-empty" style={{
            top: page.top,
            left: (contentWidth - page.width) / 2,
            width: page.width,
            height: page.height,
          }}>{page.index + 1}</div>
        ))}
        {virtualPages.map((page) => {
          const visible = visibleIndexes.has(page.index)
          return <PageView
            deferPreview={Boolean(props.onViewChange) && isScrolling}
            readOnly={props.readOnly}
            renderRevision={props.renderRevisions?.get(page.index)}
            key={page.index}
            pool={props.pool}
            docId={props.docId}
            scheduler={scheduler}
            annotationStore={props.annotationStore}
            formatDefaults={props.formatDefaults}
            tool={props.tool}
            selectedAnnotationId={props.selectedAnnotationId}
            searchMatches={props.searchMatches.flatMap((match, index) => match.pageIndex === page.index ? [{ match, active: index === props.activeSearchIndex }] : [])}
            editingAnnotationId={editingAnnotationId}
            onSelectAnnotation={props.onSelectAnnotation}
            onEditAnnotation={setEditingAnnotationId}
            registerEditorCommit={registerEditorCommit}
            layout={page}
            pageSize={props.pageSizes[page.index]}
            zoom={committedZoom}
            priority={pagePriority(page.top, page.height, visible)}
            visible={visible}
            viewport={renderedViewport}
            pageLeft={(contentWidth - page.width) / 2}
            warmEnabled={warmEnabled}
            onFirstBitmap={firstBitmap}
            onSharpChange={onSharpChange}
            onRenderRequest={onRenderRequest}
            onStatus={props.onStatus}
          />
        } )}
      </div>
      </div>
      {debugPanelTarget && createPortal(
        <span data-testid="detail-recovery-count">詳細要求の安全網: {detailRecoveryCount} 回</span>,
        debugPanelTarget,
      )}
    </EditorToolChangeContext.Provider>
  )
})

export function currentMetrics() {
  return getMetrics()
}
