import { expect, test, type Page } from '@playwright/test'
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

const panel = (page: Page) => page.getByTestId('fixture-panel')
const components = (page: Page) =>
  page.getByTestId('format-panel')
    .getByRole('region', { name: '構成要素', exact: true })
const picker = (page: Page) =>
  page.getByRole('dialog', { name: '構成要素を追加', exact: true })
const fixtureRow = (page: Page, code: string, name: string) =>
  panel(page).getByRole('button', { name: code + ' ' + name, exact: true })
const componentRow = (page: Page, name: string) =>
  components(page).locator('.route-item').filter({
    has: page.locator('.route-item-identity small').filter({ hasText: name }),
  })

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

async function addFixture(page: Page, code: string, name: string) {
  await panel(page).getByRole('button', { name: '項目を追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await dialog.getByLabel('略号', { exact: true }).fill(code)
  await dialog.getByLabel('規格', { exact: true }).fill('')
  await dialog.getByLabel('名称', { exact: true }).fill(name)
  await dialog.getByRole('radio', { name: '個数', exact: true }).check()
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
}

async function selectMark(page: Page, x: number) {
  await page.getByRole('button', { name: '選択', exact: true }).click()
  await point(page, x, 220)
  await expect(components(page)).toBeVisible()
}

async function addInstallation(page: Page) {
  await components(page).getByRole('button', {
    name: '構成要素を追加', exact: true,
  }).click()
  await expect(picker(page).getByLabel('構成要素を検索', {
    exact: true,
  })).toBeFocused()
  await picker(page).getByLabel('構成要素を検索', { exact: true }).fill('機器据付')
  const section = picker(page).locator('section').filter({
    has: page.getByRole('heading', { name: 'この PDF の項目', exact: true }),
  })
  await section.getByRole('button', { name: 'I', exact: true })
    .filter({ has: page.getByTitle('機器据付', { exact: true }) }).click()
  await expect(picker(page)).toHaveCount(0)
}

async function expectTotal(page: Page, code: string, name: string, value: string) {
  await expect(fixtureRow(page, code, name)
    .locator('..').locator('.fixture-row-count').last()).toHaveText(value)
}

async function setup(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes =>
    window.__karu!.openBytes(bytes, '機器別構成要素.pdf'), blankPdf())
  await page.evaluate(() => window.__karu!.setZoom(1))
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await expect(panel(page).getByRole('button', {
    name: '項目を追加', exact: true,
  })).toBeEnabled()
  await addFixture(page, 'B', 'ボイラー')
  await addFixture(page, 'T', '冷却塔')
  await addFixture(page, 'I', '機器据付')

  await fixtureRow(page, 'B', 'ボイラー').click()
  await point(page, 100, 220)
  await fixtureRow(page, 'T', '冷却塔').click()
  await point(page, 280, 220)
}

test('counts boiler and cooling-tower installation separately and restores additions with Ctrl+Z', async ({ page }) => {
  await setup(page)
  await selectMark(page, 100)
  await addInstallation(page)
  await expect(componentRow(page, '機器据付（ボイラー B）')).toHaveCount(1)
  await expectTotal(page, 'I', '機器据付（ボイラー B）', '1')

  await selectMark(page, 280)
  await addInstallation(page)
  await expect(componentRow(page, '機器据付（冷却塔 T）')).toHaveCount(1)
  await expectTotal(page, 'I', '機器据付（ボイラー B）', '1')
  await expectTotal(page, 'I', '機器据付（冷却塔 T）', '1')
  await expect(fixtureRow(page, 'I', '機器据付')).toHaveCount(1)

  await page.keyboard.press('Control+z')
  await selectMark(page, 280)
  await expect(componentRow(page, '機器据付（冷却塔 T）')).toHaveCount(0)
  await expect(fixtureRow(page, 'I', '機器据付（冷却塔 T）')).toHaveCount(0)
  await expectTotal(page, 'I', '機器据付（ボイラー B）', '1')

  await page.keyboard.press('Control+y')
  await selectMark(page, 280)
  await expect(componentRow(page, '機器据付（冷却塔 T）')).toHaveCount(1)
  await expectTotal(page, 'I', '機器据付（冷却塔 T）', '1')
})
