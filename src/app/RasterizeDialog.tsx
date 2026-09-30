import { useEffect, useMemo, useRef, useState } from 'react'
import type { RasterizeOptions } from '../core/rasterize'
import { parsePageRange } from '../organize/organizeUtils'

interface Props {
  open: boolean
  pageCount: number
  onClose(): void
  onEstimate(options: RasterizeOptions, signal: AbortSignal): Promise<number>
  onSave(
    options: RasterizeOptions,
    signal: AbortSignal,
    onProgress: (completed: number, total: number) => void,
  ): Promise<void>
}

function sizeLabel(bytes: number): string {
  const megabytes = bytes / 1024 / 1024
  return megabytes >= 10 ? `約 ${Math.round(megabytes)}MB` : `約 ${megabytes.toFixed(1)}MB`
}

export function RasterizeDialog({ open, pageCount, onClose, onEstimate, onSave }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const saveAbortRef = useRef<AbortController | null>(null)
  const [dpi, setDpi] = useState<RasterizeOptions['dpi']>(200)
  const [color, setColor] = useState<RasterizeOptions['color']>('color')
  const [format, setFormat] = useState<RasterizeOptions['format']>('jpeg')
  const [rangeMode, setRangeMode] = useState<'all' | 'specified'>('all')
  const [range, setRange] = useState('')
  const [estimate, setEstimate] = useState<number | null>(null)
  const [estimating, setEstimating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [progress, setProgress] = useState({ completed: 0, total: 0 })
  const [error, setError] = useState('')

  const parsed = useMemo(() => rangeMode === 'all'
    ? { pages: Array.from({ length: pageCount }, (_, index) => index), error: null }
    : parsePageRange(range, pageCount), [pageCount, range, rangeMode])
  const pageKey = parsed.pages.join(',')
  const options = useMemo<RasterizeOptions>(() => ({ dpi, color, format, pageIndexes: parsed.pages }), [dpi, color, format, pageKey])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    if (!open || busy || parsed.error || options.pageIndexes.length === 0) {
      setEstimate(null)
      setEstimating(false)
      return
    }
    const controller = new AbortController()
    setEstimate(null)
    setEstimating(true)
    const samplePages = options.pageIndexes.slice(0, 2)
    void onEstimate({ ...options, pageIndexes: samplePages }, controller.signal).then((sampleBytes) => {
      if (controller.signal.aborted) return
      setEstimate(Math.ceil(sampleBytes / samplePages.length * options.pageIndexes.length))
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(`見込みの大きさを計算できませんでした: ${reason instanceof Error ? reason.message : String(reason)}`)
    }).finally(() => {
      if (!controller.signal.aborted) setEstimating(false)
    })
    return () => controller.abort()
  }, [busy, onEstimate, open, options, parsed.error])

  useEffect(() => {
    if (!open) return
    setError('')
    setBusy(false)
    setCancelling(false)
    setProgress({ completed: 0, total: 0 })
  }, [open])

  const startSave = async () => {
    if (parsed.error || options.pageIndexes.length === 0) return
    const controller = new AbortController()
    saveAbortRef.current = controller
    setError('')
    setBusy(true)
    setCancelling(false)
    setProgress({ completed: 0, total: options.pageIndexes.length })
    try {
      await onSave(options, controller.signal, (completed, total) => setProgress({ completed, total }))
      onClose()
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') setError('画像として保存を中止しました。ファイルは書いていません。')
      else setError(`画像として保存できませんでした: ${reason instanceof Error ? reason.message : String(reason)}`)
    } finally {
      saveAbortRef.current = null
      setBusy(false)
      setCancelling(false)
    }
  }

  return <dialog
    ref={dialogRef}
    className="rasterize-dialog"
    aria-labelledby="rasterize-title"
    onCancel={(event) => {
      event.preventDefault()
      if (!busy) onClose()
    }}
    onClose={() => { if (open && !busy) onClose() }}
  >
    <header>
      <h1 id="rasterize-title">画像として保存</h1>
      <button type="button" aria-label="閉じる" disabled={busy} onClick={onClose}>×</button>
    </header>
    <div className="rasterize-dialog-body">
      <p>ページを画像にして保存します。文字の選択・コピー・検索ができなくなります。書き込みも画像に含まれます。今開いているファイルは変わりません。</p>
      <fieldset disabled={busy}>
        <legend>解像度</legend>
        <label><input type="radio" name="raster-dpi" checked={dpi === 150} onChange={() => setDpi(150)} />150 dpi（小さい）</label>
        <label><input type="radio" name="raster-dpi" checked={dpi === 200} onChange={() => setDpi(200)} />200 dpi（標準）</label>
        <label><input type="radio" name="raster-dpi" checked={dpi === 300} onChange={() => setDpi(300)} />300 dpi（細かい）</label>
      </fieldset>
      <fieldset disabled={busy}>
        <legend>色</legend>
        <label><input type="radio" name="raster-color" checked={color === 'color'} onChange={() => setColor('color')} />カラー</label>
        <label><input type="radio" name="raster-color" checked={color === 'gray'} onChange={() => setColor('gray')} />グレー</label>
      </fieldset>
      <fieldset disabled={busy}>
        <legend>画質</legend>
        <label><input type="radio" name="raster-format" checked={format === 'jpeg'} onChange={() => setFormat('jpeg')} />標準（JPEG、品質 85）</label>
        <label><input type="radio" name="raster-format" checked={format === 'png'} onChange={() => setFormat('png')} />劣化なし（PNG。図面の細い線がくっきりする代わりに、ファイルが大きくなる）</label>
      </fieldset>
      <fieldset disabled={busy}>
        <legend>範囲</legend>
        <label><input type="radio" name="raster-range" checked={rangeMode === 'all'} onChange={() => setRangeMode('all')} />すべて</label>
        <label><input type="radio" name="raster-range" checked={rangeMode === 'specified'} onChange={() => setRangeMode('specified')} />ページ番号を指定</label>
        <input aria-label="ページ番号" value={range} disabled={rangeMode !== 'specified' || busy} placeholder="1-3,5" onChange={(event) => setRange(event.currentTarget.value)} />
        {rangeMode === 'specified' && parsed.error && <p className="rasterize-error">{parsed.error}</p>}
      </fieldset>
      <p className="rasterize-estimate"><strong>見込みの大きさ:</strong> {estimating ? '計算中…' : estimate === null ? '—' : sizeLabel(estimate)}</p>
      {busy && <section className="rasterize-progress" aria-live="polite">
        <p>画像にしています… {progress.completed} / {progress.total} ページ</p>
        <progress value={progress.completed} max={Math.max(1, progress.total)} />
      </section>}
      {error && <p className="rasterize-error" role="alert">{error}</p>}
    </div>
    <footer>
      {busy ? <button type="button" disabled={cancelling} onClick={() => { setCancelling(true); saveAbortRef.current?.abort() }}>{cancelling ? '中止中…' : '中止'}</button> : <>
        <button type="button" onClick={onClose}>キャンセル</button>
        <button type="button" disabled={Boolean(parsed.error) || estimating || estimate === null} onClick={() => void startSave()}>保存</button>
      </>}
    </footer>
  </dialog>
}
