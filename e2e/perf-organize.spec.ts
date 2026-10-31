import path from 'node:path'
import { expect, test } from '@playwright/test'

test('perf-organize: 300ページから10ページを並べ替えて適用する', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1&workers=3')
  await page.getByTestId('file-input').setInputFiles(path.resolve('test-data/heavy-300p.pdf'))
  await expect(page.getByText('1 / 300')).toBeVisible({ timeout: 180_000 })
  await page.evaluate(() => window.__karu!.openOrganize())
  await expect(page.getByTestId('organize-view')).toBeVisible()
  const reverseReactionMs = await page.evaluate(async () => {
    const grid = document.querySelector<HTMLElement>('.organize-grid-scroller')!
    grid.focus()
    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }))
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const reverse = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '逆順にする')!
    const started = performance.now()
    reverse.click()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    return performance.now() - started
  })
  console.log(`[perf-organize-reverse] ${JSON.stringify({ reverseReactionMs })}`)
  expect(reverseReactionMs).toBeLessThanOrEqual(100)
  await page.evaluate(() => {
    const draft = window.__karu!.organizeDraft()!
    draft.reverse()
    draft.move(draft.getCards().slice(100, 110).map((card) => card.id), 20)
  })
  const measured = await page.evaluate(async () => {
    const started = performance.now()
    const timings = await window.__karu!.applyOrganize()
    return { elapsed: performance.now() - started, timings }
  })
  console.log(`[perf-organize] ${JSON.stringify({ applyMs: measured.elapsed, ...measured.timings })}`)
  expect(measured.timings).not.toBeNull()
  expect(measured.elapsed).toBeLessThanOrEqual(5_000)
  await expect.poll(() => page.evaluate(() => window.__karu!.getPageInfo().then((items) => items.length))).toBe(300)
})
