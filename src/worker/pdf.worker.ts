/* @single:start */import { requestEmbeddedFont } from '../single/workerFonts'
/* @single:end *//// <reference lib="webworker" />
/* @fixed:start */import { fixedAssetUrl } from '../fixed/security'
/* @fixed:end */import { DisplayListCache } from '../core/displayListCache'
import { openDocument, type OpenedDocument } from '../core/mupdfDoc'
import { renderRegion } from '../core/render'
import { ComparePageCache, renderComparePixels } from './compareRender'
import { readDocumentScales } from '../core/measure'
import { applyEdits, listAnnotations } from '../core/annotations'
import { applyEditsAtomically, applyAndSaveAtomically, pdfOperation } from '../core/editTransaction'
import { assertEditablePdf } from '../core/pdfRestrictions'
import { maxIssueNumber } from '../core/issues'
import type { MaxIssueNumberRequest } from './protocol'
import {
  createFontResource,
  createDingbatsFontResource,
  encodeCharacter,
  replaceMissingCharacters,
  type FontName,
  type FontResource,
  type FontResources,
} from '../core/fontMetrics'
import { layoutText } from '../core/textLayout'
import { saveDocument } from '../core/save'
import { prepareDocumentOutput } from '../core/output'
import { planRasterPages, renderRasterBand } from '../core/rasterize'
import { searchPage } from '../core/search'
import { StructuredTextCache } from '../core/textSelection'
import { applyHeaderFooter, getHeaderFooterSettings, removeHeaderFooter } from '../core/headerFooter'
import {
  applyPageLayout,
  extractPages,
  getPageInfo,
  getPageSizes,
  splitPages,
} from '../core/pageOps'
import type {
  ApplyEditsRequest,
  ApplyAndSaveRequest,
  ApplyPageLayoutRequest,
  ApplyHeaderFooterRequest,
  BeginRasterizeRequest,
  ExtractPagesRequest,
  ExportBytesRequest,
  GetPageInfoRequest,
  LayoutTextRequest,
  ListAllAnnotationsRequest,
  ListAnnotationsRequest,
  PageHasTextRequest,
  PageTextLinesRequest,
  GetHeaderFooterSettingsRequest,
  OpenRequest,
  PrepareOutputRequest,
  RenderRequest,
  RenderCompareRequest,
  RenderRasterBandRequest,
  SearchDocumentRequest,
  SelectTextRequest,
  SplitPagesRequest,
  UndoPageLayoutRequest,
  RemoveHeaderFooterRequest,
  WorkerRequest,
  WorkerResponse,
} from './protocol'

const scope = self as unknown as DedicatedWorkerGlobalScope

interface WorkerDocument {
  opened: OpenedDocument
  displayLists: DisplayListCache
  textSelections: StructuredTextCache
  comparePages?: ComparePageCache
}

const documents = new Map<string, WorkerDocument>()
const pageLayoutBackups = new Map<string, Uint8Array>()
const fontResources: FontResources = {}
const cancelledSearches = new Set<number>()
const cancelledAnnotationLists = new Set<number>()
const activeSearches = new Map<string, number>()
const activeAnnotationLists = new Map<string, number>()
const activeComparisons = new Map<number, { docId: string; newDocId: string; cancelled: boolean }>()
let sequence = 0
let running = false
let processedCount = 0
type CoreRequest =
  | MaxIssueNumberRequest
  | OpenRequest
  | ListAnnotationsRequest
  | ListAllAnnotationsRequest
  | SearchDocumentRequest
  | SelectTextRequest
  | PageHasTextRequest
  | PageTextLinesRequest
  | LayoutTextRequest
  | ApplyAndSaveRequest
  | ApplyEditsRequest
  | PrepareOutputRequest
  | ApplyPageLayoutRequest
  | ApplyHeaderFooterRequest
  | RemoveHeaderFooterRequest
  | GetHeaderFooterSettingsRequest
  | UndoPageLayoutRequest
  | ExtractPagesRequest
  | SplitPagesRequest
  | GetPageInfoRequest
  | ExportBytesRequest
  | BeginRasterizeRequest
  | RenderRasterBandRequest
type QueuedRequest =
  | (RenderRequest & { sequence: number })
  | (RenderCompareRequest & { sequence: number })
  | (CoreRequest & { sequence: number; priority: -1 })
const queue: QueuedRequest[] = []
const scheduler = new MessageChannel()

function post(message: WorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer)
}

function disposeDocument(docId: string): void {
  for (const job of activeComparisons.values()) if (job.docId === docId || job.newDocId === docId) job.cancelled = true
  const searchRequest = activeSearches.get(docId)
  if (searchRequest !== undefined) cancelledSearches.add(searchRequest)
  const annotationRequest = activeAnnotationLists.get(docId)
  if (annotationRequest !== undefined) cancelledAnnotationLists.add(annotationRequest)
  const entry = documents.get(docId)
  if (!entry) return
  entry.displayLists.destroy()
  entry.comparePages?.destroy()
  entry.textSelections.destroy()
  entry.opened.document.destroy()
  documents.delete(docId)
  pageLayoutBackups.delete(docId)
}

function replaceDocument(docId: string, bytes: Uint8Array, keepBackup = false, prepared?: OpenedDocument): WorkerDocument {
  const opened = prepared ?? openDocument(bytes)
  const backup = keepBackup ? pageLayoutBackups.get(docId) : undefined
  disposeDocument(docId)
  if (backup) pageLayoutBackups.set(docId, backup)
  const pdf = opened.document.asPDF()
  if (!pdf) {
    opened.document.destroy()
    throw new Error('PDF 文書ではありません。')
  }
  const entry = { opened, displayLists: new DisplayListCache(opened.document), textSelections: new StructuredTextCache(pdf) }
  documents.set(docId, entry)
  return entry
}

function sourceDocuments(ids: readonly string[]): Map<string, import('mupdf').PDFDocument> {
  const result = new Map<string, import('mupdf').PDFDocument>()
  for (const id of ids) {
    const entry = documents.get(id)
    const document = entry?.opened.document.asPDF()
    if (!document) throw new Error(`追加元の PDF が開かれていません: ${id}`)
    assertEditablePdf(document)
    result.set(id, document)
  }
  return result
}

function disposeAllDocuments(): void {
  for (const docId of [...documents.keys()]) disposeDocument(docId)
}

function disposeFonts(): void {
  for (const fontResource of Object.values(fontResources)) fontResource?.font.destroy()
  delete fontResources.BIZUDGothic
  delete fontResources.BIZUDMincho
  delete fontResources.ZapfDingbats
}

function getDingbatsResource(): FontResource {
  const loaded = fontResources.ZapfDingbats
  if (loaded) return loaded
  const resource = createDingbatsFontResource()
  fontResources.ZapfDingbats = resource
  return resource
}

async function getFontResource(name: FontName): Promise<FontResource> {
  const loaded = fontResources[name]
  if (loaded) return loaded
/* @server:start */  const filename = name === 'BIZUDGothic' ? 'BIZUDGothic-Regular.ttf' : 'BIZUDMincho-Regular.ttf'
  const label = name === 'BIZUDGothic' ? 'BIZ UDゴシック' : 'BIZ UD明朝'
/* @fixed:start */  const fixedFontUrl = fixedAssetUrl(`fonts/${filename}`, self.location.origin, import.meta.env.BASE_URL)
/* @fixed:end */  const response = await fetch(/* @fixed:start */fixedFontUrl ?? /* @fixed:end */`${import.meta.env.BASE_URL}fonts/${filename}`)
  if (!response.ok) throw new Error(`${label}を読み込めませんでした (${response.status})。`)
  const fontResource = createFontResource(new Uint8Array(await response.arrayBuffer()), name)
  fontResources[name] = fontResource
  return fontResource/* @server:end *//* @single:start */
  const resource = createFontResource(await requestEmbeddedFont(name), name)
  fontResources[name] = resource
  return resource
/* @single:end */
}

async function loadFontsForEdits(edits: readonly import('../core/annotations').AnnotationEdit[]): Promise<void> {
  const requiredFonts = new Set<FontName>()
  for (const edit of edits) {
    if (edit.kind === 'createFreeText' || edit.kind === 'updateFreeText'
      || edit.kind === 'createCallout' || edit.kind === 'updateCallout') requiredFonts.add(edit.font)
    if (edit.kind === 'createMeasure' || edit.kind === 'updateMeasure' || edit.kind === 'createIssue' || edit.kind === 'updateIssue') requiredFonts.add('BIZUDGothic')
  }
  await Promise.all([...requiredFonts].map((fontName) => getFontResource(fontName)))
  if (requiredFonts.size > 0) getDingbatsResource()
}

function schedule(): void {
  if (!running && queue.length > 0) scheduler.port2.postMessage(null)
}

scheduler.port1.onmessage = () => {
  if (running || queue.length === 0) return
  running = true
  const job = queue.shift()!
  void execute(job).finally(() => {
    running = false
    schedule()
  })
}

// 検索と全書き込みの読み出しは、全ページが終わるまで列を占有する（330 ページで約 8 秒）。
// その間も文字の選択や書き込みの読み込みが待たされないよう、1 ページごとに、
// 文書を変えない短い要求だけを先に片付ける。
const INTERACTIVE_REQUESTS = new Set<WorkerRequest['type']>(['selectText', 'pageHasText', 'pageTextLines', 'listAnnotations', 'layoutText'])

async function yieldToInteractiveRequests(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  for (let index = 0; index < queue.length;) {
    const job = queue[index]
    if (job.type === 'render' || job.type === 'renderCompare' || !INTERACTIVE_REQUESTS.has(job.type)) {
      index += 1
      continue
    }
    queue.splice(index, 1)
    await executeCoreRequest(job)
  }
}

async function execute(job: QueuedRequest): Promise<void> {
  if (job.type === 'renderCompare') {
    const state = { docId: job.docId, newDocId: job.newDocId, cancelled: false }
    activeComparisons.set(job.jobId, state)
    post({ type: 'started', jobId: job.jobId })
    const started = performance.now()
    try {
      const old = documents.get(job.docId), next = documents.get(job.newDocId)
      if (!old || !next) throw new Error('比較する PDF が開かれていません。')
      old.comparePages ??= new ComparePageCache(old.opened.document)
      next.comparePages ??= new ComparePageCache(next.opened.document)
      const rendered = await renderComparePixels(old.comparePages, next.comparePages, job, async () => {
        // Receive cancellation between bands, and give visible rendering priority.
        await new Promise<void>(resolve => setTimeout(resolve, 0))
        if (state.cancelled) throw new Error('compare-cancelled')
        const index = queue.findIndex(q => (q.type === 'render' || (q.type === 'renderCompare' && !q.detect)) && q.priority < job.priority)
        if (index >= 0) await execute(queue.splice(index, 1)[0])
        if (state.cancelled) throw new Error('compare-cancelled')
      })
      if (state.cancelled) throw new Error('compare-cancelled')
      const bitmap = await createImageBitmap(new ImageData(rendered.rgba, rendered.width, rendered.height))
      if (state.cancelled) { bitmap.close(); throw new Error('compare-cancelled') }
      processedCount++
      post({ type: 'rendered', jobId: job.jobId, bitmap, renderMs: performance.now() - started,
        differences: rendered.differences, detectionMs: rendered.detectionMs }, [bitmap])
    } catch (error) {
      if (state.cancelled) post({ type: 'rendered', jobId: job.jobId, cancelled: true })
      else post({ type: 'error', jobId: job.jobId, message: error instanceof Error ? error.message : String(error) })
    } finally { activeComparisons.delete(job.jobId) }
    return
  }
  if (job.type !== 'render') {
    await executeCoreRequest(job)
    return
  }
  const entry = documents.get(job.docId)
  if (!entry) {
    post({ type: 'error', jobId: job.jobId, message: 'PDF が開かれていません。' })
    return
  }
  try {
    post({ type: 'started', jobId: job.jobId })
    const started = performance.now()
    const rendered = renderRegion(
      entry.displayLists,
      job.pageIndex,
      job.renderScale,
      job.deviceRect,
      new Set(job.excludeAnnotObjNums ?? []),
    )
    const imageData = new ImageData(rendered.rgba, rendered.width, rendered.height)
    const bitmap = await createImageBitmap(imageData)
    processedCount += 1
    post(
      { type: 'rendered', jobId: job.jobId, bitmap, renderMs: performance.now() - started },
      [bitmap],
    )
  } catch (error) {
    post({ type: 'error', jobId: job.jobId, message: error instanceof Error ? error.message : String(error) })
  }
}

async function executeCoreRequest(request: CoreRequest): Promise<void> {
  try {
    if (request.type === 'open') {
      disposeDocument(request.docId)
      const opened = openDocument(new Uint8Array(request.bytes))
      const pdf = opened.document.asPDF()
      if (!pdf) {
        opened.document.destroy()
        throw new Error('PDF 文書ではありません。')
      }
      documents.set(request.docId, { opened, displayLists: new DisplayListCache(opened.document), textSelections: new StructuredTextCache(pdf) })
      post({
        type: 'opened',
        requestId: request.requestId,
        pageCount: opened.pageCount,
        editRestriction: opened.editRestriction,
        pageSizes: opened.pageSizes,
        pageScales: readDocumentScales(pdf),
        openMs: opened.openMs,
        sizesMs: opened.sizesMs,
      })
      return
    }

    if (request.type === 'layoutText') {
      const font = await getFontResource(request.font ?? 'BIZUDGothic')
      const fallback = getDingbatsResource()
      const replaced = replaceMissingCharacters(font.font, request.text, fallback.font)
      post({
        type: 'textLaidOut',
        requestId: request.requestId,
        result: layoutText({
          text: replaced.text,
          fontSize: request.fontSize,
          boxWidth: request.boxWidth,
          ascent: font.ascent,
          advance: (character) => encodeCharacter(font.font, character, fallback.font).advance,
        }),
      })
      return
    }

    const entry = documents.get(request.docId)
    if (!entry) throw new Error('PDF が開かれていません。')
    const document = entry.opened.document.asPDF()
    if (!document) throw new Error('PDF 文書ではありません。')

    if (entry.opened.editRestriction && ['applyEdits', 'applyAndSave', 'applyPageLayout', 'applyHeaderFooter', 'removeHeaderFooter', 'extractPages', 'splitPages', 'beginRasterize'].includes(request.type)) assertEditablePdf(document)

    if (request.type === 'listAnnotations') {
      post({
        type: 'annotationsListed',
        requestId: request.requestId,
        annotations: listAnnotations(document, request.pageIndex),
      })
      return
    }
    if (request.type === 'maxIssueNumber') {
      post({ type: 'maxIssueNumberResult', requestId: request.requestId, maximum: maxIssueNumber(document) })
      return
    }

    if (request.type === 'pageHasText') {
      post({ type: 'pageHasTextResult', requestId: request.requestId, hasText: entry.textSelections.pageHasText(request.pageIndex) })
      return
    }

    if (request.type === 'pageTextLines') {
      post({ type: 'pageTextLinesResult', requestId: request.requestId, lines: entry.textSelections.pageTextLines(request.pageIndex) })
      return
    }

    if (request.type === 'selectText') {
      post({
        type: 'textSelected',
        requestId: request.requestId,
        result: entry.textSelections.select(request.pageIndex, request.from, request.to, request.mode),
      })
      return
    }

    if (request.type === 'getHeaderFooterSettings') {
      post({ type: 'headerFooterSettings', requestId: request.requestId, settings: getHeaderFooterSettings(document) })
      return
    }

    if (request.type === 'searchDocument') {
      const totalPages = document.countPages()
      let totalMatches = 0
      let textPages = 0
      let processedPages = 0
      let truncated = false
      for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
        if (cancelledSearches.has(request.requestId)) break
        const page = document.loadPage(pageIndex) as import('mupdf').PDFPage
        let result
        try {
          result = searchPage(page, pageIndex, request.needle, request.options, 1_001 - totalMatches)
        } finally {
          page.destroy()
        }
        if (result.hasText) textPages += 1
        let matches = result.matches
        if (totalMatches + matches.length > 1_000) {
          matches = matches.slice(0, Math.max(0, 1_000 - totalMatches))
          truncated = true
        }
        totalMatches += matches.length
        processedPages = pageIndex + 1
        post({
          type: 'searchProgress', requestId: request.requestId, pageIndex, matches,
          processedPages, totalPages, totalMatches, textPages, truncated,
          done: truncated, cancelled: false,
        })
        if (truncated) break
        await yieldToInteractiveRequests()
      }
      const cancelled = cancelledSearches.delete(request.requestId)
      if (!truncated) post({
        type: 'searchProgress', requestId: request.requestId, pageIndex: -1, matches: [],
        processedPages, totalPages, totalMatches, textPages, truncated: false,
        done: true, cancelled,
      })
      if (activeSearches.get(request.docId) === request.requestId) activeSearches.delete(request.docId)
      return
    }

    if (request.type === 'listAllAnnotations') {
      const totalPages = document.countPages()
      let processedPages = 0
      for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
        if (cancelledAnnotationLists.has(request.requestId)) break
        const annotations = listAnnotations(document, pageIndex)
        processedPages = pageIndex + 1
        post({
          type: 'allAnnotationsProgress', requestId: request.requestId, pageIndex, annotations,
          processedPages, totalPages, done: false, cancelled: false,
        })
        await yieldToInteractiveRequests()
      }
      const cancelled = cancelledAnnotationLists.delete(request.requestId)
      post({
        type: 'allAnnotationsProgress', requestId: request.requestId, pageIndex: -1, annotations: [],
        processedPages, totalPages, done: true, cancelled,
      })
      if (activeAnnotationLists.get(request.docId) === request.requestId) activeAnnotationLists.delete(request.docId)
      return
    }

    if (request.type === 'exportBytes') {
      const saved = saveDocument(document, 'incremental')
      const bytes = saved.bytes.buffer as ArrayBuffer
      post({ type: 'bytesExported', requestId: request.requestId, bytes }, [bytes])
      return
    }

    if (request.type === 'getPageInfo') {
      post({ type: 'pageInfo', requestId: request.requestId, pages: getPageInfo(document) })
      return
    }

    if (request.type === 'renderRasterBand') {
      const bandPlan = request.pagePlan.bands[request.bandIndex]
      if (!bandPlan) throw new Error('画像の帯の番号が範囲外です。')
      const rendered = renderRasterBand(document, request.pagePlan, bandPlan, request)
      const bytes = rendered.bytes.buffer as ArrayBuffer
      post({
        type: 'rasterBandRendered', requestId: request.requestId, bytes,
        width: rendered.width, height: rendered.height,
        components: rendered.components, pixelBytes: rendered.pixelBytes,
      }, [bytes])
      return
    }

    if (request.type === 'beginRasterize') {
      await loadFontsForEdits(request.edits)
      let preparedBytes: Uint8Array | undefined
      let plans
      let replacedCharacters = 0
      let unsupportedCharacters: string[] = []
      let errors: import('../core/annotations').ApplyError[] = []
      if (request.edits.length > 0) {
        const source = saveDocument(document, 'incremental').bytes
        const prepared = prepareDocumentOutput(source, request.edits, fontResources, false)
        preparedBytes = prepared.bytes
        replacedCharacters = prepared.applied.replacedCharacters
        unsupportedCharacters = prepared.applied.unsupportedCharacters
        errors = prepared.applied.errors
        const opened = openDocument(preparedBytes)
        try {
          const preparedDocument = opened.document.asPDF()
          if (!preparedDocument) throw new Error('PDF 文書ではありません。')
          plans = planRasterPages(preparedDocument, request.options)
        } finally {
          opened.document.destroy()
        }
      } else {
        plans = planRasterPages(document, request.options)
      }
      const transfer: Transferable[] = []
      const responseBytes = preparedBytes?.buffer as ArrayBuffer | undefined
      if (responseBytes) transfer.push(responseBytes)
      post({
        type: 'rasterizeBegun', requestId: request.requestId,
        renderDocId: preparedBytes ? request.renderDocId : request.docId,
        preparedBytes: responseBytes,
        plans,
        replacedCharacters,
        unsupportedCharacters,
        errors,
      }, transfer)
      return
    }

    if (request.type === 'prepareOutput') {
      await loadFontsForEdits(request.edits)
      const source = saveDocument(document, 'incremental').bytes
      const output = prepareDocumentOutput(source, request.edits, fontResources, request.bake, request.safe)
      const bytes = output.bytes.buffer as ArrayBuffer
      post({
        type: 'outputPrepared', requestId: request.requestId, bytes,
        ms: output.ms,
        replacedCharacters: output.applied.replacedCharacters,
        unsupportedCharacters: output.applied.unsupportedCharacters,
        errors: output.applied.errors,
      }, [bytes])
      return
    }

    if (request.type === 'applyPageLayout') {
      const workerStarted = performance.now()
      const backupStarted = performance.now()
      const backup = saveDocument(document, 'incremental').bytes
      const backupMs = performance.now() - backupStarted
      pageLayoutBackups.set(request.docId, backup)
      try {
        const assembleStarted = performance.now()
        pdfOperation(document, () => applyPageLayout(request.docId, document, request.cards, sourceDocuments(request.sources)))
        const assembleMs = performance.now() - assembleStarted
        // ページ木を書き換えた文書を同じインスタンスから続けて増分保存すると、
        // MuPDF 1.28.1 では次の保存で参照が欠けることがある。最初の増分出力を
        // Worker 0 自身の新しい基準文書として開き直し、次の保存を安定させる。
        const exportStarted = performance.now()
        const saved = saveDocument(document, 'incremental').bytes
        const exportMs = performance.now() - exportStarted
        const primaryReloadStarted = performance.now()
        const reopened = replaceDocument(request.docId, saved.slice(), true)
        const primaryReloadMs = performance.now() - primaryReloadStarted
        const reopenedDocument = reopened.opened.document.asPDF()
        if (!reopenedDocument) throw new Error('PDF 文書ではありません。')
        const pageMetadataStarted = performance.now()
        const pageSizes = getPageSizes(reopenedDocument)
        const pageMetadataMs = performance.now() - pageMetadataStarted
        const bytes = saved.buffer as ArrayBuffer
        post({
          type: 'pageLayoutApplied', requestId: request.requestId, bytes,
          pageCount: pageSizes.length,
          pageSizes, pageScales: readDocumentScales(reopenedDocument),
          hasBackup: true,
          timings: {
            backupMs,
            assembleMs,
            exportMs,
            primaryReloadMs,
            pageMetadataMs,
            workerTotalMs: performance.now() - workerStarted,
          },
        }, [bytes])
      } catch (error) {
        replaceDocument(request.docId, backup.slice(), true)
        throw error
      }
      return
    }

    if (request.type === 'applyHeaderFooter' || request.type === 'removeHeaderFooter') {
      if (request.type === 'applyHeaderFooter') {
        await getFontResource(request.settings.font)
        getDingbatsResource()
      }
      const workerStarted = performance.now()
      const backupStarted = performance.now()
      const backup = saveDocument(document, 'incremental').bytes
      const backupMs = performance.now() - backupStarted
      pageLayoutBackups.set(request.docId, backup)
      try {
        const assembleStarted = performance.now()
        pdfOperation(document, () => { if (request.type === 'applyHeaderFooter') {
          applyHeaderFooter(document, request.settings, request.fileName, request.dateText, fontResources[request.settings.font]!, fontResources.ZapfDingbats!)
        } else removeHeaderFooter(document) })
        const assembleMs = performance.now() - assembleStarted
        const exportStarted = performance.now()
        const saved = saveDocument(document, 'incremental').bytes
        const exportMs = performance.now() - exportStarted
        const primaryReloadStarted = performance.now()
        const reopened = replaceDocument(request.docId, saved.slice(), true)
        const primaryReloadMs = performance.now() - primaryReloadStarted
        const reopenedDocument = reopened.opened.document.asPDF()
        if (!reopenedDocument) throw new Error('PDF 文書ではありません。')
        const pageMetadataStarted = performance.now()
        const pageSizes = getPageSizes(reopenedDocument)
        const pageMetadataMs = performance.now() - pageMetadataStarted
        const bytes = saved.buffer as ArrayBuffer
        post({
          type: request.type === 'applyHeaderFooter' ? 'headerFooterApplied' : 'headerFooterRemoved', requestId: request.requestId, bytes,
          pageCount: pageSizes.length, pageSizes, pageScales: readDocumentScales(reopenedDocument), hasBackup: true,
          timings: { backupMs, assembleMs, exportMs, primaryReloadMs, pageMetadataMs, workerTotalMs: performance.now() - workerStarted },
        }, [bytes])
      } catch (error) {
        replaceDocument(request.docId, backup.slice(), true)
        throw error
      }
      return
    }

    if (request.type === 'undoPageLayout') {
      const workerStarted = performance.now()
      const backup = pageLayoutBackups.get(request.docId)
      if (!backup) throw new Error('元に戻せるページ整理がありません。')
      const primaryReloadStarted = performance.now()
      const restored = replaceDocument(request.docId, backup.slice())
      const primaryReloadMs = performance.now() - primaryReloadStarted
      const restoredDocument = restored.opened.document.asPDF()
      if (!restoredDocument) throw new Error('PDF 文書ではありません。')
      const pageMetadataStarted = performance.now()
      const pageSizes = getPageSizes(restoredDocument)
      const pageMetadataMs = performance.now() - pageMetadataStarted
      const bytes = backup.buffer as ArrayBuffer
      post({
        type: 'pageLayoutUndone', requestId: request.requestId, bytes,
        pageCount: pageSizes.length,
        pageSizes, pageScales: readDocumentScales(restoredDocument),
        hasBackup: false,
        timings: {
          backupMs: 0,
          assembleMs: 0,
          exportMs: 0,
          primaryReloadMs,
          pageMetadataMs,
          workerTotalMs: performance.now() - workerStarted,
        },
      }, [bytes])
      return
    }

    if (request.type === 'extractPages') {
      const output = extractPages(request.docId, document, request.cards, sourceDocuments(request.sources))
      const bytes = output.buffer as ArrayBuffer
      post({ type: 'pagesExtracted', requestId: request.requestId, bytes }, [bytes])
      return
    }

    if (request.type === 'splitPages') {
      const outputs = splitPages(request.docId, document, request.groups, sourceDocuments(request.sources))
      const bytes = outputs.map((output) => output.buffer as ArrayBuffer)
      post({ type: 'pagesSplit', requestId: request.requestId, bytes }, bytes)
      return
    }

    await loadFontsForEdits(request.edits)
    if (request.type === 'applyEdits') {
      const applied = applyEditsAtomically(document, request.edits, fontResources)
      entry.displayLists.clear()
      post({
        type: 'editsApplied', requestId: request.requestId,
        created: applied.created,
        replacedCharacters: applied.replacedCharacters,
        unsupportedCharacters: applied.unsupportedCharacters,
        errors: applied.errors,
      })
      return
    }
    const { applied, saved, opened } = applyAndSaveAtomically(document, request.edits, fontResources, request.mode)
    entry.displayLists.clear()
    // MuPDF 1.28.1 can emit a recursive /Prev xref when saving the same
    // instance incrementally again (including a retry after an IO failure).
    // Reopen every completed output as the next baseline before transferring.
    replaceDocument(request.docId, saved.bytes, true, opened)
    const bytes = saved.bytes.buffer as ArrayBuffer
    post({
      type: 'appliedAndSaved',
      requestId: request.requestId,
      bytes,
      mode: saved.mode,
      ms: saved.ms,
      created: applied.created,
      replacedCharacters: applied.replacedCharacters,
      unsupportedCharacters: applied.unsupportedCharacters,
      errors: applied.errors,
    }, [bytes])
  } catch (error) {
    post({
      type: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

function cancelQueuedForDocument(docId: string, message: string): void {
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    const queued = queue[index]
    if (!('docId' in queued) || (queued.docId !== docId && !(queued.type === 'renderCompare' && queued.newDocId === docId))) continue
    queue.splice(index, 1)
    if (queued.type === 'render' || queued.type === 'renderCompare') post({ type: 'rendered', jobId: queued.jobId, cancelled: true })
    else post({ type: 'error', requestId: queued.requestId, message })
  }
}

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data
/* @single:start */  if ((message as { type: string }).type === 'single-font-response') return
/* @single:end */
  if (message.type === 'clearCompare') {
    for (const job of activeComparisons.values()) job.cancelled = true
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].type === 'renderCompare') {
      const job = queue.splice(i, 1)[0] as RenderCompareRequest
      post({ type: 'rendered', jobId: job.jobId, cancelled: true })
    }
    // Active jobs check cancellation before accessing another DisplayList.
    for (const doc of documents.values()) { doc.comparePages?.destroy(); doc.comparePages = undefined }
    return
  }
  if (message.type === 'open') {
    cancelQueuedForDocument(message.docId, 'PDF が開き直されました。')
    queue.push({ ...message, priority: -1, sequence: sequence++ })
    queue.sort((a, b) => a.priority - b.priority || a.sequence - b.sequence)
    schedule()
    return
  }
  if (message.type === 'close') {
    cancelQueuedForDocument(message.docId, 'PDF は閉じられました。')
    disposeDocument(message.docId)
    return
  }
  if (message.type === 'cancelSearch') {
    cancelledSearches.add(message.requestId)
    return
  }
  if (message.type === 'cancelListAllAnnotations') {
    cancelledAnnotationLists.add(message.requestId)
    return
  }
  if (message.type === 'searchDocument') {
    const previous = activeSearches.get(message.docId)
    if (previous !== undefined) cancelledSearches.add(previous)
    activeSearches.set(message.docId, message.requestId)
  }
  if (message.type === 'listAllAnnotations') {
    const previous = activeAnnotationLists.get(message.docId)
    if (previous !== undefined) cancelledAnnotationLists.add(previous)
    activeAnnotationLists.set(message.docId, message.requestId)
  }
  if (
    message.type === 'listAnnotations'
    || message.type === 'maxIssueNumber'
    || message.type === 'listAllAnnotations'
    || message.type === 'searchDocument'
    || message.type === 'selectText'
    || message.type === 'pageHasText'
    || message.type === 'pageTextLines'
    || message.type === 'layoutText'
    || message.type === 'applyAndSave'
    || message.type === 'applyEdits'
    || message.type === 'prepareOutput'
    || message.type === 'applyPageLayout'
    || message.type === 'applyHeaderFooter'
    || message.type === 'removeHeaderFooter'
    || message.type === 'getHeaderFooterSettings'
    || message.type === 'undoPageLayout'
    || message.type === 'extractPages'
    || message.type === 'splitPages'
    || message.type === 'getPageInfo'
    || message.type === 'exportBytes'
    || message.type === 'beginRasterize'
    || message.type === 'renderRasterBand'
  ) {
    queue.push({ ...message, priority: -1, sequence: sequence++ })
    queue.sort((a, b) => a.priority - b.priority || a.sequence - b.sequence)
    schedule()
    return
  }
  if (message.type === 'render' || message.type === 'renderCompare') {
    queue.push({ ...message, sequence: sequence++ })
    queue.sort((a, b) => a.priority - b.priority || a.sequence - b.sequence)
    schedule()
    return
  }
  if (message.type === 'cancelJobs') {
    const ids = new Set(message.jobIds)
    for (const id of ids) { const active = activeComparisons.get(id); if (active?.docId === message.docId) active.cancelled = true }
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      const queued = queue[index]
      if ((queued.type === 'render' || queued.type === 'renderCompare') && queued.docId === message.docId && ids.has(queued.jobId)) {
        queue.splice(index, 1)
        post({ type: 'rendered', jobId: queued.jobId, cancelled: true })
      }
    }
    return
  }
  if (message.type === 'reprioritize') {
    const job = queue.find((candidate): candidate is (RenderRequest | RenderCompareRequest) & { sequence: number } => (
      (candidate.type === 'render' || candidate.type === 'renderCompare') && candidate.docId === message.docId && candidate.jobId === message.jobId
    ))
    if (job !== undefined) {
      job.priority = message.priority
      queue.sort((a, b) => a.priority - b.priority || a.sequence - b.sequence)
    }
    return
  }
  if (message.type === 'stats') {
    post({
      type: 'stats',
      requestId: message.requestId,
      queueLength: queue.length + (running ? 1 : 0),
      displayListCount: [...documents.values()].reduce((sum, entry) => sum + entry.displayLists.count, 0),
      displayListBytes: [...documents.values()].reduce((sum, entry) => sum + entry.displayLists.usedBytes, 0),
      processedCount,
    })
    return
  }
  queue.splice(0, queue.length)
  disposeAllDocuments()
  disposeFonts()
}

post({ type: 'ready' })
