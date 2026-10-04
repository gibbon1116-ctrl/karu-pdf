import { installWorkerExternalSendGuard } from '../security/externalSend'
import { readExif, type ExifOrientation } from '../core/exif'
import { parsePngForPdf } from '../core/pdfStreamWriter'
import type { ImageResult, ImageTask } from '../client/ImageWorkerClient'
import type { ImagePdfSettings } from '../core/imagePdfLayout'
installWorkerExternalSendGuard(self as unknown as DedicatedWorkerGlobalScope, 'image')

function jpegHeader(bytes: Uint8Array) {
  for (let at = 2; at + 4 <= bytes.length;) {
    if (bytes[at++] !== 255) break
    while (bytes[at] === 255) at++
    const marker = bytes[at++]
    if (marker === 0xda || marker === 0xd9) break
    if (marker === 1 || marker >= 0xd0 && marker <= 0xd7) continue
    const length = bytes[at] * 256 + bytes[at + 1]
    if (length < 2 || at + length > bytes.length) break
    if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8 && bytes[at + 2] === 8) {
      return { width: bytes[at + 5] * 256 + bytes[at + 6], height: bytes[at + 3] * 256 + bytes[at + 4], components: bytes[at + 7] }
    }
    at += length
  }
  throw new Error('JPEGの大きさを読み取れません。')
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const value of bytes) {
    crc ^= value
    for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Uint8Array) {
  const output = new Uint8Array(data.length + 12), view = new DataView(output.buffer)
  view.setUint32(0, data.length)
  output.set(new TextEncoder().encode(type), 4); output.set(data, 8)
  view.setUint32(output.length - 4, crc32(output.subarray(4, output.length - 4)))
  return output
}

// Chromium's canvas PNG may still be RGBA even for an opaque canvas. Emit RGB
// scanlines so the existing PDF PNG parser can embed the white-composited result.
async function opaquePng(canvas: OffscreenCanvas): Promise<Uint8Array> {
  const context = canvas.getContext('2d')!
  const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data
  const rows = new Uint8Array((canvas.width * 3 + 1) * canvas.height)
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const source = (y * canvas.width + x) * 4, dest = y * (canvas.width * 3 + 1) + 1 + x * 3
    rows.set(rgba.subarray(source, source + 3), dest)
  }
  const compressed = new Uint8Array(await new Response(new Blob([rows]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer())
  const header = new Uint8Array(13), view = new DataView(header.buffer)
  view.setUint32(0, canvas.width); view.setUint32(4, canvas.height); header[8] = 8; header[9] = 2
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', compressed), chunk('IEND', new Uint8Array())]
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { output.set(part, offset); offset += part.length }
  return output
}

async function processImage(file: File, task: ImageTask, quality: ImagePdfSettings['quality']): Promise<ImageResult> {
  if (/\.hei[cf]$/i.test(file.name) || /image\/hei[cf]/i.test(file.type)) throw new Error('HEIC は読めません。JPEG に変換してから選んでください（iPhone は 設定 → カメラ → フォーマット →「互換性優先」）')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const jpeg = bytes[0] === 255 && bytes[1] === 216
  const png = bytes[0] === 137 && bytes[1] === 80
  if (!jpeg && !png) throw new Error('この画像は読めません。JPEG・PNGを選んでください。')
  const exif = jpeg ? readExif(bytes) : { orientation: 1 as ExifOrientation }
  const header = jpeg ? jpegHeader(bytes) : undefined
  // The dialog has already validated each immutable File during inspection.
  // Original images need no second bitmap decode or canvas at creation time.
  if (task === 'convert' && quality === 'original') {
    if (header) return { width: header.width, height: header.height, ...exif, image: { ...header, format: 'jpeg', bytes } }
    try {
      const parsed = parsePngForPdf(bytes)
      return { width: parsed.width, height: parsed.height, ...exif, image: { width: parsed.width, height: parsed.height, components: parsed.components, format: 'png', bytes } }
    } catch { /* Unsupported PNGs need a white-composited bitmap. */ }
  }
  // Bitmap orientation is already applied by the browser, including reflections.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const info: ImageResult = { width: header?.width ?? bitmap.width, height: header?.height ?? bitmap.height, ...exif }
    if (task === 'inspect') return info
    const limit = task === 'thumbnail' ? 96 : quality === 'small' ? 1600 : quality === 'standard' ? 2400 : Infinity
    const scale = Math.min(1, limit / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d', { alpha: false })!
    try {
      context.fillStyle = '#fff'; context.fillRect(0, 0, width, height)
      context.drawImage(bitmap, 0, 0, width, height)
      const format = quality === 'original' && task === 'convert' ? 'png' : 'jpeg'
      const blob = await canvas.convertToBlob({ type: `image/${format}`, quality: quality === 'small' ? .75 : .85 })
      if (task === 'thumbnail') return { ...info, thumbnail: blob }
      let encoded: Uint8Array = new Uint8Array(await blob.arrayBuffer())
      if (format === 'png') {
        try { parsePngForPdf(encoded) } catch { encoded = await opaquePng(canvas) }
      }
      return { width, height, orientation: 1, dateTime: info.dateTime, image: { bytes: encoded, width, height, components: 3, format } }
    } finally { canvas.width = 0; canvas.height = 0 }
  } finally { bitmap.close() }
}

const scope = self as unknown as DedicatedWorkerGlobalScope
let queue = Promise.resolve()
scope.onmessage = (event: MessageEvent<{ id: number; file: File; task: ImageTask; quality: ImagePdfSettings['quality'] }>) => {
  queue = queue.then(async () => {
    const { id, file, task, quality } = event.data
    try {
      const result = await processImage(file, task, quality)
      scope.postMessage({ id, result }, result.image ? [result.image.bytes.buffer as ArrayBuffer] : [])
    } catch (reason) { scope.postMessage({ id, error: `画像を読めません: ${reason instanceof Error ? reason.message : String(reason)}` }) }
  })
}
