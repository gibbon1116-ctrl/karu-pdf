import { useEffect, useRef, useState } from 'react'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import type { TextCorrection } from '../core/textCorrection'
import type { DocumentSession } from './documentModel'

export default function TextCorrectionDialog({ input, session, pool, onComplete, onClose }: {
  input: Omit<TextCorrection,'text'|'fontSize'>; session: DocumentSession; pool: PdfWorkerPool; onComplete(bytes: Uint8Array, name: string): Promise<void>; onClose(): void
}) {
  const ref = useRef<HTMLDialogElement>(null), active = useRef(true)
  const [text,setText]=useState(input.originalText.trim()), [size,setSize]=useState(Math.max(4,Math.min(10.5,Math.floor((input.rect[3]-input.rect[1])/1.4*10)/10)))
  const [busy,setBusy]=useState(false), [error,setError]=useState('')
  useEffect(()=>{ ref.current?.showModal(); return()=>{active.current=false} },[])
  const annotate=()=>{
    const page=session.pageSizes[input.pageIndex], width=Math.min(200,page.width)
    const left=Math.max(0,Math.min(input.rect[0],page.width-width)), top=Math.max(0,Math.min(input.rect[3]+8,page.height-50))
    session.annotationStore.create({ kind:'callout',pageIndex:input.pageIndex,rect:[left,top,left+width,top+50],calloutPoint:[input.rect[0],(input.rect[1]+input.rect[3])/2],text:`訂正: ${text}`,fontSize:size,color:[1,0,0] })
    onClose()
  }
  return <dialog ref={ref} className="text-correction-dialog" aria-labelledby="text-correction-title" onCancel={event=>{event.preventDefault();onClose()}}>
    <h2 id="text-correction-title">既存文字の修正</h2>
    <p>原文：{input.originalText}</p>
    <label>修正文<input aria-label="修正文" maxLength={200} value={text} disabled={busy} onChange={e=>setText(e.target.value)} /></label>
    <label>文字サイズ<input aria-label="修正文の文字サイズ" type="number" min="4" max="72" step=".1" value={size} disabled={busy} onChange={e=>setSize(Number(e.target.value))} />pt</label>
    <p>横書き1行全体が対象です。原文を除去し、BIZ UDゴシックの黒文字を配置したコピーを別タブで開きます。元のPDFと元のタブは残ります。文字の大きさ・位置はコピーで確認してください。</p>
    <p>対象外の構造や、範囲に収まらない文字は本文を変更しません。「訂正注釈で記録」は原文を残します。</p>
    {error && <p role="alert">{error}</p>}
    {busy && <p role="status">文字と周囲を確認し、修正したコピーを作成しています…</p>}
    <div className="dialog-actions"><button onClick={onClose}>閉じる</button><button disabled={busy||!text.trim()||!!session.editRestriction} onClick={annotate}>訂正注釈で記録</button>
      <button disabled={busy||!text.trim()||!!session.editRestriction} onClick={()=>{
        setBusy(true);setError('')
        void (async()=>{
          const output=await pool.prepareOutput(session.docId,session.annotationStore.toEdits(),false,undefined,{...input,text,fontSize:size})
          if(!active.current)return
          await onComplete(output.bytes,session.name.replace(/\.pdf$/i,'')+'_文字修正.pdf')
          if(active.current)onClose()
        })().catch(reason=>{if(active.current)setError(String(reason))}).finally(()=>{if(active.current)setBusy(false)})
      }}>修正したコピーを開く</button></div>
  </dialog>
}
