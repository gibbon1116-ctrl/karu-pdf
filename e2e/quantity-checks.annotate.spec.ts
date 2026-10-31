import { expect, test, type Locator, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import { fixtureCode, type CountFixture } from '../src/core/countFixtures'

const panel = (page: Page) => page.getByTestId('fixture-panel')
const fixtureRow = (page: Page, fixture: CountFixture) =>
  panel(page).getByRole('button', {
    name: `${fixtureCode(fixture)} ${fixture.name}`.trim(), exact: true,
  })
const fixtureLi = (page: Page, fixture: CountFixture) =>
  fixtureRow(page, fixture).locator('..')
const total = (page: Page, fixture: CountFixture) =>
  fixtureLi(page, fixture).locator('.fixture-total-button')

const concreteName = '普通コンクリート（軸部）'

function blankPdf() {
  const doc = new mupdf.PDFDocument()
  try {
    const ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
    try { doc.insertPage(-1, ref) } finally { ref.destroy() }
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { doc.destroy() }
}

async function click(page: Page, x: number, y: number) {
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

async function breakdownDialog(page: Page) {
  await panel(page).getByRole('button', {
    name: '標準マスタから追加', exact: true,
  }).click()
  const dialog = page.getByRole('dialog', {
    name: '標準マスタから追加', exact: true,
  })
  await dialog.getByRole('tab', { name: '内訳書から選ぶ', exact: true }).click()
  await expect(dialog.getByRole('group', { name: '内訳書の編', exact: true })
    .getByRole('button', { name: '建築', exact: true })).toBeEnabled()
  return dialog
}

async function buildingGroup(dialog: Locator, subject: string) {
  await dialog.getByLabel('内訳書を検索', { exact: true }).fill('')
  await dialog.getByRole('group', { name: '内訳書の編', exact: true })
    .getByRole('button', { name: '建築', exact: true }).click()
  await dialog.getByRole('group', { name: '内訳書の種目', exact: true })
    .getByRole('button', { name: '庁舎', exact: true }).click()
  await dialog.getByRole('group', { name: '内訳書の科目', exact: true })
    .getByRole('button', { name: subject, exact: true }).click()
  await dialog.getByRole('group', { name: '内訳書の中科目', exact: true })
    .getByRole('button', { name: '躯体', exact: true }).click()
  await expect(dialog.getByRole('heading', {
    name: '躯体の細目', exact: true,
  })).toBeVisible()
}

async function chooseConcreteSummary(dialog: Locator, label: string, value: string) {
  const valueBox = dialog.getByRole('checkbox', {
    name: `${concreteName}の${label} ${value}`, exact: true,
  })
  if (await valueBox.count()) {
    await valueBox.check()
    return
  }
  const select = dialog.getByRole('combobox', { name: label, exact: true })
  if (await select.count()) {
    await select.selectOption({ label: value })
    return
  }
  const group = dialog.getByRole('group', { name: label, exact: true })
  const checkbox = group.getByRole('checkbox', { name: value, exact: true })
  if (await checkbox.count()) {
    await checkbox.check()
    return
  }
  await group.getByRole('button', { name: value, exact: true }).click()
}

async function fixtureNamed(page: Page, name: string) {
  const fixtures = await page.evaluate(() => window.__karu!.getCountFixtures())
  const fixture = fixtures.find(item => item.name === name)
  expect(fixture).toBeDefined()
  return fixture!
}

async function setScale(page: Page) {
  await click(page, 60, 80)
  const dialog = page.getByRole('dialog', {
    name: '縮尺の設定（1 ページ）', exact: true,
  })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('縮尺の分母', { exact: true }).fill('100')
  await dialog.getByRole('button', { name: '決定', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

const pointsForMeters = (meters: number) => meters * 1000 * 72 / (25.4 * 100)

async function rectangle(page: Page) {
  const x = 100, y = 120
  const width = pointsForMeters(4), height = pointsForMeters(3)
  await click(page, x, y)
  await click(page, x + width, y)
  await click(page, x + width, y + height)
  await click(page, x, y + height)
  await page.keyboard.press('Enter')
}

const aggregateTable = (page: Page) =>
  page.getByRole('region', { name: '数量の集計表', exact: true })

async function openAggregateTable(page: Page) {
  const openButton = page.getByRole('button', {
    name: '集計表を開く', exact: true,
  })
  if (await openButton.count()) await openButton.click()
  await expect(aggregateTable(page)).toBeVisible()
  await expect(aggregateTable(page).getByRole('table', {
    name: '数量の集計', exact: true,
  })).toBeVisible()
}

async function openCheckSheet(page: Page) {
  const button = page.getByRole('button', { name: 'チェックシート', exact: true })
  if (await button.getAttribute('aria-pressed') !== 'true') await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await expect(aggregateTable(page).getByRole('region', {
    name: 'チェックシート', exact: true,
  })).toBeVisible()
  await expect(aggregateTable(page).getByRole('table', {
    name: '数量の集計', exact: true,
  })).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('karu-pdf:fixture-panel-settings-open', 'true')
    localStorage.setItem('karu-pdf:quantity-table-checks', 'false')
    localStorage.removeItem('karu-pdf:quantity-table-check-column')
  })
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes =>
    window.__karu!.openBytes(bytes, '数量チェック試験.pdf'), blankPdf())
  await page.evaluate(() => window.__karu!.setZoom(1))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await expect(panel(page).getByRole('button', {
    name: '標準マスタから追加', exact: true,
  })).toBeEnabled()
  await expect(panel(page).getByText(
    '数量拾いを読み込んでいます…', { exact: true },
  )).toHaveCount(0)
})

test('建築の項目がない文書にはチェック列とボタンを表示しない', async ({ page }) => {
  const fixtures = await page.evaluate(() => window.__karu!.getCountFixtures())
  expect(fixtures.some(fixture => fixture.breakdown?.book === '建築')).toBe(false)

  await openAggregateTable(page)
  const region = aggregateTable(page)
  await expect(region.getByRole('columnheader', {
    name: 'チェック', exact: true,
  })).toHaveCount(0)
  await expect(region.getByRole('button', {
    name: 'チェック', exact: true,
  })).toHaveCount(0)
  await expect(region.getByRole('button', {
    name: 'チェックシート', exact: true,
  })).toHaveCount(0)
  await expect(region.locator('.quantity-table-check-cell')).toHaveCount(0)
})

test('コンクリート数量チェックの判定、Undo、PDF保存と再読込', async ({ page }) => {
  test.setTimeout(180_000)

  const before = await page.evaluate(() => window.__karu!.getCountFixtures().length)
  const dialog = await breakdownDialog(page)
  await buildingGroup(dialog, 'コンクリート')
  await dialog.getByRole('checkbox', {
    name: `${concreteName}（㎥）`, exact: true,
  }).check()
  await chooseConcreteSummary(dialog, '強度', '24')
  await chooseConcreteSummary(dialog, 'スランプ', '18')
  await dialog.getByRole('button', {
    name: '選んだ項目を追加（1件）', exact: true,
  }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(async () => page.evaluate(() =>
    window.__karu!.getCountFixtures().length)).toBe(before + 1)

  const concrete = await fixtureNamed(page, concreteName)
  await fixtureRow(page, concrete).click()
  await panel(page).getByRole('button', { name: '編集', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '項目を編集', exact: true })
  await expect(editor).toBeVisible()
  await editor.getByLabel('深さ（新しく拾うときの初期値）', {
    exact: true,
  }).fill('0.15')
  await editor.getByRole('button', { name: '変更する', exact: true }).click()
  await expect(editor).toHaveCount(0)

  await fixtureRow(page, concrete).click()
  await setScale(page)
  await rectangle(page)
  await expect(total(page, concrete)).toHaveText('1.80')

  await openAggregateTable(page)
  const quantityTable = aggregateTable(page).getByRole('table', {
    name: '数量の集計', exact: true,
  })
  const checkColumnButton = aggregateTable(page).getByRole('button', {
    name: 'チェック', exact: true,
  })
  const quantityRow = quantityTable.locator(
    `tbody tr[data-fixture-id="${concrete.id}"]:not([data-condition])`,
  )
  const checkCell = quantityRow.locator('td.quantity-table-check-cell')

  await expect(checkColumnButton).toHaveAttribute('aria-pressed', 'true')
  await expect(quantityTable.getByRole('columnheader').last()).toHaveText('チェック')
  await expect(checkCell).toContainText('コンクリート総量: 基本の値なし')
  await expect(checkCell).toHaveAttribute('title', /チェック項目：/)
  await expect(checkCell).toHaveAttribute('title', /内訳数量（合計）：1\.80 ㎥/)
  await expect(checkCell).toHaveAttribute('title', /判定の範囲：/)
  await expect(aggregateTable(page).getByRole('region', {
    name: 'チェックシート', exact: true,
  })).toHaveCount(0)

  await openCheckSheet(page)
  const checksPanel = aggregateTable(page).getByRole('region', {
    name: 'チェックシート', exact: true,
  })
  const panelBounds = await checksPanel.boundingBox()
  const tableBounds = await aggregateTable(page).boundingBox()
  expect(panelBounds).not.toBeNull()
  expect(tableBounds).not.toBeNull()
  expect(panelBounds!.height).toBeLessThanOrEqual(tableBounds!.height / 2 + 1)

  const sheet = page.getByRole('table', {
    name: '躯体の数量チェック', exact: true,
  })
  const concreteRow = sheet.getByRole('rowheader', {
    name: 'コンクリート総量', exact: true,
  }).locator('..')
  const verdict = concreteRow.locator('td').nth(3)
  const area = page.getByLabel('延べ面積', { exact: true })

  await area.fill('2')
  await area.press('Enter')
  await expect(area).toHaveValue('2')
  await expect(verdict).toHaveText('OK')
  await expect(quantityTable).toBeVisible()
  await expect(checkCell).toContainText('コンクリート総量: OK')

  await area.fill('10')
  await area.press('Enter')
  await expect(area).toHaveValue('10')
  await expect(verdict).toHaveText('範囲外')
  await expect(concreteRow).toHaveClass(/(?:^|\s)quantity-check-out(?:\s|$)/)
  await expect(quantityTable).toBeVisible()
  const outLine = checkCell.getByText('コンクリート総量: 範囲外', { exact: true })
  await expect(outLine).toHaveClass(/(?:^|\s)quantity-check-out(?:\s|$)/)
  await expect(outLine).toHaveCSS('color', 'rgb(130, 27, 22)')

  await area.focus()
  await page.keyboard.press('Control+z')
  await expect(area).toHaveValue('2')
  await expect(verdict).toHaveText('OK')
  await expect(concreteRow).not.toHaveClass(/quantity-check-out/)
  await expect(checkCell).toContainText('コンクリート総量: OK')
  await expect(checkCell.getByText('コンクリート総量: OK', {
    exact: true,
  })).not.toHaveClass(/quantity-check-out/)

  const bytes = await page.evaluate(async () =>
    [...(await window.__karu!.saveToBytes())!],
  )
  await page.evaluate(saved =>
    window.__karu!.openBytes(saved, '数量チェック保存確認.pdf'), bytes)
  await page.evaluate(() => window.__karu!.setZoom(1))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await expect(fixtureRow(page, concrete)).toBeVisible()
  await expect(panel(page).getByText(
    '数量拾いを読み込んでいます…', { exact: true },
  )).toHaveCount(0)
  await expect(total(page, concrete)).toHaveText('1.80')

  await openAggregateTable(page)
  await openCheckSheet(page)
  await expect(page.getByLabel('延べ面積', { exact: true })).toHaveValue('2')
  await expect(quantityTable).toBeVisible()
  await expect(checkCell).toContainText('コンクリート総量: OK')

  const checkSheetButton = page.getByRole('button', {
    name: 'チェックシート', exact: true,
  })
  await checkSheetButton.click()
  await expect(checkSheetButton).toHaveAttribute('aria-pressed', 'false')
  await expect(aggregateTable(page)).toBeVisible()
  await expect(quantityTable).toBeVisible()
  await expect(checksPanel).toHaveCount(0)

  await checkColumnButton.click()
  await expect(checkColumnButton).toHaveAttribute('aria-pressed', 'false')
  await expect(quantityTable.getByRole('columnheader', {
    name: 'チェック', exact: true,
  })).toHaveCount(0)
  await expect(checkCell).toHaveCount(0)

  await aggregateTable(page).getByRole('button', {
    name: '集計表を閉じる', exact: true,
  }).click()
  await expect(aggregateTable(page)).toHaveCount(0)
  await openAggregateTable(page)
  await expect(checkColumnButton).toHaveAttribute('aria-pressed', 'false')
  await expect(checkSheetButton).toHaveAttribute('aria-pressed', 'false')
  await expect(quantityTable.getByRole('columnheader', {
    name: 'チェック', exact: true,
  })).toHaveCount(0)

  await checkColumnButton.click()
  await expect(checkColumnButton).toHaveAttribute('aria-pressed', 'true')
  await expect(quantityTable.getByRole('columnheader').last()).toHaveText('チェック')
  await expect(checkCell).toContainText('コンクリート総量: OK')
})
