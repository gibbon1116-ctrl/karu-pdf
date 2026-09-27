import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mupdf from 'mupdf'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pdfPath = path.join(root, 'test-data', 'heavy-300p.pdf')

function makeDisplayList(page) {
  const started = performance.now()
  const list = new mupdf.DisplayList(page.getBounds())
  const device = new mupdf.DisplayListDevice(list)
  try {
    page.runPageContents(device, mupdf.Matrix.identity)
    for (const annotation of page.getAnnotations()) {
      try { annotation.run(device, mupdf.Matrix.identity) } finally { annotation.destroy() }
    }
    page.runPageWidgets(device, mupdf.Matrix.identity)
    device.close()
  } finally {
    device.destroy()
  }
  return { list, milliseconds: performance.now() - started }
}

function draw(list, scale, deviceRect = null) {
  const bounds = list.getBounds()
  const bbox = deviceRect ?? [
    Math.floor(bounds[0] * scale),
    Math.floor(bounds[1] * scale),
    Math.ceil(bounds[2] * scale),
    Math.ceil(bounds[3] * scale),
  ]
  const started = performance.now()
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, bbox, true)
  const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap)
  try {
    pixmap.clear(255)
    list.run(device, mupdf.Matrix.scale(scale, scale))
    device.close()
    pixmap.getPixels()
    return performance.now() - started
  } finally {
    device.destroy()
    pixmap.destroy()
  }
}

function measurePage(document, pageIndex, kind) {
  const page = document.loadPage(pageIndex)
  try {
    const bounds = page.getBounds()
    const width = bounds[2] - bounds[0]
    const height = bounds[3] - bounds[1]
    const display = makeDisplayList(page)
    try {
      const lowScale = 512 / Math.max(width, height)
      const fitScale = 1408 / Math.max(width, height)
      const detailScale = 4 * 96 / 72
      const detailRect = [0, 0, Math.min(1952, Math.ceil(width * detailScale)), Math.min(1412, Math.ceil(height * detailScale))]
      return {
        種類: kind,
        ページ: pageIndex + 1,
        DisplayList_ms: Number(display.milliseconds.toFixed(1)),
        低解像度512_ms: Number(draw(display.list, lowScale).toFixed(1)),
        全体1408_ms: Number(draw(display.list, fitScale).toFixed(1)),
        詳細1952x1412_ms: Number(draw(display.list, detailScale, detailRect).toFixed(1)),
      }
    } finally {
      display.list.destroy()
    }
  } finally {
    page.destroy()
  }
}

if (!fs.existsSync(pdfPath)) throw new Error('test-data/heavy-300p.pdf がありません。先に npm run make-test-pdf を実行してください。')
const bytes = fs.readFileSync(pdfPath)
const openStarted = performance.now()
const document = mupdf.Document.openDocument(bytes, 'application/pdf')
const openMs = performance.now() - openStarted
try {
  const rows = [
    measurePage(document, 0, 'A4スキャン風'),
    measurePage(document, 5, 'A1ベクター'),
  ]
  console.log(`文書を開く: ${openMs.toFixed(1)} ms (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`)
  console.table(rows)
} finally {
  document.destroy()
}
