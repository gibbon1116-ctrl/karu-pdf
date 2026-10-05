import { useEffect, useRef, useState } from 'react'
import { QUANTITY_DIMENSIONS, quantityDimensions, type QuantityMark } from '../core/quantity'

export function QuantityDimensionsDialog({ mark, complete }: { mark: QuantityMark; complete(values: QuantityMark | null): void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [values, setValues] = useState<Partial<Record<keyof typeof QUANTITY_DIMENSIONS, string>>>({})
  const fields = quantityDimensions(mark.method).filter(key => !mark[key])
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="fixture-dialog quantity-dimensions-dialog" aria-label="拾いの寸法" onCancel={e => { e.preventDefault(); complete(null) }}>
    <form onSubmit={e => {
      e.preventDefault()
      if (fields.some(key => !/^\d+(?:\.\d{0,2})?$/.test(values[key] ?? '') || !(Number(values[key]) > 0) || Number(values[key]) > 1000)) return
      complete({ ...mark, ...Object.fromEntries(fields.map(key => [key, Number(values[key])])) })
    }}>
      <h2>拾いの寸法</h2>
      {fields.map((key, i) => <label key={key}>{QUANTITY_DIMENSIONS[key]}<span className="quantity-input-unit"><input autoFocus={i === 0} aria-label={QUANTITY_DIMENSIONS[key]} type="number" required min="0.01" max="1000" step="0.01" value={values[key] ?? ''} onChange={e => { const text = e.currentTarget.value; setValues(v => ({ ...v, [key]: text })) }} />m</span></label>)}
      <div className="dialog-actions"><button type="button" onClick={() => complete(null)}>やめる</button><button type="submit">決定</button></div>
    </form>
  </dialog>
}
