import { useEffect, useRef, useSyncExternalStore } from 'react'
import { answerExternalLink, closeExternalSendAlert, getExternalSendState, subscribeExternalSend } from '../security/externalSend'

export function ExternalSendAlert() {
  const state = useSyncExternalStore(subscribeExternalSend, getExternalSendState)
  const dialog = useRef<HTMLDialogElement>(null)
  const dismiss = useRef<HTMLButtonElement>(null)
  const link = state.links[0]
  const visible = Boolean(link || state.blocked.length)
  const close = () => { if (link) answerExternalLink(link.id, false); else closeExternalSendAlert() }
  useEffect(() => {
    if (visible && !dialog.current?.open) dialog.current?.showModal()
    if (!visible && dialog.current?.open) dialog.current?.close()
    if (visible) dismiss.current?.focus()
  }, [visible, link?.id])
  return <dialog ref={dialog} className="external-send-dialog" role="alertdialog" aria-labelledby="external-send-title"
    aria-describedby="external-send-description" onCancel={event => { event.preventDefault(); close() }}>
    <header><h2 id="external-send-title">{link ? '外部のサイトを開こうとしています' : '外部への送信を止めました'}</h2></header>
    <div className="external-send-body">
      {link ? <><p className="external-send-host">{link.host}</p><p id="external-send-description">開くと、その場所へ接続します。</p></> : <>
        <p id="external-send-description">データは送信していません。</p>
        <ul>{state.blocked.map(item => <li key={`${item.kind}:${item.host}`}><span>{item.kind}</span>：<span className="external-send-host">{item.host}</span>（{item.count}件）</li>)}</ul>
        <p>止めた回数：{state.blockedCount}件</p>
      </>}
    </div>
    <footer><button ref={dismiss} type="button" onClick={close}>{link ? '開かない' : '閉じる'}</button>
      {link && <button type="button" onClick={() => answerExternalLink(link.id, true)}>開く</button>}
    </footer>
  </dialog>
}
