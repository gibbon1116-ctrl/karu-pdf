import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import mupdf from 'mupdf'
import { chromium } from '@playwright/test'
import { createFixedServer } from './serve-fixed.mjs'

const file = path.resolve(process.argv[2] ?? 'test-data/shichigahama-drawing.pdf')
const bytes = await fs.readFile(file), name = path.basename(file), document = new mupdf.PDFDocument(bytes)
// Independent native walk: do not call the new export/cache/CSV implementation.
const expected = new Map(), pages = document.countPages()
for (let index = 0; index < pages; index++) {
  const page = document.loadPage(index), text = page.toStructuredText('preserve-whitespace'), lines = []
  let line = 0, current
  try {
    text.walk({ beginLine: rect => { current = { id: ++line, rect: [...rect], text: '' } }, onChar: (char, _origin, font) => { try { current.text += char } finally { font.destroy() } }, endLine: () => { if (current.text.trim()) lines.push(current) } })
    expected.set(index + 1, { lines, bounds: page.getBounds() })
  } finally { text.destroy(); page.destroy() }
}
document.destroy()
function parseCsv(source) {
  const rows = []; let row = [], value = '', quoted = false
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (char === '"') { if (quoted && source[index + 1] === '"') { value += char; index++ } else quoted = !quoted }
    else if (char === ',' && !quoted) { row.push(value); value = '' }
    else if (char === '\n' && !quoted) { row.push(value.replace(/\r$/, '')); rows.push(row); row = []; value = '' }
    else value += char
  }
  assert.equal(quoted, false); return rows
}
const server = createFixedServer(path.resolve(process.argv[3] ?? 'bench-results/eizen/text-export-dist'))
await new Promise(resolve => server.listen(4180, '127.0.0.1', resolve))
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-precise-memory-info'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', acceptDownloads: true })
const errors = []; page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto('http://127.0.0.1:4180/karu-pdf/?test=1&workers=4&warm=0')
  await page.getByTestId('file-input').setInputFiles(file)
  await page.waitForFunction(() => window.__karu.getMetrics().openSharp.count === 1 && window.__karu.isSharp(), null, { timeout: 180_000 })
  assert.equal((await page.evaluate(() => window.__karu.getWorkerStats())).extractedTextCacheBytes, 0)
  await page.getByRole('button', { name: 'ファイル▼', exact: true }).click()
  await page.getByRole('menuitem', { name: '図面内文字を抽出…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '図面内文字を抽出' })
  await dialog.getByLabel('抽出するページ').selectOption('all')
  const runs = []
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = performance.now()
    await dialog.getByRole('button', { name: '文字を抽出', exact: true }).click()
    await dialog.getByRole('link', { name: '抽出結果を保存' }).waitFor({ timeout: 180_000 })
    const elapsedMs = performance.now() - started, download = page.waitForEvent('download')
    await dialog.getByRole('link', { name: '抽出結果を保存' }).click()
    const csvBytes = await fs.readFile(await (await download).path()), rows = parseCsv(csvBytes.toString('utf8')).slice(1)
    let count = 0, empty = 0
    for (const row of rows) {
      const number = Number(row[1]), source = expected.get(number)
      assert.ok(source, `Page ${number}`)
      if (!row[3]) { assert.equal(source.lines.length, 0); assert.equal(row[15], '文字なし'); empty++; continue }
      const line = source.lines.find(line => line.id === Number(row[3])); assert.ok(line)
      const protectedText = /^[\t\r\n]/.test(line.text) || /^[\s\u0000-\u001f]*[=+\-@＝＋－＠]/.test(line.text) ? `'${line.text}` : line.text
      assert.equal(row[4], protectedText)
      const mm = value => Number((value * 25.4 / 72).toFixed(3))
      assert.equal(Number(row[5]), mm(line.rect[0] - source.bounds[0])); assert.equal(Number(row[6]), mm(line.rect[1] - source.bounds[1]))
      assert.equal(Number(row[9]), mm(source.bounds[2] - source.bounds[0])); assert.equal(Number(row[10]), mm(source.bounds[3] - source.bounds[1]))
      count++
    }
    assert.equal(count, [...expected.values()].reduce((sum, item) => sum + item.lines.length, 0))
    assert.equal(new Set(rows.map(row => Number(row[1]))).size, pages)
    const stats = await page.evaluate(() => window.__karu.getWorkerStats())
    assert.ok(stats.extractedTextCacheBytes <= 4 * 1024 * 1024)
    runs.push({ attempt: attempt + 1, elapsedMs, lines: count, emptyPages: empty, outputBytes: csvBytes.length, sha256: createHash('sha256').update(csvBytes).digest('hex'), stats, mainHeapBytes: await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null), status: await dialog.getByRole('status').innerText() })
    await fs.writeFile(`work/${name}-text.csv`, csvBytes)
  }
  assert.equal(runs[0].sha256, runs[1].sha256)
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
  for (const id of await page.evaluate(() => window.__karu.listTabs().map(tab => tab.docId))) await page.evaluate(id => window.__karu.closeTab(id), id)
  const afterClose = await page.evaluate(() => window.__karu.getWorkerStats()); assert.equal(afterClose.extractedTextCacheBytes, 0)
  assert.deepEqual(errors, [])
  const report = { file: name, sourceBytes: bytes.length, sourceSha256: createHash('sha256').update(bytes).digest('hex'), browser: browser.version(), pages, checks: 'Every native line and page count, formula protection, mm X/Y and sheet bounds, deterministic repeat output, cache budget and disposal; not an independent PDF decoder or OCR accuracy test', runs, afterClose, errors }
  await fs.writeFile(`work/${name}-text-validation.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ file: name, pages, runs: runs.map(({ elapsedMs, lines, emptyPages, outputBytes, stats }) => ({ elapsedMs, lines, emptyPages, outputBytes, cacheBytes: stats.extractedTextCacheBytes })), cacheAfterClose: afterClose.extractedTextCacheBytes, errors }))
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
