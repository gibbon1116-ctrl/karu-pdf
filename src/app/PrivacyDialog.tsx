import { useEffect, useRef, useState } from 'react'
import { clearFileHistory, remembersHistory, setRemembersHistory } from '../editor/recentStore'

export function PrivacyDialog({ onClose, onChange }: { onClose(): void; onChange(): void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [remember, setRemember] = useState(remembersHistory)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => { ref.current?.showModal() }, [])
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action(); onChange() } catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  return <dialog ref={ref} className="about-dialog" aria-label="履歴の設定" onCancel={onClose}>
    <h1>履歴の設定</h1>
    <label><input type="checkbox" checked={remember} disabled={busy} onChange={event => {
      const enabled = event.currentTarget.checked
      setRemember(enabled); void run(() => setRemembersHistory(enabled))
    }} />最近使ったファイルと表示位置を記憶する</label>
    <p>オフにすると、記憶済みのファイル名・場所・表示位置も削除します。</p>
    <button disabled={busy} onClick={() => void run(clearFileHistory)}>履歴と保存情報を消す</button>
    <p>PDF本体や編集中のタブは保持します。ブラウザが持つファイルアクセス許可の取消は、ブラウザの設定で行ってください。</p>
    {error && <p role="alert">{error}</p>}
    <button disabled={busy} onClick={onClose}>閉じる</button>
  </dialog>
}
