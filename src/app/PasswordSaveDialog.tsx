import { useEffect, useRef, useState } from 'react'
import { generatePdfPassword, isValidPdfPassword, MAX_PDF_PASSWORD_LENGTH } from '../core/pdfPassword'

export function PasswordSaveDialog({ onClose, onSave }: {
  onClose(): void
  onSave(password: string): Promise<boolean>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [password, setPassword] = useState(generatePdfPassword)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const valid = isValidPdfPassword(password)
  useEffect(() => { dialog.current?.showModal(); input.current?.select() }, [])

  const copy = async () => {
    input.current?.focus()
    input.current?.select()
    try {
      await navigator.clipboard.writeText(password)
      setMessage('コピーしました。')
    } catch { setMessage('入力欄を選択しました。Ctrl+C（Macは⌘C）でコピーしてください。') }
  }

  return <dialog ref={dialog} className="utility-dialog password-save-dialog" aria-label="パスワード付き保存"
    onKeyDown={event => event.stopPropagation()}
    onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <form onSubmit={event => {
      event.preventDefault()
      if (!valid || busy) return
      setBusy(true)
      setMessage('')
      void onSave(password).then(saved => { if (saved) onClose() })
        .catch(() => setMessage('保存できませんでした。元のPDFとは別の保存先を選び、書き込み権限と空き容量を確認してください。'))
        .finally(() => setBusy(false))
    }}>
      <h1>パスワードを付けて別名で保存</h1>
      <p>PDFを開くためのパスワードを設定します。大文字・小文字・数字・記号を含む15文字の候補を自動で提案しています。</p>
      <label htmlFor="pdf-save-password">パスワード（半角英数字・記号、1〜20文字）</label>
      <input ref={input} id="pdf-save-password" type="text" value={password} maxLength={MAX_PDF_PASSWORD_LENGTH}
        autoComplete="off" autoCapitalize="off" spellCheck={false} disabled={busy}
        aria-invalid={!valid} aria-describedby="pdf-password-help"
        onChange={event => { setPassword(event.target.value); setMessage('') }} />
      <p id="pdf-password-help">パスワードは表示されています。コピー・貼り付けできます。空白・全角文字は使えません。</p>
      <div className="password-save-actions">
        <button type="button" disabled={busy} onClick={() => { setPassword(generatePdfPassword()); setMessage('') }}>別の候補を生成</button>
        <button type="button" disabled={busy || !valid} onClick={() => void copy()}>コピー</button>
      </div>
      <p>パスワードを安全な場所に控えてください。保存したPDFは、かるPDFでパスワードを入力して開けます。</p>
      <p>今開いているPDFはそのままに、パスワード付きのコピーを保存します。元のPDFへの変更は通常の保存で保存してください。</p>
      {!valid && <p role="alert">半角英数字・記号の1〜20文字で入力してください（空白不可）。</p>}
      <p role="status">{message}</p>
      <div className="password-save-actions">
        <button type="button" disabled={busy} onClick={onClose}>キャンセル</button>
        <button type="submit" disabled={busy || !valid}>{busy ? '保存中…' : '保存先を選んで保存'}</button>
      </div>
    </form>
  </dialog>
}
