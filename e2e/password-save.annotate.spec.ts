import fs from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import { ensureSamplePdf } from '../tests/fixtures'

async function openDialog(page: Page) {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(await ensureSamplePdf())
  await expect(page.getByText('1 / 5')).toBeVisible()
  await page.getByRole('button', { name: 'ファイル▼' }).click()
  await page.getByRole('menuitem', { name: 'パスワードを付けて別名で保存…', exact: true }).click()
  return page.getByRole('dialog', { name: 'パスワード付き保存', exact: true })
}

test('visible password suggestion, regenerate, validation, copy and paste, cancel', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const dialog = await openDialog(page)
  const input = dialog.getByLabel('パスワード（半角英数字・記号、1〜20文字）', { exact: true })
  await expect(input).toHaveAttribute('type', 'text')
  const suggestion = await input.inputValue()
  expect(suggestion).toHaveLength(15)
  expect(suggestion).toMatch(/[A-Z]/)
  expect(suggestion).toMatch(/[a-z]/)
  expect(suggestion).toMatch(/[0-9]/)
  expect(suggestion).toMatch(/[^a-z0-9]/i)
  await dialog.getByRole('button', { name: '別の候補を生成' }).click()
  await expect(input).not.toHaveValue(suggestion)
  await dialog.getByRole('button', { name: 'コピー', exact: true }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await input.inputValue())
  await input.fill('')
  await input.press('Control+V')
  expect(await input.inputValue()).toHaveLength(15)
  for (const invalid of ['', '日本語', 'abc def']) {
    await input.fill(invalid)
    await expect(dialog.getByRole('button', { name: '保存先を選んで保存' })).toBeDisabled()
  }
  await input.fill('a'.repeat(20))
  await expect(dialog.getByRole('button', { name: '保存先を選んで保存' })).toBeEnabled()
  await expect(input).toHaveAttribute('maxlength', '20')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByText('1 / 5')).toBeVisible()
})

test('downloads encrypted PDF through worker and then saves normal PDF without a password', async ({ page }) => {
  await page.addInitScript(() => { window.showSaveFilePicker = undefined })
  const dialog = await openDialog(page)
  const password = 'Ab1,=\\"\'[]{}:!z'
  await dialog.getByRole('textbox').fill(password)
  const downloaded = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '保存先を選んで保存' }).click()
  const download = await downloaded
  expect(download.suggestedFilename()).toContain('_パスワード付き.pdf')
  const document = mupdf.Document.openDocument(new Uint8Array(await fs.readFile((await download.path())!)), 'application/pdf')
  try {
    expect(document.needsPassword()).toBe(true)
    expect(document.authenticatePassword('wrong')).toBe(0)
    expect(document.authenticatePassword(password)).not.toBe(0)
    expect(document.countPages()).toBe(5)
  } finally { document.destroy() }
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: 'ファイル▼' }).click()
  const normalDownload = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: '別名で保存', exact: true }).click()
  const normal = mupdf.Document.openDocument(new Uint8Array(await fs.readFile((await (await normalDownload).path())!)), 'application/pdf')
  try { expect(normal.needsPassword()).toBe(false); expect(normal.countPages()).toBe(5) } finally { normal.destroy() }
})

test('cancelled destination picker retains the password for retry', async ({ page }) => {
  await page.addInitScript(() => {
    window.showSaveFilePicker = async () => { throw new DOMException('Cancelled', 'AbortError') }
  })
  const dialog = await openDialog(page)
  const password = await dialog.getByRole('textbox').inputValue()
  await dialog.getByRole('button', { name: '保存先を選んで保存' }).click()
  await expect(dialog.getByRole('button', { name: '保存先を選んで保存' })).toBeEnabled()
  await expect(dialog.getByRole('textbox')).toHaveValue(password)
})
