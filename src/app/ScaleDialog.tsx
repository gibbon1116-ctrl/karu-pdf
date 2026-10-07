import { useEffect, useRef, useState } from 'react'
import { calibratedScale, ratioScale, scaleLabel, SCALE_CHOICES, SCALE_PRESETS, type PageScale, type Paper, type ScaleRegion } from '../core/measure'
import type { Point } from '../core/annotations'
import type { PageSize } from '../core/mupdfDoc'

interface Props {
  pageIndex: number
  size: PageSize
  initial: PageScale | null
  region?: ScaleRegion
  regions?: ScaleRegion[]
  onEditRegion?(region: ScaleRegion): void
  countRegionMeasurements?(region: ScaleRegion): Promise<number>
  onDeleteRegion?(region: ScaleRegion, recalculate: boolean): void
  required: boolean
  tracing: boolean
  points: Point[] | null
  onTrace(): void
  onClose(): void
  countMeasurements(all: boolean): Promise<number>
  onSave(scale: PageScale, all: boolean, recalculate: boolean, label?: string): void
}
export function ScaleDialog(props: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [mode, setMode] = useState(props.initial?.source === 'calibration' ? 'calibration' : 'ratio')
  const [ratio, setRatio] = useState(String(props.initial?.denominator ?? 100))
  const [preset, setPreset] = useState(() => SCALE_CHOICES.includes(props.initial?.denominator ?? 100) ? String(props.initial?.denominator ?? 100) : 'custom')
  const [paper, setPaper] = useState<Paper>(props.initial?.paper ?? 'PDF')
  const [unit, setUnit] = useState<'mm' | 'm'>(props.initial?.unit ?? 'mm')
  const [decimals, setDecimals] = useState<number | null>(props.initial?.decimals ?? null)
  const [actual, setActual] = useState(String(props.initial?.calibration?.actualMm ?? 3600))
  const [all, setAll] = useState(false)
  const [label, setLabel] = useState(props.region?.label ?? '')
  const [pendingDelete, setPendingDelete] = useState<{ region: ScaleRegion; count: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<{ scale: PageScale; all: boolean; count: number } | null>(null)
  useEffect(() => {
    const d = dialogRef.current
    if (props.tracing) d?.close()
    else if (d && !d.open) d.showModal()
  }, [props.tracing])
  let scale: PageScale | null = null, validation = ''
  try {
    scale = mode === 'ratio' ? ratioScale(Number(ratio), paper, props.size, unit, decimals)
      : props.points ? calibratedScale(props.points, Number(actual), unit, decimals)
      : props.initial?.calibration ? calibratedScale([[0, 0], [props.initial.calibration.pointsLength, 0]], Number(actual), unit, decimals)
      : props.initial?.source === 'calibration' ? { ...props.initial, unit, decimals } : null
    if (!scale) validation = '図面の上で2点をなぞってください。'
    if ([...label].length > 40) validation = '範囲の名前は40文字までにしてください。'
  } catch (reason) { validation = reason instanceof Error ? reason.message : String(reason) }
  const apply = async () => {
    if (!scale) return
    setBusy(true); setError('')
    try {
      const count = await props.countMeasurements(all)
      if (count) setPending({ scale, all, count })
      else props.onSave(scale, all, false, label.trim() || undefined)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  return <>
    {props.tracing && <div className="scale-trace-banner" role="status">図面の上で2点をクリックしてください（Shift で角度をそろえる・Esc で戻る）</div>}
    <dialog ref={dialogRef} className="scale-dialog" aria-labelledby="scale-dialog-title" onCancel={event => { event.preventDefault(); props.onClose() }}>
      <h2 id="scale-dialog-title">{props.region ? '縮尺の範囲の設定' : '縮尺の設定'}（{props.pageIndex + 1} ページ）</h2>
      {props.required && <p>このページの縮尺を決めてください</p>}
      {pendingDelete ? <>
        <p>範囲を削除します。すでにある計測 {pendingDelete.count} 件も、削除後の縮尺で計算し直しますか</p>
        <p>削除後に使える縮尺がない計測は、今の値を保持します。</p>
        <div className="dialog-actions"><button type="button" onClick={() => { props.onDeleteRegion?.(pendingDelete.region, true); setPendingDelete(null) }}>計算し直す</button><button type="button" onClick={() => { props.onDeleteRegion?.(pendingDelete.region, false); setPendingDelete(null) }}>そのまま</button><button type="button" onClick={() => setPendingDelete(null)}>戻る</button></div>
      </> : pending ? <>
        <p>すでにある計測 {pending.count} 件も、新しい縮尺で計算し直しますか</p>
        <div className="dialog-actions"><button type="button" onClick={() => props.onSave(pending.scale, pending.all, true, label.trim() || undefined)}>計算し直す</button><button type="button" onClick={() => props.onSave(pending.scale, pending.all, false, label.trim() || undefined)}>そのまま</button><button type="button" onClick={() => setPending(null)}>戻る</button></div>
      </> : <>
        <fieldset disabled={busy}>
          <label><input type="radio" name="scale-mode" checked={mode === 'ratio'} onChange={() => setMode('ratio')} />縮尺を入力</label>
          <label>よく使う縮尺<select aria-label="よく使う縮尺" value={preset} onChange={event => {
            const value = event.currentTarget.value; setPreset(value)
            if (value !== 'custom') setRatio(value)
          }} disabled={mode !== 'ratio'}>
            {SCALE_PRESETS.map(group => <optgroup key={group.label} label={group.label}>{group.denominators.map(value => <option key={value} value={value}>1/{value}</option>)}</optgroup>)}
            <option value="custom">任意入力</option>
          </select></label>
          <label>縮尺 1 / <input aria-label="縮尺の分母" value={ratio} onChange={event => { setRatio(event.currentTarget.value); setPreset('custom') }} disabled={mode !== 'ratio'} inputMode="decimal" /></label>
          <label>原図の用紙<select aria-label="原図の用紙" value={paper} onChange={e => setPaper(e.currentTarget.value as Paper)} disabled={mode !== 'ratio'}><option value="PDF">このPDFの大きさのまま</option>{['A0', 'A1', 'A2', 'A3', 'A4'].map(p => <option key={p}>{p}</option>)}</select></label>
          <label><input type="radio" name="scale-mode" checked={mode === 'calibration'} onChange={() => setMode('calibration')} />図面の寸法をなぞって合わせる</label>
          <button type="button" disabled={mode !== 'calibration'} onClick={props.onTrace}>なぞる</button>
          <label>実際の長さ<input aria-label="実際の長さ" value={actual} inputMode="decimal" onChange={e => setActual(e.currentTarget.value)} disabled={mode !== 'calibration'} /> mm</label>
          {mode === 'calibration' && scale && <p data-testid="calibration-ratio">{scaleLabel(scale)} に相当</p>}
          <div className="scale-options"><label>単位<select aria-label="計測の単位" value={unit} onChange={e => setUnit(e.currentTarget.value as 'mm' | 'm')}><option>mm</option><option>m</option></select></label><label>小数<select aria-label="計測の小数" value={decimals ?? 'auto'} onChange={e => setDecimals(e.currentTarget.value === 'auto' ? null : Number(e.currentTarget.value))}><option value="auto">自動</option>{[0, 1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n} 桁</option>)}</select></label></div>
          {!props.region && <><label><input type="radio" name="scale-target" checked={!all} onChange={() => setAll(false)} />このページ</label>
          <label><input type="radio" name="scale-target" checked={all} onChange={() => setAll(true)} />同じ大きさのすべてのページ</label></>}
          {props.region && <label>範囲の名前（任意）<input aria-label="範囲の名前（任意）" value={label} onChange={event => setLabel(event.currentTarget.value)} /></label>}
        </fieldset>
        {!props.region && !!props.regions?.length && <section className="scale-region-list" aria-label="このページの縮尺の範囲">
          <h3>このページの縮尺の範囲</h3>
          {props.regions.map((region, index) => <div key={region.id} className="scale-region-row">
            <span>{region.label || `範囲 ${index + 1}`} {scaleLabel(region.scale)}</span>
            <button type="button" disabled={busy} onClick={() => props.onEditRegion?.(region)}>縮尺を変える</button>
            <button type="button" disabled={busy} onClick={async () => {
              setBusy(true); setError('')
              try { const count = await props.countRegionMeasurements?.(region) ?? 0; if (count) setPendingDelete({ region, count }); else props.onDeleteRegion?.(region, false) }
              catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
              finally { setBusy(false) }
            }}>削除</button>
          </div>)}
        </section>}
        {(validation || error) && <p role="alert">{error || validation}</p>}
        <div className="dialog-actions"><button type="button" disabled={busy} onClick={props.onClose}>キャンセル</button><button type="button" disabled={busy || !!validation} onClick={() => void apply()}>決定</button></div>
      </>}
    </dialog>
  </>
}
