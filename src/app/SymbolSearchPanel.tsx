import { createContext, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { Rect } from '../core/annotations'
import { fixtureCode, type CountFixtureSample } from '../core/countFixtures'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import type { SymbolSearchClient } from '../client/SymbolSearchClient'
import type { DocumentSession } from './documentModel'
import { symbolLabelDisplay, UNKNOWN_SYMBOL_LABEL } from '../core/symbolLabels'

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

export default function SymbolSearchPanel({ selection, pool, onClose, onRecapture, onPage, onStatus, registerDispose }: {
  selection: SymbolSearchSelection; pool: PdfWorkerPool; onClose(): void; onRecapture(): void
  onPage(pageIndex: number): void; onStatus(message: string): void
  registerDispose(dispose: (() => void) | null): void
}) {
  const { session, fixtureId, sample, rect } = selection, store = session.annotationStore
  const version = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const fixture = store.getCountFixture(fixtureId)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [scope, setScope] = useState<'current' | 'specified' | 'all'>('current'), [pagesText, setPagesText] = useState('')
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
  const chosen = candidates?.filter(c => c.state === 'chosen' && !c.otherFixture) ?? []
  const counted = candidates?.filter(c => c.state === 'counted').length ?? 0
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

  const search = async () => {
    let pages: number[]
    try {
      pages = scope === 'all' ? Array.from({ length: session.pageSizes.length }, (_, i) => i)
        : scope === 'specified' ? parseSymbolSearchPages(pagesText, session.pageSizes.length) : [session.view.page - 1]
    } catch (reason) { setError((reason as Error).message); return }
    stop()
    const run = generation.current
    const current = () => alive.current && generation.current === run && store.selectedFixtureId === fixtureId
    store.beginSymbolCandidates(fixtureId, rect); setBusy(true); setMessage(''); setError(''); setCompletedPages([]); setSearchPageCount(pages.length); setTemplateSummary(null)
    store.setSymbolCandidateFilters([''], 'all')
    let initializedLabels = false
    setProgress({ page: 1, total: pages.length, stage: '描画中', fraction: 0 })
    try {
      if (!client.current) {
        const module = await import('../client/SymbolSearchClient')
        if (!current()) return
        client.current = new module.SymbolSearchClient(pool, (docId, index) => docId === session.docId ? session.pageSizes[index] : undefined, () => session.vectorCache)
      }
      for (let i = 0; i < pages.length; i++) {
        if (!current()) return
        const pageIndex = pages[i]
        // Existing marks must be known before counted and other-fixture classification, including off-screen pages.
        await store.ensurePageLoaded(pageIndex, () => pool.listAnnotations(session.docId, pageIndex))
        if (!current()) return
        const next = client.current.search({ docId: session.docId, pageIndex, samplePageIndex: sample.pageIndex, sampleRect: rect, verify, shapeCheck, splitG,
          options: { threshold, rotations, maxResults: 500 } }, (stage, done, total) => {
          if (current()) setProgress({ page: i + 1, total: pages.length, stage: stage === 'render' ? '描画中' : stage === 'vector' ? '線で照合中' : stage === 'verify' ? '画像で確認中' : '照合中',
            fraction: (i + (stage === 'render' ? .5 * done / Math.max(1, total) : stage === 'vector' ? .2 + .3 * done / Math.max(1, total) : .5 + .5 * done / Math.max(1, total))) / pages.length })
        })
        task.current = next
        const result = await next.promise
        if (!current()) return
        const template = result.vectorDetails?.template
        if (template?.cleaned) setTemplateSummary({ segments: template.segments, removed: template.removed.wiring + template.removed.other + template.removed.thin })
        if (result.method === 'vector' && !initializedLabels) { store.setSymbolCandidateFilters(result.sampleLabel===UNKNOWN_SYMBOL_LABEL?null:[result.sampleLabel]); initializedLabels = true }
        setMethods(methods => ({ ...methods, [pageIndex]: result.method })); task.current = null; store.appendSymbolCandidates(result.candidates); setCompletedPages(done => [...done, pageIndex])
      }
      if (current()) { setProgress(p => ({ ...p, fraction: 1 })); setMessage('検索が終わりました。候補を確認して選んでください') }
    } catch (reason) { if (current()) setError(`検索できませんでした: ${(reason as Error).message}`) }
    finally { if (current()) { task.current = null; setBusy(false) } }
  }
  const add = () => {
    if (busy || store.selectedFixtureId !== fixtureId) return
    const selected = store.visibleSymbolCandidates?.filter(c => c.state === 'chosen' && !c.otherFixture) ?? []
    if (!selected.length) return
    try {
      const ids = store.createCountMarks(fixtureId, selected.map(c => ({ pageIndex: c.pageIndex, center: c.center })))
      const status = `${ids.length} 件を数量へ追加しました（Ctrl+Z で戻せます）`
      setMessage(status); onStatus(status)
    } catch (reason) { setError((reason as Error).message) }
  }
  if (!host || !fixture) return null
  return createPortal(<section className="symbol-search-panel" role="dialog" aria-label="同じ記号を探す"
    onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()} onClick={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
    <h2>同じ記号を探す</h2>
    <div className="symbol-search-sample"><img src={`data:image/png;base64,${sample.png}`} alt="探す記号の見本" /><span>{fixtureCode(fixture)} {fixture.name}</span></div>
    <p>見本は器具本体だけを囲んでください。横の添字は自動で確認します。</p>
    <button type="button" onClick={onRecapture}>見本を囲み直す</button>
    <fieldset><legend>探す範囲</legend>
      {([['current', 'このページ'], ['specified', 'ページを指定'], ['all', 'すべてのページ']] as const).map(([value, label]) =>
        <label key={value}><input type="radio" name="symbol-search-scope" checked={scope === value} onChange={() => { invalidate(); setScope(value) }} />{label}</label>)}
      {scope === 'specified' && <input aria-label="探すページ" placeholder="1-3, 5" value={pagesText} onChange={e => { invalidate(); setPagesText(e.target.value) }} />}
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
      : <button type="button" onClick={() => void search()}>探す</button>}
    {candidates && <>
      <p aria-live="polite">候補 {candidates.length} 件{confidenceSummary(candidates)}（拾い済み {counted} 件）{otherCandidates.length > 0 ? `（他の項目で拾い済み ${otherCandidates.length} 件）` : ''}</p>
      {templateSummary && <p>見本の線 {templateSummary.segments} 本（細い背景線・配線・文字とみて {templateSummary.removed} 本を除きました）</p>}
      <fieldset className="symbol-search-labels"><legend>添字で種類を分ける</legend>
        {labelGroups.map(([label, count]) => <label key={label}><input type="checkbox" checked={store.symbolLabelFilter === null || store.symbolLabelFilter.includes(label)}
          onChange={e => { const selected = store.symbolLabelFilter ?? labelGroups.map(([value]) => value)
            store.setSymbolCandidateFilters(e.target.checked ? [...selected, label] : selected.filter(value => value !== label))
          }} />{symbolLabelDisplay(label)} {count}</label>)}
      </fieldset>
      {shapeDifferent.length > 0 ? <label><input type="checkbox" checked={store.symbolShapeFilter === 'all'}
        onChange={e => store.setSymbolShapeFilter(e.target.checked ? 'all' : 'same')} />形の細部が見本と違う {shapeDifferent.length} 件も表示する（{shapeDifferenceSummary}）</label>
        : shapeCompared && <p>形の細部も見本と比べました</p>}
      {otherCandidates.length > 0 && <label><input type="checkbox" checked={store.symbolOtherFilter === 'show'}
        onChange={e => store.setSymbolOtherFilter(e.target.checked ? 'show' : 'hide')} />他の項目で拾い済みの {otherCandidates.length} 件も表示する（{otherFixtureSummary}）</label>}
      <label>GC回路（G）: <select aria-label="GC回路（G）" value={store.symbolGcFilter}
        onChange={e => store.setSymbolCandidateFilters(store.symbolLabelFilter, e.target.value as 'all' | 'with' | 'without')}>
        <option value="all">すべて</option><option value="with">G あり</option><option value="without">G なし</option>
      </select></label>
      {searchPageCount === 1 && completedPages.length > 0 && <p>{methods[completedPages[0]] === 'vector' ? '線の情報で探しました' : '画像で探しました（線の情報が無いページ）'}</p>}
      {searchPageCount > 1 && <div className="symbol-search-pages">{pageCounts.map(([page, count]) => <button key={page} type="button" onClick={() => onPage(page)}>p.{page + 1} {methods[page] === 'vector' ? '線で探しました' : '画像で探しました（線の情報が無いページ）'} {count} 件{confidenceSummary(candidates.filter(c => c.pageIndex === page))}</button>)}</div>}
      <div className="symbol-search-actions"><button type="button" onClick={() => store.chooseSymbolCandidates(true)}>すべて選ぶ</button><button type="button" onClick={() => store.chooseSymbolCandidates(false)}>すべて外す</button></div>
      <button type="button" disabled={busy || !candidates.some(c => c.confidence === 'high' && c.state === 'pending' && !c.otherFixture)}
        onClick={() => store.chooseHighConfidenceCandidates()}>確度の高い候補を選ぶ</button>
      <button type="button" disabled={busy || chosen.length === 0} onClick={add}>選んだ {chosen.length} 件を数量へ追加</button>
    </>}
    <p>候補は自動で数量に入りません。図面で確認して選んでください。</p>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    <button type="button" onClick={onClose}>閉じる</button>
  </section>, host)
}
