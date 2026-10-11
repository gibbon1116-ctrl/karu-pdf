import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import type { Rect } from '../core/annotations'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import { templateCandidateLines } from '../core/vectorSymbolSearch'

type Lines = { segments: Float32Array; widths: Float32Array }
type Position = { x: number; y: number }
type Mode = 'erase' | 'restore'
interface Props {
  pool: PdfWorkerPool
  docId: string
  pageIndex: number
  sampleRect: Rect
  pageSegments: Float32Array
  pageWidths: Float32Array
  initialLines?: Lines
  onApply(lines: Lines): void
  onCancel(): void
}
interface Gesture {
  pointerId: number
  before: Set<number>
  start: Position
  last: Position
  dragged: boolean
  mode: Mode
}

function sameSelection(a: Set<number>, b: Set<number>): boolean {
  return a.size === b.size && [...a].every(id => b.has(id))
}
function pointLineDistance(p: Position, a: Position, b: Position): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared)) : 0
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}
function lineDistance(a: Position, b: Position, c: Position, d: Position): number {
  const abx = b.x - a.x, aby = b.y - a.y, cdx = d.x - c.x, cdy = d.y - c.y
  const denominator = abx * cdy - aby * cdx
  if (denominator !== 0) {
    const acx = c.x - a.x, acy = c.y - a.y
    const t = (acx * cdy - acy * cdx) / denominator
    const u = (acx * aby - acy * abx) / denominator
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0
  }
  return Math.min(
    pointLineDistance(a, c, d), pointLineDistance(b, c, d),
    pointLineDistance(c, a, b), pointLineDistance(d, a, b),
  )
}
function lineKey(segments: Float32Array, widths: Float32Array, id: number): string {
  return `${segments[id * 4]},${segments[id * 4 + 1]},${segments[id * 4 + 2]},${segments[id * 4 + 3]},${widths[id]}`
}
function initialSelection(ids: number[], automatic: Set<number>, pageSegments: Float32Array,
  pageWidths: Float32Array, initialLines?: Lines): Set<number> {
  if (!initialLines) return new Set(automatic)
  // A multiset preserves separate extracted lines that happen to have the same geometry.
  const remaining = new Map<string, number>()
  for (let id = 0; id < initialLines.segments.length / 4; id++) {
    const key = lineKey(initialLines.segments, initialLines.widths, id)
    remaining.set(key, (remaining.get(key) ?? 0) + 1)
  }
  const selected = new Set<number>()
  for (const id of ids) {
    const key = lineKey(pageSegments, pageWidths, id), count = remaining.get(key) ?? 0
    if (count > 0) {
      selected.add(id)
      remaining.set(key, count - 1)
    }
  }
  return selected
}

export default function SymbolSampleEraser({
  pool, docId, pageIndex, sampleRect, pageSegments, pageWidths, initialLines, onApply, onCancel,
}: Props) {
  const candidates = useMemo(
    () => templateCandidateLines(pageSegments, pageWidths, sampleRect),
    [pageSegments, pageWidths, sampleRect],
  )
  const initial = useMemo(
    () => initialSelection(candidates.ids, candidates.kept, pageSegments, pageWidths, initialLines),
    [candidates, pageSegments, pageWidths, initialLines],
  )
  const [used, setUsed] = useState(() => new Set(initial))
  const usedRef = useRef(used)
  const [mode, setMode] = useState<Mode>('erase')
  const [cursor, setCursor] = useState<{ x: number; y: number; radius: number } | null>(null)
  const [background, setBackground] = useState(''), [backgroundError, setBackgroundError] = useState('')
  const history = useRef<Set<number>[]>([])
  const [undoCount, setUndoCount] = useState(0)
  const gesture = useRef<Gesture | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const contextRect = useMemo<Rect>(() => {
    const dx = (sampleRect[2] - sampleRect[0]) * .2, dy = (sampleRect[3] - sampleRect[1]) * .2
    return [sampleRect[0] - dx, sampleRect[1] - dy, sampleRect[2] + dx, sampleRect[3] + dy]
  }, [sampleRect])
  const scale = 480 / Math.max(contextRect[2] - contextRect[0], contextRect[3] - contextRect[1])
  const width = (contextRect[2] - contextRect[0]) * scale
  const height = (contextRect[3] - contextRect[1]) * scale
  const x = (value: number) => (value - contextRect[0]) * scale
  const y = (value: number) => (value - contextRect[1]) * scale
  const tooMany = candidates.ids.length > 4096

  useLayoutEffect(() => {
    if (tooMany) return
    const element = dialog.current
    element?.showModal()
    return () => { if (element?.open) element.close() }
  }, [tooMany])
  useLayoutEffect(() => {
    if (tooMany) return
    let disposed = false
    // The existing sample renderer returns a PNG of the requested display-pt rectangle.
    // This demand-only background is enlarged and faint; the editable lines stay vector-sharp.
    void pool.renderFixtureSample(docId, pageIndex, contextRect).then(sample => {
      if (!disposed) setBackground(`data:image/png;base64,${sample.png}`)
    }, reason => {
      if (!disposed) setBackgroundError(`背景を描けませんでした: ${(reason as Error).message}`)
    })
    return () => { disposed = true }
  }, [pool, docId, pageIndex, contextRect, tooMany])

  const replaceUsed = (next: Set<number>) => {
    usedRef.current = next
    setUsed(next)
  }
  const finishGesture = () => {
    const current = gesture.current
    if (!current) return
    gesture.current = null
    if (!sameSelection(current.before, usedRef.current)) {
      history.current.push(current.before)
      setUndoCount(history.current.length)
    }
  }
  const operation = (next: Set<number>) => {
    finishGesture()
    if (sameSelection(usedRef.current, next)) return
    history.current.push(new Set(usedRef.current))
    setUndoCount(history.current.length)
    replaceUsed(next)
  }
  const undo = () => {
    finishGesture()
    const previous = history.current.pop()
    if (!previous) return
    replaceUsed(previous)
    setUndoCount(history.current.length)
  }
  const undoRef = useRef(undo)
  undoRef.current = undo
  useEffect(() => {
    if (tooMany) return
    // Clicking the drawing moves focus out of the dialog, so a dialog-level key handler would
    // miss Ctrl+Z and let the document undo run. Take it first, for this dialog only.
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'z') return
      event.preventDefault(); event.stopImmediatePropagation()
      undoRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [tooMany])
  const position = (event: PointerEvent<SVGSVGElement>): Position => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
  }
  const screenLine = (id: number): [Position, Position] => {
    const bounds = svg.current!.getBoundingClientRect(), offset = id * 4
    return [
      { x: x(pageSegments[offset]) * bounds.width / width, y: y(pageSegments[offset + 1]) * bounds.height / height },
      { x: x(pageSegments[offset + 2]) * bounds.width / width, y: y(pageSegments[offset + 3]) * bounds.height / height },
    ]
  }
  const moveCursor = (p: Position) => {
    const bounds = svg.current!.getBoundingClientRect()
    setCursor({ x: p.x * width / bounds.width, y: p.y * height / bounds.height, radius: 10 * width / bounds.width })
  }
  const changeIds = (ids: number[], selectedMode: Mode) => {
    const next = new Set(usedRef.current)
    for (const id of ids) {
      if (selectedMode === 'erase') next.delete(id)
      else next.add(id)
    }
    if (!sameSelection(next, usedRef.current)) replaceUsed(next)
  }
  const nearestLine = (p: Position): number | undefined => {
    let nearest: number | undefined, distance = 10
    for (const id of candidates.ids) {
      const [a, b] = screenLine(id), current = pointLineDistance(p, a, b)
      if (current <= distance && (nearest === undefined || current < distance)) {
        nearest = id; distance = current
      }
    }
    return nearest
  }
  const brushGesture = (p: Position) => {
    const current = gesture.current
    if (!current) return
    if (!current.dragged && Math.hypot(p.x - current.start.x, p.y - current.start.y) >= 2) current.dragged = true
    if (current.dragged) {
      const touched = candidates.ids.filter(id => {
        const [a, b] = screenLine(id)
        return lineDistance(current.last, p, a, b) <= 10
      })
      changeIds(touched, current.mode)
      current.last = p
    }
  }
  const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (!event.isPrimary || event.button !== 0 || gesture.current) return
    event.preventDefault()
    const p = position(event)
    moveCursor(p)
    gesture.current = {
      pointerId: event.pointerId, before: new Set(usedRef.current),
      start: p, last: p, dragged: false, mode,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    const nearest = nearestLine(p)
    if (nearest !== undefined) changeIds([nearest], mode)
  }
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const p = position(event)
    moveCursor(p)
    if (gesture.current?.pointerId !== event.pointerId) return
    event.preventDefault()
    brushGesture(p)
  }
  const pointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (gesture.current?.pointerId !== event.pointerId) return
    brushGesture(position(event)); finishGesture()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const decide = () => {
    finishGesture()
    if (usedRef.current.size < 2) return
    const ids = candidates.ids.filter(id => usedRef.current.has(id))
    onApply({
      segments: new Float32Array(ids.flatMap(id => Array.from(pageSegments.subarray(id * 4, id * 4 + 4)))),
      widths: new Float32Array(ids.map(id => pageWidths[id])),
    })
  }

  if (tooMany) return <p role="alert">線が多すぎるため整えられません。小さく囲んでください</p>
  return <dialog ref={dialog} className="symbol-sample-eraser" aria-label="見本の線を整える"
    onCancel={event => { event.preventDefault(); onCancel() }}
    onKeyDown={event => event.stopPropagation()}>
    <h2>見本の線を整える</h2>
    <div className="symbol-sample-eraser-actions">
      <button type="button" aria-label="消しゴム" aria-pressed={mode === 'erase'} onClick={() => setMode('erase')}>消す（なぞる）</button>
      <button type="button" aria-label="戻す" aria-pressed={mode === 'restore'} onClick={() => setMode('restore')}>戻す（なぞる）</button>
      <button type="button" onClick={() => operation(new Set(candidates.kept))}>自動の整理に戻す</button>
      <button type="button" onClick={() => operation(new Set(candidates.ids))}>すべての線を使う</button>
      <button type="button" aria-label="元に戻す" disabled={undoCount === 0} onClick={undo}>1つ前に戻す（Ctrl+Z）</button>
    </div>
    <p role="status">{mode === 'erase'
      ? '消す線をなぞるか押してください。消した線は赤い破線になります。'
      : '戻す線（赤い破線）をなぞるか押してください。'}</p>
    <p>直前の操作は「1つ前に戻す」か Ctrl+Z で取り消せます。</p>
    <svg ref={svg} className="symbol-sample-eraser-canvas" width={width} height={height}
      viewBox={`0 0 ${width} ${height}`} aria-label="見本の線"
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}
      onPointerCancel={event => {
        if (gesture.current?.pointerId !== event.pointerId) return
        const previous = gesture.current.before
        gesture.current = null; replaceUsed(previous); setCursor(null)
      }}
      onLostPointerCapture={event => {
        if (gesture.current?.pointerId === event.pointerId) finishGesture()
      }}
      onPointerLeave={() => { if (!gesture.current) setCursor(null) }}>
      <rect width={width} height={height} fill="white" />
      {background && <image href={background} x={0} y={0} width={width} height={height}
        preserveAspectRatio="none" opacity={.18} />}
      <rect x={x(sampleRect[0])} y={y(sampleRect[1])}
        width={(sampleRect[2] - sampleRect[0]) * scale} height={(sampleRect[3] - sampleRect[1]) * scale}
        fill="none" stroke="#555" strokeWidth={1.5} strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke" pointerEvents="none" />
      {candidates.ids.map(id => {
        const offset = id * 4, use = used.has(id)
        return <line key={id} data-testid="sample-line" data-line-id={id} data-state={use ? 'use' : 'erased'}
          x1={x(pageSegments[offset])} y1={y(pageSegments[offset + 1])}
          x2={x(pageSegments[offset + 2])} y2={y(pageSegments[offset + 3])}
          stroke={use ? '#064b83' : '#db8c8c'} strokeWidth={3}
          strokeDasharray={use ? undefined : '5 4'} opacity={use ? 1 : .65}
          vectorEffect="non-scaling-stroke" pointerEvents="none" />
      })}
      {cursor && <circle cx={cursor.x} cy={cursor.y} r={cursor.radius}
        fill={mode === 'erase' ? '#db8c8c20' : '#064b8320'}
        stroke={mode === 'erase' ? '#b95757' : '#064b83'} strokeWidth={1}
        vectorEffect="non-scaling-stroke" pointerEvents="none" />}
    </svg>
    {backgroundError && <p role="status">{backgroundError}</p>}
    <p aria-live="polite">使う線 {used.size} 本・消した線 {candidates.ids.length - used.size} 本</p>
    {used.size < 2 && <p role="status">線を 2 本以上残してください</p>}
    <div className="symbol-sample-eraser-actions">
      <button type="button" disabled={used.size < 2} onClick={decide}>この線で探す</button>
      <button type="button" onClick={onCancel}>やめる</button>
    </div>
  </dialog>
}
