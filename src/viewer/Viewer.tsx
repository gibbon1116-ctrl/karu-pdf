import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import { RenderScheduler } from '../client/RenderScheduler'
import type { PageSize } from '../core/mupdfDoc'
import { EditorToolChangeContext, type EditorTool } from '../editor/AnnotationLayer'
import type { AnnotationStore } from '../editor/AnnotationStore'
import { getMetrics, recordBlankFrame, recordMetric, resetBlankFrames, startMeasure } from '../perf/metrics'
import type { Priority } from '../worker/protocol'
import { BitmapCache } from './BitmapCache'
import { type Box } from './detailRegion'
import { computePageLayout, pagesInRange } from './pageLayout'
import { PageView } from './PageView'

export const ZOOM_STEPS = [0.25, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8]

export interface ViewerHandle {
  setZoom(zoom: number, anchor?: { x: number; y: number }): void
  zoomIn(): void
  zoomOut(): void
  fitWidth(): void
  scrollToPage(index: number): void
  isIdle(): boolean
  isSharp(): boolean
  getZoom(): number
  getCache(): BitmapCache
  commitEditor(): Promise<void>
  clearSelection(): void
}

interface Props {
  pool: PdfWorkerPool
  annotationStore: AnnotationStore
  tool: EditorTool
  initialView: { page: number; zoom: number } | null
  pageSizes: PageSize[]
  onToolChange(tool: EditorTool): void
  onZoomChange(zoom: number): void
  onPageChange(page: number): void
  onFirstBitmap(): void
  onFirstSharp(): void
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

type RenderLogWindow = Window & typeof globalThis & {
  __karuRenderRequests?: RenderRequestLogEntry[]
}

export const Viewer = forwardRef<ViewerHandle, Props>(function Viewer(props, ref) {
  const initialZoom = Math.max(0.25, Math.min(8, props.initialView?.zoom ?? 1))
  const initialLayout = computePageLayout(props.pageSizes, initialZoom)
  const initialPageIndex = Math.max(0, Math.min(props.pageSizes.length - 1, (props.initialView?.page ?? 1) - 1))
  const initialTop = initialLayout.pages[initialPageIndex]?.top ?? 0
  const annotationVersion = useSyncExternalStore(props.annotationStore.subscribe, props.annotationStore.getSnapshot)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const cacheRef = useRef(new BitmapCache())
  const warmCacheRef = useRef(new BitmapCache(64 * 1024 * 1024))
  const schedulerRef = useRef(new RenderScheduler(props.pool, cacheRef.current, warmCacheRef.current))
  const prefetchRef = useRef(new Map<number, PrefetchEntry>())
  const warmReleasesRef = useRef<Array<() => void>>([])
  const firstBitmapRef = useRef(false)
  const firstSharpRef = useRef(false)
  const zoomTimerRef = useRef<number | undefined>(undefined)
  const blankRafRef = useRef(0)
  const scrollStopTimerRef = useRef<number | undefined>(undefined)
  const panSequenceRef = useRef(0)
  const zoomSequenceRef = useRef(0)
  const lastPositionRef = useRef({ left: 0, top: initialTop })
  const horizontalScrollRef = useRef(false)
  const suppressPanUntilRef = useRef(0)
  const renderRequestLogRef = useRef<RenderRequestLogEntry[]>([])
  const editorCommitRef = useRef<(() => Promise<void>) | null>(null)
  const initialPositionAppliedRef = useRef(false)
  const zoomRef = useRef(initialZoom)
  const layoutRef = useRef(initialLayout)
  const [zoom, setZoomState] = useState(initialZoom)
  const [committedZoom, setCommittedZoom] = useState(initialZoom)
  const [viewport, setViewport] = useState<Box>({ x: 0, y: initialTop, width: 800, height: 600 })
  const [scrollDirection, setScrollDirection] = useState<1 | -1>(1)
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null)
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null)

  const scheduler = schedulerRef.current
  const warmEnabled = new URLSearchParams(location.search).get('warm') === '1'
  const layout = useMemo(() => computePageLayout(props.pageSizes, zoom), [props.pageSizes, zoom])
  layoutRef.current = layout
  const contentWidth = Math.max(layout.maxWidth, viewport.width)
  const virtualPages = useMemo(
    () => pagesInRange(layout.pages, Math.max(0, viewport.y - viewport.height * 2), viewport.y + viewport.height * 3),
    [layout.pages, viewport.y, viewport.height],
  )
  const visibleIndexes = useMemo(() => new Set(
    pagesInRange(layout.pages, viewport.y, viewport.y + viewport.height).map((page) => page.index),
  ), [layout.pages, viewport.y, viewport.height])

  const onRenderRequest = useCallback((pageIndex: number, priority: Priority, key: string) => {
    const entry: RenderRequestLogEntry = {
      worker: pageIndex % props.pool.workerCount,
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
  }, [props.pool.workerCount])

  const isSharpNow = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller || props.pageSizes.length === 0) return true
    const visible = pagesInRange(layoutRef.current.pages, scroller.scrollTop, scroller.scrollTop + scroller.clientHeight)
    if (visible.length === 0) return false
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

  const setZoom = useCallback((next: number, anchor?: { x: number; y: number }) => {
    const scroller = scrollerRef.current
    const bounded = Math.max(0.25, Math.min(8, next))
    const previousZoom = zoomRef.current
    zoomRef.current = bounded
    suppressPanUntilRef.current = performance.now() + 400
    if (scroller) {
      const x = anchor?.x ?? scroller.clientWidth / 2
      const y = anchor?.y ?? scroller.clientHeight / 2
      const ratio = bounded / previousZoom
      setZoomState(bounded)
      requestAnimationFrame(() => {
        scroller.scrollLeft = (scroller.scrollLeft + x) * ratio - x
        scroller.scrollTop = (scroller.scrollTop + y) * ratio - y
      })
    } else setZoomState(bounded)
    props.onZoomChange(bounded)
    commitZoom(bounded)
  }, [commitZoom, props.onZoomChange])

  const fitWidth = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller || props.pageSizes.length === 0) return
    resetBlankFrames()
    const widest = Math.max(...props.pageSizes.map((page) => page.width))
    setZoom((scroller.clientWidth - 32) / (widest * 96 / 72))
  }, [props.pageSizes, setZoom])

  const stepZoom = useCallback((direction: -1 | 1) => {
    const currentZoom = zoomRef.current
    const next = direction > 0
      ? ZOOM_STEPS.find((step) => step > currentZoom + 0.001) ?? 8
      : [...ZOOM_STEPS].reverse().find((step) => step < currentZoom - 0.001) ?? 0.25
    setZoom(next)
  }, [setZoom])

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
    setViewport({ x: next.left, y: next.top, width: scroller.clientWidth, height: scroller.clientHeight })
    let current = layoutRef.current.pages[0]
    for (const candidate of layoutRef.current.pages) {
      if (candidate.top > next.top + scroller.clientHeight / 3) break
      current = candidate
    }
    props.onPageChange((current?.index ?? 0) + 1)
  }, [props.onPageChange])

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
      updateViewport()
      if (!blankRafRef.current) blankRafRef.current = requestAnimationFrame(blankLoop)
      window.clearTimeout(scrollStopTimerRef.current)
      scrollStopTimerRef.current = window.setTimeout(() => {
        cancelAnimationFrame(blankRafRef.current)
        blankRafRef.current = 0
        recordBlankFrame(false)
        if (horizontalScrollRef.current && performance.now() >= suppressPanUntilRef.current) {
          const sequence = ++panSequenceRef.current
          const finish = startMeasure('pan-settle')
          waitForSharp('pan-settle', sequence, finish)
        }
        horizontalScrollRef.current = false
      }, 100)
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
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isInput = target?.matches('input, textarea, [contenteditable="true"]') ?? false
      if (isInput || editingAnnotationId) return
      if (event.key === 'Escape') {
        setSelectedAnnotationId(null)
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedAnnotationId) {
        event.preventDefault()
        props.annotationStore.remove(selectedAnnotationId)
        setSelectedAnnotationId(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editingAnnotationId, props.annotationStore, selectedAnnotationId])

  useLayoutEffect(() => {
    if (props.pageSizes.length === 0 || initialPositionAppliedRef.current) return
    initialPositionAppliedRef.current = true
    if (props.initialView) {
      const target = layoutRef.current.pages[initialPageIndex]
      if (scrollerRef.current && target) {
        scrollerRef.current.scrollTop = target.top
        lastPositionRef.current.top = target.top
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
      ? viewport.y + viewport.height * 4
      : viewport.y + viewport.height * 2
    for (const page of pagesInRange(layout.pages, start, end)) {
      const behind = scrollDirection > 0
        ? page.top + page.height < viewport.y
        : page.top > viewport.y + viewport.height
      const priority: Priority = behind ? 2 : 1
      const size = props.pageSizes[page.index]
      const scale = 512 / Math.max(size.width, size.height)
      const excluded = props.annotationStore.touchedObjNums(page.index)
      const key = `${page.index}:${scale.toFixed(6)}:full:x=${excluded.join('.')}`
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
      const params = { pageIndex, renderScale: scale, deviceRect: null, excludeAnnotObjNums: wanted.excluded }
      const release = scheduler.want(wanted.key, params, wanted.priority, () => undefined)
      prefetchRef.current.set(pageIndex, { priority: wanted.priority, key: wanted.key, release })
    }
  }, [scheduler, layout.pages, props.pageSizes, props.annotationStore, annotationVersion, viewport.y, viewport.height, scrollDirection])

  useEffect(() => {
    if (!warmEnabled || props.pageSizes.length === 0) return
    const center = pagesInRange(layout.pages, viewport.y, viewport.y + viewport.height)[0]?.index ?? 0
    const order = props.pageSizes.map((_, index) => index).sort((a, b) => Math.abs(a - center) - Math.abs(b - center))
    warmReleasesRef.current = order.map((pageIndex) => {
      const size = props.pageSizes[pageIndex]
      const scale = 256 / Math.max(size.width, size.height)
      const excluded = props.annotationStore.touchedObjNums(pageIndex)
      const key = `warm:${pageIndex}:${scale.toFixed(6)}:full:x=${excluded.join('.')}`
      const params = { pageIndex, renderScale: scale, deviceRect: null, excludeAnnotObjNums: excluded }
      return scheduler.want(key, params, 3, () => undefined)
    })
    return () => {
      for (const release of warmReleasesRef.current) release()
      warmReleasesRef.current = []
    }
  }, [warmEnabled, props.pageSizes, props.annotationStore, annotationVersion, scheduler])

  useEffect(() => () => {
    window.clearTimeout(zoomTimerRef.current)
    for (const entry of prefetchRef.current.values()) entry.release()
    scheduler.destroy()
    cacheRef.current.clear()
    warmCacheRef.current.clear()
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
    setZoom,
    zoomIn: () => stepZoom(1),
    zoomOut: () => stepZoom(-1),
    fitWidth,
    scrollToPage: (index) => {
      const page = layoutRef.current.pages[Math.max(0, Math.min(layoutRef.current.pages.length - 1, index))]
      scrollerRef.current?.scrollTo({ top: page?.top ?? 0 })
    },
    isIdle: () => scheduler.pendingCount() === 0,
    isSharp: isSharpNow,
    getZoom: () => zoomRef.current,
    getCache: () => cacheRef.current,
    commitEditor: () => editorCommitRef.current?.() ?? Promise.resolve(),
    clearSelection: () => {
      setSelectedAnnotationId(null)
      setEditingAnnotationId(null)
    },
  }), [fitWidth, isSharpNow, scheduler, setZoom, stepZoom])

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
      data-testid="viewer"
      onWheel={(event) => {
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
            key={page.index}
            pool={props.pool}
            scheduler={scheduler}
            annotationStore={props.annotationStore}
            tool={props.tool}
            selectedAnnotationId={selectedAnnotationId}
            editingAnnotationId={editingAnnotationId}
            onSelectAnnotation={setSelectedAnnotationId}
            onEditAnnotation={setEditingAnnotationId}
            registerEditorCommit={registerEditorCommit}
            layout={page}
            pageSize={props.pageSizes[page.index]}
            zoom={committedZoom}
            priority={pagePriority(page.top, page.height, visible)}
            visible={visible}
            viewport={viewport}
            pageLeft={(contentWidth - page.width) / 2}
            warmEnabled={warmEnabled}
            onFirstBitmap={firstBitmap}
            onSharpChange={onSharpChange}
            onRenderRequest={onRenderRequest}
          />
        } )}
      </div>
      </div>
    </EditorToolChangeContext.Provider>
  )
})

export function currentMetrics() {
  return getMetrics()
}
