import { expect, test, type Locator, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import mupdf from 'mupdf'
import { quantityUnit, readCountFixtures } from '../src/core/countFixtures'

test.use({ serviceWorkers: 'block' })

function blankPdf() {
  const doc = new mupdf.PDFDocument(), ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
  try {
    doc.insertPage(-1, ref)
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { ref.destroy(); doc.destroy() }
}

async function open(page: Page, pdfBytes = blankPdf()) {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '内訳書マスタ試験.pdf'), pdfBytes)
  await page.evaluate(() => window.__karu!.setZoom(1))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await expect(page.getByTestId('fixture-panel').getByRole('button', { name: '標準マスタから追加', exact: true })).toBeEnabled()
  await expect(page.getByText('数量拾いを読み込んでいます…', { exact: true })).toHaveCount(0)
}

async function breakdownDialog(page: Page) {
  await page.getByRole('button', { name: '標準マスタから追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '標準マスタから追加', exact: true })
  await expect(dialog.getByRole('tab', { name: '規格から選ぶ', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByRole('tab')).toHaveText(['規格から選ぶ', '内訳書から選ぶ'])
  const tab = dialog.getByRole('tab', { name: '内訳書から選ぶ', exact: true })
  await expect(tab).toHaveAttribute('id', 'quantity-master-breakdown-tab')
  await expect(tab).toHaveAttribute('aria-controls', 'quantity-master-breakdown-panel')
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  const panel = dialog.getByRole('tabpanel', { name: '内訳書から選ぶ', exact: true })
  await expect(panel).toHaveAttribute('id', 'quantity-master-breakdown-panel')
  await expect(panel).toHaveAttribute('aria-labelledby', 'quantity-master-breakdown-tab')
  await expect(dialog.getByRole('group', { name: '内訳書の編', exact: true })
    .getByRole('button', { name: '電気設備', exact: true })).toBeEnabled()
  return dialog
}

async function savedFixtures(page: Page) {
  const bytes = await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!])
  const doc = new mupdf.PDFDocument(new Uint8Array(bytes))
  try { return readCountFixtures(doc) } finally { doc.destroy() }
}

test('SPEC-U2b: 規格タブでまとめた開閉器箱の内訳書位置を選ぶ', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '標準マスタから追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '標準マスタから追加', exact: true })

  await dialog.getByRole('group', { name: '標準マスタの分野', exact: true })
    .getByRole('button', { name: '電気設備', exact: true }).click()
  await dialog.getByRole('group', { name: '標準マスタの分類', exact: true })
    .getByRole('button', { name: '盤類', exact: true }).click()
  await dialog.getByRole('searchbox').fill('開閉器箱')

  const chooser = dialog.locator('.catalog-chooser').filter({ hasText: '開閉器箱' })
  await expect(chooser).toHaveCount(1)
  const option = chooser.getByRole('checkbox').first()
  await option.check()
  await chooser.getByRole('textbox').first().fill('P-1')

  const position = chooser.getByLabel('開閉器箱の内訳書の行', { exact: true })
  const positionValue = await position.locator('option').evaluateAll(options => {
    const choice = options.find(candidate =>
      candidate.textContent?.trim().startsWith('動力設備 › ')
      && candidate.textContent.trim().endsWith('開閉器箱'),
    ) as HTMLOptionElement | undefined
    return choice?.value ?? null
  })
  expect(positionValue).not.toBeNull()
  await position.selectOption(positionValue!)

  await dialog.getByRole('button', { name: '選んだ項目を追加（1件）', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.__karu!.getCountFixtures().length)).toBe(1)
  const fixtures = await savedFixtures(page)
  expect(fixtures).toHaveLength(1)
  expect(fixtures[0].breakdown?.subject).toBe('動力設備')
})

test('SPEC-U5: 内訳書タブから追加した据付費の対象を名称・摘要・集計表に示す', async ({ page }) => {
  await open(page)
  const dialog = await breakdownDialog(page)

  await dialog.getByRole('group', { name: '内訳書の編', exact: true })
    .getByRole('button', { name: '電気設備', exact: true }).click()
  await dialog.getByRole('group', { name: '内訳書の種目', exact: true })
    .getByRole('button', { name: '庁舎', exact: true }).click()
  await dialog.getByRole('group', { name: '内訳書の科目', exact: true })
    .getByRole('button', { name: '発電設備', exact: true }).click()
  await dialog.getByRole('group', { name: '内訳書の中科目', exact: true })
    .getByRole('button', { name: '自家発電（原動機）', exact: true }).click()

  const lumpSum = dialog.getByRole('checkbox', { name: '据付費（式）', exact: true })
  await expect(lumpSum).toBeVisible()
  await lumpSum.check()
  await dialog.getByRole('button', { name: '選んだ項目を追加（1件）', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.__karu!.getCountFixtures().length)).toBe(1)
  const fixtures = await savedFixtures(page)
  expect(fixtures).toHaveLength(1)
  expect(quantityUnit(fixtures[0])).toBe('式')
  expect(fixtures[0].name).toBe('据付費（自家発電（原動機））')
  expect(fixtures[0].summary?.[0]).toEqual({
    label: '対象',
    value: '発電設備 自家発電（原動機）',
  })
  expect(fixtures[0].breakdown).toMatchObject({
    book: '電気設備',
    section: '庁舎',
    subject: '発電設備',
    middle: '自家発電（原動機）',
    item: '据付費',
  })

  await page.getByRole('button', { name: '集計表を開く', exact: true }).click()
  const table = page.getByRole('region', { name: '数量の集計表', exact: true })
  await expect(table.getByText('据付費（自家発電（原動機））', { exact: true }).first()).toBeVisible()
})
