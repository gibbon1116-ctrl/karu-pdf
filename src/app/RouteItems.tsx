import { useState } from 'react'
import { fixtureCode, quantityMethod } from '../core/countFixtures'
import { quantityValue } from '../core/quantity'
import type { AnnotationStore, EditableAnnotation } from '../editor/AnnotationStore'
import { QuantitySwatch } from '../editor/countMarkers'
export function RouteItems({ annotation: a, store }: { annotation: EditableAnnotation; store: AnnotationStore }) {
  const q = a.quantity!, [chosen, setChosen] = useState('')
  const routes = [{ itemId: q.itemId, count: q.count ?? 1 }, ...(q.extra ?? [])]
  const available = store.getCountFixtures().filter(f => quantityMethod(f) === 'polyline' && !routes.some(e => e.itemId === f.id))
  const length = quantityValue(a.vertices!, a.measure!.mmPerPoint, q)
  const commit = (i: number, count: number) => { const next = routes.map((e, j) => j === i ? { ...e, count } : e); store.updateRoute(a.id, next[0].count, next.slice(1)) }
  return <fieldset className="route-items"><legend>この経路の項目</legend>
    {routes.map((e, i) => { const f = store.getCountFixture(e.itemId); return <div className="route-item" key={a.id + e.itemId}>
      {f && <QuantitySwatch fixture={f} />}<span>{f ? fixtureCode(f) + ' ' + f.name : e.itemId}</span>
      <RouteCount value={e.count} label={(f ? fixtureCode(f) : e.itemId) + 'の条数'} commit={n => commit(i, n)} />条
      <span>{length.toFixed(2)}{e.count !== 1 ? '×' + e.count + ' = ' + (length * e.count).toFixed(2) : ''} m</span>
      {i > 0 && <button onClick={() => store.updateRoute(a.id, q.count ?? 1, (q.extra ?? []).filter(x => x.itemId !== e.itemId))}>外す</button>}
    </div> })}
    <select aria-label="長さの項目を選ぶ" value={available.some(f => f.id === chosen) ? chosen : ''} onChange={e => setChosen(e.currentTarget.value)}><option value="">長さの項目を選ぶ</option>{available.map(f => <option key={f.id} value={f.id}>{fixtureCode(f)} {f.name}</option>)}</select>
    <button disabled={!available.some(f => f.id === chosen) || (q.extra?.length ?? 0) >= 10} onClick={() => { store.updateRoute(a.id, q.count ?? 1, [...(q.extra ?? []), { itemId: chosen, count: 1 }]); setChosen('') }}>この経路に足す</button>
  </fieldset>
}
function RouteCount({ value, label, commit }: { value: number; label: string; commit(n: number): void }) {
  return <input key={value} aria-label={label} type="number" min="1" max="99" step="1" defaultValue={value} onBlur={e => {
    const n = Number(e.currentTarget.value)
    if (e.currentTarget.value !== '' && Number.isInteger(n) && n >= 1 && n <= 99) commit(n)
    else e.currentTarget.value = String(value)
  }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }} />
}
