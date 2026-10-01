import mupdf from 'mupdf'
import { expect, test, type Page } from '@playwright/test'
import { checkRaster, makeSplitPdf, openSplitPair, panePosition, waitForRightSharp } from './splitFixtures'

const pdfErrors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => {
  const errors: string[] = []
  pdfErrors.set(page, errors)
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (/xref.*recursion|cannot find object in xref|invalid page number/i.test(message.text())) errors.push(message.text())
  })
})
test.afterEach(({ page }) => { expect(pdfErrors.get(page)).toEqual([]) })

test('別文書の内容・保存済みの書き込み・文字サイズと左のページ一覧を確認する', async ({ page }) => {
  await openSplitPair(page)
  const tabs = await page.evaluate(() => window.__karu!.listTabs())
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-doc-id', tabs[0].docId)
  await expect(page.getByTestId('right-viewer')).toHaveAttribute('data-doc-id', tabs[1].docId)
  await expect(page.getByLabel('右に表示する文書')).toHaveValue(tabs[1].docId)
  await expect(page.locator('.status-bar')).toContainText('/ 5 ページ')
  await expect(page.getByTestId('thumbnail-4')).toBeAttached()
  await checkRaster(page, 'left', false)
  await checkRaster(page, 'right', true)
  await expect(page.getByTestId('right-viewer').locator('[data-testid^="annotation-layer-"], .text-layer, .search-highlight-layer, textarea, svg')).toHaveCount(0)
})

test('双方からページ・割合・幅の比率を合わせ、同期をオフにすると独立する', async ({ page }) => {
  await openSplitPair(page, 5, 4, 1200, 2000)
  await page.getByTestId('thumbnail-2').click()
  await expect(page.getByLabel('右のページ番号')).toHaveValue('3')
  await expect.poll(async () => {
    const a = await panePosition(page, 'left'), b = await panePosition(page, 'right')
    return Math.abs(a.fraction - b.fraction)
  }).toBeLessThan(.003)
  const a = await panePosition(page, 'left'), b = await panePosition(page, 'right')
  expect(b.widthRatio).toBeCloseTo(a.widthRatio, 2)
  expect(b.zoom / a.zoom).toBeCloseTo((await page.getByTestId('right-viewer').evaluate(el => el.clientWidth - 32)) / (await page.getByTestId('viewer').evaluate(el => el.clientWidth - 32)) / 2, 3)
  await page.getByLabel('右のページ番号').fill('2')
  await expect(page.locator('.status-bar')).toContainText('2 / 5')
  const before = await panePosition(page, 'right')
  await page.getByTestId('right-viewer').hover()
  await page.mouse.wheel(0, 210)
  await expect.poll(async () => {
    const left = await panePosition(page, 'left'), right = await panePosition(page, 'right')
    return Math.abs(left.fraction - right.fraction)
  }).toBeLessThan(.003)
  expect((await panePosition(page, 'right')).top).toBeGreaterThan(before.top)
  const stable = await panePosition(page, 'right')
  await page.waitForTimeout(300)
  expect((await panePosition(page, 'right')).top).toBeCloseTo(stable.top, 0)
  await page.getByLabel('ページを合わせて動かす').uncheck()
  await page.getByLabel('右のページ番号').fill('1')
  await page.getByTestId('thumbnail-3').click()
  await expect(page.locator('.status-bar')).toContainText('4 / 5')
  await expect(page.getByLabel('右のページ番号')).toHaveValue('1')
})

test('右の最終ページで止まり、右の倍率とCtrlホイールからも同期する', async ({ page }) => {
  await openSplitPair(page, 5, 2)
  await page.getByTestId('thumbnail-4').click()
  await expect(page.getByLabel('右のページ番号')).toHaveValue('2')
  await expect(page.locator('.status-bar')).toContainText('5 / 5')
  await page.getByLabel('右のページ番号').fill('1')
  await page.getByRole('button', { name: '右を拡大', exact: true }).click()
  await expect.poll(async () => Math.abs((await panePosition(page, 'left')).widthRatio - (await panePosition(page, 'right')).widthRatio)).toBeLessThan(.005)
  const before = (await panePosition(page, 'right')).zoom
  await page.getByTestId('right-viewer').hover()
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control')
  await expect.poll(async () => (await panePosition(page, 'right')).zoom).toBeGreaterThan(before)
  await expect.poll(async () => Math.abs((await panePosition(page, 'left')).widthRatio - (await panePosition(page, 'right')).widthRatio)).toBeLessThan(.005)
})

test('右では描けず、左の四角だけが保存され、右にフォーカスしたUndoも左へ効く', async ({ page }) => {
  await openSplitPair(page)
  await page.getByLabel('ページを合わせて動かす').uncheck()
  await page.evaluate(() => window.__karu!.scrollToPage(0))
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).length)).toBe(1)
  await page.getByTestId('right-viewer').click({ position: { x: 20, y: 20 } })
  await page.keyboard.press('r')
  await expect(page.getByRole('button', { name: '四角', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const right = await page.getByTestId('right-viewer').boundingBox()
  if (!right) throw new Error('右の表示がありません')
  await page.mouse.move(right.x + 90, right.y + 90); await page.mouse.down()
  await page.mouse.move(right.x + 160, right.y + 150, { steps: 5 }); await page.mouse.up()
  expect(await page.evaluate(() => window.__karu!.getEditableAnnotations(0).length)).toBe(1)
  const left = await page.getByTestId('annotation-layer-0').boundingBox()
  if (!left) throw new Error('左の編集層がありません')
  await page.mouse.move(left.x + 90, left.y + 90); await page.mouse.down()
  await page.mouse.move(left.x + 180, left.y + 150, { steps: 5 }); await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).length)).toBe(2)
  const rect = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).find(a => a.rect[0] < 200)!.rect)
  const sourceZoom = (await panePosition(page, 'left')).zoom
  expect(rect[2] - rect[0]).toBeCloseTo(90 / (sourceZoom * 96 / 72), 0)
  expect(rect[3] - rect[1]).toBeCloseTo(60 / (sourceZoom * 96 / 72), 0)
  await page.getByTestId('right-viewer').click({ position: { x: 20, y: 20 } })
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).length)).toBe(1)
  await page.keyboard.press('Control+y')
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).length)).toBe(2)
  const saved = await page.evaluate(async () => Array.from((await window.__karu!.saveToBytes())!))
  const doc = new mupdf.PDFDocument(Uint8Array.from(saved)), pdfPage = doc.loadPage(0)
  try {
    const annotations = pdfPage.getAnnotations()
    try {
      expect(annotations).toHaveLength(2)
      const added = annotations.find(a => a.getRect()[0] < 200)!
      expect(added.getRect()[2] - added.getRect()[0]).toBeCloseTo(rect[2] - rect[0], 1)
      const text = pdfPage.toStructuredText('')
      try { expect(text.asText()).toContain('RED page 1') } finally { text.destroy() }
    } finally { annotations.forEach(a => a.destroy()) }
  } finally { pdfPage.destroy(); doc.destroy() }
  await page.getByRole('button', { name: '⇄ 入れ替え' }).click()
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-doc-id', await page.evaluate(() => window.__karu!.listTabs()[1].docId))
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).length)).toBe(1)
})

test('入れ替えで文書と表示位置が移り、右のタブを閉じると選択案内を出す', async ({ page }) => {
  await openSplitPair(page)
  await page.getByLabel('ページを合わせて動かす').uncheck()
  await page.getByLabel('右のページ番号').fill('3')
  await page.getByTestId('thumbnail-1').click()
  const leftPosition = await panePosition(page, 'left'), rightPosition = await panePosition(page, 'right')
  const ids = await page.evaluate(() => window.__karu!.listTabs().map(t => t.docId))
  await page.getByRole('button', { name: '⇄ 入れ替え' }).click()
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-doc-id', ids[1])
  await expect(page.getByTestId('right-viewer')).toHaveAttribute('data-doc-id', ids[0])
  await expect(page.locator('.status-bar')).toContainText('3 / 4')
  await expect(page.getByLabel('右のページ番号')).toHaveValue('2')
  expect((await panePosition(page, 'left')).fraction).toBeCloseTo(rightPosition.fraction, 2)
  expect((await panePosition(page, 'right')).fraction).toBeCloseTo(leftPosition.fraction, 2)
  await page.evaluate(id => window.__karu!.closeTab(id), ids[0])
  await expect(page.getByTestId('split-reference').getByText('表示する文書を選んでください', { exact: true }).last()).toBeVisible()
  await expect(page.getByTestId('right-viewer')).toHaveCount(0)
})

test('同じ文書の初期同期はオフ、位置の入れ替えとオンへの切り替えができる', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.waitForFunction(() => Boolean(window.__karu))
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, 'same.pdf'), makeSplitPdf(5))
  await page.keyboard.press('Control+Backslash')
  await expect(page.getByTestId('right-viewer')).toBeVisible()
  await expect(page.getByLabel('ページを合わせて動かす')).not.toBeChecked()
  await page.getByTestId('thumbnail-2').click()
  await page.getByLabel('右のページ番号').fill('2')
  const beforeLeft = await panePosition(page, 'left'), beforeRight = await panePosition(page, 'right')
  await page.getByRole('button', { name: '⇄ 入れ替え' }).click()
  await expect(page.locator('.status-bar')).toContainText('2 / 5')
  await expect(page.getByLabel('右のページ番号')).toHaveValue('3')
  expect((await panePosition(page, 'left')).fraction).toBeCloseTo(beforeRight.fraction, 2)
  expect((await panePosition(page, 'right')).fraction).toBeCloseTo(beforeLeft.fraction, 2)
  await page.getByLabel('ページを合わせて動かす').check()
  await expect(page.getByLabel('右のページ番号')).toHaveValue('2')
  await expect.poll(async () => Math.abs((await panePosition(page, 'left')).fraction - (await panePosition(page, 'right')).fraction)).toBeLessThan(.003)
})

test('右の方向キーはスクロールだけを動かし、境目・選択・道具を維持する', async ({ page }) => {
  await openSplitPair(page)
  await page.getByLabel('ページを合わせて動かす').uncheck()
  await page.getByTestId('annotation-layer-0').locator('.annotation-hit[data-annotation-id]').first().click()
  const annotation = await page.evaluate(() => window.__karu!.getEditableAnnotations(0)[0].rect)
  const right = page.getByTestId('right-viewer')
  await right.click({ position: { x: 20, y: 20 } })
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => right.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
  expect(await page.evaluate(() => window.__karu!.getEditableAnnotations(0)[0].rect)).toEqual(annotation)
  await expect(page.locator('.annotation-selection')).toHaveCount(1)
  await page.keyboard.press('PageDown')
  await expect.poll(() => right.evaluate(el => el.scrollTop)).toBeGreaterThan(80)
  await page.keyboard.press('r')
  await expect(page.getByRole('button', { name: '四角', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const divider = page.getByRole('separator', { name: '左右の境目' })
  const box = await divider.boundingBox()
  if (!box) throw new Error('境目がありません')
  await page.mouse.move(box.x + 3, box.y + 100); await page.mouse.down()
  await page.mouse.move(box.x + 900, box.y + 100, { steps: 5 }); await page.mouse.up()
  await expect(divider).toHaveAttribute('aria-valuenow', '75')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('karu-pdf:split-view')!).ratio)).toBe(.75)
})

test('整理中は右を外し、閉じると復帰、ショートカットと閉じる操作で右のDOMを破棄する', async ({ page }) => {
  await openSplitPair(page)
  const left = page.getByTestId('viewer')
  await left.evaluate(el => { (el as HTMLElement).dataset.identity = 'keep-left' })
  await page.keyboard.press('Control+Backslash')
  await expect(page.getByTestId('split-reference')).toHaveCount(0)
  await expect(page.getByTestId('right-viewer')).toHaveCount(0)
  await expect(left).toHaveAttribute('data-identity', 'keep-left')
  await page.keyboard.press('Control+Backslash')
  await expect(page.getByTestId('right-viewer')).toBeVisible()
  await page.evaluate(() => window.__karu!.openOrganize())
  await expect(page.getByTestId('split-reference')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('right-viewer')).toBeVisible()
  await page.getByRole('button', { name: '左右に並べるのをやめる' }).click()
  await expect(page.getByTestId('split-reference')).toHaveCount(0)
  await expect(page.locator('.split-divider')).toHaveCount(0)
})

test('同じ文書の同じ要求はキャッシュを共有し、未保存の編集は右の画像に混ぜない', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1&workers=4')
  await page.waitForFunction(() => Boolean(window.__karu))
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, 'same.pdf'), makeSplitPdf(5))
  await page.evaluate(() => window.__karu!.setZoom(1))
  await expect.poll(() => page.getByTestId('viewer').locator('.page-view[data-page-index="0"]').getAttribute('data-sharp')).toBe('true')
  await expect.poll(() => page.evaluate(() => window.__karu!.isIdle())).toBe(true)
  const pageZeroRenders = () => page.evaluate(() => (window as Window & {
    __karuWorkerRenderRequests?: Array<{ pageIndex: number; cancelled: boolean }>
  }).__karuWorkerRenderRequests?.filter(job => job.pageIndex === 0 && !job.cancelled).length ?? 0)
  const before = await pageZeroRenders()
  await page.keyboard.press('Control+Backslash')
  await expect(page.getByTestId('right-viewer')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__karu!.isIdle())).toBe(true)
  await checkRaster(page, 'right', false)
  expect(await pageZeroRenders()).toBe(before)
  const layer = await page.getByTestId('annotation-layer-0').boundingBox()
  if (!layer) throw new Error('編集層がありません')
  await page.keyboard.press('r')
  await page.mouse.move(layer.x + 60, layer.y + 70); await page.mouse.down()
  await page.mouse.move(layer.x + 140, layer.y + 130); await page.mouse.up()
  await expect(page.getByText('未保存の書き込みは表示されません', { exact: true })).toBeVisible()
  await expect(page.getByTestId('right-viewer').locator('[data-testid^="annotation-layer-"]')).toHaveCount(0)
  await checkRaster(page, 'right', false)
  await page.evaluate(() => window.__karu!.saveToBytes())
  await expect(page.getByText('未保存の書き込みは表示されません', { exact: true })).toHaveCount(0)
  await expect(page.getByTestId('right-viewer')).toBeVisible()
  await waitForRightSharp(page)
  const redPixels = await page.getByTestId('right-viewer').locator('.page-view[data-page-index="0"] .preview-canvas').evaluate(el => {
    const canvas = el as HTMLCanvasElement
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    let red = 0
    for (let y = 0; y < canvas.height * .13; y++) for (let x = 0; x < canvas.width * .2; x++) {
      const i = (Math.floor(y) * canvas.width + Math.floor(x)) * 4
      if (data[i] > 180 && data[i + 1] < 100 && data[i + 2] < 100) red++
    }
    return red
  })
  expect(redPixels).toBeGreaterThan(10)
  // A display refresh between user saves must not damage the next saved PDF.
  await page.keyboard.press('r')
  await page.mouse.move(layer.x + 200, layer.y + 90); await page.mouse.down()
  await page.mouse.move(layer.x + 280, layer.y + 150); await page.mouse.up()
  const savedAgain = await page.evaluate(async () => Array.from((await window.__karu!.saveToBytes())!))
  const reopened = new mupdf.PDFDocument(Uint8Array.from(savedAgain)), pdfPage = reopened.loadPage(0)
  try {
    expect(reopened.countPages()).toBe(5)
    const text = pdfPage.toStructuredText('')
    try { expect(text.asText()).toContain('RED page 1') } finally { text.destroy() }
    const annotations = pdfPage.getAnnotations()
    try { expect(annotations).toHaveLength(3) } finally { annotations.forEach(a => a.destroy()) }
  } finally { pdfPage.destroy(); reopened.destroy() }
  await waitForRightSharp(page)
})

test('3つのタブでも右に選んだ文書を読み直し、解除後も前の右の文書を選ぶ', async ({ page }) => {
  await openSplitPair(page)
  const ids = await page.evaluate(() => window.__karu!.listTabs().map(t => t.docId))
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, 'third.pdf'), makeSplitPdf(3))
  await expect(page.locator('.status-bar')).toContainText('1 / 3')
  await expect(page.getByTestId('right-viewer')).toHaveAttribute('data-doc-id', ids[1])
  await page.getByLabel('右に表示する文書').selectOption(ids[0])
  await expect(page.getByTestId('right-viewer')).toHaveAttribute('data-doc-id', ids[0])
  await checkRaster(page, 'right', false)
  await page.keyboard.press('Control+Backslash')
  await expect(page.getByTestId('right-viewer')).toHaveCount(0)
  await page.keyboard.press('Control+Backslash')
  await expect(page.getByTestId('right-viewer')).toHaveAttribute('data-doc-id', ids[0])
  await expect(page.locator('.status-bar')).toContainText('/ 3 ページ')
})

test('動いている間は左右の低解像度画像を使い、停止後に実際の画素が鮮明になる', async ({ page }) => {
  await openSplitPair(page, 30, 30)
  for (const side of ['viewer', 'right-viewer']) {
    await expect.poll(() => page.getByTestId(side).locator('.page-view[data-page-index="1"] canvas.preview-canvas')
      .evaluate(el => (el as HTMLCanvasElement).width)).toBeGreaterThan(2)
  }
  // Finish the preceding zoom before starting this functional scroll scenario.
  await page.waitForTimeout(450)
  const during = await page.evaluate(async () => {
    const left = document.querySelector<HTMLElement>('[data-testid="viewer"]')!
    const right = document.querySelector<HTMLElement>('[data-testid="right-viewer"]')!
    const pageTop = left.querySelectorAll<HTMLElement>('.page-empty')[1].offsetTop
    const log = (window as Window & { __karuWorkerRenderRequests?: Array<{ pageIndex: number; priority: number }> })
    const before = log.__karuWorkerRenderRequests?.length ?? 0
    left.scrollTop = pageTop - Math.min(left.clientHeight, right.clientHeight) + 100
    for (let frame = 0; frame < 30; frame++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      left.scrollTop += 1
    }
    const raster = (viewer: HTMLElement) => {
      const canvas = viewer.querySelector<HTMLCanvasElement>('.page-view[data-page-index="1"] .preview-canvas')!
      const pixel = canvas.getContext('2d')!.getImageData(Math.floor(canvas.width * .2), Math.floor(canvas.height * .2), 1, 1).data
      return { width: canvas.width, color: [...pixel].slice(0, 3) }
    }
    return { left: raster(left), right: raster(right),
      newSharpRequests: log.__karuWorkerRenderRequests?.slice(before).filter(job => job.pageIndex === 1 && job.priority === 0).length ?? 0 }
  })
  expect(during.left.width).toBeLessThanOrEqual(512)
  expect(during.right.width).toBeLessThanOrEqual(512)
  expect(during.left.color).toEqual([255, 0, 0])
  expect(during.right.color).toEqual([0, 0, 255])
  expect(during.newSharpRequests).toBe(0)
  for (const side of ['viewer', 'right-viewer']) {
    const renderedPage = page.getByTestId(side).locator('.page-view[data-page-index="1"]')
    await expect.poll(() => renderedPage.getAttribute('data-sharp')).toBe('true')
    expect(await renderedPage.locator('.preview-canvas').evaluate(el => (el as HTMLCanvasElement).width)).toBe(800)
  }
})

test('同期で動いた右側も、普通のスクロールに応じて遠いページを先読みする', async ({ page }) => {
  await openSplitPair(page, 30, 30)
  const rightId = await page.getByTestId('right-viewer').getAttribute('data-doc-id')
  await page.getByTestId('thumbnail-2').click()
  await expect(page.getByLabel('右のページ番号')).toHaveValue('3')
  await page.getByTestId('viewer').hover()
  await page.waitForTimeout(150)
  await page.mouse.wheel(0, 120)
  await expect.poll(() => page.evaluate(id => (window as Window & {
    __karuWorkerRenderRequests?: Array<{ docId: string; pageIndex: number; priority: number; cancelled: boolean }>
  }).__karuWorkerRenderRequests?.some(job => job.docId === id && job.pageIndex >= 7 && job.priority === 1 && !job.cancelled), rightId)).toBe(true)
  await expect.poll(async () => Math.abs((await panePosition(page, 'left')).fraction - (await panePosition(page, 'right')).fraction)).toBeLessThan(.003)
})
