import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, expect, test } from '@playwright/test'

const html = fs.readdirSync('dist-single').find(name => name.endsWith('.html'))!
const url = pathToFileURL(path.resolve('dist-single', html)).href

test('普通のタブでの案内は表示を記憶し、PDF を開いたら消える', async ({ page }) => {
  await page.goto(url)
  expect(await page.evaluate(() => window.toolbar.visible)).toBe(true)
  expect(await page.evaluate(() => matchMedia('(display-mode: standalone)').matches)).toBe(false)
  const hint = page.getByTestId('launcher-hint')
  await expect(hint).toBeVisible()
  await expect(hint).toContainText('かるPDFを開く.cmd')
  await page.getByTestId('file-input').setInputFiles(path.resolve('test-data/sample-small.pdf'))
  await expect(page.getByTestId('start-screen')).toHaveCount(0)
  await expect(hint).toHaveCount(0)
  await page.reload()
  await expect(hint).toBeVisible()
  await hint.getByRole('button', { name: '今後表示しない' }).click()
  await expect(hint).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('start-screen')).toBeVisible()
  await expect(hint).toHaveCount(0)
})

test('Edge の実アプリモードは display-mode が standalone で、案内を出さない', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'karu-app-mode-'))
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined
  try {
    context = await chromium.launchPersistentContext(temporary, { channel: 'msedge', headless: false, viewport: null, args: [`--app=${url}`] })
    const page = context.pages()[0] || await context.waitForEvent('page')
    await page.waitForURL(url)
    await expect(page.getByTestId('start-screen')).toBeVisible()
    const mode = await page.evaluate(() => ({ toolbar: window.toolbar.visible, standalone: matchMedia('(display-mode: standalone)').matches }))
    console.log('SINGLE_APP_MODE', JSON.stringify(mode))
    expect(mode.standalone).toBe(true)
    await expect(page.getByTestId('launcher-hint')).toHaveCount(0)
  } finally {
    await context?.close()
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})
