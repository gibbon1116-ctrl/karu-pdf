import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import { flattenOutline, normalizeOutlineTitle, validateOutlineItems, type OutlineItem } from '../core/outlineModel'
import type { DocumentSession } from './documentModel'
import type { OutlineDraft } from './OutlineDraft'
import { buildDrawingOutline, drawingOutlineCandidates, drawingOutlineGroups, type DrawingOutlineCandidate } from './outlineFromDrawings'
import './OutlinePanel.css'

export function OutlineFromDrawingsDialog({ session, pool, draft, onClose, onChange }: {
  session: DocumentSession; pool: PdfWorkerPool; draft: OutlineDraft; onClose(): void; onChange(): void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const readCandidates = () => drawingOutlineCandidates(session.pageSizes.map((_, i) => session.annotationStore.getDrawingInfo(i)))
  const [candidates, setCandidates] = useState(readCandidates)
  const [grouped, setGrouped] = useState(false)
  const [groupTitles, setGroupTitles] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<'append' | 'replace'>('append')
  const [error, setError] = useState('')
  const scanStatus = useSyncExternalStore(session.subscribeDrawingScan, session.getDrawingScanSnapshot)
  const storeVersion = useSyncExternalStore(session.annotationStore.subscribe, session.annotationStore.getSnapshot)
  useSyncExternalStore(draft.subscribe, draft.getSnapshot)
  useEffect(() => { ref.current?.showModal() }, [])
  useEffect(() => {
    const fresh = readCandidates(), byPage = new Map(fresh.map(candidate => [candidate.pageIndex, candidate]))
    setCandidates(previous => {
      const existing = new Set(previous.map(candidate => candidate.pageIndex))
      return [...previous.map(candidate => {
        const next = byPage.get(candidate.pageIndex)
        if (!next) return candidate
        // Keep the user's title, inclusion and ordering when a scan completes.
        const automaticTitle = `${candidate.number} ${candidate.name}`.trim()
        return { ...next, title: candidate.title === automaticTitle ? next.title : candidate.title, include: candidate.include }
      }), ...fresh.filter(candidate => !existing.has(candidate.pageIndex))]
    })
  }, [session, storeVersion])
  const missing = session.pageSizes.some((_, i) => !session.annotationStore.getDrawingInfo(i)?.scanned)
  const grouping = drawingOutlineGroups(candidates)
  const useGroups = grouped && grouping.reason === null
  const groups = grouping.groups.map(group => ({ ...group, title: groupTitles[group.key] ?? group.title }))
  const oldItems = flattenOutline(draft.getItems() as OutlineItem[])
  const editable = !session.editRestriction && draft.base.editable && session.outlineDraft === draft
  const included = candidates.filter(candidate => candidate.include)
  const invalidTitle = (title: string) => { try { normalizeOutlineTitle(title); return false } catch { return true } }
  const invalid = !included.length || included.some(candidate => invalidTitle(candidate.title)) || useGroups && groups.some(group => invalidTitle(group.title))
  const update = (pageIndex: number, patch: Partial<DrawingOutlineCandidate>) => setCandidates(previous => previous.map(candidate => candidate.pageIndex === pageIndex ? { ...candidate, ...patch } : candidate))
  const move = (index: number, delta: number) => setCandidates(previous => {
    const next = [...previous], destination = index + delta
    if (destination < 0 || destination >= next.length) return previous
    ;[next[index], next[destination]] = [next[destination], next[index]]
    return next
  })
  const scan = async () => {
    setError('')
    try { await session.scanDrawingInfos(pool); onChange() }
    catch (reason) { setError(`図面情報を読み取れませんでした: ${reason instanceof Error ? reason.message : String(reason)}`) }
  }
  const insert = () => {
    if (!editable || invalid) return
    try {
      const items = buildDrawingOutline(candidates, useGroups ? groups : null)
      // buildDrawingOutline is deterministic; repeated imports must also have unique ids.
      const used = new Set(oldItems.map(({ item }) => item.id))
      let serial = 0
      for (const { item } of flattenOutline(items)) {
        let id: string
        do { id = `new:drawing-${++serial}` } while (used.has(id))
        item.id = id; used.add(id)
      }
      // Check only the new items: untouched existing titles (even blank ones) are kept on apply.
      const problems = validateOutlineItems(items, session.pageSizes.length)
      if (problems.length) throw new Error(problems.join('、'))
      if (mode === 'replace') draft.replaceAll(items); else draft.append(items)
      onChange(); onClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  return <dialog ref={ref} className="outline-dialog outline-drawings-dialog" aria-labelledby="outline-drawings-title" onKeyDown={event => event.stopPropagation()} onCancel={event => { event.preventDefault(); onClose() }}>
    <h2 id="outline-drawings-title">図面情報から目次を作成</h2>
    {missing && <p>まだ読み取っていないページがあります</p>}
    {missing && editable && <button disabled={session.drawingScanning} onClick={() => void scan()}>図面番号・図面名称を読み取る</button>}
    {scanStatus && <p role="status">{scanStatus}</p>}
    <p>候補の名称と順序を確認してください。PDFにはまだ書き込みません。読取り中も、表示されている候補で作成できます。</p>
    {!candidates.length && <p>候補がありません。キャンセルして、目次タブで手動編集を続けられます。</p>}
    <div className="outline-dialog-scroll"><table><thead><tr><th>含める</th><th>ページ</th><th>名称</th><th>図面番号</th><th>順序</th></tr></thead>
      <tbody>{candidates.map((candidate, index) => <tr key={candidate.pageIndex}>
        <td><input type="checkbox" aria-label={`${candidate.pageIndex + 1}ページを含める`} checked={candidate.include} onChange={event => update(candidate.pageIndex, { include: event.target.checked })} /></td>
        <td>{candidate.pageIndex + 1}</td>
        <td><input aria-label={`${candidate.pageIndex + 1}ページの名称`} value={candidate.title} aria-invalid={candidate.include && invalidTitle(candidate.title)} onChange={event => update(candidate.pageIndex, { title: event.target.value })} /></td>
        <td>{candidate.number || '—'}</td>
        <td><button aria-label={`${candidate.pageIndex + 1}ページを上へ`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button aria-label={`${candidate.pageIndex + 1}ページを下へ`} disabled={index === candidates.length - 1} onClick={() => move(index, 1)}>↓</button></td>
      </tr>)}</tbody></table></div>
    {included.some(candidate => invalidTitle(candidate.title)) && <p role="alert">含める候補の名称を1〜1000文字で入力してください。</p>}
    <label><input type="checkbox" disabled={grouping.reason !== null} checked={useGroups} onChange={event => setGrouped(event.target.checked)} />図面番号の英字の頭でまとめる</label>
    {grouping.reason && <p>{grouping.reason}</p>}
    {useGroups && <div className="outline-dialog-scroll">{groups.map(group => <label key={group.key}>{group.key} のグループ名 {group.guessed && <span>（推定）</span>}
      <input aria-label={`${group.key}のグループ名`} value={group.title} aria-invalid={invalidTitle(group.title)} onChange={event => setGroupTitles(previous => ({ ...previous, [group.key]: event.target.value }))} />
    </label>)}{groups.some(group => group.guessed) && <p>推定したグループ名です。図面の内容に合わせて確認・修正してください。</p>}</div>}
    {!!oldItems.length && <fieldset><legend>既存の目次の扱い</legend>
      <label><input type="radio" name="drawing-outline-mode" checked={mode === 'append'} onChange={() => setMode('append')} />既存の目次の後ろに追加</label>
      <label><input type="radio" name="drawing-outline-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />既存の目次を置き換える</label>
      {mode === 'replace' && <><p>次の目次（{oldItems.length}件）が削除されます</p><ul className="outline-dialog-scroll">{oldItems.slice(0, 20).map(({ item, depth }) => <li key={item.id}>{'　'.repeat(depth)}{item.title}</li>)}</ul>{oldItems.length > 20 && <p>ほか{oldItems.length - 20}件</p>}</>}
    </fieldset>}
    {error && <p role="alert">{error}</p>}
    <p>下書きに入れた後は、目次タブで［目次を反映］してから保存してください。追加・置き換えは1回の［戻す］で取り消せます。</p>
    <div className="dialog-actions"><button onClick={onClose}>キャンセル</button>{editable && <button className="outline-primary" disabled={invalid} onClick={insert}>目次の下書きに入れる</button>}</div>
  </dialog>
}
