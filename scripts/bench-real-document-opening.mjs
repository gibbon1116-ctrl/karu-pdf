// Local-only benchmark. File paths come from a private manifest outside source.
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { chromium } from '@playwright/test'

const manifest = JSON.parse(await fs.readFile(process.argv[2], 'utf8'))
const output = path.resolve(process.argv[3])
await fs.mkdir(path.dirname(output), { recursive: true })
const captures = path.join(path.dirname(output), 'real-pdf-captures')
await fs.mkdir(captures, { recursive: true })
const selected = (process.argv[4] ?? 'before,after').split(',')
const variants = [
  { id: 'before', url: 'http://127.0.0.1:4175/karu-pdf/' },
  { id: 'after', url: 'http://127.0.0.1:4173/karu-pdf/' },
  { id: 'live', url: 'https://gibbon1116-ctrl.github.io/karu-pdf/' },
  { id: 'livecache', url: 'https://gibbon1116-ctrl.github.io/karu-pdf/' },
].filter(variant => selected.includes(variant.id))
if (variants.some(variant => variant.id === 'livecache') && manifest.some(file => path.resolve(file.path) !== path.resolve('test-data/sample-small.pdf'))) {
  throw new Error('Normal-cache network diagnostics are restricted to the generated public sample PDF.')
}
const rows = []
const publicEngine = process.env.KARU_WASM_FROM_PAGES === '1'
const engineUrl = 'https://gibbon1116-ctrl.github.io/karu-pdf/assets/mupdf-wasm-Bvf0xebB.wasm'
const engineHash = publicEngine ? createHash('sha256').update(await fs.readFile('node_modules/mupdf/dist/mupdf-wasm.wasm')).digest('hex') : null
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  for (const file of manifest) {
    const stat = await fs.stat(file.path)
    for (let run = 1; run <= Number(process.env.KARU_OPEN_RUNS ?? 3); run++) {
      for (const variant of run % 2 ? variants : [...variants].reverse()) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' })
        const errors = [], blocked = []
        const row = { id: file.id, variant: variant.id, run, bytes: stat.size, engineDelivery: publicEngine ? 'github-pages-verified-wasm' : 'app-origin' }
        try {
          if (variant.id !== 'livecache') await context.route('**/*', async route => {
            const url = new URL(route.request().url())
            if (publicEngine && route.request().method() === 'GET' && url.origin === new URL(variant.url).origin && url.pathname.endsWith('.wasm')) {
              // The only remote payload is a fixed public engine GET, never PDF bytes.
              const response = await route.fetch({ url: engineUrl, method: 'GET', maxRedirects: 0 })
              const body = await response.body()
              if (!response.ok() || createHash('sha256').update(body).digest('hex') !== engineHash) throw new Error('Public engine does not match the pinned local dependency')
              return route.fulfill({ status: 200, headers: { 'content-type': 'application/wasm' }, body })
            }
            if (['blob:', 'data:'].includes(url.protocol) || route.request().method() === 'GET' && url.origin === new URL(variant.url).origin) return route.continue()
            blocked.push(url.origin)
            return route.abort()
          })
          const page = await context.newPage()
          page.on('request', request => {
            if (request.method() !== 'GET' || new URL(request.url()).origin !== new URL(variant.url).origin) blocked.push(`${request.method()} ${new URL(request.url()).origin}`)
          })
          page.on('pageerror', error => errors.push(error.message))
          await page.addInitScript(() => {
            window.openTimings = []
            window.workerReadyTimings = []
            new PerformanceObserver(list => {
              for (const entry of list.getEntries()) {
                if (/^karu-open-[0-9]/.test(entry.name)) {
                  window.navigationToFirstMs = entry.startTime + entry.duration
                  window.fileToFirstMs = entry.startTime + entry.duration - window.fileReadStarted
                  window.inputToFirstMs = entry.startTime + entry.duration - window.fileInputStarted
                }
                if (/^karu-open-sharp-[0-9]/.test(entry.name)) {
                  window.navigationToSharpMs = entry.startTime + entry.duration
                  window.fileToSharpMs = entry.startTime + entry.duration - window.fileReadStarted
                  window.inputToSharpMs = entry.startTime + entry.duration - window.fileInputStarted
                }
              }
            }).observe({ entryTypes: ['measure'] })
            const NativeWorker = Worker
            window.Worker = class extends NativeWorker {
              constructor(...args) {
                super(...args)
                const created = performance.now()
                const starts = new Map(), send = this.postMessage.bind(this)
                this.postMessage = (message, ...rest) => {
                  if (message.type === 'open') starts.set(message.requestId, { start: performance.now(), metadata: message.includePageMetadata })
                  return send(message, ...rest)
                }
                this.addEventListener('message', ({ data }) => {
                  if (data.type === 'ready') window.workerReadyTimings.push(performance.now() - created)
                  if (data.type !== 'opened') return
                  const start = starts.get(data.requestId)
                  window.openTimings.push({ metadata: start.metadata, totalMs: performance.now() - start.start, openMs: data.openMs, sizesMs: data.sizesMs, pageCount: data.pageCount })
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
          await page.goto(`${variant.url}?test=1&workers=4&warm=0`)
          await page.waitForFunction(() => !!window.__karu)
          row.uiReadyMs = await page.evaluate(() => performance.now())
          await page.evaluate(() => { window.fileInputStarted = performance.now() })
          await page.getByTestId('file-input').setInputFiles(file.path)
          await page.waitForFunction(() => window.__karu.getMetrics().openSharp.count > 0, undefined, { timeout: 180_000 })
          Object.assign(row, await page.evaluate(async () => {
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            const metrics = window.__karu.getMetrics()
            const canvas = document.querySelector('.page-view .preview-canvas')
            const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
            const digest = await crypto.subtle.digest('SHA-256', rgba)
            return {
              firstMs: metrics.open.latest, sharpMs: metrics.openSharp.latest,
              fileReadMs: window.fileReadMs, fileToFirstMs: window.fileToFirstMs,
              fileToSharpMs: window.fileToSharpMs, workers: window.openTimings,
              inputToFirstMs: window.inputToFirstMs, inputToSharpMs: window.inputToSharpMs,
              navigationToFirstMs: window.navigationToFirstMs, navigationToSharpMs: window.navigationToSharpMs,
              renderWorker: metrics.renderWorker, workerReadyMs: window.workerReadyTimings,
              navigationMs: performance.getEntriesByType('navigation')[0].duration,
              engineRequests: performance.getEntriesByType('resource').filter(entry => entry.name.includes('.wasm')).map(entry => ({ duration: entry.duration, transferSize: entry.transferSize })),
              preview: { width: canvas.width, height: canvas.height, sha256: [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('') },
              dirty: window.__karu.listTabs()[0]?.dirty,
            }
          }))
          row.workerResources = await Promise.all(page.workers().map(worker => worker.evaluate(() => performance.getEntriesByType('resource').map(entry => ({ name: entry.name.split('/').at(-1), duration: entry.duration, transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize })))))
          if (run === 1) {
            const png = await page.getByTestId('viewer').screenshot()
            await fs.writeFile(path.join(captures, `${file.id}-${variant.id}.png`), png)
            row.screenshotHash = createHash('sha256').update(png).digest('hex')
          }
        } catch (error) { row.failure = error.message }
        finally { await context.close() }
        rows.push({ ...row, errors, blocked })
        await fs.writeFile(output, JSON.stringify(rows, null, 2))
        console.log(JSON.stringify({ id: row.id, variant: row.variant, run, firstMs: row.firstMs, fileReadMs: row.fileReadMs, totalMs: row.fileToFirstMs, sharpMs: row.fileToSharpMs, primaryMs: row.workers?.find(w => w.metadata)?.totalMs, failure: row.failure, errors: errors.length, blocked: blocked.length }))
      }
    }
  }
} finally { await browser.close() }
if (rows.some(row => row.failure || row.errors.length)) process.exitCode = 1
