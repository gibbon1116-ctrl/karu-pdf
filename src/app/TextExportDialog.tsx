import { useEffect, useMemo, useRef, useState } from 'react'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import { parsePageRange } from '../organize/organizeUtils'
import { runTextExport, type TextExportFormat, type TextExportProgress, type TextExportResult } from './textExport'

interface Props {
  docId: string
  name: string
  pageCount: number
  currentPage: number
  pool: PdfWorkerPool
  track(controller: AbortController): () => void
  onClose(): void
}

export default function TextExportDialog({ docId, name, pageCount, currentPage, pool, track, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const controller = useRef<AbortController | null>(null)
  const resultUrl = useRef<string | null>(null)
  const mounted = useRef(true)
  const activity = useRef(-Infinity)
  const lastProgress = useRef<TextExportProgress | null>(null)
  const [scope, setScope] = useState<'current' | 'range' | 'all'>('current')
  const [range, setRange] = useState('')
  const [drawing, setDrawing] = useState('')
  const [format, setFormat] = useState<TextExportFormat>('csv')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [progress, setProgress] = useState<TextExportProgress | null>(null)
  const [result, setResult] = useState<(TextExportResult & { url: string; fileName: string }) | null>(null)
  const parsed = useMemo(() => scope === 'current' ? { pages: [Math.min(Math.max(0, currentPage), pageCount - 1)], error: null }
    : scope === 'all' ? { pages: Array.from({ length: pageCount }, (_, index) => index), error: null }
      : parsePageRange(range, pageCount), [scope, range, pageCount, currentPage])

  useEffect(() => {
    mounted.current = true
    dialog.current?.show()
    return () => {
      mounted.current = false; controller.current?.abort()
      if (resultUrl.current) URL.revokeObjectURL(resultUrl.current)
      resultUrl.current = null
    }
  }, [])
  useEffect(() => {
    if (!busy) return
    const mark = (event: Event) => {
      if (event.target instanceof Node && dialog.current?.contains(event.target)) return
      if (event instanceof PointerEvent && event.type === 'pointermove' && !event.buttons) return
      activity.current = performance.now()
    }
    const types = ['pointerdown', 'pointermove', 'wheel', 'keydown', 'input', 'scroll']
    for (const type of types) document.addEventListener(type, mark, { capture: true, passive: true })
    return () => { for (const type of types) document.removeEventListener(type, mark, true) }
  }, [busy])

  const start = async () => {
    if (controller.current || parsed.error || !parsed.pages.length) return
    const abort = new AbortController()
    controller.current = abort
    const release = track(abort)
    if (resultUrl.current) URL.revokeObjectURL(resultUrl.current)
    resultUrl.current = null
    setBusy(true); setMessage(''); setResult(null)
    lastProgress.current = null
    // Give foreground viewing a quiet interval before starting native work.
    // The busy/progress state appears immediately while this interval runs.
    activity.current = performance.now()
    try {
      const exported = await runTextExport({ name, drawing, pages: parsed.pages, format, signal: abort.signal,
        extract: page => pool.extractPageText(docId, page, abort.signal), isIdle: () => pool.isIdle(), lastActivity: () => activity.current,
        onProgress: value => {
          const last = lastProgress.current
          if (last && last.completed === value.completed && last.total === value.total && last.lines === value.lines && last.paused === value.paused) return
          lastProgress.current = value
          if (mounted.current) setProgress(value)
        },
      })
      if (mounted.current && !abort.signal.aborted) {
        const url = URL.createObjectURL(exported.blob)
        resultUrl.current = url
        setResult({ ...exported, url, fileName: name.replace(/\.pdf$/i, '') + `_図面内文字.${format}` })
      }
    } catch (error) {
      if (mounted.current) setMessage(abort.signal.aborted ? '中止しました。出力ファイルは作成していません。' : error instanceof Error ? error.message : String(error))
    } finally {
      release()
      if (controller.current === abort) controller.current = null
      if (mounted.current) setBusy(false)
    }
  }
  return <dialog ref={dialog} className="utility-dialog text-export-dialog" aria-label="図面内文字を抽出" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }}>
    <h1>図面内文字を抽出</h1>
    <p>PDFが保持する文字だけを抽出します。画像やアウトライン文字のOCRは行いません。</p>
    <fieldset disabled={busy}>
      <label>対象 <select aria-label="抽出するページ" value={scope} onChange={event => setScope(event.target.value as typeof scope)}><option value="current">現在のページ ({currentPage + 1})</option><option value="range">指定ページ</option><option value="all">全ページ ({pageCount})</option></select></label>
      {scope === 'range' && <label>ページ範囲 <input aria-label="抽出ページ範囲" placeholder="例: 1-3,5" value={range} onChange={event => setRange(event.target.value)} /></label>}
      <label>図面番号（任意） <input value={drawing} onChange={event => setDrawing(event.target.value)} maxLength={200} /></label>
      <label>出力 <select aria-label="文字抽出の形式" value={format} onChange={event => setFormat(event.target.value as TextExportFormat)}><option value="csv">CSV（Excel等）</option><option value="txt">テキスト</option></select></label>
      <button disabled={!!parsed.error} onClick={() => void start()}>文字を抽出</button>
    </fieldset>
    <p>位置は表示ページの左上からのmmです。読み順・文字の正確さは出力を確認してください。未保存の書き込みは対象に含みません。</p>
    {parsed.error && <p role="alert">{parsed.error}</p>}
    {busy && progress && <p role="status">{progress.paused ? '図面の表示・操作が落ち着くまで待機しています。' : '文字を抽出しています。'} {progress.completed} / {progress.total}ページ、{progress.lines}行 <button onClick={() => { controller.current?.abort(); setMessage('中止しています。処理中のページが終わるまで待ちます。') }}>中止</button></p>}
    {message && <p role={busy ? 'status' : 'alert'}>{message}</p>}
    {result && <>
      <p role="status">{result.pages}ページ・{result.lines}行。文字なし {result.emptyPages}ページ、上限・位置不明 {result.limitedPages}ページ、読取不明の可能性 {result.uncertainPages}ページ。</p>
      <a href={result.url} download={result.fileName}>抽出結果を保存</a>
      <div className="utility-scroll text-export-preview"><table><thead><tr><th>ページ</th><th>文字（先頭50行の確認）</th></tr></thead><tbody>{result.preview.map((row, index) => <tr key={index}><td>{row.page}</td><td>{row.text}</td></tr>)}</tbody></table></div>
    </>}
    <button onClick={onClose}>閉じる</button>
  </dialog>
}
