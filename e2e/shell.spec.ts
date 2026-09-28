import path from 'node:path'
import mupdf from 'mupdf'
import { expect, test, type Page } from '@playwright/test'

const sample = path.resolve('test-data/sample-small.pdf')

function makeTwoPagePdf(): number[] {
  const document = new mupdf.PDFDocument()
  try {
    for (let index = 0; index < 2; index += 1) {
      const page = document.addPage([0, 0, 300, 400], 0, {}, `BT /Times-Roman 18 Tf 40 80 Td (Document B page ${index + 1}) Tj ET`)
      try { document.insertPage(-1, page) } finally { page.destroy() }
    }
    const buffer = document.saveToBuffer('compress')
    try { return Array.from(buffer.asUint8Array()) } finally { buffer.destroy() }
  } finally {
    document.destroy()
  }
}

async function waitForPage(page: Page, pageIndex = 0): Promise<void> {
  await expect(page.locator(`.page-view[data-page-index="${pageIndex}"]`)).toBeVisible()
  await expect.poll(() => page.evaluate((index) => window.__karu!.getEditableAnnotations(index).length, pageIndex)).toBeGreaterThanOrEqual(0)
}

async function createText(page: Page, text: string): Promise<void> {
  const layer = page.getByTestId('annotation-layer-0')
  await page.getByRole('button', { name: '文字', exact: true }).click()
  await layer.click({ position: { x: 120, y: 100 } })
  await page.getByTestId('text-editor').fill(text)
  await page.keyboard.press('Control+Enter')
  await expect(page.getByTestId('text-editor')).toBeHidden()
}

async function saveBytes(page: Page): Promise<number[]> {
  return page.evaluate(async () => {
    const bytes = await window.__karu!.saveToBytes()
    if (!bytes) throw new Error('保存結果がありません。')
    return Array.from(bytes)
  })
}

test('2文書をタブで開き、保存後も書き込みを文書ごとに分離する', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(sample)
  await waitForPage(page)
  await createText(page, '文書Aだけ')
  const savedA = await saveBytes(page)

  await page.evaluate(async (bytes) => window.__karu!.openBytes(bytes, 'second.pdf'), makeTwoPagePdf())
  await expect.poll(() => page.evaluate(() => window.__karu!.listTabs().length)).toBe(2)
  await expect(page.getByText('1 / 2')).toBeVisible()
  await waitForPage(page)
  await createText(page, '文書Bだけ')
  const savedB = await saveBytes(page)

  const originalIds = await page.evaluate(() => window.__karu!.listTabs().map((tab) => tab.docId))
  for (const docId of originalIds) await page.evaluate((id) => window.__karu!.closeTab(id), docId)
  await expect(page.getByTestId('start-screen')).toBeVisible()

  await page.evaluate(async (bytes) => window.__karu!.openBytes(bytes, 'reopen-a.pdf'), savedA)
  await waitForPage(page)
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).map((item) => item.text))).toContain('文書Aだけ')
  expect(await page.evaluate(() => window.__karu!.getEditableAnnotations(0).some((item) => item.text === '文書Bだけ'))).toBe(false)

  await page.evaluate(async (bytes) => window.__karu!.openBytes(bytes, 'reopen-b.pdf'), savedB)
  await waitForPage(page)
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).map((item) => item.text))).toContain('文書Bだけ')
  expect(await page.evaluate(() => window.__karu!.getEditableAnnotations(0).some((item) => item.text === '文書Aだけ'))).toBe(false)
})

test('ページ一覧の3ページ目で本体を移動する', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(sample)
  await waitForPage(page)
  await page.getByTestId('thumbnail-2').click()
  await expect(page.getByText('3 / 5')).toBeVisible()
})

test('書式パネルの青・3ptと文字14ptを作成と保存へ反映する', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(sample)
  await waitForPage(page)
  const layer = page.getByTestId('annotation-layer-0')
  const box = await layer.boundingBox()
  if (!box) throw new Error('注釈レイヤーがありません。')

  await page.getByRole('button', { name: '四角', exact: true }).click()
  await page.getByTestId('format-panel').getByRole('button', { name: '青' }).click()
  await page.getByLabel('線の太さ').selectOption('3')
  await page.mouse.move(box.x + 250, box.y + 220)
  await page.mouse.down()
  await page.mouse.move(box.x + 350, box.y + 300)
  await page.mouse.up()

  await page.getByTestId('annotation-layer-0').click({ position: { x: 30, y: 30 } })
  await page.getByLabel('文字の大きさ').selectOption('14')
  await createText(page, '十四ポイント')
  await expect.poll(() => page.evaluate(() => {
    const items = window.__karu!.getEditableAnnotations(0)
    return {
      square: items.some((item) => item.kind === 'square' && item.borderWidth === 3 && item.color[2] === 1),
      text: items.some((item) => item.text === '十四ポイント' && item.fontSize === 14),
    }
  })).toEqual({ square: true, text: true })

  const saved = await saveBytes(page)
  const docId = await page.evaluate(() => window.__karu!.listTabs()[0].docId)
  await page.evaluate((id) => window.__karu!.closeTab(id), docId)
  await page.evaluate(async (bytes) => window.__karu!.openBytes(bytes, 'format-roundtrip.pdf'), saved)
  await waitForPage(page)
  await expect.poll(() => page.evaluate(() => {
    const items = window.__karu!.getEditableAnnotations(0)
    return {
      square: items.some((item) => item.kind === 'square' && item.borderWidth === 3 && item.color[2] === 1),
      text: items.some((item) => item.text === '十四ポイント' && item.fontSize === 14),
    }
  })).toEqual({ square: true, text: true })
})

test('同じファイルは重複せず、全タブを閉じると開始画面へ戻る', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(sample)
  await page.getByTestId('file-input').setInputFiles(sample)
  await expect.poll(() => page.evaluate(() => window.__karu!.listTabs().length)).toBe(1)
  const docId = await page.evaluate(() => window.__karu!.listTabs()[0].docId)
  await page.evaluate((id) => window.__karu!.closeTab(id), docId)
  await expect(page.getByTestId('start-screen')).toBeVisible()
})
