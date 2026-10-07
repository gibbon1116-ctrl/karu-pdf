import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { countHex, fixtureCode } from '../core/countFixtures'
import { routeLength, ROUTE_SCOPES, type RouteScope } from '../core/quantity'
import { polylineLength } from '../core/measure'
import type { AnnotationStore, EditableAnnotation } from '../editor/AnnotationStore'
import { QuantitySwatch } from '../editor/countMarkers'
import { QuantityValueInput } from '../editor/QuantityValueInput'
import LinePicker, { announceRoute, changeRouteCount, routeEntries, routeHighlighted, useRouteFeedback } from './LinePicker'
import { loadRouteSets, resolveRouteSet, routeSetSummary, routeSetsSnapshot, saveRouteSets, scopeShort, subscribeRouteSets, type RouteSet } from './routeSets'

export function useRouteSets() { useSyncExternalStore(subscribeRouteSets, routeSetsSnapshot); return loadRouteSets() }

export function RouteItems({ annotation: a, store }: { annotation: EditableAnnotation; store: AnnotationStore }) {
  const q = a.quantity!, routes = routeEntries(a), feedback = useRouteFeedback(store)
  const [picker, setPicker] = useState(false), [sets, setSets] = useState(false)
  const closePicker = useCallback(() => setPicker(false), [])
  useEffect(() => { setPicker(false); setSets(false) }, [a.id])
  const planM = polylineLength(a.vertices!) * a.measure!.mmPerPoint / 1000
  const commit = (i: number, changes: { count?: number; scope?: RouteScope }) => store.setRouteItems(a.id, routes.map((e, j) => j === i ? { ...e, ...changes } : e))
  return <section className="route-items" aria-label="経路構成">
    <div className="route-heading"><strong>経路構成</strong><span>{routes.length}種類・{routes.reduce((n, e) => n + e.count, 0)}条</span><button type="button" onClick={() => { setPicker(false); setSets(v => !v) }} aria-expanded={sets}>よく使う構成</button></div>
    {sets && <RouteSetsDialog annotation={a} store={store} onClose={() => setSets(false)} />}
    <div className="route-lengths"><span>平面 {planM.toFixed(2)} m ＋</span>
      <div className="route-rise"><QuantityValueInput label="立上り・立下り" key={a.id + 'addM'} value={q.addM ?? 0} commit={n => store.updateQuantityAdd(a.id, n)} /></div>
      <div className="route-slack"><QuantityValueInput label="余長・その他" key={a.id + 'slackM'} value={q.slackM ?? 0} commit={n => store.updateQuantityValues(a.id, { slackM: n })} /></div>
    </div><small className="route-full-length">全長 {routeLength(planM, q).toFixed(2)} m</small>
    {routes.map((e, i) => {
      const f = store.getCountFixture(e.itemId), code = f ? fixtureCode(f) : e.itemId, length = routeLength(planM, q, e.scope)
      const highlighted = routeHighlighted(feedback, a.id, e.itemId)
      return <div className={`route-item${i === 0 ? ' route-item-main' : ''}${highlighted ? ' route-item-added' : ''}`} key={a.id + e.itemId} style={i === 0 && f ? { borderLeftColor: countHex(f.style.color) } : undefined}>
        <div className="route-item-heading"><span className="route-role" style={i === 0 && f ? { background: countHex(f.style.color), color: 'white' } : undefined}>{i === 0 ? '主' : '追加'}</span>
          {f && <QuantitySwatch fixture={f} />}<span className="route-item-identity" title={code + ' ' + (f?.name ?? '')}><strong>{code}</strong><small title={f?.name}>{f?.name}</small></span>
          {i > 0 && <><button type="button" aria-label={code + 'を主にする'} title="主にする" onClick={() => { store.setRouteItems(a.id, [e, ...routes.filter(x => x.itemId !== e.itemId)]); announceRoute(store, a.id, e.itemId, `${code} を主にしました`) }}>主に</button><button type="button" aria-label={code + 'を外す'} title="外す" onClick={() => { store.setRouteItems(a.id, routes.filter(x => x.itemId !== e.itemId)); announceRoute(store, a.id, null, `${code} を外しました（Ctrl+Z で戻せます）`) }}>×</button></>}
        </div>
        <div className="route-item-values"><select aria-label={code + 'の範囲'} title={ROUTE_SCOPES[e.scope ?? 'all']} value={e.scope ?? 'all'} onChange={event => commit(i, { scope: event.currentTarget.value as RouteScope })}>{Object.entries(ROUTE_SCOPES).map(([scope, label]) => <option key={scope} value={scope} title={label}>{scopeShort(scope as RouteScope)}</option>)}</select>
          <RouteCount value={e.count} code={code} commit={n => changeRouteCount(store, a, e.itemId, n)} />
          <span className="route-item-length" title={`${length.toFixed(2)}×${e.count}`}>= {(length * e.count).toFixed(2)} m</span>
        </div>
      </div>
    })}
    <button type="button" className="route-add" aria-label="線要素を追加" aria-expanded={picker} onClick={() => { setSets(false); setPicker(v => !v) }}>＋ 線要素を追加</button>
    {picker && <LinePicker store={store} annotation={a} onClose={closePicker} />}
    <div className="route-status" aria-live="polite" role="status">{feedback.routeId === a.id ? feedback.message : ''}</div>
  </section>
}
export function RouteCount({ value, code, commit }: { value: number; code: string; commit(n: number): void }) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (input.current) input.current.value = String(value) }, [value])
  useEffect(() => {
    const element = input.current, prevent = (e: WheelEvent) => e.preventDefault()
    element?.addEventListener('wheel', prevent, { passive: false })
    return () => element?.removeEventListener('wheel', prevent)
  }, [])
  return <span className="route-count"><button type="button" aria-label={code + 'の条数を減らす'} disabled={value <= 1} onClick={() => commit(value - 1)}>−</button>
    <input ref={input} aria-label={code + 'の条数'} type="number" min="1" max="99" step="1" defaultValue={value} onBlur={e => {
      const n = Number(e.currentTarget.value)
      if (e.currentTarget.value !== '' && Number.isInteger(n) && n >= 1 && n <= 99) commit(n)
      else e.currentTarget.value = String(value)
    }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }} />
    <button type="button" aria-label={code + 'の条数を増やす'} disabled={value >= 99} onClick={() => commit(value + 1)}>+</button></span>
}

function RouteSetsDialog({ store, annotation: a, onClose }: { store: AnnotationStore; annotation: EditableAnnotation; onClose(): void }) {
  const sets = useRouteSets(), root = useRef<HTMLDivElement>(null)
  const currentItems = routeEntries(a).flatMap(e => { const f = store.getCountFixture(e.itemId); return f ? [{ code: f.code, spec: f.spec, name: f.name, category: f.category, count: e.count, scope: e.scope }] : [] })
  const [name, setName] = useState(() => routeSetSummary({ items: currentItems }).slice(0, 40)), [renaming, setRenaming] = useState<string | null>(null), [rename, setRename] = useState(''), [error, setError] = useState('')
  useEffect(() => {
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) onClose() }
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape, true)
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true) }
  }, [onClose])
  const write = (next: RouteSet[]) => { saveRouteSets(next); if (JSON.stringify(loadRouteSets()) !== JSON.stringify(next)) setError('ブラウザーに保存できませんでした。') }
  return <div ref={root} className="route-sets-dialog" role="dialog" aria-label="よく使う構成">
    <h4>よく使う構成</h4>
    {sets.map(set => <div className="route-set" key={set.id}>
      <button type="button" aria-label={set.name} title={routeSetSummary(set)} onClick={() => { try { const result = resolveRouteSet(set, store.getCountFixtures()); store.addFixturesAndSetRouteItems(result.newFixtures, a.id, result.items); announceRoute(store, a.id, null, `構成「${set.name}」にしました`); onClose() } catch (reason) { setError(String(reason)) } }}><strong>{set.name}</strong><small>{routeSetSummary(set)}</small></button>
      {renaming === set.id ? <form onSubmit={e => { e.preventDefault(); if (rename.trim()) { write(sets.map(s => s.id === set.id ? { ...s, name: rename.trim() } : s)); setRenaming(null) } }}><input aria-label="構成の新しい名前" maxLength={40} value={rename} onChange={e => setRename(e.currentTarget.value)} /><button disabled={!rename.trim()}>保存</button></form> : <button type="button" aria-label={set.name + 'の名前を変える'} onClick={() => { setRenaming(set.id); setRename(set.name) }}>名前を変える</button>}
      <button type="button" aria-label={set.name + 'を削除'} onClick={() => write(sets.filter(s => s.id !== set.id))}>削除</button>
    </div>)}
    <form onSubmit={e => { e.preventDefault(); if (sets.length < 50 && name.trim()) { write([...sets, { id: crypto.randomUUID(), name: name.trim(), items: currentItems }]) } }}>
      <label>この経路の構成を登録<input aria-label="構成の名前" value={name} maxLength={40} onChange={e => setName(e.currentTarget.value)} /></label><button disabled={sets.length >= 50 || !name.trim()}>登録</button>
      {sets.length >= 50 && <small>これ以上登録できません（最大 50 件）</small>}
    </form>{error && <p role="alert">{error}</p>}
  </div>
}
