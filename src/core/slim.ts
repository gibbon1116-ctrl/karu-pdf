import mupdf, { type PDFDocument, type PDFObject } from 'mupdf'
import { documentPassword, openDocument } from './mupdfDoc'

export type SlimImageDpi = 'keep' | 300 | 200 | 150
export interface SlimOptions { imageDpi: SlimImageDpi; deepClean: boolean }
export interface SlimStats {
  imagesChecked: number
  imagesReduced: number
  imagesSkipped: number
  fontsSubset: boolean
  deepClean: 'off' | 'used' | 'rejected'
  rejectedPages: number[]
}

const SAVE_OPTIONS = 'garbage=4,compress,compress-images,compress-fonts,objstms=yes'

function number(object: PDFObject, key: string): number {
  const value = object.get(key)
  try { return value.asNumber() } finally { value.destroy() }
}

function excluded(object: PDFObject): boolean {
  for (const key of ['SMask', 'Mask', 'Decode']) {
    const value = object.get(key)
    try { if (!value.isNull()) return true } finally { value.destroy() }
  }
  const colorSpace = object.get('ColorSpace')
  try {
    if (colorSpace.isArray()) {
      const family = colorSpace.get(0)
      try { if (family.asName() === 'Indexed') return true } finally { family.destroy() }
    }
  } finally { colorSpace.destroy() }
  const mask = object.get('ImageMask'), filter = object.get('Filter')
  try {
    if (mask.asBoolean() || number(object, 'BitsPerComponent') < 8) return true
    const filters = filter.isArray() ? Array.from({ length: filter.length }, (_, index) => {
      const item = filter.get(index)
      try { return item.asName() } finally { item.destroy() }
    }) : [filter.asName()]
    return filters.some(name => name === 'JBIG2Decode' || name === 'CCITTFaxDecode')
  } finally { filter.destroy(); mask.destroy() }
}

/** Rewrites image streams in a disposable output copy, preserving their references. */
export function downsampleImages(document: PDFDocument, imageDpi: Exclude<SlimImageDpi, 'keep'>):
Pick<SlimStats, 'imagesChecked' | 'imagesReduced' | 'imagesSkipped'> {
  if (![300, 200, 150].includes(imageDpi)) throw new Error('画像の解像度が正しくありません。')
  // Record the largest page using each image before replacing any stream. Forms
  // are visited once per page, so sharing a Form cannot hide a larger page use.
  const images = new Map<number, number>()
  function visit(resources: PDFObject, pageSize: number, visited: Set<number>): void {
    const xobjects = resources.get('XObject')
    try {
      xobjects.forEach(object => {
        try {
          const id = object.asIndirect(), subtype = object.get('Subtype')
          try {
            if (subtype.asName() === 'Image') {
              images.set(id, Math.max(images.get(id) ?? 0, pageSize))
            } else if (subtype.asName() === 'Form' && !visited.has(id)) {
              visited.add(id)
              const nested = object.get('Resources')
              try { visit(nested, pageSize, visited) } finally { nested.destroy() }
            }
          } finally { subtype.destroy() }
        } finally { object.destroy() }
      })
    } finally { xobjects.destroy() }
  }
  for (let index = 0; index < document.countPages(); index++) {
    const page = document.loadPage(index)
    try {
      const bounds = page.getBounds(), object = page.getObject()
      const resources = object.getInheritable('Resources')
      try { visit(resources, Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]), new Set()) }
      finally { resources.destroy(); object.destroy() }
    } finally { page.destroy() }
  }

  const stats = { imagesChecked: 0, imagesReduced: 0, imagesSkipped: 0 }
  for (const [id, pageSize] of images) {
    stats.imagesChecked++
    const object = document.newIndirect(id)
    try {
      const width = number(object, 'Width'), height = number(object, 'Height')
      if (excluded(object) || width * height > 100_000_000 || width < 1 || height < 1 || pageSize <= 0) {
        stats.imagesSkipped++
        continue
      }
      const image = document.loadImage(object)
      try {
        const components = image.getNumberOfComponents(), colorspace = image.getColorSpace()
        try {
          if ((components !== 1 && components !== 3) || !colorspace || colorspace.isIndexed()) {
            stats.imagesSkipped++
            continue
          }
        } finally { colorspace?.destroy() }
        const dpi = Math.max(width, height) / (pageSize / 72)
        // dpi <= imageDpi × 1.15, written without the binary rounding of 1.15.
        if (dpi * 20 <= imageDpi * 23) continue
        const newWidth = Math.max(1, Math.round(width * imageDpi / dpi))
        const newHeight = Math.max(1, Math.round(height * imageDpi / dpi))
        const pixmap = new mupdf.Pixmap(components === 1 ? mupdf.ColorSpace.DeviceGray : mupdf.ColorSpace.DeviceRGB,
          [0, 0, newWidth, newHeight], false)
        try {
          pixmap.clear(255)
          const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap)
          try { device.fillImage(image, [newWidth, 0, 0, newHeight, 0, 0], 1); device.close() }
          finally { device.destroy() }
          const jpeg = pixmap.asJPEG(80), raw = object.readRawStream()
          let smaller: boolean
          try { smaller = jpeg.byteLength < raw.asUint8Array().byteLength * 0.9 } finally { raw.destroy() }
          if (!smaller) continue
          object.writeRawStream(jpeg)
          object.put('Filter', 'DCTDecode')
          object.put('Width', newWidth)
          object.put('Height', newHeight)
          object.put('BitsPerComponent', 8)
          object.put('ColorSpace', components === 1 ? 'DeviceGray' : 'DeviceRGB')
          object.delete('DecodeParms')
          stats.imagesReduced++
        } finally { pixmap.destroy() }
      } finally { image.destroy() }
    } finally { object.destroy() }
  }
  return stats
}

/** All pages, including annotations, are compared at 50 dpi in gray. */
export function compareSlimPages(standard: PDFDocument, cleaned: PDFDocument,
  onProgress?: (completed: number, total: number) => void): number[] {
  const total = standard.countPages(), rejected: number[] = []
  if (cleaned.countPages() !== total) throw new Error('整理後のページ数が変わりました。')
  onProgress?.(0, total)
  for (let index = 0; index < total; index++) {
    const beforePage = standard.loadPage(index)
    try {
      const afterPage = cleaned.loadPage(index)
      try {
        const before = beforePage.toPixmap(mupdf.Matrix.scale(50 / 72, 50 / 72), mupdf.ColorSpace.DeviceGray, false, true)
        try {
          const after = afterPage.toPixmap(mupdf.Matrix.scale(50 / 72, 50 / 72), mupdf.ColorSpace.DeviceGray, false, true)
          try {
            const a = before.getPixels(), b = after.getPixels()
            let changed = 0
            if (before.getWidth() !== after.getWidth() || before.getHeight() !== after.getHeight()
              || before.getX() !== after.getX() || before.getY() !== after.getY() || a.length !== b.length) {
              rejected.push(index + 1)
            } else {
              for (let pixel = 0; pixel < a.length; pixel++) if (Math.abs(a[pixel] - b[pixel]) > 32) changed++
              if (changed > Math.max(20, before.getWidth() * before.getHeight() * 0.0001)) rejected.push(index + 1)
            }
          } finally { after.destroy() }
        } finally { before.destroy() }
      } finally { afterPage.destroy() }
    } finally { beforePage.destroy() }
    onProgress?.(index + 1, total)
  }
  return rejected
}

function save(document: PDFDocument, options: string): Uint8Array {
  const buffer = document.saveToBuffer(options)
  try { return buffer.asUint8Array().slice() } finally { buffer.destroy() }
}

/** Only call on an authenticated, disposable copy opened with openDocument. */
export function slimDocument(document: PDFDocument, options: SlimOptions,
  onProgress?: (completed: number, total: number) => void): { bytes: Uint8Array; stats: SlimStats } {
  const pageCount = document.countPages(), password = documentPassword(document)
  const stats: SlimStats = { imagesChecked: 0, imagesReduced: 0, imagesSkipped: 0,
    fontsSubset: false, deepClean: 'off', rejectedPages: [] }
  if (options.imageDpi !== 'keep') Object.assign(stats, downsampleImages(document, options.imageDpi))
  try { document.subsetFonts(); stats.fontsSubset = true } catch { /* Standard compression can still proceed. */ }
  const bytes = save(document, SAVE_OPTIONS), standard = openDocument(bytes, false, password).document.asPDF()!
  try {
    if (standard.countPages() !== pageCount) throw new Error('軽量化後のページ数が変わりました。')
    if (!options.deepClean) return { bytes, stats }
    const cleanedBytes = save(standard, SAVE_OPTIONS + ',clean,sanitize')
    // Reopen both: saving with clean/sanitize can also mutate its input document.
    const reference = openDocument(bytes, false, password).document.asPDF()!
    try {
      const cleaned = openDocument(cleanedBytes, false, password).document.asPDF()!
      try { stats.rejectedPages = compareSlimPages(reference, cleaned, onProgress) }
      finally { cleaned.destroy() }
    } finally { reference.destroy() }
    stats.deepClean = stats.rejectedPages.length || cleanedBytes.byteLength > bytes.byteLength ? 'rejected' : 'used'
    return { bytes: stats.deepClean === 'used' ? cleanedBytes : bytes, stats }
  } finally { standard.destroy() }
}
