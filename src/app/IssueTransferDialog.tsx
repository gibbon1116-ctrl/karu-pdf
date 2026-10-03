import { useEffect, useRef, useState } from 'react'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import type { EditableAnnotation } from '../editor/AnnotationStore'
import type { PageCorrespondence } from '../core/registration'
import type { DocumentSession } from './documentModel'
import { allSessionAnnotations } from './AnnotationListPanel'
import { transferCandidates } from './issueTransfer'

export function IssueTransferDialog({ old, next, pool, mapping, onClose, onPreview }: {
  old: DocumentSession; next: DocumentSession; pool: PdfWorkerPool; mapping: PageCorrespondence; onClose(): void; onPreview?(a: EditableAnnotation): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [confirmed, setConfirmed] = useState(false)
  const [candidates, setCandidates] = useState<ReturnType<typeof transferCandidates>>([])
  const [selected, setSelected] = useState<Set<string>>(new Set()), [rowPage, setRowPage] = useState(0)
  useEffect(() => {
    dialog.current?.show()
    let active = true
    const loads: Promise<void>[] = []
    const target = pool.listAllAnnotations(next.docId, r => {
      if (active && r.pageIndex >= 0) loads.push(next.annotationStore.ensurePageLoaded(r.pageIndex, () => Promise.resolve(r.annotations)))
    })
    void (async () => {
      await old.annotationStore.ensurePageLoaded(mapping.oldPage, () => pool.listAnnotations(old.docId, mapping.oldPage))
      await target.promise; await Promise.all(loads)
      await next.annotationStore.issueNumbers.initialize(() => pool.maxIssueNumber(next.docId))
      if (!active) return
      setCandidates(transferCandidates(old.annotationStore.getPageAnnotations(mapping.oldPage), allSessionAnnotations(next), mapping,
        old.pageSizes[mapping.oldPage], next.pageSizes[mapping.newPage], old.name))
      setReady(true)
    })().catch(reason => { if (active) setError(String(reason)) })
    // Observe a target failure immediately even if the source page is still loading.
    void target.promise.catch(() => undefined)
    return () => { active = false; target.cancel() }
  }, [old, next, pool, mapping])
  return <dialog ref={dialog} className="issue-transfer-dialog" aria-labelledby="issue-transfer-title" onCancel={onClose}>
    <h2 id="issue-transfer-title">前回指摘の引継ぎ</h2>
    <p>{old.name} p.{mapping.oldPage+1} → {next.name} p.{mapping.newPage+1} {mapping.drawingNumber}</p>
    <p>位置合わせを適用した候補です。修正の有無は自動判定しません。内容と候補位置を確認し、引き継ぐ指摘を選んでください。</p>
    {!ready && !error && <p role="status">指摘と引継ぎ済み情報を読み込んでいます…</p>}
    {error && <p role="alert">{error}</p>}
    {ready && <>
      <p>{candidates.length}件の未確認指摘 / 選択 {selected.size}件</p>
      <button onClick={() => setSelected(new Set(candidates.filter(c => !c.reason).map(c => c.source.id)))}>全候補を選択</button>
      <button onClick={() => setSelected(new Set())}>選択を解除</button>
      <ol>{candidates.slice(rowPage*50, (rowPage+1)*50).map(c => <li key={c.source.id}>
        <label><input type="checkbox" disabled={!!c.reason} checked={selected.has(c.source.id)} onChange={e => setSelected(v => {
          const result = new Set(v); if (e.target.checked) result.add(c.source.id); else result.delete(c.source.id); return result
        })} />指摘 {c.source.issue!.number}: {c.source.text.slice(0,160)}</label>
        <small>{c.source.issue!.drawingNumber || '図面番号未指定'} → p.{mapping.newPage+1} / x {(c.annotation.rect[0]*25.4/72).toFixed(1)}, y {(c.annotation.rect[1]*25.4/72).toFixed(1)} mm {c.reason}</small>
        <button onClick={() => onPreview?.(c.source)}>この位置を見る</button>
      </li>)}</ol>
      {candidates.length > 50 && <div><button disabled={!rowPage} onClick={() => setRowPage(p=>p-1)}>前の50件</button>{rowPage+1} / {Math.ceil(candidates.length/50)}<button disabled={(rowPage+1)*50 >= candidates.length} onClick={() => setRowPage(p=>p+1)}>次の50件</button></div>}
      <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />図面番号・ページ対応・候補位置を確認しました</label>
    </>}
    <div className="dialog-actions"><button onClick={onClose}>閉じる</button><button disabled={!ready || !confirmed || !selected.size || !!next.editRestriction} onClick={() => {
      try {
        // Recheck duplicates at confirmation time; another invocation may have imported them.
        const fresh = transferCandidates(old.annotationStore.getPageAnnotations(mapping.oldPage), allSessionAnnotations(next), mapping, old.pageSizes[mapping.oldPage], next.pageSizes[mapping.newPage], old.name)
        const items = fresh.filter(c => !c.reason && selected.has(c.source.id)).map(c => c.annotation)
        next.annotationStore.pasteAnnotations(items, mapping.newPage, next.pageSizes[mapping.newPage], 0)
        onClose()
      } catch (reason) { setError(String(reason)) }
    }}>選択した指摘を新版に追加</button></div>
  </dialog>
}
