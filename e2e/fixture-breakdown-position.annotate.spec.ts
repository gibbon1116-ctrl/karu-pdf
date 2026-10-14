import { expect, test, type Locator, type Page } from '@playwright/test'
import mupdf from 'mupdf'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('karu-pdf:fixture-panel-settings-open', 'true'))
})

function blankPdf() {
  const doc = new mupdf.PDFDocument()
  try {
    const ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
    try { doc.insertPage(-1, ref) } finally { ref.destroy() }
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { doc.destroy() }
}

async function open(page: Page) {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '内訳書の位置.pdf'), blankPdf())
  await page.evaluate(() => window.__karu!.setZoom(1))
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await expect(page.getByTestId('fixture-panel')
    .getByRole('button', { name: '項目を追加', exact: true })).toBeEnabled()
}

async function optionValues(select: Locator) {
  return select.locator('option').evaluateAll(options =>
    options.map(option => (option as HTMLOptionElement).value).filter(value => value !== ''))
}

test('項目の内訳書位置は候補選択と自由入力の両方を保存する', async ({ page }) => {
  await page.goto('/')
  await open(page)

  await page.getByTestId('fixture-panel')
    .getByRole('button', { name: '項目を追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await dialog.getByLabel('略号', { exact: true }).fill('R6D')
  await dialog.getByLabel('規格', { exact: true }).fill('')
  await dialog.getByLabel('名称', { exact: true }).fill('内訳書位置の候補試験')
  await dialog.getByRole('radio', { name: '個数', exact: true }).check()
  await dialog.locator('details.fixture-breakdown summary').click()

  await dialog.getByLabel('編', { exact: true }).selectOption('電気設備')
  const sectionChoices = dialog.getByLabel('種目の候補', { exact: true })
  await expect(sectionChoices).toBeEnabled()
  await expect(sectionChoices.locator('option').filter({ hasText: '庁舎' })).toHaveCount(1)
  await sectionChoices.selectOption('庁舎')

  const subjectChoices = dialog.getByLabel('科目の候補', { exact: true })
  const middleChoices = dialog.getByLabel('中科目の候補', { exact: true })
  const itemChoices = dialog.getByLabel('細目の候補', { exact: true })
  await expect(subjectChoices).toBeEnabled()

  const subjectOptions = await optionValues(subjectChoices)
  let subjectWithMiddle: {
    subject: string
    middle: string
    items: string[]
    filteredItems: string[]
  } | undefined
  let alternateSubject: { subject: string; items: string[] } | undefined

  for (const subject of subjectOptions) {
    await dialog.getByLabel('中科目', { exact: true }).fill('')
    await dialog.getByLabel('細目', { exact: true }).fill('')
    await subjectChoices.selectOption(subject)
    const items = await optionValues(itemChoices)
    const middleOptions = await optionValues(middleChoices)

    for (const middle of middleOptions) {
      await middleChoices.selectOption(middle)
      const filteredItems = await optionValues(itemChoices)
      if (items.length > 0 && filteredItems.length > 0 &&
          JSON.stringify(items) !== JSON.stringify(filteredItems) && !subjectWithMiddle) {
        subjectWithMiddle = { subject, middle, items, filteredItems }
      }
      await dialog.getByLabel('中科目', { exact: true }).fill('')
    }

    if (subjectWithMiddle && subject !== subjectWithMiddle.subject &&
        JSON.stringify(items) !== JSON.stringify(subjectWithMiddle.items) && !alternateSubject) {
      alternateSubject = { subject, items }
    }
    if (subjectWithMiddle && alternateSubject) break
  }

  expect(subjectWithMiddle).toBeDefined()
  expect(alternateSubject).toBeDefined()

  await dialog.getByLabel('中科目', { exact: true }).fill('')
  await subjectChoices.selectOption(alternateSubject!.subject)
  const alternateItems = await optionValues(itemChoices)
  expect(alternateItems).toEqual(alternateSubject!.items)
  expect(alternateItems).not.toEqual(subjectWithMiddle!.items)

  await subjectChoices.selectOption(subjectWithMiddle!.subject)
  await middleChoices.selectOption(subjectWithMiddle!.middle)
  const filteredItems = await optionValues(itemChoices)
  expect(filteredItems).toEqual(subjectWithMiddle!.filteredItems)
  expect(filteredItems).not.toEqual(subjectWithMiddle!.items)

  const freeText = '自由入力の細目'
  await dialog.getByLabel('細目', { exact: true }).fill(freeText)
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  await expect(dialog).toBeHidden()

  // 項目は PDF（文書のストア）に保存される。
  await expect.poll(async () => (await page.evaluate(() => window.__karu!.getCountFixtures()))
    .find(fixture => fixture.name === '内訳書位置の候補試験')?.breakdown?.item).toBe(freeText)
})
