import { useEffect, useRef, useState } from 'react'
import { COUNT_COLORS, COUNT_FILLS, COUNT_SHAPES, COUNT_SIZES, COUNT_OPACITIES, countHex, countRgb, sameCountAppearance, serializeCountFixtures, type CountFixture, type CountStyle } from '../core/countFixtures'
import { CountMarker } from '../editor/countMarkers'

export default function FixtureDialog({ initial, fixtures, editing, onSave, onClose }: { initial: CountFixture; fixtures: readonly CountFixture[]; editing: boolean; onSave(fixture: CountFixture): void; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null), [value, setValue] = useState(initial), [error, setError] = useState('')
  useEffect(() => { dialog.current?.showModal() }, [])
  const style = (changes: Partial<CountStyle>) => setValue(v => ({ ...v, style: { ...v.style, ...changes } }))
  const collisions = fixtures.filter(f => f.id !== value.id && sameCountAppearance(f.style, value.style))
  const shapeNames = ['丸', '二重丸', '四角', '角丸四角', '三角', '逆三角', 'ひし形', '五角形', '六角形', '八角形', '星', '十字', 'バツ', '砂時計']
  const fillNames = ['塗りなし', '塗りつぶし', '半分塗り', '中心に点', '斜線']
  return <dialog ref={dialog} className="fixture-dialog fixture-editor-dialog" aria-label={editing ? '器具を編集' : '器具を追加'} onCancel={onClose}>
    <form onSubmit={event => {
      event.preventDefault()
      try {
        const f = { ...value, name: value.name.trim(), category: value.category.trim() }
        serializeCountFixtures(editing ? fixtures.map(p => p.id === f.id ? f : p) : [...fixtures, f])
        onSave(f)
      } catch (reason) { setError(String(reason)) }
    }}>
      <h2>{editing ? '器具を編集' : '器具を追加'}</h2>
      <div className="fixture-dialog-body">
      <div className="fixture-dialog-details">
      <label>器具名称<input required maxLength={80} value={value.name} onChange={e => setValue({ ...value, name: e.currentTarget.value })} /></label>
      <label>略号<input maxLength={16} value={value.code} onChange={e => setValue({ ...value, code: e.currentTarget.value })} /></label>
      <label>分類<input required maxLength={40} list="fixture-categories" value={value.category} onChange={e => setValue({ ...value, category: e.currentTarget.value })} /></label>
      <datalist id="fixture-categories">{[...new Set(fixtures.map(f => f.category))].map(c => <option key={c} value={c} />)}</datalist>
      <div className="fixture-fields"><label>大きさ<select value={value.style.size} onChange={e => style({ size: Number(e.currentTarget.value) })}>{COUNT_SIZES.map(n => <option key={n} value={n}>{n} pt</option>)}</select></label>
        <label>透明度<select value={value.style.opacity} onChange={e => style({ opacity: Number(e.currentTarget.value) })}>{COUNT_OPACITIES.map(n => <option key={n} value={n}>{Math.round(n * 100)}%</option>)}</select></label></div>
      <label><input type="checkbox" checked={value.style.showCode} onChange={e => style({ showCode: e.currentTarget.checked })} />略号を印に表示</label>
      <label>メモ<textarea maxLength={200} value={value.memo ?? ''} onChange={e => setValue({ ...value, memo: e.currentTarget.value })} /></label>
      <svg className="fixture-preview" viewBox={`-18 -24 ${Math.max(80, 40 + value.style.size * (1 + .7 * value.code.length))} 50`} aria-label="印の見本"><CountMarker style={value.style} code={value.code} /></svg>
      {!!collisions.length && <p role="status">同じ見た目の器具があります: {collisions.map(f => `${f.code} ${f.name}`.trim()).join('、')}</p>}
      {error && <p role="alert">{error}</p>}
      </div>
      <div className="fixture-dialog-appearance">
      <fieldset><legend>形</legend><div className="fixture-shapes">{COUNT_SHAPES.map((shape, i) => <button type="button" key={shape} title={shapeNames[i]} aria-label={`形 ${shapeNames[i]}`} aria-pressed={value.style.shape === shape} onClick={() => style({ shape })}>
        <svg viewBox="-14 -14 28 28" aria-hidden="true"><CountMarker style={{ ...value.style, shape, fill: 'none', size: 20, opacity: 1, showCode: false }} /></svg>
      </button>)}</div></fieldset>
      <fieldset><legend>塗り</legend><div className="fixture-shapes fixture-fills">{COUNT_FILLS.map((fill, i) => <button type="button" key={fill} title={fillNames[i]} aria-label={`塗り ${fillNames[i]}`} aria-pressed={value.style.fill === fill} onClick={() => style({ fill })}>
        <svg viewBox="-14 -14 28 28" aria-hidden="true"><CountMarker style={{ ...value.style, fill, size: 20, opacity: 1, showCode: false }} /></svg>
      </button>)}</div></fieldset>
      <fieldset><legend>色</legend><div className="fixture-colors">{COUNT_COLORS.map(hex => <button type="button" key={hex} aria-label={`色 ${hex}`} title={hex} aria-pressed={countHex(value.style.color) === hex} style={{ backgroundColor: hex }} onClick={() => style({ color: countRgb(hex) })} />)}</div>
        <label>任意の色<input type="color" value={countHex(value.style.color)} onChange={e => style({ color: countRgb(e.currentTarget.value) })} /></label>
      </fieldset>
      </div>
      </div>
      <div className="dialog-actions"><button type="button" onClick={onClose}>閉じる</button><button type="submit">{editing ? '変更する' : '追加する'}</button></div>
    </form>
  </dialog>
}
