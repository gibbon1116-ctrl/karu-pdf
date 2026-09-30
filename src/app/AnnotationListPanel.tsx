import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import type { EditableAnnotation } from '../editor/AnnotationStore'
import type { DocumentSession } from './documentModel'
import { annotationBody, annotationColorHex, annotationCsvFileName, annotationKindLabel, createAnnotationCsv } from './annotationCsv'

type Filter = 'all' | 'text' | 'callout' | 'shape' | 'symbol' | 'pen'

interface Props {
  session: DocumentSession
  pool: PdfWorkerPool
  onSelect(annotation: EditableAnnotation): void
}

function matchesFilter(annotation: EditableAnnotation, filter: Filter): boolean {
  if (filter === 'all') return true
  if (filter === 'text') return annotation.kind === 'freetext'
  if (filter === 'callout') return annotation.kind === 'callout'
  if (filter === 'symbol') return annotation.kind === 'symbol'
  if (filter === 'pen') return annotation.kind === 'highlight' || annotation.kind === 'ink'
  return ['line', 'arrow', 'square', 'circle'].includes(annotation.kind)
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

export function AnnotationListPanel({ session, pool, onSelect }: Props) {
  const annotationVersion = useSyncExternalStore(session.annotationStore.subscribe, session.annotationStore.getSnapshot)
  const [filter, setFilter] = useState<Filter>('all')
  const [firstPage, setFirstPage] = useState(1)
  const [lastPage, setLastPage] = useState(session.pageSizes.length)
  const [progress, setProgress] = useState({ processed: 0, total: session.pageSizes.length })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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

  return <section className="annotation-list-panel" aria-label="書き込みの一覧">
    <div className="annotation-filters">
      <label>種類<select aria-label="書き込みの種類" value={filter} onChange={(event) => setFilter(event.currentTarget.value as Filter)}>
        <option value="all">すべて</option><option value="text">文字</option><option value="callout">吹き出し</option>
        <option value="shape">図形</option><option value="symbol">記号</option><option value="pen">ペン</option>
      </select></label>
      <div><label>ページ<input aria-label="開始ページ" type="number" min="1" max={session.pageSizes.length} value={firstPage} onChange={(event) => setFirstPage(Number(event.currentTarget.value))} /></label><span>〜</span><label><span className="visually-hidden">終了ページ</span><input aria-label="終了ページ" type="number" min="1" max={session.pageSizes.length} value={lastPage} onChange={(event) => setLastPage(Number(event.currentTarget.value))} /></label></div>
    </div>
    <button type="button" className="csv-export" onClick={() => void saveCsv(createAnnotationCsv(annotations), annotationCsvFileName(session.name)).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))}>CSV に書き出す</button>
    {loading && <p className="side-panel-message" role="status">書き込みを読み込み中… {progress.processed} / {progress.total} ページ</p>}
    {error && <p className="side-panel-message error-text">{error}</p>}
    <ol className="annotation-rows">
      {filtered.map((annotation) => <li key={annotation.id}>
        <button type="button" data-annotation-id={annotation.id} onClick={() => onSelect(annotation)}>
          <span className="annotation-type-icon" aria-hidden="true">{annotationKindLabel(annotation.kind).slice(0, 1)}</span>
          <span className="annotation-page">p.{annotation.pageIndex + 1}</span>
          <span className="annotation-body" title={annotationBody(annotation)}>{annotationBody(annotation).slice(0, 40) || annotationKindLabel(annotation.kind)}</span>
          <span className="annotation-color" style={{ backgroundColor: annotationColorHex(annotation) }} aria-label={`色 ${annotationColorHex(annotation)}`} />
        </button>
      </li>)}
    </ol>
  </section>
}
