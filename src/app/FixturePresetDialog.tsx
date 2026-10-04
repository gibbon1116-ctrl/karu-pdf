import { useEffect, useRef, useState } from 'react'
import { FIXTURE_PRESETS, type CountFixture } from '../core/countFixtures'
import { CountMarker } from '../editor/countMarkers'
type Preset = { name: string; code: string; category: string }
const isFixture = (item: Preset | CountFixture): item is CountFixture => 'style' in item
export default function FixturePresetDialog({ sources, onAdd, onClose }: { sources?: Array<{ name: string; fixtures: CountFixture[] }>; onAdd(items: Array<Preset | CountFixture>): void; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null), [field, setField] = useState(sources ? '0' : '電気設備'), [unchecked, setUnchecked] = useState(new Set<number>()), [error, setError] = useState('')
  useEffect(() => { dialog.current?.showModal() }, [])
  const items = sources ? sources[Number(field)]?.fixtures ?? [] : FIXTURE_PRESETS[field]
  return <dialog ref={dialog} className="fixture-dialog" aria-label={sources ? '他のPDFから読み込む' : '見本から追加'} onCancel={onClose}>
    <h2>{sources ? '他のPDFから読み込む' : '見本から追加'}</h2>
    <label>{sources ? 'PDF' : '分野'}<select aria-label={sources ? '読込元PDF' : '見本の分野'} value={field} onChange={e => { setField(e.currentTarget.value); setUnchecked(new Set()); setError('') }}>
      {sources ? sources.map((s, i) => <option key={i} value={i}>{s.name}</option>) : Object.keys(FIXTURE_PRESETS).map(s => <option key={s}>{s}</option>)}
    </select></label>
    {!items?.length && <p>器具リストを持つPDFがありません。</p>}
    <div className="fixture-presets">{items?.map((f, i) => <label key={i}><input type="checkbox" checked={!unchecked.has(i)} onChange={e => { const checked = e.currentTarget.checked; setUnchecked(previous => { const next = new Set(previous); if (checked) next.delete(i); else next.add(i); return next }) }} />
      {isFixture(f) && <svg className="fixture-swatch" viewBox="-16 -16 32 32" aria-hidden="true"><CountMarker style={f.style} showCode={false} /></svg>}{f.category}／{f.code} {f.name}
    </label>)}</div>
    {error && <p role="alert">{error}</p>}
    <div className="dialog-actions"><button onClick={onClose}>閉じる</button><button disabled={!items?.some((_, i) => !unchecked.has(i))} onClick={() => {
      try { onAdd(items.filter((_, i) => !unchecked.has(i))); onClose() } catch (reason) { setError(String(reason)) }
    }}>選んだ器具を追加</button></div>
  </dialog>
}
