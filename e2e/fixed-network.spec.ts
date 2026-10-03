import fs from 'node:fs'
import path from 'node:path'
import mupdf from 'mupdf'
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import { CSP, SECURITY_HEADERS } from '../scripts/fixed-policy.mjs'

const secretName = 'FIXED_PRIVATE_DOCUMENT_93b71.pdf'
const search = 'FIXED_SEARCH_7a902'
const note = '固定版の機密書込 FIXED_NOTE_d6e23'
const origin = 'http://127.0.0.1:4174', base = '/karu-pdf/'
function makePdf(revised = false): Buffer {
  const doc = new mupdf.PDFDocument()
  try {
    for (let i = 0; i < 12; i++) {
      const obj = doc.addPage([0, 0, 400, 500], 0, { Font: { F1: { Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' } } },
        `BT /F1 16 Tf 30 450 Td (${search} page ${i + 1}) Tj ET\n${revised ? '1 0 0 rg 200 250 40 40 re f' : '0 0 1 rg 150 250 40 40 re f'}`)
      try { doc.insertPage(-1, obj) } finally { obj.destroy() }
    }
    const bytes = doc.saveToBuffer('compress')
    try { return Buffer.from(bytes.asUint8Array()) } finally { bytes.destroy() }
  } finally { doc.destroy() }
}
function staticFiles(dir = 'dist-fixed'): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? staticFiles(path.join(dir, e.name)) : [path.join(dir, e.name).replaceAll('\\', '/').slice('dist-fixed/'.length)])
}
function purpose(url: string) {
  const name = new URL(url).pathname
  if (name.endsWith('sw.js') || /workbox-/.test(name)) return 'Service Worker / Workbox の登録・静的キャッシュ'
  if (name.endsWith('.wasm')) return '同梱 MuPDF WASM'
  if (/worker-/.test(name)) return 'PDF / 画像 Worker'
  if (name.endsWith('.ttf')) return '同梱 BIZ UD フォント'
  if (name.endsWith('.webmanifest')) return 'PWA マニフェスト'
  if (name.endsWith('.png')) return '同梱アイコン'
  if (name.endsWith('.css')) return 'アプリのスタイル'
  if (name.endsWith('.js')) return 'アプリの JavaScript'
  return 'アプリの HTML'
}
async function record(context: BrowserContext) {
  const requests: Array<Promise<{ url: string; method: string; headers: Record<string, string>; headerFallback: boolean; body: string | null; source: string }>> = []
  const violations: unknown[] = []
  context.on('request', req => {
    const cachedHeaders = req.headers()
    const headers = req.allHeaders().then(headers => ({ headers, headerFallback: false })).catch(error => {
      if (!String(error).includes('Worker closed')) throw error
      // A reload can terminate the Worker before the protocol header query completes.
      return { headers: cachedHeaders, headerFallback: true }
    })
    requests.push(headers.then(details => ({ url: req.url(), method: req.method(), ...details, body: req.postData(), source: req.serviceWorker() ? 'Service Worker' : 'Page / Worker' })))
  })
  await context.exposeBinding('__recordFixedViolation', (_source, value) => { violations.push(value) })
  await context.addInitScript(() => document.addEventListener('securitypolicyviolation', event => {
    void (window as unknown as Window & { __recordFixedViolation(value: unknown): Promise<void> }).__recordFixedViolation({ directive: event.effectiveDirective, blockedURI: event.blockedURI })
  }))
  return { requests, violations }
}
async function verifyTraffic(recording: Awaited<ReturnType<typeof record>>, testInfo: TestInfo) {
  const requests = await Promise.all(recording.requests), files = new Set(staticFiles())
  const external = requests.filter(r => new URL(r.url).origin !== origin), writes = requests.filter(r => r.method !== 'GET')
  expect(external).toEqual([]); expect(writes).toEqual([]); expect(recording.violations).toEqual([])
  for (const r of requests) {
    const url = new URL(r.url)
    expect(url.pathname.startsWith(base)).toBe(true)
    expect(files.has(decodeURIComponent(url.pathname.slice(base.length)) || 'index.html')).toBe(true)
    expect(r.body).toBeNull()
    const outgoing = decodeURIComponent(JSON.stringify([r.url, r.headers, r.body]))
    for (const secret of [secretName, 'FIXED_PRIVATE_SECOND_29ac.pdf', 'FIXED_PRIVATE_IMAGE.png', search, note, '%PDF-', makePdf().subarray(0, 80).toString('base64')]) expect(outgoing).not.toContain(secret)
  }
  const list = [...new Set(requests.map(r => r.url))].sort().map(url => ({ url, purpose: purpose(url) }))
  const result = { external: external.length, nonGET: writes.length, cspViolations: recording.violations.length, totalRequests: requests.length, sameOrigin: list, requests }
  const { requests: _rawRequests, ...summary } = result
  console.log('FIXED_NETWORK', JSON.stringify(summary))
  const artifact = testInfo.outputPath('fixed-network.json')
  fs.writeFileSync(artifact, JSON.stringify(result, null, 2))
  await testInfo.attach('fixed-network.json', { path: artifact, contentType: 'application/json' })
  expect(requests.some(r => r.source === 'Service Worker')).toBe(true)
  for (const type of ['.wasm', '.ttf', '.webmanifest', '.png']) expect(requests.some(r => new URL(r.url).pathname.endsWith(type))).toBe(true)
}
async function open(page: Page) {
  await page.getByTestId('file-input').setInputFiles({ name: secretName, mimeType: 'application/pdf', buffer: makePdf() })
  await expect(page.getByText('1 / 12 ページ', { exact: true })).toBeVisible()
  await expect(page.locator('.page-view[data-page-index="0"]')).toHaveAttribute('data-sharp', 'true')
}
async function editAndSave(page: Page) {
  await open(page)
  for (let i = 1; i <= 10; i++) {
    await page.evaluate(i => window.__karu!.scrollToPage(i), i)
    await expect(page.locator(`.page-view[data-page-index="${i}"]`)).toHaveAttribute('data-sharp', 'true')
  }
  await page.evaluate(() => window.__karu!.scrollToPage(0))
  await expect(page.locator('.page-view[data-page-index="0"]')).toHaveAttribute('data-sharp', 'true')
  await page.evaluate(() => window.__karu!.setZoom(1.1))
  await expect(page.locator('.viewer').first()).toHaveAttribute('data-zoom', '1.1')
  await page.keyboard.press('Control+f')
  await page.getByLabel('検索する文字').fill(search)
  await page.getByLabel('検索する文字').press('Enter')
  await expect(page.getByTestId('search-summary')).toContainText('12 件')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '文字', exact: true }).click()
  const layer = page.getByTestId('annotation-layer-0')
  await layer.click({ position: { x: 70, y: 190 } })
  await expect(page.getByTestId('text-editor')).toBeVisible()
  await page.keyboard.insertText(note); await page.keyboard.press('Escape')
  await expect(layer.locator('.annotation-text')).toContainText(note)
  await page.getByRole('button', { name: '図形▼' }).click()
  await page.getByRole('menuitemcheckbox', { name: /^(?:✓\s*)?四角(?:\s|$)/ }).click()
  const box = await layer.boundingBox(); if (!box) throw new Error('No layer')
  await page.mouse.move(box.x + 150, box.y + 230); await page.mouse.down()
  await page.mouse.move(box.x + 230, box.y + 290, { steps: 5 }); await page.mouse.up()
  await page.evaluate(async () => {
    await window.__karu!.openOrganize()
    const draft = window.__karu!.organizeDraft()!
    draft.move([draft.getCards()[0].id], 12)
    await window.__karu!.applyOrganize()
  })
  const result = await page.evaluate(async () => Array.from((await window.__karu!.saveToBytes())!))
  expect(Buffer.from(result).subarray(0, 5).toString()).toBe('%PDF-')
  const saved = mupdf.Document.openDocument(Buffer.from(result), 'application/pdf') as import('mupdf').PDFDocument
  try {
    expect(saved.countPages()).toBe(12)
    const last = saved.loadPage(11)
    try {
      const annotations = last.getAnnotations()
      try { expect(annotations.some(a => a.getContents() === note)).toBe(true); expect(annotations.some(a => a.getType() === 'Square')).toBe(true) }
      finally { annotations.forEach(a => a.destroy()) }
    } finally { last.destroy() }
  } finally { saved.destroy() }
  console.log('FIXED_SAVE', JSON.stringify({ pages: 12, bytes: result.length, textAndSquarePersisted: true, reorderedToPage: 12 }))
}

test('初回の通信を記録し、編集・検索・整理・比較・保存を実行する', async ({ page, context, request }, testInfo) => {
  const recording = await record(context)
  const response = await page.goto(base + '?test=1')
  expect(response).not.toBeNull()
  const headerEvidence = [{ file: 'index.html', headers: response!.headers() }]
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) expect(response!.headers()[key.toLowerCase()]).toBe(value)
  expect(response!.headers()['cache-control']).toBe('no-cache')
  await editAndSave(page)
  const oldId = await page.evaluate(() => window.__karu!.listTabs()[0].docId)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, 'FIXED_PRIVATE_SECOND_29ac.pdf'), [...makePdf(true)])
  await page.evaluate(id => window.__karu!.activateTab(id), oldId)
  await page.getByRole('button', { name: '表示▼', exact: true }).click()
  await page.getByRole('menuitem', { name: '2つの PDF を比較…', exact: true }).click()
  await page.getByRole('button', { name: '比較', exact: true }).click()
  await expect(page.getByTestId('compare-old').locator('.page-view')).toHaveAttribute('data-sharp', 'true')
  await expect(page.getByTestId('compare-view')).toHaveAttribute('data-detection-ms', /\d/)
  // Exercise the image Worker too, without reading a file from any server.
  const imageBytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16
    canvas.getContext('2d')!.fillRect(0, 0, 16, 16)
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/png'))
    return (await window.__karu!.imagesToPdfToBytes([new File([blob], 'FIXED_PRIVATE_IMAGE.png', { type: 'image/png' })], { quality: 'standard', paper: 'a4', orientation: 'portrait', margin: 10, perPage: 1 })).length
  })
  expect(imageBytes).toBeGreaterThan(100)
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
  for (const file of staticFiles().filter(f => f.endsWith('.wasm') || f.endsWith('.webmanifest') || f === 'sw.js')) {
    const res = await request.head(base + file)
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toBe(file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.webmanifest') ? 'application/manifest+json' : 'text/javascript; charset=utf-8')
    expect(res.headers()['cache-control']).toBe('no-cache'); expect(res.headers()['content-security-policy']).toBe(CSP)
    console.log('FIXED_HEADERS', JSON.stringify({ file, headers: res.headers() }))
    headerEvidence.push({ file, headers: res.headers() })
  }
  fs.writeFileSync(testInfo.outputPath('fixed-response-headers.json'), JSON.stringify(headerEvidence, null, 2))
  expect(recording.requests.length).toBeGreaterThan(0)
  await verifyTraffic(recording, testInfo)
})

test('初回・通常再起動・オフライン起動と全編集操作', async ({ page, context }, testInfo) => {
  const recording = await record(context)
  await page.goto(base + '?test=1')
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
  await page.reload(); await page.waitForFunction(() => Boolean(window.__karu && navigator.serviceWorker.controller))
  await open(page)
  await context.setOffline(true)
  await page.reload(); await page.waitForFunction(() => Boolean(window.__karu))
  await editAndSave(page)
  console.log('FIXED_OFFLINE', JSON.stringify({ firstStart: true, restart: true, controlled: true, offlineReload: true, editingAndSave: true }))
  await verifyTraffic(recording, testInfo)
})

test('外部 fetch・WebSocket・Beacon・画像・Worker fetch は CSP が遮断する', async ({ page, context }, testInfo) => {
  const attempts: string[] = [], failed = new Map<string, string>(), responses: string[] = [], wireAttempts: string[] = []
  // Chromium can report a CSP-blocked image as a request event with ERR_FAILED.
  // The route sits immediately before network dispatch. CSP must stop every
  // external operation before it reaches this route; abort is a test guard.
  await context.route(/^https?:\/\/example\.com\//, route => { wireAttempts.push(route.request().url()); return route.abort('blockedbyclient') })
  context.on('request', req => { if (new URL(req.url()).origin !== origin) attempts.push(req.url()) })
  context.on('requestfailed', req => { if (new URL(req.url()).origin !== origin) failed.set(req.url(), req.failure()?.errorText || 'unknown') })
  context.on('response', res => { if (new URL(res.url()).origin !== origin) responses.push(res.url()) })
  await page.goto(base + '?test=1')
  await page.waitForFunction(() => Boolean(window.__karu))
  const result = await page.evaluate(async () => {
    const violations: string[] = [], outcome: Record<string, string | boolean> = {}
    document.addEventListener('securitypolicyviolation', e => violations.push(e.effectiveDirective))
    try { await fetch('https://example.com/fixed-fetch'); outcome.fetch = 'unexpected' } catch { outcome.fetch = 'blocked' }
    try { const socket = new WebSocket('wss://example.com/fixed-ws'); outcome.websocket = await new Promise<string>(resolve => { socket.onerror = () => resolve('blocked'); socket.onopen = () => { socket.close(); resolve('unexpected') } }) } catch { outcome.websocket = 'blocked' }
    try { outcome.beacon = navigator.sendBeacon('https://example.com/fixed-beacon', 'x') } catch { outcome.beacon = 'exception' }
    outcome.image = await new Promise<string>(resolve => { const image = new Image(); image.onerror = () => resolve('blocked'); image.onload = () => resolve('unexpected'); image.src = 'https://example.com/fixed-image.png' })
    const source = `let count=0;self.addEventListener('securitypolicyviolation',()=>count++);fetch('https://example.com/fixed-worker').then(()=>postMessage({blocked:false,count}),()=>setTimeout(()=>postMessage({blocked:true,count}),100))`
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    try {
      outcome.worker = await new Promise<string>((resolve, reject) => { const worker = new Worker(url); worker.onmessage = event => { worker.terminate(); resolve(JSON.stringify(event.data)) }; worker.onerror = event => { worker.terminate(); reject(new Error(event.message)) } })
    } finally { URL.revokeObjectURL(url) }
    await new Promise(resolve => setTimeout(resolve, 100))
    return { outcome, violations }
  })
  expect(result.outcome.fetch).toBe('blocked'); expect(result.outcome.websocket).toBe('blocked'); expect(result.outcome.image).toBe('blocked')
  // Beacon may return true after queueing even when CSP drops it. The violation
  // event and lack of any actual response are the authoritative evidence.
  expect(result.violations.filter(v => v === 'connect-src').length).toBeGreaterThanOrEqual(3)
  expect(result.violations).toContain('img-src')
  expect(JSON.parse(String(result.outcome.worker)).blocked).toBe(true)
  expect(JSON.parse(String(result.outcome.worker)).count).toBeGreaterThan(0)
  expect(responses).toEqual([])
  expect(wireAttempts).toEqual([])
  expect(attempts.filter(url => !failed.has(url))).toEqual([])
  const evidence = { ...result, externalRequestEvents: attempts.length, blockedRequests: [...failed], externalNetworkRequests: wireAttempts.length, externalResponses: responses.length }
  console.log('FIXED_CSP_NEGATIVE', JSON.stringify(evidence))
  const artifact = testInfo.outputPath('fixed-csp-negative.json')
  fs.writeFileSync(artifact, JSON.stringify(evidence, null, 2))
  await testInfo.attach('fixed-csp-negative.json', { path: artifact, contentType: 'application/json' })
})

test('版・日付・コミット・配布形態を表示する', async ({ page }) => {
  const build = JSON.parse(fs.readFileSync('dist-fixed/build-info.json', 'utf8'))
  await page.goto(base + '?test=1'); await open(page)
  await expect(page.locator('.status-bar')).toContainText('固定・閉域版')
  await page.getByRole('button', { name: 'ヘルプ▼', exact: true }).click()
  await page.getByRole('menuitem', { name: 'このアプリについて', exact: true }).click()
  const about = page.getByRole('dialog', { name: 'かるPDFについて' })
  for (const text of ['1.0.0-fixed', build.buildDate, build.gitShort, build.gitCommit, '固定・閉域版', '外部通信: 使用しない', '管理者による手動更新']) await expect(about).toContainText(text)
})
