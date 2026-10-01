import mupdf, { type PDFDocument } from 'mupdf'
import path from 'node:path'
import fs from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { CORNER_COLORS, ORIENTED_CORNERS, testJpeg } from '../tests/imagePdfFixtures'
import { DEFAULT_IMAGE_PDF_SETTINGS } from '../src/core/imagePdfLayout'
import { parsePngForPdf } from '../src/core/pdfStreamWriter'
import type { ExifOrientation } from '../src/core/exif'

const payloads = CORNER_COLORS.slice(0, 3).map((color, i) => ({ name: `${i + 1}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(testJpeg(120, 80, color)) }))
async function setup(page: Page) {
  await page.addInitScript(() => Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true }))
  await page.goto('/karu-pdf/?test=1')
  await expect.poll(() => page.evaluate(() => Boolean(window.__karu))).toBe(true)
}
async function choose(page: Page, files = payloads) {
  await page.getByRole('button', { name: 'ファイル▼' }).click()
  await page.getByRole('menuitem', { name: '画像から PDF を作る…' }).click()
  await page.getByTestId('image-file-input').setInputFiles(files)
  const dialog = page.getByTestId('images-to-pdf-dialog')
  await expect(dialog.getByRole('button', { name: '作成', exact: true })).toBeEnabled()
  return dialog
}
async function exported(page: Page) {
  return new mupdf.PDFDocument(Uint8Array.from(await page.evaluate(async () => Array.from(await window.__karu!.exportDocumentBytes()))))
}
function centerColor(doc: PDFDocument, index: number): number[] {
  const page = doc.loadPage(index), pixmap = page.toPixmap(mupdf.Matrix.scale(.5, .5), mupdf.ColorSpace.DeviceRGB, false)
  try { const at = (Math.floor(pixmap.getHeight() / 2) * pixmap.getWidth() + Math.floor(pixmap.getWidth() / 2)) * 3; return Array.from(pixmap.getPixels().subarray(at, at + 3)) }
  finally { pixmap.destroy(); page.destroy() }
}
function colorNear(actual: number[], expected: number[]) { expected.forEach((value, i) => expect(Math.abs(actual[i] - value)).toBeLessThan(28)) }

test('メニューから3枚を選び↓で順を変更、未保存の新規タブと実際のページ色を確認', async ({ page }) => {
  await setup(page)
  const dialog = await choose(page)
  await dialog.getByRole('button', { name: '1.jpgを下へ' }).click()
  await dialog.getByLabel('画像PDFの画質').selectOption('original')
  await dialog.getByRole('button', { name: '作成', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(await page.evaluate(() => window.__karu!.listTabs())).toMatchObject([{ name: expect.stringMatching(/^画像から作成_\d{8}\.pdf$/), dirty: true }])
  const doc = await exported(page)
  try { expect(doc.countPages()).toBe(3); [1, 0, 2].forEach((color, index) => colorNear(centerColor(doc, index), CORNER_COLORS[color])) } finally { doc.destroy() }
})

test('標準は4000×3000を2400×1800へ縮小して埋め込む', async ({ page }) => {
  await setup(page)
  const dialog = await choose(page, [{ name: 'large.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(testJpeg(4000, 3000, CORNER_COLORS[0])) }])
  await dialog.getByRole('button', { name: '作成', exact: true }).click(); await expect(dialog).not.toBeVisible()
  const doc = await exported(page), object = doc.findPage(0), image = object.get('Resources', 'XObject', 'Im0'), w = image.get('Width'), h = image.get('Height')
  try { expect([w.asNumber(), h.asNumber()]).toEqual([2400, 1800]); colorNear(centerColor(doc, 0), CORNER_COLORS[0]) }
  finally { w.destroy(); h.destroy(); image.destroy(); object.destroy(); doc.destroy() }
})

test('選択ページの後へ2枚を下書きに挿入、適用後の内容と元ページを確認', async ({ page }) => {
  await setup(page); await page.getByTestId('file-input').setInputFiles(path.resolve('test-data/sample-small.pdf'))
  await expect(page.getByText('1 / 5 ページ', { exact: true })).toBeVisible()
  await page.evaluate(() => window.__karu!.openOrganize())
  await page.getByTestId('organize-card-1').click()
  await page.getByRole('button', { name: '挿入▼' }).click(); await page.getByRole('menuitem', { name: '画像を挿入…' }).click()
  await page.getByTestId('organize-image-input').setInputFiles(payloads.slice(0, 2))
  const dialog = page.getByTestId('images-to-pdf-dialog')
  await expect(dialog.getByRole('button', { name: '挿入', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: '挿入', exact: true }).click(); await expect(dialog).not.toBeVisible()
  expect(await page.evaluate(() => window.__karu!.getPageInfo().then(pages => pages.length))).toBe(5)
  await page.getByRole('button', { name: '適用', exact: true }).click(); await expect(page.getByTestId('organize-view')).not.toBeVisible()
  const doc = await exported(page)
  try {
    expect(doc.countPages()).toBe(7); colorNear(centerColor(doc, 2), CORNER_COLORS[0]); colorNear(centerColor(doc, 3), CORNER_COLORS[1])
    for (const [output, original] of [[0, 1], [1, 2], [4, 3], [5, 4], [6, 5]]) {
      const p = doc.loadPage(output), text = p.toStructuredText('')
      try { expect(text.asText()).toContain(`Sample page ${original}`) } finally { text.destroy(); p.destroy() }
    }
  } finally { doc.destroy() }
})

test('HEICと壊れたJPEGは赤字で除外し、読める画像だけを作成', async ({ page }) => {
  await setup(page)
  await page.getByTestId('image-file-input').setInputFiles([payloads[0], { name: 'phone.heic', mimeType: 'image/heic', buffer: Buffer.from('bad') }, { name: 'broken.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('broken') }])
  const dialog = page.getByTestId('images-to-pdf-dialog')
  await expect(dialog.getByText(/HEIC は読めません/)).toBeVisible()
  await expect(dialog.locator('.image-row-error')).toHaveCount(2)
  expect(await dialog.locator('.image-row-error').first().evaluate(e => getComputedStyle(e).color)).toBe('rgb(180, 35, 24)')
  await expect(dialog.getByRole('button', { name: '作成', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: '作成', exact: true }).click(); await expect(dialog).not.toBeVisible()
  const doc = await exported(page); try { expect(doc.countPages()).toBe(1); colorNear(centerColor(doc, 0), CORNER_COLORS[0]) } finally { doc.destroy() }
})

test('作成中の中止で新しいタブを作らず、再度作成できる', async ({ page }) => {
  await setup(page)
  const buffer = Buffer.from(testJpeg(4000, 3000, CORNER_COLORS[0]))
  const dialog = await choose(page, Array.from({ length: 30 }, (_, i) => ({ name: `${i}.jpg`, mimeType: 'image/jpeg', buffer })))
  await dialog.getByRole('button', { name: '作成', exact: true }).click()
  await dialog.getByRole('button', { name: '中止', exact: true }).click(); await expect(dialog).not.toBeVisible()
  expect(await page.evaluate(() => window.__karu!.listTabs())).toEqual([])
  const again = await choose(page, [payloads[0]])
  await again.getByRole('button', { name: '作成', exact: true }).click(); await expect(again).not.toBeVisible()
  expect(await page.evaluate(() => window.__karu!.listTabs().length)).toBe(1)
})

test('実WorkerのEXIF1〜8を標準・元のままでPDFにし、四隅の色と寸法を照合', async ({ page }) => {
  await setup(page)
  const files = Array.from({ length: 8 }, (_, i) => Array.from(testJpeg(120, 80, undefined, i + 1 as ExifOrientation)))
  for (const quality of ['original', 'standard'] as const) {
    const bytes = await page.evaluate(async ({ files, settings }) => {
      return Array.from(await window.__karu!.imagesToPdfToBytes(files.map((bytes, i) => new File([Uint8Array.from(bytes)], `${i}.jpg`, { type: 'image/jpeg' })), settings))
    }, { files, settings: { ...DEFAULT_IMAGE_PDF_SETTINGS, paper: 'image' as const, quality } })
    const doc = new mupdf.PDFDocument(Uint8Array.from(bytes))
    try { for (let i = 0; i < 8; i++) {
      const p = doc.loadPage(i), pix = p.toPixmap(mupdf.Matrix.scale(4, 4), mupdf.ColorSpace.DeviceRGB, false)
      try { for (const [corner, [x, y]] of [[.25, .25], [.75, .25], [.25, .75], [.75, .75]].entries()) {
        const at = (Math.floor(y * pix.getHeight()) * pix.getWidth() + Math.floor(x * pix.getWidth())) * 3
        colorNear(Array.from(pix.getPixels().subarray(at, at + 3)), CORNER_COLORS[ORIENTED_CORNERS[i][corner]])
      } } finally { pix.destroy(); p.destroy() }
    } } finally { doc.destroy() }
  }
})

test('透明PNGを白背景のPNGに直し、元のRGB PNGはIDATを保って埋め込む', async ({ page }) => {
  await setup(page)
  const opaque = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 100, 60], false)
  opaque.clear(20)
  const png = Array.from(opaque.asPNG()); opaque.destroy()
  const bytes = await page.evaluate(async ({ png, settings }) => {
    const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 60
    const context = canvas.getContext('2d')!; context.fillStyle = 'red'; context.fillRect(50, 0, 50, 60)
    const transparent = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'))
    return Array.from(await window.__karu!.imagesToPdfToBytes([new File([Uint8Array.from(png)], 'rgb.png', { type: 'image/png' }), new File([transparent], 'alpha.png', { type: 'image/png' })], settings))
  }, { png, settings: { ...DEFAULT_IMAGE_PDF_SETTINGS, paper: 'image' as const, quality: 'original' as const } })
  const doc = new mupdf.PDFDocument(Uint8Array.from(bytes))
  try {
    colorNear(centerColor(doc, 0), [20, 20, 20])
    const object = doc.findPage(0), image = object.get('Resources', 'XObject', 'Im0'), raw = image.readRawStream()
    try {
      const parsed = parsePngForPdf(Uint8Array.from(png))
      expect(Buffer.from(raw.asUint8Array())).toEqual(Buffer.concat(parsed.data.map(part => Buffer.from(part))))
    } finally { raw.destroy(); image.destroy(); object.destroy() }
    const p = doc.loadPage(1), pix = p.toPixmap(mupdf.Matrix.scale(4, 4), mupdf.ColorSpace.DeviceRGB, false)
    try {
      for (const [fraction, color] of [[.25, [255, 255, 255]], [.75, [255, 0, 0]]] as const) {
        const at = (Math.floor(pix.getHeight() / 2) * pix.getWidth() + Math.floor(pix.getWidth() * fraction)) * 3
        colorNear(Array.from(pix.getPixels().subarray(at, at + 3)), [...color])
      }
    } finally { pix.destroy(); p.destroy() }
  } finally { doc.destroy() }
})

test('PDFと画像の混在ドロップでPDFを開き、画像を作成ダイアログへ渡す', async ({ page }) => {
  await setup(page)
  const files = [{ name: 'base.pdf', type: 'application/pdf', bytes: Array.from(await fs.readFile(path.resolve('test-data/sample-small.pdf'))) },
    { name: 'dropped.jpg', type: 'image/jpeg', bytes: Array.from(payloads[0].buffer) }]
  const transfer = await page.evaluateHandle(files => {
    const transfer = new DataTransfer()
    for (const f of files) transfer.items.add(new File([Uint8Array.from(f.bytes)], f.name, { type: f.type }))
    return transfer
  }, files)
  await page.locator('main.app').dispatchEvent('drop', { dataTransfer: transfer })
  const dialog = page.getByTestId('images-to-pdf-dialog')
  await expect(dialog.getByText('dropped.jpg', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.__karu!.listTabs().map(t => t.name))).toEqual(['base.pdf'])
  await expect(dialog.getByRole('button', { name: '作成', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: '作成', exact: true }).click(); await expect(dialog).not.toBeVisible()
  expect(await page.evaluate(() => window.__karu!.listTabs().length)).toBe(2)
  await transfer.dispose()
})

test('画像Workerはダイアログ内だけで動き、見えている行だけ96pxの見本を作る', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { live: 0, thumbnails: [] as string[] }
    Object.assign(window, { __imageRequests: state })
    const Original = window.Worker
    window.Worker = class extends Original {
      private imageWorker: boolean
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options); this.imageWorker = String(url).includes('image.worker')
        if (this.imageWorker) state.live++
      }
      override postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
        const request = message as { task?: string; file?: File }
        if (this.imageWorker && request.task === 'thumbnail') state.thumbnails.push(request.file!.name)
        if (Array.isArray(options)) super.postMessage(message, options)
        else super.postMessage(message, options)
      }
      override terminate() { if (this.imageWorker) { this.imageWorker = false; state.live-- }; super.terminate() }
    }
  })
  await setup(page)
  const state = () => page.evaluate(() => (window as unknown as { __imageRequests: { live: number; thumbnails: string[] } }).__imageRequests)
  expect((await state()).live).toBe(0)
  const dialog = await choose(page, Array.from({ length: 20 }, (_, i) => ({ ...payloads[0], name: `photo-${i}.jpg` })))
  await expect(dialog.locator('.image-thumb img').first()).toBeVisible()
  expect((await state()).live).toBe(1)
  const before = (await state()).thumbnails
  expect(before.length).toBeGreaterThan(0); expect(before.length).toBeLessThanOrEqual(6)
  expect(before).not.toContain('photo-19.jpg')
  await dialog.locator('.image-list').evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(async () => (await state()).thumbnails).toContain('photo-19.jpg')
  const thumbnail = dialog.locator('.image-row').last().locator('img')
  await expect(thumbnail).toBeVisible()
  expect(await thumbnail.evaluate(img => Math.max((img as HTMLImageElement).naturalWidth, (img as HTMLImageElement).naturalHeight))).toBe(96)
  await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click()
  await expect.poll(async () => (await state()).live).toBe(0)
})
