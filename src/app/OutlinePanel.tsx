import { useEffect, useState } from 'react'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import type { OutlineEntry } from '../core/outline'

interface Props {
  docId: string
  pool: PdfWorkerPool
  onNavigate(pageIndex: number, x: number | null, y: number | null): void
}

function OutlineBranch({ entries, onNavigate }: {
  entries: readonly OutlineEntry[]
  onNavigate(pageIndex: number, x: number | null, y: number | null): void
}) {
  return <ul className="outline-tree">
    {entries.map((entry, index) => <li key={`${entry.title}-${entry.pageIndex}-${index}`}>
      {entry.children.length > 0 ? (
        <details open={entry.open}>
          <summary>
            <button type="button" disabled={entry.pageIndex === null} onClick={(event) => {
              event.preventDefault()
              const details = event.currentTarget.closest('details')
              if (details) details.open = true
              if (entry.pageIndex !== null) onNavigate(entry.pageIndex, entry.x, entry.y)
            }}>{entry.title}</button>
          </summary>
          <OutlineBranch entries={entry.children} onNavigate={onNavigate} />
        </details>
      ) : (
        <button type="button" disabled={entry.pageIndex === null} onClick={() => {
          if (entry.pageIndex !== null) onNavigate(entry.pageIndex, entry.x, entry.y)
        }}>
          <span>{entry.title}</span>
          {entry.pageIndex !== null && <small>p.{entry.pageIndex + 1}</small>}
        </button>
      )}
    </li>)}
  </ul>
}

export function OutlinePanel({ docId, pool, onNavigate }: Props) {
  const [outline, setOutline] = useState<OutlineEntry[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setOutline(null)
    setError('')
    void pool.loadOutline(docId).then((value) => {
      if (active) setOutline(value)
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { active = false }
  }, [docId, pool])

  if (error) return <p className="side-panel-message error-text">しおりを読み込めませんでした: {error}</p>
  if (outline === null) return <p className="side-panel-message">しおりを読み込んでいます…</p>
  if (outline.length === 0) return <p className="side-panel-message">この PDF には、しおりがありません</p>
  return <nav className="outline-panel" aria-label="しおり"><OutlineBranch entries={outline} onNavigate={onNavigate} /></nav>
}
