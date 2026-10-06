import { useEffect, useRef, useState } from 'react'
import type { DrawingInfo } from '../core/drawingInfo'
import type { DocumentSession } from './documentModel'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'

export function DrawingInfoDialog({ session, pageIndex, pool, onClose, onSave }: {
  session: DocumentSession; pageIndex: number; pool: PdfWorkerPool; onClose(): void; onSave(info: DrawingInfo): void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState<DrawingInfo>(() => session.annotationStore.getDrawingInfo(pageIndex) ?? {})
  const [touched, setTouched] = useState({ number: false, name: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { ref.current?.showModal() }, [])
  const reset = async (field: 'number' | 'name') => {
    setBusy(true); setError('')
    try {
      if (!session.annotationStore.getAutomaticDrawingInfo(pageIndex)) await session.scanDrawingInfos(pool, true)
      const automatic = session.annotationStore.getAutomaticDrawingInfo(pageIndex)
      if (!automatic) { setError('自動の値を取得できませんでした。読み直してください。'); return }
      setTouched(previous => ({ ...previous, [field]: true }))
      setDraft(previous => ({ ...previous, [field]: automatic[field], [field + 'Manual']: false, scanned: true }))
    } finally { setBusy(false) }
  }
  return <dialog ref={ref} className="drawing-info-dialog" aria-label="図面番号・図面名称を変更" onCancel={e => { e.preventDefault(); onClose() }}>
    <h2>図面番号・図面名称（{pageIndex + 1} ページ）</h2>
    {(['number', 'name'] as const).map(field => <div key={field} className="drawing-info-field">
      <label>{field === 'number' ? '図面番号' : '図面名称'}<input aria-label={field === 'number' ? '図面番号' : '図面名称'} value={draft[field] ?? ''} placeholder="未設定" maxLength={80} disabled={busy || Boolean(session.editRestriction)} onChange={e => { setTouched(previous => ({ ...previous, [field]: true })); setDraft(previous => ({ ...previous, [field]: e.target.value || undefined, [field + 'Manual']: true })) }} /></label>
      <button type="button" disabled={busy || Boolean(session.editRestriction)} onClick={() => void reset(field)} aria-label={`${field === 'number' ? '図面番号' : '図面名称'}を自動に戻す`}>自動に戻す</button>
      <span>{draft[field + 'Manual' as 'numberManual' | 'nameManual'] ? '手動' : '自動'}</span>
    </div>)}
    {busy && <p role="status">自動の値を読み取っています…</p>}
    {error && <p role="alert">{error}</p>}
    <div className="dialog-actions"><button type="button" onClick={onClose}>キャンセル</button><button type="button" disabled={busy || Boolean(session.editRestriction)} onClick={() => {
      const info = session.annotationStore.getDrawingInfo(pageIndex) ?? {}
      for (const field of ['number', 'name'] as const) if (touched[field]) { info[field] = draft[field]?.trim() || undefined; info[field + 'Manual' as 'numberManual' | 'nameManual'] = draft[field + 'Manual' as 'numberManual' | 'nameManual'] }
      onSave(info)
    }}>決定</button></div>
  </dialog>
}
