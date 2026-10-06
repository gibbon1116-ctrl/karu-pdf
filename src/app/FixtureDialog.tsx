import { useContext, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { fixtureCode, quantityAggregation, COUNT_COLORS, COUNT_FILLS, COUNT_SHAPES, COUNT_SIZES, COUNT_OPACITIES, countHex, countRgb, nextCountStyle, nextQuantityLineStyle, sameFixtureAppearance, quantityKind, quantityMethod, QUANTITY_METHODS, quantityLine, QUANTITY_LINE_WIDTHS, QUANTITY_DASHES, type QuantityKind, type QuantityLineAppearance, type QuantityLineStyle, serializeCountFixtures, type CountFixture, type CountStyle } from '../core/countFixtures'
import { quantityDimensions, quantityLabel, QUANTITY_DIMENSIONS, type QuantityMark } from '../core/quantity'
import { FixtureSampleContext } from '../editor/AnnotationLayer'
import { CountMarker, QuantitySwatch } from '../editor/countMarkers'
import { groupFixtures } from './fixtureOrder'

// Shared across add/duplicate/edit mounts, and reset when the app reloads.
let fixtureDialogPosition = { x: 0, y: 0 }

export default function FixtureDialog({ initial, fixtures, editing, duplicate = false, hasMarks = false, onSave, onClose }: { initial: CountFixture; fixtures: readonly CountFixture[]; editing: boolean; duplicate?: boolean; hasMarks?: boolean; onSave(fixture: CountFixture): void; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null), [value, setValue] = useState(initial), [error, setError] = useState('')
  const specInput = useRef<HTMLInputElement>(null), aggregationTouched = useRef(editing)
  const categories = useMemo(() => {
    const result = groupFixtures(fixtures).map(g => g.category)
    if ((fixtures.length || editing) && !result.includes(initial.category)) result.push(initial.category)
    return result
  }, [fixtures, initial.category, editing])
  const [newCategory, setNewCategory] = useState(!fixtures.length && !editing)
  const heading = useRef<HTMLHeadingElement>(null)
  const position = useRef({ ...fixtureDialogPosition })
  const drag = useRef<{ pointerId: number; x: number; y: number; startX: number; startY: number } | null>(null)
  const move = (x: number, y: number) => {
    if (!dialog.current?.open || !heading.current) return
    const rect = heading.current.getBoundingClientRect()
    const left = rect.left - position.current.x, right = rect.right - position.current.x
    const top = rect.top - position.current.y, bottom = rect.bottom - position.current.y
    const visibleWidth = Math.min(80, rect.width, window.innerWidth)
    const minX = visibleWidth - right, maxX = window.innerWidth - visibleWidth - left
    const minY = -top, maxY = Math.max(minY, window.innerHeight - bottom)
    position.current = { x: Math.max(minX, Math.min(maxX, x)), y: Math.max(minY, Math.min(maxY, y)) }
    fixtureDialogPosition = { ...position.current }
    dialog.current.style.translate = `${position.current.x}px ${position.current.y}px`
  }
  const endDrag = (event: PointerEvent<HTMLHeadingElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const sampleInteraction = useContext(FixtureSampleContext)
  const alive = useRef(false), capturing = useRef(false), suggestions = useRef<CountStyle[]>([])
  const lineSuggestions = useRef<QuantityLineAppearance[]>([])
  const cancelCapture = useRef(sampleInteraction?.cancel)
  cancelCapture.current = sampleInteraction?.cancel
  useEffect(() => {
    alive.current = true; dialog.current?.showModal(); if (duplicate) { specInput.current?.focus(); specInput.current?.select() }
    const constrain = () => move(position.current.x, position.current.y)
    constrain()
    window.addEventListener('resize', constrain)
    // Recentered layout can change when a captured sample or an error appears.
    const observer = new ResizeObserver(constrain)
    if (dialog.current) observer.observe(dialog.current)
    return () => {
      alive.current = false; drag.current = null
      window.removeEventListener('resize', constrain); observer.disconnect()
      if (capturing.current) cancelCapture.current?.()
    }
  }, [])
  const capture = async () => {
    if (!sampleInteraction || capturing.current) return
    capturing.current = true; setError(''); dialog.current?.close()
    try {
      const sample = await sampleInteraction.request()
      if (sample && alive.current) setValue(v => ({ ...v, sample }))
    } catch (reason) { if (alive.current) setError(String(reason)) }
    finally {
      capturing.current = false
      if (alive.current) { dialog.current?.showModal(); move(position.current.x, position.current.y) }
    }
  }
  const style = (changes: Partial<CountStyle>) => setValue(v => ({ ...v, style: { ...v.style, ...changes } }))
  const length = quantityKind(value) !== 'count'
  const line = (changes: Partial<QuantityLineStyle>) => setValue(v => ({ ...v, line: { ...quantityLine(v), ...changes } }))
  const changeKind = (kind: QuantityKind) => {
    try {
      const appearance = kind !== 'count' && !editing ? nextQuantityLineStyle(fixtures) : undefined
      setValue(v => ({ ...v, aggregation: aggregationTouched.current ? quantityAggregation(v) : kind === 'count' ? 'location' : 'document', kind: kind === 'count' ? undefined : kind, method: undefined, style: appearance ? { ...v.style, color: appearance.color } : v.style, line: kind !== 'count' ? appearance?.line ?? { width: 1.5, dash: 'solid' } : undefined, defaults: kind !== 'count' ? {} : undefined }))
      setError('')
    } catch (reason) { setError(String(reason)) }
  }
  const collisions = fixtures.filter(f => f.id !== value.id && sameFixtureAppearance(f, value))
  const shapeNames = ['丸', '二重丸', '四角', '角丸四角', '三角', '逆三角', 'ひし形', '五角形', '六角形', '八角形', '星', '十字', 'バツ', '砂時計']
  const fillNames = ['塗りなし', '塗りつぶし', '半分塗り', '中心に点', '斜線']
  return <dialog ref={dialog} className="fixture-dialog fixture-editor-dialog" style={{ translate: `${position.current.x}px ${position.current.y}px` }} aria-label={editing ? '項目を編集' : '項目を追加'} onCancel={onClose}>
    <form onSubmit={event => {
      event.preventDefault()
      try {
        const f = { ...value, aggregation: quantityAggregation(value), spec: value.spec?.trim() || undefined, name: value.name.trim(), category: categories.find(c => c.trim() === value.category.trim()) ?? value.category.trim() }
        serializeCountFixtures(editing ? fixtures.map(p => p.id === f.id ? f : p) : [...fixtures, f])
        onSave(f)
      } catch (reason) { setError(String(reason)) }
    }}>
      <h2 ref={heading} className="fixture-drag-handle" title="ドラッグして移動できます" onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: position.current.x, startY: position.current.y }
      }} onPointerMove={event => {
        const active = drag.current
        if (active?.pointerId === event.pointerId) move(active.startX + event.clientX - active.x, active.startY + event.clientY - active.y)
      }} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={() => { drag.current = null }}>
        <span aria-hidden="true">⠿</span>{editing ? '項目を編集' : '項目を追加'}
      </h2>
      <div className="fixture-dialog-body">
      <div className="fixture-dialog-details">
      <fieldset><legend>種別</legend>{(['count', 'length', 'area', 'volume'] as const).map(kind => <label key={kind}><input type="radio" name="quantity-kind" value={kind} checked={quantityKind(value) === kind} disabled={hasMarks} onChange={() => changeKind(kind)} />{{ count: '個数', length: '長さ', area: '面積', volume: '体積' }[kind]}</label>)}</fieldset>
      {['area', 'volume'].includes(quantityKind(value)) && <fieldset><legend>拾い方</legend>{QUANTITY_METHODS[quantityKind(value)].map(method => <label key={method}><input type="radio" name="quantity-method" checked={quantityMethod(value) === method} disabled={hasMarks} onChange={() => setValue(v => ({ ...v, method, defaults: {} }))} />{{ polygon: '囲む', lengthHeight: '長さ×高さ', polygonDepth: '囲む×深さ', lengthWidthDepth: '長さ×幅×深さ', click: '', polyline: '' }[method]}</label>)}</fieldset>}
      {hasMarks && <p>拾いがあるため種別は変えられません</p>}
      <label>名称<input required maxLength={80} value={value.name} onChange={e => setValue({ ...value, name: e.currentTarget.value })} /></label>
      <label>略号<input maxLength={16} value={value.code} onChange={e => setValue({ ...value, code: e.currentTarget.value })} /></label>
      <label>規格<input ref={specInput} maxLength={40} value={value.spec ?? ''} onChange={e => setValue({ ...value, spec: e.currentTarget.value })} /></label>
      <fieldset><legend>集計方式</legend>{(['location', 'document'] as const).map(aggregation => <label key={aggregation}><input type="radio" name="quantity-aggregation" checked={quantityAggregation(value) === aggregation} onChange={() => { aggregationTouched.current = true; setValue({ ...value, aggregation }) }} />{aggregation === 'location' ? '場所別（階・部屋ごと）' : '全図面の合計'}</label>)}</fieldset>
      <label>分類<select aria-label="分類" value={newCategory ? '' : value.category} onChange={e => { const category = e.currentTarget.value; setNewCategory(category === ''); setValue({ ...value, category }) }}>
        {categories.map(c => <option key={c} value={c}>{c}</option>)}
        <option value="">＋ 新しい分類…</option>
      </select></label>
      {newCategory && <label>新しい分類の名前<input aria-label="新しい分類の名前" required maxLength={40} value={value.category} onChange={e => setValue({ ...value, category: e.currentTarget.value })} /></label>}
      <div className="fixture-fields"><label>{length ? '文字の大きさ' : '大きさ'}<select value={value.style.size} onChange={e => style({ size: Number(e.currentTarget.value) })}>{COUNT_SIZES.map(n => <option key={n} value={n}>{n} pt</option>)}</select></label>
        <label>透明度<select value={value.style.opacity} onChange={e => style({ opacity: Number(e.currentTarget.value) })}>{COUNT_OPACITIES.map(n => <option key={n} value={n}>{Math.round(n * 100)}%</option>)}</select></label></div>
      <label><input type="checkbox" checked={value.style.showCode} onChange={e => style({ showCode: e.currentTarget.checked })} />略号を図面に表示</label>
      <label>メモ<textarea maxLength={200} value={value.memo ?? ''} onChange={e => setValue({ ...value, memo: e.currentTarget.value })} /></label>
      {length ? <div className="quantity-preview"><QuantitySwatch fixture={value} preview /><span>{quantityLabel(quantityMethod(value) === 'polygon' || quantityMethod(value) === 'polygonDepth' ? [[0, 0], [8, 0], [8, 6], [0, 6]] : [[0, 0], [quantityMethod(value) === 'polyline' ? 9.35 : 24, 0]], 1000, { version: 1, id: 'preview', itemId: value.id, method: quantityMethod(value) as QuantityMark['method'], ...value.defaults }, fixtureCode(value), value.style.showCode)}</span></div> : <svg className="fixture-preview" viewBox={`-18 -24 ${Math.max(80, 40 + value.style.size * (1 + .7 * fixtureCode(value).length))} 50`} aria-label="印の見本"><CountMarker style={value.style} code={fixtureCode(value)} /></svg>}
      {!length && <div className="fixture-sample-editor">
        {value.sample && <img className="fixture-sample-preview" src={`data:image/png;base64,${value.sample.png}`} width={value.sample.width} height={value.sample.height} alt="図面から切り取った見本" />}
        <div className="fixture-fields"><button type="button" disabled={!sampleInteraction} onClick={() => void capture()}>図面から見本を切り取る</button>
          <button type="button" disabled={!value.sample} onClick={() => setValue(v => ({ ...v, sample: undefined }))}>見本を外す</button></div>
      </div>
      }
      {quantityMethod(value) === 'polyline' && <label>立上り・立下りの加算（新しく拾うときの初期値）<input type="number" min="0" max="1000" step="0.01" value={value.defaults?.addM ?? 0} onChange={e => { const addM = Number(e.currentTarget.value); setValue(v => ({ ...v, defaults: { ...v.defaults, addM } })) }} /> m</label>}
      {quantityDimensions(quantityMethod(value)).map(key => <label key={key}>{QUANTITY_DIMENSIONS[key]}（新しく拾うときの初期値）<span className="quantity-input-unit"><input aria-label={QUANTITY_DIMENSIONS[key] + '（新しく拾うときの初期値）'} type="number" min="0" max="1000" step="0.01" value={value.defaults?.[key] ?? ''} onChange={e => { const text = e.currentTarget.value; setValue(v => ({ ...v, defaults: { ...v.defaults, [key]: text === '' ? undefined : Number(text) } })) }} />m</span></label>)}
      {quantityDimensions(quantityMethod(value)).length > 0 && <p>空欄または0なら、拾うときに寸法を入力します。</p>}
      {!!collisions.length && <p role="status">同じ見た目の項目があります: {collisions.map(f => `${fixtureCode(f)} ${f.name}`.trim()).join('、')}</p>}
      {error && <p role="alert">{error}</p>}
      </div>
      <div className="fixture-dialog-appearance">
      <button type="button" onClick={() => {
        try {
          if (length) {
            const current = { color: value.style.color, line: quantityLine(value) }
            const proposed = nextQuantityLineStyle(fixtures.filter(f => f.id !== value.id), [...lineSuggestions.current, current, ...(editing && quantityKind(initial) !== 'count' ? [{ color: initial.style.color, line: quantityLine(initial) }] : [])])
            lineSuggestions.current.push(current, proposed)
            setValue(v => ({ ...v, style: { ...v.style, color: proposed.color }, line: proposed.line }))
          } else {
            const proposed = nextCountStyle(fixtures, [...suggestions.current, value.style, ...(editing ? [initial.style] : [])])
            suggestions.current.push(value.style, proposed)
            style({ shape: proposed.shape, fill: proposed.fill, color: proposed.color })
          }
          setError('')
        } catch (reason) { setError(String(reason)) }
      }}>別の組合せを提案</button>
      {!length && <>
      <fieldset><legend>形</legend><div className="fixture-shapes">{COUNT_SHAPES.map((shape, i) => <button type="button" key={shape} title={shapeNames[i]} aria-label={`形 ${shapeNames[i]}`} aria-pressed={value.style.shape === shape} onClick={() => style({ shape })}>
        <svg viewBox="-14 -14 28 28" aria-hidden="true"><CountMarker style={{ ...value.style, shape, fill: 'none', size: 20, opacity: 1, showCode: false }} /></svg>
      </button>)}</div></fieldset>
      <fieldset><legend>塗り</legend><div className="fixture-shapes fixture-fills">{COUNT_FILLS.map((fill, i) => <button type="button" key={fill} title={fillNames[i]} aria-label={`塗り ${fillNames[i]}`} aria-pressed={value.style.fill === fill} onClick={() => style({ fill })}>
        <svg viewBox="-14 -14 28 28" aria-hidden="true"><CountMarker style={{ ...value.style, fill, size: 20, opacity: 1, showCode: false }} /></svg>
      </button>)}</div></fieldset>
      </>}
      {length && <><fieldset><legend>線の種類</legend><div className="fixture-shapes">{QUANTITY_DASHES.map((dash, i) => <button key={dash} type="button" aria-label={['実線', '破線', '一点鎖線', '点線'][i]} aria-pressed={quantityLine(value).dash === dash} onClick={() => line({ dash })}><QuantitySwatch fixture={{ ...value, line: { ...quantityLine(value), dash } }} /></button>)}</div></fieldset>
      <label>線の太さ<select aria-label="線の太さ" value={quantityLine(value).width} onChange={e => line({ width: Number(e.currentTarget.value) as QuantityLineStyle['width'] })}>{QUANTITY_LINE_WIDTHS.map(n => <option key={n} value={n}>{n} pt</option>)}</select></label></>}
      <fieldset><legend>色</legend><div className="fixture-colors">{COUNT_COLORS.map(hex => <button type="button" key={hex} aria-label={`色 ${hex}`} title={hex} aria-pressed={countHex(value.style.color) === hex} style={{ backgroundColor: hex }} onClick={() => style({ color: countRgb(hex) })} />)}</div>
        <label>任意の色<input type="color" value={countHex(value.style.color)} onChange={e => style({ color: countRgb(e.currentTarget.value) })} /></label>
      </fieldset>
      </div>
      </div>
      <div className="dialog-actions"><button type="button" onClick={onClose}>閉じる</button><button disabled={!value.category.trim()} type="submit">{editing ? '変更する' : '追加する'}</button></div>
    </form>
  </dialog>
}
