import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { DocumentTabs } from './app/DocumentTabs'
import { DocumentWorkspace } from './app/DocumentWorkspace'
import type { OrganizeWorkspaceState } from './app/DocumentWorkspace'
import { HelpDialog } from './app/HelpDialog'
import { MenuBar } from './app/MenuBar'
import { RasterizeDialog } from './app/RasterizeDialog'
import { ToolRow } from './app/ToolRow'
import { createDocId, DocumentSession, DocumentTabsModel, MAX_OPEN_DOCUMENTS, type SidePanelTab } from './app/documentModel'
import { allSessionAnnotations } from './app/AnnotationListPanel'
import { createAnnotationCsv } from './app/annotationCsv'
import { StartScreen } from './app/StartScreen'
import { ErrorBoundary } from './app/ErrorBoundary'
import { PdfWorkerPool, type ApplyAndSaveResult, type PageLayoutTimings, type PreparedOutputResult, type RasterizeMetrics } from './client/PdfWorkerPool'
import type { RasterizeOptions } from './core/rasterize'
import { BlobPdfWriteTarget, type PdfWriteTarget } from './core/pdfStreamWriter'
import type { EditorTool } from './editor/AnnotationLayer'
import type { EditableAnnotation } from './editor/AnnotationStore'
import { downloadPdf, pickOpenHandles, pickSaveHandle, requestWritePermission, writePdf, writePdfWithoutOverwrite, type PdfFileHandle } from './editor/fileAccess'
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
import { OrganizeDraft } from './organize/OrganizeDraft'
import type { PageCard } from './organize/OrganizeDraft'
import type { ExtractOptions, OrganizeSourceInfo } from './organize/OrganizeView'
import { splitCardGroups, type OrganizeSplitMode } from './organize/organizeUtils'
import type { PageLayoutCard } from './core/pageOps'
import { registerPwa } from './pwa'
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
      openOrganize(): Promise<void>
      organizeDraft(): OrganizeDraft | null
      applyOrganize(): Promise<OrganizeApplyTimings | null>
      undoLastOrganize(): Promise<void>
      getPageInfo(): ReturnType<PdfWorkerPool['getPageInfo']>
      extractToBytes(cardIds: string[]): Promise<Uint8Array>
      splitToBytes(mode: OrganizeSplitMode): Promise<Uint8Array[]>
      finalizeToBytes(): Promise<Uint8Array | null>
      printToBytes(): Promise<Uint8Array | null>
      rasterizeToBytes(options: RasterizeOptions): Promise<Uint8Array | null>
      rasterizeToStream(options: RasterizeOptions, target: PdfWriteTarget): Promise<RasterizeMetrics | null>
      getLastRasterizeMetrics(): RasterizeMetrics | null
      getMenuActions(): string[]
      exportAnnotationCsv(): string
    }
    launchQueue?: {
      setConsumer(consumer: (params: { files: PdfFileHandle[] }) => void): void
    }
  }
  interface Navigator { deviceMemory?: number }
}

export type { OrganizeSplitMode } from './organize/organizeUtils'

export interface OrganizeApplyTimings extends PageLayoutTimings {
  applyEditsMs: number
  mainUpdateMs: number
  totalMs: number
}

interface ActiveOrganize {
  docId: string
  draft: OrganizeDraft
  sources: Map<string, OrganizeSourceInfo>
  sourceFiles: Map<string, File>
  busy: boolean
}

const noopSubscribe = () => () => undefined
const zeroSnapshot = () => 0
const PANEL_STORAGE_KEY = 'karu-pdf:panels'

// Worker 0 は文書の操作（書き込みの反映、保存、ページ整理、材料の文書）を受け持ち、
// 描画は残りの Worker で行う。スレッドに余裕があれば描画用を 3 本にする。
function defaultWorkerCount(): number {
  return (navigator.hardwareConcurrency ?? 4) >= 6 ? 4 : 3
}

function workerCountFromUrl(): number {
  const fallback = defaultWorkerCount()
  const value = Number(new URLSearchParams(location.search).get('workers') ?? String(fallback))
  return Number.isFinite(value) ? Math.max(1, Math.min(4, Math.trunc(value))) : fallback
}

// エラーバウンダリが React ツリーを作り直しても、開いている文書・注釈ストア・
// Worker は同じインスタンスを使い続ける。
const appRuntime = {
  pool: new PdfWorkerPool(workerCountFromUrl()),
  tabs: new DocumentTabsModel(),
}

function WorkspaceFailureProbe({ fail, children }: { fail: boolean; children: ReactNode }) {
  if (fail) throw new Error('テスト用の作業領域エラー')
  return children
}

function copyToArrayBuffer(bytes: Uint8Array | number[] | ArrayBuffer): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) return bytes.slice(0)
  const view = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes)
  return new Uint8Array(view).buffer
}

function unsupportedCharactersMessage(characters: readonly string[]): string {
  return `使えない文字がありました（〓で表示）: ${characters.join(' ')}`
}

function saveMessage(result: ApplyAndSaveResult): string {
  if (result.unsupportedCharacters.length > 0) return unsupportedCharactersMessage(result.unsupportedCharacters)
  if (result.mode === 'full') return `ファイルを整理して保存しました（全体保存・${(result.ms / 1000).toFixed(1)}秒）`
  return `保存しました（増分保存・${(result.ms / 1000).toFixed(1)}秒）`
}

function finalizedName(fileName: string): string {
  return `${fileName.replace(/\.pdf$/i, '')}_確定.pdf`
}

function rasterizedName(fileName: string): string {
  return `${fileName.replace(/\.pdf$/i, '')}_画像.pdf`
}

function downloadPdfBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function sourceIdsForCards(targetDocId: string, cards: readonly PageLayoutCard[]): string[] {
  return [...new Set(cards.flatMap((card) => card.source.kind === 'page' && card.source.docId !== targetDocId ? [card.source.docId] : []))]
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
  const pool = appRuntime.pool
  const tabs = appRuntime.tabs
  const viewerRef = useRef<ViewerHandle>(null)
  const activeRef = useRef<DocumentSession | null>(null)
  const openEndRef = useRef<(() => number) | null>(null)
  const openSharpEndRef = useRef<(() => number) | null>(null)
  const statusTimerRef = useRef<number | undefined>(undefined)
  const viewSaveTimerRef = useRef<number | undefined>(undefined)
  const savingRef = useRef(false)
  const openQueueRef = useRef<Promise<void>>(Promise.resolve())
  const organizeRef = useRef<ActiveOrganize | null>(null)
  const organizeClipboardRef = useRef<{ cards: PageCard[]; sources: OrganizeSourceInfo[] } | null>(null)
  const annotationClipboardRef = useRef<{
    sourceDocId: string
    annotations: EditableAnnotation[]
    lastPasteTarget: string | null
    samePagePasteCount: number
  } | null>(null)
  const menuActionsRef = useRef<string[]>([])
  const updateServiceWorkerRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null)
  const lastRasterizeMetricsRef = useRef<RasterizeMetrics | null>(null)
  const [, setTabsVersion] = useState(0)
  const [page, setPage] = useState(() => tabs.active?.view.page ?? 0)
  const [zoom, setZoom] = useState(() => tabs.active?.view.zoom ?? 1)
  const [tool, setTool] = useState<EditorTool>('select')
  const [formatDefaults, setFormatDefaults] = useState<FormatDefaults>(() => loadFormatDefaults())
  const [panels, setPanels] = useState(loadPanels)
  const [recent, setRecent] = useState<RecentFile[]>([])
  const [error, setError] = useState('')
  const [runtimeError, setRuntimeError] = useState('')
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [organize, setOrganize] = useState<ActiveOrganize | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [rasterizeOpen, setRasterizeOpen] = useState(false)
  const [updateReady, setUpdateReady] = useState(false)
  const [debug, setDebug] = useState(() => new URLSearchParams(location.search).get('debug') === '1')
  const [workspaceFailure, setWorkspaceFailure] = useState(false)
  const [focusSearchVersion, setFocusSearchVersion] = useState(0)
  const testMode = new URLSearchParams(location.search).get('test') === '1'
  const active = tabs.active
  activeRef.current = active
  organizeRef.current = organize
  useSyncExternalStore(active?.annotationStore.subscribe ?? noopSubscribe, active?.annotationStore.getSnapshot ?? zeroSnapshot)

  const refreshTabs = useCallback(() => setTabsVersion((value) => value + 1), [])
  const refreshRecent = useCallback(() => void loadRecentFiles().then(setRecent), [])
  const showStatus = useCallback((message: string) => {
    setStatus(message)
    window.clearTimeout(statusTimerRef.current)
    statusTimerRef.current = window.setTimeout(() => setStatus(''), 5000)
  }, [])

  const copyAnnotations = useCallback((): boolean => {
    const session = activeRef.current
    if (!session) return false
    const annotations = session.annotationStore.copySelected()
    if (annotations.length === 0) return false
    annotationClipboardRef.current = {
      sourceDocId: session.docId,
      annotations,
      lastPasteTarget: null,
      samePagePasteCount: 0,
    }
    showStatus(`${annotations.length}件の書き込みをコピーしました`)
    return true
  }, [showStatus])

  const cutAnnotations = useCallback(() => {
    const session = activeRef.current
    if (!session || !copyAnnotations()) return
    session.annotationStore.removeMany(session.annotationStore.selectedIds())
    refreshTabs()
  }, [copyAnnotations, refreshTabs])

  const pasteAnnotations = useCallback(() => {
    const session = activeRef.current
    const clipboard = annotationClipboardRef.current
    if (!session || !clipboard || clipboard.annotations.length === 0) return
    const pageIndex = Math.max(0, Math.min(session.pageSizes.length - 1, session.view.page - 1))
    const samePage = clipboard.sourceDocId === session.docId
      && clipboard.annotations.every((annotation) => annotation.pageIndex === pageIndex)
    const targetKey = `${session.docId}:${pageIndex}`
    if (samePage) {
      clipboard.samePagePasteCount = clipboard.lastPasteTarget === targetKey
        ? clipboard.samePagePasteCount + 1
        : 1
      clipboard.lastPasteTarget = targetKey
    } else {
      clipboard.samePagePasteCount = 0
      clipboard.lastPasteTarget = null
    }
    const ids = session.annotationStore.pasteAnnotations(
      clipboard.annotations,
      pageIndex,
      session.pageSizes[pageIndex],
      samePage ? clipboard.samePagePasteCount * 10 : 0,
    )
    if (ids.length > 0) {
      setTool('select')
      showStatus(`${ids.length}件の書き込みを貼り付けました`)
      refreshTabs()
    }
  }, [refreshTabs, showStatus])

  const duplicateAnnotations = useCallback(() => {
    const session = activeRef.current
    if (!session) return
    const annotations = session.annotationStore.copySelected()
    if (annotations.length === 0) return
    const pageIndex = Math.max(0, Math.min(session.pageSizes.length - 1, session.view.page - 1))
    const ids = session.annotationStore.pasteAnnotations(annotations, pageIndex, session.pageSizes[pageIndex], 10)
    if (ids.length > 0) {
      setTool('select')
      showStatus(`${ids.length}件の書き込みを複製しました`)
      refreshTabs()
    }
  }, [refreshTabs, showStatus])

  useEffect(() => {
    refreshRecent()
    return () => {
      window.clearTimeout(statusTimerRef.current)
      window.clearTimeout(viewSaveTimerRef.current)
    }
  }, [pool, refreshRecent])

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      console.error('アプリで予期しないエラーが発生しました。', event.error ?? event.message)
      setRuntimeError('画面の処理で問題が起きました。書き込みは保持されています。')
    }
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('未処理の Promise エラーが発生しました。', event.reason)
      setRuntimeError('画面の処理で問題が起きました。書き込みは保持されています。')
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [])

  useEffect(() => {
    updateServiceWorkerRef.current = registerPwa({
      onNeedRefresh: () => setUpdateReady(true),
      // 初回キャッシュ完了の通知で、保存・印刷など重要な結果表示を上書きしない。
      onOfflineReady: () => undefined,
    })
    return () => { updateServiceWorkerRef.current = null }
  }, [])

  const persistView = useCallback((session: DocumentSession | null = activeRef.current) => {
    if (!session) return
    saveViewPosition(documentViewId(session.name, session.byteLength), session.view.page, session.view.zoom)
  }, [])

  const scheduleViewPersistence = useCallback(() => {
    window.clearTimeout(viewSaveTimerRef.current)
    viewSaveTimerRef.current = window.setTimeout(() => persistView(), 500)
  }, [persistView])

  const closeOrganizeSources = useCallback((state: ActiveOrganize | null) => {
    if (!state) return
    for (const source of state.sources.values()) if (source.temporary) pool.close(source.docId)
  }, [pool])

  const discardOrganize = useCallback((confirmChanged = true): boolean => {
    const current = organizeRef.current
    if (!current) return true
    if (current.busy) return false
    if (confirmChanged && current.draft.isChanged() && !window.confirm('ページ整理の変更を捨てますか？')) return false
    closeOrganizeSources(current)
    organizeRef.current = null
    setOrganize(null)
    return true
  }, [closeOrganizeSources])

  const activateDocument = useCallback(async (docId: string) => {
    const current = activeRef.current
    if (current?.docId === docId) return
    if (!discardOrganize()) return
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
  }, [discardOrganize, persistView, pool, refreshTabs, tabs])

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

  useEffect(() => {
    window.launchQueue?.setConsumer((params) => {
      void (async () => {
        for (const handle of params.files) {
          try {
            await openFile(await handle.getFile(), handle)
          } catch (reason) {
            setError(`PDFを開けませんでした: ${reason instanceof Error ? reason.message : String(reason)}`)
          }
        }
      })()
    })
  }, [openFile])

  const closeDocument = useCallback(async (docId: string, confirmDirty = true) => {
    const documents = tabs.list()
    const index = documents.findIndex((document) => document.docId === docId)
    const session = documents[index]
    if (!session) return
    if (organizeRef.current?.docId === docId && !discardOrganize(confirmDirty)) return
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
  }, [discardOrganize, persistView, pool, refreshTabs, tabs])

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
      const result = await pool.applyAndSave(session.docId, session.annotationStore.toEdits(), session.nextSaveMode())
      session.annotationStore.markApplied(result)
      session.recordSave(result.mode, result.bytes.byteLength)
      session.fileOutdated = true
      viewerRef.current?.clearSelection()
      refreshTabs()
      if (result.errors.length > 0) throw new Error(result.errors.map((item) => item.message).join(' / '))
      if (result.unsupportedCharacters.length > 0) showStatus(saveMessage(result))
      return { bytes: result.bytes, result }
    } finally {
      endSave()
    }
  }, [beginSave, endSave, pool, refreshTabs, showStatus])

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
      const result = await pool.applyAndSave(session.docId, session.annotationStore.toEdits(), session.nextSaveMode())
      session.annotationStore.markApplied(result)
      session.recordSave(result.mode, result.bytes.byteLength)
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

  const prepareOutput = useCallback(async (bake: boolean): Promise<PreparedOutputResult | null> => {
    const session = activeRef.current
    if (!session) return null
    await viewerRef.current?.commitEditor()
    const result = await pool.prepareOutput(session.docId, session.annotationStore.toEdits(), bake)
    if (result.errors.length > 0) throw new Error(result.errors.map((item) => item.message).join(' / '))
    return result
  }, [pool])

  const rasterizeToTarget = useCallback(async (
    options: RasterizeOptions,
    target?: PdfWriteTarget,
    signal?: AbortSignal,
    onProgress?: (completed: number, total: number) => void,
  ) => {
    const session = activeRef.current
    if (!session) return null
    await viewerRef.current?.commitEditor()
    const result = await pool.rasterize(session.docId, session.annotationStore.toEdits(), options, { signal, onProgress, target })
    lastRasterizeMetricsRef.current = result.metrics
    return result
  }, [pool])

  const rasterizeToBytes = useCallback(async (
    options: RasterizeOptions,
    signal?: AbortSignal,
    onProgress?: (completed: number, total: number) => void,
  ): Promise<Uint8Array | null> => (await rasterizeToTarget(options, undefined, signal, onProgress))?.bytes ?? null,
  [rasterizeToTarget])

  const saveRasterized = useCallback(async (
    options: RasterizeOptions,
    signal: AbortSignal,
    onProgress: (completed: number, total: number) => void,
  ): Promise<void> => {
    const session = activeRef.current
    if (!session || !beginSave()) throw new Error('保存中です。')
    try {
      const name = rasterizedName(session.name)
      const handle = window.showSaveFilePicker ? await pickSaveHandle(name, session.handle ?? undefined) : null
      if (signal.aborted) throw new DOMException('画像として保存を中止しました。', 'AbortError')
      if (handle) {
        const writable = await handle.createWritable()
        const abortable = writable as typeof writable & { abort?(reason?: unknown): Promise<void> }
        const target: PdfWriteTarget = {
          write: (data) => writable.write(new Uint8Array(data).buffer),
          close: () => writable.close(),
          abort: async (reason) => {
            if (!abortable.abort) throw new Error('書きかけのファイルを破棄できません。')
            await abortable.abort(reason)
          },
        }
        if (!await rasterizeToTarget(options, target, signal, onProgress)) throw new Error('PDF が開かれていません。')
      } else {
        const target = new BlobPdfWriteTarget()
        if (!await rasterizeToTarget(options, target, signal, onProgress)) throw new Error('PDF が開かれていません。')
        downloadPdfBlob(target.toBlob(), name)
      }
      showStatus('画像PDFを保存しました。今開いているファイルは変わりません。')
    } finally {
      endSave()
    }
  }, [beginSave, endSave, rasterizeToTarget, showStatus])

  const estimateRasterized = useCallback(async (options: RasterizeOptions, signal: AbortSignal): Promise<number> => {
    const bytes = await rasterizeToBytes(options, signal)
    if (!bytes) throw new Error('PDF が開かれていません。')
    return bytes.byteLength
  }, [rasterizeToBytes])

  const saveFinalized = useCallback(async () => {
    const session = activeRef.current
    if (!session || !beginSave()) return
    setError('')
    try {
      const name = finalizedName(session.name)
      const handle = window.showSaveFilePicker ? await pickSaveHandle(name, session.handle ?? undefined) : null
      const result = await prepareOutput(true)
      if (!result) return
      if (handle) await writePdf(handle, result.bytes)
      else downloadPdf(result.bytes, name)
      showStatus(result.unsupportedCharacters.length > 0
        ? unsupportedCharactersMessage(result.unsupportedCharacters)
        : '確定版を保存しました。確定版の書き込みは編集できません。')
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      setError(`確定版を保存できませんでした: ${reason instanceof Error ? reason.message : String(reason)}`)
    } finally {
      endSave()
    }
  }, [beginSave, endSave, prepareOutput, showStatus])

  const printDocument = useCallback(async () => {
    const session = activeRef.current
    if (!session || !beginSave()) return
    setError('')
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      endSave()
      setError('印刷用のタブを開けませんでした。ポップアップを許可してください。')
      return
    }
    try {
      printWindow.document.title = '印刷用PDFを準備中'
      printWindow.document.body.textContent = '印刷用PDFを準備しています…'
      const result = await prepareOutput(false)
      if (!result) return
      const url = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: 'application/pdf' }))
      printWindow.location.replace(url)
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      showStatus(result.unsupportedCharacters.length > 0
        ? unsupportedCharactersMessage(result.unsupportedCharacters)
        : '新しいタブの印刷ボタンから印刷してください')
    } catch (reason) {
      printWindow.close()
      setError(`印刷用PDFを開けませんでした: ${reason instanceof Error ? reason.message : String(reason)}`)
    } finally {
      endSave()
    }
  }, [beginSave, endSave, prepareOutput, showStatus])

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

  const openSidePanel = useCallback((tab: SidePanelTab, focusSearch = true) => {
    const session = activeRef.current
    if (!session) return
    session.sidePanelTab = tab
    if (!panels.thumbnails) updatePanels({ ...panels, thumbnails: true })
    if (tab === 'search' && focusSearch) setFocusSearchVersion((value) => value + 1)
    refreshTabs()
  }, [panels, refreshTabs, updatePanels])

  const updateFormatDefaults = useCallback((next: FormatDefaults) => {
    setFormatDefaults(next)
    saveFormatDefaults(next)
  }, [])

  const applyPendingEdits = useCallback(async (session: DocumentSession) => {
    await viewerRef.current?.commitEditor()
    const edits = session.annotationStore.toEdits()
    if (edits.length === 0) return
    const result = await pool.applyEdits(session.docId, edits)
    session.annotationStore.markApplied(result)
    session.fileOutdated = true
    viewerRef.current?.clearSelection()
    refreshTabs()
    if (result.errors.length > 0) throw new Error(result.errors.map((item) => item.message).join(' / '))
    if (result.unsupportedCharacters.length > 0) showStatus(unsupportedCharactersMessage(result.unsupportedCharacters))
  }, [pool, refreshTabs, showStatus])

  const openOrganize = useCallback(async () => {
    const session = activeRef.current
    if (!session || organizeRef.current) return
    await viewerRef.current?.commitEditor()
    const next: ActiveOrganize = {
      docId: session.docId,
      draft: new OrganizeDraft(session.docId, session.pageSizes),
      sources: new Map(),
      sourceFiles: new Map(),
      busy: false,
    }
    organizeRef.current = next
    setOrganize(next)
    setTool('select')
  }, [])

  const loadOrganizeFile = useCallback(async (file: File): Promise<OrganizeSourceInfo> => {
    const current = organizeRef.current
    if (!current || current.busy) throw new Error('ページ整理を開いてください。')
    const sourceId = `src-${createDocId()}`
    try {
      const result = await pool.openSource(sourceId, await file.arrayBuffer())
      if (organizeRef.current?.draft !== current.draft) {
        pool.close(sourceId)
        throw new Error('ページ整理が閉じられました。')
      }
      const info: OrganizeSourceInfo = { docId: sourceId, name: file.name, pageSizes: result.pageSizes, temporary: true }
      current.sources.set(sourceId, info)
      current.sourceFiles.set(sourceId, file)
      const next = { ...current, sources: new Map(current.sources), sourceFiles: new Map(current.sourceFiles) }
      organizeRef.current = next
      setOrganize(next)
      return info
    } catch (reason) {
      pool.close(sourceId)
      throw reason
    }
  }, [pool])

  const prepareOrganizeSources = useCallback((docIds: string[]) => {
    const current = organizeRef.current
    if (!current || current.busy) return
    for (const docId of docIds) {
      const file = current.sourceFiles.get(docId)
      if (!file) continue
      void pool.openSourceDisplays(docId, file).catch((reason) => {
        if (organizeRef.current?.draft === current.draft) {
          console.warn(`表示用Workerで材料PDFを開けませんでした: ${docId}`, reason)
        }
      })
    }
  }, [pool])

  const discardOrganizeSources = useCallback((docIds: string[]) => {
    const current = organizeRef.current
    if (!current || current.busy) return
    let changed = false
    for (const docId of docIds) {
      const source = current.sources.get(docId)
      if (!source?.temporary) continue
      pool.close(docId)
      current.sources.delete(docId)
      current.sourceFiles.delete(docId)
      changed = true
    }
    if (changed) {
      const next = { ...current, sources: new Map(current.sources), sourceFiles: new Map(current.sourceFiles) }
      organizeRef.current = next
      setOrganize(next)
    }
  }, [pool])

  const copyOrganizeCards = useCallback((cards: readonly PageCard[]) => {
    const current = organizeRef.current
    if (!current || cards.length === 0) return
    const sourceIds = new Set(cards.flatMap((card) => card.source.kind === 'page' ? [card.source.docId] : []))
    const sources: OrganizeSourceInfo[] = []
    for (const docId of sourceIds) {
      const known = current.sources.get(docId)
      if (known) { sources.push({ ...known, pageSizes: [...known.pageSizes], temporary: false }); continue }
      const session = tabs.list().find((item) => item.docId === docId)
      if (session) sources.push({ docId, name: session.name, pageSizes: [...session.pageSizes], temporary: false })
    }
    organizeClipboardRef.current = {
      cards: cards.map((card) => ({ ...card, source: { ...card.source } })),
      sources,
    }
    showStatus(`${cards.length}ページをコピーしました`)
  }, [showStatus, tabs])

  const pasteOrganizeCards = useCallback((beforeIndex: number): PageCard[] => {
    const current = organizeRef.current
    const clipboard = organizeClipboardRef.current
    if (!current) throw new Error('ページ整理を開いてください。')
    if (!clipboard || clipboard.cards.length === 0) throw new Error('コピーされたページがありません。')
    const missing = clipboard.cards.some((card) => card.source.kind === 'page' && !pool.hasDocument(card.source.docId))
    if (missing) throw new Error('コピー元のファイルが閉じられたため、貼り付けられません。')
    for (const source of clipboard.sources) {
      if (source.docId !== current.docId) current.sources.set(source.docId, { ...source, temporary: false })
    }
    const inserted = current.draft.paste(beforeIndex, clipboard.cards)
    const next = { ...current, sources: new Map(current.sources) }
    organizeRef.current = next
    setOrganize(next)
    return inserted
  }, [pool])

  const finishPageLayout = useCallback((session: DocumentSession, result: { pageSizes: typeof session.pageSizes; hasBackup: boolean }) => {
    session.updateAfterPageLayout(result.pageSizes, result.hasBackup)
    activeRef.current = session
    setPage(session.view.page)
    setZoom(session.view.zoom)
    refreshTabs()
  }, [refreshTabs])

  const applyOrganize = useCallback(async (): Promise<OrganizeApplyTimings | null> => {
    const totalStarted = performance.now()
    const current = organizeRef.current
    const session = activeRef.current
    if (!current || !session || current.docId !== session.docId || current.busy) return null
    const missingSourceIds = new Set(sourceIdsForCards(session.docId, current.draft.getCards()).filter((docId) => !pool.hasDocument(docId)))
    if (missingSourceIds.size > 0) {
      const invalidCards = current.draft.getCards().filter((card) => card.source.kind === 'page' && missingSourceIds.has(card.source.docId)).map((card) => card.id)
      current.draft.delete(invalidCards)
      setError('コピー元のファイルが閉じられたため、貼り付けたページを取り込めません。該当するカードを下書きから外しました。')
      return null
    }
    const busyState = { ...current, busy: true }
    organizeRef.current = busyState
    setOrganize(busyState)
    setError('')
    try {
      const editsStarted = performance.now()
      await applyPendingEdits(session)
      const applyEditsMs = performance.now() - editsStarted
      const result = await pool.applyPageLayout(session.docId, current.draft.getCards(), sourceIdsForCards(session.docId, current.draft.getCards()))
      const mainUpdateStarted = performance.now()
      finishPageLayout(session, result)
      closeOrganizeSources(current)
      organizeRef.current = null
      setOrganize(null)
      showStatus('ページ整理を適用しました')
      const mainUpdateMs = performance.now() - mainUpdateStarted
      return {
        ...result.timings,
        applyEditsMs,
        mainUpdateMs,
        totalMs: performance.now() - totalStarted,
      }
    } catch (reason) {
      const restored = { ...current, busy: false }
      organizeRef.current = restored
      setOrganize(restored)
      setError(`ページ整理を適用できませんでした: ${reason instanceof Error ? reason.message : String(reason)}`)
      return null
    }
  }, [applyPendingEdits, closeOrganizeSources, finishPageLayout, pool, showStatus])

  const undoLastOrganize = useCallback(async () => {
    const session = activeRef.current
    if (!session?.canUndoOrganize || savingRef.current || organizeRef.current) return
    savingRef.current = true
    setSaving(true)
    setError('')
    try {
      const result = await pool.undoPageLayout(session.docId)
      finishPageLayout(session, result)
      showStatus('直前のページ整理を元に戻しました')
    } catch (reason) {
      setError(`ページ整理を元に戻せませんでした: ${reason instanceof Error ? reason.message : String(reason)}`)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [finishPageLayout, pool, showStatus])

  const selectedCards = useCallback((cardIds: readonly string[]): PageLayoutCard[] => {
    const current = organizeRef.current
    if (!current) throw new Error('ページ整理を開いてください。')
    const wanted = new Set(cardIds)
    return current.draft.getCards().filter((card) => wanted.has(card.id))
  }, [])

  const extractToBytes = useCallback(async (cardIds: string[]): Promise<Uint8Array> => {
    const current = organizeRef.current
    const session = activeRef.current
    if (!current || !session || current.docId !== session.docId) throw new Error('ページ整理を開いてください。')
    await applyPendingEdits(session)
    const cards = selectedCards(cardIds)
    return pool.extractPages(session.docId, cards, sourceIdsForCards(session.docId, cards))
  }, [applyPendingEdits, pool, selectedCards])

  const splitGroups = useCallback((mode: OrganizeSplitMode): PageLayoutCard[][] => {
    const current = organizeRef.current
    if (!current) throw new Error('ページ整理を開いてください。')
    return splitCardGroups(current.draft.getCards(), mode)
  }, [])

  const splitToBytes = useCallback(async (mode: OrganizeSplitMode): Promise<Uint8Array[]> => {
    const current = organizeRef.current
    const session = activeRef.current
    if (!current || !session || current.docId !== session.docId) throw new Error('ページ整理を開いてください。')
    await applyPendingEdits(session)
    const groups = splitGroups(mode)
    const cards = groups.flat()
    return pool.splitPages(session.docId, groups, sourceIdsForCards(session.docId, cards))
  }, [applyPendingEdits, pool, splitGroups])

  const extractAndSave = useCallback(async (cardIds: string[], options: ExtractOptions) => {
    const session = activeRef.current
    const current = organizeRef.current
    if (!session || !current) return
    try {
      const stem = session.name.replace(/\.pdf$/i, '')
      if (options.onePerFile) {
        const cards = selectedCards(cardIds)
        await applyPendingEdits(session)
        const outputs = await Promise.all(cards.map((card) => pool.extractPages(
          session.docId,
          [card],
          sourceIdsForCards(session.docId, [card]),
        )))
        const positions = cards.map((card) => current.draft.getCards().findIndex((item) => item.id === card.id) + 1)
        if (window.showDirectoryPicker) {
          const directory = await window.showDirectoryPicker({ id: 'karu-pdf-extract-pages', mode: 'readwrite' })
          for (let index = 0; index < outputs.length; index += 1) {
            await writePdfWithoutOverwrite(directory, `${stem}_p${positions[index]}.pdf`, outputs[index])
          }
        } else outputs.forEach((bytes, index) => downloadPdf(bytes, `${stem}_p${positions[index]}.pdf`))
        showStatus(`${outputs.length}ページを別々のPDFに抽出しました`)
      } else {
        const bytes = await extractToBytes(cardIds)
        const fileName = `${stem}_抜粋.pdf`
        if (window.showSaveFilePicker) {
          let attempt = 1
          for (;;) {
            const suggestedName = attempt === 1 ? fileName : `${stem}_抜粋 (${attempt}).pdf`
            const handle = await pickSaveHandle(suggestedName)
            if (!handle) break
            const existing = await handle.getFile()
            if (existing.size === 0) { await writePdf(handle, bytes); break }
            attempt += 1
            showStatus('同名のファイルは上書きしません。別の名前を選んでください。')
          }
        } else downloadPdf(bytes, fileName)
        showStatus('選んだページを抽出しました')
      }
      if (options.removeFromDraft) current.draft.delete(cardIds)
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      setError(`抽出できませんでした: ${reason instanceof Error ? reason.message : String(reason)}`)
    }
  }, [applyPendingEdits, extractToBytes, pool, selectedCards, showStatus])

  const splitAndSave = useCallback(async (mode: OrganizeSplitMode) => {
    const session = activeRef.current
    if (!session) return
    try {
      const outputs = await splitToBytes(mode)
      const stem = session.name.replace(/\.pdf$/i, '')
      if (window.showDirectoryPicker) {
        const directory = await window.showDirectoryPicker({ id: 'karu-pdf-split', mode: 'readwrite' })
        for (let index = 0; index < outputs.length; index += 1) {
          await writePdfWithoutOverwrite(directory, `${stem}_${index + 1}.pdf`, outputs[index])
        }
      } else {
        outputs.forEach((bytes, index) => downloadPdf(bytes, `${stem}_${index + 1}.pdf`))
      }
      showStatus(`${outputs.length}個のPDFに分割しました`)
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      setError(`分割できませんでした: ${reason instanceof Error ? reason.message : String(reason)}`)
    }
  }, [showStatus, splitToBytes])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      const isInput = target?.matches('input, textarea, select, [contenteditable="true"]') ?? false
      const key = event.key.toLowerCase()
      const organizing = organizeRef.current
      if (organizing && !isInput) {
        if (event.key === 'Escape') {
          event.preventDefault()
          discardOrganize()
          return
        }
        if (event.ctrlKey && (key === 'z' || key === 'y')) {
          event.preventDefault()
          if (key === 'y' || event.shiftKey) organizing.draft.redo()
          else organizing.draft.undo()
          return
        }
      }
      if (event.ctrlKey && event.shiftKey && key === 'd') {
        event.preventDefault()
        setDebug((value) => !value)
        return
      }
      if ((event.ctrlKey || event.metaKey) && key === 'f') {
        event.preventDefault()
        if (!organizing) openSidePanel('search')
        return
      }
      if (!organizing && !isInput && (event.ctrlKey || event.metaKey) && key === 'c') {
        event.preventDefault()
        copyAnnotations()
        return
      }
      if (!organizing && !isInput && (event.ctrlKey || event.metaKey) && key === 'x') {
        event.preventDefault()
        cutAnnotations()
        return
      }
      if (!organizing && !isInput && (event.ctrlKey || event.metaKey) && key === 'v') {
        event.preventDefault()
        pasteAnnotations()
        return
      }
      if (!organizing && !isInput && (event.ctrlKey || event.metaKey) && key === 'd') {
        event.preventDefault()
        duplicateAnnotations()
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
      if (event.ctrlKey && key === 'p') {
        event.preventDefault()
        void printDocument()
        return
      }
      if (!isInput && event.ctrlKey && (key === 'z' || key === 'y')) {
        event.preventDefault()
        const session = activeRef.current
        if (!session) return
        if (key === 'y' || event.shiftKey) session.annotationStore.redo()
        else session.annotationStore.undo()
        viewerRef.current?.clearSelection()
        refreshTabs()
        return
      }
      if (!isInput && (event.key === 'Delete' || event.key === 'Backspace')) {
        const session = activeRef.current
        if (session && session.annotationStore.selectedIds().length > 0) {
          event.preventDefault()
          session.annotationStore.removeMany(session.annotationStore.selectedIds())
          refreshTabs()
        }
        return
      }
      if (isInput || event.ctrlKey || event.metaKey || event.altKey) return
      if (key === 'v') void changeTool('select')
      else if (key === 't') void changeTool('text')
      else if (key === 'l') void changeTool('line')
      else if (key === 'a') void changeTool('arrow')
      else if (key === 'r') void changeTool('square')
      else if (key === 'o') void changeTool('circle')
      else if (key === 'h') void changeTool('highlight')
      else if (key === 'p') void changeTool('ink')
      else if (key === 's') void changeTool('symbol')
      else if (key === 'c') void changeTool('callout')
      else if (key === 'm') void changeTool('textSelect')
      else if (event.key === 'Escape') { setTool('select'); viewerRef.current?.clearSelection() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activateDocument, changeTool, closeDocument, copyAnnotations, cutAnnotations, discardOrganize, duplicateAnnotations, openSidePanel, pasteAnnotations, pickFile, printDocument, refreshTabs, saveDocument, tabs])

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
      openOrganize,
      organizeDraft: () => organizeRef.current?.draft ?? null,
      applyOrganize,
      undoLastOrganize,
      getPageInfo: () => {
        const session = activeRef.current
        if (!session) return Promise.resolve([])
        return pool.getPageInfo(session.docId)
      },
      extractToBytes,
      splitToBytes,
      finalizeToBytes: async () => (await prepareOutput(true))?.bytes ?? null,
      printToBytes: async () => (await prepareOutput(false))?.bytes ?? null,
      rasterizeToBytes: (options) => rasterizeToBytes(options),
      rasterizeToStream: async (options, target) => (await rasterizeToTarget(options, target))?.metrics ?? null,
      getLastRasterizeMetrics: () => lastRasterizeMetricsRef.current,
      getMenuActions: () => [...menuActionsRef.current],
      exportAnnotationCsv: () => {
        const session = activeRef.current
        return session ? createAnnotationCsv(allSessionAnnotations(session)) : ''
      },
    }
    return () => { delete window.__karu }
  }, [activateDocument, applyOrganize, closeDocument, extractToBytes, openBuffer, openOrganize, pool, prepareOutput, rasterizeToBytes, rasterizeToTarget, saveToBytes, splitToBytes, tabs, undoLastOrganize])

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
  const applyUpdate = async () => {
    await viewerRef.current?.commitEditor()
    if (documents.some((session) => session.dirty)
      && !window.confirm('未保存の変更があります。新しい版へ更新しますか？')) return
    await updateServiceWorkerRef.current?.(true)
  }
  const workspaceOrganize: OrganizeWorkspaceState | null = organize && active?.docId === organize.docId ? {
    draft: organize.draft,
    sources: organize.sources,
    busy: organize.busy,
    onLoadFile: loadOrganizeFile,
    onPrepareSources: prepareOrganizeSources,
    onDiscardSources: discardOrganizeSources,
    onCopy: copyOrganizeCards,
    onPaste: pasteOrganizeCards,
    onApply: () => void applyOrganize(),
    onCancel: () => { discardOrganize() },
    onExtract: (cardIds, options) => void extractAndSave(cardIds, options),
    onSplit: (mode) => void splitAndSave(mode),
  } : null
  return (
    <main className={`app${updateReady ? ' update-ready' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => void handleDrop(event)}>
      {updateReady && (
        <div className="update-banner" role="status">
          <span>新しい版があります。</span>
          <button type="button" onClick={() => void applyUpdate()}>更新する</button>
        </div>
      )}
      <DocumentTabs
        documents={documents}
        activeDocId={active?.docId ?? null}
        onActivate={(docId) => void activateDocument(docId)}
        onClose={(docId) => void closeDocument(docId)}
        onOpen={() => void pickFile()}
      />
      <div className="top-controls">
        <MenuBar
          fileName={active?.name ?? null}
          dirty={active?.dirty ?? false}
          hasDocument={!!active}
          saving={saving}
          organizing={!!organize}
          canUndo={active?.annotationStore.canUndo() ?? false}
          canRedo={active?.annotationStore.canRedo() ?? false}
          showThumbnails={panels.thumbnails}
          sidePanelTab={active?.sidePanelTab ?? 'pages'}
          showFormat={panels.format}
          canUndoOrganize={active?.canUndoOrganize ?? false}
          onOpen={() => void pickFile()}
          onSave={() => { menuActionsRef.current.push('save'); void saveDocument(false) }}
          onSaveAs={() => { menuActionsRef.current.push('save-as'); void saveDocument(true) }}
          onSaveFinalized={() => void saveFinalized()}
          onSaveRasterized={() => setRasterizeOpen(true)}
          onPrint={() => void printDocument()}
          onCloseTab={() => { if (active) void closeDocument(active.docId) }}
          onUndo={() => { active?.annotationStore.undo(); viewerRef.current?.clearSelection(); refreshTabs() }}
          onRedo={() => { active?.annotationStore.redo(); viewerRef.current?.clearSelection(); refreshTabs() }}
          onCut={cutAnnotations}
          onCopy={() => { copyAnnotations() }}
          onPaste={pasteAnnotations}
          onDuplicate={duplicateAnnotations}
          onClearSelection={() => viewerRef.current?.clearSelection()}
          onDeleteSelection={() => { active?.annotationStore.removeMany(active.annotationStore.selectedIds()); refreshTabs() }}
          onToggleThumbnails={() => updatePanels({ ...panels, thumbnails: !panels.thumbnails })}
          onOpenSidePanel={(tab) => openSidePanel(tab)}
          onToggleFormat={() => updatePanels({ ...panels, format: !panels.format })}
          onZoomIn={() => viewerRef.current?.zoomIn()}
          onZoomOut={() => viewerRef.current?.zoomOut()}
          onFitWidth={() => viewerRef.current?.fitWidth()}
          onOrganize={() => void openOrganize()}
          onUndoOrganize={() => void undoLastOrganize()}
          onHelp={() => setHelpOpen(true)}
        />
        <ToolRow
          tool={tool}
          hasDocument={!!active}
          zoom={zoom}
          canUndo={active?.annotationStore.canUndo() ?? false}
          canRedo={active?.annotationStore.canRedo() ?? false}
          onToolChange={(next) => void changeTool(next)}
          onUndo={() => { active?.annotationStore.undo(); viewerRef.current?.clearSelection(); refreshTabs() }}
          onRedo={() => { active?.annotationStore.redo(); viewerRef.current?.clearSelection(); refreshTabs() }}
          onZoomIn={() => viewerRef.current?.zoomIn()}
          onZoomOut={() => viewerRef.current?.zoomOut()}
          onSetZoom={(next) => viewerRef.current?.setZoom(next)}
          onFitWidth={() => viewerRef.current?.fitWidth()}
        />
        {testMode && <button type="button" className="test-error-button" data-testid="throw-workspace-error" onClick={() => setWorkspaceFailure(true)}>作業領域エラー</button>}
      </div>
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
        <ErrorBoundary
          resetKey={`${active.docId}:${active.pageRevision}`}
          onReset={() => setWorkspaceFailure(false)}
          fallback={(_reason, reset) => <section className="workspace-error" role="alert">
            <p>表示中に問題が起きました。書き込みは消えていません。</p>
            <div>
              <button type="button" onClick={reset}>表示し直す</button>
              <button type="button" onClick={() => void saveDocument(true)}>保存する</button>
            </div>
          </section>}
        >
          <WorkspaceFailureProbe fail={workspaceFailure}>
          <DocumentWorkspace
          key={`${active.docId}:${active.pageRevision}`}
          session={active}
          pool={pool}
          viewerRef={viewerRef}
          tool={tool}
          formatDefaults={formatDefaults}
          showThumbnails={panels.thumbnails}
          showFormat={panels.format}
          activeSideTab={active.sidePanelTab}
          focusSearchVersion={focusSearchVersion}
          debug={debug}
          onToolChange={setTool}
          onFormatDefaultsChange={updateFormatDefaults}
          onSideTabChange={(tab) => openSidePanel(tab, tab === 'search')}
          onPageChange={(next) => { setPage(next); scheduleViewPersistence() }}
          onZoomChange={(next) => { setZoom(next); scheduleViewPersistence() }}
          onFirstBitmap={() => { openEndRef.current?.(); openEndRef.current = null }}
          onFirstSharp={() => { openSharpEndRef.current?.(); openSharpEndRef.current = null }}
          onStatus={showStatus}
          organize={workspaceOrganize}
          />
          </WorkspaceFailureProbe>
        </ErrorBoundary>
      ) : (
        <StartScreen
          recent={recent}
          onOpen={() => void pickFile()}
          onOpenRecent={(item) => void openRecent(item)}
          onRemoveRecent={(item) => void removeRecentFile(item.handle).then(setRecent)}
          onHelp={() => setHelpOpen(true)}
        />
      )}
      <footer className="status-bar">
        <span>{active ? `${page} / ${active.pageSizes.length} ページ` : 'PDFを開いてください'}</span>
        <span role="status">{runtimeError || status}</span>
      </footer>
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      <RasterizeDialog
        open={rasterizeOpen && Boolean(active)}
        pageCount={active?.pageSizes.length ?? 0}
        onClose={() => setRasterizeOpen(false)}
        onEstimate={estimateRasterized}
        onSave={saveRasterized}
      />
    </main>
  )
}
