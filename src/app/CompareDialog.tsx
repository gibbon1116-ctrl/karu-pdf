import { useEffect, useRef, useState } from 'react'
import type { DocumentSession } from './documentModel'

interface Props {
  documents: readonly DocumentSession[]
  activeId: string
  onOpen(): void
  onCompare(old: DocumentSession, next: DocumentSession): void
  onClose(): void
}
export function CompareDialog(props: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  // 今のタブと隣のタブのうち、タブの並びで左（先に開いた方）を旧版、右を新版にする。
  // 旧版を開いてから新版を開くと、今のタブは新版になるため、「今のタブ＝旧版」では逆になる。
  const [defaultOld, defaultNew] = (() => {
    const index = props.documents.findIndex(d => d.docId === props.activeId)
    if (index < 0 || props.documents.length < 2) return [props.activeId, props.activeId]
    const neighbor = index + 1 < props.documents.length ? index + 1 : index - 1
    return [props.documents[Math.min(index, neighbor)].docId, props.documents[Math.max(index, neighbor)].docId]
  })()
  const [oldId, setOld] = useState(defaultOld)
  const [newId, setNew] = useState(defaultNew)
  const previous = useRef(new Set(props.documents.map(d => d.docId)))
  useEffect(() => { ref.current?.showModal() }, [])
  useEffect(() => {
    const added = props.documents.find(d => !previous.current.has(d.docId))
    if (added) setNew(added.docId)
    previous.current = new Set(props.documents.map(d => d.docId))
  }, [props.documents])
  const old = props.documents.find(d => d.docId === oldId), next = props.documents.find(d => d.docId === newId)
  return <dialog ref={ref} className="compare-dialog" aria-labelledby="compare-dialog-title" onCancel={props.onClose}>
    <h1 id="compare-dialog-title">2つの PDF を比較</h1>
    <label>旧版<select aria-label="比較する旧版" value={oldId} onChange={e => setOld(e.target.value)}>{props.documents.map(d => <option key={d.docId} value={d.docId}>{d.name}</option>)}</select></label>
    <label>新版<select aria-label="比較する新版" value={newId} onChange={e => setNew(e.target.value)}>{props.documents.map(d => <option key={d.docId} value={d.docId}>{d.name}</option>)}</select></label>
    <p>同じページ番号どうしを比べます。比較の画面で番号を変えられます。</p>
    <div className="dialog-actions">
      <button onClick={props.onOpen}>ファイルを開く</button>
      <button onClick={props.onClose}>キャンセル</button>
      <button disabled={!old || !next} onClick={() => { if (old && next) props.onCompare(old, next) }}>比較</button>
    </div>
  </dialog>
}
