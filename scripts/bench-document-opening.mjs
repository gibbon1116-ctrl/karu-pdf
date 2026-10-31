// Production preview on port 4173. Generated fixtures stay local.
import fs from 'node:fs/promises'
import path from 'node:path'
import mupdf from 'mupdf'
import { chromium } from '@playwright/test'

const fixture = path.resolve('test-data/annotated-100p.pdf')
await fs.mkdir(path.dirname(fixture), { recursive: true })
try { await fs.access(fixture) } catch {
  const doc = new mupdf.PDFDocument()
  try {
    for (let i = 0; i < 100; i++) {
      const ref = doc.addPage([0, 0, 595, 842], 0, {}, '')
      try { doc.insertPage(-1, ref) } finally { ref.destroy() }
      const page = doc.loadPage(i)
      try {
        for (let j = 0; j < 100; j++) {
          const annotation = page.createAnnotation('Circle')
          try {
            const x = 20 + (j % 10) * 40, y = 20 + Math.floor(j / 10) * 40
            annotation.setRect([x, y, x + 10, y + 10])
            annotation.setContents('test')
            annotation.update()
          } finally { annotation.destroy() }
        }
      } finally { page.destroy() }
    }
    const saved = doc.saveToBuffer('compress')
    try { await fs.writeFile(fixture, saved.asUint8Array()) } finally { saved.destroy() }
  } finally { doc.destroy() }
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const rows = []
try {
  for (const file of ['sample-small.pdf', 'heavy-300p.pdf', 'annotated-100p.pdf']) {
    for (let run = 1; run <= Number(process.env.KARU_OPEN_RUNS ?? 3); run++) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' })
      try {
        const page = await context.newPage()
        const errors = []
        page.on('pageerror', e => errors.push(e.message))
        await page.addInitScript(() => {
          window.openTimings = []
          const NativeWorker = Worker
          window.Worker = class extends NativeWorker {
            constructor(...args) {
              super(...args)
              const starts = new Map()
              const send = this.postMessage.bind(this)
              this.postMessage = (message, ...rest) => {
                if (message.type === 'open') starts.set(message.requestId, { start: performance.now(), metadata: message.includePageMetadata })
                return send(message, ...rest)
              }
              this.addEventListener('message', ({ data }) => {
                if (data.type === 'opened') {
                  const start = starts.get(data.requestId)
                  window.openTimings.push({ metadata: start?.metadata, totalMs: performance.now() - start.start, openMs: data.openMs, sizesMs: data.sizesMs })
                }
              })
            }
          }
          const read = File.prototype.arrayBuffer
          File.prototype.arrayBuffer = async function () {
            window.fileReadStarted = performance.now()
            const bytes = await read.call(this)
            window.fileReadMs = performance.now() - window.fileReadStarted
            return bytes
          }
        })
        await page.goto('http://127.0.0.1:4173/karu-pdf/?test=1&workers=4&warm=0')
        await page.waitForFunction(() => !!window.__karu)
        await page.getByTestId('file-input').setInputFiles(path.resolve('test-data', file))
        await page.waitForFunction(() => window.__karu.getMetrics().openSharp.count > 0, undefined, { timeout: 120_000 })
        const row = await page.evaluate(() => ({
          firstMs: window.__karu.getMetrics().open.latest,
          sharpMs: window.__karu.getMetrics().openSharp.latest,
          fileReadMs: window.fileReadMs,
          workers: window.openTimings,
        }))
        rows.push({ file, run, bytes: (await fs.stat(path.resolve('test-data', file))).size, ...row, errors })
        console.log(JSON.stringify(rows.at(-1)))
      } finally { await context.close() }
    }
  }
} finally { await browser.close() }
await fs.writeFile(process.argv[2] ?? 'test-results/document-opening.json', JSON.stringify(rows, null, 2))
