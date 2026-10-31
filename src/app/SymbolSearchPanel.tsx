import { createContext, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { Rect } from '../core/annotations'
import { fixtureCode, type CountFixtureSample } from '../core/countFixtures'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import type { SymbolSearchClient } from '../client/SymbolSearchClient'
import type { DocumentSession } from './documentModel'
import { symbolLabelDisplay, UNKNOWN_SYMBOL_LABEL } from '../core/symbolLabels'
import { defaultVectorTolerance } from '../core/vectorSymbolSearch'
import SymbolCandidateReview from './SymbolCandidateReview'

import type { SymbolSearchSelection } from './symbolSearchContext'
export { SymbolSearchContext, type SymbolSearchSelection } from './symbolSearchContext'

const shapeFeatures = [['topArc', '円弧'], ['annexFrame', '外の枠'], ['interiorLines', '中の斜線'], ['interior', '中の塗り']] as const

/** User-facing pages are one-based; the client receives sorted, unique zero-based pages. */
export function parseSymbolSearchPages(text: string, pageCount: number): number[] {
  if (!Number.isInteger(pageCount) || pageCount < 1 || !text.trim()) throw new Error('ページを 1-3, 5 の形で指定してください')
  const pages = new Set<number>()
  for (const part of text.split(',')) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part)
    if (!match) throw new Error('ページを 1-3, 5 の形で指定してください')
    const start = Number(match[1]), end = Number(match[2] ?? match[1])
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > pageCount) throw new Error('ページの指定が範囲外です')
    for (let p = start; p <= end; p++) pages.add(p - 1)
  }
  return [...pages].sort((a, b) => a - b)
}

export default function SymbolSearchPanel({ selection, pool, onClose, onRecapture, onRequestArea, onPage, onLocate, onStatus, registerDispose }: {
  selection: SymbolSearchSelection; pool: PdfWorkerPool; onClose(): void; onRecapture(): void
  onRequestArea(): Promise<{ pageIndex: number; rect: Rect } | null>
  onPage(pageIndex: number): void; onLocate(pageIndex: number, rect: Rect): void; onStatus(message: string): void
  registerDispose(dispose: (() => void) | null): void
}) {
  const { session, fixtureId, sample, rect } = selection, store = session.annotationStore
  const sampleSession = selection.sampleSession ?? session
  const version = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const fixture = store.getCountFixture(fixtureId)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [scope, setScope] = useState<'current' | 'specified' | 'all' | 'area'>('current'), [pagesText, setPagesText] = useState('')
  const [area, setArea] = useState<{ pageIndex: number; rect: Rect } | null>(null)
  const [capturingArea, setCapturingArea] = useState(false)
  const capturingAreaRef = useRef(false)
  const [rotations, setRotations] = useState(false), [threshold, setThreshold] = useState(.85)
  const [verify, setVerify] = useState(() => {
    try { return localStorage.getItem('karu-pdf:symbol-search-verify') !== 'false' } catch { return true }
  })
  const [shapeCheck, setShapeCheck] = useState(() => {
    try { return localStorage.getItem('karu-pdf:symbol-search-shape') === 'true' } catch { return false }
  })
  const [splitG, setSplitG] = useState(() => {
    try { return localStorage.getItem('karu-pdf:symbol-search-split-g') !== 'false' } catch { return true }
  })
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('')
  const [progress, setProgress] = useState({ page: 0, total: 1, stage: '描画中', fraction: 0 })
  const [methods, setMethods] = useState<Record<number, 'vector' | 'image'>>({})
  const [templateSummary, setTemplateSummary] = useState<{ segments: number; removed: number } | null>(null)
  const [vectorSource, setVectorSource] = useState<{
    segments: Float32Array; widths: Float32Array; total: number
  } | null>(null)
  const [eraserComponent, setEraserComponent] = useState<typeof import('./SymbolSampleEraser').default | null>(null)
  const [eraserOpen, setEraserOpen] = useState(false), [loadingEraser, setLoadingEraser] = useState(false)
  const savedLines = fixture?.sample?.lines
  const storedLinesKey = useMemo(() => JSON.stringify(savedLines ?? null), [savedLines])
  const observedLinesKey = useRef(storedLinesKey)
  const [temporaryLines, setTemporaryLines] = useState<{
    lines: { segments: Float32Array; widths: Float32Array }; savedKey: string
  } | null>(null)
  const activeTemporaryLines = temporaryLines?.savedKey === storedLinesKey ? temporaryLines.lines : null
  const sampleLines = useMemo(() => activeTemporaryLines ?? (savedLines ? {
    segments: new Float32Array(savedLines.segments), widths: new Float32Array(savedLines.widths),
  } : undefined), [activeTemporaryLines, savedLines])
  const usedLineCount = sampleLines ? sampleLines.segments.length / 4 : 0
  const erasedLineCount = Math.max(0, (vectorSource?.total ?? usedLineCount) - usedLineCount)
  const Eraser = eraserComponent
  const [completedPages, setCompletedPages] = useState<number[]>([]), [searchPageCount, setSearchPageCount] = useState(0)
  const client = useRef<SymbolSearchClient | null>(null), task = useRef<{ cancel(): void } | null>(null)
  const generation = useRef(0), alive = useRef(false)
  const candidates = store.visibleSymbolCandidates
  const labelCounts = new Map<string, number>()
  // Count only candidates the shape and other-fixture filters can show, so a label never offers hidden marks.
  for (const c of store.symbolCandidates ?? []) if ((store.symbolShapeFilter === 'all' || c.shape?.decision !== 'different')
    && (store.symbolOtherFilter === 'show' || !c.otherFixture)) labelCounts.set(c.label, (labelCounts.get(c.label) ?? 0) + 1)
  const labelGroups = [...labelCounts].sort((a, b) => !a[0] ? 1 : !b[0] ? -1 : b[1] - a[1] || a[0].localeCompare(b[0]))
  const shapeCompared = store.symbolCandidates?.some(c => c.shape !== undefined) ?? false
  const shapeDifferent = store.symbolCandidates?.filter(c => c.shape?.decision === 'different') ?? []
  const shapeDifferenceSummary = shapeFeatures.map(([feature, name]) => {
    const count = shapeDifferent.filter(c => c.shape?.differences.includes(feature)).length
    return count ? `${name} ${count}` : ''
  }).filter(Boolean).join('・')
  const otherCandidates = store.symbolCandidates?.filter(c => c.otherFixture) ?? []
  const otherFixtureCounts = new Map<string, number>()
  for (const c of otherCandidates) if (c.otherFixture) otherFixtureCounts.set(c.otherFixture, (otherFixtureCounts.get(c.otherFixture) ?? 0) + 1)
  const otherFixtureSummary = [...otherFixtureCounts].map(([id, count]) => `${store.symbolOtherFixtureLabel(id)} ${count}`).join('・')
  const chosen = candidates?.filter(c => c.state === 'chosen') ?? []
  const counted = candidates?.filter(c => c.state === 'counted').length ?? 0
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewGeneration, setReviewGeneration] = useState(0)
  // 窓が開いている間だけ、図面のクリックで候補を強調する（閉じているときは今までの選択の色のまま）。
  useLayoutEffect(() => {
    store.setSymbolReviewOpen(reviewOpen)
    return () => store.setSymbolReviewOpen(false)
  }, [store, reviewOpen])
  const chooseAllCandidates = () => {
    store.chooseSymbolCandidates(true)
    if (candidates?.some(candidate => candidate.state !== 'counted')) setReviewOpen(true)
  }
  const chooseHighConfidenceCandidates = () => {
    const hasPendingHighConfidence = !!candidates?.some(candidate =>
      candidate.confidence === 'high' && candidate.state === 'pending')
    store.chooseHighConfidenceCandidates()
    if (hasPendingHighConfidence) setReviewOpen(true)
  }
  const closeReview = () => {
    setReviewOpen(false)
    store.setFocusedSymbolCandidate(null)
  }
  const confidenceSummary = (items: typeof store.symbolCandidates) => {
    const high = items?.filter(c => c.confidence === 'high').length ?? 0
    const check = items?.filter(c => c.confidence === 'check').length ?? 0
    return high + check ? `（確度高 ${high} 件・要確認 ${check} 件）` : ''
  }
  const pageCounts = useMemo(() => {
    const counts = new Map<number, number>()
    for (const c of store.visibleSymbolCandidates ?? []) counts.set(c.pageIndex, (counts.get(c.pageIndex) ?? 0) + 1)
    return completedPages.map(page => [page, counts.get(page) ?? 0] as const)
  }, [store, version, completedPages])
  const stop = () => { generation.current++; task.current?.cancel(); task.current = null; setBusy(false) }
  const invalidate = () => { stop(); store.clearSymbolCandidates(); setCompletedPages([]); setMethods({}); setTemplateSummary(null); setMessage('条件を変えました。「探す」を押してください'); setError('') }
  useLayoutEffect(() => {
    alive.current = true
    // Mount only during explicit search, outside the scrolling surface. No ordinary-view observer.
    setHost(document.querySelector<HTMLElement>('.document-workspace .viewer-slot'))
    const dispose = () => {
      alive.current = false; generation.current++; task.current?.cancel(); task.current = null
      client.current?.dispose(); client.current = null; store.clearSymbolCandidates()
    }
    registerDispose(dispose)
    return () => { registerDispose(null); dispose() }
  }, [store, registerDispose])

  useLayoutEffect(() => {
    // clearSymbolCandidates also clears the overlay; restore it while this panel remains active.
    if (alive.current) store.setSymbolSearchArea(scope === 'area' ? area : null)
  }, [store, version, scope, area])

  useLayoutEffect(() => {
    const abort = new AbortController()
    let disposed = false
    setVectorSource(null)
    // Only the explicitly opened search panel requests this page's vector information.
    // Automatic cleanup and the eraser UI are not loaded here.
    void sampleSession.vectorCache.get(sample.pageIndex, pool, abort.signal, true).then(page => {
      if (disposed || !alive.current || (page.kind !== 'vector' && page.kind !== 'mixed')) return
      const tolerance = defaultVectorTolerance(rect)
      let total = 0
      for (let i = 0; i < page.segments.length; i += 4) {
        const a = page.segments
        if (a[i] >= rect[0] - tolerance && a[i] <= rect[2] + tolerance
          && a[i + 1] >= rect[1] - tolerance && a[i + 1] <= rect[3] + tolerance
          && a[i + 2] >= rect[0] - tolerance && a[i + 2] <= rect[2] + tolerance
          && a[i + 3] >= rect[1] - tolerance && a[i + 3] <= rect[3] + tolerance
          && Math.hypot(a[i + 2] - a[i], a[i + 3] - a[i + 1]) > 0) total++
      }
      setVectorSource({ segments: page.segments, widths: page.widths, total })
    }, reason => {
      if (!disposed && alive.current) setError(`見本の線を読み込めませんでした: ${(reason as Error).message}`)
    })
    return () => { disposed = true; abort.abort() }
  }, [sampleSession, pool, sample.pageIndex, rect])
  useLayoutEffect(() => {
    if (observedLinesKey.current === storedLinesKey) return
    observedLinesKey.current = storedLinesKey
    // Also invalidate results when saved lines change through Ctrl+Z/redo.
    invalidate()
  }, [storedLinesKey])

  const updateStoredLines = (lines: CountFixtureSample['lines']) => {
    const fixtures = store.getCountFixtures()
    const currentFixture = fixtures.find(f => f.id === fixtureId)
    if (!currentFixture) throw new Error('項目が見つかりません')
    const { lines: _lines, ...baseSample } = currentFixture.sample ?? sample
    store.setCountFixtures(fixtures.map(f => f.id === fixtureId ? {
      ...f, sample: { ...baseSample, ...(lines ? { lines } : {}) },
    } : f))
  }
  const openEraser = async () => {
    if (!vectorSource || vectorSource.total < 2 || busy || capturingAreaRef.current || loadingEraser) return
    if (vectorSource.total > 4096) {
      setError('線が多すぎるため整えられません。小さく囲んでください')
      return
    }
    const run = generation.current
    setLoadingEraser(true); setError('')
    try {
      const module = await import('./SymbolSampleEraser')
      if (!alive.current || generation.current !== run || store.selectedFixtureId !== fixtureId) return
      setEraserComponent(() => module.default); setEraserOpen(true)
    } catch (reason) {
      if (alive.current) setError(`見本の線を整える画面を開けませんでした: ${(reason as Error).message}`)
    } finally {
      if (alive.current) setLoadingEraser(false)
    }
  }
  const applySampleLines = (lines: { segments: Float32Array; widths: Float32Array }) => {
    if (!alive.current || store.selectedFixtureId !== fixtureId) return
    try {
      const count = lines.segments.length / 4
      if (count <= 256) {
        updateStoredLines({ segments: Array.from(lines.segments), widths: Array.from(lines.widths) })
        setTemporaryLines(null)
      } else {
        if (store.getCountFixture(fixtureId)?.sample?.lines) updateStoredLines(undefined)
        setTemporaryLines({
          lines,
          savedKey: JSON.stringify(store.getCountFixture(fixtureId)?.sample?.lines ?? null),
        })
      }
      invalidate(); setEraserOpen(false)
      if (count > 256) onStatus('線が多いため、整えた線は項目に保存しません')
      else onStatus('整えた線を項目の見本に保存しました（Ctrl+Z で戻せます）')
    } catch (reason) {
      setError(`整えた線を反映できませんでした: ${(reason as Error).message}`)
    }
  }
  const restoreSampleLines = () => {
    try {
      if (store.getCountFixture(fixtureId)?.sample?.lines) updateStoredLines(undefined)
      setTemporaryLines(null); invalidate()
    } catch (reason) {
      setError(`整えた線を元に戻せませんでした: ${(reason as Error).message}`)
    }
  }

  const requestArea = async () => {
    if (!alive.current || capturingAreaRef.current) return
    capturingAreaRef.current = true; setCapturingArea(true); stop(); setError('')
    try {
      const nextArea = await onRequestArea()
      if (!alive.current) return
      if (nextArea) { setArea(nextArea); invalidate() }
    } catch (reason) {
      if (alive.current) setError(`範囲を囲めませんでした: ${(reason as Error).message}`)
    } finally {
      capturingAreaRef.current = false
      if (alive.current) setCapturingArea(false)
    }
  }
  const search = async () => {
    if (capturingAreaRef.current) return
    let pages: number[], searchRect: Rect | undefined
    try {
      if (scope === 'area') {
        if (!area) throw new Error('範囲を囲んでください')
        if (area.rect[2] - area.rect[0] < rect[2] - rect[0] || area.rect[3] - area.rect[1] < rect[3] - rect[1])
          throw new Error('範囲が見本より小さいため探せません。広く囲んでください')
        pages = [area.pageIndex]; searchRect = area.rect
      } else {
        pages = scope === 'all' ? Array.from({ length: session.pageSizes.length }, (_, i) => i)
          : scope === 'specified' ? parseSymbolSearchPages(pagesText, session.pageSizes.length) : [session.view.page - 1]
      }
    } catch (reason) { setError((reason as Error).message); return }
    stop()
    const run = generation.current
    const current = () => alive.current && generation.current === run && store.selectedFixtureId === fixtureId
    setReviewOpen(false); setReviewGeneration(value => value + 1)
    store.beginSymbolCandidates(fixtureId, rect); setBusy(true); setMessage(''); setError(''); setCompletedPages([]); setSearchPageCount(pages.length); setTemplateSummary(null)
    store.setSymbolCandidateFilters([''], 'all')
    let initializedLabels = false
    setProgress({ page: 1, total: pages.length, stage: '描画中', fraction: 0 })
    try {
      if (!client.current) {
        const module = await import('../client/SymbolSearchClient')
        if (!current()) return
        client.current = new module.SymbolSearchClient(pool,
          (docId, index) => docId === session.docId ? session.pageSizes[index] : docId === sampleSession.docId ? sampleSession.pageSizes[index] : undefined,
          docId => docId === session.docId ? session.vectorCache : docId === sampleSession.docId ? sampleSession.vectorCache : undefined)
      }
      for (let i = 0; i < pages.length; i++) {
        if (!current()) return
        const pageIndex = pages[i]
        // Existing marks must be known before counted and other-fixture classification, including off-screen pages.
        await store.ensurePageLoaded(pageIndex, () => pool.listAnnotations(session.docId, pageIndex))
        if (!current()) return
        const next = client.current.search({ docId: session.docId, pageIndex, samplePageIndex: sample.pageIndex, sampleRect: rect, verify, shapeCheck, splitG,
          ...(sampleSession !== session ? { sampleDocId: sampleSession.docId } : {}),
          ...(sampleLines ? { sampleLines } : {}),
          ...(searchRect ? { searchRect } : {}),
          options: { threshold, rotations, maxResults: 500 } }, (stage, done, total) => {
          if (current()) setProgress({ page: i + 1, total: pages.length, stage: stage === 'render' ? '描画中' : stage === 'vector' ? '線で照合中' : stage === 'verify' ? '画像で確認中' : '照合中',
            fraction: (i + (stage === 'render' ? .5 * done / Math.max(1, total) : stage === 'vector' ? .2 + .3 * done / Math.max(1, total) : .5 + .5 * done / Math.max(1, total))) / pages.length })
        })
        task.current = next
        const result = await next.promise
        if (!current()) return
        const template = result.vectorDetails?.template
        if (template?.cleaned && !sampleLines) setTemplateSummary({ segments: template.segments, removed: template.removed.wiring + template.removed.other + template.removed.thin })
        if (result.method === 'vector' && !initializedLabels) { store.setSymbolCandidateFilters(result.sampleLabel===UNKNOWN_SYMBOL_LABEL?null:[result.sampleLabel]); initializedLabels = true }
        setMethods(methods => ({ ...methods, [pageIndex]: result.method })); task.current = null; store.appendSymbolCandidates(result.candidates); setCompletedPages(done => [...done, pageIndex])
      }
      if (current()) { setProgress(p => ({ ...p, fraction: 1 })); setMessage('検索が終わりました。候補を確認して選んでください') }
    } catch (reason) { if (current()) setError(`検索できませんでした: ${(reason as Error).message}`) }
    finally { if (current()) { task.current = null; setBusy(false) } }
  }
  const add = () => {
    if (busy || store.selectedFixtureId !== fixtureId) return
    const selected = store.visibleSymbolCandidates?.filter(c => c.state === 'chosen') ?? []
    if (!selected.length) return
    try {
      const ids = store.createCountMarks(fixtureId, selected.map(c => ({ pageIndex: c.pageIndex, center: c.center })))
      const status = `${ids.length} 件を数量へ追加しました（Ctrl+Z で戻せます）`
      setMessage(status); onStatus(status)
    } catch (reason) { setError((reason as Error).message) }
  }
  if (!host || !fixture) return null
  return createPortal(<><section className="symbol-search-panel" role="dialog" aria-label="同じ記号を探す"
    onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()} onClick={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
    <h2>同じ記号を探す</h2>
    <div className="symbol-search-sample"><img src={`data:image/png;base64,${sample.png}`} alt="探す記号の見本" /><span>{fixtureCode(fixture)} {fixture.name}</span></div>
    {sampleSession !== session && <small>見本: {sampleSession.name}（他のPDF）</small>}
    <button type="button" disabled={!vectorSource || vectorSource.total < 2 || busy || capturingArea || loadingEraser}
      title={!vectorSource || vectorSource.total < 2 ? '線の情報が無い見本は整えられません' : undefined}
      onClick={() => void openEraser()}>見本の線を整える</button>
    {sampleLines && <>
      <p>線を整えた見本（使う線 {usedLineCount} 本・消した線 {erasedLineCount} 本）</p>
      <button type="button" disabled={busy || capturingArea || loadingEraser} onClick={restoreSampleLines}>整えた線を元に戻す</button>
    </>}
    {activeTemporaryLines && <p role="status">線が多いため、整えた線は項目に保存しません</p>}
    {eraserOpen && Eraser && vectorSource && <Eraser
      pool={pool} docId={sampleSession.docId} pageIndex={sample.pageIndex} sampleRect={rect}
      pageSegments={vectorSource.segments} pageWidths={vectorSource.widths} initialLines={sampleLines}
      onApply={applySampleLines} onCancel={() => setEraserOpen(false)} />}
    <p>見本は器具本体だけを囲んでください。横の添字は自動で確認します。</p>
    <button type="button" onClick={onRecapture}>見本を囲み直す</button>
    <fieldset><legend>探す範囲</legend>
      {([['current', 'このページ'], ['specified', 'ページを指定'], ['all', 'すべてのページ'], ['area', '範囲を囲む']] as const).map(([value, label]) =>
        <label key={value}><input type="radio" name="symbol-search-scope" checked={scope === value} onChange={() => {
          invalidate(); setScope(value)
          if (value === 'area' && !area) void requestArea()
        }} />{label}</label>)}
      {scope === 'specified' && <input aria-label="探すページ" placeholder="1-3, 5" value={pagesText} onChange={e => { invalidate(); setPagesText(e.target.value) }} />}
      {scope === 'area' && <div>
        <p>{area ? `p.${area.pageIndex + 1} の範囲（${Math.round((area.rect[2] - area.rect[0]) * 25.4 / 72)} × ${Math.round((area.rect[3] - area.rect[1]) * 25.4 / 72)} mm）` : '範囲を囲んでください'}</p>
        <button type="button" disabled={capturingArea} onClick={() => void requestArea()}>{area ? '範囲を囲み直す' : '範囲を囲む'}</button>
      </div>}
    </fieldset>
    <label><input type="checkbox" checked={rotations} onChange={e => { invalidate(); setRotations(e.target.checked) }} />回転した記号も探す</label>
    <label><input type="checkbox" checked={splitG} onChange={e => {
      const enabled = e.target.checked; invalidate(); setSplitG(enabled)
      try { localStorage.setItem('karu-pdf:symbol-search-split-g', String(enabled)) } catch { /* Keep the in-memory preference. */ }
    }} />末尾の G を GC 回路の印として分ける</label>
    <label title="線で探した候補だけを画像でも確認します。線の情報が無いページの画像検索には関係しません。"><input type="checkbox" checked={verify}
      onChange={e => { const enabled = e.target.checked; invalidate(); setVerify(enabled)
        try { localStorage.setItem('karu-pdf:symbol-search-verify', String(enabled)) } catch { /* Keep the in-memory preference. */ }
      }} />画像でも確認する</label>
    <label title="線で探した候補の周りを描き、見本と円弧・外の枠・中の斜線・中の塗りを比べます。違う候補は初めは図面に出さず、分からない候補は要確認にします。検索が少し遅くなります。"><input type="checkbox" checked={shapeCheck}
      onChange={e => { const enabled = e.target.checked; invalidate(); setShapeCheck(enabled)
        try { localStorage.setItem('karu-pdf:symbol-search-shape', String(enabled)) } catch { /* Keep the in-memory preference. */ }
      }} />形の細部（円弧・枠・斜線・塗り）も見本と比べる</label>
    <label className="symbol-search-threshold">似ている度合い <output>{threshold.toFixed(2)}</output>
      <input type="range" aria-label="似ている度合い" min="0.55" max="0.98" step="0.01" value={threshold}
        onChange={e => { invalidate(); setThreshold(Number(e.target.value)) }} /></label>
    {busy ? <><button type="button" onClick={() => { stop(); setMessage('中止しました') }}>中止</button>
      <p role="status">ページ {progress.page} / {progress.total}・{progress.stage}</p><progress aria-label="検索の進み" value={progress.fraction} max={1} /></>
      : <button type="button" disabled={capturingArea} onClick={() => void search()}>探す</button>}
    {candidates && <>
      <p aria-live="polite">候補 {candidates.length} 件{confidenceSummary(candidates)}（拾い済み {counted} 件）{otherCandidates.length > 0 ? `（他の項目で拾い済み ${otherCandidates.length} 件）` : ''}</p>
      {templateSummary && <p>見本の線 {templateSummary.segments} 本（細い背景線・配線・文字とみて {templateSummary.removed} 本を除きました）</p>}
      <fieldset className="symbol-search-labels"><legend>添字で種類を分ける</legend>
        <div className="symbol-search-actions">
          <button type="button" onClick={() => store.setSymbolCandidateFilters(null)}>すべてにチェック</button>
          <button type="button" onClick={() => store.setSymbolCandidateFilters([])}>すべてのチェックを外す</button>
        </div>
        {labelGroups.map(([label, count]) => <label key={label}><input type="checkbox" checked={store.symbolLabelFilter === null || store.symbolLabelFilter.includes(label)}
          onChange={e => { const selected = store.symbolLabelFilter ?? labelGroups.map(([value]) => value)
            store.setSymbolCandidateFilters(e.target.checked ? [...selected, label] : selected.filter(value => value !== label))
          }} />{symbolLabelDisplay(label)} {count}</label>)}
      </fieldset>
      {shapeDifferent.length > 0 ? <label><input type="checkbox" checked={store.symbolShapeFilter === 'all'}
        onChange={e => store.setSymbolShapeFilter(e.target.checked ? 'all' : 'same')} />形の細部が見本と違う {shapeDifferent.length} 件も表示する（{shapeDifferenceSummary}）</label>
        : shapeCompared && <p>形の細部も見本と比べました</p>}
      {otherCandidates.length > 0 && <label><input type="checkbox" checked={store.symbolOtherFilter === 'show'}
        onChange={e => store.setSymbolOtherFilter(e.target.checked ? 'show' : 'hide')} />他の項目で拾い済みの {otherCandidates.length} 件も表示して拾えるようにする（{otherFixtureSummary}）</label>}
      <label>GC回路（G）: <select aria-label="GC回路（G）" value={store.symbolGcFilter}
        onChange={e => store.setSymbolCandidateFilters(store.symbolLabelFilter, e.target.value as 'all' | 'with' | 'without')}>
        <option value="all">すべて</option><option value="with">G あり</option><option value="without">G なし</option>
      </select></label>
      {searchPageCount === 1 && completedPages.length > 0 && <p>{methods[completedPages[0]] === 'vector' ? '線の情報で探しました' : '画像で探しました（線の情報が無いページ）'}</p>}
      {searchPageCount > 1 && <div className="symbol-search-pages">{pageCounts.map(([page, count]) => <button key={page} type="button" onClick={() => onPage(page)}>p.{page + 1} {methods[page] === 'vector' ? '線で探しました' : '画像で探しました（線の情報が無いページ）'} {count} 件{confidenceSummary(candidates.filter(c => c.pageIndex === page))}</button>)}</div>}
      <div className="symbol-search-actions"><button type="button" onClick={chooseAllCandidates}>すべて選ぶ</button><button type="button" onClick={() => store.chooseSymbolCandidates(false)}>すべて外す</button></div>
      <button type="button" disabled={busy || !candidates.some(c => c.confidence === 'high' && c.state === 'pending')}
        onClick={chooseHighConfidenceCandidates}>確度の高い候補を選ぶ</button>
      <button type="button" onClick={() => setReviewOpen(true)}>選んだ候補を画像で確認</button>
      <button type="button" disabled={busy || chosen.length === 0} onClick={add}>選んだ {chosen.length} 件を数量へ追加</button>
    </>}
    <p>候補は自動で数量に入りません。図面で確認して選んでください。</p>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    <button type="button" onClick={onClose}>閉じる</button>
  </section>
    {store.symbolCandidates !== null && <SymbolCandidateReview
      key={reviewGeneration} session={session} pool={pool} open={reviewOpen}
      onClose={closeReview} onLocate={onLocate} />}
  </>, host)
}
