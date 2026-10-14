import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Rect } from '../core/annotations'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import type { SymbolSearchCandidate } from '../editor/AnnotationStore'
import type { DocumentSession } from './documentModel'

type RegionTask = ReturnType<PdfWorkerPool['renderRegionImage']>

function Thumbnail({ canvas, label }: {
  canvas: HTMLCanvasElement | null | undefined
  label: string
}) {
  const host = useRef<HTMLSpanElement | null>(null)
  useLayoutEffect(() => {
    const element = host.current
    if (!element || !canvas) return
    canvas.setAttribute('role', 'img')
    canvas.setAttribute('aria-label', label)
    element.appendChild(canvas)
    return () => {
      if (canvas.parentNode === element) element.removeChild(canvas)
    }
  }, [canvas, label])

  return <span className="symbol-candidate-review-image" ref={host}>
    {canvas === undefined ? '画像を準備中' : canvas === null ? '画像なし' : null}
  </span>
}

export default function SymbolCandidateReview({ session, pool, open, onClose, onLocate }: {
  session: DocumentSession
  pool: PdfWorkerPool
  open: boolean
  onClose(): void
  onLocate(pageIndex: number, rect: Rect): void
}) {
  const store = session.annotationStore
  const version = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [collapsed, setCollapsed] = useState(false)
  const panel = useRef<HTMLElement | null>(null)
  const header = useRef<HTMLElement | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const pointerDrag = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null)
  const [seenIds, setSeenIds] = useState<ReadonlySet<string>>(() => new Set())
  const [, refreshImages] = useState(0)
  // The parent remounts this component for each search. Closing keeps completed
  // images and membership, but the rendering effect cancels unfinished work.
  const images = useRef(new Map<string, HTMLCanvasElement | null>())
  const rowElements = useRef(new Map<string, HTMLLIElement>())
  const scrollRoot = useRef<HTMLUListElement | null>(null)
  const focusedId = store.focusedSymbolCandidateId
  const visible = store.visibleSymbolCandidates ?? []
  const rows = visible.filter(candidate => candidate.state !== 'counted'
    && (seenIds.has(candidate.id) || (open && candidate.state === 'chosen')))
    .sort((a, b) => a.pageIndex - b.pageIndex
      || a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0]
      || a.id.localeCompare(b.id))
  const rowKey = JSON.stringify(rows.map(candidate => candidate.id))
  const chosenCount = visible.filter(candidate => candidate.state === 'chosen').length

  useLayoutEffect(() => {
    if (!open || position) return
    const element = panel.current
    const parent = element?.closest<HTMLElement>('.viewer-slot')
    if (!element || !parent) return
    const right = Math.max(8, Math.min(276, parent.clientWidth - 308))
    setPosition({ left: Math.max(8, parent.clientWidth - right - element.offsetWidth), top: 8 })
  }, [open, position])

  useLayoutEffect(() => {
    if (!open) return
    setSeenIds(previous => {
      const newlyChosen = (store.visibleSymbolCandidates ?? [])
        .filter(candidate => candidate.state === 'chosen' && !previous.has(candidate.id))
      if (!newlyChosen.length) return previous
      const next = new Set(previous)
      for (const candidate of newlyChosen) next.add(candidate.id)
      return next
    })
  }, [store, version, open])

  useLayoutEffect(() => {
    // Selecting a candidate on the drawing also reveals a collapsed list.
    if (open && focusedId) setCollapsed(false)
  }, [open, focusedId])

  useLayoutEffect(() => {
    if (!open || collapsed || !focusedId) return
    const root = scrollRoot.current
    const row = rowElements.current.get(focusedId)
    if (!root || !row) return
    const bounds = root.getBoundingClientRect()
    const position = row.getBoundingClientRect()
    // Scroll only this list, without moving the PDF or outer workspace.
    if (position.top < bounds.top) root.scrollTop += position.top - bounds.top
    else if (position.bottom > bounds.bottom) root.scrollTop += position.bottom - bounds.bottom
  }, [open, collapsed, focusedId, rowKey])

  useEffect(() => {
    if (!open || collapsed || !rows.length) return
    const root = scrollRoot.current
    if (!root) return

    let stopped = false
    let frame: number | null = null
    const running = new Map<string, RegionTask>()
    const queue = rows.filter(candidate => !images.current.has(candidate.id))
    const onscreen = new Set<string>()
    const observedIds = new Map<Element, string>()
    const bounds = root.getBoundingClientRect()

    for (const candidate of rows) {
      const element = rowElements.current.get(candidate.id)
      if (!element) continue
      observedIds.set(element, candidate.id)
      const position = element.getBoundingClientRect()
      if (position.bottom > bounds.top && position.top < bounds.bottom
        && position.right > bounds.left && position.left < bounds.right) {
        onscreen.add(candidate.id)
      }
    }

    const expandedRect = (candidate: SymbolSearchCandidate): Rect => {
      const page = session.pageSizes[candidate.pageIndex]
      if (!page) throw new Error('ページが見つかりません')
      const [left, top, right, bottom] = candidate.rect
      const dx = (right - left) * .35, dy = (bottom - top) * .35
      return [
        Math.max(0, left - dx), Math.max(0, top - dy),
        Math.min(page.width, right + dx), Math.min(page.height, bottom + dy),
      ]
    }

    const record = (id: string, canvas: HTMLCanvasElement | null) => {
      if (stopped) return
      images.current.set(id, canvas)
      refreshImages(value => value + 1)
    }

    const pump = () => {
      if (stopped) return
      while (running.size < 2 && queue.length) {
        const visibleIndex = queue.findIndex(candidate => onscreen.has(candidate.id))
        const [candidate] = queue.splice(visibleIndex < 0 ? 0 : visibleIndex, 1)
        if (images.current.has(candidate.id)) continue
        let task: RegionTask
        try {
          task = pool.renderRegionImage(session.docId, candidate.pageIndex, expandedRect(candidate), 96)
        } catch {
          record(candidate.id, null)
          continue
        }
        running.set(candidate.id, task)
        void task.promise.then(
          canvas => record(candidate.id, canvas),
          () => record(candidate.id, null),
        ).finally(() => {
          running.delete(candidate.id)
          if (!stopped) pump()
        })
      }
    }

    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      if (stopped) return
      for (const entry of entries) {
        const id = observedIds.get(entry.target)
        if (!id) continue
        if (entry.isIntersecting) onscreen.add(id)
        else onscreen.delete(id)
      }
      pump()
    }, { root })

    for (const element of observedIds.keys()) observer?.observe(element)
    // Let focus scrolling and the initial observer notification settle first.
    frame = requestAnimationFrame(() => {
      frame = null
      pump()
    })

    return () => {
      stopped = true
      if (frame !== null) cancelAnimationFrame(frame)
      observer?.disconnect()
      queue.length = 0
      for (const task of running.values()) task.cancel()
      running.clear()
    }
    // Membership changes cancel obsolete tasks. State and focus changes alone
    // preserve active tasks; the observer updates their remaining priority.
  }, [open, collapsed, rowKey, pool, session, store])

  const startDragging = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest('button')) return
    const element = panel.current
    const parent = element?.closest<HTMLElement>('.viewer-slot')
    if (!element || !parent || !position) return
    event.preventDefault()
    pointerDrag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: position.left,
      top: position.top,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }
  const moveDragging = (event: ReactPointerEvent<HTMLElement>) => {
    const start = pointerDrag.current
    const parent = panel.current?.closest<HTMLElement>('.viewer-slot')
    const heading = header.current
    if (!start || start.pointerId !== event.pointerId || !parent || !heading) return
    const minLeft = 40 - heading.offsetWidth
    const maxLeft = parent.clientWidth - 40
    const minTop = 40 - heading.offsetHeight
    const maxTop = parent.clientHeight - 40
    setPosition({
      left: Math.max(minLeft, Math.min(maxLeft, start.left + event.clientX - start.x)),
      top: Math.max(minTop, Math.min(maxTop, start.top + event.clientY - start.y)),
    })
  }
  const stopDragging = (event: ReactPointerEvent<HTMLElement>) => {
    if (pointerDrag.current?.pointerId !== event.pointerId) return
    pointerDrag.current = null
    setDragging(false)
  }

  const chooseList = (choose: boolean) => {
    for (const candidate of rows) {
      if ((candidate.state === 'chosen') !== choose) store.toggleSymbolCandidate(candidate.id)
    }
  }
  const locate = (candidate: SymbolSearchCandidate) => {
    onLocate(candidate.pageIndex, candidate.rect)
    store.setFocusedSymbolCandidate(candidate.id)
  }

  if (!open) return null
  return <section ref={panel} style={{ left: `${position?.left ?? 8}px`, top: `${position?.top ?? 8}px` }}
    className="symbol-candidate-review" role="dialog" aria-label="選んだ候補の確認"
    onPointerDown={event => event.stopPropagation()}
    onPointerUp={event => event.stopPropagation()}
    onClick={event => event.stopPropagation()}
    onWheel={event => event.stopPropagation()}>
    <header ref={header} className={`symbol-candidate-review-header${dragging ? ' dragging' : ''}`}
      title="ドラッグで動かせます" onPointerDown={startDragging} onPointerMove={moveDragging}
      onPointerUp={stopDragging} onPointerCancel={stopDragging} onLostPointerCapture={stopDragging}>
      <h2>選んだ候補の確認</h2>
      <button type="button" aria-expanded={!collapsed}
        onClick={() => setCollapsed(value => !value)}>{collapsed ? '展開する' : '折り畳む'}</button>
      <button type="button" aria-label="選んだ候補の確認を閉じる" onClick={onClose}>×</button>
    </header>
    <div className="symbol-candidate-review-body" hidden={collapsed}>
      <p aria-live="polite">選択 {chosenCount} / 一覧 {rows.length}</p>
      <div className="symbol-candidate-review-actions">
        <button type="button" disabled={!rows.some(candidate => candidate.state === 'pending')}
          onClick={() => chooseList(true)}>一覧をすべて選ぶ</button>
        <button type="button" disabled={!rows.some(candidate => candidate.state === 'chosen')}
          onClick={() => chooseList(false)}>一覧をすべて外す</button>
      </div>
      <ul className="symbol-candidate-review-list" aria-label="確認する候補" ref={scrollRoot}>
        {rows.map((candidate, index) => {
          const name = `p.${candidate.pageIndex + 1} の候補 ${index + 1}`
          return <li key={candidate.id} data-testid="symbol-candidate-review-row"
            data-candidate-id={candidate.id}
            className={`symbol-candidate-review-row${focusedId === candidate.id ? ' focused' : ''}`}
            ref={element => {
              if (element) rowElements.current.set(candidate.id, element)
              else rowElements.current.delete(candidate.id)
            }}>
            <input type="checkbox" aria-label={`${name} を選ぶ`}
              checked={candidate.state === 'chosen'}
              onChange={() => store.toggleSymbolCandidate(candidate.id)} />
            <button type="button" className="symbol-candidate-review-locate"
              aria-label={`${name} を図面で確認`} onClick={() => locate(candidate)}>
              <Thumbnail canvas={images.current.get(candidate.id)} label={`${name} の画像`} />
              <span className="symbol-candidate-review-details">
                <span>p.{candidate.pageIndex + 1}</span>
                <span>似ている度合い {candidate.score.toFixed(2)}</span>
                <span>{candidate.label || '添字なし'}</span>
                {candidate.confidence === 'check' && <span className="symbol-candidate-review-warning">要確認</span>}
              </span>
            </button>
          </li>
        })}
      </ul>
      {!rows.length && <p>確認する候補はありません</p>}
    </div>
  </section>
}
