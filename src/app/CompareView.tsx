import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
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
import { alignTwoPoints, readCorrespondences, type Alignment, type PageCorrespondence } from '../core/registration'
import type { Point } from '../core/annotations'

const IssueTransferDialog = lazy(() => import('./IssueTransferDialog').then(m => ({ default: m.IssueTransferDialog })))
const neutralAlignment: Alignment = { scale: 1, rotation: 0 }

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
  const registrationControls = useRef<HTMLDetailsElement>(null)
  const [ready, setReady] = useState(false), [failure, setFailure] = useState('')
  const [mode, setMode] = useState<'overlay' | 'side'>('overlay')
  const [oldPage, setOldPage] = useState(() => Math.max(0, Math.min(props.old.pageSizes.length - 1, props.old.view.page - 1)))
  const [newPage, setNewPage] = useState(() => Math.max(0, Math.min(props.next.pageSizes.length - 1, props.old.view.page - 1)))
  const [includeAnnotations, setInclude] = useState(false)
  const [detection, setDetection] = useState<'lines' | 'color'>('lines')
  const [tolerance, setTolerance] = useState(24)
  const [offsets, setOffsets] = useState<Record<string, [number, number]>>({})
  const [committedOffsets, setCommittedOffsets] = useState<Record<string, [number, number]>>({})
  const [alignments, setAlignments] = useState<Record<string, Alignment>>({})
  const [picked, setPicked] = useState<Point[] | null>(null)
  const [overlayMode, setOverlayMode] = useState<'changes' | 'blend'>('changes')
  const [blend, setBlend] = useState(.5), [committedBlend, setCommittedBlend] = useState(.5)
  const [drawingNumber, setDrawingNumber] = useState('')
  const [mappings, setMappings] = useState<PageCorrespondence[]>([])
  const [transfer, setTransfer] = useState<PageCorrespondence | null>(null)
  const [regions, setRegions] = useState<CompareRect[]>([]), [active, setActive] = useState(-1)
  const [detecting, setDetecting] = useState(true), [zoom, setZoom] = useState(1)
  const [imageMs, setImageMs] = useState<number | null>(null), [detectionMs, setDetectionMs] = useState<number | null>(null)
  const started = useRef(performance.now()), firstImage = useRef(false)
  const left = useRef<ViewerHandle>(null), right = useRef<ViewerHandle>(null)
  const frame = useRef(0), driver = useRef(new ViewSyncDriver())
  const pair = `${oldPage}:${newPage}`
  const offset = offsets[pair] ?? zeroOffset, committed = committedOffsets[pair] ?? zeroOffset
  const alignment = alignments[pair] ?? neutralAlignment
  const size = props.old.pageSizes[oldPage]
  const options = useMemo<CompareOptions>(() => ({ docId: props.old.docId, newDocId: props.next.docId,
    pageIndex: oldPage, newPageIndex: newPage, renderScale: 1, deviceRect: null, offset: committed, alignment, overlayMode, blend: committedBlend, includeAnnotations, detection, tolerance }),
  [props.old.docId, props.next.docId, oldPage, newPage, committed, alignment, overlayMode, committedBlend, includeAnnotations, detection, tolerance])
  useEffect(() => { const timer = setTimeout(() => setCommittedBlend(blend), 150); return () => clearTimeout(timer) }, [blend])
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
  useEffect(() => {
    if (picked?.length !== 0 || mode !== 'side') return
    const id = requestAnimationFrame(() => { interact('left'); left.current?.fitWidth(); right.current?.fitWidth() })
    return () => cancelAnimationFrame(id)
  }, [picked?.length, mode, interact])
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
  const correspondence: PageCorrespondence = { oldPage, newPage, offset: [...offset], alignment: { ...alignment }, drawingNumber }
  const resetAlignment = () => { setOffsets(v => ({ ...v, [pair]: zeroOffset })); setAlignments(v => ({ ...v, [pair]: neutralAlignment })) }
  return <section ref={root} tabIndex={-1} className="compare-view" data-testid="compare-view" data-image-ms={imageMs ?? ''} data-detection-ms={detectionMs ?? ''}
    data-offset-x={offset[0]} data-offset-y={offset[1]} data-alignment-scale={alignment.scale} data-alignment-rotation={alignment.rotation}
    onPointerDownCapture={e => {
      if (picked === null || e.button !== 0) return
      const pane = (e.target as Element).closest('.compare-pane')
      if (!pane) return
      const expected = picked.length % 2 === 0 ? 'compare-old' : 'compare-new'
      e.preventDefault(); e.stopPropagation()
      if (pane.getAttribute('data-testid') !== expected) return
      const layer = pane.querySelector<HTMLElement>('.page-view')
      if (!layer) return
      const box = layer.getBoundingClientRect()
      if (!box.width || !box.height) return
      const point: Point = [(e.clientX-box.left)*size.width/box.width, (e.clientY-box.top)*size.height/box.height]
      if (point[0] < 0 || point[1] < 0 || point[0] > size.width || point[1] > size.height) return
      const points = [...picked, point]
      if (points.length < 4) setPicked(points)
      else {
        try {
          const result = alignTwoPoints(points[0], points[1], points[2], points[3])
          setOffsets(v => ({ ...v, [pair]: result.offset })); setAlignments(v => ({ ...v, [pair]: result.alignment })); setMode('overlay')
        } catch (error) { setFailure(String(error)) }
        setPicked(null)
      }
    }} onKeyDownCapture={e => {
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
        {mode === 'overlay' && <><label>表示<select aria-label="重ね合わせの表示" value={overlayMode} onChange={e => setOverlayMode(e.target.value as 'changes' | 'blend')}>
          <option value="changes">差分の色分け</option><option value="blend">透過で重ねる</option></select></label>
          {overlayMode === 'blend' && <label>新版の濃さ<input aria-label="新版の濃さ" type="range" min="0" max="1" step=".05" value={blend} onChange={e => setBlend(Number(e.target.value))} />{Math.round(blend*100)}%</label>}</>}
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
        <label>検出<select aria-label="比較の検出方法" value={detection} onChange={e => setDetection(e.target.value as 'lines' | 'color')}><option value="lines">線の追加・削除</option><option value="color">色・濃さの変更</option></select></label>
        {detection === 'color' && <label>感度<select aria-label="比較の感度" value={tolerance} onChange={e => setTolerance(Number(e.target.value))}><option value={48}>低</option><option value={24}>標準</option><option value={8}>高</option></select></label>}
        <span>位置合わせ: 方向キー（Shift: 10px） <output>{offset[0].toFixed(2)}, {offset[1].toFixed(2)} pt</output></span>
        <button onClick={resetAlignment}>戻す</button>
        <details ref={registrationControls} className="compare-registration"><summary>位置合わせ・ページ対応・指摘引継ぎ</summary>
        <button disabled={!ready || aligning} onClick={() => { resetAlignment(); setPicked([]); setMode('side'); setFailure(''); if (registrationControls.current) registrationControls.current.open = false }}>2点で位置合わせ</button>
        <label>図面番号<input aria-label="比較の図面番号" maxLength={200} value={drawingNumber} onChange={e => setDrawingNumber(e.target.value)} /></label>
        <button disabled={aligning || picked !== null} onClick={() => setMappings(v => [...v.filter(m => m.oldPage !== oldPage), correspondence])}>このページ対応を記録</button>
        {!!mappings.length && <label>記録した対応<select aria-label="記録したページ対応" value="" onChange={e => {
          const m = mappings[Number(e.target.value)]; if (!m) return
          setOldPage(m.oldPage); setNewPage(m.newPage); setDrawingNumber(m.drawingNumber)
          const key = `${m.oldPage}:${m.newPage}`; setOffsets(v => ({ ...v, [key]: m.offset })); setAlignments(v => ({ ...v, [key]: m.alignment }))
        }}><option value="">選択…</option>{mappings.map((m,i) => <option key={m.oldPage} value={i}>{m.drawingNumber || '図面'}：旧{m.oldPage+1} → 新{m.newPage+1}</option>)}</select></label>}
        <button disabled={!ready || aligning || picked !== null || !!props.next.editRestriction || props.old.docId === props.next.docId} onClick={() => setTransfer(correspondence)}>この図面の指摘を引き継ぐ</button>
        <label>ページ対応を読み込む<input aria-label="ページ対応を読み込む" type="file" accept=".json,application/json" onChange={e=>{
          const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(!file)return
          if(file.size>512*1024){setFailure('ページ対応ファイルが大きすぎます。');return}
          void file.text().then(raw=>{
            const loaded=readCorrespondences(raw,props.old.pageSizes.length,props.next.pageSizes.length)
            if(loaded.old!==props.old.name||loaded.next!==props.next.name)throw new Error('ページ対応ファイルの文書名が現在の比較と一致しません。')
            setMappings(loaded.mappings);setFailure('')
          }).catch(reason=>setFailure(String(reason)))
        }} /></label>
        </details>
        {picked !== null && <><span role="status">{picked.length < 2 ? '1点目' : '2点目'}：{picked.length % 2 === 0 ? '旧版' : '新版'}の同じ位置をクリック</span><button onClick={() => setPicked(null)}>位置合わせを中止</button></>}
        <button onClick={props.onClose}>終わる</button>
      </div>
      <small>{detection === 'color' ? '紫＝色・濃さの違い。小さな差は感度と画像解像度により省略されます。' : '赤＝旧版だけ、青＝新版だけ、灰＝共通。色や濃さだけの変更は検出しません。'} 保存済みの書き込みを比較します。</small>
      {(props.old.dirty || props.next.dirty) && <small>未保存の書き込みは表示されません。</small>}
      {!!mappings.length && <button onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, old: props.old.name, next: props.next.name, mappings }, null, 2)], { type: 'application/json' }))
        const a = document.createElement('a'); a.href = url; a.download = '図面のページ対応.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      }}>ページ対応を書き出す</button>}
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
    {transfer && <Suspense fallback={<p role="status">引継ぎ画面を開いています…</p>}><IssueTransferDialog old={props.old} next={props.next} pool={props.pool} mapping={transfer} onClose={() => setTransfer(null)} onPreview={a => { left.current?.zoomToRect(0, a.rect); right.current?.zoomToRect(0, a.rect) }} /></Suspense>}
  </section>
}
