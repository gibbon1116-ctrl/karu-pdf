import { useEffect, useMemo, useRef, useState } from 'react'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import type { PageSize } from '../core/mupdfDoc'
import {
  composeHeaderFooterText,
  DEFAULT_HEADER_FOOTER_SETTINGS,
  formatHeaderFooterDate,
  hasHeaderFooterText,
  pageNumberMap,
  targetPages,
  type HeaderFooterField,
  type HeaderFooterSettings,
} from './headerFooterText'

const FIELDS: Array<{ key: HeaderFooterField; label: string }> = [
  { key: 'topLeft', label: '上 左' }, { key: 'topCenter', label: '上 中央' }, { key: 'topRight', label: '上 右' },
  { key: 'bottomLeft', label: '下 左' }, { key: 'bottomCenter', label: '下 中央' }, { key: 'bottomRight', label: '下 右' },
]
const COLORS = [
  ['黒', [0, 0, 0]], ['赤', [1, 0, 0]], ['青', [0, .25, 1]], ['緑', [0, .55, .1]],
  ['橙', [1, .45, 0]], ['紫', [.55, .1, .7]], ['黄', [1, .9, 0]], ['白', [1, 1, 1]],
] as const
const PAGE_PATTERNS = ['- {ページ} -', '{ページ}', '{ページ} / {総ページ}', 'P.{ページ}', '{ページ}ページ']

interface Props {
  open: boolean
  docId: string
  fileName: string
  pageSizes: readonly PageSize[]
  currentPage: number
  pool: PdfWorkerPool
  excludedAnnotations(pageIndex: number): number[]
  loadSettings(): Promise<HeaderFooterSettings | null>
  onApply(settings: HeaderFooterSettings, dateText: string): Promise<void>
  onRemove(): Promise<void>
  onClose(): void
}

export function HeaderFooterDialog(props: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const selectionRef = useRef({ start: 0, end: 0 })
  const inputRefs = useRef<Partial<Record<HeaderFooterField, HTMLInputElement>>>({})
  const [settings, setSettings] = useState<HeaderFooterSettings>(DEFAULT_HEADER_FOOTER_SETTINGS)
  const [activeField, setActiveField] = useState<HeaderFooterField>('bottomCenter')
  const [previewPage, setPreviewPage] = useState(0)
  const [hasSavedSettings, setHasSavedSettings] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (props.open && !dialog.open) dialog.showModal()
    if (!props.open && dialog.open) dialog.close()
  }, [props.open])

  useEffect(() => {
    if (!props.open) return
    let current = true
    setLoading(true); setBusy(false); setError(''); setPreviewPage(Math.max(0, Math.min(props.pageSizes.length - 1, props.currentPage - 1)))
    void props.loadSettings().then((saved) => {
      if (!current) return
      setSettings(saved ?? DEFAULT_HEADER_FOOTER_SETTINGS)
      setHasSavedSettings(Boolean(saved))
    }).catch((reason) => { if (current) setError(reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [props.open, props.docId])

  const parsed = useMemo(() => targetPages(settings, props.pageSizes.length), [settings, props.pageSizes.length])
  const validationError = parsed.error ?? (!hasHeaderFooterText(settings) ? '6つの欄のいずれかに文字を入力してください。' : '')
  const numbering = useMemo(() => pageNumberMap(settings, props.pageSizes.length), [settings, props.pageSizes.length])
  const previewNumber = numbering.numbers.get(previewPage)
  const dateText = formatHeaderFooterDate(new Date(), settings.dateFormat)
  const previewSize = props.pageSizes[previewPage]

  useEffect(() => {
    if (!props.open || !previewSize) return
    const scale = 512 / Math.max(previewSize.width, previewSize.height)
    const excluded = props.excludedAnnotations(previewPage)
    const draw = (source: CanvasImageSource) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const width = 'width' in source ? Number(source.width) : 0
      const height = 'height' in source ? Number(source.height) : 0
      if (!(width > 0 && height > 0)) return
      canvas.width = width; canvas.height = height
      canvas.getContext('2d', { alpha: false })?.drawImage(source, 0, 0)
    }
    const cached = document.querySelector<HTMLCanvasElement>(`[data-testid="thumbnail-${previewPage}"] canvas, .page-view[data-page-index="${previewPage}"] .preview-canvas`)
    if (cached?.width) { draw(cached); return }
    const task = props.pool.render({ docId: props.docId, pageIndex: previewPage, renderScale: scale, deviceRect: null, excludeAnnotObjNums: excluded, priority: 1 })
    void task.promise.then((result) => draw(result.bitmap)).catch(() => undefined)
    return () => { if (!task.isStarted()) props.pool.cancelJobs(props.docId, [task.jobId]) }
  }, [props.open, props.pool, props.docId, previewPage, previewSize])

  const update = <K extends keyof HeaderFooterSettings>(key: K, value: HeaderFooterSettings[K]) => setSettings((current) => ({ ...current, [key]: value }))
  const updateField = (field: HeaderFooterField, value: string) => setSettings((current) => ({ ...current, fields: { ...current.fields, [field]: value } }))
  const rememberSelection = (field: HeaderFooterField, input: HTMLInputElement) => {
    setActiveField(field)
    selectionRef.current = { start: input.selectionStart ?? input.value.length, end: input.selectionEnd ?? input.value.length }
  }
  const insert = (token: string) => {
    const value = settings.fields[activeField]
    const { start, end } = selectionRef.current
    updateField(activeField, value.slice(0, start) + token + value.slice(end))
    selectionRef.current = { start: start + token.length, end: start + token.length }
    requestAnimationFrame(() => { const input = inputRefs.current[activeField]; input?.focus(); input?.setSelectionRange(selectionRef.current.start, selectionRef.current.end) })
  }
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setBusy(false) }
  }

  const fieldPreview = (field: HeaderFooterField) => previewNumber === undefined ? '' : composeHeaderFooterText(settings.fields[field], {
    page: previewNumber, total: numbering.total, date: dateText, fileName: props.fileName,
  })
  const color = `rgb(${settings.color.map((value) => Math.round(value * 255)).join(' ')})`
  const marginX = previewSize ? settings.horizontalMarginMm / (previewSize.width * 25.4 / 72) * 100 : 0
  const marginY = previewSize ? settings.verticalMarginMm / (previewSize.height * 25.4 / 72) * 100 : 0

  return <dialog ref={dialogRef} className="header-footer-dialog" aria-labelledby="header-footer-title" onCancel={props.onClose} onClose={props.onClose}>
    <header><h1 id="header-footer-title">ページ番号・ヘッダー・フッター</h1><button type="button" disabled={busy} aria-label="閉じる" onClick={props.onClose}>×</button></header>
    <div className="header-footer-body">
      <div className="header-footer-fields">{FIELDS.map(({ key, label }) => <label key={key}>{label}<input ref={(node) => { if (node) inputRefs.current[key] = node }} value={settings.fields[key]} disabled={busy || loading} onFocus={(event) => rememberSelection(key, event.currentTarget)} onSelect={(event) => rememberSelection(key, event.currentTarget)} onChange={(event) => updateField(key, event.currentTarget.value)} /></label>)}</div>
      <div className="header-footer-insert"><span>差し込む:</span>{[['ページ番号', '{ページ}'], ['総ページ数', '{総ページ}'], ['日付', '{日付}'], ['ファイル名', '{ファイル名}']].map(([label, token]) => <button type="button" key={token} disabled={busy} onClick={() => insert(token)}>{label}</button>)}</div>
      <label>ページ番号の形 <select aria-label="ページ番号の形" disabled={busy} value={settings.fields[activeField]} onChange={(event) => updateField(activeField, event.currentTarget.value)}><option value="">選んでください</option>{PAGE_PATTERNS.map((value) => <option key={value} value={value}>{value.replace('{ページ}', '1').replace('{総ページ}', String(props.pageSizes.length))}</option>)}</select></label>
      <div className="header-footer-options">
        <label>開始番号 <input aria-label="開始番号" type="number" min="1" step="1" value={settings.startNumber} disabled={busy} onChange={(event) => update('startNumber', Number(event.currentTarget.value))} /></label>
        <fieldset><legend>対象</legend><label><input type="radio" name="hf-target" checked={settings.target === 'all'} onChange={() => update('target', 'all')} />すべて</label><label><input type="radio" name="hf-target" checked={settings.target === 'range'} onChange={() => update('target', 'range')} />範囲</label><input aria-label="対象範囲" placeholder="2-10" disabled={busy || settings.target !== 'range'} value={settings.range} onChange={(event) => update('range', event.currentTarget.value)} /></fieldset>
        <label>書体 <select aria-label="書体" value={settings.font} disabled={busy} onChange={(event) => update('font', event.currentTarget.value as HeaderFooterSettings['font'])}><option value="BIZUDGothic">BIZ UDゴシック</option><option value="BIZUDMincho">BIZ UD明朝</option></select></label>
        <label>大きさ <input aria-label="大きさ" type="number" min="6" max="72" step="0.5" value={settings.fontSize} disabled={busy} onChange={(event) => update('fontSize', Number(event.currentTarget.value))} />pt</label>
        <label>色 <select aria-label="色" value={COLORS.findIndex(([, value]) => value.every((component, index) => component === settings.color[index]))} disabled={busy} onChange={(event) => update('color', [...COLORS[Number(event.currentTarget.value)][1]] as HeaderFooterSettings['color'])}>{COLORS.map(([name], index) => <option key={name} value={index}>{name}</option>)}</select></label>
        <label>余白 上下 <input aria-label="上下の余白" type="number" min="0" step="1" value={settings.verticalMarginMm} disabled={busy} onChange={(event) => update('verticalMarginMm', Number(event.currentTarget.value))} />mm</label>
        <label>左右 <input aria-label="左右の余白" type="number" min="0" step="1" value={settings.horizontalMarginMm} disabled={busy} onChange={(event) => update('horizontalMarginMm', Number(event.currentTarget.value))} />mm</label>
        <label>日付の形 <select aria-label="日付の形" value={settings.dateFormat} disabled={busy} onChange={(event) => update('dateFormat', event.currentTarget.value as HeaderFooterSettings['dateFormat'])}>{(['japanese', 'slash', 'era'] as const).map((value) => <option key={value} value={value}>{formatHeaderFooterDate(new Date(), value)}</option>)}</select></label>
      </div>
      {validationError && <p className="header-footer-error" role="alert">{validationError}</p>}
      <section className="header-footer-preview">
        <div className="header-footer-paper" style={{ aspectRatio: previewSize ? `${previewSize.width} / ${previewSize.height}` : '1 / 1.414' }}><canvas ref={canvasRef} />
          {previewNumber === undefined ? <strong>このページには付けません</strong> : FIELDS.map(({ key }) => fieldPreview(key) && <span key={key} className={`hf-${key}`} style={{ color, fontSize: previewSize ? `${settings.fontSize / previewSize.width * 100}cqw` : `${settings.fontSize}px`, fontFamily: settings.font === 'BIZUDMincho' ? 'KaruBIZUDMincho' : 'KaruBIZUDGothic', left: key.endsWith('Left') ? `${marginX}%` : key.endsWith('Center') ? '50%' : 'auto', right: key.endsWith('Right') ? `${marginX}%` : 'auto', top: key.startsWith('top') ? `${marginY}%` : 'auto', bottom: key.startsWith('bottom') ? `${marginY}%` : 'auto' }}>{fieldPreview(key)}</span>)}</div>
        <div><button type="button" aria-label="前のページ" disabled={previewPage <= 0} onClick={() => setPreviewPage((value) => value - 1)}>‹</button><span>{previewPage + 1} / {props.pageSizes.length} ページ</span><button type="button" aria-label="次のページ" disabled={previewPage >= props.pageSizes.length - 1} onClick={() => setPreviewPage((value) => value + 1)}>›</button></div>
      </section>
      {error && <p className="header-footer-error" role="alert">{error}</p>}
    </div>
    <footer><button type="button" disabled={!hasSavedSettings || busy || loading} onClick={() => void run(props.onRemove)}>削除</button><span /><button type="button" disabled={busy} onClick={props.onClose}>キャンセル</button><button type="button" disabled={busy || loading || Boolean(validationError)} onClick={() => void run(() => props.onApply(settings, dateText))}>{busy ? '適用中…' : '適用'}</button></footer>
  </dialog>
}
