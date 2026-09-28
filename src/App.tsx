import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { DocumentTabs } from './app/DocumentTabs'
import { DocumentWorkspace } from './app/DocumentWorkspace'
import { createDocId, DocumentSession, DocumentTabsModel, MAX_OPEN_DOCUMENTS } from './app/documentModel'
import { StartScreen } from './app/StartScreen'
import { PdfWorkerPool, type ApplyAndSaveResult } from './client/PdfWorkerPool'
import type { EditorTool } from './editor/AnnotationLayer'
import type { EditableAnnotation } from './editor/AnnotationStore'
import { downloadPdf, pickOpenHandles, pickSaveHandle, requestWritePermission, writePdf, type PdfFileHandle } from './editor/fileAccess'
import { loadFormatDefaults, saveFormatDefaults, type FormatDefaults } from './editor/formatDefaults'
import {
  documentViewId,
  loadLastOpenedHandle,
  loadRecentFiles,
  loadViewPosition,
  removeRecentFile,
  saveLastOpenedHandle,
  saveViewPosition,
  type RecentFile,
} from './editor/recentStore'
import { getFrameStats, type FrameStats } from './editor/TextEditor'
import { getMetrics, resetBlankFrames, startMeasure } from './perf/metrics'
import type { ViewerHandle } from './viewer/Viewer'
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
      listTabs(): Array<{ docId: string; name: string; dirty: boolean }>
      activateTab(docId: string): Promise<void>
      closeTab(docId: string): Promise<void>
      getEditableAnnotations(pageIndex: number): EditableAnnotation[]
      getFrameStats(): FrameStats
    }
  }
  interface Navigator { deviceMemory?: number }
}

const noopSubscribe = () => () => undefined
const zeroSnapshot = () => 0
const PANEL_STORAGE_KEY = 'karu-pdf:panels'

function workerCountFromUrl(): number {
  const value = Number(new URLSearchParams(location.search).get('workers') ?? '3')
  return Number.isFinite(value) ? Math.max(1, Math.min(3, Math.trunc(value))) : 3
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

function loadPanels(): { thumbnails: boolean; format: boolean } {
  try {
    const value = JSON.parse(localStorage.getItem(PANEL_STORAGE_KEY) ?? '{}') as { thumbnails?: unknown; format?: unknown }
    return { thumbnails: value.thumbnails !== false, format: value.format !== false }
  } catch {
    return { thumbnails: true, format: true }
  }
}

export default function App() {
  const pool = useMemo(() => new PdfWorkerPool(workerCountFromUrl()), [])
  const tabs = useRef(new DocumentTabsModel()).current
  const viewerRef = useRef<ViewerHandle>(null)
  const activeRef = useRef<DocumentSession | null>(null)
  const openEndRef = useRef<(() => number) | null>(null)
  const openSharpEndRef = useRef<(() => number) | null>(null)
  const statusTimerRef = useRef<number | undefined>(undefined)
  const viewSaveTimerRef = useRef<number | undefined>(undefined)
  const savingRef = useRef(false)
  const openQueueRef = useRef<Promise<void>>(Promise.resolve())
  const [, setTabsVersion] = useState(0)
  const [page, setPage] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [tool, setTool] = useState<EditorTool>('select')
  const [formatDefaults, setFormatDefaults] = useState<FormatDefaults>(() => loadFormatDefaults())
  const [panels, setPanels] = useState(loadPanels)
  const [recent, setRecent] = useState<RecentFile[]>([])
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [debug, setDebug] = useState(() => new URLSearchParams(location.search).get('debug') === '1')
  const active = tabs.active
  activeRef.current = active
  useSyncExternalStore(active?.annotationStore.subscribe ?? noopSubscribe, active?.annotationStore.getSnapshot ?? zeroSnapshot)

  const refreshTabs = useCallback(() => setTabsVersion((value) => value + 1), [])
  const refreshRecent = useCallback(() => void loadRecentFiles().then(setRecent), [])

  useEffect(() => {
    refreshRecent()
    return () => {
      window.clearTimeout(statusTimerRef.current)
      window.clearTimeout(viewSaveTimerRef.current)
      pool.destroy()
    }
  }, [pool, refreshRecent])

  const showStatus = useCallback((message: string) => {
    setStatus(message)
    window.clearTimeout(statusTimerRef.current)
    statusTimerRef.current = window.setTimeout(() => setStatus(''), 5000)
  }, [])

  const persistView = useCallback((session: DocumentSession | null = activeRef.current) => {
    if (!session) return
    saveViewPosition(documentViewId(session.name, session.byteLength), session.view.page, session.view.zoom)
  }, [])

  const scheduleViewPersistence = useCallback(() => {
    window.clearTimeout(viewSaveTimerRef.current)
    viewSaveTimerRef.current = window.setTimeout(() => persistView(), 500)
  }, [persistView])

  const activateDocument = useCallback(async (docId: string) => {
    const current = activeRef.current
    if (current?.docId === docId) return
    await viewerRef.current?.commitEditor()
    persistView(current)
    await pool.activate(docId)
    if (!tabs.activate(docId)) return
    const next = tabs.active
    activeRef.current = next
    setPage(next?.view.page ?? 0)
    setZoom(next?.view.zoom ?? 1)
    setTool('select')
    refreshTabs()
  }, [persistView, pool, refreshTabs, tabs])

  const openBuffer = useCallback(async (buffer: ArrayBuffer, name: string, handle: PdfFileHandle | null) => {
    const byteLength = buffer.byteLength
    const duplicate = await tabs.findDuplicate({ handle, name, byteLength })
    if (duplicate) {
      await activateDocument(duplicate.docId)
      return
    }
    if (tabs.list().length >= MAX_OPEN_DOCUMENTS) {
      setError('同時に開けるのは8ファイルまでです')
      return
    }

    setError('')
    setStatus('')
    resetBlankFrames()
    openEndRef.current = startMeasure('open')
    openSharpEndRef.current = startMeasure('open-sharp')
    const docId = createDocId()
    try {
      const result = await pool.open(docId, buffer)
      const remembered = loadViewPosition(documentViewId(name, byteLength))
      const view = remembered ? {
        page: Math.min(remembered.page, result.pageCount),
        zoom: remembered.zoom,
      } : undefined
      const session = new DocumentSession({ docId, name, byteLength, handle, pageSizes: result.pageSizes, view })
      tabs.add(session)
      activeRef.current = session
      setPage(session.view.page)
      setZoom(session.view.zoom)
      setTool('select')
      refreshTabs()
      if (handle) {
        await saveLastOpenedHandle(handle, name)
        refreshRecent()
      }
    } catch (reason) {
      pool.close(docId)
      openEndRef.current = null
      openSharpEndRef.current = null
      setError(`PDFを開けませんでした: ${reason instanceof Error ? reason.message : String(reason)}`)
      throw reason
    }
  }, [activateDocument, pool, refreshRecent, refreshTabs, tabs])

  const openFile = useCallback((file: File, handle: PdfFileHandle | null = null): Promise<void> => {
    const operation = openQueueRef.current.then(async () => {
      const duplicate = await tabs.findDuplicate({ handle, name: file.name, byteLength: file.size })
      if (duplicate) {
        await activateDocument(duplicate.docId)
        return
      }
      await openBuffer(await file.arrayBuffer(), file.name, handle)
    })
    openQueueRef.current = operation.catch(() => undefined)
    return operation
  }, [activateDocument, openBuffer, tabs])

  const closeDocument = useCallback(async (docId: string, confirmDirty = true) => {
    const documents = tabs.list()
    const index = documents.findIndex((document) => document.docId === docId)
    const session = documents[index]
    if (!session) return
    if (activeRef.current?.docId === docId) await viewerRef.current?.commitEditor()
    if (confirmDirty && session.dirty && !window.confirm('未保存の変更があります。保存せずに閉じますか？')) return
    if (activeRef.current?.docId === docId) {
      persistView(session)
      const next = documents[index + 1] ?? documents[index - 1] ?? null
      if (next) await pool.activate(next.docId)
    }
    tabs.close(docId)
    pool.close(docId)
    const next = tabs.active
    activeRef.current = next
    setPage(next?.view.page ?? 0)
    setZoom(next?.view.zoom ?? 1)
    setTool('select')
    refreshTabs()
  }, [persistView, pool, refreshTabs, tabs])

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

  const saveToBytes = useCallback(async (): Promise<{ bytes: Uint8Array; result: ApplyAndSaveResult } | null> => {
    const session = activeRef.current
    if (!session || !beginSave()) return null
    try {
      await viewerRef.current?.commitEditor()
      const result = await pool.applyAndSave(session.docId, session.annotationStore.toEdits(), 'incremental')
      session.annotationStore.markApplied(result)
      session.fileOutdated = true
      viewerRef.current?.clearSelection()
      refreshTabs()
      if (result.errors.length > 0) throw new Error(result.errors.map((item) => item.message).join(' / '))
      return { bytes: result.bytes, result }
    } finally {
      endSave()
    }
  }, [beginSave, endSave, pool, refreshTabs])

  const saveDocument = useCallback(async (saveAs: boolean) => {
    const session = activeRef.current
    if (!session || !beginSave()) return
    setError('')
    try {
      let handle = session.handle
      const needsDestination = saveAs || !handle
      if (needsDestination && window.showSaveFilePicker) handle = await pickSaveHandle(session.name, session.handle ?? undefined)
      if (!needsDestination && handle && !await requestWritePermission(handle)) {
        throw new Error('ファイルへの書き込みが許可されませんでした。')
      }
      await viewerRef.current?.commitEditor()
      const result = await pool.applyAndSave(session.docId, session.annotationStore.toEdits(), 'incremental')
      session.annotationStore.markApplied(result)
      session.fileOutdated = true
      if (handle) {
        await writePdf(handle, result.bytes)
        session.handle = handle
        await saveLastOpenedHandle(handle, session.name)
        refreshRecent()
      } else {
        downloadPdf(result.bytes, session.name)
      }
      session.fileOutdated = false
      viewerRef.current?.clearSelection()
      refreshTabs()
      if (result.errors.length > 0) throw new Error(result.errors.map((item) => item.message).join(' / '))
      showStatus(saveMessage(result))
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      setError(`保存できませんでした: ${reason instanceof Error ? reason.message : String(reason)}`)
    } finally {
      endSave()
    }
  }, [beginSave, endSave, pool, refreshRecent, refreshTabs, showStatus])

  const pickFile = useCallback(async () => {
    if (window.showOpenFilePicker) {
      try {
        const remembered = await loadLastOpenedHandle()
        const handles = await pickOpenHandles(remembered?.handle)
        for (const handle of handles) await openFile(await handle.getFile(), handle)
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
          setError(`PDFを開けませんでした: ${reason instanceof Error ? reason.message : String(reason)}`)
        }
      }
      return
    }
    document.querySelector<HTMLInputElement>('[data-testid="file-input"]')?.click()
  }, [openFile])

  const changeTool = useCallback(async (next: EditorTool) => {
    await viewerRef.current?.commitEditor()
    setTool(next)
  }, [])

  const updatePanels = useCallback((next: { thumbnails: boolean; format: boolean }) => {
    setPanels(next)
    try { localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(next)) } catch { /* 表示は続ける。 */ }
  }, [])

  const updateFormatDefaults = useCallback((next: FormatDefaults) => {
    setFormatDefaults(next)
    saveFormatDefaults(next)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isInput = target?.matches('input, textarea, select, [contenteditable="true"]') ?? false
      const key = event.key.toLowerCase()
      if (event.ctrlKey && event.shiftKey && key === 'd') {
        event.preventDefault()
        setDebug((value) => !value)
        return
      }
      if (event.ctrlKey && key === 'o') {
        event.preventDefault()
        void pickFile()
        return
      }
      if (event.ctrlKey && key === 'w') {
        event.preventDefault()
        const session = activeRef.current
        if (session) void closeDocument(session.docId)
        return
      }
      if (event.ctrlKey && event.key === 'Tab') {
        event.preventDefault()
        const documents = tabs.list()
        if (documents.length < 2 || !activeRef.current) return
        const current = documents.findIndex((document) => document.docId === activeRef.current?.docId)
        const offset = event.shiftKey ? -1 : 1
        const next = documents[(current + offset + documents.length) % documents.length]
        void activateDocument(next.docId)
        return
      }
      if (event.ctrlKey && key === 's') {
        event.preventDefault()
        void saveDocument(event.shiftKey)
        return
      }
      if (isInput || event.ctrlKey || event.metaKey || event.altKey) return
      if (key === 'v') void changeTool('select')
      else if (key === 't') void changeTool('text')
      else if (key === 'r') void changeTool('square')
      else if (event.key === 'Escape') viewerRef.current?.clearSelection()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activateDocument, changeTool, closeDocument, pickFile, saveDocument, tabs])

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      persistView()
      if (!tabs.list().some((session) => session.dirty)) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [persistView, tabs])

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
      getHardwareInfo: () => ({ hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory ?? null }),
      saveToBytes: async () => (await saveToBytes())?.bytes ?? null,
      openBytes: async (bytes, name = 'test.pdf') => openBuffer(copyToArrayBuffer(bytes), name, null),
      listTabs: () => tabs.list().map((session) => ({ docId: session.docId, name: session.name, dirty: session.dirty })),
      activateTab: activateDocument,
      closeTab: (docId) => closeDocument(docId, false),
      getEditableAnnotations: (pageIndex) => activeRef.current?.annotationStore.getPageAnnotations(pageIndex) ?? [],
      getFrameStats,
    }
    return () => { delete window.__karu }
  }, [activateDocument, closeDocument, openBuffer, pool, saveToBytes, tabs])

  const openRecent = async (item: RecentFile) => {
    try {
      if (item.handle.requestPermission && await item.handle.requestPermission({ mode: 'read' }) !== 'granted') {
        throw new Error('ファイルを開く許可が得られませんでした。')
      }
      await openFile(await item.handle.getFile(), item.handle)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setError(`最近使ったファイルを開けませんでした: ${message}`)
      if (window.confirm(`${message}\n一覧から消しますか？`)) {
        setRecent(await removeRecentFile(item.handle))
      }
    }
  }

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault()
    const files = [...event.dataTransfer.files].filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
    for (let index = 0; index < files.length; index += 1) {
      const item = event.dataTransfer.items[index] as (DataTransferItem & { getAsFileSystemHandle?: () => Promise<PdfFileHandle> }) | undefined
      const handle = item?.getAsFileSystemHandle ? await item.getAsFileSystemHandle() : null
      await openFile(files[index], handle)
    }
  }

  const documents = tabs.list()
  return (
    <main className="app" onDragOver={(event) => event.preventDefault()} onDrop={(event) => void handleDrop(event)}>
      <DocumentTabs
        documents={documents}
        activeDocId={active?.docId ?? null}
        onActivate={(docId) => void activateDocument(docId)}
        onClose={(docId) => void closeDocument(docId)}
        onOpen={() => void pickFile()}
      />
      <header className="toolbar">
        <button type="button" onClick={() => void pickFile()}>開く</button>
        <button type="button" onClick={() => void saveDocument(false)} disabled={!active || saving}>上書き保存</button>
        <button type="button" onClick={() => void saveDocument(true)} disabled={!active || saving}>別名で保存</button>
        <span className="toolbar-separator" />
        <button type="button" className={tool === 'select' ? 'active' : ''} aria-pressed={tool === 'select'} disabled={!active} onClick={() => void changeTool('select')}>選択</button>
        <button type="button" className={tool === 'text' ? 'active' : ''} aria-pressed={tool === 'text'} disabled={!active} onClick={() => void changeTool('text')}>文字</button>
        <button type="button" className={tool === 'square' ? 'active' : ''} aria-pressed={tool === 'square'} disabled={!active} onClick={() => void changeTool('square')}>四角</button>
        <span className="toolbar-separator" />
        <button type="button" aria-pressed={panels.thumbnails} onClick={() => updatePanels({ ...panels, thumbnails: !panels.thumbnails })}>ページ一覧</button>
        <button type="button" aria-pressed={panels.format} onClick={() => updatePanels({ ...panels, format: !panels.format })}>書式</button>
        <span className="toolbar-separator" />
        <button type="button" onClick={() => viewerRef.current?.zoomOut()} disabled={!active}>縮小</button>
        <button type="button" onClick={() => viewerRef.current?.zoomIn()} disabled={!active}>拡大</button>
        <button type="button" onClick={() => viewerRef.current?.fitWidth()} disabled={!active}>幅に合わせる</button>
        <output className="zoom-output">{Math.round(zoom * 100)}%</output>
      </header>
      <input
        hidden
        multiple
        type="file"
        accept="application/pdf,.pdf"
        data-testid="file-input"
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])]
          void (async () => { for (const file of files) await openFile(file) })()
          event.currentTarget.value = ''
        }}
      />
      {error && <div className="error" role="alert">{error}</div>}
      {active ? (
        <DocumentWorkspace
          key={active.docId}
          session={active}
          pool={pool}
          viewerRef={viewerRef}
          tool={tool}
          formatDefaults={formatDefaults}
          showThumbnails={panels.thumbnails}
          showFormat={panels.format}
          debug={debug}
          onToolChange={setTool}
          onFormatDefaultsChange={updateFormatDefaults}
          onPageChange={(next) => { setPage(next); scheduleViewPersistence() }}
          onZoomChange={(next) => { setZoom(next); scheduleViewPersistence() }}
          onFirstBitmap={() => { openEndRef.current?.(); openEndRef.current = null }}
          onFirstSharp={() => { openSharpEndRef.current?.(); openSharpEndRef.current = null }}
        />
      ) : (
        <StartScreen
          recent={recent}
          onOpen={() => void pickFile()}
          onOpenRecent={(item) => void openRecent(item)}
          onRemoveRecent={(item) => void removeRecentFile(item.handle).then(setRecent)}
        />
      )}
      <footer className="status-bar">
        <span>{active ? `${page} / ${active.pageSizes.length} ページ` : 'PDFを開いてください'}</span>
        <span role="status">{status}</span>
      </footer>
    </main>
  )
}
