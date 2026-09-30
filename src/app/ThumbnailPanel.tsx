import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { RenderScheduler } from '../client/RenderScheduler'
import type { PageSize } from '../core/mupdfDoc'
import type { AnnotationStore } from '../editor/AnnotationStore'

const THUMBNAIL_WIDTH = 120
const ITEM_GAP = 14
const LABEL_HEIGHT = 28

interface ThumbnailLayout {
  index: number
  top: number
  width: number
  height: number
  itemHeight: number
}

interface Props {
  docId: string
  pageSizes: readonly PageSize[]
  currentPage: number
  scheduler: RenderScheduler
  annotationStore: AnnotationStore
  onPageClick(index: number): void
}

function Thumbnail({ layout, pageSize, docId, scheduler, store }: {
  layout: ThumbnailLayout
  pageSize: PageSize
  docId: string
  scheduler: RenderScheduler
  store: AnnotationStore
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const excluded = store.touchedObjNums(layout.index)
  const scale = 512 / Math.max(pageSize.width, pageSize.height)
  const key = `${layout.index}:${scale.toFixed(6)}:full:x=${excluded.join('.')}`

  useEffect(() => {
    const params = {
      docId,
      pageIndex: layout.index,
      renderScale: scale,
      deviceRect: null,
      excludeAnnotObjNums: excluded,
    }
    const draw = (bitmap: ImageBitmap) => {
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      canvas.getContext('2d', { alpha: false })?.drawImage(bitmap, 0, 0)
    }
    // 描画済みならすぐ使う。まだなら、一覧が 250ms 止まってから最低の優先度で頼む。
    // 本体を速くスクロールしている間は一覧も追従して入れ替わり続けるため、
    // すぐ頼むと重いページの描画で Worker が埋まり、本体の表示が遅れる。
    if (scheduler.has(key)) return scheduler.want(key, params, 3, draw)
    let release: (() => void) | undefined
    const timer = window.setTimeout(() => { release = scheduler.want(key, params, 3, draw) }, 250)
    return () => {
      window.clearTimeout(timer)
      release?.()
    }
  }, [docId, key, layout.index, scale, scheduler])

  return <canvas ref={canvasRef} className="thumbnail-canvas" style={{ width: layout.width, height: layout.height }} />
}

export function ThumbnailPanel({ docId, pageSizes, currentPage, scheduler, annotationStore, onPageClick }: Props) {
  const version = useSyncExternalStore(annotationStore.subscribe, annotationStore.getSnapshot)
  void version
  const scrollerRef = useRef<HTMLDivElement>(null)
  const userScrollingRef = useRef(false)
  const followScrollRef = useRef(false)
  const scrollTimerRef = useRef<number | undefined>(undefined)
  const [viewport, setViewport] = useState({ top: 0, height: 700 })
  const { layouts, totalHeight } = useMemo(() => {
    let top = ITEM_GAP
    const entries = pageSizes.map((pageSize, index) => {
      const height = THUMBNAIL_WIDTH * pageSize.height / pageSize.width
      const itemHeight = height + LABEL_HEIGHT + ITEM_GAP
      const item = { index, top, width: THUMBNAIL_WIDTH, height, itemHeight }
      top += itemHeight
      return item
    })
    return { layouts: entries, totalHeight: top }
  }, [pageSizes])
  const visible = layouts.filter((item) => (
    item.top + item.itemHeight >= viewport.top - 300
    && item.top <= viewport.top + viewport.height + 300
  ))

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const update = () => setViewport({ top: scroller.scrollTop, height: scroller.clientHeight })
    const resize = new ResizeObserver(update)
    resize.observe(scroller)
    update()
    return () => resize.disconnect()
  }, [])

  useEffect(() => {
    if (userScrollingRef.current) return
    const scroller = scrollerRef.current
    const target = layouts[currentPage - 1]
    if (!scroller || !target) return
    if (target.top < scroller.scrollTop || target.top + target.itemHeight > scroller.scrollTop + scroller.clientHeight) {
      followScrollRef.current = true
      scroller.scrollTop = Math.max(0, target.top - (scroller.clientHeight - target.itemHeight) / 2)
      requestAnimationFrame(() => { followScrollRef.current = false })
    }
  }, [currentPage, layouts])

  useEffect(() => () => window.clearTimeout(scrollTimerRef.current), [])

  return (
    <div
      ref={scrollerRef}
      className="thumbnail-panel"
      aria-label="ページ一覧"
      data-testid="thumbnail-panel"
      onScroll={(event) => {
        setViewport({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })
        if (followScrollRef.current) return
        userScrollingRef.current = true
        window.clearTimeout(scrollTimerRef.current)
        scrollTimerRef.current = window.setTimeout(() => { userScrollingRef.current = false }, 800)
      }}
    >
      <div className="thumbnail-strip" style={{ height: totalHeight }}>
        {visible.map((layout) => (
          <button
            type="button"
            key={layout.index}
            data-thumbnail-index={layout.index}
            data-testid={`thumbnail-${layout.index}`}
            className={`thumbnail-item${currentPage === layout.index + 1 ? ' active' : ''}`}
            style={{ top: layout.top, height: layout.itemHeight }}
            onClick={() => onPageClick(layout.index)}
          >
            <Thumbnail layout={layout} pageSize={pageSizes[layout.index]} docId={docId} scheduler={scheduler} store={annotationStore} />
            <span>{layout.index + 1}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
