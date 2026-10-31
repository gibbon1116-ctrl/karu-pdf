import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { countHex, fixtureLabelCode, quantityUnit } from '../core/countFixtures'
import type { CountComponent } from '../core/counts'
import { isPerEquipmentComponent } from '../core/perEquipment'
import type { AnnotationStore, EditableAnnotation } from '../editor/AnnotationStore'
import { QuantitySwatch } from '../editor/countMarkers'
import ComponentPicker from './ComponentPicker'
import { ConditionSelect } from './RouteItems'

export function CountItems({ annotation, store }: {
  annotation: EditableAnnotation
  store: AnnotationStore
}) {
  useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [picker, setPicker] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const closePicker = useCallback(() => setPicker(false), [])
  const added = useCallback((code: string) => {
    setError('')
    setStatus(`${code} を足しました（1個）`)
  }, [])

  const a = store.get(annotation.id)
  const main = store.fixtureForCount(a?.count)
  if (!a?.count || a.quantity || !main) return null

  const extra = a.count.version === 2 ? a.count.extra ?? [] : []
  const mainCode = fixtureLabelCode(main)
  const relatedIds = store.countMarkIdsOf(main.id)
  const full = extra.length >= 10

  const commit = (operation: () => string | undefined): boolean => {
    try {
      const reason = operation()
      setError(reason ?? '')
      if (reason) { setStatus(''); return false }
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setStatus('')
      return false
    }
  }

  const change = (
    itemId: string,
    update: (component: CountComponent) => CountComponent,
  ) => {
    const current = store.get(a.id)
    if (!current?.count || current.quantity || current.count.version !== 2
      || !current.count.extra?.some(e => e.itemId === itemId)) return
    commit(() => store.setCountComponents(
      [a.id],
      current.count!.version === 2
        ? (current.count!.extra ?? []).map(e => e.itemId === itemId ? update(e) : e)
        : [],
    ))
  }

  const remove = (itemId: string, code: string) => {
    const current = store.get(a.id)
    if (!current?.count || current.quantity || current.count.version !== 2
      || !current.count.extra?.some(e => e.itemId === itemId)) return
    const next = current.count.extra.filter(e => e.itemId !== itemId)
    if (commit(() => store.setCountComponents([a.id], next))) {
      setStatus(`${code} を外しました（Ctrl+Z で戻せます）`)
    }
  }

  return <section className="count-items route-items" aria-label="構成要素">
    <div className="route-heading">
      <strong>構成要素</strong><span>{extra.length + 1}種類</span>
    </div>
    <div className="route-item route-item-main" style={{ borderLeftColor: countHex(main.style.color) }}>
      <div className="route-item-heading">
        <span className="route-role" style={{ background: countHex(main.style.color), color: 'white' }}>主</span>
        <QuantitySwatch fixture={main} />
        <span className="route-item-identity" title={mainCode + ' ' + main.name}>
          <strong>{mainCode}</strong><small title={main.name}>{main.name}</small>
        </span>
      </div>
    </div>
    {extra.map(component => {
      const f = store.getCountFixture(component.itemId)
      const code = f ? fixtureLabelCode(f) : component.itemId
      return <div className="route-item" key={a.id + ':' + component.itemId}>
        <div className="route-item-heading">
          <span className="route-role">追加</span>
          {f && <QuantitySwatch fixture={f} />}
          <span className="route-item-identity" title={code + (f ? ' ' + f.name : '')}>
            <strong>{code}</strong>{f && <small title={f.name}>{f.name}</small>}
          </span>
          <button type="button" aria-label={code + 'を外す'} title="外す"
            onClick={() => remove(component.itemId, code)}>×</button>
        </div>
        {f && <>
          {isPerEquipmentComponent(f) && <button type="button"
            aria-label={`${f.name}を${main.name}の項目に分ける`}
            onClick={() => {
              if (commit(() => store.splitPerEquipmentComponent(main.id, f.id))) {
                setStatus(`${f.name}を${main.name}の項目に分けました（Ctrl+Z で戻せます）`)
              }
            }}>機器ごとに分ける</button>}
          <div className="route-item-values">
            <ComponentCount value={component.count} code={code} commit={count => {
              change(component.itemId, current => ({ ...current, count }))
            }} />
            <span>{quantityUnit(f)}</span>
          </div>
          <ConditionSelect fixture={f} label={code + 'の施工条件'} value={component.condition}
            commit={condition => change(component.itemId, current => {
              const next = { ...current }
              if (condition === undefined || condition === null) delete next.condition
              else next.condition = condition
              return next
            })}
            add={condition => {
              let reason: string | undefined
              commit(() => {
                reason = store.addConditionAndSetCountComponent(component.itemId, condition, [a.id])
                return reason
              })
              return reason
            }} />
        </>}
      </div>
    })}
    <button type="button" className="route-add" aria-label="構成要素を追加"
      aria-expanded={picker} disabled={full}
      title={full ? 'これ以上足せません（最大 10 項目）' : undefined}
      onClick={() => { setError(''); setPicker(value => !value) }}>＋ 構成要素を追加</button>
    {picker && <ComponentPicker store={store} annotation={a} onClose={closePicker} onAdded={added} />}
    <button type="button" className="count-apply" disabled={relatedIds.length <= 1} onClick={() => {
      const current = store.get(a.id)
      const fixture = store.fixtureForCount(current?.count)
      if (!current?.count || current.quantity || !fixture) return
      const ids = store.countMarkIdsOf(fixture.id)
      if (ids.length <= 1) return
      const components = current.count.version === 2 ? current.count.extra ?? [] : []
      if (commit(() => store.setCountComponents(ids, components))) {
        setStatus(`${ids.length} 個の印を同じ構成にしました（Ctrl+Z で戻せます）`)
      }
    }}>同じ項目の印すべてにこの構成を反映（{relatedIds.length} 個）</button>
    {error && <p role="alert">{error}</p>}
    <div className="route-status" role="status">{status}</div>
  </section>
}

function ComponentCount({ value, code, commit }: {
  value: number
  code: string
  commit(count: number): void
}) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (input.current) input.current.value = String(value) }, [value])
  useEffect(() => {
    const element = input.current
    const prevent = (event: WheelEvent) => event.preventDefault()
    element?.addEventListener('wheel', prevent, { passive: false })
    return () => element?.removeEventListener('wheel', prevent)
  }, [])

  return <span className="route-count">
    <button type="button" aria-label={code + 'の個数を減らす'} disabled={value <= 1}
      onClick={() => commit(value - 1)}>−</button>
    <input ref={input} aria-label={code + 'の個数'} type="number" min="1" max="99" step="1"
      defaultValue={value} onBlur={event => {
        const count = Number(event.currentTarget.value)
        if (event.currentTarget.value !== '' && Number.isInteger(count) && count >= 1 && count <= 99) {
          if (count !== value) commit(count)
        } else event.currentTarget.value = String(value)
      }} onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault()
          event.stopPropagation()
          event.currentTarget.blur()
        }
      }} />
    <button type="button" aria-label={code + 'の個数を増やす'} disabled={value >= 99}
      onClick={() => commit(value + 1)}>+</button>
  </span>
}
