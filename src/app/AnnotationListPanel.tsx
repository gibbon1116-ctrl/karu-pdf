import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import type { EditableAnnotation } from '../editor/AnnotationStore'
import type { DocumentSession } from './documentModel'
import { issueStatusLabel } from '../core/issues'
import { createIssueCsv, issueCsvFileName, annotationBody, annotationColorHex, annotationCsvFileName, annotationKindLabel, createAnnotationCsv } from './annotationCsv'

type Filter = 'issue' | 'issueOpen' | 'issueDone' | 'measure' | 'all' | 'text' | 'callout' | 'shape' | 'symbol' | 'pen' | 'markup'

interface Props {
  session: DocumentSession
  pool: PdfWorkerPool
  onSelect(annotation: EditableAnnotation): void
  onEdit(annotation: EditableAnnotation): void
}

function matchesFilter(annotation: EditableAnnotation, filter: Filter): boolean {
  if (filter === 'issue') return !!annotation.issue
  if (filter === 'issueOpen') return annotation.issue?.status === 'open'
  if (filter === 'issueDone') return annotation.issue?.status === 'done'
  if (filter === 'measure') return !!annotation.measure
  if (filter === 'all') return true
  if (filter === 'text') return annotation.kind === 'freetext'
  if (filter === 'callout') return annotation.kind === 'callout'
  if (filter === 'symbol') return annotation.kind === 'symbol'
  if (filter === 'pen') return annotation.kind === 'highlight' || annotation.kind === 'ink'
  if (filter === 'markup') return annotation.kind === 'textHighlight' || annotation.kind === 'underline' || annotation.kind === 'strikeout'
  return ['cloudSquare', 'cloudPolygon', 'line', 'arrow', 'square', 'circle'].includes(annotation.kind)
}

async function saveCsv(csv: string, fileName: string): Promise<void> {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  if (window.showSaveFilePicker) {
    const handle = await window.showSaveFilePicker({ id: 'karu-pdf-annotation-csv', suggestedName: fileName })
    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()
    return
  }
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function allSessionAnnotations(session: DocumentSession): EditableAnnotation[] {
  return session.pageSizes.flatMap((_page, pageIndex) => session.annotationStore.getPageAnnotations(pageIndex))
}

export function AnnotationListPanel({ session, pool, onSelect, onEdit }: Props) {
  const annotationVersion = useSyncExternalStore(session.annotationStore.subscribe, session.annotationStore.getSnapshot)
  const [filter, setFilter] = useState<Filter>('all')
  const [firstPage, setFirstPage] = useState(1)
  const [lastPage, setLastPage] = useState(session.pageSizes.length)
  const [progress, setProgress] = useState({ processed: 0, total: session.pageSizes.length })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastIssue, setLastIssue] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const loads: Promise<void>[] = []
    setLoading(true)
    setError('')
    const task = pool.listAllAnnotations(session.docId, (response) => {
      if (!active || response.pageIndex < 0) return
      loads.push(session.annotationStore.ensurePageLoaded(response.pageIndex, () => Promise.resolve(response.annotations)))
      setProgress({ processed: response.processedPages, total: response.totalPages })
    })
    void task.promise.then(async () => {
      await Promise.all(loads)
      if (active) setLoading(false)
    }).catch((reason) => {
      if (active) { setLoading(false); setError(reason instanceof Error ? reason.message : String(reason)) }
    })
    return () => { active = false; task.cancel() }
  }, [pool, session])

  const annotations = useMemo(() => allSessionAnnotations(session).sort((left, right) => (
    left.pageIndex - right.pageIndex || left.rect[1] - right.rect[1] || left.rect[0] - right.rect[0]
  )), [session, annotationVersion])
  const filtered = annotations.filter((annotation) => (
    matchesFilter(annotation, filter)
    && annotation.pageIndex + 1 >= firstPage
    && annotation.pageIndex + 1 <= lastPage
  ))
  if (filter.startsWith('issue')) filtered.sort((a, b) => a.issue!.number - b.issue!.number)
  const issues = annotations.filter(annotation => annotation.issue)
  const unresolved = issues.filter(annotation => annotation.issue?.status === 'open' && annotation.pageIndex + 1 >= firstPage && annotation.pageIndex + 1 <= lastPage)

  return <section className="annotation-list-panel" aria-label="書き込みの一覧">
    <div className="annotation-filters">
      <label>種類<select aria-label="書き込みの種類" value={filter} onChange={(event) => setFilter(event.currentTarget.value as Filter)}>
        <option value="all">すべて</option><option value="text">文字</option><option value="callout">吹き出し</option>
        <option value="issue">指摘</option><option value="issueOpen">指摘（未対応）</option><option value="issueDone">指摘（対応済み）</option><option value="measure">計測</option><option value="shape">図形</option><option value="symbol">記号</option><option value="pen">ペン</option><option value="markup">文字への印</option>
      </select></label>
      <div><label>ページ<input aria-label="開始ページ" type="number" min="1" max={session.pageSizes.length} value={firstPage} onChange={(event) => setFirstPage(Number(event.currentTarget.value))} /></label><span>〜</span><label><span className="visually-hidden">終了ページ</span><input aria-label="終了ページ" type="number" min="1" max={session.pageSizes.length} value={lastPage} onChange={(event) => setLastPage(Number(event.currentTarget.value))} /></label></div>
    </div>
    <p role="status">{loading ? '指摘件数は読込中' : error ? '指摘件数は未確定' : `未対応 ${issues.filter(annotation => annotation.issue?.status === 'open').length} / 指摘 ${issues.length}`}</p>
    <button disabled={loading || !!error || !unresolved.length} onClick={() => {
      const current = unresolved.findIndex(annotation => annotation.id === lastIssue)
      const next = unresolved[(current + 1) % unresolved.length]
      setLastIssue(next.id); onSelect(next)
    }}>次の未対応指摘（ページ範囲内）</button>
    <button type="button" className="csv-export" disabled={loading} onClick={() => void saveCsv(createAnnotationCsv(annotations), annotationCsvFileName(session.name)).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))}>CSV に書き出す</button>
    <button type="button" className="csv-export" disabled={loading} onClick={() => void saveCsv(createIssueCsv(annotations), issueCsvFileName(session.name)).catch(reason => setError(String(reason)))}>指摘一覧を CSV に書き出す</button>
    <button type="button" disabled={!!session.editRestriction || loading || !annotations.some(a => a.issue)} onClick={() => {
      if (window.confirm('文書全体の指摘を、ページ順・上から順・左から順に1から振り直しますか？（元に戻すことができます）')) session.annotationStore.renumberIssues()
    }}>番号を振り直す</button>
    {loading && <p className="side-panel-message" role="status">書き込みを読み込み中… {progress.processed} / {progress.total} ページ</p>}
    {error && <p className="side-panel-message error-text">{error}</p>}
    <ol className="annotation-rows">
      {filtered.map((annotation) => <li key={annotation.id}>
        <button type="button" data-annotation-id={annotation.id} onClick={() => onSelect(annotation)} onDoubleClick={() => { if (annotation.issue) onEdit(annotation) }}>
          <span className="annotation-type-icon" aria-hidden="true">{annotation.issue ? annotation.issue.number : annotationKindLabel(annotation.kind).slice(0, 1)}</span>
          <span className="annotation-page">p.{annotation.pageIndex + 1}</span>
          <span className="annotation-summary">
            <span className="annotation-kind">{annotationKindLabel(annotation.kind)}</span>
            <span className="annotation-body" title={annotationBody(annotation)}>{annotationBody(annotation).slice(0, 40)}</span>
          </span>
          <span className="annotation-color" style={{ backgroundColor: annotationColorHex(annotation) }} aria-label={`色 ${annotationColorHex(annotation)}`} />
        </button>
        {annotation.issue && <select disabled={!!session.editRestriction} className="issue-status" aria-label={`指摘 ${annotation.issue.number} の状態`} value={annotation.issue.status} onChange={event => session.annotationStore.update(annotation.id, { issueStatus: event.currentTarget.value as 'open' | 'done' })}>
          <option value="open">{issueStatusLabel('open')}</option><option value="done">{issueStatusLabel('done')}</option>
        </select>}
      </li>)}
    </ol>
  </section>
}
