import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { desktopBrowser, dismissDesktopPrompt, getSnapshot, promptInstall, subscribe } from './installApp'

export const installedMessage = 'インストールしました。デスクトップに置くかどうかは、アプリを初めて開いたときに Edge が出す画面で選べます。'
export function useInstallApp() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function InstallAppSection() {
  const state = useInstallApp()
  if (!state.canInstall) return null
  return <section className="install-app-section" aria-label="アプリのインストール">
    <button type="button" onClick={() => void promptInstall()}>アプリとしてインストール</button>
    <p>インストールすると、専用の窓で開けます。インストールの後に初めて開いたときに、Edge が「デスクトップ ショートカットを作成します」などを選べる画面を出します。</p>
  </section>
}

export function DesktopPromptBanner({ onShowSteps }: { onShowSteps(): void }) {
  const state = useInstallApp()
  if (!state.showDesktopPrompt) return null
  return <aside className="desktop-prompt-banner" aria-label="デスクトップへの配置">
    <span>デスクトップにかるPDFを置きますか？</span>
    <button type="button" onClick={() => { dismissDesktopPrompt(); onShowSteps() }}>置く手順を見る</button>
    <button type="button" onClick={dismissDesktopPrompt}>置かない</button>
  </aside>
}

export function DesktopStepsDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const state = useInstallApp()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const addressRef = useRef<HTMLInputElement>(null)
  const [copyStatus, setCopyStatus] = useState('')
  const browser = desktopBrowser(navigator as Navigator & { userAgentData?: { brands: readonly { brand: string }[] } })
  const chrome = browser === 'chrome'
  const address = chrome ? 'chrome://apps' : 'edge://apps'
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) { setCopyStatus(''); dialog.showModal() }
    if (!open && dialog.open) dialog.close()
  }, [open])

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address)
      setCopyStatus('アドレスをコピーしました。')
    } catch {
      addressRef.current?.focus()
      addressRef.current?.select()
      setCopyStatus('アドレスを選択しました。Ctrl+C またはコピー操作でコピーしてください。')
    }
  }

  if (!state.supported) return null
  return <dialog ref={dialogRef} className="utility-dialog desktop-steps-dialog" aria-labelledby="desktop-steps-title" onCancel={onClose} onClose={onClose}>
    <h1 id="desktop-steps-title">デスクトップにアプリを置く手順</h1>
    {state.canInstall && <div>
      <p>先に、かるPDFをアプリとしてインストールしてください。</p>
      <button type="button" onClick={() => void promptInstall()}>アプリとしてインストール</button>
    </div>}
    {state.installed && <p role="status">{installedMessage}</p>}
    {state.error && <p role="status">{state.error}</p>}
    <ol>
      <li>{chrome ? 'Chrome' : 'Edge'} のアドレスバーに <code>{address}</code> と入力して開きます。
        <div className="desktop-address-copy">
          <input ref={addressRef} aria-label="アプリ管理のアドレス" value={address} readOnly onFocus={event => event.currentTarget.select()} />
          <button type="button" onClick={() => void copyAddress()}>アドレスをコピー</button>
        </div>
      </li>
      <li>{chrome ? '「かるPDF」を右クリックして「ショートカットを作成」を選びます。' : '「かるPDF」の「詳細」を選びます。'}</li>
      <li>{chrome ? '「デスクトップ」を選びます。' : '「デスクトップ ショートカットを作成します」を選びます。'}</li>
    </ol>
    <p role="status">{copyStatus}</p>
    <button type="button" onClick={onClose}>閉じる</button>
  </dialog>
}
