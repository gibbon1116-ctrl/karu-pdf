/// <reference lib="webworker" />
import { DisplayListCache } from '../core/displayListCache'
import { openDocument, type OpenedDocument } from '../core/mupdfDoc'
import { renderRegion } from '../core/render'
import { applyEdits, listAnnotations } from '../core/annotations'
import { createFontResource, encodeCharacter, replaceMissingCharacters, type FontResource } from '../core/fontMetrics'
import { layoutText } from '../core/textLayout'
import { saveDocument } from '../core/save'
import type {
  ApplyAndSaveRequest,
  LayoutTextRequest,
  ListAnnotationsRequest,
  RenderRequest,
  WorkerRequest,
  WorkerResponse,
} from './protocol'

const scope = self as unknown as DedicatedWorkerGlobalScope
let opened: OpenedDocument | undefined
let displayLists: DisplayListCache | undefined
let fontResource: FontResource | undefined
let sequence = 0
let running = false
let processedCount = 0
type CoreRequest = ListAnnotationsRequest | LayoutTextRequest | ApplyAndSaveRequest
type QueuedRequest =
  | (RenderRequest & { sequence: number })
  | (CoreRequest & { sequence: number; priority: -1 })
const queue: QueuedRequest[] = []
const scheduler = new MessageChannel()

function post(message: WorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer)
}

function disposeDocument(): void {
  displayLists?.destroy()
  displayLists = undefined
  opened?.document.destroy()
  opened = undefined
}

function disposeFont(): void {
  fontResource?.font.destroy()
  fontResource = undefined
}

async function getFontResource(): Promise<FontResource> {
  if (fontResource) return fontResource
  const response = await fetch(`${import.meta.env.BASE_URL}fonts/BIZUDGothic-Regular.ttf`)
  if (!response.ok) throw new Error(`BIZ UDゴシックを読み込めませんでした (${response.status})。`)
  fontResource = createFontResource(new Uint8Array(await response.arrayBuffer()))
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
  if (!displayLists) {
    post({ type: 'error', jobId: job.jobId, message: 'PDF が開かれていません。' })
    return
  }
  try {
    post({ type: 'started', jobId: job.jobId })
    const started = performance.now()
    const rendered = renderRegion(
      displayLists,
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
  if (!opened) {
    post({ type: 'error', requestId: request.requestId, message: 'PDF が開かれていません。' })
    return
  }
  const document = opened.document.asPDF()
  if (!document) {
    post({ type: 'error', requestId: request.requestId, message: 'PDF 文書ではありません。' })
    return
  }
  try {
    if (request.type === 'listAnnotations') {
      post({
        type: 'annotationsListed',
        requestId: request.requestId,
        annotations: listAnnotations(document, request.pageIndex),
      })
      return
    }

    const font = await getFontResource()
    if (request.type === 'layoutText') {
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

    const applied = applyEdits(document, request.edits, font)
    displayLists?.clear()
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

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data
  if (message.type === 'open') {
    try {
      for (const cancelled of queue.splice(0, queue.length)) {
        if (cancelled.type === 'render') post({ type: 'rendered', jobId: cancelled.jobId, cancelled: true })
        else post({ type: 'error', requestId: cancelled.requestId, message: '別の PDF が開かれました。' })
      }
      disposeDocument()
      processedCount = 0
      opened = openDocument(new Uint8Array(message.bytes))
      displayLists = new DisplayListCache(opened.document)
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
  if (message.type === 'listAnnotations' || message.type === 'layoutText' || message.type === 'applyAndSave') {
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
      if (queued.type === 'render' && ids.has(queued.jobId)) {
        const [cancelled] = queue.splice(index, 1)
        if (cancelled.type === 'render') post({ type: 'rendered', jobId: cancelled.jobId, cancelled: true })
      }
    }
    return
  }
  if (message.type === 'reprioritize') {
    const job = queue.find((candidate): candidate is RenderRequest & { sequence: number } => (
      candidate.type === 'render' && candidate.jobId === message.jobId
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
      displayListCount: displayLists?.count ?? 0,
      displayListBytes: displayLists?.usedBytes ?? 0,
      processedCount,
    })
    return
  }
  queue.splice(0, queue.length)
  disposeDocument()
  disposeFont()
}

post({ type: 'ready' })
