import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'

function fixture(): number[] {
  const doc = new mupdf.PDFDocument()
  try {
    for (const [width, height] of [[1191, 842], [595, 842]]) {
      const ref = doc.addPage([0, 0, width, height], 0, {}, '')
      try { doc.insertPage(-1, ref) } finally { ref.destroy() }
    }
    const buffer = doc.saveToBuffer('compress')
    try { return Array.from(buffer.asUint8Array()) } finally { buffer.destroy() }
  } finally { doc.destroy() }
}

async function open(page: Page) {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '架空の幅合わせ・全画面試験.pdf'), fixture())
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
}

async function expectFittedPage(page: Page, index: number) {
  const viewer = page.getByTestId('viewer')
  await expect.poll(() => viewer.evaluate((element, pageIndex) => {
    const sheet = element.querySelectorAll<HTMLElement>('.page-empty')[pageIndex].getBoundingClientRect()
    const rect = element.getBoundingClientRect()
    const left = rect.left + element.clientLeft, top = rect.top + element.clientTop
    return sheet.left >= left - 2 && sheet.top >= top - 2
      && sheet.right <= left + element.clientWidth + 2 && sheet.bottom <= top + element.clientHeight + 2
      && Math.min(Math.abs(sheet.width - (element.clientWidth - 16)), Math.abs(sheet.height - (element.clientHeight - 16))) <= 2
  }, index)).toBe(true)
}

test('幅に合わせるは混在する用紙の表示中ページを基準にする', async ({ page }) => {
  await open(page)
  const viewer = page.getByTestId('viewer')
  await page.evaluate(() => window.__karu!.scrollToPage(1))
  await expect(page.getByText('2 / 2 ページ', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '幅に合わせる', exact: true }).click()
  await expect.poll(() => viewer.evaluate(el => Math.abs(el.querySelectorAll('.page-empty')[1].getBoundingClientRect().width - (el.clientWidth - 32)))).toBeLessThanOrEqual(2)
  await expect.poll(() => viewer.evaluate(el => Math.abs(el.querySelectorAll('.page-empty')[1].getBoundingClientRect().left - el.getBoundingClientRect().left - 16))).toBeLessThanOrEqual(2)
  await page.evaluate(() => window.__karu!.scrollToPage(0))
  await expect(page.getByText('1 / 2 ページ', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '幅に合わせる', exact: true }).click()
  await expect.poll(() => viewer.evaluate(el => Math.abs(el.querySelectorAll('.page-empty')[0].getBoundingClientRect().width - (el.clientWidth - 32)))).toBeLessThanOrEqual(2)
})

test('全画面でページを画面いっぱいに送り、Escで元の倍率に戻る', async ({ page }) => {
  await open(page)
  const viewer = page.getByTestId('viewer')
  await page.evaluate(() => window.__karu!.setZoom(.6))
  await expect(viewer).toHaveAttribute('data-zoom', '0.6')
  await expect.poll(async () => {
    await page.evaluate(() => window.__karu!.scrollToPage(0))
    return viewer.evaluate(el => el.scrollTop)
  }).toBe(0)
  const beforeZoom = await viewer.getAttribute('data-zoom')
  await page.getByRole('button', { name: '全画面表示', exact: true }).click()
  await expect(page.locator('.app')).toHaveClass(/fullscreen-view/)
  await expect(page.locator('.top-controls')).toBeHidden()
  const nav = page.getByRole('toolbar', { name: '全画面表示の操作' })
  await expect(nav).toBeVisible()
  await expect(nav.getByText('1 / 2', { exact: true })).toBeVisible()
  await expectFittedPage(page, 0)
  await nav.getByRole('button', { name: '次のページ', exact: true }).click()
  await expect(nav.getByText('2 / 2', { exact: true })).toBeVisible()
  await expectFittedPage(page, 1)
  await expect.poll(() => viewer.evaluate(el => Math.abs(el.querySelectorAll('.page-empty')[1].getBoundingClientRect().height - (el.clientHeight - 16)))).toBeLessThanOrEqual(2)
  await page.keyboard.press('ArrowLeft')
  await expect(nav.getByText('1 / 2', { exact: true })).toBeVisible()
  await expectFittedPage(page, 0)
  await page.keyboard.press('Escape')
  await expect(page.locator('.app')).not.toHaveClass(/fullscreen-view/)
  await expect(page.locator('.top-controls')).toBeVisible()
  await expect(viewer).toHaveAttribute('data-zoom', beforeZoom!)
  await expect.poll(() => viewer.evaluate(el => el.scrollTop)).toBe(0)
})

test('全画面APIが拒否されても表示を続け、ホイールは1ジェスチャーで1ページ送る', async ({ page }) => {
  await page.addInitScript(() => {
    Element.prototype.requestFullscreen = () => Promise.reject(new Error('架空の全画面要求拒否'))
    localStorage.setItem('karu-pdf:wheel-stops-at-page-edge', 'false')
  })
  await open(page)
  await page.getByRole('button', { name: '全画面表示', exact: true }).click()
  const nav = page.getByRole('toolbar', { name: '全画面表示の操作' })
  await expectFittedPage(page, 0)
  const viewer = page.getByTestId('viewer')
  // 同一タスク内で連続イベントを送り、方向が変わっても戻らないことを確かめる。
  await viewer.evaluate(el => {
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }))
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }))
  })
  await expect(nav.getByText('2 / 2', { exact: true })).toBeVisible()
  await page.waitForTimeout(300)
  await viewer.dispatchEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true })
  await expect(nav.getByText('1 / 2', { exact: true })).toBeVisible()
  await expectFittedPage(page, 0)
  await nav.getByRole('button', { name: '全画面を終了', exact: true }).click()
  await expect(page.locator('.app')).not.toHaveClass(/fullscreen-view/)
})
