import mupdf, { type DrawDevice, type Rect } from 'mupdf'
import type { DisplayListCache } from './displayListCache'

export interface RenderedRegion {
  width: number
  height: number
  rgba: Uint8ClampedArray<ArrayBuffer>
  deviceRect: Rect
}

function scaledBounds(bounds: Rect, scale: number): Rect {
  return [
    Math.floor(bounds[0] * scale),
    Math.floor(bounds[1] * scale),
    Math.ceil(bounds[2] * scale),
    Math.ceil(bounds[3] * scale),
  ]
}

export function renderRegion(
  cache: DisplayListCache,
  pageIndex: number,
  renderScale: number,
  deviceRect: Rect | null,
  excludeAnnotObjNums: ReadonlySet<number> = new Set(),
): RenderedRegion {
  const list = cache.get(pageIndex, excludeAnnotObjNums)
  const bbox = deviceRect ?? scaledBounds(list.getBounds(), renderScale)
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, bbox, true)
  let device: DrawDevice | undefined
  try {
    pixmap.clear(255)
    device = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap)
    list.run(device, mupdf.Matrix.scale(renderScale, renderScale))
    device.close()
    device.destroy()
    device = undefined

    const width = pixmap.getWidth()
    const height = pixmap.getHeight()
    const rgba = new Uint8ClampedArray(pixmap.getPixels())
    return { width, height, rgba, deviceRect: [...bbox] as Rect }
  } finally {
    device?.destroy()
    pixmap.destroy()
  }
}
