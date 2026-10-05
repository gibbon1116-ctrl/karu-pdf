import { quantityAnnotationLabel } from './annotationCsv'
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import type { EditableAnnotation } from '../editor/AnnotationStore'
import type { DocumentSession } from './documentModel'
import { ISSUE_STATUS_CHOICES, issueStatusChoice, issueStatusLabel, unresolvedIssue, type IssueStatusChoice } from '../core/issues'
import { IssueDetails } from './IssueDetails'
import { annotationBody, annotationColorHex, annotationKindLabel, CSV_KINDS, type CsvKind } from './annotationCsv'
import { ensureSessionFixtures } from './documentModel'
import { ANNOTATION_FILTER_LABELS, matchesAnnotationFilter, type AnnotationFilterKind } from '../editor/annotationFilter'

const CsvExportDialog = lazy(() => import('./CsvExportDialog'))

interface Props {
  session: DocumentSession
  pool: PdfWorkerPool
  onSelect(annotation: EditableAnnotation): void
  onEdit(annotation: EditableAnnotation): void
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
  const store = session.annotationStore
  const { kind: filter, discipline, status: issueStatus } = store.annotationFilter
  const [firstPage, setFirstPage] = useState(1)
  const [lastPage, setLastPage] = useState(session.pageSizes.length)
  const [progress, setProgress] = useState({ processed: 0, total: session.pageSizes.length })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastIssue, setLastIssue] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const detailPrefix = useId()
  const detailElement = useRef<HTMLDivElement>(null)
  const [rowPage, setRowPage] = useState(0)
  const [csvOpen, setCsvOpen] = useState(false)
  useEffect(() => setRowPage(0), [filter, firstPage, lastPage, discipline, issueStatus])

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
  }, [pool, session, session.pageRevision])

  const annotations = useMemo(() => allSessionAnnotations(session).sort((left, right) => (
    left.pageIndex - right.pageIndex || left.rect[1] - right.rect[1] || left.rect[0] - right.rect[0]
  )), [session, annotationVersion])
  const filtered = annotations.filter((annotation) => (
    matchesAnnotationFilter(annotation, store.annotationFilter)
    && annotation.pageIndex + 1 >= firstPage
    && annotation.pageIndex + 1 <= lastPage
  ))
  if (filter.startsWith('issue')) filtered.sort((a, b) => a.issue!.number - b.issue!.number)
  const issues = annotations.filter(annotation => annotation.issue && annotation.issue.recordKind !== 'change')
  const unresolved = issues.filter(annotation => unresolvedIssue(annotation.issue!) && annotation.pageIndex + 1 >= firstPage && annotation.pageIndex + 1 <= lastPage)
  const pageCount = Math.max(1, Math.ceil(filtered.length / 100))
  const visiblePage = Math.min(rowPage, pageCount - 1)
  useEffect(() => {
    detailElement.current?.scrollIntoView({ block: 'nearest' })
  }, [detailId, visiblePage])

  return <section className="annotation-list-panel" aria-label="書き込みの一覧">
    <div className="annotation-filters">
      <label>種類<select aria-label="書き込みの種類" value={filter} onChange={(event) => store.setAnnotationFilter({ ...store.annotationFilter, kind: event.currentTarget.value as AnnotationFilterKind })}>
        {(Object.entries(ANNOTATION_FILTER_LABELS) as Array<[AnnotationFilterKind, string]>).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
      </select></label>
      <label className="drawing-filter-toggle"><input type="checkbox" checked={store.drawingFollowsFilter} disabled={loading || !!error} onChange={event => store.setDrawingFollowsFilter(event.currentTarget.checked)} />図面にもこの種類だけ表示</label>
      <p className="drawing-filter-hint">種類・分野・状態を図面にも反映します。ページ範囲は一覧だけに効きます。</p>
      <div><label>ページ<input aria-label="開始ページ" type="number" min="1" max={session.pageSizes.length} value={firstPage} onChange={(event) => setFirstPage(Number(event.currentTarget.value))} /></label><span>〜</span><label><span className="visually-hidden">終了ページ</span><input aria-label="終了ページ" type="number" min="1" max={session.pageSizes.length} value={lastPage} onChange={(event) => setLastPage(Number(event.currentTarget.value))} /></label></div>
    </div>
    {!!issues.length && <div className="annotation-filters">
      <label>分野<input aria-label="分野で絞り込み" value={discipline} onChange={event => store.setAnnotationFilter({ ...store.annotationFilter, discipline: event.currentTarget.value })} /></label>
      <label>状態<select aria-label="状態で絞り込み" value={issueStatus} onChange={event => store.setAnnotationFilter({ ...store.annotationFilter, status: event.currentTarget.value as '' | IssueStatusChoice })}>
        <option value="">すべて</option>{ISSUE_STATUS_CHOICES.map(status => <option key={status} value={status}>{issueStatusLabel(status)}</option>)}
      </select></label>
    </div>}
    <p role="status">{loading ? '指摘件数は読込中' : error ? '指摘件数は未確定' : `未確認 ${issues.filter(annotation => unresolvedIssue(annotation.issue!)).length} / 指摘 ${issues.length}`}</p>
    <button disabled={loading || !!error || !unresolved.length} onClick={() => {
      const current = unresolved.findIndex(annotation => annotation.id === lastIssue)
      const next = unresolved[(current + 1) % unresolved.length]
      if (store.drawingFollowsFilter && !store.isShownOnDrawing(next)) store.releaseDrawingFilter('次の未対応指摘を表示するため')
      setLastIssue(next.id); onSelect(next)
    }}>次の未対応指摘（ページ範囲内）</button>
    <button type="button" className="csv-export" disabled={loading || !!error} onClick={() => {
      if (annotations.some(a => a.count || a.quantity)) void ensureSessionFixtures(session, pool).then(() => setCsvOpen(true)).catch(reason => setError(String(reason)))
      else setCsvOpen(true)
    }}>CSV に書き出す…</button>
    {csvOpen && <Suspense fallback={<p role="status">書き出し画面を読み込み中…</p>}><CsvExportDialog annotations={annotations} fixtures={session.annotationStore.getCountFixtures()} pdfName={session.name} pageCount={session.pageSizes.length}
      initialKinds={filter === 'all' ? CSV_KINDS : [filter.startsWith('issue') ? 'issue' : filter as CsvKind]}
      firstPage={firstPage} lastPage={lastPage} initialStatus={filter === 'issueOpen' ? 'open' : filter === 'issueDone' ? 'confirmed' : 'all'} onExport={saveCsv} onClose={() => setCsvOpen(false)} /></Suspense>}
    <button type="button" disabled={!!session.editRestriction || loading || !annotations.some(a => a.issue)} onClick={() => {
      if (window.confirm('文書全体の指摘を、ページ順・上から順・左から順に1から振り直しますか？振り直すと、CSVや印刷で渡した番号と合わなくなります。（元に戻すことができます）')) session.annotationStore.renumberIssues()
    }}>番号を振り直す</button>
    {loading && <p className="side-panel-message" role="status">書き込みを読み込み中… {progress.processed} / {progress.total} ページ</p>}
    {error && <p className="side-panel-message error-text">{error}</p>}
    {pageCount > 1 && <nav aria-label="書き込み一覧のページ">
      <button disabled={visiblePage === 0} onClick={() => setRowPage(visiblePage - 1)}>前の100件</button>
      <span>{visiblePage + 1} / {pageCount}（{filtered.length}件）</span>
      <button disabled={visiblePage + 1 >= pageCount} onClick={() => setRowPage(visiblePage + 1)}>次の100件</button>
    </nav>}
    <ol className="annotation-rows" start={visiblePage * 100 + 1}>
      {filtered.slice(visiblePage * 100, (visiblePage + 1) * 100).map((annotation) => <li key={annotation.id}>
        <button type="button" className="annotation-row-main" data-annotation-id={annotation.id} onClick={() => onSelect(annotation)} onDoubleClick={() => { if (annotation.issue) onEdit(annotation) }}>
          <span className="annotation-type-icon" aria-hidden="true">{annotation.legacyChange ? '旧' : annotation.issue ? annotation.issue.number : annotationKindLabel(annotation.kind).slice(0, 1)}</span>
          <span className="annotation-page">p.{annotation.pageIndex + 1}</span>
          <span className="annotation-summary">
            <span className="annotation-kind">{annotation.legacyChange ? '変更記録（旧版）' : annotation.quantity ? quantityAnnotationLabel(annotation) : annotation.count ? '数量拾い' : annotationKindLabel(annotation.kind)}</span>
            <span className="annotation-body" title={annotation.legacyChange ? annotation.text : annotationBody(annotation)}>{annotation.legacyChange ? annotation.text.slice(0, 40) : annotation.count ? `個数: ${session.annotationStore.fixtureForCount(annotation.count)?.name ?? (annotation.count.version === 1 ? annotation.count.group : annotation.text)}` : annotationBody(annotation).slice(0, 40)}</span>
          </span>
          <span className="annotation-color" style={{ backgroundColor: annotationColorHex(annotation) }} aria-label={`色 ${annotationColorHex(annotation)}`} />
        </button>
        {annotation.issue && <><div className="issue-row-actions">
          <select disabled={!!session.editRestriction} className="issue-status" data-status={issueStatusChoice(annotation.issue.status)} aria-label={`指摘 ${annotation.issue.number} の状態`} value={issueStatusChoice(annotation.issue.status)} onChange={event => session.annotationStore.updateIssueDetails(annotation.id, { status: event.currentTarget.value as IssueStatusChoice })}>
            {ISSUE_STATUS_CHOICES.map(status => <option key={status} value={status}>{issueStatusLabel(status)}</option>)}
          </select>
          <button type="button" className="issue-detail-button" aria-label={`指摘 ${annotation.issue.number} の詳細を編集`} aria-expanded={detailId === annotation.id} aria-controls={`${detailPrefix}-${annotation.id}`} onClick={() => {
            if (detailId === annotation.id) setDetailId(null)
            else { setDetailId(annotation.id); onSelect(annotation) }
          }}>{detailId === annotation.id ? '✎ 詳細を閉じる ▴' : '✎ 詳細を編集 ▾'}</button>
        </div>
          {detailId === annotation.id && <div id={`${detailPrefix}-${annotation.id}`} ref={detailElement} className="issue-row-details">
            <IssueDetails annotation={annotation} store={session.annotationStore} readOnly={!!session.editRestriction} onClose={() => setDetailId(null)} />
          </div>}
        </>}
      </li>)}
    </ol>
  </section>
}
