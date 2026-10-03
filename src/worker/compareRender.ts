import mupdf, { type Document, type DisplayList, type Rect } from 'mupdf'
import { blendCompare, compositeCompare, detectDifferences, differenceMask, type ComparePixels, type CompareRect } from '../core/compare'
import { makeRenderBands } from '../viewer/bandedRender'
import type { CompareOptions } from './protocol'

/** Created lazily only for comparison; freed when its view closes. */
export class ComparePageCache {
  private lists = new Map<string, DisplayList>()
  constructor(private document: Document) {}
  get(page: number, extras: boolean) {
    const key = `${page}:${extras}`
    let list = this.lists.get(key)
    if (list) { this.lists.delete(key); this.lists.set(key, list); return list }
    const loaded = this.document.loadPage(page)
    try { list = loaded.toDisplayList(extras) } finally { loaded.destroy() }
    this.lists.set(key, list)
    while (this.lists.size > 2) {
      const oldest = this.lists.keys().next().value!
      this.lists.get(oldest)!.destroy(); this.lists.delete(oldest)
    }
    return list
  }
  destroy() { for (const list of this.lists.values()) list.destroy(); this.lists.clear() }
}

function draw(list: DisplayList, rect: Rect, scale: number, dx = 0, dy = 0, rotation = 0): ComparePixels {
  const bounds = list.getBounds()
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, rect, true)
  const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap)
  try {
    pixmap.clear(255)
    const c = Math.cos(rotation)*scale, s = Math.sin(rotation)*scale
    list.run(device, [c, s, -s, c, dx-bounds[0]*c+bounds[1]*s, dy-bounds[0]*s-bounds[1]*c])
    device.close()
    return { width: pixmap.getWidth(), height: pixmap.getHeight(), rgba: new Uint8ClampedArray(pixmap.getPixels()) }
  } finally { device.destroy(); pixmap.destroy() }
}

export interface ComparedPixels extends ComparePixels { differences?: CompareRect[]; detectionMs?: number }
/** Same entry point in the browser Worker and the Node integration tests. */
export async function renderComparePixels(oldCache: ComparePageCache, newCache: ComparePageCache, options: CompareOptions,
  checkpoint: () => Promise<void> = async () => undefined): Promise<ComparedPixels> {
  const started = performance.now()
  const oldList = oldCache.get(options.pageIndex, options.includeAnnotations)
  const newList = newCache.get(options.newPageIndex, options.includeAnnotations)
  const bounds = oldList.getBounds(), newBounds = newList.getBounds()
  const width = bounds[2] - bounds[0], height = bounds[3] - bounds[1]
  const scale = options.detect ? Math.min(1, 2000 / Math.max(width, height)) : options.renderScale
  const rect: Rect = options.detect ? [0, 0, Math.ceil(width * scale), Math.ceil(height * scale)]
    : options.deviceRect ?? [0, 0, Math.ceil(width * scale), Math.ceil(height * scale)]
  const alignment = options.alignment ?? { scale: 1, rotation: 0 }
  if (!Number.isFinite(alignment.scale) || alignment.scale < .01 || alignment.scale > 100 || !Number.isFinite(alignment.rotation) || options.offset.some(n => !Number.isFinite(n) || Math.abs(n) > 1e7)) throw new Error('位置合わせが不正です。')
  const ratio = width / (newBounds[2] - newBounds[0])*alignment.scale
  const identical = oldList === newList && ratio === 1 && alignment.rotation === 0 && options.offset[0] === 0 && options.offset[1] === 0
  const bands = makeRenderBands('compare', rect)
  const result: ComparedPixels = { width: rect[2] - rect[0], height: rect[3] - rect[1], rgba: new Uint8ClampedArray((rect[2] - rect[0]) * (rect[3] - rect[1]) * 4) }
  const mask = options.detect ? new Uint8Array(result.width * result.height) : null
  for (const band of bands) {
    await checkpoint()
    const a = options.output === 'new' && !mask ? null : draw(oldList, band.rect, scale)
    await checkpoint()
    const b = options.output === 'old' && !mask ? null : identical && a ? a : draw(newList, band.rect, scale * ratio, options.offset[0] * scale, options.offset[1] * scale, alignment.rotation)
    const image = options.output === 'old' ? a! : options.output === 'new' ? b! : options.overlayMode === 'blend' ? blendCompare(a!, b!, options.blend) : compositeCompare(a!, b!, undefined, options.detection, options.tolerance)
    result.rgba.set(image.rgba, (band.rect[1] - rect[1]) * result.width * 4)
    if (mask && !identical) mask.set(differenceMask(a!, b!, undefined, options.detection, options.tolerance), (band.rect[1] - rect[1]) * result.width)
  }
  await checkpoint()
  if (mask) {
    result.differences = detectDifferences(mask, result.width, result.height, scale)
    result.detectionMs = performance.now() - started
  }
  return result
}
