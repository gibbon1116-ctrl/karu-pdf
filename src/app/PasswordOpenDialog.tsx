import { useEffect, useRef, useState } from 'react'

export function PasswordOpenDialog({ name, incorrect, onSubmit, onCancel }: {
  name: string
  incorrect: boolean
  onSubmit(password: string): void
  onCancel(): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="utility-dialog password-save-dialog" aria-label="PDFのパスワード"
    onKeyDown={event => event.stopPropagation()} onCancel={event => { event.preventDefault(); onCancel() }}>
    <form onSubmit={event => { event.preventDefault(); onSubmit(password) }}>
      <h1>PDFのパスワードを入力</h1>
      <p>「{name}」を開くためのパスワードを入力してください。</p>
      {incorrect && <p role="alert">パスワードが違います。もう一度入力してください。</p>}
      <label htmlFor="pdf-open-password">パスワード</label>
      <input id="pdf-open-password" type={visible ? 'text' : 'password'} value={password} autoFocus
        autoComplete="off" autoCapitalize="off" spellCheck={false}
        onChange={event => setPassword(event.target.value)} />
      <label><input type="checkbox" checked={visible} onChange={event => setVisible(event.target.checked)} />パスワードを表示</label>
      <p>パスワードは履歴に保存しません。入力欄へ貼り付けできます。</p>
      <div className="password-save-actions">
        <button type="button" onClick={onCancel}>キャンセル</button>
        <button type="submit">開く</button>
      </div>
    </form>
  </dialog>
}
