import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from '@playwright/test'
import mupdf from 'mupdf'

// The single-file build embeds its Workers; their bootstrap needs single-init
// before any other message. 1.4.0 skipped it for the symbol search Worker and the
// search waited forever. This drives the real panel in the single-file build.
const html = fs.readdirSync('dist-single').find(name => name.endsWith('.html'))!
const centers = [[80, 140], [160, 140], [240, 140], [80, 260], [160, 260], [240, 260]]
function symbolPdf(): number[] {
  const doc = new mupdf.PDFDocument()
  try {
    const symbols = centers.map(([x, y]) => {
      const r = 6, k = r * .5522847498
      return `${x + r} ${y} m ${x + r} ${y + k} ${x + k} ${y + r} ${x} ${y + r} c ${x - k} ${y + r} ${x - r} ${y + k} ${x - r} ${y} c ${x - r} ${y - k} ${x - k} ${y - r} ${x} ${y - r} c ${x + k} ${y - r} ${x + r} ${y - k} ${x + r} ${y} c S ${x - r} ${y} m ${x + r} ${y} l S ${x} ${y - r} m ${x} ${y + r} l S`
    }).join('\n')
    const ref = doc.addPage([0, 0, 500, 500], 0, {}, `q 1 0 0 -1 0 500 cm 0 G 0.8 w ${symbols}\n${[260, 340, 420].map(x => `${x - 6} 434 12 12 re S`).join('\n')} Q`)
    try { doc.insertPage(-1, ref) } finally { ref.destroy() }
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { doc.destroy() }
}

test('the single-file build finishes a symbol search and reports Worker failures', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(pathToFileURL(path.resolve('dist-single', html)).href + '?test=1')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '単一版の記号.pdf'), symbolPdf())
  const docId = await page.evaluate(() => window.__karu!.listTabs()[0].docId)
  const result = await page.evaluate(id => (window.__karu as unknown as { symbolSearch(r: unknown): Promise<{ candidates: unknown[] }> })
    .symbolSearch({ docId: id, pageIndex: 0, samplePageIndex: 0, sampleRect: [73, 133, 87, 147] }).then(r => r.candidates.length), docId)
  expect(result).toBe(centers.length)
  expect(errors).toEqual([])
})
