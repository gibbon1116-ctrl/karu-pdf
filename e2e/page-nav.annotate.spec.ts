import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'

function fixture(): number[] {
  const doc = new mupdf.PDFDocument()
  try {
    for (let i = 0; i < 3; i++) {
      const ref = doc.addPage([0, 0, 600, 900], 0, {}, '')
      try { doc.insertPage(-1, ref) } finally { ref.destroy() }
    }
    const buffer = doc.saveToBuffer('compress')
    try { return Array.from(buffer.asUint8Array()) } finally { buffer.destroy() }
  } finally { doc.destroy() }
}

async function open(page: Page) {
  await page.addInitScript(() => localStorage.setItem('karu-pdf:wheel-stops-at-page-edge', 'true'))
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '架空のページ送り試験.pdf'), fixture())
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
}

test('次のページで2へ進み、前のページで1へ戻り、先頭では前へ進めない', async ({ page }) => {
  await open(page)
  const previous = page.getByRole('button', { name: '前のページ', exact: true })
  const next = page.getByRole('button', { name: '次のページ', exact: true })
  await expect(previous).toBeDisabled()
  await next.click()
  await expect(page.getByText('2 / 3 ページ', { exact: true })).toBeVisible()
  await previous.click()
  await expect(page.getByText('1 / 3 ページ', { exact: true })).toBeVisible()
  await expect(previous).toBeDisabled()
  await next.click()
  await expect(page.getByText('2 / 3 ページ', { exact: true })).toBeVisible()
  await next.click()
  await expect(page.getByText('3 / 3 ページ', { exact: true })).toBeVisible()
  await expect(next).toBeDisabled()
  const number = page.getByRole('textbox', { name: 'ページ番号', exact: true })
  await expect(number).toHaveValue('3')
  await number.fill('２')
  await number.press('Enter')
  await expect(page.getByText('2 / 3 ページ', { exact: true })).toBeVisible()
  await number.fill('9')
  await number.press('Enter')
  await expect(page.getByText('2 / 3 ページ', { exact: true })).toBeVisible()
  await expect(number).toHaveValue('2')
})

test('ホイールの連続操作は図面の端で止まり、間を空けて回すと次の図面へ進む', async ({ page }) => {
  await open(page)
  await page.evaluate(() => window.__karu!.setZoom(2))
  const viewer = page.getByTestId('viewer')
  await expect(viewer).toHaveAttribute('data-zoom', '2')
  // The zoom keeps its anchor a moment after data-zoom changes, so repeat until the top sticks.
  await expect.poll(async () => {
    await page.evaluate(() => window.__karu!.scrollToPage(0))
    await page.waitForTimeout(200)
    return viewer.evaluate(el => el.scrollTop)
  }).toBe(0)
  expect(await viewer.evaluate(el => el.querySelector<HTMLElement>('.page-empty')!.offsetHeight > el.clientHeight)).toBe(true)
  await viewer.hover()
  for (let i = 0; i < 20; i++) await page.mouse.wheel(0, 300)
  await expect.poll(() => viewer.evaluate(el => {
    const first = el.querySelector<HTMLElement>('.page-empty')!
    return Math.abs(el.scrollTop - (first.offsetTop + first.offsetHeight - el.clientHeight))
  })).toBeLessThan(1.5)
  await expect(page.getByText('1 / 3 ページ', { exact: true })).toBeVisible()
  await page.waitForTimeout(400)
  await page.mouse.wheel(0, 300)
  await expect(page.getByText('2 / 3 ページ', { exact: true })).toBeVisible()
})
