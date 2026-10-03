import fs from 'node:fs'
import path from 'node:path'
import mupdf from 'mupdf'
import { expect, test, type Page } from '@playwright/test'

const sample = path.resolve('test-data/sample-small.pdf')

function makePdf(labels: string[]): Buffer {
  const document = new mupdf.PDFDocument()
  try {
    for (const label of labels) {
      const page = document.addPage(
        [0, 0, 300, 400], 0,
        { Font: { F1: { Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' } } },
        `BT /F1 18 Tf 40 80 Td (${label}) Tj ET`,
      )
      try { document.insertPage(-1, page) } finally { page.destroy() }
    }
    const buffer = document.saveToBuffer('compress')
    try { return Buffer.from(buffer.asUint8Array()) } finally { buffer.destroy() }
  } finally { document.destroy() }
}

async function openSample(page: Page): Promise<void> {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(sample)
  await expect(page.getByText('1 / 5')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__karu?.isIdle() ?? false), { timeout: 60_000 }).toBe(true)
}

async function pageInfo(page: Page) {
  return page.evaluate(() => window.__karu!.getPageInfo())
}

test('ページ整理のプレビュー、方向キー、拡大プレビューを操作する', async ({ page }) => {
  test.setTimeout(120_000)
  await openSample(page)
  await page.evaluate(() => window.__karu!.openOrganize())
  const scroller = page.locator('.organize-grid-scroller')
  await page.getByTestId('organize-card-2').click()
  await expect(page.getByTestId('organize-preview-position')).toHaveText('3 / 5')
  const preview = page.getByTestId('organize-preview-canvas')
  await expect(preview).toHaveAttribute('data-rendered', 'true')
  await expect.poll(() => preview.evaluate((element) => {
    const canvas = element as HTMLCanvasElement
    const context = canvas.getContext('2d')
    if (!context || canvas.width === 0 || canvas.height === 0) return false
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    const first = [pixels[0], pixels[1], pixels[2]]
    for (let index = 4; index < pixels.length; index += 4) {
      if (pixels[index] !== first[0] || pixels[index + 1] !== first[1] || pixels[index + 2] !== first[2]) return true
    }
    return false
  })).toBe(true)
  await page.screenshot({ path: 'test-results/organize-preview.png', fullPage: true })

  await scroller.press('ArrowRight')
  await scroller.press('ArrowRight')
  await expect(page.getByTestId('organize-card-4')).toHaveClass(/focused/)
  await expect(page.getByTestId('organize-preview-position')).toHaveText('5 / 5')

  await scroller.press('Shift+ArrowLeft')
  await scroller.press('Shift+ArrowLeft')
  await expect(page.locator('.organize-card.selected')).toHaveCount(3)
  await expect(page.getByText('選択: 3ページ ／ 全5ページ（下書き）')).toBeVisible()

  await scroller.press('Space')
  const lightbox = page.getByRole('dialog', { name: '拡大プレビュー' })
  await expect(lightbox).toBeVisible()
  await expect(lightbox.locator('header strong')).toHaveText('3 / 5')
  await lightbox.press('ArrowRight')
  await expect(lightbox.locator('header strong')).toHaveText('4 / 5')
  await lightbox.press('Escape')
  await expect(lightbox).toBeHidden()

  await page.getByTestId('organize-card-0').click()
  await page.waitForTimeout(250)
  await page.evaluate(() => { (window as Window & { __karuOrganizePreviewRequests?: number[] }).__karuOrganizePreviewRequests = [] })
  for (let index = 0; index < 20; index += 1) {
    await scroller.press('ArrowRight')
    await page.waitForTimeout(20)
  }
  await expect(page.getByTestId('organize-card-4')).toHaveClass(/focused/)
  await expect.poll(() => page.evaluate(() => (window as Window & { __karuOrganizePreviewRequests?: number[] }).__karuOrganizePreviewRequests ?? []))
    .toEqual([4])
})

test('ページ整理のプレビューを段階拡大し、幅と方向キーとCtrlホイールを使える', async ({ page }) => {
  await openSample(page)
  await page.evaluate(() => window.__karu!.openOrganize())
  await page.getByTestId('organize-card-1').click()
  const pane = page.getByTestId('organize-preview-pane')
  const preview = page.getByTestId('organize-preview-canvas')
  await expect(preview).toHaveAttribute('data-rendered', 'true')
  const width100 = await preview.evaluate((element) => element.getBoundingClientRect().width)
  await pane.getByRole('button', { name: 'プレビューを拡大' }).click()
  await pane.getByRole('button', { name: 'プレビューを拡大' }).click()
  await expect(pane.getByRole('button', { name: '200%' })).toBeVisible()
  await expect.poll(() => preview.evaluate((element) => element.getBoundingClientRect().width)).toBeCloseTo(width100 * 2, 0)
  await pane.getByRole('button', { name: 'プレビューを幅に合わせる' }).click()
  await expect.poll(() => preview.evaluate((element) => element.getBoundingClientRect().width)).toBeCloseTo(width100, 0)

  await preview.hover({ position: { x: Math.max(1, width100 / 2), y: 80 } })
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -100)
  await page.keyboard.up('Control')
  await expect(pane.getByRole('button', { name: '150%' })).toBeVisible()

  await pane.getByRole('button', { name: '150%' }).click()
  await pane.getByRole('menuitemcheckbox', { name: '300%', exact: true }).click()
  const scroller = page.locator('.organize-grid-scroller')
  await scroller.focus()
  await scroller.press('ArrowRight')
  await expect(page.getByTestId('organize-card-2')).toHaveClass(/focused/)
  await expect(pane.getByRole('button', { name: '300%' })).toBeVisible()
})

test('A1を800%にして全体画像を制限し、見える範囲を鮮明に描く', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('/karu-pdf/?test=1&workers=3')
  await page.getByTestId('file-input').setInputFiles(path.resolve('test-data/heavy-300p.pdf'))
  await expect(page.getByText('1 / 300')).toBeVisible({ timeout: 180_000 })
  await page.evaluate(() => window.__karu!.openOrganize())
  await page.getByTestId('organize-card-5').click()
  const resizer = page.getByRole('separator', { name: 'プレビューの幅を変更' })
  const resizerBox = await resizer.boundingBox()
  if (!resizerBox) throw new Error('プレビューの幅変更つまみが見つかりません。')
  await page.mouse.move(resizerBox.x + resizerBox.width / 2, resizerBox.y + 80)
  await page.mouse.down()
  await page.mouse.move(resizerBox.x - 300, resizerBox.y + 80, { steps: 6 })
  await page.mouse.up()
  const pane = page.getByTestId('organize-preview-pane')
  await expect.poll(() => pane.evaluate((element) => element.getBoundingClientRect().width)).toBe(640)
  const preview = page.getByTestId('organize-preview-canvas')
  await expect(preview).toHaveAttribute('data-rendered', 'true', { timeout: 180_000 })
  const started = await page.evaluate(() => performance.now())
  await pane.getByRole('button', { name: '100%' }).click()
  await pane.getByRole('menuitemcheckbox', { name: '800%', exact: true }).click()
  await expect(preview).toHaveAttribute('data-detail-rendered', 'true', { timeout: 180_000 })
  const sharpMs = await page.evaluate((start) => performance.now() - start, started)
  await expect(preview).toHaveAttribute('data-base-rendered', 'true', { timeout: 180_000 })
  const measurement = await preview.evaluate((element, measuredSharpMs) => ({
    basePixels: Number(element.getAttribute('data-base-pixels')),
    detailPixels: Number(element.getAttribute('data-detail-pixels')),
    sharpMs: measuredSharpMs,
  }), sharpMs)
  expect(measurement.basePixels).toBeGreaterThan(0)
  expect(measurement.basePixels).toBeLessThanOrEqual(8_000_000)
  expect(measurement.detailPixels).toBeGreaterThan(0)
  expect(measurement.detailPixels).toBeLessThanOrEqual(8_000_000)
  console.log(`[organize-preview-800] ${JSON.stringify(measurement)}`)
})

test('ページ整理をドラッグ・回転・削除・白紙挿入し、保存と復元ができる', async ({ page }) => {
  await openSample(page)
  const original = await pageInfo(page)
  await page.getByRole('button', { name: 'ページ▼' }).click()
  await page.getByRole('menuitem', { name: 'ページ整理', exact: true }).click()
  await expect(page.getByTestId('organize-view')).toBeVisible()

  const source = page.getByTestId('organize-card-2')
  const target = page.getByTestId('organize-card-0')
  const from = await source.boundingBox()
  const to = await target.boundingBox()
  if (!from || !to) throw new Error('ページカードが見つかりません。')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + 4, to.y + to.height / 2, { steps: 8 })
  await page.mouse.up()

  await page.getByTestId('organize-card-2').click()
  await page.getByRole('button', { name: '回転▼' }).click()
  await page.getByRole('menuitem', { name: '右に90°' }).click()
  await page.getByTestId('organize-card-3').click()
  await page.getByRole('button', { name: '削除', exact: true }).click()
  await page.getByTestId('organize-card-3').click()
  await page.getByRole('button', { name: '挿入▼' }).click()
  await page.getByRole('menuitem', { name: '白紙のページ' }).click()
  await page.getByTestId('organize-blank-dialog').getByRole('button', { name: '挿入' }).click()
  await page.getByRole('button', { name: '適用', exact: true }).click()
  await expect(page.getByTestId('organize-view')).toBeHidden()

  const changed = await pageInfo(page)
  expect(changed).toHaveLength(5)
  expect(changed.map((item) => item.text)).toEqual([
    original[2].text, original[0].text, original[1].text, original[4].text, '',
  ])
  expect(changed[2].rotation).toBe((original[1].rotation + 90) % 360)

  const saved = await page.evaluate(async () => Array.from((await window.__karu!.saveToBytes())!))
  const docId = await page.evaluate(() => window.__karu!.listTabs()[0].docId)
  await page.evaluate((id) => window.__karu!.closeTab(id), docId)
  await page.evaluate(async (bytes) => window.__karu!.openBytes(bytes, 'organized.pdf'), saved)
  await expect.poll(() => page.evaluate(() => window.__karu!.getPageInfo().then((items) => items.length))).toBe(5)
  expect((await pageInfo(page)).map((item) => [item.text, item.rotation]))
    .toEqual(changed.map((item) => [item.text, item.rotation]))

  await page.evaluate(() => window.__karu!.closeTab(window.__karu!.listTabs()[0].docId))
  await page.getByTestId('file-input').setInputFiles(sample)
  await page.getByRole('button', { name: 'ページ▼' }).click()
  await page.getByRole('menuitem', { name: 'ページ整理', exact: true }).click()
  await page.evaluate(() => {
    const draft = window.__karu!.organizeDraft()!
    draft.move([draft.getCards()[2].id], 0)
  })
  await page.evaluate(() => window.__karu!.applyOrganize())
  await page.evaluate(() => window.__karu!.undoLastOrganize())
  expect((await pageInfo(page)).map((item) => item.text)).toEqual(original.map((item) => item.text))
})

test('別PDFの追加、抽出、分割をバイト列で確認する', async ({ page }) => {
  await openSample(page)
  await page.evaluate(() => window.__karu!.openOrganize())
  await expect(page.getByTestId('organize-view')).toBeVisible()
  await page.getByTestId('organize-file-input').setInputFiles({
    name: 'material.pdf', mimeType: 'application/pdf', buffer: makePdf(['Material 1', 'Material 2']),
  })
  await page.getByTestId('organize-source-dialog').getByRole('button', { name: '挿入', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__karu!.organizeDraft()!.getCards().length)).toBe(7)

  const extracted = await page.evaluate(async () => {
    const cards = window.__karu!.organizeDraft()!.getCards()
    return Array.from(await window.__karu!.extractToBytes([cards[6].id, cards[0].id]))
  })
  const extractedDocument = new mupdf.PDFDocument(Uint8Array.from(extracted))
  try { expect(extractedDocument.countPages()).toBe(2) } finally { extractedDocument.destroy() }

  const split = await page.evaluate(async () => {
    const outputs = await window.__karu!.splitToBytes({ kind: 'every', count: 3 })
    return outputs.map((bytes) => Array.from(bytes))
  })
  expect(split).toHaveLength(3)
  expect(split.map((bytes) => {
    const document = new mupdf.PDFDocument(Uint8Array.from(bytes))
    try { return document.countPages() } finally { document.destroy() }
  })).toEqual([3, 3, 1])

  const splitAtSelection = await page.evaluate(async () => {
    const cards = window.__karu!.organizeDraft()!.getCards()
    const outputs = await window.__karu!.splitToBytes({ kind: 'before', cardIds: [cards[2].id, cards[5].id] })
    return outputs.map((bytes) => Array.from(bytes))
  })
  expect(splitAtSelection.map((bytes) => {
    const document = new mupdf.PDFDocument(Uint8Array.from(bytes))
    try { return document.countPages() } finally { document.destroy() }
  })).toEqual([2, 3, 2])

  await page.evaluate(() => window.__karu!.applyOrganize())
  await expect.poll(() => page.evaluate(() => window.__karu!.getPageInfo().then((items) => items.length))).toBe(7)
  expect((await pageInfo(page)).slice(-2).map((item) => item.text)).toEqual(['Material 1', 'Material 2'])
})

test('複数PDFの順番と範囲と挿入位置をダイアログで指定する', async ({ page }) => {
  await openSample(page)
  const original = await pageInfo(page)
  await page.evaluate(() => window.__karu!.openOrganize())
  await page.getByTestId('organize-card-1').click()
  await page.getByTestId('organize-file-input').setInputFiles([
    { name: 'first.pdf', mimeType: 'application/pdf', buffer: makePdf(['First 1', 'First 2']) },
    { name: 'second.pdf', mimeType: 'application/pdf', buffer: makePdf(['Second 1']) },
  ])
  const dialog = page.getByTestId('organize-source-dialog')
  await expect(dialog.getByText('first.pdf')).toBeVisible()
  await dialog.getByLabel('second.pdfを上へ').click()
  await dialog.getByLabel('first.pdfのページ範囲').fill('2')
  await dialog.getByRole('button', { name: '挿入', exact: true }).click()
  await page.getByRole('button', { name: '適用', exact: true }).click()
  await expect.poll(() => pageInfo(page).then((items) => items.length)).toBe(7)
  expect((await pageInfo(page)).map((item) => item.text)).toEqual([
    original[0].text, original[1].text, 'Second 1', 'First 2', original[2].text, original[3].text, original[4].text,
  ])
})

test('A3横の白紙を2枚末尾へ挿入する', async ({ page }) => {
  await openSample(page)
  await page.evaluate(() => window.__karu!.openOrganize())
  await page.getByRole('button', { name: '挿入▼' }).click()
  await page.getByRole('menuitem', { name: '白紙のページ' }).click()
  const dialog = page.getByTestId('organize-blank-dialog')
  await dialog.getByLabel('白紙の枚数').fill('2')
  await dialog.getByLabel('白紙の大きさ').selectOption('a3')
  await dialog.getByLabel('白紙の向き').selectOption('landscape')
  await dialog.getByLabel('末尾').check()
  await dialog.getByRole('button', { name: '挿入' }).click()
  await expect.poll(() => page.evaluate(() => window.__karu!.organizeDraft()!.getCards().length)).toBe(7)
  await page.getByRole('button', { name: '適用', exact: true }).click()
  await expect.poll(() => pageInfo(page).then((items) => items.length)).toBe(7)
  const info = await pageInfo(page)
  expect(info).toHaveLength(7)
  for (const blank of info.slice(-2)) {
    expect(blank.text).toBe('')
    expect(blank.width).toBeCloseTo(1190.55, 0)
    expect(blank.height).toBeCloseTo(841.89, 0)
  }
})

test('別タブでコピーしたページを貼り付けて適用する', async ({ page }) => {
  await openSample(page)
  const copiedText = (await pageInfo(page))[0].text
  const firstTab = await page.evaluate(() => window.__karu!.listTabs()[0])
  await page.evaluate(async (bytes) => window.__karu!.openBytes(bytes, 'tab-b.pdf'), Array.from(makePdf(['Tab B 1', 'Tab B 2'])))
  const secondTab = await page.evaluate(() => window.__karu!.listTabs()[1])

  await page.evaluate((docId) => window.__karu!.activateTab(docId), firstTab.docId)
  await page.evaluate(() => window.__karu!.openOrganize())
  await page.getByTestId('organize-card-0').click()
  await page.keyboard.press('Control+c')

  await page.evaluate((docId) => window.__karu!.activateTab(docId), secondTab.docId)
  await page.evaluate(() => window.__karu!.openOrganize())
  await page.getByTestId('organize-card-1').click()
  await page.keyboard.press('Control+v')
  await expect.poll(() => page.evaluate(() => window.__karu!.organizeDraft()!.getCards().length)).toBe(3)
  await page.getByRole('button', { name: '適用', exact: true }).click()
  await expect.poll(() => pageInfo(page).then((items) => items.length)).toBe(3)
  expect((await pageInfo(page)).map((item) => item.text)).toEqual(['Tab B 1', 'Tab B 2', copiedText])
})

test('ページ番号で選んで抽出し、下書きから削除して適用する', async ({ page }) => {
  await openSample(page)
  await page.evaluate(() => window.__karu!.openOrganize())
  await page.getByRole('button', { name: '選択▼' }).click()
  await page.getByRole('menuitem', { name: 'ページ番号で選ぶ' }).click()
  const selectionDialog = page.getByTestId('organize-page-selection-dialog')
  await selectionDialog.getByLabel('選ぶページ番号').fill('1-3,5')
  await selectionDialog.getByRole('button', { name: '選択', exact: true }).click()
  await page.getByRole('button', { name: '抽出', exact: true }).click()
  const extractDialog = page.getByTestId('organize-extract-dialog')
  await extractDialog.getByLabel('抽出したページを元の文書から削除する').check()
  await page.evaluate(() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }) })
  const download = page.waitForEvent('download')
  await extractDialog.getByRole('button', { name: '抽出', exact: true }).click()
  await download
  await expect(page.getByText('選択: 0ページ ／ 全1ページ（下書き）')).toBeVisible()
  await page.getByRole('button', { name: '適用', exact: true }).click()
  await expect.poll(() => pageInfo(page).then((items) => items.length)).toBe(1)
})

test('材料PDFの確認失敗を行に表示し、成功したPDFだけ挿入する', async ({ page }) => {
  await openSample(page)
  await page.evaluate(() => window.__karu!.openOrganize())
  await page.getByTestId('organize-file-input').setInputFiles([
    { name: 'valid.pdf', mimeType: 'application/pdf', buffer: makePdf(['Valid page']) },
    { name: 'broken.txt', mimeType: 'text/plain', buffer: Buffer.from('not a pdf') },
  ])
  const dialog = page.getByTestId('organize-source-dialog')
  await expect(dialog.getByText('valid.pdf')).toBeVisible()
  await expect(dialog.getByText('broken.txt')).toBeVisible()
  await expect(dialog.locator('.organize-dialog-error')).toBeVisible()
  await expect(dialog.getByRole('button', { name: '挿入', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: '挿入', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__karu!.organizeDraft()!.getCards().length)).toBe(6)
})

test('重い図面の描画中でも挿入ダイアログをすぐ表示してページ数を確認する', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = Worker, workers: Worker[] = []
    Object.assign(window, { __organizePdfWorkers: workers })
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        if (String(url).includes('pdf.worker')) workers.push(this)
      }
    }
  })
  const realDirectory = path.resolve('test-data/real')
  const realDrawing = path.join(realDirectory, '七ヶ浜町_実施設計図.pdf')
  const drawing = fs.existsSync(realDrawing) ? realDrawing : path.resolve('test-data/heavy-300p.pdf')
  const threePages = path.join(realDirectory, '建築工事標準詳細図_R4.pdf')
  const manyPages = path.join(realDirectory, '設備工事標準図_機械_R7.pdf')
  const materials = fs.existsSync(threePages) && fs.existsSync(manyPages)
    ? [threePages, manyPages]
    : [
        { name: 'three-pages.pdf', mimeType: 'application/pdf', buffer: makePdf(Array.from({ length: 3 }, (_, index) => `Three ${index + 1}`)) },
        { name: 'many-pages.pdf', mimeType: 'application/pdf', buffer: makePdf(Array.from({ length: 174 }, (_, index) => `Many ${index + 1}`)) },
      ]

  await page.goto('/karu-pdf/?test=1&workers=3')
  await page.getByTestId('file-input').setInputFiles(drawing)
  await expect(page.locator('.page-view').first()).toBeVisible({ timeout: 180_000 })
  await page.evaluate(() => window.__karu!.openOrganize())
  await expect(page.getByTestId('organize-view')).toBeVisible()
  // The visible thumbnails can finish before a backoff poll reaches the
  // queue. Submit bounded real raster jobs to a display Worker so this test
  // exercises document metadata while rendering is actually still queued.
  await page.evaluate(() => {
    const workers = (window as unknown as { __organizePdfWorkers: Worker[] }).__organizePdfWorkers
    const docId = window.__karu!.listTabs()[0].docId
    for (let index = 0; index < 200; index++) workers[1].postMessage({
      type: 'render', docId, jobId: 1_000_000 + index, pageIndex: 0,
      renderScale: 16, deviceRect: [0, 0, 1000, 1000], priority: 0,
    })
  })
  await expect.poll(
    () => page.evaluate(() => window.__karu!.getWorkerStats().then((stats) => stats.queueLength)),
    { timeout: 10_000 },
  ).toBeGreaterThan(0)

  const started = await page.evaluate(() => performance.now())
  await page.getByTestId('organize-file-input').setInputFiles(materials)
  const dialog = page.getByTestId('organize-source-dialog')
  await expect(dialog).toBeVisible()
  const dialogMs = await page.evaluate((value) => performance.now() - value, started)
  const insert = dialog.getByRole('button', { name: '挿入', exact: true })
  await expect(insert).toBeEnabled({ timeout: 10_000 })
  const pageCountsMs = await page.evaluate((value) => performance.now() - value, started)
  console.log(`[organize-insert-dialog] ${JSON.stringify({ dialogMs, pageCountsMs, drawing: path.basename(drawing) })}`)
  expect(dialogMs).toBeLessThanOrEqual(300)
  expect(pageCountsMs).toBeLessThanOrEqual(2_000)
  await dialog.getByRole('button', { name: 'キャンセル' }).click()
})
