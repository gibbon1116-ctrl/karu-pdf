import fs from 'node:fs/promises'
import mupdf from 'mupdf'
import { expect, test, type Page } from '@playwright/test'
import { ensureSamplePdf } from '../tests/fixtures'

function scanFixture(): Buffer {
  const doc = new mupdf.PDFDocument(), width = 1000, height = 800
  const pixels = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    pixels[y * width + x] = Math.round(60 + 150 * x / width + 20 * Math.sin(y / 50))
  }
  const image = doc.addRawStream(pixels, { Type: 'XObject', Subtype: 'Image', Width: width, Height: height,
    BitsPerComponent: 8, ColorSpace: 'DeviceGray' })
  try {
    for (let index = 0; index < 2; index++) {
      const page = doc.addPage([0, 0, 180, 144], 0, { XObject: { Scan: image } }, 'q 180 0 0 144 0 0 cm /Scan Do Q')
      try { doc.insertPage(-1, page) } finally { page.destroy() }
    }
    const page = doc.loadPage(0), note = page.createAnnotation('FreeText')
    try {
      note.setRect([10, 10, 160, 35]); note.setContents('Editable scan note')
      note.setDefaultAppearance('Helv', 10, [0, 0, 0]); note.update()
    } finally { note.destroy(); page.destroy() }
    const buffer = doc.saveToBuffer('')
    try { return Buffer.from(buffer.asUint8Array()) } finally { buffer.destroy() }
  } finally { image.destroy(); doc.destroy() }
}

async function openScan(page: Page): Promise<void> {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: scanFixture() })
  // The small test pages fit several to the view, so the current page may already be 2.
  await expect(page.getByText('/2', { exact: true })).toBeVisible()
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
}

async function openDialog(page: Page) {
  await page.getByRole('button', { name: 'ファイル▼' }).click()
  await page.getByRole('menuitem', { name: '軽量化して別名で保存…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '軽量化して別名で保存', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

test('計算した大きさを表示し、解像度または強めを変えると再計算を求める', async ({ page }) => {
  await openScan(page)
  const dialog = await openDialog(page), save = dialog.getByRole('button', { name: '保存', exact: true })
  await expect(dialog.getByRole('radio', { name: '200 dpi（標準）', exact: true })).toBeChecked()
  await expect(save).toBeDisabled()
  await dialog.getByRole('button', { name: '計算する', exact: true }).click()
  await expect(dialog.locator('.slim-result')).toContainText(/元の大きさ \d+(\.\d+)? [KM]B → 軽量化後 \d+(\.\d+)? [KM]B/, { timeout: 120_000 })
  await expect(save).toBeEnabled()
  await dialog.getByRole('radio', { name: '300 dpi', exact: true }).check()
  await expect(dialog.locator('.slim-result')).toHaveCount(0)
  await expect(save).toBeDisabled()
  await dialog.getByRole('button', { name: '計算する', exact: true }).click()
  await expect(dialog.locator('.slim-result')).toBeVisible({ timeout: 120_000 })
  await dialog.getByRole('checkbox', { name: '図面の描画命令も整理する（強め）', exact: true }).check()
  await expect(dialog.locator('.slim-result')).toHaveCount(0)
  await expect(save).toBeDisabled()
  await dialog.getByRole('button', { name: '計算する', exact: true }).click()
  await expect(dialog.locator('.slim-result')).toContainText('描画命令', { timeout: 120_000 })
  await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click()
  await openDialog(page)
  await expect(dialog.locator('.slim-result')).toHaveCount(0)
  await expect(save).toBeDisabled()
})

test('保存したコピーが開け、ページ数と編集できる書き込みを保ち、元のタブは変わらない', async ({ page }) => {
  await page.addInitScript(() => { window.showSaveFilePicker = undefined })
  await openScan(page)
  const before = await page.evaluate(() => ({ tabs: window.__karu!.listTabs(), notes: window.__karu!.getEditableAnnotations(0) }))
  const dialog = await openDialog(page)
  await dialog.getByRole('button', { name: '計算する', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeEnabled({ timeout: 120_000 })
  const downloaded = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  const download = await downloaded, downloadedPath = (await download.path())!
  expect(download.suggestedFilename()).toBe('scan_軽量化.pdf')
  await expect(dialog).toBeHidden()
  expect(await page.evaluate(() => ({ tabs: window.__karu!.listTabs(), notes: window.__karu!.getEditableAnnotations(0) }))).toEqual(before)
  const doc = new mupdf.PDFDocument(new Uint8Array(await fs.readFile(downloadedPath)))
  try {
    expect(doc.countPages()).toBe(2)
    const first = doc.loadPage(0), notes = first.getAnnotations()
    try { expect(notes.find(note => note.getType() === 'FreeText')?.getContents()).toBe('Editable scan note') }
    finally { notes.forEach(note => note.destroy()); first.destroy() }
  } finally { doc.destroy() }
  await page.getByTestId('file-input').setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/pdf', buffer: await fs.readFile(downloadedPath) })
  await expect.poll(() => page.evaluate(() => window.__karu!.listTabs().length)).toBe(2)
  await expect(page.getByText('/2', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.__karu!.getEditableAnnotations(0).some(note => note.text === 'Editable scan note'))).toBe(true)
})

test('事前整理した sample-small.pdf では小さくできなかったと表示し保存を無効にする', async ({ page }) => {
  // The shared generator does not use object streams, so the original sample
  // may shrink. Normalize only this test input; never modify the source fixture.
  const source = new mupdf.PDFDocument(new Uint8Array(await fs.readFile(await ensureSamplePdf())))
  let bytes: Buffer
  try {
    source.subsetFonts()
    const buffer = source.saveToBuffer('garbage=4,compress,compress-images,compress-fonts,objstms=yes')
    try { bytes = Buffer.from(buffer.asUint8Array()) } finally { buffer.destroy() }
  } finally { source.destroy() }
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles({ name: 'sample-small.pdf', mimeType: 'application/pdf', buffer: bytes })
  await expect(page.getByText('1 / 5')).toBeVisible()
  const dialog = await openDialog(page)
  await dialog.getByRole('button', { name: '計算する', exact: true }).click()
  await expect(dialog).toContainText('これ以上小さくできませんでした。', { timeout: 120_000 })
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeDisabled()
})
