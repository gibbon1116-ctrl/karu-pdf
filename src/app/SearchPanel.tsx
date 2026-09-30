import { useEffect, useRef, useState } from 'react'
import type { PdfWorkerPool, StreamingTask, SearchSummary } from '../client/PdfWorkerPool'
import type { SearchMatch, SearchOptions } from '../core/search'

export interface SearchHighlightState {
  matches: SearchMatch[]
  activeIndex: number
}

interface Props {
  docId: string
  pool: PdfWorkerPool
  focusVersion: number
  onHighlightsChange(value: SearchHighlightState): void
  onNavigate(match: SearchMatch): void
}

const defaultOptions: SearchOptions = { caseSensitive: false, normalizeWidth: true }

export function SearchPanel({ docId, pool, focusVersion, onHighlightsChange, onNavigate }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<number | undefined>(undefined)
  const taskRef = useRef<StreamingTask<SearchSummary> | null>(null)
  const resultsRef = useRef<SearchMatch[]>([])
  const [query, setQuery] = useState('')
  const [searchedQuery, setSearchedQuery] = useState('')
  const [options, setOptions] = useState(defaultOptions)
  const [results, setResults] = useState<SearchMatch[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const [progress, setProgress] = useState({ processed: 0, total: 0 })
  const [searching, setSearching] = useState(false)
  const [textPages, setTextPages] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [focusVersion])
  useEffect(() => () => {
    window.clearTimeout(timerRef.current)
    taskRef.current?.cancel()
  }, [])

  const publish = (matches: SearchMatch[], current: number) => {
    onHighlightsChange({ matches, activeIndex: current })
  }

  const startSearch = () => {
    window.clearTimeout(timerRef.current)
    taskRef.current?.cancel()
    taskRef.current = null
    const needle = query.trim()
    resultsRef.current = []
    setResults([])
    setActiveIndex(-1)
    setProgress({ processed: 0, total: 0 })
    setTextPages(0)
    setTruncated(false)
    setError('')
    setSearchedQuery(needle)
    publish([], -1)
    if (!needle) { setSearching(false); return }
    setSearching(true)
    const task = pool.searchDocument(docId, needle, options, (response) => {
      if (taskRef.current?.requestId !== response.requestId) return
      if (response.matches.length > 0) {
        resultsRef.current = [...resultsRef.current, ...response.matches]
        setResults(resultsRef.current)
        setActiveIndex((current) => {
          const next = current < 0 ? 0 : current
          publish(resultsRef.current, next)
          return next
        })
      }
      setProgress({ processed: response.processedPages, total: response.totalPages })
      setTextPages(response.textPages)
      setTruncated(response.truncated)
    })
    taskRef.current = task
    void task.promise.then((summary) => {
      if (taskRef.current?.requestId !== task.requestId) return
      setSearching(false)
      setTextPages(summary.textPages)
      setTruncated(summary.truncated)
      taskRef.current = null
    }).catch((reason) => {
      if (taskRef.current?.requestId !== task.requestId) return
      setSearching(false)
      setError(reason instanceof Error ? reason.message : String(reason))
      taskRef.current = null
    })
  }

  useEffect(() => {
    window.clearTimeout(timerRef.current)
    if (!query.trim()) {
      taskRef.current?.cancel()
      resultsRef.current = []
      setResults([])
      setActiveIndex(-1)
      setSearching(false)
      publish([], -1)
      return
    }
    timerRef.current = window.setTimeout(startSearch, 300)
    return () => window.clearTimeout(timerRef.current)
    // startSearch intentionally uses the current input/options snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, options.caseSensitive, options.normalizeWidth, docId])

  const select = (index: number) => {
    if (resultsRef.current.length === 0) return
    const next = (index + resultsRef.current.length) % resultsRef.current.length
    setActiveIndex(next)
    publish(resultsRef.current, next)
    onNavigate(resultsRef.current[next])
  }

  const countLabel = truncated ? '1,000 件以上' : `${results.length} 件`
  const noText = !searching && searchedQuery && textPages === 0

  return <section className="search-panel" aria-label="検索">
    <div className="search-box-row">
      <input
        ref={inputRef}
        type="search"
        aria-label="検索する文字"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          if (!searching && searchedQuery === query.trim() && resultsRef.current.length > 0) select(activeIndex + (event.shiftKey ? -1 : 1))
          else startSearch()
        }}
      />
      <button type="button" aria-label="前の検索結果" disabled={results.length === 0} onClick={() => select(activeIndex - 1)}>↑</button>
      <button type="button" aria-label="次の検索結果" disabled={results.length === 0} onClick={() => select(activeIndex + 1)}>↓</button>
    </div>
    <label><input type="checkbox" checked={options.caseSensitive} onChange={(event) => setOptions({ ...options, caseSensitive: event.currentTarget.checked })} />大文字・小文字を区別</label>
    <label><input type="checkbox" checked={options.normalizeWidth} onChange={(event) => setOptions({ ...options, normalizeWidth: event.currentTarget.checked })} />全角と半角を同じとみなす</label>
    <div className="search-summary" role="status" data-testid="search-summary" data-searching={searching ? 'true' : 'false'}>
      <span>{countLabel}</span>
      {searching && <span>検索中… {progress.processed} / {progress.total} ページ</span>}
    </div>
    {noText && <p className="side-panel-message">この PDF には検索できる文字がありません（スキャン画像など）</p>}
    {error && <p className="side-panel-message error-text">検索できませんでした: {error}</p>}
    <ol className="search-results" data-testid="search-results">
      {results.map((result, index) => <li key={`${result.pageIndex}-${index}`}>
        <button type="button" className={activeIndex === index ? 'active' : ''} onClick={() => select(index)}>
          <span>p.{result.pageIndex + 1}</span>
          <span>{result.before}<strong>{result.match}</strong>{result.after}</span>
        </button>
      </li>)}
    </ol>
  </section>
}
