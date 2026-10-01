import { expect, test, type Page } from '@playwright/test'
import { makeComparePdf } from '../tests/compareFixtures'

async function openComparison(page: Page, shift = 0) {
  await page.addInitScript(() => {
    const target = window as Window & { __compareJobs?: Array<{ oldPage: number; newPage: number; worker: number }> }
    target.__compareJobs = []
    const workers = new WeakMap<Worker, number>()
    let workerId = 0
    const original = Worker.prototype.postMessage
    Worker.prototype.postMessage = function(message, options) {
      if (message?.type === 'renderCompare') {
        if (!workers.has(this)) workers.set(this, workerId++)
        target.__compareJobs!.push({ oldPage: message.pageIndex, newPage: message.newPageIndex, worker: workers.get(this)! })
      }
      return Reflect.apply(original, this, [message, options])
    }
  })
  await page.goto('/karu-pdf/?test=1&workers=4&warm=0')
  await page.waitForFunction(() => Boolean(window.__karu))
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, 'old.pdf'), [...makeComparePdf({ count: 3 })])
  const oldId = await page.evaluate(() => window.__karu!.listTabs()[0].docId)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, 'new.pdf'), [...makeComparePdf({ revised: true, shift, count: 4, annotation: true })])
  await page.evaluate(id => window.__karu!.activateTab(id), oldId)
  await page.getByRole('button', { name: '表示▼', exact: true }).click()
  await page.getByRole('menuitem', { name: '2つの PDF を比較…', exact: true }).click()
  await expect(page.getByLabel('比較する旧版')).toHaveValue(oldId)
  await page.getByRole('button', { name: '比較', exact: true }).click()
  await expect(page.getByTestId('compare-view')).toBeVisible()
  await expect(page.getByTestId('compare-old').locator('.page-view')).toHaveAttribute('data-sharp', 'true')
  await expect(page.getByTestId('compare-view')).toHaveAttribute('data-detection-ms', /\d/)
}
async function raster(page: Page, pane = 'compare-old') {
  return page.getByTestId(pane).locator('.preview-canvas').evaluate(el => {
    const c = el as HTMLCanvasElement
    const pixel = (x: number, y: number) => [...c.getContext('2d')!.getImageData(Math.floor(x * c.width / 400), Math.floor(y * c.height / 400), 1, 1).data].slice(0, 3)
    return { a: pixel(60, 40), bOld: pixel(201, 90), bNew: pixel(211, 90), c: pixel(300, 185), annotation: pixel(160, 260) }
  })
}
test('比較の実画素と3領域を確認し、一覧とN/Pで拡大・移動、書き込みを切り替える', async ({ page }) => {
  await openComparison(page)
  await expect(page.getByTestId('compare-difference')).toHaveCount(3)
  const colors = await raster(page)
  expect(colors).toEqual({ a: [128, 128, 128], bOld: [255, 0, 0], bNew: [0, 0, 255], c: [0, 0, 255], annotation: [255, 255, 255] })
  const boxes = await page.getByTestId('compare-difference').evaluateAll(rows => rows.map(row => row.getAttribute('data-rect')!.split(',').map(Number)))
  expect(boxes[0]).toEqual([200, 70, 203, 130]); expect(boxes[1]).toEqual([210, 70, 213, 130])
  expect(boxes[2][0]).toBeGreaterThan(280)
  await page.getByTestId('compare-difference').nth(2).click()
  await expect(page.getByTestId('compare-difference').nth(2)).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.getByTestId('compare-old').locator('.viewer').getAttribute('data-zoom').then(Number)).toBeGreaterThan(3)
  const contained = await page.getByTestId('compare-old').evaluate(el => {
    const viewport = el.querySelector('.viewer')!.getBoundingClientRect(), box = el.querySelector('.compare-region-layer rect.active')!.getBoundingClientRect()
    return box.left >= viewport.left && box.right <= viewport.right && box.top >= viewport.top && box.bottom <= viewport.bottom
  })
  expect(contained).toBe(true)
  await page.keyboard.press('n')
  await expect(page.getByTestId('compare-difference').nth(0)).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('p')
  await expect(page.getByTestId('compare-difference').nth(2)).toHaveAttribute('aria-pressed', 'true')
  await page.getByLabel('書き込みも比べる').check()
  await expect(page.getByTestId('compare-difference')).toHaveCount(4)
  await page.getByLabel('書き込みも比べる').uncheck()
  await expect(page.getByTestId('compare-difference')).toHaveCount(3)
})
test('方向キーは1px、Shiftは10px、150msの仮表示とページ組ごとのずれを戻す', async ({ page }) => {
  await openComparison(page, 2)
  const viewer = page.getByTestId('compare-old').locator('.viewer')
  const scale = await viewer.getAttribute('data-zoom').then(Number)
  const edgeColor = () => page.getByTestId('compare-old').locator('.preview-canvas').evaluate(el => {
    const c = el as HTMLCanvasElement
    return [...c.getContext('2d')!.getImageData(Math.floor(43 * c.width / 400), Math.floor(60 * c.height / 400), 1, 1).data].slice(0, 3)
  })
  expect(await edgeColor()).toEqual([0, 0, 255])
  await viewer.focus()
  await page.keyboard.press('ArrowLeft')
  const offset = -1 / (scale * 96 / 72)
  await expect.poll(() => page.getByTestId('compare-view').getAttribute('data-offset-x').then(Number)).toBeCloseTo(offset, 5)
  await page.keyboard.press('Shift+ArrowLeft')
  await expect.poll(() => page.getByTestId('compare-view').getAttribute('data-offset-x').then(Number)).toBeCloseTo(offset * 11, 5)
  await expect.poll(edgeColor).toEqual([255, 255, 255])
  await page.getByRole('button', { name: '次の組 ›', exact: true }).click()
  await expect(page.getByTestId('compare-view')).toHaveAttribute('data-offset-x', '0')
  await page.getByRole('button', { name: '‹ 前の組', exact: true }).click()
  await expect.poll(() => page.getByTestId('compare-view').getAttribute('data-offset-x').then(Number)).toBeCloseTo(offset * 11, 5)
  await page.getByRole('button', { name: '戻す', exact: true }).click()
  await expect(page.getByTestId('compare-view')).toHaveAttribute('data-offset-x', '0')
  await expect(page.getByTestId('compare-view')).toHaveAttribute('data-offset-y', '0')
  await expect.poll(edgeColor).toEqual([0, 0, 255])
})
test('並べると両側の実画素と囲みが正しく、左右の移動と倍率が同期し、終わると破棄する', async ({ page }) => {
  await openComparison(page)
  await page.getByLabel('並べる', { exact: true }).check()
  for (const side of ['compare-old', 'compare-new']) {
    await expect(page.getByTestId(side).locator('.page-view')).toHaveAttribute('data-sharp', 'true')
    await expect(page.getByTestId(side).locator('.compare-region-layer rect')).toHaveCount(3)
    await expect(page.getByTestId(side).locator('[data-testid^="annotation-layer-"]')).toHaveCount(0)
  }
  expect((await raster(page)).bOld).toEqual([0, 0, 0])
  expect((await raster(page, 'compare-new')).bNew).toEqual([0, 0, 0])
  expect((await raster(page, 'compare-new')).annotation).toEqual([255, 255, 255])
  await page.getByRole('button', { name: '比較を拡大' }).click()
  const left = page.getByTestId('compare-old').locator('.viewer'), right = page.getByTestId('compare-new').locator('.viewer')
  await expect.poll(async () => Math.abs(Number(await left.getAttribute('data-zoom')) - Number(await right.getAttribute('data-zoom')))).toBeLessThan(.002)
  await right.focus(); await page.keyboard.press('PageDown')
  await expect.poll(async () => Math.abs(await left.evaluate(el => el.scrollTop) - await right.evaluate(el => el.scrollTop))).toBeLessThan(2)
  await page.getByRole('button', { name: '終わる', exact: true }).click()
  await expect(page.getByTestId('compare-view')).toHaveCount(0)
  await expect(page.locator('.compare-region-layer')).toHaveCount(0)
  await expect(page.getByTestId('viewer')).toBeVisible()
  await page.keyboard.press('r')
  await expect(page.getByRole('button', { name: '四角', exact: true })).toHaveAttribute('aria-pressed', 'true')
})
test('旧と新の対応を変えても現在の組だけを比較し、終了後は要求を増やさない', async ({ page }) => {
  await openComparison(page)
  const jobs = () => page.evaluate(() => (window as Window & { __compareJobs?: Array<{ oldPage: number; newPage: number; worker: number }> }).__compareJobs ?? [])
  expect((await jobs()).every(job => job.oldPage === 0 && job.newPage === 0)).toBe(true)
  expect(new Set((await jobs()).map(job => job.worker)).size).toBe(1)
  const before = (await jobs()).length
  await page.getByLabel('比較の旧ページ番号').fill('2')
  await page.getByLabel('比較の新ページ番号').fill('3')
  await expect(page.getByTestId('compare-difference')).toHaveCount(3)
  await expect(page.getByTestId('compare-difference').first()).toContainText('p.2')
  await expect(page.getByTestId('compare-old').locator('.page-empty')).toHaveCount(1)
  const changed = (await jobs()).slice(before)
  expect(changed.some(job => job.oldPage === 1 && job.newPage === 2)).toBe(true)
  expect(changed.every(job => job.oldPage === 1 && [0, 2].includes(job.newPage))).toBe(true)
  await page.getByRole('button', { name: '終わる', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__karu!.isIdle())).toBe(true)
  const processed = await page.evaluate(async () => (await window.__karu!.getWorkerStats()).processedCount)
  const count = (await jobs()).length
  await page.waitForTimeout(300)
  expect(await page.evaluate(async () => (await window.__karu!.getWorkerStats()).processedCount)).toBe(processed)
  expect((await jobs()).length).toBe(count)
})

test('旧版→新版の順に開いたまま比較を始めると、先に開いた方が旧版になる', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.waitForFunction(() => Boolean(window.__karu))
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, 'old.pdf'), [...makeComparePdf({ count: 1 })])
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, 'new.pdf'), [...makeComparePdf({ revised: true, count: 1 })])
  const [oldId, newId] = await page.evaluate(() => window.__karu!.listTabs().map(tab => tab.docId))
  await page.getByRole('button', { name: '表示▼', exact: true }).click()
  await page.getByRole('menuitem', { name: '2つの PDF を比較…', exact: true }).click()
  await expect(page.getByLabel('比較する旧版')).toHaveValue(oldId)
  await expect(page.getByLabel('比較する新版')).toHaveValue(newId)
})
