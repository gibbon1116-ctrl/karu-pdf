import { useEffect, useMemo, useRef, useState } from 'react'
import { ImageWorkerClient, createImagesPdf } from '../client/ImageWorkerClient'
import { DEFAULT_IMAGE_PDF_SETTINGS, layoutImages, type ImagePdfSettings } from '../core/imagePdfLayout'
import { orientedSize } from '../core/exif'
import { estimateImagePdf, IMAGE_ACCEPT, imagesPdfName, pickImages, sortImageEntries, type ImageEntry, type ImageSort } from './imageFiles'

interface Props {
  files: File[]
  mode: 'create' | 'insert'
  onClose(): void
  onComplete(bytes: Uint8Array, name: string, signal: AbortSignal): Promise<void>
}

function ImageRow({ entry, selected, thumb, busy, onVisible, onSelect, move, drop }: {
  entry: ImageEntry; selected: boolean; thumb?: string; busy: boolean
  onVisible(id: number): void; onSelect(): void; move(delta: number): void; drop(id: number): void
}) {
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    const row = ref.current!
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting) && entry.info && !entry.error && !busy) onVisible(entry.id)
    }, { root: row.parentElement, threshold: .01 })
    observer.observe(row)
    return () => observer.disconnect()
  }, [entry.id, entry.info, entry.error, busy, onVisible])
  const size = entry.info && orientedSize(entry.info.width, entry.info.height, entry.info.orientation)
  return <li ref={ref} className={entry.error ? 'image-row image-row-error' : 'image-row'} draggable={!busy} tabIndex={0}
    onKeyDown={event => { if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); move(event.key === 'ArrowUp' ? -1 : 1) } }}
    onDragStart={event => event.dataTransfer.setData('application/x-karu-image', String(entry.id))}
    onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); event.stopPropagation(); const id = Number(event.dataTransfer.getData('application/x-karu-image')); if (id) drop(id) }}>
    <input type="checkbox" aria-label={`${entry.file.name}を選ぶ`} checked={selected} disabled={busy} onChange={onSelect} />
    <span className="image-thumb">{thumb && <img src={thumb} alt="" />}</span>
    <span className="image-row-label"><strong>{entry.file.name}</strong><small>{size ? `${size.width}×${size.height}` : entry.error ? '対象外' : '確認中…'}</small>{entry.error && <span role="alert">{entry.error}</span>}</span>
    <button type="button" aria-label={`${entry.file.name}を上へ`} disabled={busy} onClick={() => move(-1)}>↑</button>
    <button type="button" aria-label={`${entry.file.name}を下へ`} disabled={busy} onClick={() => move(1)}>↓</button>
  </li>
}

export function ImagesToPdfDialog({ files, mode, onClose, onComplete }: Props) {
  const [entries, setEntries] = useState<ImageEntry[]>([])
  const [settings, setSettings] = useState<ImagePdfSettings>(DEFAULT_IMAGE_PDF_SETTINGS)
  const [sort, setSort] = useState<ImageSort>('selected')
  const [selected, setSelected] = useState(new Set<number>())
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({})
  const [previewIndex, setPreviewIndex] = useState(0)
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null)
  const [error, setError] = useState('')
  const clientRef = useRef<ImageWorkerClient | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const nextRef = useRef(0)
  const urlsRef = useRef(new Map<number, string>())
  const thumbPending = useRef(new Set<number>())
  const aliveRef = useRef(true)
  const busyRef = useRef(false)
  const entriesRef = useRef(entries); entriesRef.current = entries

  const append = async (chosen: File[]) => {
    const additions = chosen.map(file => { const id = ++nextRef.current; return { id, order: id, file } })
    setEntries(current => [...current, ...additions])
    for (const entry of additions) {
      try {
        const info = await clientRef.current!.request(entry.file, 'inspect')
        if (!aliveRef.current) return
        setEntries(current => current.map(e => e.id === entry.id ? { ...e, info } : e))
      } catch (reason) {
        if (!aliveRef.current) return
        setEntries(current => current.map(e => e.id === entry.id ? { ...e, error: String(reason instanceof Error ? reason.message : reason) } : e))
      }
    }
  }

  useEffect(() => {
    aliveRef.current = true
    const client = new ImageWorkerClient(); clientRef.current = client
    void append(files)
    return () => {
      aliveRef.current = false; abortRef.current?.abort(); client.dispose()
      for (const url of urlsRef.current.values()) URL.revokeObjectURL(url)
      urlsRef.current.clear()
    }
  }, [])

  // Stable callback: observers are only re-created when a row's status changes.
  const visibleRef = useRef((id: number) => {
    if (busyRef.current || urlsRef.current.has(id) || thumbPending.current.has(id)) return
    const entry = entriesRef.current.find(e => e.id === id)
    if (!entry?.info || entry.error) return
    thumbPending.current.add(id)
    void clientRef.current!.request(entry.file, 'thumbnail').then(result => {
      if (!aliveRef.current || !entriesRef.current.some(e => e.id === id)) return
      const url = URL.createObjectURL(result.thumbnail!)
      urlsRef.current.set(id, url); setThumbnails(current => ({ ...current, [id]: url }))
    }).catch(reason => {
      if (aliveRef.current) setEntries(current => current.map(e => e.id === id ? { ...e, error: String(reason) } : e))
    }).finally(() => thumbPending.current.delete(id))
  })
  const ordered = useMemo(() => sortImageEntries(entries, sort), [entries, sort])
  const valid = ordered.filter((e): e is ImageEntry & { info: NonNullable<ImageEntry['info']> } => Boolean(e.info) && !e.error)
  const pages = layoutImages(valid.map(e => e.info), settings)
  const preview = pages[Math.min(previewIndex, Math.max(0, pages.length - 1))]
  const estimated = estimateImagePdf(entries, settings.quality)
  const busy = Boolean(progress)
  const move = (from: number, to: number) => {
    if (busy || from < 0 || from >= ordered.length || to < 0 || to >= ordered.length || from === to) return
    const updated = [...ordered], [entry] = updated.splice(from, 1); updated.splice(to, 0, entry)
    setEntries(updated.map((e, i) => ({ ...e, order: i }))); setSort('selected')
  }
  const pick = async () => {
    try { const chosen = await pickImages(() => inputRef.current?.click()); if (chosen.length) await append(chosen) }
    catch (reason) { if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError(String(reason)) }
  }
  const cancel = () => { abortRef.current?.abort(); clientRef.current?.dispose(); onClose() }
  const create = async () => {
    if (busyRef.current) return
    if (estimated > 500 * 1024 * 1024 && !window.confirm('とても大きな PDF になります。画質を「標準」か「小さく」にしてください。\nこのまま作成しますか？')) return
    const controller = new AbortController(); abortRef.current = controller; busyRef.current = true
    setProgress({ completed: 0, total: valid.length }); setError('')
    try {
      const bytes = await createImagesPdf(clientRef.current!, valid, settings, controller.signal, (completed, total) => setProgress({ completed, total }))
      if (controller.signal.aborted || !aliveRef.current) return
      await onComplete(bytes, imagesPdfName(), controller.signal)
      if (aliveRef.current) onClose()
    } catch (reason) {
      if (aliveRef.current && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
    } finally { busyRef.current = false; if (aliveRef.current) setProgress(null) }
  }
  return <div className={`image-pdf-overlay${busy ? ' creating' : ''}`} onDrop={e => e.stopPropagation()}>
    <section className="image-pdf-dialog" role="dialog" aria-label={mode === 'insert' ? '画像を挿入' : '画像から PDF を作る'} aria-modal="false" data-testid="images-to-pdf-dialog"
      onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); cancel() } }}>
      <h2>{mode === 'insert' ? '画像を挿入' : '画像から PDF を作る'}</h2>
      {!busy && <>
        <div className="image-pdf-content"><div><h3>画像（{entries.length} 枚）</h3><ol className="image-list">
          {ordered.map((entry, index) => <ImageRow key={entry.id} entry={entry} selected={selected.has(entry.id)} thumb={thumbnails[entry.id]} busy={busy}
            onVisible={visibleRef.current} onSelect={() => setSelected(current => { const next = new Set(current); if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id); return next })}
            move={delta => move(index, index + delta)} drop={id => move(ordered.findIndex(e => e.id === id), index)} />)}
        </ol></div><div className="image-preview"><h3>仕上がり</h3>{preview && <div className="image-paper" style={{ aspectRatio: `${preview.width} / ${preview.height}`, width: `min(100%, ${290 * preview.width / preview.height}px)` }}>
          {preview.placements.map(p => <div key={p.index} className="image-placement" style={{ left: `${p.x / preview.width * 100}%`, top: `${p.y / preview.height * 100}%`, width: `${p.width / preview.width * 100}%`, height: `${p.height / preview.height * 100}%` }}>
            {thumbnails[valid[p.index].id] ? <img src={thumbnails[valid[p.index].id]} alt={valid[p.index].file.name} /> : <span>{valid[p.index].file.name}</span>}
          </div>)}
        </div>}<nav><button type="button" disabled={previewIndex <= 0} onClick={() => setPreviewIndex(i => i - 1)}>‹</button> {pages.length ? Math.min(previewIndex + 1, pages.length) : 0} / {pages.length} <button type="button" disabled={previewIndex >= pages.length - 1} onClick={() => setPreviewIndex(i => i + 1)}>›</button></nav></div></div>
        <div className="image-options">
          <label>並び<select aria-label="画像の並び" value={sort} onChange={e => setSort(e.target.value as ImageSort)}><option value="selected">選んだ順</option><option value="name">名前順</option><option value="date">撮影日時順</option></select></label>
          <label>用紙<select aria-label="画像PDFの用紙" value={settings.paper} onChange={e => setSettings(s => ({ ...s, paper: e.target.value as ImagePdfSettings['paper'] }))}>{['a4', 'a3', 'b5', 'b4', 'image'].map(p => <option key={p} value={p} disabled={p === 'image' && settings.perPage !== 1}>{p === 'image' ? '画像の大きさ' : p.toUpperCase()}</option>)}</select></label>
          <label>向き<select aria-label="画像PDFの向き" disabled={settings.paper === 'image'} value={settings.orientation} onChange={e => setSettings(s => ({ ...s, orientation: e.target.value as ImagePdfSettings['orientation'] }))}><option value="auto">自動</option><option value="portrait">縦</option><option value="landscape">横</option></select></label>
          <label>余白<select aria-label="画像PDFの余白" disabled={settings.paper === 'image'} value={settings.margin} onChange={e => setSettings(s => ({ ...s, margin: Number(e.target.value) as ImagePdfSettings['margin'] }))}>{[0, 5, 10, 15].map(n => <option key={n}>{n}</option>)}</select>mm</label>
          <label>1ページに<select aria-label="1ページの画像数" value={settings.perPage} onChange={e => { const perPage = Number(e.target.value) as ImagePdfSettings['perPage']; setSettings(s => ({ ...s, perPage, paper: perPage !== 1 && s.paper === 'image' ? 'a4' : s.paper })); setPreviewIndex(0) }}>{[1, 2, 4].map(n => <option key={n}>{n}</option>)}</select>枚</label>
          <label>画質<select aria-label="画像PDFの画質" value={settings.quality} onChange={e => setSettings(s => ({ ...s, quality: e.target.value as ImagePdfSettings['quality'] }))}><option value="original">元のまま</option><option value="standard">標準</option><option value="small">小さく</option></select></label><span>見込み 約 {(estimated / 1024 / 1024).toFixed(1)} MB</span>
        </div>
        <button type="button" onClick={() => void pick()}>画像を追加</button> <button type="button" disabled={!selected.size} onClick={() => {
          for (const id of selected) { const url = urlsRef.current.get(id); if (url) URL.revokeObjectURL(url); urlsRef.current.delete(id) }
          setEntries(current => current.filter(e => !selected.has(e.id))); setSelected(new Set())
        }}>選んだ画像を外す</button>
      </>}
      <input hidden multiple ref={inputRef} type="file" accept={IMAGE_ACCEPT} data-testid="image-add-input" onChange={e => { void append([...e.currentTarget.files ?? []]); e.currentTarget.value = '' }} />
      {progress && <p role="status">作成中… {progress.completed} / {progress.total} 枚</p>}
      {error && <p className="image-row-error" role="alert">{error}</p>}
      <footer><button type="button" onClick={cancel}>{busy ? '中止' : 'キャンセル'}</button>{!busy && <button type="button" disabled={!valid.length || entries.some(e => !e.info && !e.error)} onClick={() => void create()}>{mode === 'insert' ? '挿入' : '作成'}</button>}</footer>
    </section>
  </div>
}
