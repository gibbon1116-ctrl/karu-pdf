import { useEffect, useRef, useState } from 'react'
export function LocationInput({ value, label, list, mixed = false, commit }: { value: string; label: string; list?: string; mixed?: boolean; commit(value: string): void }) {
  const [draft, setDraft] = useState(value), dirty = useRef(false)
  useEffect(() => setDraft(value), [value])
  const apply = () => { if (draft !== value || mixed && dirty.current) commit(draft); dirty.current = false; setDraft(value) }
  return <span className="location-input"><input aria-label={label} list={list} maxLength={40} value={draft} onChange={e => { dirty.current = true; setDraft(e.currentTarget.value) }} onBlur={apply} onKeyDown={e => {
    if (e.key === 'Enter') { e.preventDefault(); if (mixed) dirty.current = true; e.currentTarget.blur() }
    if (e.key === 'Escape') { e.preventDefault(); dirty.current = false; setDraft(value) }
  }} />{mixed && <small>（いろいろ）</small>}</span>
}
