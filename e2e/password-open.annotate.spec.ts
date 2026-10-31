import fs from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { ensureSamplePdf } from '../tests/fixtures'
import { protectPdf } from '../src/core/protectedPdf'
import { openDocument } from '../src/core/mupdfDoc'

const password = 'Ab1,=\\"\'[]{}:!z'
let encrypted: Buffer
test.beforeAll(async () => { encrypted = Buffer.from(protectPdf(new Uint8Array(await fs.readFile(await ensureSamplePdf())), password)) })
async function selectProtected(page: Page) {
  await page.getByTestId('file-input').setInputFiles({ name: 'protected.pdf', mimeType: 'application/pdf', buffer: encrypted })
  return page.getByRole('dialog', { name: 'PDFのパスワード', exact: true })
}
async function unlock(page: Page) {
  const dialog = await selectProtected(page)
  await dialog.getByLabel('パスワード', { exact: true }).fill(password)
  await dialog.getByRole('button', { name: '開く', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(() => page.evaluate(() => window.__karu!.listTabs().some(tab => tab.name === 'protected.pdf'))).toBe(true)
  await expect(page.getByText('1 / 5')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__karu!.isSharp())).toBe(true)
}

test('retry wrong password, reveal input, render, edit, and save encrypted PDF twice', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  const dialog = await selectProtected(page)
  await expect(dialog.getByLabel('パスワード', { exact: true })).toHaveAttribute('type', 'password')
  await dialog.getByLabel('パスワード', { exact: true }).fill('wrong')
  await dialog.getByRole('button', { name: '開く', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('パスワードが違います')
  await dialog.getByLabel('パスワードを表示', { exact: true }).check()
  await expect(dialog.getByLabel('パスワード', { exact: true })).toHaveAttribute('type', 'text')
  await dialog.getByLabel('パスワード', { exact: true }).fill(password)
  await dialog.getByRole('button', { name: '開く', exact: true }).click()
  await expect(page.getByText('1 / 5')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__karu!.isSharp())).toBe(true)
  await page.evaluate(() => window.__karu!.setDrawingInfo(0, { number: 'PW-01', numberManual: true }))
  for (let i = 0; i < 2; i++) {
    const bytes = await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!])
    expect(() => openDocument(new Uint8Array(bytes))).toThrow('パスワードが必要')
    const check = openDocument(new Uint8Array(bytes), true, password)
    try { expect(check.pageCount).toBe(5) } finally { check.document.destroy() }
  }
  await page.evaluate(() => window.__karu!.openOrganize())
  await expect(page.getByTestId('organize-preview-canvas')).toHaveAttribute('data-rendered', 'true')
  await page.evaluate(async () => { const draft = window.__karu!.organizeDraft()!; draft.rotate([draft.getCards()[0].id], 90); await window.__karu!.applyOrganize(); await window.__karu!.undoLastOrganize() })
  await expect.poll(() => page.evaluate(() => window.__karu!.isSharp())).toBe(true)
})

test('cancel and reopen prompts again, without affecting an already open PDF', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(await ensureSamplePdf())
  await expect(page.getByText('1 / 5')).toBeVisible()
  let dialog = await selectProtected(page)
  await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(await page.evaluate(() => window.__karu!.listTabs().length)).toBe(1)
  await unlock(page)
  await page.evaluate(async () => {
    const tab = window.__karu!.listTabs().find(t => t.name === 'protected.pdf')!
    await window.__karu!.closeTab(tab.docId)
  })
  dialog = await selectProtected(page)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('パスワード', { exact: true })).toHaveValue('')
  await dialog.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByText('1 / 5')).toBeVisible()
})


test('restores encrypted render workers after switching among three tabs', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1&workers=3')
  await unlock(page)
  const normal = [...await fs.readFile(await ensureSamplePdf())]
  for (const name of ['second.pdf', 'third.pdf']) {
    await page.evaluate(async ({ bytes, name }) => { await window.__karu!.openBytes(bytes, name) }, { bytes: normal, name })
    await expect.poll(() => page.evaluate(() => window.__karu!.isSharp())).toBe(true)
  }
  await page.evaluate(async () => {
    const tab = window.__karu!.listTabs().find(t => t.name === 'protected.pdf')!
    await window.__karu!.activateTab(tab.docId)
  })
  await expect.poll(() => page.evaluate(() => window.__karu!.isSharp())).toBe(true)
  const bytes = await page.evaluate(async () => [...(await window.__karu!.printToBytes())!])
  const check = openDocument(new Uint8Array(bytes), true, password)
  try { expect(check.pageCount).toBe(5) } finally { check.document.destroy() }
})


test('rasterizing edited protected PDF preserves access and a protected copy can use a new password', async ({ page }) => {
  await page.addInitScript(() => { window.showSaveFilePicker = undefined })
  await page.goto('/karu-pdf/?test=1&workers=3')
  await unlock(page)
  await page.evaluate(() => window.__karu!.setDrawingInfo(0, { number: 'RASTER-01', numberManual: true }))
  const raster = await page.evaluate(async () => [...(await window.__karu!.rasterizeToBytes({ dpi: 150, color: 'color', format: 'jpeg', pageIndexes: [0] }))!])
  const rasterCheck = openDocument(new Uint8Array(raster))
  try { expect(rasterCheck.pageCount).toBe(1) } finally { rasterCheck.document.destroy() }
  await page.getByRole('button', { name: 'ファイル▼' }).click()
  await page.getByRole('menuitem', { name: 'パスワードを付けて別名で保存…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'パスワード付き保存', exact: true })
  await dialog.getByRole('textbox').fill('New-Password123!')
  const downloaded = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '保存先を選んで保存' }).click()
  const download = await downloaded
  const bytes = new Uint8Array(await fs.readFile((await download.path())!))
  expect(() => openDocument(bytes, true, password)).toThrow('パスワードが違います')
  const check = openDocument(bytes, true, 'New-Password123!')
  try { expect(check.pageCount).toBe(5) } finally { check.document.destroy() }
  const originalBytes = await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!])
  const original = openDocument(new Uint8Array(originalBytes), true, password)
  try { expect(original.pageCount).toBe(5) } finally { original.document.destroy() }
})
