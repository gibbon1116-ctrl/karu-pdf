import { useEffect, useRef, useState } from 'react'
import type { RedactLineArtMode, RedactOptions } from '../core/redact'

export function RedactDialog({ areas, pages, onClose, onSave }: {
  areas: number
  pages: number
  onClose(): void
  onSave(options: RedactOptions): Promise<boolean>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [lineArt, setLineArt] = useState<RedactLineArtMode>('covered')
  const [removeDocumentInfo, setRemoveDocumentInfo] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { dialog.current?.showModal() }, [])

  return <dialog ref={dialog} className="utility-dialog redact-dialog" aria-labelledby="redact-title"
    onKeyDown={event => event.stopPropagation()}
    onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <form onSubmit={event => {
      event.preventDefault()
      if (!areas || busy) return
      setBusy(true)
      setError('')
      void onSave({ lineArt, removeDocumentInfo }).then(saved => { if (saved) onClose() })
        .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
        .finally(() => setBusy(false))
    }}>
      <h1 id="redact-title">墨消しを適用して別名で保存</h1>
      <p>墨消しの範囲: {areas} か所（{pages} ページ）</p>
      {!areas && <p>墨消しの範囲がありません。図形▼の『墨消し（範囲）』で囲むか、文字に印▼の『文字を墨消し』で文字を選んでください。</p>}
      <fieldset disabled={busy}>
        <legend>線の消し方</legend>
        <label><input type="radio" name="redact-line-art" checked={lineArt === 'covered'} onChange={() => setLineArt('covered')} />範囲に完全に入る線を消す（標準）</label>
        <label><input type="radio" name="redact-line-art" checked={lineArt === 'touched'} onChange={() => setLineArt('touched')} />範囲にかかる線もすべて消す（範囲の外まで続く長い線も消えます）</label>
      </fieldset>
      <label><input type="checkbox" disabled={busy} checked={removeDocumentInfo} onChange={event => setRemoveDocumentInfo(event.currentTarget.checked)} />文書のプロパティ（タイトル・作成者など）を消す</label>
      <p>範囲の下の文字・画像・線を削除したコピーを保存します。削除したデータは戻せません。</p>
      <p>書き込みはページに焼き付けます（確定版と同じく、後から編集できません）。</p>
      <p>今開いているファイルは変わりません。墨消しの範囲も書き込みとして残ります。</p>
      <p>目次（しおり）と添付ファイルは対象外です。</p>
      {error && <p role="alert" className="redact-error">{error}</p>}
      {busy && <p role="status">墨消ししています…</p>}
      <div className="redact-actions">
        <button type="button" disabled={busy} onClick={onClose}>キャンセル</button>
        <button type="submit" disabled={busy || !areas}>{busy ? '墨消ししています…' : '保存'}</button>
      </div>
    </form>
  </dialog>
}
