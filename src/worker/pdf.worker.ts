/// <reference lib="webworker" />
import { DisplayListCache } from '../core/displayListCache'
import { openDocument, type OpenedDocument } from '../core/mupdfDoc'
import { renderRegion } from '../core/render'
import { applyEdits, listAnnotations } from '../core/annotations'
import {
  createFontResource,
  encodeCharacter,
  replaceMissingCharacters,
  type FontName,
  type FontResource,
  type FontResources,
} from '../core/fontMetrics'
import { layoutText } from '../core/textLayout'
import { saveDocument } from '../core/save'
import { prepareDocumentOutput } from '../core/output'
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
  ExtractPagesRequest,
  ExportBytesRequest,
  GetPageInfoRequest,
  LayoutTextRequest,
  ListAnnotationsRequest,
  PrepareOutputRequest,
  RenderRequest,
  SplitPagesRequest,
  UndoPageLayoutRequest,
  WorkerRequest,
  WorkerResponse,
} from './protocol'

const scope = self as unknown as DedicatedWorkerGlobalScope

interface WorkerDocument {
  opened: OpenedDocument
  displayLists: DisplayListCache
}

const documents = new Map<string, WorkerDocument>()
const pageLayoutBackups = new Map<string, Uint8Array>()
const fontResources: FontResources = {}
let sequence = 0
let running = false
let processedCount = 0
type CoreRequest =
  | ListAnnotationsRequest
  | LayoutTextRequest
  | ApplyAndSaveRequest
  | ApplyEditsRequest
  | PrepareOutputRequest
  | ApplyPageLayoutRequest
  | UndoPageLayoutRequest
  | ExtractPagesRequest
  | SplitPagesRequest
  | GetPageInfoRequest
  | ExportBytesRequest
type QueuedRequest =
  | (RenderRequest & { sequence: number })
  | (CoreRequest & { sequence: number; priority: -1 })
const queue: QueuedRequest[] = []
const scheduler = new MessageChannel()

function post(message: WorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer)
}

function disposeDocument(docId: string): void {
  const entry = documents.get(docId)
  if (!entry) return
  entry.displayLists.destroy()
  entry.opened.document.destroy()
  documents.delete(docId)
  pageLayoutBackups.delete(docId)
}

function replaceDocument(docId: string, bytes: Uint8Array, keepBackup = false): WorkerDocument {
  const backup = keepBackup ? pageLayoutBackups.get(docId) : undefined
  disposeDocument(docId)
  if (backup) pageLayoutBackups.set(docId, backup)
  const opened = openDocument(bytes)
  const entry = { opened, displayLists: new DisplayListCache(opened.document) }
  documents.set(docId, entry)
  return entry
}

function sourceDocuments(ids: readonly string[]): Map<string, import('mupdf').PDFDocument> {
  const result = new Map<string, import('mupdf').PDFDocument>()
  for (const id of ids) {
    const entry = documents.get(id)
    const document = entry?.opened.document.asPDF()
    if (!document) throw new Error(`追加元の PDF が開かれていません: ${id}`)
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
}

async function getFontResource(name: FontName): Promise<FontResource> {
  const loaded = fontResources[name]
  if (loaded) return loaded
  const filename = name === 'BIZUDGothic' ? 'BIZUDGothic-Regular.ttf' : 'BIZUDMincho-Regular.ttf'
  const label = name === 'BIZUDGothic' ? 'BIZ UDゴシック' : 'BIZ UD明朝'
  const response = await fetch(`${import.meta.env.BASE_URL}fonts/${filename}`)
  if (!response.ok) throw new Error(`${label}を読み込めませんでした (${response.status})。`)
  const fontResource = createFontResource(new Uint8Array(await response.arrayBuffer()), name)
  fontResources[name] = fontResource
  return fontResource
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

async function execute(job: QueuedRequest): Promise<void> {
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
    if (request.type === 'layoutText') {
      const font = await getFontResource(request.font ?? 'BIZUDGothic')
      const replaced = replaceMissingCharacters(font.font, request.text)
      post({
        type: 'textLaidOut',
        requestId: request.requestId,
        result: layoutText({
          text: replaced.text,
          fontSize: request.fontSize,
          boxWidth: request.boxWidth,
          ascent: font.ascent,
          advance: (character) => encodeCharacter(font.font, character).advance,
        }),
      })
      return
    }

    const entry = documents.get(request.docId)
    if (!entry) throw new Error('PDF が開かれていません。')
    const document = entry.opened.document.asPDF()
    if (!document) throw new Error('PDF 文書ではありません。')

    if (request.type === 'listAnnotations') {
      post({
        type: 'annotationsListed',
        requestId: request.requestId,
        annotations: listAnnotations(document, request.pageIndex),
      })
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

    if (request.type === 'prepareOutput') {
      const requiredFonts = new Set<FontName>()
      for (const edit of request.edits) {
        if (edit.kind === 'createFreeText' || edit.kind === 'updateFreeText') requiredFonts.add(edit.font)
      }
      await Promise.all([...requiredFonts].map((fontName) => getFontResource(fontName)))
      const source = saveDocument(document, 'incremental').bytes
      const output = prepareDocumentOutput(source, request.edits, fontResources, request.bake)
      const bytes = output.bytes.buffer as ArrayBuffer
      post({
        type: 'outputPrepared', requestId: request.requestId, bytes,
        ms: output.ms,
        replacedCharacters: output.applied.replacedCharacters,
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
        applyPageLayout(request.docId, document, request.cards, sourceDocuments(request.sources))
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
          pageSizes,
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
        pageSizes,
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

    const requiredFonts = new Set<FontName>()
    for (const edit of request.edits) {
      if (edit.kind === 'createFreeText' || edit.kind === 'updateFreeText') requiredFonts.add(edit.font)
    }
    await Promise.all([...requiredFonts].map((fontName) => getFontResource(fontName)))
    const applied = applyEdits(document, request.edits, fontResources)
    entry.displayLists.clear()
    if (request.type === 'applyEdits') {
      post({
        type: 'editsApplied', requestId: request.requestId,
        created: applied.created,
        replacedCharacters: applied.replacedCharacters,
        errors: applied.errors,
      })
      return
    }
    const saved = saveDocument(document, request.mode)
    if (saved.mode === 'full') replaceDocument(request.docId, saved.bytes.slice(), true)
    const bytes = saved.bytes.buffer as ArrayBuffer
    post({
      type: 'appliedAndSaved',
      requestId: request.requestId,
      bytes,
      mode: saved.mode,
      ms: saved.ms,
      created: applied.created,
      replacedCharacters: applied.replacedCharacters,
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
    if (!('docId' in queued) || queued.docId !== docId) continue
    queue.splice(index, 1)
    if (queued.type === 'render') post({ type: 'rendered', jobId: queued.jobId, cancelled: true })
    else post({ type: 'error', requestId: queued.requestId, message })
  }
}

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data
  if (message.type === 'open') {
    try {
      cancelQueuedForDocument(message.docId, 'PDF が開き直されました。')
      disposeDocument(message.docId)
      const opened = openDocument(new Uint8Array(message.bytes))
      documents.set(message.docId, { opened, displayLists: new DisplayListCache(opened.document) })
      post({
        type: 'opened',
        requestId: message.requestId,
        pageCount: opened.pageCount,
        pageSizes: opened.pageSizes,
        openMs: opened.openMs,
        sizesMs: opened.sizesMs,
      })
    } catch (error) {
      post({ type: 'error', requestId: message.requestId, message: error instanceof Error ? error.message : String(error) })
    }
    return
  }
  if (message.type === 'close') {
    cancelQueuedForDocument(message.docId, 'PDF は閉じられました。')
    disposeDocument(message.docId)
    return
  }
  if (
    message.type === 'listAnnotations'
    || message.type === 'layoutText'
    || message.type === 'applyAndSave'
    || message.type === 'applyEdits'
    || message.type === 'prepareOutput'
    || message.type === 'applyPageLayout'
    || message.type === 'undoPageLayout'
    || message.type === 'extractPages'
    || message.type === 'splitPages'
    || message.type === 'getPageInfo'
    || message.type === 'exportBytes'
  ) {
    queue.push({ ...message, priority: -1, sequence: sequence++ })
    queue.sort((a, b) => a.priority - b.priority || a.sequence - b.sequence)
    schedule()
    return
  }
  if (message.type === 'render') {
    queue.push({ ...message, sequence: sequence++ })
    queue.sort((a, b) => a.priority - b.priority || a.sequence - b.sequence)
    schedule()
    return
  }
  if (message.type === 'cancelJobs') {
    const ids = new Set(message.jobIds)
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      const queued = queue[index]
      if (queued.type === 'render' && queued.docId === message.docId && ids.has(queued.jobId)) {
        queue.splice(index, 1)
        post({ type: 'rendered', jobId: queued.jobId, cancelled: true })
      }
    }
    return
  }
  if (message.type === 'reprioritize') {
    const job = queue.find((candidate): candidate is RenderRequest & { sequence: number } => (
      candidate.type === 'render' && candidate.docId === message.docId && candidate.jobId === message.jobId
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
