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

test('ページ整理をドラッグ・回転・削除・白紙挿入し、保存と復元ができる', async ({ page }) => {
  await openSample(page)
  const original = await pageInfo(page)
  await page.getByRole('button', { name: 'ページ整理', exact: true }).click()
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
  await page.getByRole('button', { name: '右に回転' }).click()
  await page.getByTestId('organize-card-3').click()
  await page.getByRole('button', { name: '削除', exact: true }).click()
  await page.getByTestId('organize-card-3').click()
  await page.getByRole('button', { name: '白紙を挿入' }).click()
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
  await page.getByRole('button', { name: 'ページ整理', exact: true }).click()
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
