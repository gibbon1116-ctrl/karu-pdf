import { createContext, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { Rect } from '../core/annotations'
import { fixtureCode, type CountFixtureSample } from '../core/countFixtures'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import type { SymbolSearchClient } from '../client/SymbolSearchClient'
import type { DocumentSession } from './documentModel'

import type { SymbolSearchSelection } from './symbolSearchContext'
export { SymbolSearchContext, type SymbolSearchSelection } from './symbolSearchContext'

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
  const [rotations, setRotations] = useState(false), [threshold, setThreshold] = useState(.70)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('')
  const [progress, setProgress] = useState({ page: 0, total: 1, stage: '描画中', fraction: 0 })
  const [completedPages, setCompletedPages] = useState<number[]>([]), [searchPageCount, setSearchPageCount] = useState(0)
  const client = useRef<SymbolSearchClient | null>(null), task = useRef<{ cancel(): void } | null>(null)
  const generation = useRef(0), alive = useRef(false)
  const candidates = store.symbolCandidates
  const chosen = candidates?.filter(c => c.state === 'chosen') ?? []
  const counted = candidates?.filter(c => c.state === 'counted').length ?? 0
  const pageCounts = useMemo(() => {
    const counts = new Map<number, number>()
    for (const c of store.symbolCandidates ?? []) counts.set(c.pageIndex, (counts.get(c.pageIndex) ?? 0) + 1)
    return completedPages.map(page => [page, counts.get(page) ?? 0] as const)
  }, [store, version, completedPages])
  const stop = () => { generation.current++; task.current?.cancel(); task.current = null; setBusy(false) }
  const invalidate = () => { stop(); store.clearSymbolCandidates(); setCompletedPages([]); setMessage('条件を変えました。「探す」を押してください'); setError('') }
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
    store.beginSymbolCandidates(fixtureId, rect); setBusy(true); setMessage(''); setError(''); setCompletedPages([]); setSearchPageCount(pages.length)
    setProgress({ page: 1, total: pages.length, stage: '描画中', fraction: 0 })
    try {
      if (!client.current) {
        const module = await import('../client/SymbolSearchClient')
        if (!current()) return
        client.current = new module.SymbolSearchClient(pool, (docId, index) => docId === session.docId ? session.pageSizes[index] : undefined)
      }
      for (let i = 0; i < pages.length; i++) {
        if (!current()) return
        const pageIndex = pages[i]
        // Existing marks must be known before counted classification, including off-screen pages.
        await store.ensurePageLoaded(pageIndex, () => pool.listAnnotations(session.docId, pageIndex))
        if (!current()) return
        const next = client.current.search({ docId: session.docId, pageIndex, samplePageIndex: sample.pageIndex, sampleRect: rect,
          options: { threshold, rotations, maxResults: 500 } }, (stage, done, total) => {
          if (current()) setProgress({ page: i + 1, total: pages.length, stage: stage === 'render' ? '描画中' : '照合中',
            fraction: (i + (stage === 'render' ? .5 * done / Math.max(1, total) : .5 + .5 * done / Math.max(1, total))) / pages.length })
        })
        task.current = next
        const result = await next.promise
        if (!current()) return
        task.current = null; store.appendSymbolCandidates(result.candidates); setCompletedPages(done => [...done, pageIndex])
      }
      if (current()) { setProgress(p => ({ ...p, fraction: 1 })); setMessage('検索が終わりました。候補を確認して選んでください') }
    } catch (reason) { if (current()) setError(`検索できませんでした: ${(reason as Error).message}`) }
    finally { if (current()) { task.current = null; setBusy(false) } }
  }
  const add = () => {
    if (busy || store.selectedFixtureId !== fixtureId) return
    const selected = store.symbolCandidates?.filter(c => c.state === 'chosen') ?? []
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
    <button type="button" onClick={onRecapture}>見本を囲み直す</button>
    <fieldset><legend>探す範囲</legend>
      {([['current', 'このページ'], ['specified', 'ページを指定'], ['all', 'すべてのページ']] as const).map(([value, label]) =>
        <label key={value}><input type="radio" name="symbol-search-scope" checked={scope === value} onChange={() => { invalidate(); setScope(value) }} />{label}</label>)}
      {scope === 'specified' && <input aria-label="探すページ" placeholder="1-3, 5" value={pagesText} onChange={e => { invalidate(); setPagesText(e.target.value) }} />}
    </fieldset>
    <label><input type="checkbox" checked={rotations} onChange={e => { invalidate(); setRotations(e.target.checked) }} />回転した記号も探す</label>
    <label className="symbol-search-threshold">似ている度合い <output>{threshold.toFixed(2)}</output>
      <input type="range" aria-label="似ている度合い" min="0.55" max="0.95" step="0.05" value={threshold}
        onChange={e => { invalidate(); setThreshold(Number(e.target.value)) }} /></label>
    {busy ? <><button type="button" onClick={() => { stop(); setMessage('中止しました') }}>中止</button>
      <p role="status">ページ {progress.page} / {progress.total}・{progress.stage}</p><progress aria-label="検索の進み" value={progress.fraction} max={1} /></>
      : <button type="button" onClick={() => void search()}>探す</button>}
    {candidates && <>
      <p aria-live="polite">候補 {candidates.length} 件（拾い済み {counted} 件）</p>
      {searchPageCount > 1 && <div className="symbol-search-pages">{pageCounts.map(([page, count]) => <button key={page} type="button" onClick={() => onPage(page)}>ページ {page + 1}: {count} 件</button>)}</div>}
      <div className="symbol-search-actions"><button type="button" onClick={() => store.chooseSymbolCandidates(true)}>すべて選ぶ</button><button type="button" onClick={() => store.chooseSymbolCandidates(false)}>すべて外す</button></div>
      <button type="button" disabled={busy || chosen.length === 0} onClick={add}>選んだ {chosen.length} 件を数量へ追加</button>
    </>}
    <p>候補は自動で数量に入りません。図面で確認して選んでください。</p>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    <button type="button" onClick={onClose}>閉じる</button>
  </section>, host)
}
