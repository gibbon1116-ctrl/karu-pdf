import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import { listAnnotations } from '../src/core/annotations'
import { readCountFixtures } from '../src/core/countFixtures'

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

const panel = (page: Page) => page.getByTestId('fixture-panel')
const format = (page: Page) => page.getByTestId('format-panel')
const components = (page: Page) =>
  format(page).getByRole('region', { name: '構成要素', exact: true })
const picker = (page: Page) =>
  page.getByRole('dialog', { name: '構成要素を追加', exact: true })
const fixtureRow = (page: Page, code: string, name: string) =>
  panel(page).getByRole('button', { name: code + ' ' + name, exact: true })
const boxRow = (page: Page) =>
  components(page).locator('.route-item').filter({ hasText: 'スイッチボックス' })
const boxTotal = (page: Page) =>
  panel(page).getByRole('button', { name: /^SB\b.*スイッチボックス$/ })
    .locator('..').locator('.fixture-row-count').last()

async function point(page: Page, x: number, y: number) {
  const layer = page.getByTestId('annotation-layer-0')
  const position = await layer.evaluate((element, value) => {
    const svg = element as SVGSVGElement
    const rect = svg.getBoundingClientRect()
    return {
      x: value.x * rect.width / svg.viewBox.baseVal.width,
      y: value.y * rect.height / svg.viewBox.baseVal.height,
    }
  }, { x, y })
  await layer.click({ position })
}

async function open(page: Page, bytes = blankPdf()) {
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(value => window.__karu!.openBytes(value, '個数の構成要素.pdf'), bytes)
  await page.evaluate(() => window.__karu!.setZoom(1))
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await expect(panel(page).getByRole('button', { name: '項目を追加', exact: true })).toBeEnabled()
}

async function addFixture(page: Page, code: string, name: string) {
  await panel(page).getByRole('button', { name: '項目を追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await dialog.getByLabel('略号', { exact: true }).fill(code)
  await dialog.getByLabel('規格', { exact: true }).fill('')
  await dialog.getByLabel('名称', { exact: true }).fill(name)
  await dialog.getByRole('radio', { name: '個数', exact: true }).check()
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
}

async function selectCount(page: Page, x = 100, y = 220) {
  await page.getByRole('button', { name: '選択', exact: true }).click()
  await point(page, x, y)
  await expect(components(page)).toBeVisible()
}

// Undo/Redo clears the selection (same as routes); select the first mark again to see its components.
async function history(page: Page, key: 'Control+z' | 'Control+y') {
  await page.keyboard.press(key)
  await selectCount(page)
}

async function setup(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await open(page)
  await addFixture(page, 'S', 'スイッチ')
  await fixtureRow(page, 'S', 'スイッチ').click()
  await point(page, 100, 220)
  await selectCount(page)
}

async function openPicker(page: Page) {
  await components(page).getByRole('button', { name: '構成要素を追加', exact: true }).click()
  await expect(picker(page).getByLabel('構成要素を検索', { exact: true })).toBeFocused()
}

async function addSuggestedBox(page: Page) {
  await openPicker(page)
  const section = picker(page).locator('section').filter({
    has: page.getByRole('heading', { name: 'よく組み合わせる', exact: true }),
  })
  const candidate = section.getByRole('button').filter({ hasText: 'スイッチボックス' })
  await expect(candidate).toHaveCount(1)
  await candidate.click()
  await expect(picker(page)).toHaveCount(0)
  await expect(boxRow(page)).toHaveCount(1)
  return (await boxRow(page).locator('.route-item-identity strong').innerText()).trim()
}

const marks = (page: Page) => page.evaluate(() =>
  window.__karu!.getEditableAnnotations(0).flatMap(annotation =>
    annotation.count?.version === 2 && !annotation.quantity
      ? [{ annotationId: annotation.id, count: annotation.count }]
      : []))

async function saveBytes(page: Page) {
  return page.evaluate(async () => [...(await window.__karu!.saveToBytes())!])
}

test('構成要素の候補、個数Undo、引継ぎ、一括反映、施工条件、削除、保存と検索Enter', async ({ page }) => {
  await setup(page)
  await expect(components(page).getByText('1種類', { exact: true })).toBeVisible()
  await expect(components(page).locator('.route-item-main')).toContainText('S')
  await expect(components(page).getByRole('button', {
    name: '同じ項目の印すべてにこの構成を反映（1 個）', exact: true,
  })).toBeDisabled()

  const code = await addSuggestedBox(page)
  expect(code).toMatch(/^SB\b/)
  await expect(components(page).getByText('2種類', { exact: true })).toBeVisible()
  await expect(boxRow(page).getByLabel(code + 'の個数', { exact: true })).toHaveValue('1')
  await expect(components(page).getByRole('status')).toHaveText(`${code} を足しました（1個）`)
  await expect(boxTotal(page)).toHaveText('1')
  await expect(components(page).getByRole('button', { name: code + 'を主にする', exact: true })).toHaveCount(0)

  await boxRow(page).getByRole('button', { name: code + 'の個数を増やす', exact: true }).click()
  await expect(boxTotal(page)).toHaveText('2')
  await history(page, 'Control+z')
  await expect(boxRow(page).getByLabel(code + 'の個数', { exact: true })).toHaveValue('1')
  await expect(boxTotal(page)).toHaveText('1')

  await fixtureRow(page, 'S', 'スイッチ').click()
  await point(page, 200, 300)
  await selectCount(page, 200, 300)
  await expect(boxRow(page)).toHaveCount(1)
  await expect(boxRow(page).getByLabel(code + 'の個数', { exact: true })).toHaveValue('1')
  await expect(boxTotal(page)).toHaveText('2')
  expect((await marks(page)).map(mark => mark.count.extra?.[0].count)).toEqual([1, 1])

  await selectCount(page)
  await boxRow(page).getByRole('button', { name: code + 'の個数を増やす', exact: true }).click()
  await expect(boxTotal(page)).toHaveText('3')
  await components(page).getByRole('button', {
    name: '同じ項目の印すべてにこの構成を反映（2 個）', exact: true,
  }).click()
  await expect(components(page).getByRole('status')).toHaveText(
    '2 個の印を同じ構成にしました（Ctrl+Z で戻せます）')
  await expect(boxTotal(page)).toHaveText('4')
  await history(page, 'Control+z')
  await expect(boxTotal(page)).toHaveText('3')
  expect((await marks(page)).map(mark => mark.count.extra?.[0].count)).toEqual([2, 1])

  const condition = boxRow(page).getByLabel(code + 'の施工条件', { exact: true })
  await expect(condition.locator('option[value="exclude"]')).toHaveCount(0)
  await condition.selectOption({ label: '隠ぺい（埋込）' })
  expect((await marks(page))[0].count.extra?.[0].condition).toBe('隠ぺい（埋込）')

  await boxRow(page).getByRole('button', { name: code + 'を外す', exact: true }).click()
  await expect(boxRow(page)).toHaveCount(0)
  await expect(components(page).getByRole('status')).toHaveText(
    `${code} を外しました（Ctrl+Z で戻せます）`)
  await expect(boxTotal(page)).toHaveText('1')
  await history(page, 'Control+z')
  await expect(boxRow(page)).toHaveCount(1)
  await expect(boxTotal(page)).toHaveText('3')

  const before = (await marks(page)).map(mark => mark.count)
  const bytes = await saveBytes(page)
  const doc = new mupdf.PDFDocument(new Uint8Array(bytes))
  try {
    const saved = listAnnotations(doc, 0).flatMap(annotation =>
      annotation.count?.version === 2 ? [annotation.count] : [])
    expect(saved).toHaveLength(2)
    expect(saved.every(mark => mark.extra?.length === 1)).toBe(true)
    for (const count of before) {
      expect(saved.find(mark => mark.id === count.id)).toEqual(JSON.parse(JSON.stringify(count)))
    }
    expect(readCountFixtures(doc).some(fixture =>
      fixture.code === 'SB' && fixture.name === 'スイッチボックス')).toBe(true)
  } finally { doc.destroy() }

  await open(page, bytes)
  await selectCount(page)
  await expect(boxTotal(page)).toHaveText('3')
  await expect(boxRow(page).getByLabel(code + 'の個数', { exact: true })).toHaveValue('2')
  await expect(boxRow(page).getByLabel(code + 'の施工条件', { exact: true }))
    .toHaveValue('value:隠ぺい（埋込）')

  await openPicker(page)
  const search = picker(page).getByLabel('構成要素を検索', { exact: true })
  await search.fill('プルボックス')
  const master = picker(page).locator('section').filter({
    has: page.getByRole('heading', { name: '標準マスタ', exact: true }),
  })
  await expect(master.getByRole('button').first()).toBeVisible()
  await expect(master).toContainText('プルボックス')
  await expect(picker(page).getByRole('heading', { name: 'よく組み合わせる', exact: true })).toHaveCount(0)
  await search.press('Enter')
  await expect(picker(page)).toHaveCount(0)
  await expect(components(page).locator('.route-item').filter({ hasText: 'プルボックス' })).toHaveCount(1)
  expect((await marks(page))[0].count.extra).toHaveLength(2)
  expect((await marks(page))[0].count.extra?.[1].count).toBe(1)
})

test('外側クリック、Esc、追加済み、検索の上下操作、個数入力と幅', async ({ page }) => {
  await setup(page)
  const code = await addSuggestedBox(page)

  await openPicker(page)
  await components(page).getByText('構成要素', { exact: true }).click()
  await expect(picker(page)).toHaveCount(0)
  await openPicker(page)
  await page.keyboard.press('Escape')
  await expect(picker(page)).toHaveCount(0)

  await openPicker(page)
  const section = picker(page).locator('section').filter({
    has: page.getByRole('heading', { name: 'よく組み合わせる', exact: true }),
  })
  await expect(section.getByRole('button', { name: code + ' 追加済み', exact: true })).toBeDisabled()
  await expect(picker(page).getByRole('button', { name: 'S', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')

  const input = boxRow(page).getByLabel(code + 'の個数', { exact: true })
  await expect(boxRow(page).getByRole('button', { name: code + 'の個数を減らす', exact: true })).toBeDisabled()
  await input.fill('99')
  await input.press('Enter')
  await expect(boxRow(page).getByRole('button', { name: code + 'の個数を増やす', exact: true })).toBeDisabled()
  await input.fill('0')
  await input.press('Enter')
  await expect(input).toHaveValue('99')
  await input.fill('100')
  await input.press('Enter')
  await expect(input).toHaveValue('99')
  await input.fill('2')
  await components(page).getByText('構成要素', { exact: true }).click()
  await expect(input).toHaveValue('2')
  await input.focus()
  await input.hover()
  await page.mouse.wheel(0, -100)
  await expect(input).toHaveValue('2')
  expect((await marks(page))[0].count.extra?.[0].count).toBe(2)
  await components(page).getByText('構成要素', { exact: true }).click()
  await history(page, 'Control+z')
  await expect(input).toHaveValue('99')

  await addFixture(page, 'X1', 'キーボード試験項目1')
  await addFixture(page, 'X2', 'キーボード試験項目2')
  await selectCount(page)
  await openPicker(page)
  const search = picker(page).getByLabel('構成要素を検索', { exact: true })
  await search.fill('キーボード試験項目')
  const pdf = picker(page).locator('section').filter({
    has: page.getByRole('heading', { name: 'この PDF の項目', exact: true }),
  })
  await expect(pdf.getByRole('button', { name: 'X1', exact: true })).toBeVisible()
  await expect(pdf.getByRole('button', { name: 'X2', exact: true })).toBeVisible()
  await search.press('ArrowDown')
  await search.press('ArrowDown')
  await search.press('ArrowUp')
  await search.press('Enter')
  await expect(picker(page)).toHaveCount(0)
  // X2 was created last, so it heads 最近使った and is the first candidate (same as 線要素を追加).
  await expect(components(page).getByRole('button', { name: 'X2を外す', exact: true })).toBeVisible()

  expect(await format(page).evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  expect(await components(page).evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
})

test('主の施工条件の初期値、条件追加の原子的Undoと記憶', async ({ page }) => {
  await setup(page)
  const mainCondition = format(page).getByLabel('施工条件', { exact: true })
  await mainCondition.selectOption('add')
  await format(page).getByLabel('施工条件の新しい条件', { exact: true }).fill('隠ぺい（埋込）')
  await format(page).getByRole('button', { name: '追加', exact: true }).click()

  const code = await addSuggestedBox(page)
  const condition = boxRow(page).getByLabel(code + 'の施工条件', { exact: true })
  await expect(condition).toHaveValue('value:隠ぺい（埋込）')
  await condition.selectOption('add')
  await boxRow(page).getByLabel(code + 'の施工条件の新しい条件', { exact: true }).fill('試験条件')
  await boxRow(page).getByRole('button', { name: '追加', exact: true }).click()
  await expect(condition).toHaveValue('value:試験条件')
  expect((await marks(page))[0].count.extra?.[0].condition).toBe('試験条件')

  await history(page, 'Control+z')
  await expect(condition).toHaveValue('value:隠ぺい（埋込）')
  await expect(condition.locator('option[value="value:試験条件"]')).toHaveCount(0)
  expect((await marks(page))[0].count.extra?.[0].condition).toBe('隠ぺい（埋込）')
  await history(page, 'Control+y')
  await expect(condition).toHaveValue('value:試験条件')

  await boxRow(page).getByRole('button', { name: code + 'を外す', exact: true }).click()
  await addSuggestedBox(page)
  await expect(boxRow(page).getByLabel(code + 'の施工条件', { exact: true })).toHaveValue('value:試験条件')
  await expect(mainCondition).toHaveValue('value:隠ぺい（埋込）')
})

test('構成要素10件の上限', async ({ page }) => {
  await setup(page)
  for (let index = 0; index < 11; index++) {
    await addFixture(page, 'C' + index, '上限試験項目' + index)
  }
  await selectCount(page)

  for (let index = 0; index < 10; index++) {
    await openPicker(page)
    await picker(page).getByLabel('構成要素を検索', { exact: true }).fill('上限試験項目' + index)
    const pdf = picker(page).locator('section').filter({
      has: page.getByRole('heading', { name: 'この PDF の項目', exact: true }),
    })
    await pdf.getByRole('button', { name: 'C' + index, exact: true }).click()
    await expect(picker(page)).toHaveCount(0)
  }

  await expect(components(page).getByText('11種類', { exact: true })).toBeVisible()
  await expect(components(page).locator('.route-item')).toHaveCount(11)
  const add = components(page).getByRole('button', { name: '構成要素を追加', exact: true })
  await expect(add).toBeDisabled()
  await expect(add).toHaveAttribute('title', 'これ以上足せません（最大 10 項目）')
  expect((await marks(page))[0].count.extra).toHaveLength(10)

  await components(page).getByRole('button', { name: 'C0を外す', exact: true }).click()
  await expect(add).toBeEnabled()
  await history(page, 'Control+z')
  await expect(add).toBeDisabled()
})
