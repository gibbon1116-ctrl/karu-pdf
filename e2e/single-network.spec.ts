import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import mupdf from 'mupdf'
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test'

const htmlFile = fs.readdirSync('dist-single').find(name => name.endsWith('.html'))!
const url = pathToFileURL(path.resolve('dist-single', htmlFile)).href + '?test=1'
const note = '閉域の書き込み SINGLE_NOTE_37a', secret = 'SINGLE_PRIVATE_9f3.pdf', search = 'SINGLE_SEARCH_a9'
function makePdf(revised = false) {
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
async function evidence(testInfo: TestInfo, name: string, value: unknown) {
  const file = testInfo.outputPath(name + '.json')
  fs.writeFileSync(file, JSON.stringify(value, null, 2))
  await testInfo.attach(name, { path: file, contentType: 'application/json' })
  console.log(name.toUpperCase(), JSON.stringify(value))
}
async function record(context: BrowserContext) {
  const requests: Array<Promise<{ url: string; method: string; headers: Record<string, string>; body: string | null }>> = []
  context.on('request', r => requests.push(r.allHeaders().then(headers => ({ url: r.url(), method: r.method(), headers, body: r.postData() }))))
  return requests
}
async function verifyTraffic(page: Page, requests: Awaited<ReturnType<typeof record>>, testInfo: TestInfo) {
  const list = await Promise.all(requests), violations = await page.evaluate(() => __singleDiagnostics.violations)
  expect(list.filter(r => !/^(file|blob|data):/.test(r.url))).toEqual([])
  expect(list.filter(r => r.method !== 'GET' || r.body !== null)).toEqual([])
  expect(list.filter(r => r.url.startsWith('file:')).map(r => r.url)).toEqual([url])
  expect(violations).toEqual([])
  for (const r of list) for (const value of [note, secret, search, '%PDF-']) expect(JSON.stringify(r)).not.toContain(value)
  await evidence(testInfo, 'single-network', { external: 0, cspViolations: violations.length, requests: list })
}
async function open(page: Page) {
  await page.goto(url)
  await page.waitForFunction(() => Boolean(window.__karu))
  expect(await page.evaluate(() => __singleDiagnostics.fontDecodes)).toEqual({})
  await page.getByTestId('file-input').setInputFiles({ name: secret, mimeType: 'application/pdf', buffer: makePdf() })
  await expect(page.locator('.page-view[data-page-index="0"]')).toHaveAttribute('data-sharp', 'true')
}
async function point(page: Page, x: number, y: number) {
  return page.getByTestId('annotation-layer-0').evaluate((element, p) => {
    const svg = element as SVGSVGElement, box = svg.getBoundingClientRect(), view = svg.viewBox.baseVal
    return { x: box.left + p.x * box.width / view.width, y: box.top + p.y * box.height / view.height }
  }, { x, y })
}
async function drag(page: Page, a: number[], b: number[]) {
  const start = await point(page, a[0], a[1]), end = await point(page, b[0], b[1])
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 5 }); await page.mouse.up()
}
async function operations(page: Page, testInfo: TestInfo) {
  await open(page)
  for (let i = 1; i <= 10; i++) {
    await page.evaluate(i => window.__karu!.scrollToPage(i), i)
    await expect(page.locator(`.page-view[data-page-index="${i}"]`)).toHaveAttribute('data-sharp', 'true')
  }
  await page.evaluate(() => { window.__karu!.scrollToPage(0); window.__karu!.setZoom(1.1) })
  await expect(page.locator('.page-view[data-page-index="0"]')).toHaveAttribute('data-sharp', 'true')
  await page.keyboard.press('Control+f'); await page.getByLabel('検索する文字').fill(search); await page.getByLabel('検索する文字').press('Enter')
  await expect(page.getByTestId('search-summary')).toContainText('12 件'); await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '文字', exact: true }).click()
  const p = await point(page, 45, 160); await page.mouse.click(p.x, p.y)
  await expect(page.getByTestId('text-editor')).toBeVisible(); await page.keyboard.insertText(note); await page.keyboard.press('Escape')
  await expect(page.getByTestId('annotation-layer-0').locator('.annotation-text')).toContainText(note)
  await page.getByRole('button', { name: '図形▼' }).click(); await page.getByRole('menuitemcheckbox', { name: /^(?:✓\s*)?四角(?:\s|$)/ }).click()
  await drag(page, [180, 180], [240, 220])
  await page.keyboard.press('h'); await drag(page, [45, 245], [130, 245])
  expect(await page.evaluate(() => window.__karu!.getEditableAnnotations(0).length)).toBe(3)
  await page.evaluate(async () => { await window.__karu!.openOrganize(); const draft = window.__karu!.organizeDraft()!; draft.move([draft.getCards()[0].id], 12); await window.__karu!.applyOrganize() })
  // Measure on the new first page after the reorder.
  await page.evaluate(() => window.__karu!.scrollToPage(0))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('button', { name: '計測▼' }).click()
  await page.getByRole('menuitem', { name: '縮尺の設定…', exact: false }).click()
  const dialog = page.getByRole('dialog', { name: '縮尺の設定（1 ページ）' })
  await dialog.getByLabel('縮尺の分母').fill('100'); await dialog.getByRole('button', { name: '決定', exact: true }).click()
  await page.getByRole('button', { name: '距離', exact: true }).click()
  await drag(page, [100, 220], [172, 220])
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).find(a => a.kind === 'distance')?.text)).toBe('2,540 mm')
  const sourceId = await page.evaluate(() => window.__karu!.listTabs()[0].docId)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, 'SINGLE_SECOND_2c.pdf'), [...makePdf(true)])
  await page.evaluate(id => window.__karu!.activateTab(id), sourceId)
  await page.getByRole('button', { name: '表示▼', exact: true }).click(); await page.getByRole('menuitem', { name: '2つの PDF を比較…', exact: true }).click()
  await page.getByRole('button', { name: '比較', exact: true }).click()
  await expect(page.getByTestId('compare-old').locator('.page-view')).toHaveAttribute('data-sharp', 'true')
  await expect(page.getByTestId('compare-view')).toHaveAttribute('data-detection-ms', /\d/)
  await expect(page.getByTestId('compare-difference').first()).toBeVisible()
  await page.getByRole('button', { name: '終わる', exact: true }).click()
  const raster = await page.evaluate(async () => Array.from((await window.__karu!.rasterizeToBytes({ dpi: 150, color: 'color', format: 'png', pageIndexes: [0] }))!))
  const imageDoc = new mupdf.PDFDocument(new Uint8Array(raster))
  try { expect(imageDoc.countPages()).toBe(1); const pg = imageDoc.loadPage(0); try { const text = pg.toStructuredText(''); try { expect(text.asText().trim()).toBe('') } finally { text.destroy() } } finally { pg.destroy() } } finally { imageDoc.destroy() }
  const converted = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16; canvas.getContext('2d')!.fillRect(0, 0, 16, 16)
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/png'))
    return Array.from(await window.__karu!.imagesToPdfToBytes([new File([blob], 'image.png', { type: 'image/png' })], { quality: 'standard', paper: 'a4', orientation: 'portrait', margin: 10, perPage: 1 }))
  })
  const convertedDoc = new mupdf.PDFDocument(new Uint8Array(converted)); try { expect(convertedDoc.countPages()).toBe(1) } finally { convertedDoc.destroy() }
  const saved = await page.evaluate(async () => Array.from((await window.__karu!.saveToBytes())!))
  const savedDoc = new mupdf.PDFDocument(new Uint8Array(saved)), order: string[] = []
  let annotationCount = 0
  try {
    expect(savedDoc.countPages()).toBe(12)
    for (let i = 0; i < 12; i++) {
      const pg = savedDoc.loadPage(i)
      try {
        const text = pg.toStructuredText(''); try { order.push(text.asText().trim()) } finally { text.destroy() }
        const annotations = pg.getAnnotations()
        try { annotationCount += annotations.length; if (i === 11) { expect(annotations).toHaveLength(3); expect(annotations.some(a => a.getContents() === note)).toBe(true); expect(annotations.some(a => a.getType() === 'Square')).toBe(true); expect(annotations.some(a => a.getType() === 'Ink')).toBe(true) } } finally { annotations.forEach(a => a.destroy()) }
      } finally { pg.destroy() }
    }
  } finally { savedDoc.destroy() }
  expect(order).toEqual([...Array.from({ length: 11 }, (_, i) => `${search} page ${i + 2}`), `${search} page 1`]); expect(annotationCount).toBe(4)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '保存結果.pdf'), saved)
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).find(a => a.kind === 'distance')?.text)).toBe('2,540 mm')
  await page.evaluate(() => window.__karu!.scrollToPage(11))
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(11).length)).toBe(3)
  const diagnostics = await page.evaluate(() => __singleDiagnostics)
  expect(diagnostics.wasmDecodes).toBe(1); expect(diagnostics.wasmCompiles).toBe(1); expect(diagnostics.fontDecodes).toEqual({ BIZUDGothic: 1 })
  await evidence(testInfo, 'single-content', { savedBytes: saved.length, sha256: createHash('sha256').update(Buffer.from(saved)).digest('hex'), annotationCount, pageOrder: order, measurement: '2,540 mm', rasterBytes: raster.length, imageWorkerBytes: converted.length, diagnostics })
}

for (const offline of [false, true]) test(`file:// 全操作と通信 ${offline ? '初回からオフライン・base64代替' : '通常'}`, async ({ page, context }, testInfo) => {
  const requests = await record(context)
  if (offline) { await context.setOffline(true); await context.addInitScript(() => Object.defineProperty(Uint8Array, 'fromBase64', { value: undefined, configurable: true })) }
  await operations(page, testInfo); await verifyTraffic(page, requests, testInfo)
})

test('ページと Blob Worker から外部・同じフォルダへの通信を CSP で遮断する', async ({ page, context }, testInfo) => {
  const wire: string[] = [], responses: string[] = [], failed: string[] = []
  await context.route(/^https?:\/\/example\.com\//, route => { wire.push(route.request().url()); return route.abort('blockedbyclient') })
  context.on('response', r => { if (/^https?:/.test(r.url())) responses.push(r.url()) })
  context.on('requestfailed', r => failed.push(r.url()))
  await page.goto(url); await page.waitForFunction(() => Boolean(window.__karu))
  const result = await page.evaluate(async () => {
    const attempt = async (worker: boolean, localURL: string) => {
      const outcomes: Record<string, string | boolean> = {}, violations: string[] = []
      const target = globalThis as unknown as EventTarget
      target.addEventListener('securitypolicyviolation', ((e: Event) => { violations.push((e as SecurityPolicyViolationEvent).effectiveDirective) }))
      for (const [name, url] of [['fetch', 'https://example.com/single-fetch'], ['localFetch', localURL]]) {
        try { await fetch(url); outcomes[name] = 'unexpected' } catch { outcomes[name] = 'blocked' }
      }
      try { const socket = new WebSocket('wss://example.com/single-ws'); outcomes.websocket = await new Promise<string>(resolve => { socket.onerror = () => resolve('blocked'); socket.onopen = () => { socket.close(); resolve('unexpected') } }) } catch { outcomes.websocket = 'blocked' }
      if (!worker) {
        try { outcomes.beacon = navigator.sendBeacon('https://example.com/single-beacon', 'x') } catch { outcomes.beacon = 'exception' }
        outcomes.image = await new Promise<string>(resolve => { const image = new Image(); image.onerror = () => resolve('blocked'); image.onload = () => resolve('unexpected'); image.src = 'https://example.com/single-image.png' })
      } else {
        // These DOM APIs do not exist in a DedicatedWorker. Verify that fact,
        // then try its supported network APIs under the inherited policy.
        outcomes.beacon = typeof navigator.sendBeacon === 'undefined' ? 'unavailable' : 'unexpected'
        outcomes.image = typeof Image === 'undefined' ? 'unavailable' : 'unexpected'
      }
      await new Promise(resolve => setTimeout(resolve, 100))
      return { outcomes, violations }
    }
    const localURL = new URL('./neighbor.txt', location.href).href
    const pageResult = await attempt(false, localURL)
    const code = `(${attempt.toString()})(true,${JSON.stringify(localURL)}).then(result=>postMessage(result))`
    const blob = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
    let workerResult
    try { workerResult = await new Promise<Awaited<ReturnType<typeof attempt>>>((resolve, reject) => { const w = new Worker(blob); w.onmessage = e => { w.terminate(); resolve(e.data) }; w.onerror = e => { w.terminate(); reject(new Error(e.message)) } }) } finally { URL.revokeObjectURL(blob) }
    return { page: pageResult, worker: workerResult }
  })
  for (const data of [result.page, result.worker]) { expect(data.outcomes.fetch).toBe('blocked'); expect(data.outcomes.localFetch).toBe('blocked'); expect(data.outcomes.websocket).toBe('blocked'); expect(data.violations.filter(v => v === 'connect-src').length).toBeGreaterThanOrEqual(3) }
  expect(result.page.outcomes.image).toBe('blocked'); expect(result.page.violations).toContain('img-src'); expect(result.page.violations.filter(v => v === 'connect-src').length).toBeGreaterThanOrEqual(4)
  expect(result.worker.outcomes.beacon).toBe('unavailable'); expect(result.worker.outcomes.image).toBe('unavailable'); expect(wire).toEqual([]); expect(responses).toEqual([])
  await evidence(testInfo, 'single-csp-negative', { ...result, externalWireRequests: wire.length, responses, failed })
})

test('版表示・file:// 印刷タブ・保存先への実書き込み内容を確認する', async ({ page, context }, testInfo) => {
  await page.addInitScript(() => {
    const writes: number[][] = []; Object.assign(window, { __singleWrites: writes, showSaveFilePicker: async () => ({ name: '保存.pdf', queryPermission: async () => 'granted', getFile: async () => new File([], '保存.pdf'), createWritable: async () => ({ write: async (b: ArrayBuffer) => writes.push(Array.from(new Uint8Array(b))), close: async () => undefined }) }) })
  })
  await open(page)
  for (const font of ['BIZUDMincho', 'BIZUDGothic']) {
    await page.getByRole('button', { name: '文字', exact: true }).click()
    await page.getByLabel('書体', { exact: true }).selectOption(font)
    const p = await point(page, 45, font === 'BIZUDMincho' ? 160 : 210)
    await page.mouse.click(p.x, p.y); await expect(page.getByTestId('text-editor')).toBeVisible()
    await page.keyboard.insertText(`${note} ${font}`); await page.keyboard.press('Escape')
    await expect.poll(() => page.evaluate(name => [...document.fonts].some(f => f.family === `Karu${name}` && f.status === 'loaded'), font)).toBe(true)
  }
  expect(await page.evaluate(() => __singleDiagnostics.fontDecodes)).toEqual({ BIZUDMincho: 1, BIZUDGothic: 1 })
  await expect(page.locator('.status-bar')).toContainText('固定・閉域版（HTML）')
  await page.getByRole('button', { name: 'ヘルプ▼' }).click(); await page.getByRole('menuitem', { name: 'このアプリについて', exact: true }).click()
  const build = JSON.parse(fs.readFileSync(path.join('dist-single', htmlFile), 'utf8').match(/id="single-build-info">([\s\S]*?)<\/script>/)![1])
  for (const text of ['1.0.0-single', build.buildDate, build.gitCommit, 'HTML ファイル1つの版（固定・閉域）', '使用しない（CSP で禁止）', 'ファイルの差し替え']) await expect(page.getByRole('dialog', { name: 'かるPDFについて' })).toContainText(text)
  await page.keyboard.press('Escape')
  const waitForSaveReady = async () => {
    // A write completes before recent-file bookkeeping and the saving guard.
    // Wait for the public UI to accept the next save/print operation.
    await page.getByRole('button', { name: 'ファイル▼' }).click()
    await expect(page.getByRole('menuitem', { name: /^上書き保存/ })).toBeEnabled()
    await page.keyboard.press('Escape')
  }
  await page.keyboard.press('Control+Shift+s'); await expect.poll(() => page.evaluate(() => (window as unknown as { __singleWrites: number[][] }).__singleWrites.length)).toBe(1)
  await waitForSaveReady()
  await page.keyboard.press('Control+s'); await expect.poll(() => page.evaluate(() => (window as unknown as { __singleWrites: number[][] }).__singleWrites.length)).toBe(2)
  await waitForSaveReady()
  const writes = await page.evaluate(() => (window as unknown as { __singleWrites: number[][] }).__singleWrites)
  for (const bytes of writes) {
    const doc = new mupdf.PDFDocument(new Uint8Array(bytes))
    try { expect(doc.countPages()).toBe(12); const pg = doc.loadPage(0); try { const annotations = pg.getAnnotations(); try { expect(annotations).toHaveLength(2); expect(annotations.map(a => a.getContents())).toEqual([`${note} BIZUDMincho`, `${note} BIZUDGothic`]) } finally { annotations.forEach(a => a.destroy()) } } finally { pg.destroy() } } finally { doc.destroy() }
  }
  const popupPromise = context.waitForEvent('page'); await page.keyboard.press('Control+p'); const popup = await popupPromise
  await expect(page.locator('.status-bar [role="status"]')).toContainText('新しいタブの印刷ボタンから印刷してください')
  await expect.poll(() => popup.url()).toMatch(/^blob:/)
  await expect(popup.locator('embed[type="application/pdf"]')).toBeVisible()
  const printBytes = await page.evaluate(async () => Array.from((await window.__karu!.printToBytes())!))
  const printDoc = new mupdf.PDFDocument(new Uint8Array(printBytes)); try { expect(printDoc.countPages()).toBe(12) } finally { printDoc.destroy() }
  await evidence(testInfo, 'single-print-save', { popupURL: popup.url(), printBytes: printBytes.length, writes: writes.map(b => ({ bytes: b.length, sha256: createHash('sha256').update(Buffer.from(b)).digest('hex') })), diagnostics: await page.evaluate(() => __singleDiagnostics) })
  await popup.close()
})

test('起動と heavy-300p.pdf の最初の表示を1回計測する', async ({ page }, testInfo) => {
  await page.goto(url)
  await expect(page.getByTestId('start-screen').getByRole('button', { name: /PDFを開く|PDF を開く|開く/ }).first()).toBeEnabled()
  const uiMs = await page.evaluate(() => performance.now())
  const started = Date.now()
  await page.getByTestId('file-input').setInputFiles(path.resolve('test-data/heavy-300p.pdf'))
  await expect(page.locator('.page-view[data-page-index="0"]')).toHaveAttribute('data-sharp', 'true')
  const firstPageMs = Date.now() - started
  await evidence(testInfo, 'single-performance', { uiReadyMs: uiMs, firstPageMs, htmlBytes: fs.statSync(path.join('dist-single', htmlFile)).size, diagnostics: await page.evaluate(() => __singleDiagnostics) })
  expect(uiMs).toBeLessThanOrEqual(2000); expect(firstPageMs).toBeLessThanOrEqual(3000)
})
