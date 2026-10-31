import mupdf from 'mupdf'
import type { ExifOrientation } from '../src/core/exif'

export const CORNER_COLORS = [[230, 20, 20], [20, 190, 20], [20, 20, 230], [230, 200, 20]]
export function withExif(jpeg: Uint8Array, orientation: number, date = '2026:10:02 12:34:56', little = true) {
  const tiff = new Uint8Array(76), view = new DataView(tiff.buffer)
  tiff.set(little ? [73, 73] : [77, 77]); view.setUint16(2, 42, little); view.setUint32(4, 8, little)
  view.setUint16(8, 2, little)
  view.setUint16(10, 0x112, little); view.setUint16(12, 3, little); view.setUint32(14, 1, little); view.setUint16(18, orientation, little)
  view.setUint16(22, 0x8769, little); view.setUint16(24, 4, little); view.setUint32(26, 1, little); view.setUint32(30, 38, little)
  view.setUint16(38, 1, little); view.setUint16(40, 0x9003, little); view.setUint16(42, 2, little); view.setUint32(44, 20, little); view.setUint32(48, 56, little)
  tiff.set(new TextEncoder().encode(date + '\0'), 56)
  const app = new Uint8Array(86); app.set([255, 225, 0, 84, 69, 120, 105, 102, 0, 0]); app.set(tiff, 10)
  const output = new Uint8Array(jpeg.length + app.length); output.set(jpeg.subarray(0, 2)); output.set(app, 2); output.set(jpeg.subarray(2), 2 + app.length)
  return output
}

export function testJpeg(width = 120, height = 80, solid?: number[], orientation: ExifOrientation = 1): Uint8Array {
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, width, height], false)
  try {
    const pixels = pixmap.getPixels()
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const color = solid ?? CORNER_COLORS[(y >= height / 2 ? 2 : 0) + (x >= width / 2 ? 1 : 0)]
      pixels.set(color, (y * width + x) * 3)
    }
    const jpeg = new Uint8Array(pixmap.asJPEG(95))
    return orientation === 1 ? jpeg : withExif(jpeg, orientation)
  } finally { pixmap.destroy() }
}

// Independently specified expected corner order, TL / TR / BL / BR.
export const ORIENTED_CORNERS = [[0, 1, 2, 3], [1, 0, 3, 2], [3, 2, 1, 0], [2, 3, 0, 1],
  [0, 2, 1, 3], [2, 0, 3, 1], [3, 1, 2, 0], [1, 3, 0, 2]]
