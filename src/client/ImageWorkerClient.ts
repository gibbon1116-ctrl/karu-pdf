import type { ExifOrientation } from '../core/exif'
import type { ImagePdfSettings } from '../core/imagePdfLayout'
import { layoutImages } from '../core/imagePdfLayout'
import { MemoryPdfWriteTarget, PdfStreamWriter, type PdfImageBand, type PdfImagePlacement } from '../core/pdfStreamWriter'

export interface ImageInfo { width: number; height: number; orientation: ExifOrientation; dateTime?: string }
export interface ImageResult extends ImageInfo { image?: PdfImageBand; thumbnail?: Blob }
export type ImageTask = 'inspect' | 'thumbnail' | 'convert'
export class ImageWorkerClient {
  private worker = new Worker(new URL('../worker/image.worker.ts', import.meta.url), { type: 'module' })
  private tail: Promise<unknown> = Promise.resolve()
  private next = 0
  private disposed = false
  private pending = new Map<number, { resolve(value: ImageResult): void; reject(reason: Error): void }>()

  constructor() {
    this.worker.onmessage = (event: MessageEvent<{ id: number; result?: ImageResult; error?: string }>) => {
      const request = this.pending.get(event.data.id)
      if (!request) return
      this.pending.delete(event.data.id)
      if (event.data.error) request.reject(new Error(event.data.error))
      else request.resolve(event.data.result!)
    }
    this.worker.onerror = () => this.dispose(new Error('画像処理用Workerを起動できませんでした。'))
  }

  request(file: File, task: ImageTask, quality: ImagePdfSettings['quality'] = 'standard', signal?: AbortSignal): Promise<ImageResult> {
    const operation = this.tail.then(() => {
      if (this.disposed || signal?.aborted) throw new DOMException('画像の作成を中止しました。', 'AbortError')
      return new Promise<ImageResult>((resolve, reject) => {
        const id = ++this.next
        this.pending.set(id, { resolve, reject })
        this.worker.postMessage({ id, file, task, quality })
      })
    }).then(result => {
      if (signal?.aborted) throw new DOMException('画像の作成を中止しました。', 'AbortError')
      return result
    })
    this.tail = operation.catch(() => undefined)
    return operation
  }

  dispose(reason: Error = new DOMException('画像処理を中止しました。', 'AbortError')) {
    this.disposed = true
    this.worker.terminate()
    for (const request of this.pending.values()) request.reject(reason)
    this.pending.clear()
  }
}

export async function createImagesPdf(client: ImageWorkerClient, entries: readonly { file: File; info: ImageInfo }[], settings: ImagePdfSettings,
  signal?: AbortSignal, progress?: (completed: number, total: number) => void): Promise<Uint8Array> {
  const target = new MemoryPdfWriteTarget(), writer = new PdfStreamWriter(target)
  const check = () => { if (signal?.aborted) throw new DOMException('画像の作成を中止しました。', 'AbortError') }
  try {
    check()
    if (!entries.length) throw new Error('作成できる画像がありません。')
    const pages = layoutImages(entries.map(e => e.info), settings)
    await writer.start()
    let completed = 0
    for (const page of pages) {
      const placements: PdfImagePlacement[] = []
      for (const placement of page.placements) {
        check()
        const result = await client.request(entries[placement.index].file, 'convert', settings.quality, signal)
        check()
        placements.push({ ...placement, image: result.image!, orientation: result.orientation })
        progress?.(++completed, entries.length)
      }
      await writer.writeImagesPage(page, placements)
    }
    check(); await writer.close(); check()
    return target.toBytes()
  } catch (error) { await writer.abort(error); throw error }
}
