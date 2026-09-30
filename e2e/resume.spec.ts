import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'

const sample = path.resolve('test-data/sample-small.pdf')

test('前回のページと倍率を文書ごとに復元する', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(sample)
  await expect(page.getByText('1 / 5')).toBeVisible()
  await expect(page.locator('.zoom-value')).toContainText('%')
  await page.evaluate(() => window.__karu!.scrollToPage(2))
  await expect(page.getByText('3 / 5')).toBeVisible()
  await page.evaluate(() => window.__karu!.setZoom(1.5))
  await expect(page.getByText('150%')).toBeVisible()
  await page.waitForTimeout(700)
  await expect.poll(() => page.evaluate(() => {
    const raw = localStorage.getItem('karu-pdf:view')
    if (!raw) return []
    return Object.values(JSON.parse(raw) as Record<string, { page: number; zoom: number }>).map(({ page, zoom }) => ({ page, zoom }))
  }, { timeout: 3_000 })).toContainEqual({ page: 3, zoom: 1.5 })

  await page.reload()
  await page.getByTestId('file-input').setInputFiles(sample)
  await expect(page.getByText('150%')).toBeVisible()
  await expect(page.getByText('3 / 5')).toBeVisible()
  await expect(page.locator('.page-view[data-page-index="2"]')).toBeVisible()
  const restored = await page.getByTestId('viewer').evaluate((viewer) => {
    const target = viewer.querySelector<HTMLElement>('.page-view[data-page-index="2"]')
    return target ? Math.abs(viewer.scrollTop - target.offsetTop) < 2 : false
  })
  expect(restored).toBe(true)
})

test('ファイル選択にidと前回のハンドルを渡す', async ({ page }) => {
  const bytes = Array.from(await fs.readFile(sample))
  await page.addInitScript(({ pdfBytes }) => {
    const calls: Array<{ id?: string; startIn?: unknown }> = []
    const handle = {
      name: 'sample-small.pdf',
      getFile: async () => new File([new Uint8Array(pdfBytes)], 'sample-small.pdf', { type: 'application/pdf' }),
    }
    Object.assign(window, {
      __pickerCalls: calls,
      __pickerHandle: handle,
      showOpenFilePicker: async (options: { id?: string; startIn?: unknown }) => {
        calls.push(options)
        return [handle]
      },
    })
  }, { pdfBytes: bytes })
  await page.goto('/karu-pdf/?test=1')
  await page.getByRole('button', { name: 'PDFを開く', exact: true }).click()
  await expect(page.getByText('1 / 5')).toBeVisible()
  await page.getByRole('button', { name: 'PDFを開く', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as Window & { __pickerCalls?: unknown[] }).__pickerCalls?.length ?? 0)).toBe(2)
  const options = await page.evaluate(() => {
    const target = window as unknown as Window & { __pickerCalls: Array<{ id?: string; startIn?: unknown }>; __pickerHandle: unknown }
    return target.__pickerCalls.map((call) => ({ id: call.id, hasRememberedHandle: call.startIn === target.__pickerHandle }))
  })
  expect(options).toEqual([
    { id: 'karu-pdf-open', hasRememberedHandle: false },
    { id: 'karu-pdf-open', hasRememberedHandle: true },
  ])
})

test('800px幅でも上部メニューは32pxと40pxの2段に収まる', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 })
  await page.goto('/karu-pdf/?test=1')
  await expect(page.locator('.menu-bar')).toHaveCSS('height', '32px')
  await expect(page.locator('.tool-row')).toHaveCSS('height', '40px')
  const fits = await page.locator('.top-controls').evaluate((controls) => ({
    height: controls.getBoundingClientRect().height,
    width: controls.scrollWidth,
    clientWidth: controls.clientWidth,
    buttonsFit: [...controls.querySelectorAll('button')].every((button) => button.scrollHeight <= button.clientHeight),
  }))
  expect(fits.height).toBe(72)
  expect(fits.width).toBeLessThanOrEqual(fits.clientWidth)
  expect(fits.buttonsFit).toBe(true)
})
