import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { countHex, fixtureCode, type CountFixture } from '../core/countFixtures'
import { routeMemberLength, routeRises, routePortions, riseCondition, validCondition, type PartCondition, type RoutePart } from '../core/quantity'
import { polylineLength } from '../core/measure'
import type { AnnotationStore, EditableAnnotation } from '../editor/AnnotationStore'
import { QuantitySwatch } from '../editor/countMarkers'
import { QuantityValueInput } from '../editor/QuantityValueInput'
import LinePicker, { announceRoute, changeRouteCount, routeEntries, routeHighlighted, useRouteFeedback } from './LinePicker'
import { loadRouteSets, resolveRouteSet, routeSetSummary, routeSetsSnapshot, saveRouteSets, subscribeRouteSets, type RouteSet } from './routeSets'

export function useRouteSets() { useSyncExternalStore(subscribeRouteSets, routeSetsSnapshot); return loadRouteSets() }

export function ConditionSelect({ fixture, label, value, commit, add, allowExclude = false, mixed = false, emptyCandidatesOnly = false }: {
  fixture: CountFixture; label: string; value: PartCondition; commit(value: PartCondition): void; add(value: string): string | undefined
  allowExclude?: boolean; mixed?: boolean; emptyCandidatesOnly?: boolean
}) {
  const [adding, setAdding] = useState(false), [draft, setDraft] = useState(''), [error, setError] = useState('')
  const candidates = fixture.conditions ?? [], names = [...candidates]
  if (typeof value === 'string' && !names.includes(value)) names.push(value)
  const encoded = mixed ? 'mixed' : value === undefined ? 'unset' : value === null ? 'exclude' : 'value:' + value
  const onlyAdd = emptyCandidatesOnly && !names.length
  return <div className="route-condition-field">
    <label className="route-condition-row"><span>{label}</span><select aria-label={label} title={mixed ? '複数の条件' : value ?? (value === null ? '数えない' : '未設定')} value={onlyAdd ? 'prompt' : encoded} onChange={e => {
      const v = e.currentTarget.value
      if (v === 'add') { setAdding(true); setDraft(''); setError('') }
      else { setAdding(false); commit(v === 'unset' ? undefined : v === 'exclude' ? null : v.slice(6)) }
    }}>
      {onlyAdd ? <option value="prompt" hidden>＋ 条件を追加…</option> : <option value="unset">未設定</option>}
      {mixed && <option value="mixed" disabled>複数の条件</option>}
      {names.map(name => <option key={name} value={'value:' + name}>{name}</option>)}
      {allowExclude && <option value="exclude">数えない</option>}
      <option value="add">＋ 条件を追加…</option>
    </select></label>
    {adding && <form className="route-condition-add" onSubmit={e => {
      e.preventDefault(); e.stopPropagation()
      const name = draft.trim()
      if (!validCondition(name)) { setError('条件は1〜30文字で、改行を入れずに入力してください。'); return }
      if (!candidates.includes(name) && candidates.length >= 30) { setError('施工条件の候補は30件までです。'); return }
      try { const reason = add(name); if (reason) setError(reason); else setAdding(false) } catch (reason) { setError(String(reason)) }
    }}>
      <input autoFocus aria-label={label + 'の新しい条件'} maxLength={30} value={draft} onChange={e => setDraft(e.currentTarget.value)} onKeyDown={e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAdding(false) }
        if (e.key === 'Enter') e.stopPropagation()
      }} /><button type="submit">追加</button><button type="button" aria-label="条件追加をやめる" onClick={() => setAdding(false)}>×</button>
      {error && <small role="alert">{error}</small>}
    </form>}
  </div>
}

export function RouteItems({ annotation: a, store }: { annotation: EditableAnnotation; store: AnnotationStore }) {
  const q = a.quantity!, routes = routeEntries(a), rises = routeRises(q), feedback = useRouteFeedback(store)
  const [picker, setPicker] = useState(false), [sets, setSets] = useState(false), [splitting, setSplitting] = useState(false), [vertex, setVertex] = useState(1)
  const [individual, setIndividual] = useState<Set<string>>(() => new Set())
  const closePicker = useCallback(() => setPicker(false), [])
  useEffect(() => {
    setPicker(false); setSets(false); setSplitting(false); setVertex(1); setIndividual(new Set())
    return () => { store.setHighlightedRise(null); store.setHighlightedVertex(null) }
  }, [a.id, store])
  const planM = polylineLength(a.vertices!) * a.measure!.mmPerPoint / 1000
  return <section className="route-items" aria-label="経路構成">
    <div className="route-heading"><strong>経路構成</strong><span>{routes.length}種類・{routes.reduce((n, e) => n + e.count, 0)}条</span><button type="button" onClick={() => { setPicker(false); setSets(v => !v) }} aria-expanded={sets}>よく使う構成</button></div>
    {sets && <RouteSetsDialog annotation={a} store={store} onClose={() => setSets(false)} />}
    <div className="route-lengths"><span>平面 {planM.toFixed(2)} m</span>
      {rises.map((r, i) => <div className="route-rise-row" key={a.id + ':' + i} onMouseEnter={() => store.setHighlightedRise({ annotationId: a.id, riseIndex: i })}
        onMouseLeave={e => { if (!e.currentTarget.contains(document.activeElement)) store.setHighlightedRise(null) }}
        onFocus={() => store.setHighlightedRise({ annotationId: a.id, riseIndex: i })}
        onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null) && !e.currentTarget.matches(':hover')) store.setHighlightedRise(null) }}>
        <QuantityValueInput label={'立上り・立下り' + (i + 1)} value={r.m} commit={m => store.setRouteRises(a.id, rises.map((r, j) => j === i ? { ...r, m } : r))} />
        <select aria-label={'立上り' + (i + 1) + 'の位置'} value={r.at ?? ''} onChange={e => store.setRouteRises(a.id, rises.map((r, j) => {
          if (j !== i) return r
          return { m: r.m, ...(e.currentTarget.value === '' ? {} : { at: Number(e.currentTarget.value) }) }
        }))}><option value="">なし</option>{a.vertices!.map((_, v) => <option key={v} value={v}>{v === 0 ? '始点' : v === a.vertices!.length - 1 ? '終点' : '頂点' + (v + 1)}</option>)}</select>
        <button type="button" aria-label={'立上り' + (i + 1) + 'を削除'} title="削除" onClick={() => {
          store.removeRouteRise(a.id, i)
          store.setHighlightedRise(null)
        }}>×</button>
      </div>)}
      <button type="button" disabled={rises.length >= 20} onClick={() => store.setRouteRises(a.id, [...rises, { m: 0 }])}>＋ 立上り・立下りを足す</button>
      <div className="route-slack" title="図示されない付加長を、設計図書に指示がある場合だけ入れる。切り無駄・割増は入れない（単価に含まれる）"><QuantityValueInput label="その他の加算" value={q.slackM ?? 0} commit={n => store.updateQuantityValues(a.id, { slackM: n })} /></div>
    </div>
    {routes.map((e, i) => {
      const f = store.getCountFixture(e.itemId), code = f ? fixtureCode(f) : e.itemId, length = routeMemberLength(planM, q, e.cond)
      const portions = routePortions(planM, q, e.cond), perRise = Array.isArray(e.cond.rise) || individual.has(e.itemId)
      const detail = (['plan', 'rise', 'slack'] as const).flatMap(part => {
        const values = portions.filter(p => p.part === part)
        return values.length ? [(part === 'plan' ? '平面 ' : part === 'rise' ? '立上り ' : 'その他 ') + values.reduce((n, p) => n + p.lengthM, 0).toFixed(2)] : []
      }).join(' ＋ ') + ' ＝ ' + length.toFixed(2) + ' m' + (e.count > 1 ? '（×' + e.count + '条 ' + (length * e.count).toFixed(2) + ' m）' : '')
      const condition = (part: 'plan' | 'rise' | 'slack', label: string, riseIndex?: number) => f && <ConditionSelect key={label} fixture={f} label={label} value={part === 'rise' ? riseCondition(e.cond, riseIndex ?? 0) : e.cond[part]} allowExclude
        commit={value => store.setRouteCondition([a.id], e.itemId, part, value, riseIndex)} add={value => addRouteCandidate(store, [a.id], e.itemId, part, value, riseIndex)} />
      return <div className={'route-item' + (i === 0 ? ' route-item-main' : '') + (routeHighlighted(feedback, a.id, e.itemId) ? ' route-item-added' : '')} key={a.id + e.itemId} style={i === 0 && f ? { borderLeftColor: countHex(f.style.color) } : undefined}>
        <div className="route-item-heading"><span className="route-role" style={i === 0 && f ? { background: countHex(f.style.color), color: 'white' } : undefined}>{i === 0 ? '主' : '追加'}</span>
          {f && <QuantitySwatch fixture={f} />}<span className="route-item-identity" title={code + ' ' + (f?.name ?? '')}><strong>{code}</strong><small title={f?.name}>{f?.name}</small></span>
          {i > 0 && <><button type="button" aria-label={code + 'を主にする'} title="主にする" onClick={() => { store.setRouteMembers(a.id, [e, ...routes.filter(x => x.itemId !== e.itemId)]); announceRoute(store, a.id, null, code + ' を主にしました') }}>主</button><button type="button" aria-label={code + 'を外す'} title="外す" onClick={() => { store.setRouteMembers(a.id, routes.filter(x => x.itemId !== e.itemId)); announceRoute(store, a.id, null, code + ' を外しました（Ctrl+Z で戻せます）') }}>×</button></>}
        </div>
        <div className="route-item-values"><RouteCount value={e.count} code={code} commit={n => changeRouteCount(store, a, e.itemId, n)} /><span>条</span></div>
        {condition('plan', '平面')}
        {rises.length >= 2 && <label className="route-individual"><input type="checkbox" aria-label={code + 'の立上りごとに選ぶ'} checked={perRise} onChange={event => {
          const checked = event.currentTarget.checked
          setIndividual(old => { const next = new Set(old); if (checked) next.add(e.itemId); else next.delete(e.itemId); return next })
          if (!checked) store.setRouteCondition([a.id], e.itemId, 'rise', riseCondition(e.cond, 0))
        }} />立上りごとに選ぶ</label>}
        {rises.length > 0 && (perRise ? rises.map((r, j) => condition('rise', '立上り' + (j + 1) + '（' + r.m.toFixed(2) + ' m）', j)) : condition('rise', '立上り'))}
        {(q.slackM ?? 0) > 0 && condition('slack', 'その他')}
        <div className="route-item-length" title={detail}>{detail}</div>
        {!!f?.conditions?.length && portions.some(p => p.condition === undefined) && <small className="route-unset">施工条件が未設定</small>}
      </div>
    })}
    <button type="button" className="route-add" aria-label="線要素を追加" disabled={routes.length >= 11} onClick={() => { setSets(false); setPicker(v => !v) }} aria-expanded={picker}>＋ 線要素を追加</button>
    {picker && <LinePicker store={store} annotation={a} onClose={closePicker} />}
    {a.vertices!.length >= 3 && <div className="route-split">
      {!splitting ? <button type="button" onClick={() => { setSplitting(true); store.setHighlightedVertex({ annotationId: a.id, vertexIndex: vertex }) }}>経路を分ける</button> : <>
        <label>分ける頂点<select aria-label="分ける頂点" value={vertex} onChange={event => { const v = Number(event.currentTarget.value); setVertex(v); store.setHighlightedVertex({ annotationId: a.id, vertexIndex: v }) }}>{a.vertices!.slice(1, -1).map((_, i) => <option key={i + 1} value={i + 1}>頂点{i + 2}</option>)}</select></label>
        <button type="button" onClick={() => { store.splitRoute(a.id, vertex); setSplitting(false) }}>分ける</button><button type="button" onClick={() => { setSplitting(false); store.setHighlightedVertex(null) }}>やめる</button>
      </>}
    </div>}
    <div className="route-status" role="status">{feedback.routeId === a.id ? feedback.message : ''}</div>
  </section>
}


export function addRouteCandidate(store: AnnotationStore, ids: readonly string[], itemId: string, part: RoutePart, value: string, riseIndex?: number): string | undefined {
  return store.addConditionAndSetRoute(itemId, value, ids, itemId, part, riseIndex)
}
export function addQuantityCandidate(store: AnnotationStore, ids: readonly string[], itemId: string, value: string): string | undefined {
  return store.addConditionAndSetQuantity(itemId, value, ids)
}

function RouteCount({ value, code, commit }: { value: number; code: string; commit(n: number): void }) {
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
  const currentItems = routeEntries(a).flatMap(e => { const f = store.getCountFixture(e.itemId); return f ? [{ code: f.code, spec: f.spec, name: f.name, category: f.category, count: e.count, cond: e.cond }] : [] })
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
      <button type="button" aria-label={set.name} title={routeSetSummary(set)} onClick={() => { try { const result = resolveRouteSet(set, store.getCountFixtures()); store.addFixturesAndSetRouteItems(result.newFixtures, a.id, result.items); announceRoute(store, a.id, null, '構成「' + set.name + '」にしました'); onClose() } catch (reason) { setError(String(reason)) } }}><strong>{set.name}</strong><small>{routeSetSummary(set)}</small></button>
      {renaming === set.id ? <form onSubmit={e => { e.preventDefault(); if (rename.trim()) { write(sets.map(s => s.id === set.id ? { ...s, name: rename.trim() } : s)); setRenaming(null) } }}><input aria-label="構成の新しい名前" maxLength={40} value={rename} onChange={e => setRename(e.currentTarget.value)} /><button disabled={!rename.trim()}>保存</button></form> : <button type="button" aria-label={set.name + 'の名前を変える'} onClick={() => { setRenaming(set.id); setRename(set.name) }}>名前を変える</button>}
      <button type="button" aria-label={set.name + 'を削除'} onClick={() => write(sets.filter(s => s.id !== set.id))}>削除</button>
    </div>)}
    <form onSubmit={e => { e.preventDefault(); if (sets.length < 50 && name.trim()) { write([...sets, { id: crypto.randomUUID(), name: name.trim(), items: currentItems }]) } }}>
      <label>この経路の構成を登録<input aria-label="構成の名前" value={name} maxLength={40} onChange={e => setName(e.currentTarget.value)} /></label><button disabled={sets.length >= 50 || !name.trim()}>登録</button>
      {sets.length >= 50 && <small>これ以上登録できません（最大 50 件）</small>}
    </form>{error && <p role="alert">{error}</p>}
  </div>
}
