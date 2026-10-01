import path from 'node:path'
import fs from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test('左右を同期し1500px/sでスクロールしたときの各側の白抜けを1回計測する', async ({ page }) => {
  const directory = await fs.mkdtemp(path.resolve('e2e/.split-perf-'))
  const referencePdf = path.join(directory, 'reference-heavy.pdf')
  try {
  // Playwright's in-memory file input is limited to 50 MB. Use a temporary
  // path for the large reference document and remove it even on failure.
  await fs.copyFile(path.resolve('test-data/heavy-300p.pdf'), referencePdf)
  await page.goto('/karu-pdf/?test=1&workers=4&warm=0')
  await page.getByTestId('file-input').setInputFiles(path.resolve('test-data/heavy-300p.pdf'))
  await expect(page.locator('.status-bar')).toContainText('1 / 300')
  await expect.poll(() => page.evaluate(() => window.__karu?.isSharp())).toBe(true)
  const leftId = await page.evaluate(() => window.__karu!.listTabs()[0].docId)
  await page.getByTestId('file-input').setInputFiles(referencePdf)
  await expect.poll(() => page.evaluate(() => window.__karu!.listTabs().length)).toBe(2)
  await page.evaluate(id => window.__karu!.activateTab(id), leftId)
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-doc-id', leftId)
  await page.keyboard.press('Control+Backslash')
  await expect(page.getByTestId('right-viewer')).toBeVisible()
  await page.getByLabel('ページを合わせて動かす').check()
  await page.getByRole('button', { name: '幅に合わせる', exact: true }).click()
  await page.evaluate(() => window.__karu!.scrollToPage(0))
  await expect.poll(() => page.getByTestId('right-viewer').locator('.page-view[data-visible="true"]').evaluateAll(els => els.every(el => (el as HTMLElement).dataset.hasBitmap === 'true'))).toBe(true)
  const result = await page.evaluate(async () => {
    const left = document.querySelector<HTMLElement>('[data-testid="viewer"]')!
    const right = document.querySelector<HTMLElement>('[data-testid="right-viewer"]')!
    const totals = { left: 0, right: 0, frames: 0 }
    const isBlank = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect()
      const visible = [...el.querySelectorAll<HTMLElement>('.page-empty')].filter(p => {
        const pRect = p.getBoundingClientRect()
        return pRect.bottom > rect.top && pRect.top < rect.bottom && pRect.right > rect.left && pRect.left < rect.right
      })
      return visible.length === 0 || visible.some(p => {
        const index = Number(p.textContent) - 1
        const page = el.querySelector<HTMLElement>(`.page-view[data-page-index="${index}"]`)
        const canvas = page?.querySelector<HTMLCanvasElement>('.preview-canvas')
        return page?.dataset.hasBitmap !== 'true' || !canvas || canvas.width < 2 || canvas.height < 2
      })
    }
    const started = performance.now()
    await new Promise<void>(resolve => {
      const tick = (at: number) => {
        const elapsed = at - started
        left.scrollTop = elapsed * 1.5
        totals.frames++
        if (isBlank(left)) totals.left++
        if (isBlank(right)) totals.right++
        if (elapsed < 5000) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
    return { frames: totals.frames, leftBlankPct: 100 * totals.left / totals.frames,
      rightBlankPct: 100 * totals.right / totals.frames, distancePx: left.scrollTop,
      durationMs: performance.now() - started, pixelsPerSecond: 1500 }
  })
  console.log('[split-scroll-1500]', JSON.stringify(result))
  expect(result.frames).toBeGreaterThan(30)
  expect(result.distancePx).toBeGreaterThan(7000)
  expect(result.leftBlankPct).toBeLessThanOrEqual(5)
  expect(result.rightBlankPct).toBeLessThanOrEqual(5)
  const finalPosition = await page.getByTestId('right-viewer').evaluate(el => {
    const anchor = el.scrollTop + el.clientHeight / 3
    return [...el.querySelectorAll<HTMLElement>('.page-empty')].reverse().find(p => p.offsetTop <= anchor)?.textContent
  })
  await expect(page.locator('.status-bar')).toContainText(`${finalPosition} / 300`)
  } finally {
    await fs.unlink(referencePdf).catch(error => { if (error.code !== 'ENOENT') throw error })
    await fs.rmdir(directory)
  }
})
