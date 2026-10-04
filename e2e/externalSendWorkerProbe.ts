import { expect, type BrowserContext, type Page } from '@playwright/test'

function probe(kind: 'pdf' | 'image', csp: boolean): string {
  return `;setTimeout(()=>{fetch('https://${kind}.example.com/worker-secret').catch(()=>{});${csp ? `try{const x=new XMLHttpRequest();x.open('GET','https://${kind}.example.com/csp-secret');x.send()}catch{}` : ''}},0);`
}
async function makeImage(page: Page) {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!)))
    await window.__karu!.imagesToPdfToBytes([new File([blob], 'probe.png', { type: 'image/png' })], { quality: 'standard', paper: 'a4', orientation: 'portrait', margin: 10, perPage: 1 })
  })
}
async function verify(page: Page, csp: boolean) {
  for (const kind of ['pdf', 'image']) {
    await expect.poll(() => page.evaluate(host => window.__karu!.getExternalSendRecords().some(n => n.kind === 'fetch' && n.host === host), `${kind}.example.com`)).toBe(true)
    if (csp) await expect.poll(() => page.evaluate(host => window.__karu!.getExternalSendRecords().some(n => n.kind === 'CSP で遮断' && n.host === host), `${kind}.example.com`)).toBe(true)
  }
  await expect(page.getByRole('alertdialog', { name: '外部への送信を止めました' })).toContainText('データは送信していません')
}
export async function probeServerWorkers(page: Page, context: BrowserContext, path: string, csp: boolean) {
  const wire: string[] = []
  await context.route(/^https:\/\/(?:pdf|image)\.example\.com\//, route => { wire.push(route.request().url()); return route.abort() })
  await context.route(/\/assets\/(?:pdf|image)\.worker-[^/]+\.js$/, async route => {
    const response = await route.fetch()
    await route.fulfill({ response, body: (await response.text()) + probe(route.request().url().includes('/image.worker-') ? 'image' : 'pdf', csp) })
  })
  await page.goto(path); await page.waitForFunction(() => Boolean(window.__karu))
  await makeImage(page); await verify(page, csp)
  expect(wire).toEqual([])
}
export async function probeSingleWorkers(page: Page, context: BrowserContext, path: string) {
  const wire: string[] = []
  await context.route(/^https:\/\/(?:pdf|image)\.example\.com\//, route => { wire.push(route.request().url()); return route.abort() })
  await page.goto(path); await page.waitForFunction(() => Boolean(window.__karu))
  // Run the real embedded entries; place the probe after their initialization.
  // An empty image task is not needed: image processing below uses its usual client.
  await page.evaluate(({ pdfProbe, imageProbe }) => {
    const code = document.getElementById('single-worker-pdf')!.textContent!.replace('const handler = self.onmessage;', pdfProbe + '\nconst handler = self.onmessage;')
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
    const worker = new Worker(url); URL.revokeObjectURL(url)
    // Guard messages are received by the main Worker constructor listener.
    worker.postMessage({ type: 'single-init', module: __singleWasm })
    Object.assign(window, { __sendProbeWorker: worker })
    const image = document.getElementById('single-worker-image')!
    image.textContent = image.textContent!.replace('const handler = self.onmessage;', imageProbe + '\nconst handler = self.onmessage;')
  }, { pdfProbe: probe('pdf', true), imageProbe: probe('image', true) })
  try { await makeImage(page); await verify(page, true); expect(wire).toEqual([]) }
  finally { await page.evaluate(() => { (window as unknown as { __sendProbeWorker: Worker }).__sendProbeWorker.terminate() }) }
}
