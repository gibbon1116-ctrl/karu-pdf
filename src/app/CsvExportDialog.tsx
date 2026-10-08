import { useContext, useEffect, useRef, useState } from 'react'
import { QuantityNavigationContext } from './QuantityBreakdown'
import type { QuantityIndex } from '../core/quantityIndex'
import { createQuantityCsv, quantityCsvFileName, type QuantityCsvType } from './annotationCsv'
import type { EditableAnnotation } from '../editor/AnnotationStore'
import type { CountFixture } from '../core/countFixtures'
import { CSV_KINDS, CSV_KIND_LABELS, csvAnnotations, createCsv, annotationCsvFileName, issueCsvFileName, type CsvKind, type CsvOptions } from './annotationCsv'

export default function CsvExportDialog({ annotations, fixtures, pdfName, pageCount, initialKinds, firstPage, lastPage, initialStatus, onExport, onClose }: {
  fixtures?: readonly CountFixture[]
  annotations: readonly EditableAnnotation[]; pdfName: string; pageCount: number; initialKinds: readonly CsvKind[]
  firstPage: number; lastPage: number; initialStatus: CsvOptions['issueStatus']
  onExport(csv: string, fileName: string): Promise<void>; onClose(): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const navigation = useContext(QuantityNavigationContext)
  const [kinds, setKinds] = useState<readonly CsvKind[]>(initialKinds)
  const [start, setStart] = useState(firstPage), [end, setEnd] = useState(lastPage)
  const [status, setStatus] = useState(initialStatus ?? 'all')
  const [saving, setSaving] = useState(false), [error, setError] = useState('')
  useEffect(() => { dialog.current?.showModal() }, [])
  const validRange = Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end <= pageCount && start <= end
  const options: CsvOptions = { firstPage: start, lastPage: end, issueStatus: status, fixtures, drawingInfo: navigation?.drawingInfo }
  const count = validRange ? csvAnnotations(annotations, kinds, options).length : 0
  const reason = !kinds.length ? '書き出す種類を選んでください。' : !validRange ? 'ページ範囲を正しく指定してください。' : !count ? '指定した種類・ページ範囲・状態に対象がありません。' : ''
  return <dialog ref={dialog} className="csv-export-dialog" aria-labelledby="csv-export-title" onCancel={onClose}>
    <h2 id="csv-export-title">CSV に書き出す</h2>
    <fieldset><legend>書き出す種類（複数選択）</legend>
      {CSV_KINDS.map(kind => <label key={kind}><input type="checkbox" checked={kinds.includes(kind)} onChange={event => {
        const checked = event.currentTarget.checked
        setKinds(current => checked ? [...current, kind] : current.filter(value => value !== kind))
      }} />{CSV_KIND_LABELS[kind]}</label>)}
      <button type="button" onClick={() => setKinds(CSV_KINDS)}>すべて選ぶ</button>
      <button type="button" onClick={() => setKinds([])}>すべて外す</button>
    </fieldset>
    <fieldset><legend>ページ範囲</legend>
      <label>開始ページ<input aria-label="CSVの開始ページ" type="number" min={1} max={pageCount} value={start} onChange={event => setStart(Number(event.currentTarget.value))} /></label>
      <label>終了ページ<input aria-label="CSVの終了ページ" type="number" min={1} max={pageCount} value={end} onChange={event => setEnd(Number(event.currentTarget.value))} /></label>
    </fieldset>
    {kinds.includes('issue') && <label>指摘の状態<select aria-label="CSVの指摘の状態" value={status} onChange={event => setStatus(event.currentTarget.value as typeof status)}>
      <option value="all">すべて</option><option value="open">未確認だけ（未回答・回答済み）</option><option value="confirmed">修正確認だけ</option>
    </select></label>}
    <p role="status">{reason || `${count}件を書き出します。`}</p>
    {error && <p role="alert">{error}</p>}
    <div className="dialog-actions"><button type="button" onClick={onClose}>閉じる</button>
      <button type="button" disabled={!!reason || saving} onClick={() => {
        setSaving(true); setError('')
        void onExport(createCsv(annotations, kinds, options), kinds.length === 1 && kinds[0] === 'issue' ? issueCsvFileName(pdfName) : annotationCsvFileName(pdfName))
          .then(onClose).catch(reason => setError(String(reason))).finally(() => setSaving(false))
      }}>書き出す</button>
    </div>
  </dialog>
}

export function QuantityCsvExportDialog({ index, fixtures, pdfName, pageIndex, onExport, onClose }: {
  index: QuantityIndex; fixtures: readonly CountFixture[]; pdfName: string; pageIndex: number
  onExport(csv: string, fileName: string): Promise<void>; onClose(): void
}) {
  const dialog = useRef<HTMLDialogElement>(null), navigation = useContext(QuantityNavigationContext)
  const [type, setType] = useState<QuantityCsvType>('summary')
  const [saving, setSaving] = useState(false), [error, setError] = useState('')
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="csv-export-dialog" aria-label="数量をCSVに書き出す" onCancel={onClose}>
    <h2>数量をCSVに書き出す</h2>
    <fieldset><legend>書き出す種類</legend>
      <label><input type="radio" name="quantity-csv" checked={type === 'summary'} onChange={() => setType('summary')} />集計（項目・施工条件ごとの全図面の合計）</label>
      <label><input type="radio" name="quantity-csv" checked={type === 'detail'} onChange={() => setType('detail')} />明細（項目・施工条件・区間・ページ・場所ごと）</label>
    </fieldset>
    <p>集計には「施工条件」「集計区分」「平面」「立上り・立下り」「その他の加算」、明細には「施工条件」「区間」の列が加わります。条件が複数ある項目は材料計も出します。集計の合計は「施工条件別」の行を足して確かめてください（材料計を重ねて足すと二重になります）。</p>
    <p>長さ・面積・体積は従来どおり小数2桁で書き出します。行ごとに丸めるため、端数のある数量では明細や条件別の行を足した値と材料全体の合計に丸め差が出る場合があります。</p>
    {error && <p role="alert">{error}</p>}
    <div className="dialog-actions"><button disabled={saving} onClick={onClose}>閉じる</button><button disabled={saving} onClick={() => {
      setSaving(true); setError('')
      void onExport(createQuantityCsv(index, fixtures, pageIndex, type, navigation?.drawingInfo), quantityCsvFileName(pdfName, type))
        .then(onClose).catch(e => { if (!(e instanceof DOMException && e.name === 'AbortError')) setError(String(e)) }).finally(() => setSaving(false))
    }}>書き出す</button></div>
  </dialog>
}
