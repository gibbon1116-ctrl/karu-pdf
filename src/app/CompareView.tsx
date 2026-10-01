import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { CancelledRenderError, type PdfWorkerPool, type RenderBackend } from '../client/PdfWorkerPool'
import { RenderScheduler } from '../client/RenderScheduler'
import { differenceLocation, type CompareRect } from '../core/compare'
import { AnnotationStore } from '../editor/AnnotationStore'
import type { FormatDefaults } from '../editor/formatDefaults'
import { BitmapCache } from '../viewer/BitmapCache'
import { CSS_PX_PER_PT } from '../viewer/pageLayout'
import { Viewer, type ViewerHandle } from '../viewer/Viewer'
import { ViewSyncDriver } from '../viewer/viewSync'
import type { CompareOptions } from '../worker/protocol'
import type { DocumentSession } from './documentModel'
import { prepareSplitDisplays } from './splitRendering'

const noop = () => undefined
const emptyMatches: [] = []
const zeroOffset: [number, number] = [0, 0]
interface Props {
  old: DocumentSession
  next: DocumentSession
  pool: PdfWorkerPool
  formatDefaults: FormatDefaults
  onClose(): void
}
interface PaneProps extends Props {
  options: CompareOptions
  regions: CompareRect[]
  active: number
  handle: RefObject<ViewerHandle | null>
  onZoom(value: number): void
  onChange(): void
  onInteract(): void
  onBitmap(): void
  onFailure(message: string): void
}
function ComparePane(props: PaneProps) {
  const store = useMemo(() => new AnnotationStore(), [])
  const size = props.old.pageSizes[props.options.pageIndex]
  const sizes = useMemo(() => [size], [size])
  const optionsKey = JSON.stringify(props.options)
  const scheduler = useMemo(() => {
    const backend: RenderBackend = {
      render: params => {
        const task = props.pool.renderCompare({ ...props.options, renderScale: params.renderScale, deviceRect: params.deviceRect, priority: params.priority })
        void task.promise.catch(error => { if (!(error instanceof CancelledRenderError)) props.onFailure(String(error)) })
        return task
      },
      cancelJobs: (_docId, ids) => props.pool.cancelJobs(props.old.docId, ids),
      reprioritize: (_docId, id, priority) => props.pool.reprioritize(props.old.docId, id, priority),
    }
    return new RenderScheduler(backend, new BitmapCache(96 * 1024 * 1024), new BitmapCache(1), `compare:${optionsKey}:`)
  }, [props.pool, optionsKey])
  useEffect(() => () => { scheduler.destroy(); scheduler.cache.clear(); scheduler.warmCache.clear() }, [scheduler])
  return <Viewer ref={props.handle} readOnly docId={props.old.docId} pool={props.pool} scheduler={scheduler}
    renderVariant={optionsKey}
    minZoom={.05}
    pageSizes={sizes} annotationStore={store} formatDefaults={props.formatDefaults} tool="select" initialView={null}
    selectedAnnotationId={null} searchMatches={emptyMatches} activeSearchIndex={-1}
    compareRegions={props.regions} activeCompareIndex={props.active}
    onSelectAnnotation={noop} onToolChange={noop} onPageChange={noop} onScrollPositionChange={noop}
    onZoomChange={props.onZoom} onViewChange={props.onChange} onViewInteraction={props.onInteract}
    onFirstBitmap={props.onBitmap} onFirstSharp={noop} onStatus={props.onFailure} />
}

export function CompareView(props: Props) {
  const root = useRef<HTMLElement>(null)
  const [ready, setReady] = useState(false), [failure, setFailure] = useState('')
  const [mode, setMode] = useState<'overlay' | 'side'>('overlay')
  const [oldPage, setOldPage] = useState(() => Math.max(0, Math.min(props.old.pageSizes.length - 1, props.old.view.page - 1)))
  const [newPage, setNewPage] = useState(() => Math.max(0, Math.min(props.next.pageSizes.length - 1, props.old.view.page - 1)))
  const [includeAnnotations, setInclude] = useState(false)
  const [offsets, setOffsets] = useState<Record<string, [number, number]>>({})
  const [committedOffsets, setCommittedOffsets] = useState<Record<string, [number, number]>>({})
  const [regions, setRegions] = useState<CompareRect[]>([]), [active, setActive] = useState(-1)
  const [detecting, setDetecting] = useState(true), [zoom, setZoom] = useState(1)
  const [imageMs, setImageMs] = useState<number | null>(null), [detectionMs, setDetectionMs] = useState<number | null>(null)
  const started = useRef(performance.now()), firstImage = useRef(false)
  const left = useRef<ViewerHandle>(null), right = useRef<ViewerHandle>(null)
  const frame = useRef(0), driver = useRef(new ViewSyncDriver())
  const pair = `${oldPage}:${newPage}`
  const offset = offsets[pair] ?? zeroOffset, committed = committedOffsets[pair] ?? zeroOffset
  const size = props.old.pageSizes[oldPage]
  const options = useMemo<CompareOptions>(() => ({ docId: props.old.docId, newDocId: props.next.docId,
    pageIndex: oldPage, newPageIndex: newPage, renderScale: 1, deviceRect: null, offset: committed, includeAnnotations }),
  [props.old.docId, props.next.docId, oldPage, newPage, committed, includeAnnotations])
  useEffect(() => {
    root.current?.focus()
    let cancelled = false
    void prepareSplitDisplays(props.pool, props.old, props.next, () => cancelled).then(() => { if (!cancelled) setReady(true) }).catch(error => { if (!cancelled) setFailure(String(error)) })
    return () => { cancelled = true; props.pool.clearCompare(); cancelAnimationFrame(frame.current) }
  }, [props.pool, props.old, props.next])
  useEffect(() => {
    const timer = setTimeout(() => setCommittedOffsets(previous => ({ ...previous, [pair]: offset })), 150)
    return () => clearTimeout(timer)
  }, [pair, offset])
  const aligning = offset[0] !== committed[0] || offset[1] !== committed[1]
  useEffect(() => {
    setRegions([]); setActive(-1); setDetectionMs(null); setDetecting(true)
    // Give the first visible image the CPU before beginning low-resolution detection.
    if (!ready || aligning || imageMs === null) return
    let cancelled = false
    const task = props.pool.renderCompare({ ...options, detect: true, priority: 2 })
    void task.promise.then(result => {
      result.bitmap.close()
      if (cancelled) return
      setRegions(result.differences ?? []); setDetectionMs(result.detectionMs ?? 0); setDetecting(false)
    }).catch(error => { if (!cancelled && !(error instanceof CancelledRenderError)) { setFailure(String(error)); setDetecting(false) } })
    return () => { cancelled = true; props.pool.cancelJobs(props.old.docId, [task.jobId]) }
  }, [props.pool, ready, options, aligning, imageMs])

  const synchronize = useCallback((side: 'left' | 'right') => {
    if (mode !== 'side' || !driver.current.accepts(side) || frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      const source = side === 'left' ? left.current : right.current, target = side === 'left' ? right.current : left.current
      if (source && target) target.applyViewPosition(source.getViewPosition())
    })
  }, [mode])
  const interact = useCallback((side: 'left' | 'right') => { driver.current.drive(side); cancelAnimationFrame(frame.current); frame.current = 0 }, [])
  const changeLeft = useCallback(() => synchronize('left'), [synchronize]), changeRight = useCallback(() => synchronize('right'), [synchronize])
  const interactLeft = useCallback(() => interact('left'), [interact]), interactRight = useCallback(() => interact('right'), [interact])
  useEffect(() => { interact('left'); synchronize('left') }, [mode, interact, synchronize])
  const bitmap = useCallback(() => { if (!firstImage.current) { firstImage.current = true; setImageMs(performance.now() - started.current) } }, [])
  const chooseDifference = (index: number) => {
    if (!regions.length) return
    const next = (index + regions.length) % regions.length
    setActive(next); interact('left')
    left.current?.zoomToRect(0, regions[next]); right.current?.zoomToRect(0, regions[next])
  }
  const previousDifference = active < 0 ? regions.length - 1 : active - 1
  const shift = (dx: number, dy: number) => setOffsets(previous => {
    const current = previous[pair] ?? zeroOffset
    return { ...previous, [pair]: [current[0] + dx, current[1] + dy] }
  })
  const pageInput = (label: string, value: number, count: number, set: (value: number) => void) => <label>{label}<input aria-label={`比較の${label}ページ番号`} type="number" min={1} max={count} value={value + 1} onChange={e => {
    const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n <= count) set(n - 1)
  }} /></label>
  const leftOptions = useMemo(() => ({ ...options, output: mode === 'side' ? 'old' as const : 'overlay' as const }), [options, mode])
  const rightOptions = useMemo(() => ({ ...options, output: 'new' as const }), [options])
  const common = { ...props, regions, active, onFailure: setFailure }
  return <section ref={root} tabIndex={-1} className="compare-view" data-testid="compare-view" data-image-ms={imageMs ?? ''} data-detection-ms={detectionMs ?? ''}
    data-offset-x={offset[0]} data-offset-y={offset[1]} onKeyDownCapture={e => {
      if ((e.target as HTMLElement).matches('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return
      if (['n', 'p'].includes(e.key.toLowerCase())) { e.preventDefault(); e.stopPropagation(); chooseDifference(e.key.toLowerCase() === 'n' ? active + 1 : previousDifference) }
      if (mode !== 'overlay' || !e.key.startsWith('Arrow')) return
      e.preventDefault(); e.stopPropagation()
      const step = (e.shiftKey ? 10 : 1) / (zoom * CSS_PX_PER_PT)
      shift(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0)
    }}>
    <header className="compare-header">
      <strong>比較: {props.old.name} ↔ {props.next.name}</strong>
      <div>
        <label><input type="radio" name="compare-mode" checked={mode === 'overlay'} onChange={() => setMode('overlay')} />重ねる</label>
        <label><input type="radio" name="compare-mode" checked={mode === 'side'} onChange={() => setMode('side')} />並べる</label>
        {pageInput('旧', oldPage, props.old.pageSizes.length, setOldPage)} ↔ {pageInput('新', newPage, props.next.pageSizes.length, setNewPage)}
        <button disabled={!oldPage || !newPage} onClick={() => { setOldPage(oldPage - 1); setNewPage(newPage - 1) }}>‹ 前の組</button>
        <button disabled={oldPage + 1 >= props.old.pageSizes.length || newPage + 1 >= props.next.pageSizes.length} onClick={() => { setOldPage(oldPage + 1); setNewPage(newPage + 1) }}>次の組 ›</button>
        <button aria-label="比較を縮小" onClick={() => left.current?.zoomOut()}>−</button><span data-testid="compare-zoom">{Math.round(zoom * 100)}%</span>
        <button aria-label="比較を拡大" onClick={() => left.current?.zoomIn()}>＋</button><button onClick={() => left.current?.fitWidth()}>幅</button>
      </div>
      <div>
        <span>違い {active < 0 ? 0 : active + 1} / {regions.length}</span>
        <button aria-label="前の違い" disabled={!regions.length} onClick={() => chooseDifference(previousDifference)}>‹</button>
        <button aria-label="次の違い" disabled={!regions.length} onClick={() => chooseDifference(active + 1)}>›</button>
        <label><input type="checkbox" checked={includeAnnotations} onChange={e => setInclude(e.target.checked)} />書き込みも比べる</label>
        <span>位置合わせ: 方向キー（Shift: 10px） <output>{offset[0].toFixed(2)}, {offset[1].toFixed(2)} pt</output></span>
        <button onClick={() => setOffsets(previous => ({ ...previous, [pair]: zeroOffset }))}>戻す</button>
        <button onClick={props.onClose}>終わる</button>
      </div>
      <small>赤＝旧版だけ、青＝新版だけ、灰＝共通。保存済みの書き込みを比較します。</small>
      {(props.old.dirty || props.next.dirty) && <small>未保存の書き込みは表示されません。</small>}
    </header>
    {failure && <p role="alert">{failure}</p>}
    <div className="compare-body">
      <div className="compare-panes">
        {ready ? <>
          <div className="compare-pane" data-testid="compare-old" style={{ '--compare-shift-x': `${(offset[0] - committed[0]) * zoom * CSS_PX_PER_PT}px`, '--compare-shift-y': `${(offset[1] - committed[1]) * zoom * CSS_PX_PER_PT}px` } as CSSProperties}>
            {mode === 'side' && <div className="compare-pane-title">旧版 — {props.old.name}</div>}
            <ComparePane key={`left:${pair}`} {...common} options={leftOptions} handle={left} onZoom={setZoom} onChange={changeLeft} onInteract={interactLeft} onBitmap={bitmap} />
          </div>
          {mode === 'side' && <div className="compare-pane" data-testid="compare-new"><div className="compare-pane-title">新版 — {props.next.name}</div>
            <ComparePane key={`right:${pair}`} {...common} options={rightOptions} handle={right} onZoom={noop} onChange={changeRight} onInteract={interactRight} onBitmap={noop} />
          </div>}
        </> : <p>比較を準備しています…</p>}
      </div>
      <aside className="compare-list" aria-label="違いの一覧"><h2>違いの一覧</h2>
        {detecting ? <p role="status">違いを調べています…</p> : !regions.length && <p>違いはありません</p>}
        {regions.map((rect, index) => <button key={index} data-testid="compare-difference" aria-pressed={active === index} data-rect={rect.join(',')} onClick={() => chooseDifference(index)}>{index + 1} p.{oldPage + 1} {differenceLocation(rect, size.width, size.height)}</button>)}
      </aside>
    </div>
  </section>
}
