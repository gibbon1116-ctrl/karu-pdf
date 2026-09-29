import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { DocumentTabs } from './app/DocumentTabs'
import { DocumentWorkspace } from './app/DocumentWorkspace'
import type { OrganizeWorkspaceState } from './app/DocumentWorkspace'
import { HelpDialog } from './app/HelpDialog'
import { createDocId, DocumentSession, DocumentTabsModel, MAX_OPEN_DOCUMENTS } from './app/documentModel'
import { StartScreen } from './app/StartScreen'
import { ErrorBoundary } from './app/ErrorBoundary'
import { PdfWorkerPool, type ApplyAndSaveResult, type PageLayoutTimings, type PreparedOutputResult } from './client/PdfWorkerPool'
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
import type { OrganizeSourceInfo } from './organize/OrganizeView'
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
    }
    launchQueue?: {
      setConsumer(consumer: (params: { files: PdfFileHandle[] }) => void): void
    }
  }
  interface Navigator { deviceMemory?: number }
}

export type OrganizeSplitMode =
  | { kind: 'every'; count: number }
  | { kind: 'before'; cardIds: string[] }

export interface OrganizeApplyTimings extends PageLayoutTimings {
  applyEditsMs: number
  mainUpdateMs: number
  totalMs: number
}

interface ActiveOrganize {
  docId: string
  draft: OrganizeDraft
  sources: Map<string, OrganizeSourceInfo>
  busy: boolean
}

const noopSubscribe = () => () => undefined
const zeroSnapshot = () => 0
const PANEL_STORAGE_KEY = 'karu-pdf:panels'

function workerCountFromUrl(): number {
  const value = Number(new URLSearchParams(location.search).get('workers') ?? '3')
  return Number.isFinite(value) ? Math.max(1, Math.min(3, Math.trunc(value))) : 3
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
  const updateServiceWorkerRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null)
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
  const [updateReady, setUpdateReady] = useState(false)
  const [debug, setDebug] = useState(() => new URLSearchParams(location.search).get('debug') === '1')
  const [workspaceFailure, setWorkspaceFailure] = useState(false)
  const testMode = new URLSearchParams(location.search).get('test') === '1'
  const active = tabs.active
  activeRef.current = active
  organizeRef.current = organize
  useSyncExternalStore(active?.annotationStore.subscribe ?? noopSubscribe, active?.annotationStore.getSnapshot ?? zeroSnapshot)

  const refreshTabs = useCallback(() => setTabsVersion((value) => value + 1), [])
  const refreshRecent = useCallback(() => void loadRecentFiles().then(setRecent), [])

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

  const showStatus = useCallback((message: string) => {
    setStatus(message)
    window.clearTimeout(statusTimerRef.current)
    statusTimerRef.current = window.setTimeout(() => setStatus(''), 5000)
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
    for (const sourceId of state.sources.keys()) pool.close(sourceId)
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
      busy: false,
    }
    organizeRef.current = next
    setOrganize(next)
    setTool('select')
  }, [])

  const addOrganizeFiles = useCallback(async (files: File[], beforeIndex: number) => {
    const current = organizeRef.current
    if (!current || current.busy) return
    let insertion = beforeIndex
    for (const file of files) {
      const sourceId = `src-${createDocId()}`
      try {
        const result = await pool.openSource(sourceId, await file.arrayBuffer())
        if (organizeRef.current !== current) {
          pool.close(sourceId)
          return
        }
        current.sources.set(sourceId, { docId: sourceId, name: file.name, pageSizes: result.pageSizes })
        current.draft.insertPages(insertion, sourceId, result.pageSizes)
        insertion += result.pageCount
        const next = { ...current, sources: new Map(current.sources) }
        organizeRef.current = next
        setOrganize(next)
      } catch (reason) {
        pool.close(sourceId)
        setError(`追加するPDFを開けませんでした: ${reason instanceof Error ? reason.message : String(reason)}`)
      }
    }
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
    const busyState = { ...current, busy: true }
    organizeRef.current = busyState
    setOrganize(busyState)
    setError('')
    try {
      const editsStarted = performance.now()
      await applyPendingEdits(session)
      const applyEditsMs = performance.now() - editsStarted
      const result = await pool.applyPageLayout(session.docId, current.draft.getCards(), [...current.sources.keys()])
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
    return pool.extractPages(session.docId, selectedCards(cardIds), [...current.sources.keys()])
  }, [applyPendingEdits, pool, selectedCards])

  const splitGroups = useCallback((mode: OrganizeSplitMode): PageLayoutCard[][] => {
    const current = organizeRef.current
    if (!current) throw new Error('ページ整理を開いてください。')
    const cards = [...current.draft.getCards()]
    if (mode.kind === 'every') {
      const count = Math.trunc(mode.count)
      if (count < 1) throw new Error('分割するページ数は1以上にしてください。')
      const groups: PageLayoutCard[][] = []
      for (let index = 0; index < cards.length; index += count) groups.push(cards.slice(index, index + count))
      return groups
    }
    const boundaries = new Set(mode.cardIds)
    const starts = cards.map((card, index) => boundaries.has(card.id) ? index : -1).filter((index) => index > 0)
    const points = [0, ...starts, cards.length]
    const groups = points.slice(0, -1).map((start, index) => cards.slice(start, points[index + 1])).filter((group) => group.length > 0)
    if (groups.length < 2) throw new Error('区切りにするページを選んでください。')
    return groups
  }, [])

  const splitToBytes = useCallback(async (mode: OrganizeSplitMode): Promise<Uint8Array[]> => {
    const current = organizeRef.current
    const session = activeRef.current
    if (!current || !session || current.docId !== session.docId) throw new Error('ページ整理を開いてください。')
    await applyPendingEdits(session)
    return pool.splitPages(session.docId, splitGroups(mode), [...current.sources.keys()])
  }, [applyPendingEdits, pool, splitGroups])

  const extractAndSave = useCallback(async (cardIds: string[]) => {
    const session = activeRef.current
    if (!session) return
    try {
      const bytes = await extractToBytes(cardIds)
      const fileName = `${session.name.replace(/\.pdf$/i, '')}_抜粋.pdf`
      const handle = window.showSaveFilePicker ? await pickSaveHandle(fileName) : null
      if (handle) await writePdf(handle, bytes)
      else downloadPdf(bytes, fileName)
      showStatus('選んだページを抽出しました')
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      setError(`抽出できませんでした: ${reason instanceof Error ? reason.message : String(reason)}`)
    }
  }, [extractToBytes, showStatus])

  const splitAndSave = useCallback(async (cardIds: string[]) => {
    const session = activeRef.current
    if (!session) return
    try {
      let mode: OrganizeSplitMode
      if (cardIds.length > 0 && window.confirm('選んだカードの前で区切りますか？\n「キャンセル」でNページごとに分割します。')) {
        mode = { kind: 'before', cardIds }
      } else {
        const raw = window.prompt('何ページごとに分割しますか？', '1')
        if (raw === null) return
        mode = { kind: 'every', count: Number(raw) }
      }
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
      else if (event.key === 'Escape') { setTool('select'); viewerRef.current?.clearSelection() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activateDocument, changeTool, closeDocument, discardOrganize, pickFile, printDocument, refreshTabs, saveDocument, tabs])

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
    }
    return () => { delete window.__karu }
  }, [activateDocument, applyOrganize, closeDocument, extractToBytes, openBuffer, openOrganize, pool, prepareOutput, saveToBytes, splitToBytes, tabs, undoLastOrganize])

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
    onAddFiles: addOrganizeFiles,
    onApply: () => void applyOrganize(),
    onCancel: () => { discardOrganize() },
    onExtract: (cardIds) => void extractAndSave(cardIds),
    onSplit: (cardIds) => void splitAndSave(cardIds),
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
      <header className="toolbar">
        <button type="button" onClick={() => void pickFile()}>開く</button>
        <button type="button" onClick={() => void saveDocument(false)} disabled={!active || saving || !!organize}>上書き保存</button>
        <button type="button" onClick={() => void saveDocument(true)} disabled={!active || saving || !!organize}>別名で保存</button>
        <button type="button" onClick={() => void saveFinalized()} disabled={!active || saving || !!organize}>確定して別名で保存</button>
        <button type="button" onClick={() => void printDocument()} disabled={!active || saving || !!organize}>印刷</button>
        <span className="toolbar-separator" />
        <button type="button" className={tool === 'select' ? 'active' : ''} aria-pressed={tool === 'select'} disabled={!active} onClick={() => void changeTool('select')}>選択</button>
        <button type="button" className={tool === 'text' ? 'active' : ''} aria-pressed={tool === 'text'} disabled={!active} onClick={() => void changeTool('text')}>文字</button>
        <button type="button" className={tool === 'callout' ? 'active' : ''} aria-pressed={tool === 'callout'} disabled={!active} onClick={() => void changeTool('callout')}>吹き出し</button>
        <button type="button" className={tool === 'line' ? 'active' : ''} aria-pressed={tool === 'line'} disabled={!active} onClick={() => void changeTool('line')}>線</button>
        <button type="button" className={tool === 'arrow' ? 'active' : ''} aria-pressed={tool === 'arrow'} disabled={!active} onClick={() => void changeTool('arrow')}>矢印</button>
        <button type="button" className={tool === 'square' ? 'active' : ''} aria-pressed={tool === 'square'} disabled={!active} onClick={() => void changeTool('square')}>四角</button>
        <button type="button" className={tool === 'circle' ? 'active' : ''} aria-pressed={tool === 'circle'} disabled={!active} onClick={() => void changeTool('circle')}>丸</button>
        <button type="button" className={tool === 'symbol' ? 'active' : ''} aria-pressed={tool === 'symbol'} disabled={!active} onClick={() => void changeTool('symbol')}>記号</button>
        <button type="button" className={tool === 'highlight' ? 'active' : ''} aria-pressed={tool === 'highlight'} disabled={!active} onClick={() => void changeTool('highlight')}>蛍光ペン</button>
        <button type="button" className={tool === 'ink' ? 'active' : ''} aria-pressed={tool === 'ink'} disabled={!active} onClick={() => void changeTool('ink')}>手書き</button>
        <span className="toolbar-separator" />
        <button type="button" disabled={!active?.annotationStore.canUndo()} onClick={() => { active?.annotationStore.undo(); viewerRef.current?.clearSelection(); refreshTabs() }}>元に戻す</button>
        <button type="button" disabled={!active?.annotationStore.canRedo()} onClick={() => { active?.annotationStore.redo(); viewerRef.current?.clearSelection(); refreshTabs() }}>やり直し</button>
        <span className="toolbar-separator" />
        <button type="button" aria-pressed={panels.thumbnails} onClick={() => updatePanels({ ...panels, thumbnails: !panels.thumbnails })}>ページ一覧</button>
        <button type="button" aria-pressed={panels.format} onClick={() => updatePanels({ ...panels, format: !panels.format })}>書式</button>
        <button type="button" disabled={!active || !!organize} onClick={() => void openOrganize()}>ページ整理</button>
        <button type="button" disabled={!active?.canUndoOrganize || !!organize || saving} onClick={() => void undoLastOrganize()}>ページ整理を元に戻す</button>
        <span className="toolbar-separator" />
        <button type="button" onClick={() => viewerRef.current?.zoomOut()} disabled={!active}>縮小</button>
        <button type="button" onClick={() => viewerRef.current?.zoomIn()} disabled={!active}>拡大</button>
        <button type="button" onClick={() => viewerRef.current?.fitWidth()} disabled={!active}>幅に合わせる</button>
        <output className="zoom-output">{Math.round(zoom * 100)}%</output>
        <button type="button" onClick={() => setHelpOpen(true)}>使い方</button>
        {testMode && <button type="button" data-testid="throw-workspace-error" onClick={() => setWorkspaceFailure(true)}>作業領域エラー</button>}
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
          debug={debug}
          onToolChange={setTool}
          onFormatDefaultsChange={updateFormatDefaults}
          onPageChange={(next) => { setPage(next); scheduleViewPersistence() }}
          onZoomChange={(next) => { setZoom(next); scheduleViewPersistence() }}
          onFirstBitmap={() => { openEndRef.current?.(); openEndRef.current = null }}
          onFirstSharp={() => { openSharpEndRef.current?.(); openSharpEndRef.current = null }}
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
    </main>
  )
}
