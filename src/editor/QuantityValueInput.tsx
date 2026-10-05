import { useEffect, useState } from 'react'

export function QuantityValueInput({ label, value, commit }: { label: string; value: number; commit(value: number): void }) {
  const [draft, setDraft] = useState(value.toFixed(2))
  useEffect(() => setDraft(value.toFixed(2)), [value])
  const save = () => {
    const n = Number(draft)
    if (draft.trim() && Number.isFinite(n) && n >= 0 && n <= 1000 && /^\d+(?:\.\d{0,2})?$/.test(draft)) { commit(n); setDraft(n.toFixed(2)) }
    else setDraft(value.toFixed(2))
  }
  return <label>{label}<span className="quantity-input-unit"><input aria-label={label} type="number" min="0" max="1000" step="0.01" value={draft} onChange={e => setDraft(e.currentTarget.value)} onBlur={save} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }} />m</span></label>
}
