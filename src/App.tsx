import { QuantityNavigationContext } from './app/QuantityBreakdown'
import { DrawingInfoDialog } from './app/DrawingInfoDialog'
import { DrawingUiContext } from './app/documentModel'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { DocumentTabs } from './app/DocumentTabs'
import { commitFocusedField } from './app/pendingInput'
import { DocumentWorkspace } from './app/DocumentWorkspace'
import { loadSplitSettings, saveSplitSettings, type SplitSettings } from './app/SplitView'
import { prepareSplitDisplays } from './app/splitRendering'
import type { DocumentViewState } from './app/documentModel'
import type { ViewPosition } from './viewer/viewSync'
import type { OrganizeWorkspaceState } from './app/DocumentWorkspace'
import { HelpDialog } from './app/HelpDialog'
import { SymbolSearchContext, type SymbolSearchSelection } from './app/symbolSearchContext'
import { DesktopPromptBanner, DesktopStepsDialog, installedMessage, useInstallApp } from './app/InstallAppUi'
import { ExternalSendAlert } from './app/ExternalSendAlert'
import { getExternalSendRecords } from './security/externalSend'
import { MenuBar } from './app/MenuBar'
import { PrivacyDialog } from './app/PrivacyDialog'
import { SheetSizeDialog } from './app/SheetSizeDialog'
import { CompareDialog } from './app/CompareDialog'
import { CompareView } from './app/CompareView'
import { RasterizeDialog } from './app/RasterizeDialog'
import { ImagesToPdfDialog } from './app/ImagesToPdfDialog'
import { IMAGE_ACCEPT, isImageFile, pickImages } from './app/imageFiles'
import { ImageWorkerClient, createImagesPdf } from './client/ImageWorkerClient'
import type { ImagePdfSettings } from './core/imagePdfLayout'
import { HeaderFooterDialog } from './app/HeaderFooterDialog'
import type { HeaderFooterSettings } from './app/headerFooterText'
import { ScaleDialog } from './app/ScaleDialog'
import { ScaleInteractionContext, SnapContext } from './editor/MeasurementOverlay'
import { buildSnapIndex, findSnap } from './core/snap'
import { scaleLabel, ratioScale, pointInScaleRegion, MAX_SCALE_REGIONS, type ScaleRegion } from './core/measure'
import { ScaleRegionInteractionContext } from './editor/AnnotationLayer'
import type { Point, Rect } from './core/annotations'
import { ToolRow } from './app/ToolRow'
import { createDocId, DocumentSession, DocumentTabsModel, MAX_OPEN_DOCUMENTS, FixtureUiContext, SnapUiContext, ensureSessionFixtures, type SidePanelTab } from './app/documentModel'
import { allSessionAnnotations } from './app/AnnotationListPanel'
import { createIssueCsv, createCsv } from './app/annotationCsv'
import { StartScreen } from './app/StartScreen'
import { ErrorBoundary } from './app/ErrorBoundary'
import { PdfOpeningFeedback, PdfOpeningStore, type PdfOpening } from './app/PdfOpeningFeedback'
import { PdfWorkerPool, type ApplyAndSaveResult, type PageLayoutTimings, type PreparedOutputResult, type RasterizeMetrics } from './client/PdfWorkerPool'
import type { RasterizeOptions } from './core/rasterize'
import { BlobPdfWriteTarget, type PdfWriteTarget } from './core/pdfStreamWriter'
import { FixtureSampleContext, type EditorTool } from './editor/AnnotationLayer'
import { quantityKind, type CountFixtureSample } from './core/countFixtures'
import type { EditableAnnotation } from './editor/AnnotationStore'
import { annotationFilterLabel } from './editor/annotationFilter'
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
import { getFrameStats, isActiveTextEditorComposing, type FrameStats } from './editor/TextEditor'
import { getMetrics, resetBlankFrames, startMeasure } from './perf/metrics'
import type { ViewerHandle } from './viewer/Viewer'
import { OrganizeDraft } from './organize/OrganizeDraft'
import type { PageCard } from './organize/OrganizeDraft'
import type { ExtractOptions, OrganizeSourceInfo } from './organize/OrganizeView'
import { splitCardGroups, type OrganizeSplitMode } from './organize/organizeUtils'
import type { PageLayoutCard } from './core/pageOps'
import { registerPwa } from './pwa'
import './styles.css'

const FixtureDialog = lazy(() => import('./app/FixtureDialog'))
const SymbolSearchPanel = lazy(() => import('./app/SymbolSearchPanel'))

declare global {
  interface Window {
    __karu?: {
      getExternalSendRecords: typeof getExternalSendRecords
      snapVertexProbe(pageIndex: number, count?: number): unknown
      vectorProbe(pageIndex: number): Promise<{
        kind: import('./core/vectorPaths').PageKind; segmentCount: number; truncated: boolean
        stats: import('./core/vectorPaths').VectorPage['stats']; transferBytes: number
        endpointCount: number; endpointIndexMs: number
        snapQuery: { p50: number; p95: number; max: number }
      }>
      vectorSymbolSearch(request: { pageIndex: number; sampleRect: Rect; threshold?: number; rotations?: boolean }): Promise<{
        matches: import('./core/vectorSymbolSearch').VectorSymbolMatch[]; extractMs: number; searchMs: number
        template: { segments: number; length: number }
      }>
      seedSnapPerfVertices(pageIndex: number): void
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
      getSelectedAnnotationIds(): string[]
      getDrawingAnnotationIds(pageIndex: number): string[]
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
      exportIssueCsv(): string
      exportCsv(kinds: string[]): string
      getHeaderFooterSettings(): Promise<HeaderFooterSettings | null>
      applyHeaderFooter(settings: HeaderFooterSettings, dateText?: string): Promise<PageLayoutTimings | null>
      removeHeaderFooter(): Promise<PageLayoutTimings | null>
      setDrawingInfo(pageIndex: number, info: import('./core/drawingInfo').DrawingInfo): void
      getDrawingInfos(): (import('./core/drawingInfo').DrawingInfo | null)[]
      getDrawingScanMetrics(): { scanning: boolean; totalMs: number; pageMs: number[] }
      pageTextLines(pageIndex: number): ReturnType<PdfWorkerPool['pageTextLines']>
      exportDocumentBytes(): Promise<Uint8Array>
      imagesToPdfToBytes(files: File[], settings: ImagePdfSettings): Promise<Uint8Array>
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
  const rightViewsRef = useRef(new Map<string, DocumentViewState>())
  const rightPositionsRef = useRef(new Map<string, ViewPosition>())
  const swapPositionRef = useRef<{ docId: string; position: ViewPosition } | null>(null)
  const [split, setSplit] = useState(loadSplitSettings)
  const activeRef = useRef<DocumentSession | null>(null)
  const openEndRef = useRef<(() => number) | null>(null)
  const openSharpEndRef = useRef<(() => number) | null>(null)
  const statusTimerRef = useRef<number | undefined>(undefined)
  const viewSaveTimerRef = useRef<number | undefined>(undefined)
  const savingRef = useRef(false)
  const openQueueRef = useRef<Promise<void>>(Promise.resolve())
  const openingSequenceRef = useRef(0)
  const openingRef = useRef<PdfOpening | null>(null)
  const openingStoreRef = useRef<PdfOpeningStore | null>(null)
  if (!openingStoreRef.current) openingStoreRef.current = new PdfOpeningStore()
  const openingStore = openingStoreRef.current
  const openMeasuredDocRef = useRef<string | null>(null)
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
  const [drawingDialog, setDrawingDialog] = useState<{ session: DocumentSession; pageIndex: number } | null>(null)
  const [scaleDialog, setScaleDialog] = useState<{ session: DocumentSession; pageIndex: number; required: boolean; region?: ScaleRegion } | null>(null)
  const [scaleRegionDrawing, setScaleRegionDrawing] = useState<{ session: DocumentSession; pageIndex: number } | null>(null)
  const [scaleTracing, setScaleTracing] = useState(false)
  const [scalePoints, setScalePoints] = useState<Point[] | null>(null)
  const [sampleCapture, setSampleCapture] = useState<{ docId: string; busy: boolean; rect?: Rect; symbolFixtureId?: string; resolve(sample: CountFixtureSample | null): void } | null>(null)
  const [symbolSearch, setSymbolSearch] = useState<SymbolSearchSelection | null>(null)
  const symbolSearchDisposeRef = useRef<(() => void) | null>(null)
  const sampleCaptureRef = useRef<typeof sampleCapture>(null)
  const [sampleMessage, setSampleMessage] = useState('')
  const [tool, setTool] = useState<EditorTool>('select')
  const [snapEnabled, setSnapEnabled] = useState(() => { try { return localStorage.getItem('karu-pdf:snap') === '1' } catch { return false } })
  const toggleSnap = () => setSnapEnabled(value => { const next = !value; try { localStorage.setItem('karu-pdf:snap', next ? '1' : '0') } catch { /* 操作は続ける。 */ } return next })
  const [formatDefaults, setFormatDefaults] = useState<FormatDefaults>(() => loadFormatDefaults())
  const [panels, setPanels] = useState(loadPanels)
  const [recent, setRecent] = useState<RecentFile[]>([])
  const [error, setError] = useState('')
  const errorRef = useRef(error)
  errorRef.current = error
  const [runtimeError, setRuntimeError] = useState('')
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [organize, setOrganize] = useState<ActiveOrganize | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [desktopStepsOpen, setDesktopStepsOpen] = useState(false)
  const install = useInstallApp()
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [sheetSizesOpen, setSheetSizesOpen] = useState(false)
  const [compareDialog, setCompareDialog] = useState(false)
  const [comparison, setComparison] = useState<{ old: DocumentSession; next: DocumentSession } | null>(null)
  const [rasterizeOpen, setRasterizeOpen] = useState(false)
  const [imageFiles, setImageFiles] = useState<File[] | null>(null)
  const [headerFooterOpen, setHeaderFooterOpen] = useState(false)
  const [updateReady, setUpdateReady] = useState(false)
  const [debug, setDebug] = useState(() => new URLSearchParams(location.search).get('debug') === '1')
  const [workspaceFailure, setWorkspaceFailure] = useState(false)
  const [focusSearchVersion, setFocusSearchVersion] = useState(0)
  const testMode = new URLSearchParams(location.search).get('test') === '1'

  const beginOpening = useCallback((name: string, id = ++openingSequenceRef.current) => {
    const next: PdfOpening = { id, name, stage: 'reading', docId: null }
    openingRef.current = next
    openingStore.set(next)
    if (errorRef.current) setError('')
    return id
  }, [openingStore])
  const advanceOpening = useCallback((id: number, patch: Partial<PdfOpening>) => {
    if (openingRef.current?.id !== id) return
    const next = { ...openingRef.current, ...patch }
    openingRef.current = next
    openingStore.set(next)
  }, [openingStore])
  const finishOpening = useCallback((id: number) => {
    if (openingRef.current?.id !== id) return
    openingRef.current = null
    openingStore.set(null)
  }, [openingStore])
  const finishOpeningDocument = useCallback((docId: string) => {
    if (openingRef.current?.docId === docId) finishOpening(openingRef.current.id)
  }, [finishOpening])
  const failOpeningRender = useCallback((docId: string, reason: unknown) => {
    if (openingRef.current?.docId !== docId) return
    finishOpeningDocument(docId)
    setError(`ページを表示できませんでした: ${reason instanceof Error ? reason.message : String(reason)}`)
  }, [finishOpeningDocument])
  const active = tabs.active
  activeRef.current = active
  organizeRef.current = organize
  useSyncExternalStore(active?.annotationStore.subscribe ?? noopSubscribe, active?.annotationStore.getSnapshot ?? zeroSnapshot)
  useEffect(() => {
    if (scaleRegionDrawing && scaleRegionDrawing.session !== active) setScaleRegionDrawing(null)
  }, [active, scaleRegionDrawing])

  const openScale = (pageIndex: number, required = false, region?: ScaleRegion) => {
    const session = activeRef.current
    if (!session) return
    setScaleTracing(false); setScalePoints(null); setScaleRegionDrawing(null); setScaleDialog({ session, pageIndex, required, region })
  }
  const scaleTargets = (all: boolean) => {
    if (!scaleDialog) return []
    const size = scaleDialog.session.pageSizes[scaleDialog.pageIndex]
    return all ? scaleDialog.session.pageSizes.flatMap((p, i) => Math.abs(p.width - size.width) < .01 && Math.abs(p.height - size.height) < .01 ? [i] : []) : [scaleDialog.pageIndex]
  }
  const refreshTabs = useCallback(() => setTabsVersion((value) => value + 1), [])
  const rememberNavigation = useCallback(() => {
    const session = activeRef.current, viewer = viewerRef.current
    if (!session || !viewer) return
    session.viewHistory.remember(viewer.getViewPosition()); refreshTabs()
  }, [refreshTabs])
  const moveViewHistory = useCallback((direction: 'back' | 'forward') => {
    const session = activeRef.current, viewer = viewerRef.current
    if (!session || !viewer || organizeRef.current) return
    const position = session.viewHistory.move(direction, viewer.getViewPosition())
    if (position) viewer.applyViewPosition(position)
    refreshTabs()
  }, [refreshTabs])
  const updateSplit = useCallback((next: SplitSettings) => {
    setSplit(next)
    saveSplitSettings(next)
  }, [])
  const toggleSplit = useCallback(() => {
    const left = activeRef.current
    if (!left || organizeRef.current) return
    if (split.enabled) { updateSplit({ ...split, enabled: false }); return }
    const documents = tabs.list()
    const remembered = documents.find(doc => doc.docId === split.rightId)
      ?? documents.find(doc => doc.name === split.rightName)
    const index = documents.indexOf(left)
    const right = remembered ?? documents[(index + 1) % documents.length] ?? left
    updateSplit({ ...split, enabled: true, rightId: right.docId, rightName: right.name,
      synced: right === left ? false : remembered ? split.synced : true })
  }, [split, tabs, updateSplit])
  const refreshRecent = useCallback(() => loadRecentFiles().then(setRecent), [])
  const showStatus = useCallback((message: string) => {
    setStatus(message)
    window.clearTimeout(statusTimerRef.current)
    statusTimerRef.current = window.setTimeout(() => setStatus(''), 5000)
  }, [])

  useEffect(() => active?.annotationStore.subscribeDrawingFilterRelease(reason => {
    showStatus(`図面の絞り込みを解除しました（${reason}）`)
  }), [active, showStatus])

  const finishSampleCapture = useCallback((sample: CountFixtureSample | null) => {
    const pending = sampleCaptureRef.current
    sampleCaptureRef.current = null; setSampleCapture(null); setSampleMessage('')
    pending?.resolve(sample)
  }, [])
  const registerSymbolSearchDispose = useCallback((dispose: (() => void) | null) => { symbolSearchDisposeRef.current = dispose }, [])
  const releaseSymbolSearch = useCallback(() => {
    const dispose = symbolSearchDisposeRef.current; symbolSearchDisposeRef.current = null; dispose?.()
  }, [])
  const closeSymbolSearch = useCallback(() => {
    releaseSymbolSearch()
    setSymbolSearch(null)
    if (sampleCaptureRef.current?.symbolFixtureId) finishSampleCapture(null)
  }, [finishSampleCapture, releaseSymbolSearch])
  const startSymbolSearch = useCallback((session: DocumentSession, fixtureId: string) => {
    const fixture = session.annotationStore.getCountFixture(fixtureId)
    if (session !== activeRef.current || session.editRestriction || comparison || organizeRef.current || !fixture || quantityKind(fixture) !== 'count') return
    releaseSymbolSearch(); finishSampleCapture(null); setSymbolSearch(null); session.annotationStore.clearSymbolCandidates()
    session.annotationStore.selectFixture(fixtureId)
    const pageRevision = session.pageRevision, sideTab = session.sidePanelTab
    const pending: NonNullable<typeof sampleCapture> = { docId: session.docId, busy: false, symbolFixtureId: fixtureId, resolve: sample => {
      if (sample && pending.rect && activeRef.current === session && session.pageRevision === pageRevision && session.sidePanelTab === sideTab && !organizeRef.current && session.annotationStore.selectedFixtureId === fixtureId)
        setSymbolSearch({ session, fixtureId, sample, rect: pending.rect })
    } }
    sampleCaptureRef.current = pending; setSampleCapture(pending)
    setSampleMessage('探す記号を四角で囲んでください（Esc で中止）')
  }, [comparison, finishSampleCapture, releaseSymbolSearch])
  const requestFixtureSample = useCallback((): Promise<CountFixtureSample | null> => {
    const session = activeRef.current
    if (!session || session.editRestriction || comparison || organizeRef.current) return Promise.reject(new Error('通常の図面表示で見本を切り取ってください。'))
    finishSampleCapture(null)
    return new Promise(resolve => {
      const pending = { docId: session.docId, busy: false, resolve }
      sampleCaptureRef.current = pending; setSampleCapture(pending)
      setSampleMessage('切り取る範囲を四角で囲んでください（Esc で中止）')
    })
  }, [comparison, finishSampleCapture])
  const completeFixtureSample = useCallback((pageIndex: number, rect: import('./core/annotations').Rect) => {
    const pending = sampleCaptureRef.current
    if (!pending || pending.busy) return
    if (Math.min(rect[2] - rect[0], rect[3] - rect[1]) < 2 * 72 / 25.4) {
      setSampleMessage('範囲が小さすぎます。切り取る範囲を四角で囲んでください（Esc で中止）'); return
    }
    pending.rect = rect; pending.busy = true; setSampleMessage('見本の画像を作っています…（Esc で中止）')
    void pool.renderFixtureSample(pending.docId, pageIndex, rect).then(sample => {
      if (sampleCaptureRef.current === pending) finishSampleCapture(sample)
    }).catch(reason => {
      if (sampleCaptureRef.current !== pending) return
      pending.busy = false; setSampleMessage(`${String(reason)} 切り取る範囲を四角で囲んでください（Esc で中止）`)
    })
  }, [pool, finishSampleCapture])
  const fixtureSampleInteraction = useMemo(() => ({ request: requestFixtureSample, cancel: () => finishSampleCapture(null), selection: sampleCapture ? { docId: sampleCapture.docId, complete: completeFixtureSample } : null }), [requestFixtureSample, sampleCapture, completeFixtureSample, finishSampleCapture])
  useLayoutEffect(() => {
    finishSampleCapture(null)
    closeSymbolSearch()
    return () => finishSampleCapture(null)
  }, [active?.docId, active?.pageRevision, active?.sidePanelTab, comparison, organize, finishSampleCapture, closeSymbolSearch])
  useEffect(() => {
    const session = symbolSearch?.session ?? (sampleCapture?.symbolFixtureId ? active : null)
    const fixtureId = symbolSearch?.fixtureId ?? sampleCapture?.symbolFixtureId
    if (!session || !fixtureId) return
    const check = () => {
      const fixture = session.annotationStore.getCountFixture(fixtureId)
      if (session.annotationStore.selectedFixtureId !== fixtureId || !fixture || quantityKind(fixture) !== 'count') closeSymbolSearch()
    }
    check()
    return session.annotationStore.subscribe(check)
  }, [symbolSearch, sampleCapture, active, closeSymbolSearch])
  useEffect(() => {
    if (!sampleCapture) return
    const keyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return
      event.preventDefault(); event.stopImmediatePropagation()
      if (event.key === 'Escape') finishSampleCapture(null)
    }
    window.addEventListener('keydown', keyDown, true)
    return () => window.removeEventListener('keydown', keyDown, true)
  }, [sampleCapture, finishSampleCapture])

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

  const pasteAnnotations = useCallback(async () => {
    const session = activeRef.current
    const clipboard = annotationClipboardRef.current
    if (!session || !clipboard || clipboard.annotations.length === 0) return
    if (clipboard.annotations.some(a => a.issue)) {
      try { await session.annotationStore.issueNumbers.initialize(() => pool.maxIssueNumber(session.docId)) } catch (reason) { showStatus(`番号を取得できませんでした: ${String(reason)}`); return }
      if (activeRef.current !== session) return
    }
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

  const duplicateAnnotations = useCallback(async () => {
    const session = activeRef.current
    if (!session) return
    const annotations = session.annotationStore.copySelected()
    if (annotations.length === 0) return
    if (annotations.some(a => a.issue)) {
      try { await session.annotationStore.issueNumbers.initialize(() => pool.maxIssueNumber(session.docId)) } catch (reason) { showStatus(`番号を取得できませんでした: ${String(reason)}`); return }
      if (activeRef.current !== session) return
    }
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
      if (openingRef.current) {
        finishOpening(openingRef.current.id)
        setError('PDFの表示中に問題が起きました。開き直してください。')
      }
    }
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('未処理の Promise エラーが発生しました。', event.reason)
      setRuntimeError('画面の処理で問題が起きました。書き込みは保持されています。')
      if (openingRef.current) {
        finishOpening(openingRef.current.id)
        setError('PDFの表示中に問題が起きました。開き直してください。')
      }
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [finishOpening])

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
    if (session.handle) saveViewPosition(documentViewId(session.name, session.byteLength), session.view.page, session.view.zoom)
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
    closeSymbolSearch()
    await viewerRef.current?.commitEditor()
    persistView(current)
    await pool.activate(docId)
    if (!tabs.activate(docId)) return
    if (openingRef.current?.stage === 'displaying' && openingRef.current.docId !== docId) finishOpening(openingRef.current.id)
    const next = tabs.active
    activeRef.current = next
    setPage(next?.view.page ?? 0)
    setZoom(next?.view.zoom ?? 1)
    setTool('select')
    refreshTabs()
  }, [closeSymbolSearch, discardOrganize, finishOpening, persistView, pool, refreshTabs, tabs])

  const swapSplit = useCallback(async (right: DocumentSession, rightPosition: ViewPosition, leftPosition: ViewPosition) => {
    const left = activeRef.current
    if (!left) return
    if (right === left) return
    rightViewsRef.current.set(left.docId, { ...left.view })
    rightPositionsRef.current.set(left.docId, leftPosition)
    swapPositionRef.current = { docId: right.docId, position: rightPosition }
    await activateDocument(right.docId)
    if (activeRef.current?.docId !== right.docId) { swapPositionRef.current = null; return }
    updateSplit({ ...split, rightId: left.docId, rightName: left.name })
  }, [activateDocument, refreshTabs, split, updateSplit])

  useEffect(() => {
    const pending = swapPositionRef.current
    if (!pending || pending.docId !== active?.docId) return
    swapPositionRef.current = null
    viewerRef.current?.applyViewPosition(pending.position)
  }, [active?.docId])

  const openBuffer = useCallback(async (buffer: ArrayBuffer, name: string, handle: PdfFileHandle | null, created = false, signal?: AbortSignal, trackedId?: number) => {
    if (signal?.aborted) return
    const requestId = trackedId ?? beginOpening(name)
    const byteLength = buffer.byteLength
    let docId: string | null = null
    try {
      const duplicate = created ? null : await tabs.findDuplicate({ handle, name, byteLength })
      if (duplicate) {
        await activateDocument(duplicate.docId)
        finishOpening(requestId)
        return
      }
      if (tabs.list().length >= MAX_OPEN_DOCUMENTS) {
        finishOpening(requestId)
        setError('同時に開けるのは8ファイルまでです')
        return
      }
      setError('')
      setStatus('')
      resetBlankFrames()
      openEndRef.current = startMeasure('open')
      openSharpEndRef.current = startMeasure('open-sharp')
      docId = createDocId()
      openMeasuredDocRef.current = docId
      advanceOpening(requestId, { name, stage: 'opening', docId })
      const result = await pool.open(docId, buffer)
      if (signal?.aborted) {
        pool.close(docId)
        if (activeRef.current) await pool.activate(activeRef.current.docId)
        openEndRef.current = null; openSharpEndRef.current = null
        openMeasuredDocRef.current = null
        finishOpening(requestId)
        return
      }
      if (!result.pageCount) throw new Error('PDFにページがありません。')
      const remembered = handle ? loadViewPosition(documentViewId(name, byteLength)) : null
      const view = remembered ? {
        page: Math.min(remembered.page, result.pageCount),
        zoom: remembered.zoom,
      } : undefined
      const session = new DocumentSession({ docId, name, byteLength, handle, pageSizes: result.pageSizes, editRestriction: result.editRestriction, view })
      session.fileOutdated = created
      session.annotationStore.loadScales(result.pageScales ?? [])
      session.annotationStore.loadScaleRegions(result.pageScaleRegions ?? [])
      session.annotationStore.loadDrawingInfos(result.pageDrawingInfos ?? [])
      tabs.add(session)
      activeRef.current = session
      setPage(session.view.page)
      setZoom(session.view.zoom)
      setTool('select')
      refreshTabs()
      advanceOpening(requestId, { stage: 'displaying' })
      if (handle) {
        await saveLastOpenedHandle(handle, name)
        refreshRecent()
      }
    } catch (reason) {
      if (docId) pool.close(docId)
      if (openMeasuredDocRef.current === docId) {
        openEndRef.current = null
        openSharpEndRef.current = null
        openMeasuredDocRef.current = null
      }
      finishOpening(requestId)
      setError(`PDFを開けませんでした: ${reason instanceof Error ? reason.message : String(reason)}`)
      throw reason
    }
  }, [activateDocument, advanceOpening, beginOpening, finishOpening, pool, refreshRecent, refreshTabs, tabs])

  const enqueueOpen = useCallback((name: string, read: () => Promise<{ file: File; handle: PdfFileHandle | null }>): Promise<void> => {
    const requestId = ++openingSequenceRef.current
    if (!openingRef.current) beginOpening(name, requestId)
    const operation = openQueueRef.current.then(async () => {
      if (openingRef.current?.id !== requestId) beginOpening(name, requestId)
      try {
        const { file, handle } = await read()
        const duplicate = await tabs.findDuplicate({ handle, name: file.name, byteLength: file.size })
        if (duplicate) {
          await activateDocument(duplicate.docId)
          finishOpening(requestId)
          return
        }
        await openBuffer(await file.arrayBuffer(), file.name, handle, false, undefined, requestId)
      } catch (reason) {
        finishOpening(requestId)
        setError(`PDFを開けませんでした: ${reason instanceof Error ? reason.message : String(reason)}`)
        throw reason
      }
    })
    openQueueRef.current = operation.catch(() => undefined)
    return operation
  }, [activateDocument, beginOpening, finishOpening, openBuffer, tabs])

  const openFile = useCallback((file: File, handle: PdfFileHandle | null = null) => enqueueOpen(file.name, async () => ({ file, handle })), [enqueueOpen])
  const openHandle = useCallback((handle: PdfFileHandle) => enqueueOpen(handle.name ?? 'PDF', async () => ({ file: await handle.getFile(), handle })), [enqueueOpen])

  useEffect(() => {
    window.launchQueue?.setConsumer((params) => {
      void (async () => {
        for (const handle of params.files) {
          try {
            await openHandle(handle)
          } catch (reason) {
            setError(`PDFを開けませんでした: ${reason instanceof Error ? reason.message : String(reason)}`)
          }
        }
      })()
    })
  }, [openHandle])

  const closeDocument = useCallback(async (docId: string, confirmDirty = true) => {
    commitFocusedField()
    const documents = tabs.list()
    const index = documents.findIndex((document) => document.docId === docId)
    const session = documents[index]
    if (!session) return
    if (organizeRef.current?.docId === docId && !discardOrganize(confirmDirty)) return
    if (activeRef.current?.docId === docId) await viewerRef.current?.commitEditor()
    if (confirmDirty && session.dirty && !window.confirm(`「${session.name}」に保存していない変更があります（${session.dirtyDescription()}）。\n保存せずに閉じますか？`)) return
    if (activeRef.current?.docId === docId) closeSymbolSearch()
    if (activeRef.current?.docId === docId) {
      persistView(session)
      const next = documents[index + 1] ?? documents[index - 1] ?? null
      if (next) await pool.activate(next.docId)
    }
    tabs.list().find(s => s.docId === docId)?.cancelDrawingScan()
    tabs.close(docId)
    pool.close(docId)
    finishOpeningDocument(docId)
    const next = tabs.active
    activeRef.current = next
    setPage(next?.view.page ?? 0)
    setZoom(next?.view.zoom ?? 1)
    setTool('select')
    refreshTabs()
  }, [closeSymbolSearch, discardOrganize, finishOpeningDocument, persistView, pool, refreshTabs, tabs])

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
    commitFocusedField()
    const session = activeRef.current
    if (!session || !beginSave()) return null
    try {
      await viewerRef.current?.commitEditor()
      if (session.dirty && (session.annotationStore.fixturesReady || session.annotationStore.hasCountMarks())) await ensureSessionFixtures(session, pool)
      const edits = session.annotationStore.toEdits()
      const result = await pool.applyAndSave(session.docId, edits, session.nextSaveMode())
      if (result.errors.length > 0) throw new Error(result.errors.map(item => item.message).join(' / '))
      session.fileOutdated = true
      session.annotationStore.markApplied(result)
      session.recordSavedRendering(edits, result.errors)
      session.recordSave(result.mode, result.bytes.byteLength)
      if (split.enabled && !organizeRef.current) await prepareSplitDisplays(pool, session, session, () => false)
      session.fileOutdated = true
      viewerRef.current?.clearSelection()
      refreshTabs()
      if (result.errors.length > 0) throw new Error(result.errors.map((item) => item.message).join(' / '))
      if (result.unsupportedCharacters.length > 0) showStatus(saveMessage(result))
      return { bytes: result.bytes, result }
    } finally {
      endSave()
    }
  }, [beginSave, endSave, pool, refreshTabs, showStatus, split.enabled])

  const saveDocument = useCallback(async (saveAs: boolean) => {
    commitFocusedField()
    const session = activeRef.current
    if (!session || !beginSave()) return
    setError('')
    try {
      let handle = saveAs ? null : session.handle
      const needsDestination = saveAs || !handle
      if (needsDestination && window.showSaveFilePicker) handle = await pickSaveHandle(session.name, session.handle ?? undefined)
      if (!needsDestination && handle && !await requestWritePermission(handle)) {
        throw new Error('ファイルへの書き込みが許可されませんでした。')
      }
      await viewerRef.current?.commitEditor()
      if (session.dirty && (session.annotationStore.fixturesReady || session.annotationStore.hasCountMarks())) await ensureSessionFixtures(session, pool)
      const edits = session.annotationStore.toEdits()
      const result = await pool.applyAndSave(session.docId, edits, session.nextSaveMode())
      if (result.errors.length > 0) throw new Error(result.errors.map(item => item.message).join(' / '))
      session.fileOutdated = true
      session.annotationStore.markApplied(result)
      session.recordSavedRendering(edits, result.errors)
      session.recordSave(result.mode, result.bytes.byteLength)
      if (split.enabled && !organizeRef.current) await prepareSplitDisplays(pool, session, session, () => false)
      session.fileOutdated = true
      if (handle) {
        await writePdf(handle, result.bytes)
        session.rebindToFile(handle, handle.name ?? session.name, result.bytes.byteLength)
        session.fileOutdated = false
      } else {
        downloadPdf(result.bytes, session.name)
        session.fileOutdated = false
      }
      viewerRef.current?.clearSelection()
      refreshTabs()
      const postSaveFailures: string[] = []
      const recordFailure = (reason: unknown) => postSaveFailures.push(reason instanceof Error ? reason.message : String(reason))
      if (handle) {
        try { await saveLastOpenedHandle(handle, session.name) } catch (reason) { recordFailure(reason) }
        try { persistView(session) } catch (reason) { recordFailure(reason) }
        try { if (split.rightId === session.docId) updateSplit({ ...split, rightName: session.name }) } catch (reason) { recordFailure(reason) }
        try { await refreshRecent() } catch (reason) { recordFailure(reason) }
      }
      showStatus(postSaveFailures.length
        ? `保存しました（最近使ったファイルの記録に失敗しました: ${postSaveFailures.join(' / ')}）`
        : saveMessage(result))
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      setError(`保存できませんでした: ${reason instanceof Error ? reason.message : String(reason)}`)
    } finally {
      endSave()
    }
  }, [beginSave, endSave, persistView, pool, refreshRecent, refreshTabs, showStatus, split, updateSplit])

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
        for (const handle of handles) await openHandle(handle)
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
          setError(`PDFを開けませんでした: ${reason instanceof Error ? reason.message : String(reason)}`)
        }
      }
      return
    }
    document.querySelector<HTMLInputElement>('[data-testid="file-input"]')?.click()
  }, [openHandle])

  const pickImageFiles = async () => {
    try {
      const chosen = await pickImages(() => document.querySelector<HTMLInputElement>('[data-testid="image-file-input"]')?.click())
      if (chosen.length) setImageFiles(chosen)
    } catch (reason) { if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError(String(reason)) }
  }

  const changeTool = useCallback(async (next: EditorTool) => {
    await viewerRef.current?.commitEditor()
    const session = activeRef.current
    if (session?.editRestriction && next !== 'select') { showStatus(session.editRestriction); return }
    if (next === 'issue' && session) {
      try { await session.annotationStore.issueNumbers.initialize(() => pool.maxIssueNumber(session.docId)) } catch (reason) { showStatus(`番号を取得できませんでした: ${String(reason)}`); return }
      if (activeRef.current !== session) return
    }
    if (next === 'count' && session) {
      try { await ensureSessionFixtures(session, pool) } catch (reason) { showStatus(String(reason)); return }
      if (activeRef.current !== session) return
      session.annotationStore.prepareCountTool()
      window.dispatchEvent(new CustomEvent('karu-pdf:open-fixtures'))
    }
    if (next !== 'select') session?.annotationStore.clearSelection()
    setTool(next)
  }, [pool, showStatus])

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
  const [fixtureEdit, setFixtureEdit] = useState<{ session: DocumentSession; id: string } | null>(null)
  useEffect(() => {
    const open = () => openSidePanel('fixtures', false)
    window.addEventListener('karu-pdf:open-fixtures', open)
    return () => window.removeEventListener('karu-pdf:open-fixtures', open)
  }, [openSidePanel])

  const updateFormatDefaults = useCallback((next: FormatDefaults) => {
    setFormatDefaults(next)
    saveFormatDefaults(next)
  }, [])

  const applyPendingEdits = useCallback(async (session: DocumentSession) => {
    commitFocusedField()
    await viewerRef.current?.commitEditor()
    const wasDirty = session.dirty
    const edits = session.annotationStore.toEdits()
    if (edits.length === 0) return
    const result = await pool.applyEdits(session.docId, edits)
    if (result.errors.length) throw new Error(result.errors.map(item => item.message).join(' / '))
    session.fileOutdated ||= wasDirty
    session.annotationStore.markApplied(result)
    session.recordSavedRendering(edits, result.errors)
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

  const finishPageLayout = useCallback((session: DocumentSession, result: { pageSizes: typeof session.pageSizes; hasBackup: boolean; pageScales?: (import('./core/measure').PageScale | null)[]; pageScaleRegions?: Array<[number, ScaleRegion[]]>; pageDrawingInfos?: (import('./core/drawingInfo').DrawingInfo | null)[] }) => {
    const reloadFixtures = session.annotationStore.fixturesReady
    session.updateAfterPageLayout(result.pageSizes, result.hasBackup, result.pageScales, result.pageDrawingInfos, result.pageScaleRegions)
    activeRef.current = session
    setPage(session.view.page)
    setZoom(session.view.zoom)
    refreshTabs()
    if (reloadFixtures) void ensureSessionFixtures(session, pool).catch(reason => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }, [refreshTabs, pool])

  const applyOrganize = useCallback(async (): Promise<OrganizeApplyTimings | null> => {
    const totalStarted = performance.now()
    const current = organizeRef.current
    const session = activeRef.current
    if (!current || !session || current.docId !== session.docId || current.busy) return null
    session.cancelDrawingScan()
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
      const hadHeaderFooter = await pool.getHeaderFooterSettings(session.docId).then(Boolean)
      const editsStarted = performance.now()
      await applyPendingEdits(session)
      const applyEditsMs = performance.now() - editsStarted
      const result = await pool.applyPageLayout(session.docId, current.draft.getCards(), sourceIdsForCards(session.docId, current.draft.getCards()))
      const mainUpdateStarted = performance.now()
      finishPageLayout(session, result)
      closeOrganizeSources(current)
      organizeRef.current = null
      setOrganize(null)
      showStatus(hadHeaderFooter ? 'ページの並びが変わりました。ページ番号を付け直すときは、ページ▼ → ページ番号・ヘッダー・フッター で［適用］を押してください' : 'ページ整理を適用しました')
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
      showStatus('直前のページ操作を元に戻しました')
    } catch (reason) {
      setError(`直前のページ操作を元に戻せませんでした: ${reason instanceof Error ? reason.message : String(reason)}`)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [finishPageLayout, pool, showStatus])

  const applyHeaderFooterSettings = useCallback(async (settings: HeaderFooterSettings, dateText: string): Promise<PageLayoutTimings | null> => {
    const session = activeRef.current
    if (!session || savingRef.current || organizeRef.current) return null
    savingRef.current = true; setSaving(true); setError('')
    try {
      await applyPendingEdits(session)
      const result = await pool.applyHeaderFooter(session.docId, settings, session.name, dateText)
      finishPageLayout(session, result)
      setHeaderFooterOpen(false)
      showStatus('ページ番号・ヘッダー・フッターを適用しました')
      return result.timings
    } catch (reason) {
      setError(`ページ番号・ヘッダー・フッターを適用できませんでした: ${reason instanceof Error ? reason.message : String(reason)}`)
      throw reason
    } finally { savingRef.current = false; setSaving(false) }
  }, [applyPendingEdits, finishPageLayout, pool, showStatus])

  const removeHeaderFooterSettings = useCallback(async (): Promise<PageLayoutTimings | null> => {
    const session = activeRef.current
    if (!session || savingRef.current || organizeRef.current) return null
    savingRef.current = true; setSaving(true); setError('')
    try {
      await applyPendingEdits(session)
      const result = await pool.removeHeaderFooter(session.docId)
      finishPageLayout(session, result)
      setHeaderFooterOpen(false)
      showStatus('ページ番号・ヘッダー・フッターを削除しました')
      return result.timings
    } catch (reason) {
      setError(`ページ番号・ヘッダー・フッターを削除できませんでした: ${reason instanceof Error ? reason.message : String(reason)}`)
      throw reason
    } finally { savingRef.current = false; setSaving(false) }
  }, [applyPendingEdits, finishPageLayout, pool, showStatus])

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
      if (comparison) return
      const target = event.target as HTMLElement | null
      const isInput = target?.matches('input, textarea, select, [contenteditable="true"]') ?? false
      const key = event.key.toLowerCase()
      if (!isInput && activeRef.current?.editRestriction && ((event.ctrlKey || event.metaKey) && ['s', 'x', 'v', 'd', 'z', 'y'].includes(key) || ['delete', 'backspace'].includes(key))) {
        event.preventDefault(); showStatus(activeRef.current.editRestriction); return
      }
      const organizing = organizeRef.current
      if (event.key === '[' || event.key === ']') {
        if (isInput || target?.closest('[contenteditable="true"]') || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing || organizing || document.querySelector('[role="menu"], dialog[open], [role="dialog"]')) return
        const session = activeRef.current
        if (!session || session.editRestriction || !session.annotationStore.fixturesReady) return
        event.preventDefault()
        // Load the picker only on demand; use the same grouped order as the bar.
        void import('./app/fixtureQuickList').then(({ adjacentPickupFixture }) => {
          if (activeRef.current !== session || organizeRef.current) return
          const next = adjacentPickupFixture(session.annotationStore, event.key === '[' ? -1 : 1)
          if (next) { session.annotationStore.selectFixture(next.id); void changeTool('count') }
        })
        return
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.isComposing && !isActiveTextEditorComposing() && !isInput && !organizing && !document.querySelector('[role="menu"], dialog[open], [role="dialog"]') && (key === 'arrowleft' || key === 'arrowright') && target?.closest('.viewer')) {
        event.preventDefault(); moveViewHistory(key === 'arrowleft' ? 'back' : 'forward'); return
      }
      if (event.key === 'Escape') {
        if (event.isComposing || isActiveTextEditorComposing()) return
        // メニューは document の capture で閉じる。ダイアログは自身の
        // cancel / keydown に任せ、背後の道具や選択には触れない。
        if (document.querySelector('[role="menu"], dialog[open], [role="dialog"]')) return
        event.preventDefault()
        if (organizing) { discardOrganize(); return }
        if (scaleRegionDrawing) { setScaleRegionDrawing(null); return }
        if (scaleTracing) { setScaleTracing(false); setScalePoints(null); return }
        const viewer = viewerRef.current
        target?.blur()
        void (async () => {
          await viewer?.commitEditor()
          viewer?.clearSelection()
          setTool('select')
        })()
        return
      }
      if (event.ctrlKey && (event.key === '\\' || event.code === 'Backslash')) {
        event.preventDefault()
        toggleSplit()
        return
      }
      if (organizing && !isInput) {
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
      else if (key === 'n') void changeTool('issue')
      else if (key === 'q') void changeTool('count')
      else if (key === 'k') void changeTool('distance')
      else if (key === 'm') void changeTool('textSelect')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [comparison, scaleTracing, scaleRegionDrawing, activateDocument, changeTool, closeDocument, copyAnnotations, cutAnnotations, discardOrganize, duplicateAnnotations, moveViewHistory, openSidePanel, pasteAnnotations, pickFile, printDocument, refreshTabs, saveDocument, showStatus, tabs, toggleSplit])

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      commitFocusedField()
      const dirtyDocuments = tabs.list().filter(session => session.dirty)
      if (dirtyDocuments.length) {
        event.preventDefault()
        event.returnValue = ''
        showStatus(`保存していない変更があるPDF: ${dirtyDocuments.map(session => session.name).join('、')}`)
      }
      persistView()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [persistView, showStatus, tabs])

  useEffect(() => {
    if (new URLSearchParams(location.search).get('test') !== '1') return
    window.__karu = {
      vectorProbe: async pageIndex => {
        const session = tabs.active, size = session?.pageSizes[pageIndex]
        if (!session || !size) throw Error('No page')
        const { classifyPage, segmentEndpoints } = await import('./core/vectorPaths')
        performance.mark('karu-vector-extract-start')
        const page = await pool.extractVectors({ docId: session.docId, pageIndex }).promise
        performance.mark('karu-vector-extract-end')
        const endpoints = segmentEndpoints(page.segments)
        const start = performance.now(), index = buildSnapIndex(endpoints, [0, 0, size.width, size.height]), endpointIndexMs = performance.now() - start
        const samples: number[] = []
        // Same timer-resolution compensation as snapVertexProbe: 1000 batches
        // of 100 queries, reporting time per query (including an empty page).
        for (let i = 0; i < 1000; i++) {
          const p = endpoints[i % endpoints.length] ?? [0, 0], t = performance.now()
          for (let n = 0; n < 100; n++) findSnap([p[0] + .3, p[1] + .3], 1.5, index)
          samples.push((performance.now() - t) / 100)
        }
        samples.sort((a, b) => a - b)
        return { kind: classifyPage(page), segmentCount: page.segmentCount, truncated: page.truncated, stats: page.stats,
          transferBytes: page.segments.byteLength, endpointCount: endpoints.length, endpointIndexMs,
          snapQuery: { p50: samples[499], p95: samples[949], max: samples[999] } }
      },
      vectorSymbolSearch: async request => {
        const session = tabs.active
        if (!session?.pageSizes[request.pageIndex]) throw Error('No page')
        const { vectorSymbolSearch } = await import('./core/vectorSymbolSearch')
        const start = performance.now(), page = await pool.extractVectors({ docId: session.docId, pageIndex: request.pageIndex }).promise
        const extractMs = performance.now() - start
        const result = vectorSymbolSearch(page.segments, request.sampleRect, { threshold: request.threshold, rotations: request.rotations })
        return { matches: result.matches, extractMs, searchMs: result.stats.ms, template: result.template }
      },
      // SPEC-06h-1: test-only, demand-loaded, disposable visual-search prototype.
      ...(() => {
        const run = async (request: import('./client/SymbolSearchClient').SymbolSearchRequest, afterMs?: number) => {
          if (afterMs !== undefined && (!Number.isFinite(afterMs) || afterMs < 0)) throw new Error('invalid cancellation delay')
          const { SymbolSearchClient } = await import('./client/SymbolSearchClient')
          if (!tabs.list().some(s => s.docId === request.docId)) throw new Error('PDF is closed')
          const client = new SymbolSearchClient(pool, (docId, index) => tabs.list().find(s => s.docId === docId)?.pageSizes[index])
          const task = client.search(request)
          let cancelledAt: number | undefined
          const timer = afterMs === undefined ? undefined : window.setTimeout(() => { cancelledAt = performance.now(); task.cancel() }, afterMs)
          // The pool has no close subscription; watch only while an explicit test search runs.
          const closed = window.setInterval(() => { if (!window.__karu || !tabs.list().some(s => s.docId === request.docId)) client.dispose() }, 50)
          try {
            const result = await task.promise
            return afterMs === undefined ? result : { cancelled: false, settledMs: 0 }
          } catch (error) {
            if (afterMs !== undefined && cancelledAt !== undefined && error instanceof Error && error.message === 'cancelled') {
              return { cancelled: true, settledMs: performance.now() - cancelledAt }
            }
            throw error
          } finally { if (timer !== undefined) clearTimeout(timer); clearInterval(closed); client.dispose() }
        }
        return {
          symbolSearch: (request: import('./client/SymbolSearchClient').SymbolSearchRequest) => run(request) as Promise<import('./client/SymbolSearchClient').SymbolSearchResult>,
          symbolSearchCancelTest: (request: import('./client/SymbolSearchClient').SymbolSearchRequest, afterMs: number) => run(request, afterMs) as Promise<{ cancelled: boolean; settledMs: number }>,
        }
      })(),
      seedSnapPerfVertices: pageIndex => {
        const session = tabs.active, size = session?.pageSizes[pageIndex]
        const scale = session?.annotationStore.getScale(pageIndex)
        if (!session || !size || !scale) throw Error('No scaled page')
        const vertices: Point[] = Array.from({ length: 1000 }, (_, i) => [(i % 50) * size.width / 50, Math.floor(i / 50) * size.height / 20])
        session.annotationStore.create({ pageIndex, kind: 'perimeter', vertices, measure: { ...scale, kind: 'perimeter' }, text: '', rect: [0, 0, size.width, size.height], color: [.3, .3, .3], fontSize: 10, borderWidth: 1, opacity: 1 })
      },
      snapVertexProbe: (pageIndex, count = 1000) => {
        const size = tabs.active?.pageSizes[pageIndex]
        if (!size) throw Error('No page')
        const vertices: Point[] = Array.from({ length: count }, (_, i) => [(i % 100) * size.width / 100, Math.floor(i / 100) * size.height / Math.ceil(count / 100)])
        const start = performance.now(), index = buildSnapIndex(vertices, [0, 0, size.width, size.height]), indexMs = performance.now() - start
        const samples: number[] = []
        for (let i = 0; i < 1000; i++) {
          const p = vertices[i % count], t = performance.now()
          for (let n = 0; n < 100; n++) findSnap([p[0] + .3, p[1] + .3], 1.5, index)
          samples.push((performance.now() - t) / 100)
        }
        samples.sort((a, b) => a - b)
        return { index, count, indexMs, bytes: index.bytes, p50: samples[499], p95: samples[949], max: samples[999] }
      },
      getExternalSendRecords,
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
      getSelectedAnnotationIds: () => activeRef.current?.annotationStore.selectedIds() ?? [],
      getDrawingAnnotationIds: (pageIndex) => {
        const store = activeRef.current?.annotationStore
        if (!store) return []
        return store.getPageAnnotations(pageIndex).filter(a => store.isShownOnDrawing(a)).map(a => a.id)
      },
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
      exportIssueCsv: () => { const session = activeRef.current; return session ? createIssueCsv(allSessionAnnotations(session)) : '' },
      exportCsv: (kinds) => { const session = activeRef.current; return session ? createCsv(allSessionAnnotations(session), kinds, { fixtures: session.annotationStore.getCountFixtures(), drawingInfo: i => session.annotationStore.getDrawingInfo(i) }) : '' },
      exportAnnotationCsv: () => {
        const session = activeRef.current
        return session ? createCsv(allSessionAnnotations(session), ['issue', 'count', 'text', 'callout', 'measure', 'shape', 'symbol', 'pen', 'markup'], { fixtures: session.annotationStore.getCountFixtures(), drawingInfo: i => session.annotationStore.getDrawingInfo(i) }) : ''
      },
      getHeaderFooterSettings: () => activeRef.current ? pool.getHeaderFooterSettings(activeRef.current.docId) : Promise.resolve(null),
      applyHeaderFooter: (settings, dateText = '2026年10月1日') => applyHeaderFooterSettings(settings, dateText),
      removeHeaderFooter: removeHeaderFooterSettings,
      setDrawingInfo: (pageIndex, info) => activeRef.current?.annotationStore.setDrawingInfo([pageIndex], info),
      getDrawingInfos: () => { const s = activeRef.current; return s ? s.pageSizes.map((_, i) => s.annotationStore.getDrawingInfo(i)) : [] },
      getDrawingScanMetrics: () => { const s = activeRef.current; return { scanning: s?.drawingScanning ?? false, totalMs: s?.drawingScanMs ?? 0, pageMs: s?.drawingPageMs.slice() ?? [] } },
      pageTextLines: (pageIndex) => {
        const session = activeRef.current
        return session ? pool.pageTextLines(session.docId, pageIndex) : Promise.resolve([])
      },
      exportDocumentBytes: () => {
        const session = activeRef.current
        return session ? pool.exportDocumentBytes(session.docId) : Promise.resolve(new Uint8Array())
      },
      imagesToPdfToBytes: async (files, settings) => {
        const client = new ImageWorkerClient()
        try {
          const entries = []
          for (const file of files) entries.push({ file, info: await client.request(file, 'inspect') })
          return await createImagesPdf(client, entries, settings)
        } finally { client.dispose() }
      },
    }
    return () => { delete window.__karu }
  }, [activateDocument, applyHeaderFooterSettings, applyOrganize, closeDocument, extractToBytes, openBuffer, openOrganize, pool, prepareOutput, rasterizeToBytes, rasterizeToTarget, removeHeaderFooterSettings, saveToBytes, splitToBytes, tabs, undoLastOrganize])

  const openRecent = async (item: RecentFile) => {
    try {
      await enqueueOpen(item.name, async () => {
        if (item.handle.requestPermission && await item.handle.requestPermission({ mode: 'read' }) !== 'granted') throw new Error('ファイルを開く許可が得られませんでした。')
        return { file: await item.handle.getFile(), handle: item.handle }
      })
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
    const files = [...event.dataTransfer.files]
    const images = files.filter(isImageFile)
    const operations: Promise<void>[] = []
    for (let index = 0; index < files.length; index += 1) {
      if (!(files[index].type === 'application/pdf' || /\.pdf$/i.test(files[index].name))) continue
      const item = event.dataTransfer.items[index] as (DataTransferItem & { getAsFileSystemHandle?: () => Promise<PdfFileHandle> }) | undefined
      // Request native handles during the drop event, before its protected data
      // becomes unavailable. File reads and PDF opens remain serialized.
      const handle = item?.getAsFileSystemHandle ? item.getAsFileSystemHandle() : Promise.resolve(null)
      void handle.catch(() => undefined)
      const file = files[index]
      operations.push(enqueueOpen(file.name, async () => ({ file, handle: await handle })))
    }
    await Promise.allSettled(operations)
    if (images.length) setImageFiles(images)
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
    onImageDrop: setImageFiles,
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
    <SymbolSearchContext.Provider value={{ start: startSymbolSearch }}>
    <FixtureSampleContext.Provider value={fixtureSampleInteraction}>
    <SnapUiContext.Provider value={{ enabled: snapEnabled, toggle: toggleSnap }}>
    <main className={`app${comparison ? ' comparing' : ''}${updateReady ? ' update-ready' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { if (!comparison) void handleDrop(event).catch(reason => setError(`PDFを開けませんでした: ${String(reason)}`)) }}>
      {sampleCapture && <div className="fixture-sample-instruction" role="status">{sampleMessage}<button type="button" onClick={() => finishSampleCapture(null)}>中止</button></div>}
      {updateReady && (
        <div className="update-banner" role="status">
          {/* @pages:start */}<span>新しい版があります。</span>{/* @pages:end */}{/* @fixed:start */}<span>管理者が配布物を更新しました。再読み込みすると新しい版に切り替わります</span>{/* @fixed:end */}
          <button type="button" onClick={() => void applyUpdate()}>更新する</button>
        </div>
      )}
      {!comparison && <><DocumentTabs
        documents={documents}
        activeDocId={active?.docId ?? null}
        onActivate={(docId) => void activateDocument(docId)}
        onClose={(docId) => void closeDocument(docId)}
        onOpen={() => void pickFile()}
      />
      <div className="top-controls">
        <MenuBar
          editRestriction={active?.editRestriction}
          onPrivacy={() => setPrivacyOpen(true)}
          onSheetSizes={() => setSheetSizesOpen(true)}
          canViewBack={active?.viewHistory.canBack ?? false}
          canViewForward={active?.viewHistory.canForward ?? false}
          onViewBack={() => moveViewHistory('back')}
          onViewForward={() => moveViewHistory('forward')}
          fileName={active?.name ?? null}
          dirty={active?.dirty ?? false}
          dirtyDescription={active?.dirtyDescription() ?? ''}
          hasDocument={!!active}
          saving={saving}
          organizing={!!organize}
          canUndo={active?.annotationStore.canUndo() ?? false}
          canRedo={active?.annotationStore.canRedo() ?? false}
          showThumbnails={panels.thumbnails}
          sidePanelTab={active?.sidePanelTab ?? 'pages'}
          showFormat={panels.format}
          splitEnabled={split.enabled && !organize}
          onToggleSplit={toggleSplit}
          onCompare={() => setCompareDialog(true)}
          canUndoOrganize={active?.canUndoOrganize ?? false}
          onOpen={() => void pickFile()}
          onImagesToPdf={() => void pickImageFiles()}
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
          onHeaderFooter={() => setHeaderFooterOpen(true)}
          onUndoOrganize={() => void undoLastOrganize()}
          onHelp={() => setHelpOpen(true)}
          onDesktopSteps={() => setDesktopStepsOpen(true)}
        />
        <ToolRow
          readOnly={!!active?.editRestriction}
          tool={tool}
          hasDocument={!!active}
          zoom={zoom}
          canUndo={active?.annotationStore.canUndo() ?? false}
          canRedo={active?.annotationStore.canRedo() ?? false}
          onToolChange={(next) => void changeTool(next)}
          onScale={() => openScale(page - 1)}
          onAddScaleRegion={() => {
            const session = activeRef.current
            if (!session) return
            const pageIndex = page - 1
            if (session.annotationStore.getScaleRegions(pageIndex).length >= MAX_SCALE_REGIONS) { showStatus('縮尺の範囲は1ページに20個までです'); return }
            void viewerRef.current?.commitEditor().then(() => {
              if (activeRef.current !== session) return
              viewerRef.current?.clearSelection()
              setScaleDialog(null); setScaleTracing(false); setScalePoints(null)
              setScaleRegionDrawing({ session, pageIndex }); viewerRef.current?.scrollToPage(pageIndex)
            })
          }}
          onUndo={() => { active?.annotationStore.undo(); viewerRef.current?.clearSelection(); refreshTabs() }}
          onRedo={() => { active?.annotationStore.redo(); viewerRef.current?.clearSelection(); refreshTabs() }}
          onZoomIn={() => viewerRef.current?.zoomIn()}
          onZoomOut={() => viewerRef.current?.zoomOut()}
          onSetZoom={(next) => viewerRef.current?.setZoom(next)}
          onFitWidth={() => viewerRef.current?.fitWidth()}
        />
        {testMode && <button type="button" className="test-error-button" data-testid="throw-workspace-error" onClick={() => setWorkspaceFailure(true)}>作業領域エラー</button>}
        <DesktopPromptBanner onShowSteps={() => setDesktopStepsOpen(true)} />
      </div></>}
      <input
        hidden
        multiple
        type="file"
        accept="application/pdf,.pdf"
        data-testid="file-input"
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])]
          void (async () => { for (const file of files) await openFile(file).catch(() => undefined) })()
          event.currentTarget.value = ''
        }}
      />
      <input hidden multiple type="file" accept={IMAGE_ACCEPT} data-testid="image-file-input" onChange={event => {
        const chosen = [...event.currentTarget.files ?? []]
        if (chosen.length) setImageFiles(chosen)
        event.currentTarget.value = ''
      }} />
      {privacyOpen && <PrivacyDialog onClose={() => setPrivacyOpen(false)} onChange={refreshRecent} />}
      {sheetSizesOpen && active && <SheetSizeDialog sizes={active.pageSizes} onClose={() => setSheetSizesOpen(false)} onPage={index => viewerRef.current?.scrollToPage(index)} />}
      {error && <div className="error" role="alert">{error}</div>}
      <PdfOpeningFeedback store={openingStore} />
      {comparison ? <CompareView old={comparison.old} next={comparison.next} pool={pool} formatDefaults={formatDefaults} onClose={() => {
        void (async () => {
          try { if (activeRef.current) await pool.activate(activeRef.current.docId); setComparison(null) }
          catch (reason) { setError(String(reason)); setComparison(null) }
        })()
      }} /> : active ? (
        <ErrorBoundary
          resetKey={`${active.docId}:${active.pageRevision}`}
          onError={reason => failOpeningRender(active.docId, reason)}
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
          <DrawingUiContext.Provider value={{ edit: pageIndex => setDrawingDialog({ session: active, pageIndex }) }}>
          <ScaleRegionInteractionContext.Provider value={{
            drawPage: scaleRegionDrawing?.session === active ? scaleRegionDrawing.pageIndex : null,
            dialogPage: scaleDialog?.session === active ? scaleDialog.pageIndex : null,
            complete: (rect: Rect) => {
              if (!scaleRegionDrawing || scaleRegionDrawing.session !== active) return
              const { session, pageIndex } = scaleRegionDrawing
              openScale(pageIndex, false, { id: crypto.randomUUID(), rect, scale: ratioScale(20, 'PDF', session.pageSizes[pageIndex]) })
            },
          }}>
          <ScaleInteractionContext.Provider value={{ request: i => openScale(i, true), tracePage: scaleTracing ? scaleDialog?.pageIndex ?? null : null, complete: p => { setScalePoints(p); setScaleTracing(false) } }}>
          <SnapContext.Provider value={snapEnabled}>
          <QuantityNavigationContext.Provider value={{ drawingInfo: i => active.annotationStore.getDrawingInfo(i), navigate: (page, rect) => {
            const viewer = viewerRef.current
            if (!viewer || organizeRef.current) { active.view.page = page + 1; refreshTabs(); return }
            if (!rect) { viewer.scrollToPage(page); return }
            // scrollToPosition anchors at the upper third; offset to centre the mark.
            const height = document.querySelector<HTMLElement>('[data-testid="viewer"]')?.clientHeight ?? 0
            const y = (rect[1] + rect[3]) / 2 - height / (6 * (96 / 72) * viewer.getZoom())
            viewer.scrollToPosition(page, (rect[0] + rect[2]) / 2, y)
          } }}>
          <FixtureUiContext.Provider value={{ documents, select: () => void changeTool('count'), open: () => openSidePanel('fixtures', false), edit: id => {
            void ensureSessionFixtures(active, pool).then(() => setFixtureEdit({ session: active, id })).catch(reason => showStatus(String(reason)))
          } }}>
          <DocumentWorkspace
          onNavigate={rememberNavigation}
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
          onToolChange={next => void changeTool(next)}
          onFormatDefaultsChange={updateFormatDefaults}
          onSideTabChange={(tab) => openSidePanel(tab, tab === 'search')}
          onPageChange={(next) => { setPage(next); scheduleViewPersistence() }}
          onZoomChange={(next) => { setZoom(next); scheduleViewPersistence() }}
          onFirstBitmap={() => {
            if (openMeasuredDocRef.current === active.docId) { openEndRef.current?.(); openEndRef.current = null }
            finishOpeningDocument(active.docId)
          }}
          onFirstSharp={() => {
            if (openMeasuredDocRef.current === active.docId) { openSharpEndRef.current?.(); openSharpEndRef.current = null; openMeasuredDocRef.current = null }
          }}
          onRenderError={reason => failOpeningRender(active.docId, reason)}
          onStatus={showStatus}
          organize={workspaceOrganize}
          split={split.enabled && !workspaceOrganize ? {
            settings: split, documents, views: rightViewsRef.current, positions: rightPositionsRef.current, onChange: updateSplit, onSwap: swapSplit,
          } : null}
          />
          {symbolSearch?.session === active && !organize && <Suspense fallback={null}><SymbolSearchPanel key={`${active.docId}:${symbolSearch.fixtureId}`} selection={symbolSearch} pool={pool}
            onClose={closeSymbolSearch} onRecapture={() => startSymbolSearch(active, symbolSearch.fixtureId)}
            onPage={index => viewerRef.current?.scrollToPage(index)} onStatus={showStatus} registerDispose={registerSymbolSearchDispose} /></Suspense>}
          </FixtureUiContext.Provider>
          </QuantityNavigationContext.Provider>
          </SnapContext.Provider>
          </ScaleInteractionContext.Provider>
          </ScaleRegionInteractionContext.Provider>
          </DrawingUiContext.Provider>
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
        {install.supported && (install.installed || install.error) && <span className="install-app-status" role="status">{install.installed ? installedMessage : install.error}</span>}
        <span>{active ? `${page} / ${active.pageSizes.length} ページ` : 'PDFを開いてください'}</span>
        {!comparison && active && (active.annotationStore.getDrawingInfo(page - 1)?.number || active.annotationStore.getDrawingInfo(page - 1)?.name) && <button type="button" data-testid="status-drawing-info" className="status-drawing-info" onClick={() => setDrawingDialog({ session: active, pageIndex: page - 1 })}>{[active.annotationStore.getDrawingInfo(page - 1)?.number, active.annotationStore.getDrawingInfo(page - 1)?.name].filter(Boolean).join(' ')}</button>}
        {!comparison && active?.annotationStore.drawingFilterActive() && <span className="drawing-filter-status">
          図面の表示: {annotationFilterLabel(active.annotationStore.annotationFilter)}だけ
          <button type="button" onClick={() => active.annotationStore.setDrawingFollowsFilter(false)}>解除</button>
        </span>}
        {!comparison && active && (active.annotationStore.getScale(page - 1) || active.annotationStore.scaleRegions.get(page - 1)?.length) && <button type="button" className="status-scale" onClick={() => openScale(page - 1)}>
          {active.annotationStore.getScale(page - 1) ? scaleLabel(active.annotationStore.getScale(page - 1)!) : '縮尺の範囲 ' + active.annotationStore.getScaleRegions(page - 1).length}
          {active.annotationStore.getScale(page - 1) && !!active.annotationStore.scaleRegions.get(page - 1)?.length && `（範囲 ${active.annotationStore.getScaleRegions(page - 1).length}）`}
        </button>}
        <span role="status">{runtimeError || status}</span>{/* @single:start */}<span style={{ marginLeft: 'auto', fontSize: '11px' }}>固定・閉域版（HTML）</span>{/* @single:end */}{/* @fixed:start */}<span style={{ marginLeft: 'auto', fontSize: '11px' }}>固定・閉域版</span>{/* @fixed:end */}
      </footer>
      {drawingDialog && <DrawingInfoDialog session={drawingDialog.session} pageIndex={drawingDialog.pageIndex} pool={pool} onClose={() => setDrawingDialog(null)} onSave={info => { drawingDialog.session.annotationStore.setDrawingInfo([drawingDialog.pageIndex], info); setDrawingDialog(null); refreshTabs() }} />}
      {scaleRegionDrawing?.session === active && <div className="scale-trace-banner" role="status">縮尺の範囲を四角で囲んでください（Esc でやめる）</div>}
      {scaleDialog && <ScaleDialog key={`${scaleDialog.session.docId}:${scaleDialog.pageIndex}:${scaleDialog.region?.id ?? 'page'}`} pageIndex={scaleDialog.pageIndex} size={scaleDialog.session.pageSizes[scaleDialog.pageIndex]} initial={scaleDialog.region?.scale ?? scaleDialog.session.annotationStore.getScale(scaleDialog.pageIndex)} region={scaleDialog.region} regions={scaleDialog.session.annotationStore.getScaleRegions(scaleDialog.pageIndex)} required={scaleDialog.required} tracing={scaleTracing} points={scalePoints}
        onEditRegion={region => openScale(scaleDialog.pageIndex, false, region)}
        countRegionMeasurements={async region => {
          const session = scaleDialog.session, i = scaleDialog.pageIndex
          await session.annotationStore.ensurePageLoaded(i, () => pool.listAnnotations(session.docId, i))
          if (session.annotationStore.getPageAnnotations(i).some(a => a.quantity)) await ensureSessionFixtures(session, pool)
          return session.annotationStore.getPageAnnotations(i).filter(a => a.measure && a.vertices?.[0] && pointInScaleRegion(region, a.vertices[0])).length
        }}
        onDeleteRegion={(region, recalculate) => {
          const store = scaleDialog.session.annotationStore
          store.setScaleRegions(scaleDialog.pageIndex, store.getScaleRegions(scaleDialog.pageIndex).filter(r => r.id !== region.id), recalculate); refreshTabs()
        }}
        onTrace={() => { viewerRef.current?.scrollToPage(scaleDialog.pageIndex); setScaleTracing(true) }}
        onClose={() => { setScaleDialog(null); setScaleTracing(false) }}
        countMeasurements={async all => {
          const session = scaleDialog.session, indices = scaleTargets(all)
          for (const i of indices) await session.annotationStore.ensurePageLoaded(i, () => pool.listAnnotations(session.docId, i))
          // Quantity labels carry the item code, so recalculation needs the item list.
          if (indices.some(i => session.annotationStore.getPageAnnotations(i).some(a => a.quantity))) await ensureSessionFixtures(session, pool)
          return indices.reduce((n, i) => n + session.annotationStore.getPageAnnotations(i).filter(a => {
            if (!a.measure || !a.vertices?.[0]) return false
            return scaleDialog.region ? pointInScaleRegion(scaleDialog.region, a.vertices[0])
              : !session.annotationStore.scaleAt(i, a.vertices[0])?.region
          }).length, 0)
        }}
        onSave={(scale, all, recalculate, label) => {
          const store = scaleDialog.session.annotationStore
          if (scaleDialog.region) {
            const region: ScaleRegion = { id: scaleDialog.region.id, rect: scaleDialog.region.rect, scale, ...(label ? { label } : {}) }
            const regions = store.getScaleRegions(scaleDialog.pageIndex), index = regions.findIndex(r => r.id === region.id)
            if (index >= 0) regions[index] = region; else regions.push(region)
            store.setScaleRegions(scaleDialog.pageIndex, regions, recalculate)
          } else store.setScale(scaleTargets(all), scale, recalculate)
          setScaleDialog(null); setScaleTracing(false); refreshTabs()
        }} />}
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      <DesktopStepsDialog open={desktopStepsOpen} onClose={() => setDesktopStepsOpen(false)} />
      <ExternalSendAlert />
      {fixtureEdit && fixtureEdit.session.annotationStore.getCountFixture(fixtureEdit.id) && <Suspense fallback={null}><FixtureDialog
        key={`${fixtureEdit.session.docId}:${fixtureEdit.id}`}
        initial={structuredClone(fixtureEdit.session.annotationStore.getCountFixture(fixtureEdit.id)!)}
        fixtures={fixtureEdit.session.annotationStore.getCountFixtures()} editing hasMarks={fixtureEdit.session.annotationStore.fixtureMarkCount(fixtureEdit.id) > 0}
        onClose={() => setFixtureEdit(null)} onSave={fixture => {
          const store = fixtureEdit.session.annotationStore
          store.setCountFixtures(store.getCountFixtures().map(f => f.id === fixture.id ? fixture : f)); setFixtureEdit(null)
        }}
      /></Suspense>}
      {compareDialog && active && <CompareDialog documents={documents} activeId={active.docId} onOpen={() => void pickFile()} onClose={() => setCompareDialog(false)} onCompare={(old, next) => {
        void (async () => {
          await viewerRef.current?.commitEditor()
          persistView()
          setCompareDialog(false); setComparison({ old, next })
        })().catch(reason => setError(String(reason)))
      }} />}
      {imageFiles && <ImagesToPdfDialog files={imageFiles} mode="create" onClose={() => setImageFiles(null)} onComplete={async (bytes, name, signal) => {
        if (tabs.list().length >= MAX_OPEN_DOCUMENTS) throw new Error('同時に開けるのは8ファイルまでです。タブを閉じてから作成してください。')
        if (!discardOrganize()) throw new Error('ページ整理の変更を確認してから作成してください。')
        await viewerRef.current?.commitEditor()
        if (signal.aborted) return
        persistView()
        await openBuffer(copyToArrayBuffer(bytes), name, null, true, signal)
      }} />}
      <RasterizeDialog
        open={rasterizeOpen && Boolean(active)}
        pageCount={active?.pageSizes.length ?? 0}
        onClose={() => setRasterizeOpen(false)}
        onEstimate={estimateRasterized}
        onSave={saveRasterized}
      />
      {active && headerFooterOpen && <HeaderFooterDialog
        open
        docId={active.docId}
        fileName={active.name}
        pageSizes={active.pageSizes}
        currentPage={page}
        pool={pool}
        excludedAnnotations={(pageIndex) => active.annotationStore.touchedObjNums(pageIndex)}
        loadSettings={() => pool.getHeaderFooterSettings(active.docId)}
        onApply={async (settings, dateText) => { await applyHeaderFooterSettings(settings, dateText) }}
        onRemove={async () => { await removeHeaderFooterSettings() }}
        onClose={() => setHeaderFooterOpen(false)}
      />}
    </main>
    </SnapUiContext.Provider>
    </FixtureSampleContext.Provider>
    </SymbolSearchContext.Provider>
  )
}
