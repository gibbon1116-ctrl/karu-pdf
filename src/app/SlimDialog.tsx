import { useEffect, useRef, useState } from 'react'
import type { SlimOptions } from '../core/slim'
import type { SlimOutputResult } from '../client/PdfWorkerPool'

interface Props {
  open: boolean
  onClose(): void
  onCompute(options: SlimOptions, signal: AbortSignal, onProgress: (completed: number, total: number) => void): Promise<SlimOutputResult>
  onSave(bytes: Uint8Array): Promise<void>
}

export function SlimDialog({ open, onClose, onCompute, onSave }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [options, setOptions] = useState<SlimOptions>({ imageDpi: 200, deepClean: false })
  const [result, setResult] = useState<SlimOutputResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState({ completed: 0, total: 0 })
  const [error, setError] = useState('')

  useEffect(() => {
    const dialog = dialogRef.current
    if (open && dialog && !dialog.open) dialog.showModal()
    if (!open) {
      abortRef.current?.abort()
      setResult(null)
      dialog?.close()
    }
    return () => { abortRef.current?.abort() }
  }, [open])

  const changeOptions = (next: SlimOptions) => { setOptions(next); setResult(null); setError('') }
  const compute = async () => {
    const controller = new AbortController()
    abortRef.current = controller
    setResult(null)
    setError('')
    setProgress({ completed: 0, total: 0 })
    setBusy(true)
    try {
      const output = await onCompute(options, controller.signal, (completed, total) => {
        if (!controller.signal.aborted) setProgress({ completed, total })
      })
      if (!controller.signal.aborted) setResult(output)
    } catch (reason) {
      setError(controller.signal.aborted ? '軽量化を中止しました。' : `軽量化できませんでした: ${reason instanceof Error ? reason.message : String(reason)}`)
    } finally {
      if (abortRef.current === controller) { abortRef.current = null; setBusy(false) }
    }
  }
  const save = async () => {
    if (!result) return
    setSaving(true)
    setError('')
    try { await onSave(result.bytes); setResult(null); onClose() }
    catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
        setError(`保存できませんでした: ${reason instanceof Error ? reason.message : String(reason)}`)
      }
    } finally { setSaving(false) }
  }
  const close = () => { setResult(null); onClose() }
  const tooLarge = result !== null && result.bytes.byteLength >= result.sourceBytes * 0.98
  // Under 1 MB, MB with two decimals reads as 0.00, so show KB instead.
  const size = (bytes: number) => bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`
  const stats = result?.stats

  return <dialog ref={dialogRef} className="slim-dialog" aria-labelledby="slim-title"
    onKeyDown={event => event.stopPropagation()}
    onCancel={event => { event.preventDefault(); if (!busy && !saving) close() }}
    onClose={() => { if (open && !busy && !saving) close() }}>
    <header><h1 id="slim-title">軽量化して別名で保存</h1>
      <button type="button" aria-label="閉じる" disabled={busy || saving} onClick={close}>×</button></header>
    <div className="slim-dialog-body">
      <p>見た目を変えずにファイルを小さくしたコピーを保存します。書き込みは編集できるまま残ります。今開いているファイルは変わりません。</p>
      <fieldset disabled={busy || saving}>
        <legend>画像の解像度</legend>
        {(['keep', 300, 200, 150] as const).map(dpi => <label key={dpi}><input type="radio" name="slim-dpi"
          checked={options.imageDpi === dpi} onChange={() => changeOptions({ ...options, imageDpi: dpi })} />
          {dpi === 'keep' ? '変えない' : dpi === 200 ? '200 dpi（標準）' : dpi === 150 ? '150 dpi（小さい）' : '300 dpi'}</label>)}
      </fieldset>
      <p className="slim-note">スキャンした図面などの画像だけを縮めます。図面の線や文字のデータは変えません。</p>
      <label><input type="checkbox" checked={options.deepClean} disabled={busy || saving}
        onChange={event => changeOptions({ ...options, deepClean: event.currentTarget.checked })} />図面の描画命令も整理する（強め）</label>
      <p className="slim-note">時間がかかります。全ページの見た目を比べ、変わるページがあれば使いません。</p>
      <button type="button" disabled={busy || saving} onClick={() => void compute()}>計算する</button>
      {busy && <div className="slim-progress" role="status">
        <p>{progress.total ? `見た目を確かめています… ${progress.completed} / ${progress.total} ページ` : '軽量化しています…'}</p>
        {progress.total > 0 && <progress value={progress.completed} max={progress.total} />}
        <button type="button" onClick={() => abortRef.current?.abort()}>中止</button>
      </div>}
      {result && stats && <div className="slim-result" role="status">
        <p>元の大きさ {size(result.sourceBytes)} → 軽量化後 {size(result.bytes.byteLength)}（{Math.round((1 - result.bytes.byteLength / result.sourceBytes) * 100)}% 減）</p>
        <ul>
          {stats.imagesReduced > 0 && <li>画像を {stats.imagesReduced} 個縮めました</li>}
          {stats.imagesSkipped > 0 && <li>触らなかった画像: {stats.imagesSkipped} 個</li>}
          {!stats.fontsSubset && <li>フォントは整理できませんでした</li>}
          {stats.deepClean === 'used' && <li>描画命令も整理しました</li>}
          {stats.deepClean === 'rejected' && <li>{stats.rejectedPages.length
            ? `p.${stats.rejectedPages.slice(0, 3).join('、p.')} など ${stats.rejectedPages.length} ページで見た目が変わるため、描画命令の整理は使いませんでした`
            : '描画命令の整理では小さくならなかったため、使いませんでした'}</li>}
        </ul>
        {result.unsupportedCharacters.length > 0 && <p>一部の文字を出力できませんでした。</p>}
        {tooLarge && <p>これ以上小さくできませんでした。</p>}
      </div>}
      {error && <p className="slim-error" role="alert">{error}</p>}
    </div>
    <footer><button type="button" disabled={busy || saving} onClick={close}>キャンセル</button>
      <button type="button" disabled={!result || tooLarge || busy || saving} onClick={() => void save()}>{saving ? '保存中…' : '保存'}</button></footer>
  </dialog>
}
