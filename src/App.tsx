import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { PdfWorkerPool, type ApplyAndSaveResult } from './client/PdfWorkerPool'
import type { PageSize } from './core/mupdfDoc'
import type { EditorTool } from './editor/AnnotationLayer'
import { AnnotationStore, type EditableAnnotation } from './editor/AnnotationStore'
import { PDF_PICKER_TYPES, downloadPdf, pickSaveHandle, requestWritePermission, writePdf, type PdfFileHandle } from './editor/fileAccess'
import { getFrameStats, type FrameStats } from './editor/TextEditor'
import { DebugPanel } from './perf/DebugPanel'
import { getMetrics, resetBlankFrames, startMeasure } from './perf/metrics'
import { Viewer, type ViewerHandle } from './viewer/Viewer'
import './styles.css'

declare global {
  interface Window {
    __karu?: {
      getMetrics: typeof getMetrics
      setZoom(zoom: number, anchor?: { x: number; y: number }): void
      scrollToPage(index: number): void
      isIdle(): boolean
      isSharp(): boolean
      resetBlankFrames(): void
      getWorkerStats(): ReturnType<PdfWorkerPool['stats']>
      getHardwareInfo(): { hardwareConcurrency: number; deviceMemory: number | null }
      saveToBytes(): Promise<Uint8Array | null>
      openBytes(bytes: Uint8Array | number[] | ArrayBuffer, name?: string): Promise<void>
      getEditableAnnotations(pageIndex: number): EditableAnnotation[]
      getFrameStats(): FrameStats
    }
  }
  interface Navigator { deviceMemory?: number }
}

function workerCountFromUrl(): number {
  const value = Number(new URLSearchParams(location.search).get('workers') ?? '1')
  return Number.isFinite(value) ? Math.max(1, Math.min(3, Math.trunc(value))) : 1
}

function copyToArrayBuffer(bytes: Uint8Array | number[] | ArrayBuffer): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) return bytes.slice(0)
  const view = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes)
  return new Uint8Array(view).buffer
}

function saveMessage(result: ApplyAndSaveResult): string {
  const mode = result.mode === 'incremental' ? '増分保存' : '完全保存'
  return `保存しました（${mode}・${(result.ms / 1000).toFixed(1)}秒）`
}

export default function App() {
  const pool = useMemo(() => new PdfWorkerPool(workerCountFromUrl()), [])
  const annotationStore = useMemo(() => new AnnotationStore(), [])
  useSyncExternalStore(annotationStore.subscribe, annotationStore.getSnapshot)
  const viewerRef = useRef<ViewerHandle>(null)
  const fileHandleRef = useRef<PdfFileHandle | null>(null)
  const openEndRef = useRef<(() => number) | null>(null)
  const openSharpEndRef = useRef<(() => number) | null>(null)
  const statusTimerRef = useRef<number | undefined>(undefined)
  const savingRef = useRef(false)
  const fileOutdatedRef = useRef(false)
  const [pageSizes, setPageSizes] = useState<PageSize[]>([])
  const [documentId, setDocumentId] = useState(0)
  const [fileName, setFileName] = useState('PDFを開いてください')
  const [zoom, setZoom] = useState(1)
  const [page, setPage] = useState(0)
  const [tool, setTool] = useState<EditorTool>('select')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [fileOutdated, setFileOutdated] = useState(false)
  const [debug, setDebug] = useState(() => new URLSearchParams(location.search).get('debug') === '1')
  const [viewerReady, setViewerReady] = useState(false)
  const dirty = annotationStore.isDirty()
  const unsaved = dirty || fileOutdated

  useEffect(() => () => {
    window.clearTimeout(statusTimerRef.current)
    pool.destroy()
  }, [pool])
  useEffect(() => { setViewerReady(true) }, [])

  const showStatus = useCallback((message: string) => {
    setStatus(message)
    window.clearTimeout(statusTimerRef.current)
    statusTimerRef.current = window.setTimeout(() => setStatus(''), 5000)
  }, [])

  const setFileOutdatedValue = useCallback((value: boolean) => {
    fileOutdatedRef.current = value
    setFileOutdated(value)
  }, [])

  const beginSave = useCallback(() => {
    if (savingRef.current) {
      showStatus('保存中です')
      return false
    }
    savingRef.current = true
    setSaving(true)
    return true
  }, [showStatus])

  const endSave = useCallback(() => {
    savingRef.current = false
    setSaving(false)
  }, [])

  const openBuffer = useCallback(async (buffer: ArrayBuffer, name: string, handle: PdfFileHandle | null) => {
    setError('')
    setStatus('')
    setFileName(name)
    fileHandleRef.current = handle
    resetBlankFrames()
    openEndRef.current = startMeasure('open')
    openSharpEndRef.current = startMeasure('open-sharp')
    annotationStore.reset()
    setFileOutdatedValue(false)
    viewerRef.current?.clearSelection()
    try {
      setPageSizes([])
      setDocumentId((value) => value + 1)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const result = await pool.open(buffer)
      setPageSizes(result.pageSizes)
      setDocumentId((value) => value + 1)
      setPage(1)
    } catch (reason) {
      openEndRef.current = null
      openSharpEndRef.current = null
      setError(`PDFを開けませんでした: ${reason instanceof Error ? reason.message : String(reason)}`)
      throw reason
    }
  }, [annotationStore, pool, setFileOutdatedValue])

  const confirmDiscard = useCallback(() => (
    (!annotationStore.isDirty() && !fileOutdatedRef.current)
      || window.confirm('未保存の変更があります。保存せずに別のファイルを開きますか？')
  ), [annotationStore])

  const openFile = useCallback(async (file: File, handle: PdfFileHandle | null = null) => {
    if (!confirmDiscard()) return
    await openBuffer(await file.arrayBuffer(), file.name, handle)
  }, [confirmDiscard, openBuffer])

  const saveToBytes = useCallback(async (): Promise<{ bytes: Uint8Array; result: ApplyAndSaveResult } | null> => {
    if (!beginSave()) return null
    try {
      await viewerRef.current?.commitEditor()
      const result = await pool.applyAndSave(annotationStore.toEdits(), 'incremental')
      annotationStore.markApplied(result)
      setFileOutdatedValue(true)
      viewerRef.current?.clearSelection()
      if (result.errors.length > 0) {
        throw new Error(result.errors.map((item) => item.message).join(' / '))
      }
      return { bytes: result.bytes, result }
    } finally {
      endSave()
    }
  }, [annotationStore, beginSave, endSave, pool, setFileOutdatedValue])

  const saveDocument = useCallback(async (saveAs: boolean) => {
    if (!beginSave()) return
    setError('')
    try {
      let handle = fileHandleRef.current
      const needsDestination = saveAs || !handle
      if (needsDestination && window.showSaveFilePicker) {
        handle = await pickSaveHandle(fileName)
      }
      if (!needsDestination && handle && !await requestWritePermission(handle)) {
        throw new Error('ファイルへの書き込みが許可されませんでした。')
      }
      await viewerRef.current?.commitEditor()
      const result = await pool.applyAndSave(annotationStore.toEdits(), 'incremental')
      annotationStore.markApplied(result)
      setFileOutdatedValue(true)
      if (handle) {
        await writePdf(handle, result.bytes)
        fileHandleRef.current = handle
      } else {
        downloadPdf(result.bytes, fileName)
      }
      setFileOutdatedValue(false)
      viewerRef.current?.clearSelection()
      if (result.errors.length > 0) throw new Error(result.errors.map((item) => item.message).join(' / '))
      showStatus(saveMessage(result))
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      const message = reason instanceof Error ? reason.message : String(reason)
      setError(`保存できませんでした: ${message}`)
    } finally {
      endSave()
    }
  }, [annotationStore, beginSave, endSave, fileName, pool, setFileOutdatedValue, showStatus])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        setDebug((value) => !value)
        return
      }
      if (event.ctrlKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveDocument(event.shiftKey)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saveDocument])

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!annotationStore.isDirty() && !fileOutdatedRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [annotationStore])

  useEffect(() => {
    if (new URLSearchParams(location.search).get('test') !== '1') return
    window.__karu = {
      getMetrics,
      setZoom: (value, anchor) => viewerRef.current?.setZoom(value, anchor),
      scrollToPage: (index) => viewerRef.current?.scrollToPage(index),
      isIdle: () => viewerRef.current?.isIdle() ?? true,
      isSharp: () => viewerRef.current?.isSharp() ?? true,
      resetBlankFrames,
      getWorkerStats: () => pool.stats(),
      getHardwareInfo: () => ({
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory ?? null,
      }),
      saveToBytes: async () => (await saveToBytes())?.bytes ?? null,
      openBytes: async (bytes, name = 'test.pdf') => {
        await openBuffer(copyToArrayBuffer(bytes), name, null)
      },
      getEditableAnnotations: (pageIndex) => annotationStore.getPageAnnotations(pageIndex),
      getFrameStats,
    }
    return () => { delete window.__karu }
  }, [annotationStore, openBuffer, pool, saveToBytes])

  const pickFile = async () => {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({ multiple: false, types: PDF_PICKER_TYPES })
        if (handle) await openFile(await handle.getFile(), handle)
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
          setError(`PDFを開けませんでした: ${reason instanceof Error ? reason.message : String(reason)}`)
        }
      }
      return
    }
    document.querySelector<HTMLInputElement>('[data-testid="file-input"]')?.click()
  }

  const changeTool = async (next: EditorTool) => {
    await viewerRef.current?.commitEditor()
    setTool(next)
  }

  return (
    <main
      className="app"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        const item = event.dataTransfer.items[0]
        const file = event.dataTransfer.files[0]
        if (!file) return
        const getHandle = (item as DataTransferItem & { getAsFileSystemHandle?: () => Promise<PdfFileHandle> }).getAsFileSystemHandle
        void (getHandle ? getHandle.call(item) : Promise.resolve(null)).then((handle) => openFile(file, handle))
      }}
    >
      <header className="toolbar">
        <button type="button" onClick={() => void pickFile()}>開く</button>
        <button type="button" onClick={() => void saveDocument(false)} disabled={!pageSizes.length || saving}>上書き保存</button>
        <button type="button" onClick={() => void saveDocument(true)} disabled={!pageSizes.length || saving}>別名で保存</button>
        <span className="toolbar-separator" />
        <button type="button" className={tool === 'select' ? 'active' : ''} aria-pressed={tool === 'select'} onClick={() => void changeTool('select')}>選択</button>
        <button type="button" className={tool === 'text' ? 'active' : ''} aria-pressed={tool === 'text'} onClick={() => void changeTool('text')}>文字</button>
        <button type="button" className={tool === 'square' ? 'active' : ''} aria-pressed={tool === 'square'} onClick={() => void changeTool('square')}>四角</button>
        <span className="toolbar-separator" />
        <button type="button" onClick={() => viewerRef.current?.zoomOut()} disabled={!pageSizes.length}>縮小</button>
        <button type="button" onClick={() => viewerRef.current?.zoomIn()} disabled={!pageSizes.length}>拡大</button>
        <button type="button" onClick={() => viewerRef.current?.fitWidth()} disabled={!pageSizes.length}>幅に合わせる</button>
        <output className="zoom-output">{Math.round(zoom * 100)}%</output>
        <output>{pageSizes.length ? `${page} / ${pageSizes.length}` : '0 / 0'}</output>
        <span className="file-name" title={fileName}>{unsaved ? '● ' : ''}{fileName}</span>
      </header>
      <input
        hidden
        type="file"
        accept="application/pdf,.pdf"
        data-testid="file-input"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          if (file) void openFile(file)
          event.currentTarget.value = ''
        }}
      />
      {error && <div className="error" role="alert">{error}</div>}
      <Viewer
        key={documentId}
        ref={viewerRef}
        pool={pool}
        annotationStore={annotationStore}
        tool={tool}
        pageSizes={pageSizes}
        onZoomChange={setZoom}
        onPageChange={setPage}
        onFirstBitmap={() => {
          openEndRef.current?.()
          openEndRef.current = null
        }}
        onFirstSharp={() => {
          openSharpEndRef.current?.()
          openSharpEndRef.current = null
        }}
      />
      {status && <div className="save-status" role="status">{status}</div>}
      {debug && viewerReady && viewerRef.current && <DebugPanel pool={pool} cache={viewerRef.current.getCache()} />}
    </main>
  )
}
