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
  await page.addInitScript(() => localStorage.setItem('karu-pdf:pan-stops-at-page-edge', 'true'))
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

test('ホイールは図面を越えてスクロールし、中ボタン移動は図面の端で止まる', async ({ page }) => {
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
  await expect(page.getByText(/^[23] \/ 3 ページ$/)).toBeVisible()

  // Wheel scrolling may still be settling on a slow machine; wait, then return to the top until it sticks.
  await expect.poll(async () => {
    const first = await viewer.evaluate(el => el.scrollTop)
    await page.waitForTimeout(200)
    return Math.abs(await viewer.evaluate(el => el.scrollTop) - first)
  }).toBeLessThan(.5)
  await expect.poll(async () => {
    await page.evaluate(() => window.__karu!.scrollToPage(0))
    await page.waitForTimeout(200)
    return viewer.evaluate(el => el.scrollTop)
  }).toBe(0)
  const box = await viewer.boundingBox()
  expect(box).not.toBeNull()
  const x = box!.x + box!.width / 2, y = box!.y + box!.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down({ button: 'middle' })
  await expect(viewer).toHaveClass(/panning/)
  await page.mouse.move(x, y - 4000, { steps: 20 })
  await expect.poll(() => viewer.evaluate(el => {
    const first = el.querySelector<HTMLElement>('.page-empty')!
    return Math.abs(el.scrollTop - (first.offsetTop + first.offsetHeight - el.clientHeight))
  })).toBeLessThanOrEqual(1.5)
  await expect(page.getByText('1 / 3 ページ', { exact: true })).toBeVisible()
  await page.mouse.up({ button: 'middle' })
  await expect(viewer).not.toHaveClass(/panning/)

  await page.mouse.move(x, y)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(x, y - 4000, { steps: 20 })
  await expect.poll(() => viewer.evaluate(el => {
    const second = el.querySelectorAll<HTMLElement>('.page-empty')[1]
    return Math.abs(el.scrollTop - (second.offsetTop + second.offsetHeight - el.clientHeight))
  })).toBeLessThanOrEqual(1.5)
  await expect(page.getByText('2 / 3 ページ', { exact: true })).toBeVisible()
  await page.mouse.up({ button: 'middle' })

  await page.getByRole('button', { name: '表示▼', exact: true }).click()
  const stopAtEdge = page.getByRole('menuitemcheckbox', { name: '中ボタンでの移動を図面の端で止める', exact: true })
  await expect(stopAtEdge).toBeChecked()
  await stopAtEdge.click()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('karu-pdf:pan-stops-at-page-edge'))).toBe('false')
  // 同じ2ページ目の途中から始め、設定オフではその下端を越える。
  await page.evaluate(() => window.__karu!.scrollToPage(1))
  await expect(page.getByText('2 / 3 ページ', { exact: true })).toBeVisible()
  await page.mouse.move(x, y)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(x, y - 4000, { steps: 20 })
  await expect.poll(() => viewer.evaluate(el => {
    const second = el.querySelectorAll<HTMLElement>('.page-empty')[1]
    return el.scrollTop - (second.offsetTop + second.offsetHeight - el.clientHeight)
  })).toBeGreaterThan(1.5)
  await page.mouse.up({ button: 'middle' })
})
