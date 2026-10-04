import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chromium } from '@playwright/test'
import { createFixedServer } from './serve-fixed.mjs'

// Run the same external harness against saved baseline and candidate builds.
// No production instrumentation or dependency changes are needed.
const argument = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index < 0 ? fallback : process.argv[index + 1]
}
const label = argument('--label', 'baseline')
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error('Invalid benchmark label')
const runs = Number(argument('--runs', '5'))
if (!Number.isInteger(runs) || runs < 1) throw new Error('Invalid run count')
const root = path.resolve(argument('--build-dir', 'dist'))
const compareRoot = argument('--compare-build-dir', null)
const referenceRoot = argument('--reference-build-dir', null)
if (referenceRoot && !compareRoot) throw new Error('Reference requires a comparison build')
const browserWarmup = !process.argv.includes('--no-browser-warmup')
const fixtureNames = argument('--fixtures', 'sample-small.pdf,heavy-300p.pdf').split(',')
const networkOnly = process.argv.includes('--network-only')
const actionPage = Number(argument('--action-page', '-1'))
if (!Number.isInteger(actionPage) || actionPage < -1) throw new Error('Invalid action page')
const inputSamples = Number(argument('--input-samples', '40'))
if (!Number.isInteger(inputSamples) || inputSamples < 1 || inputSamples > 500) throw new Error('Invalid input sample count')
const output = path.resolve('bench-results/eizen', `${label}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
await fs.mkdir(output, { recursive: true })
const server = createFixedServer(root)
await new Promise(resolve => server.listen(4175, '127.0.0.1', resolve))
const compareServer = compareRoot ? createFixedServer(path.resolve(compareRoot)) : null
if (compareServer) await new Promise(resolve => compareServer.listen(4176, '127.0.0.1', resolve))
const referenceServer = referenceRoot ? createFixedServer(path.resolve(referenceRoot)) : null
if (referenceServer) await new Promise(resolve => referenceServer.listen(4177, '127.0.0.1', resolve))
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-precise-memory-info'] })
const browserCdp = await browser.newBrowserCDPSession()
const result = {
  schema: 1, label, timestamp: new Date().toISOString(), buildDir: root, runs, mode: networkOnly ? 'open-network' : 'full',
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  browser: browser.version(), node: process.version,
  hardware: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, memoryBytes: os.totalmem(), platform: os.platform(), release: os.release() },
  conditions: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, workers: 4, warm: false, inputSamples, timingOrigin: 'animation-frame-aligned', saveTimingOrigin: 'animation-frame-aligned; no idle delay', readyDefinition: 'active document tab committed to DOM; session registration observed separately', actionPage, openTracing: true, harnessSha256: createHash('sha256').update(await fs.readFile(new URL(import.meta.url))).digest('hex'), serviceWorkers: 'block', cache: 'fresh browser context per trial; OS caches uncontrolled', memory: 'owned browser process private bytes at settled checkpoints; raw JS heap preserved; retained main JS heap collected only after timed operations; not an allocation or peak guarantee' },
  fixtures: [], trials: [], errors: [],
}
const datasets = [result]
result.conditions.browserWarmup = browserWarmup ? 'one unrecorded open per build in its own context before timed trials' : 'none'
result.browserWarmup = []
const outputs = [output]
if (compareRoot) {
  result.order = 'AB/BA alternating, fresh contexts in the same browser'
  datasets.push({ ...structuredClone(result), label: `${label}-candidate`, buildDir: path.resolve(compareRoot) })
  outputs.push(path.join(output, 'candidate'))
  await fs.mkdir(outputs[1], { recursive: true })
}
if (referenceRoot) {
  for (const dataset of datasets) dataset.order = 'ABC/BCA/CAB rotating, fresh contexts in the same browser; A=original, B=candidate, C=previous stage'
  datasets.push({ ...structuredClone(result), label: `${label}-reference`, buildDir: path.resolve(referenceRoot) })
  outputs.push(path.join(output, 'reference'))
  await fs.mkdir(outputs[2], { recursive: true })
}
const checkpoint = async () => {
  for (let variant = 0; variant < datasets.length; variant++) await fs.writeFile(path.join(outputs[variant], 'results.json'), JSON.stringify(datasets[variant], null, 2))
}

async function processMemory() {
  try {
    const { processInfo } = await browserCdp.send('SystemInfo.getProcessInfo')
    const ids = [...new Set(processInfo.map(process => process.id))]
    const command = `$benchProcesses = Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue; @($benchProcesses | Select-Object Id,PrivateMemorySize64,WorkingSet64) | ConvertTo-Json -Compress`
    const json = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true })
    const parsed = JSON.parse(json)
    const processes = Array.isArray(parsed) ? parsed : [parsed]
    return { privateBytes: processes.reduce((total, process) => total + process.PrivateMemorySize64, 0), workingSetBytes: processes.reduce((total, process) => total + process.WorkingSet64, 0), processes }
  } catch (error) { return { unavailable: String(error) } }
}

async function waitSharp(page, index = null) {
  await page.waitForFunction(index => {
    if (!window.__karu?.isSharp()) return false
    if (index === null) return true
    const element = document.querySelector(`.page-view[data-page-index="${index}"]`)
    return element?.dataset.visible === 'true' && element.dataset.sharp === 'true'
  }, index, { timeout: 180_000, polling: 'raf' })
}

async function frameAction(page, action) {
  return page.evaluate(async action => {
    // Cached page moves take roughly one frame. Start at a defined frame phase
    // so random driver timing does not masquerade as a 5% speed change.
    await new Promise(resolve => requestAnimationFrame(resolve))
    const samples = []
    let previous = performance.now(), frame
    const tick = now => { samples.push(now - previous); previous = now; frame = requestAnimationFrame(tick) }
    frame = requestAnimationFrame(tick)
    const viewer = document.querySelector('[data-testid="viewer"]')
    const before = window.__karu.getMetrics()
    const start = performance.now()
    let measurement
    if (action.kind === 'scroll') {
      viewer.scrollTop = 0
      window.__karu.resetBlankFrames()
      await new Promise(resolve => {
        const started = performance.now()
        const move = now => {
          const elapsed = now - started
          viewer.scrollTop = elapsed * action.speed / 1000
          if (elapsed >= 3000) resolve()
          else requestAnimationFrame(move)
        }
        requestAnimationFrame(move)
      })
      measurement = { blank: window.__karu.getMetrics().blankFrames, distancePx: viewer.scrollTop }
    } else {
      if (action.kind === 'zoom') window.__karu.setZoom(action.value)
      if (action.kind === 'pan') viewer.scrollLeft += action.value
      if (action.kind === 'page') window.__karu.scrollToPage(action.value)
      await new Promise((resolve, reject) => {
        const check = () => {
          if (performance.now() - start > 180_000) { reject(new Error('Action did not settle')); return }
          const metrics = window.__karu.getMetrics()
          const settled = action.kind === 'zoom' ? metrics.zoomSettle.count > before.zoomSettle.count
            : action.kind === 'pan' ? metrics.panSettle.count > before.panSettle.count
            : document.querySelector(`.page-view[data-page-index="${action.value}"]`)?.dataset.visible === 'true'
          if (settled && window.__karu.isSharp()) resolve()
          else requestAnimationFrame(check)
        }
        requestAnimationFrame(check)
      })
      const metrics = window.__karu.getMetrics()
      measurement = { elapsedMs: performance.now() - start, settleMs: action.kind === 'zoom' ? metrics.zoomSettle.latest : action.kind === 'pan' ? metrics.panSettle.latest : null }
    }
    cancelAnimationFrame(frame)
    const sorted = samples.sort((a, b) => a - b)
    return { ...measurement, frameCount: samples.length, frameP95Ms: sorted[Math.ceil(sorted.length * .95) - 1] ?? null, frameMaxMs: sorted.at(-1) ?? null }
  }, action)
}

async function trial(file, run, variant = 0) {
  const context = await browser.newContext({ viewport: result.conditions.viewport, deviceScaleFactor: 1, serviceWorkers: 'block', acceptDownloads: true })
  const page = await context.newPage()
  const errors = []
  const resources = []
  const resourceReads = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', response => {
    const item = { url: new URL(response.url()).pathname, status: response.status(), bytes: null, headersBytes: null }
    resources.push(item)
    resourceReads.push(response.finished().then(() => response.request().sizes()).then(sizes => {
      item.bytes = sizes.responseBodySize
      item.headersBytes = sizes.responseHeadersSize
    }).catch(error => { item.unavailable = String(error) }))
  })
  const row = { file: path.basename(file), run, memory: {} }
  const trialOutput = outputs[variant]
  let phase = 'startup'
  const step = value => { phase = value; console.log(`  ${row.file} ${run}: ${value}`) }
  try {
    await page.addInitScript(() => {
      const io = window.__eizenIo = { files: [], workers: [], saves: [] }
      const saveRequests = new Map()
      const read = File.prototype.arrayBuffer
      File.prototype.arrayBuffer = function () {
        const start = performance.now()
        return read.call(this).then(bytes => { io.files.push({ name: this.name, ms: performance.now() - start }); return bytes })
      }
      const NativeWorker = Worker
      let nextWorker = 0
      window.Worker = class extends NativeWorker {
        constructor(url, options) {
          super(url, options)
          const worker = nextWorker++
          this.addEventListener('message', event => {
            const data = event.data
            if (data.type === 'opened') io.workers.push({ worker, openMs: data.openMs, sizesMs: data.sizesMs, receivedAt: performance.now() })
            const save = saveRequests.get(data.requestId)
            if (save) {
              io.saves.push({ worker, response: data.type, roundTripMs: performance.now() - save, nativeSaveMs: data.ms ?? null })
              saveRequests.delete(data.requestId)
            }
          })
        }
        postMessage(message, options) {
          if (message.type === 'applyAndSave') saveRequests.set(message.requestId, performance.now())
          super.postMessage(message, options)
        }
      }
    })
    await page.goto(`http://127.0.0.1:${4175 + variant}/karu-pdf/?test=1&workers=4&warm=0`, { waitUntil: 'networkidle' })
    await Promise.all(resourceReads)
    row.startupResources = resources.map(item => ({ ...item }))
    row.memory.beforeOpen = await processMemory()
    await page.evaluate(() => {
      const state = window.__eizenOpen = { acceptedAt: null, sessionRegisteredMs: null, readyMs: null, firstMs: null, sharpMs: null, feedbackMs: null }
      document.addEventListener('change', event => {
        if (event.target?.dataset?.testid !== 'file-input') return
        state.acceptedAt = performance.now()
        const watch = () => {
          const metrics = window.__karu.getMetrics()
          if (state.sessionRegisteredMs === null && window.__karu.listTabs().length) state.sessionRegisteredMs = performance.now() - state.acceptedAt
          // Registration can precede React's commit by a whole frame or more.
          // Observe the actual active tab, rather than claiming that internal
          // session data alone makes the document's UI available.
          if (state.readyMs === null && state.sessionRegisteredMs !== null && document.querySelector('.document-tab-name[aria-current="page"]')) state.readyMs = performance.now() - state.acceptedAt
          if (state.firstMs === null && metrics.open.count) state.firstMs = performance.now() - state.acceptedAt
          if (state.feedbackMs === null && document.querySelector('[data-testid="pdf-opening"]:not([hidden])')) state.feedbackMs = performance.now() - state.acceptedAt
          if (metrics.openSharp.count) { state.sharpMs = performance.now() - state.acceptedAt; return }
          requestAnimationFrame(watch)
        }
        requestAnimationFrame(watch)
      }, { capture: true, once: true })
    })
    step('open')
    await page.getByTestId('file-input').setInputFiles(file)
    await page.waitForFunction(() => window.__eizenOpen.sharpMs !== null, null, { timeout: 180_000, polling: 'raf' })
    row.open = await page.evaluate(() => ({ ...window.__eizenOpen, fileReads: window.__eizenIo.files, workerOpens: window.__eizenIo.workers, internal: window.__karu.getMetrics() }))
    await Promise.all(resourceReads)
    row.initialResources = resources.map(item => ({ ...item }))
    row.initialBytes = resources.reduce((total, item) => total + (item.bytes ?? 0), 0)
    row.initialTransferBytes = resources.reduce((total, item) => total + (item.bytes ?? 0) + (item.headersBytes ?? 0), 0)
    row.resourceBytesComplete = resources.every(item => item.bytes !== null)
    row.memory.afterOpen = await processMemory()
    row.mainHeapAfterOpenBytes = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null)
    if (networkOnly) { row.errors = errors; if (errors.length) throw new Error(errors.join('; ')); return row }
    step('scroll')
    row.scroll1500Cold = await frameAction(page, { kind: 'scroll', speed: 1500 })
    await waitSharp(page)
    row.scroll1500Cached = await frameAction(page, { kind: 'scroll', speed: 1500 })
    row.scroll3000 = await frameAction(page, { kind: 'scroll', speed: 3000 })
    await waitSharp(page)
    const target = actionPage >= 0 ? actionPage : row.file === 'heavy-300p.pdf' ? 5 : 2
    row.actionPage = target
    step('page move')
    row.pageMove = await frameAction(page, { kind: 'page', value: target })
    step('zoom')
    row.zoom400 = await frameAction(page, { kind: 'zoom', value: 4 })
    await waitSharp(page, target)
    await page.getByTestId('viewer').evaluate(element => { element.scrollLeft = 0 })
    await page.waitForTimeout(350)
    await waitSharp(page)
    step('pan')
    row.pan250 = await frameAction(page, { kind: 'pan', value: 250 })
    step('annotations')
    await page.evaluate(() => window.__karu.setZoom(1))
    await page.waitForTimeout(350)
    await waitSharp(page)
    await page.evaluate(() => window.__karu.scrollToPage(0))
    // Mixed A1/A4 layouts center pages in the widest sheet. Match the existing
    // performance tests' explicit horizontal alignment before editing A4.
    await page.getByTestId('viewer').evaluate(element => {
      const target = element.querySelector('.page-view[data-page-index="0"]')
      if (target) element.scrollLeft = target.offsetLeft
    })
    await waitSharp(page, 0)
    const layer = page.getByTestId('annotation-layer-0')
    const box = await layer.boundingBox()
    const viewer = await page.getByTestId('viewer').boundingBox()
    const x = Math.max(viewer.x + 70, box.x + 100), y = Math.max(viewer.y + 70, box.y + 150)
    await page.getByRole('button', { name: '図形▼' }).click()
    await page.getByRole('menuitemcheckbox', { name: /^(?:✓\s*)?四角(?:\s|$)/ }).click()
    await page.mouse.move(x, y)
    await page.mouse.down()
    for (let step = 1; step <= 100; step++) { await page.mouse.move(x + step, y + step * .4); await page.waitForTimeout(17) }
    await page.mouse.up()
    await page.getByRole('button', { name: '文字', exact: true }).click()
    await page.mouse.click(x, y + 100)
    await page.getByTestId('text-editor').waitFor({ state: 'visible' })
    const characters = [...'営繕図面の注記を確認します。機器名称と回路番号１２３４５６７８９０を入力します。'.slice(0, 40)]
    for (let index = 0; index < inputSamples; index++) { await page.keyboard.insertText(characters[index % characters.length]); await page.waitForTimeout(30) }
    await page.keyboard.press('Control+Enter')
    await page.getByTestId('text-editor').waitFor({ state: 'hidden' })
    row.edit = await page.evaluate(() => window.__karu.getFrameStats())
    step('save')
    const downloadPromise = page.waitForEvent('download')
    row.save = await page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(resolve))
      const start = performance.now()
      const bytes = await window.__karu.saveToBytes()
      if (!bytes) throw new Error('No save output')
      const generatedMs = performance.now() - start
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      const link = document.createElement('a')
      link.href = url; link.download = 'benchmark-output.pdf'; link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      return { generatedMs, bytes: bytes.length }
    })
    const diskStart = performance.now()
    const download = await downloadPromise
    await download.saveAs(path.join(trialOutput, `${row.file}-${run}-saved.pdf`))
    row.save.downloadCompletionObservedMs = performance.now() - diskStart
    row.save.note = 'PDF generation in browser; download completion observed separately, includes automation overhead, not File System Access overwrite latency'
    row.save.workerTraces = await page.evaluate(() => window.__eizenIo.saves)
    row.memory.afterOperations = await processMemory()
    row.mainHeapAfterOperationsBytes = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null)
    row.workerStats = await page.evaluate(() => window.__karu.getWorkerStats())
    // A raw heap snapshot includes garbage whose collection time is outside
    // our control. Preserve it, and measure reachable JS after all timed work
    // so forced collection cannot make scrolling, input or saving look faster.
    const heapCdp = await context.newCDPSession(page)
    await heapCdp.send('Performance.enable')
    await heapCdp.send('HeapProfiler.collectGarbage')
    const heapMetrics = await heapCdp.send('Performance.getMetrics')
    row.mainRetainedHeapAfterOperationsBytes = heapMetrics.metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value ?? null
    await heapCdp.detach()
    step('close')
    const ids = await page.evaluate(() => window.__karu.listTabs().map(tab => tab.docId))
    for (const id of ids) await page.evaluate(id => window.__karu.closeTab(id), id)
    await page.waitForTimeout(500)
    row.memory.afterDocumentClose = await processMemory()
    row.errors = errors
    if (errors.length) throw new Error(errors.join('; '))
    return row
  } catch (error) {
    row.failedAt = phase
    row.failure = String(error)
    row.diagnostics = await page.evaluate(() => ({ metrics: window.__karu?.getMetrics(), errors: [...document.querySelectorAll('[role="alert"]')].map(el => el.textContent), viewer: { left: document.querySelector('[data-testid="viewer"]')?.scrollLeft, top: document.querySelector('[data-testid="viewer"]')?.scrollTop }, pages: [...document.querySelectorAll('.page-view')].map(el => ({ ...el.dataset })) })).catch(() => null)
    await fs.writeFile(path.join(trialOutput, `${row.file}-${run}-failure.json`), JSON.stringify(row, null, 2))
    await page.screenshot({ path: path.join(trialOutput, `${row.file}-${run}-failure.png`) }).catch(() => {})
    throw error
  } finally { await context.close() }
}

async function warmBrowser(variant) {
  const context = await browser.newContext({ viewport: result.conditions.viewport, deviceScaleFactor: 1, serviceWorkers: 'block', acceptDownloads: true })
  try {
    const page = await context.newPage()
    await page.goto(`http://127.0.0.1:${4175 + variant}/karu-pdf/?test=1&workers=4&warm=0`, { waitUntil: 'networkidle' })
    await page.evaluate(() => {
      const state = window.__eizenOpen = { acceptedAt: null, firstMs: null, sharpMs: null }
      document.addEventListener('change', event => {
        if (event.target?.dataset?.testid !== 'file-input') return
        state.acceptedAt = performance.now()
        const watch = () => {
          const metrics = window.__karu.getMetrics()
          if (state.firstMs === null && metrics.open.count) state.firstMs = performance.now() - state.acceptedAt
          if (metrics.openSharp.count) { state.sharpMs = performance.now() - state.acceptedAt; return }
          requestAnimationFrame(watch)
        }
        requestAnimationFrame(watch)
      }, { capture: true, once: true })
    })
    await page.getByTestId('file-input').setInputFiles(path.resolve('test-data', fixtureNames[0]))
    await page.waitForFunction(() => window.__eizenOpen.sharpMs !== null, null, { timeout: 180_000, polling: 'raf' })
    datasets[variant].browserWarmup.push(await page.evaluate(fixture => ({ fixture, firstMs: window.__eizenOpen.firstMs, sharpMs: window.__eizenOpen.sharpMs }), fixtureNames[0]))
  } finally { await context.close() }
}

try {
  if (browserWarmup) {
    for (let variant = 0; variant < datasets.length; variant++) {
      console.log(`[${datasets[variant].label}] browser warmup: ${fixtureNames[0]}`)
      await warmBrowser(variant)
    }
  }
  for (const name of fixtureNames) {
    const file = path.resolve('test-data', name)
    const bytes = await fs.readFile(file)
    const fixture = { file: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
    for (const dataset of datasets) dataset.fixtures.push(fixture)
    for (let run = 1; run <= runs; run++) {
      const order = datasets.length === 2 && run % 2 === 0 ? [1, 0] : datasets.map((_, index) => (index + (run - 1)) % datasets.length)
      for (const variant of order) {
        console.log(`[${datasets[variant].label}] ${name} ${run}/${runs}`)
        try { datasets[variant].trials.push(await trial(file, run, variant)) }
        catch (error) { datasets[variant].errors.push({ file: name, run, error: String(error) }); throw error }
        await checkpoint()
      }
    }
  }
  console.log(`Saved ${result.trials.length} trials: ${output}`)
} finally {
  await checkpoint()
  await browser.close()
  await new Promise(resolve => server.close(resolve))
  if (compareServer) await new Promise(resolve => compareServer.close(resolve))
  if (referenceServer) await new Promise(resolve => referenceServer.close(resolve))
}
