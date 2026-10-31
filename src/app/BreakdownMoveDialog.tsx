import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { BreakdownPosition, CountFixture } from '../core/countFixtures'
import type { BreakdownEntry } from '../core/breakdownMaster'
import {
  createQuantityBreakdownOrder,
  quantityBreakdownRowKey,
  type QuantityBreakdownOrder,
} from './breakdownOutline'

interface Props {
  fixture: CountFixture
  canEdit: boolean
  onMove: (
    position: BreakdownPosition,
    allAtPosition: boolean,
    order: QuantityBreakdownOrder,
  ) => string | undefined
  onClose: () => void
}

function entryPosition(entry: BreakdownEntry): BreakdownPosition {
  return {
    book: entry.book,
    section: entry.section,
    subject: entry.subject,
    ...(entry.middle ? { middle: entry.middle } : {}),
    item: entry.row.name,
  }
}

function positionLabel(position: BreakdownPosition): string {
  return [position.section, position.subject, position.middle, position.item]
    .filter(Boolean).join(' › ')
}

function searchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase()
}

export default function BreakdownMoveDialog({ fixture, canEdit, onMove, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const radioName = useId()
  const [master, setMaster] = useState<{
    entries: readonly BreakdownEntry[]
    order: QuantityBreakdownOrder
  }>()
  const [query, setQuery] = useState('')
  const [showOthers, setShowOthers] = useState(false)
  const [allAtPosition, setAllAtPosition] = useState(false)
  const [targetKey, setTargetKey] = useState('')
  const [error, setError] = useState('')
  const position = fixture.breakdown
  const book = position?.book

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [])

  useEffect(() => {
    if (!book) return
    let alive = true
    setMaster(undefined)
    setError('')
    void import('../core/breakdownMaster').then(({ breakdownEntries }) => {
      if (!alive) return
      setMaster({
        entries: breakdownEntries(book),
        // The parent also uses this order for other books already present in the document.
        order: createQuantityBreakdownOrder(breakdownEntries()),
      })
    }).catch(reason => {
      if (alive) setError(`移す先を読み込めませんでした：${reason instanceof Error ? reason.message : String(reason)}`)
    })
    return () => { alive = false }
  }, [book])

  const currentKey = position ? quantityBreakdownRowKey(position) : ''
  const separate = position !== undefined
    && master?.order.rows.get(currentKey)?.separate === true
  const candidates = useMemo(() => {
    if (!master || !position) return []
    const terms = searchText(query).split(/\s+/).filter(Boolean)
    const seen = new Set<string>()
    return master.entries.flatMap(entry => {
      if ((entry.row.separate === true) !== separate
        || (!(separate && showOthers) && entry.row.name !== position.item)) return []
      const destination = entryPosition(entry)
      const key = quantityBreakdownRowKey(destination)
      if (seen.has(key)) return []
      seen.add(key)
      const label = positionLabel(destination)
      const haystack = searchText(label)
      if (!terms.every(term => haystack.includes(term))) return []
      return [{ key, position: destination, label }]
    })
  }, [master, position, separate, showOthers, query])
  const target = candidates.find(candidate => candidate.key === targetKey && candidate.key !== currentKey)

  return <dialog ref={dialogRef} className="breakdown-move-dialog"
    role="dialog" aria-modal="true" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose() }}>
    <form onSubmit={event => {
      event.preventDefault()
      if (!canEdit || !master || !target) return
      try {
        setError(onMove(target.position, separate && allAtPosition, master.order) ?? '')
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    }}>
      <h2 id={titleId}>内訳書の位置を移す</h2>
      <p>{fixture.name}</p>
      {position && <p className="breakdown-move-current">
        今の位置：{position.book} › {positionLabel(position)}
      </p>}
      <label className="breakdown-move-search">
        移す先を検索
        <input type="search" aria-label="移す先を検索" autoFocus
          value={query} onChange={event => setQuery(event.currentTarget.value)} />
      </label>
      {master && separate && <label className="breakdown-move-option">
        <input type="checkbox" checked={showOthers}
          onChange={event => setShowOthers(event.currentTarget.checked)} />
        ほかの別紙明細も表示
      </label>}
      {!master && !error && <p role="status">移す先を読み込んでいます…</p>}
      {master && <fieldset className="breakdown-move-destinations">
        <legend>移す先</legend>
        {candidates.length ? <ul>
          {candidates.map(candidate => {
            const current = candidate.key === currentKey
            return <li key={candidate.key}>
              <label className={current ? 'breakdown-move-current-row' : undefined}>
                <input type="radio" name={radioName} value={candidate.key}
                  disabled={current || !canEdit}
                  checked={!current && targetKey === candidate.key}
                  onChange={() => { setTargetKey(candidate.key); setError('') }} />
                <span>{candidate.label}{current ? '（今の位置）' : ''}</span>
              </label>
            </li>
          })}
        </ul> : <p role="status">一致する移す先がありません</p>}
      </fieldset>}
      {master && separate && <label className="breakdown-move-option">
        <input type="checkbox" checked={allAtPosition} disabled={!canEdit}
          onChange={event => setAllAtPosition(event.currentTarget.checked)} />
        同じ別紙明細の項目をすべて移す
      </label>}
      {error && <p role="alert">{error}</p>}
      <div className="breakdown-move-actions">
        <button type="button" onClick={onClose}>閉じる</button>
        <button type="submit" disabled={!canEdit || !master || !target}>移す</button>
      </div>
    </form>
  </dialog>
}
