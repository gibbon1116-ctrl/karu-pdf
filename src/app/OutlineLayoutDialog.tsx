import { useEffect, useRef, useState } from 'react'
import type { OutlineLayoutImpact, OutlineLayoutPlan } from '../core/outlineModel'
import './OutlinePanel.css'

export function OutlineLayoutDialog({ impact, pageCount, onClose }: {
  impact: OutlineLayoutImpact; pageCount: number; onClose(plan: OutlineLayoutPlan | null): void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [choice, setChoice] = useState<'remove' | 'retarget' | 'cancel' | null>(null)
  const [pages, setPages] = useState<Record<string, string>>({})
  const [confirmed, setConfirmed] = useState(false)
  useEffect(() => { ref.current?.showModal() }, [])
  const blocked = !impact.editable && impact.removed.length > 0
  const duplicates = impact.duplicated.filter(item => !item.originalFirst)
  const invalidPages = impact.removed.some(item => !pages[item.id]?.trim() || !Number.isInteger(Number(pages[item.id])) || Number(pages[item.id]) < 1 || Number(pages[item.id]) > pageCount)
  const canApply = choice === 'cancel' || !blocked && choice !== null && (!duplicates.length || confirmed) && (choice !== 'retarget' || !invalidPages)
  const submit = () => {
    if (!canApply) return
    if (choice === 'cancel') { onClose(null); return }
    onClose({ baseRevision: impact.revision, remove: choice === 'remove' ? impact.removed.map(item => item.id) : [],
      retarget: choice === 'retarget' ? impact.removed.map(item => ({ id: item.id, cardIndex: Number(pages[item.id]) - 1 })) : [] })
  }
  return <dialog ref={ref} className="outline-dialog" aria-labelledby="outline-layout-title" onKeyDown={event => event.stopPropagation()} onCancel={event => { event.preventDefault(); onClose(null) }}>
    <h2 id="outline-layout-title">目次が指すページが変わります</h2>
    {impact.removed.length > 0 && <div className="outline-dialog-scroll"><ul>{impact.removed.map(item => <li key={item.id}>
      <strong>{item.title}</strong> — 元の{item.pageIndex + 1}ページ
      <div>祖先の経路: {item.path.length ? item.path.join(' / ') : '最上位'}{item.hasChildren && '（子項目あり）'}</div>
    </li>)}</ul></div>}
    {blocked && <p role="alert">目次の構造が読み取れないため、目次の指すページは削除できません。</p>}
    <fieldset><legend>目次の扱いを選んでください</legend>
      {!blocked && <>
        <label><input type="radio" name="outline-layout" checked={choice === 'remove'} onChange={() => setChoice('remove')} />該当する目次を削除する（子項目は上の階層に残す）</label>
        <label><input type="radio" name="outline-layout" checked={choice === 'retarget'} onChange={() => setChoice('retarget')} />新しいページを移動先に指定する</label>
        {choice === 'retarget' && <div className="outline-dialog-scroll">{impact.removed.map(item => <label key={item.id}>
          {item.title} の移動先（1〜{pageCount}ページ）<input type="number" min={1} max={pageCount} step={1} value={pages[item.id] ?? ''}
            onChange={event => setPages(previous => ({ ...previous, [item.id]: event.target.value }))} />
        </label>)}</div>}
      </>}
      <label><input type="radio" name="outline-layout" checked={choice === 'cancel'} onChange={() => setChoice('cancel')} />ページ整理をやめる</label>
    </fieldset>
    {!!duplicates.length && <div className="outline-dialog-scroll">{duplicates.map(item => <p key={item.id}>{item.pageIndex + 1}ページは複製されています。目次は整理後の最初の位置（{item.newPositions[0] + 1}ページ）を指します。〈{item.title}〉</p>)}
      {!blocked && <label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />この位置で続ける</label>}
    </div>}
    <div className="dialog-actions"><button onClick={() => onClose(null)}>キャンセル</button><button className="outline-primary" disabled={!canApply} onClick={submit}>適用</button></div>
  </dialog>
}
