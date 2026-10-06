import { useState } from 'react'
import { fixtureCode, quantityMethod } from '../core/countFixtures'
import { routeLength, ROUTE_SCOPES, type RouteScope } from '../core/quantity'
import { polylineLength } from '../core/measure'
import type { AnnotationStore, EditableAnnotation } from '../editor/AnnotationStore'
import { QuantitySwatch } from '../editor/countMarkers'
export function RouteItems({ annotation: a, store }: { annotation: EditableAnnotation; store: AnnotationStore }) {
  const q = a.quantity!, [chosen, setChosen] = useState('')
  const routes = [{ itemId: q.itemId, count: q.count ?? 1, scope: q.scope }, ...(q.extra ?? [])]
  const available = store.getCountFixtures().filter(f => quantityMethod(f) === 'polyline' && !routes.some(e => e.itemId === f.id))
  const planM = polylineLength(a.vertices!) * a.measure!.mmPerPoint / 1000
  const commit = (i: number, changes: { count?: number; scope?: RouteScope }) => { const next = routes.map((e, j) => j === i ? { ...e, ...changes } : e); store.updateRoute(a.id, next[0].count, next.slice(1), next[0].scope) }
  return <fieldset className="route-items"><legend>この経路の項目</legend>
    {routes.map((e, i) => { const f = store.getCountFixture(e.itemId), name = f ? fixtureCode(f) : e.itemId, length = routeLength(planM, q, e.scope); return <div className="route-item" key={a.id + e.itemId}>
      {f && <QuantitySwatch fixture={f} />}<span>{f ? fixtureCode(f) + ' ' + f.name : e.itemId}</span>
      <select aria-label={name + 'の範囲'} value={e.scope ?? 'all'} onChange={event => commit(i, { scope: event.currentTarget.value as RouteScope })}>{Object.entries(ROUTE_SCOPES).map(([scope, label]) => <option key={scope} value={scope}>{label}</option>)}</select>
      <RouteCount value={e.count} label={name + 'の条数'} commit={n => commit(i, { count: n })} />条
      <span>{length.toFixed(2)}×{e.count} = {(length * e.count).toFixed(2)} m</span>
      {i > 0 && <button onClick={() => store.updateRoute(a.id, q.count ?? 1, (q.extra ?? []).filter(x => x.itemId !== e.itemId))}>外す</button>}
    </div> })}
    <select aria-label="長さの項目を選ぶ" value={available.some(f => f.id === chosen) ? chosen : ''} onChange={e => setChosen(e.currentTarget.value)}><option value="">長さの項目を選ぶ</option>{available.map(f => <option key={f.id} value={f.id}>{fixtureCode(f)} {f.name}</option>)}</select>
    <button disabled={!available.some(f => f.id === chosen) || (q.extra?.length ?? 0) >= 10} onClick={() => { const fixture = available.find(f => f.id === chosen); if (!fixture) return; store.updateRoute(a.id, q.count ?? 1, [...(q.extra ?? []), { itemId: chosen, count: 1, ...(fixture.routeScope ? { scope: fixture.routeScope } : {}) }]); setChosen('') }}>この経路に足す</button>
  </fieldset>
}
function RouteCount({ value, label, commit }: { value: number; label: string; commit(n: number): void }) {
  return <input key={value} aria-label={label} type="number" min="1" max="99" step="1" defaultValue={value} onBlur={e => {
    const n = Number(e.currentTarget.value)
    if (e.currentTarget.value !== '' && Number.isInteger(n) && n >= 1 && n <= 99) commit(n)
    else e.currentTarget.value = String(value)
  }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }} />
}
