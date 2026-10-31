import type { Rect } from '../core/annotations'
import type { CountFixtureSample } from '../core/countFixtures'

export interface FixtureSamplePixels {
  width: number
  height: number
  data: Uint8ClampedArray
}

/**
 * Transparent pixels are composited onto white, as in renderFixtureSample.
 * Compare grayscale pixels without resizing either image.
 */
export function fixtureSamplePixelsMatch(a: FixtureSamplePixels, b: FixtureSamplePixels): boolean {
  if (!Number.isSafeInteger(a.width) || !Number.isSafeInteger(a.height)
    || a.width <= 0 || a.height <= 0 || a.width !== b.width || a.height !== b.height) return false
  const pixels = a.width * a.height
  if (!Number.isSafeInteger(pixels) || a.data.length !== pixels * 4 || b.data.length !== pixels * 4) return false

  const gray = (data: Uint8ClampedArray, offset: number): number => {
    const alpha = data[offset + 3] / 255
    const luminance = (299 * data[offset] + 587 * data[offset + 1] + 114 * data[offset + 2]) / 1000
    return luminance * alpha + 255 * (1 - alpha)
  }
  let difference = 0
  for (let offset = 0; offset < a.data.length; offset += 4) {
    difference += Math.abs(gray(a.data, offset) - gray(b.data, offset))
  }
  return difference / pixels <= 6
}

async function fixtureSamplePixels(sample: CountFixtureSample): Promise<FixtureSamplePixels> {
  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    image.onload = () => {
      image.onload = null
      image.onerror = null
      resolve()
    }
    image.onerror = () => {
      image.onload = null
      image.onerror = null
      reject(new Error('見本の画像を読み込めません。'))
    }
    image.src = `data:image/png;base64,${sample.png}`
  })
  if (image.naturalWidth !== sample.width || image.naturalHeight !== sample.height) {
    throw new Error('見本の画像の大きさが一致しません。')
  }
  const canvas = document.createElement('canvas')
  canvas.width = sample.width
  canvas.height = sample.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('見本の画像を比べられません。')
  context.drawImage(image, 0, 0)
  return {
    width: canvas.width,
    height: canvas.height,
    data: context.getImageData(0, 0, canvas.width, canvas.height).data,
  }
}

export async function fixtureSamplesMatch(a: CountFixtureSample, b: CountFixtureSample): Promise<boolean> {
  if (a.width !== b.width || a.height !== b.height) return false
  const [left, right] = await Promise.all([fixtureSamplePixels(a), fixtureSamplePixels(b)])
  return fixtureSamplePixelsMatch(left, right)
}

/**
 * Accept width/height objects, width/height pairs, or page bounds.
 * Unknown page-size representations fail conservatively and require capture.
 */
export function fixtureSampleRectFitsPage(rect: Rect, pageSize: unknown): boolean {
  if (!Array.isArray(rect) || rect.length !== 4
    || !rect.every(v => typeof v === 'number' && Number.isFinite(v))
    || rect[2] <= rect[0] || rect[3] <= rect[1]) return false

  let bounds: Rect
  if (Array.isArray(pageSize)) {
    if (pageSize.length === 2) bounds = [0, 0, pageSize[0], pageSize[1]]
    else if (pageSize.length === 4) bounds = [...pageSize] as Rect
    else return false
  } else if (pageSize && typeof pageSize === 'object') {
    const size = pageSize as { width?: unknown; height?: unknown }
    if (typeof size.width !== 'number' || typeof size.height !== 'number') return false
    bounds = [0, 0, size.width, size.height]
  } else return false

  return bounds.every(v => typeof v === 'number' && Number.isFinite(v))
    && bounds[2] > bounds[0] && bounds[3] > bounds[1]
    && rect[0] >= bounds[0] && rect[1] >= bounds[1]
    && rect[2] <= bounds[2] && rect[3] <= bounds[3]
}
