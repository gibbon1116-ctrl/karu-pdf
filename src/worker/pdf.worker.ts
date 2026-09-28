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
import type {
  ApplyAndSaveRequest,
  ExportBytesRequest,
  LayoutTextRequest,
  ListAnnotationsRequest,
  RenderRequest,
  WorkerRequest,
  WorkerResponse,
} from './protocol'

const scope = self as unknown as DedicatedWorkerGlobalScope

interface WorkerDocument {
  opened: OpenedDocument
  displayLists: DisplayListCache
}

const documents = new Map<string, WorkerDocument>()
const fontResources: FontResources = {}
let sequence = 0
let running = false
let processedCount = 0
type CoreRequest = ListAnnotationsRequest | LayoutTextRequest | ApplyAndSaveRequest | ExportBytesRequest
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
      const font = await getFontResource('BIZUDGothic')
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

    const requiredFonts = new Set<FontName>()
    for (const edit of request.edits) {
      if (edit.kind === 'createFreeText' || edit.kind === 'updateFreeText') requiredFonts.add(edit.font)
    }
    await Promise.all([...requiredFonts].map((fontName) => getFontResource(fontName)))
    const applied = applyEdits(document, request.edits, fontResources)
    entry.displayLists.clear()
    const saved = saveDocument(document, request.mode)
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
  if (message.type === 'listAnnotations' || message.type === 'layoutText' || message.type === 'applyAndSave' || message.type === 'exportBytes') {
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
