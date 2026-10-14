import { expect, test, type Locator, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import mupdf from 'mupdf'
import { quantityUnit, readCountFixtures } from '../src/core/countFixtures'
import { writePageScale } from '../src/core/measure'
import { catalogItems, representativeBreakdownPosition } from '../src/core/catalog'

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
  await expect(page.getByTestId('fixture-panel').getByText('数量拾いを読み込んでいます…', { exact: true })).toHaveCount(0)
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

async function lightingGroup(dialog: Locator, middle: string) {
  await dialog.getByLabel('内訳書を検索', { exact: true }).fill('')
  await dialog.getByRole('group', { name: '内訳書の編', exact: true })
    .getByRole('button', { name: '電気設備', exact: true }).click()
  await dialog.getByRole('group', { name: '内訳書の種目', exact: true })
    .getByRole('button', { name: '庁舎', exact: true }).click()
  await dialog.getByRole('group', { name: '内訳書の科目', exact: true })
    .getByRole('button', { name: '電灯設備', exact: true }).click()
  await dialog.getByRole('group', { name: '内訳書の中科目', exact: true })
    .getByRole('button', { name: middle, exact: true }).click()
  await expect(dialog.getByRole('heading', { name: `${middle}の細目`, exact: true })).toBeVisible()
}

function distributionBoardRow(dialog: Locator) {
  return dialog.locator('.breakdown-row').filter({
    has: dialog.page().getByRole('checkbox', { name: '分電盤（面）', exact: true }),
  })
}

function conduitRow(dialog: Locator) {
  return dialog.locator('.breakdown-row').filter({
    has: dialog.page().getByText('電線管', { exact: true }),
  }).first()
}

async function selectE25(row: Locator) {
  await row.getByRole('button', { name: /^明細を選ぶ（\d+）$/ }).click()
  const type = row.getByRole('button', { name: /の種類 E$/ })
  await type.click()
  await expect(type).toHaveAttribute('aria-expanded', 'true')
  await row.getByRole('checkbox', { name: 'E25 ねじなし電線管（長さ・m）', exact: true }).check()
}

async function savedFixtures(page: Page) {
  const bytes = await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!])
  const doc = new mupdf.PDFDocument(new Uint8Array(bytes))
  try { return readCountFixtures(doc) } finally { doc.destroy() }
}

test('adds multiple rows with summaries and excludes already added identities', async ({ page }) => {
  await open(page)
  let dialog = await breakdownDialog(page)
  await lightingGroup(dialog, '電灯分岐')
  let row = distributionBoardRow(dialog)
  await row.getByRole('checkbox', { name: '分電盤（面）', exact: true }).check()
  await row.getByLabel('分電盤の盤名称のほかの値', { exact: true }).fill(' L-1 、 L-2 ')
  await dialog.getByRole('button', { name: '選んだ項目を追加（2件）', exact: true }).click()

  const panel = page.getByTestId('fixture-panel')
  await expect(panel.locator('li[data-fixture-id]')).toHaveCount(2)
  await expect(panel.getByRole('button', { name: 'L-1 分電盤', exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'L-2 分電盤', exact: true })).toBeVisible()

  const fixtures = await savedFixtures(page)
  expect(fixtures).toHaveLength(2)
  for (const code of ['L-1', 'L-2']) {
    const fixture = fixtures.find(fixture => fixture.code === code)
    expect(fixture).toBeDefined()
    expect(fixture!.unit).toBe('面')
    expect(fixture!.breakdown).toEqual({
      book: '電気設備',
      section: '庁舎',
      subject: '電灯設備',
      middle: '電灯分岐',
      item: '分電盤',
    })
    expect(fixture!.summary).toEqual([{ label: '盤名称', value: code }])
  }

  dialog = await breakdownDialog(page)
  await lightingGroup(dialog, '電灯分岐')
  row = distributionBoardRow(dialog)
  const checkbox = row.getByRole('checkbox', { name: '分電盤（面）', exact: true })
  await checkbox.check()
  await row.getByLabel('分電盤の盤名称のほかの値', { exact: true }).fill('L-1')
  await expect(row.getByText('追加済み', { exact: true })).toBeVisible()
  await expect(checkbox).toBeChecked()
  await expect(checkbox).toBeEnabled()
  await expect(dialog.getByRole('button', { name: '選んだ項目を追加（0件）', exact: true })).toBeDisabled()

  await row.getByLabel('分電盤の盤名称のほかの値', { exact: true }).fill('L-1、L-3,L-3，L-3')
  await expect(dialog.getByRole('button', { name: '選んだ項目を追加（1件）', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
})

test('adds the same detail specification at two different breakdown positions', async ({ page }) => {
  await open(page)
  let dialog = await breakdownDialog(page)
  await lightingGroup(dialog, '電灯幹線')
  let row = conduitRow(dialog)
  await selectE25(row)
  await dialog.getByRole('button', { name: '選んだ項目を追加（1件）', exact: true }).click()

  dialog = await breakdownDialog(page)
  await dialog.getByLabel('内訳書を検索', { exact: true }).fill('動力幹線 電線管')
  row = conduitRow(dialog)
  await expect(row).toBeVisible()
  await expect(row.locator('.breakdown-location')).toContainText('動力幹線／')
  await selectE25(row)
  await expect(row.getByText('追加済み', { exact: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: '選んだ項目を追加（1件）', exact: true }).click()
  // Adding is asynchronous; wait for the second item before saving.
  await expect.poll(async () => (await page.evaluate(() => window.__karu!.getCountFixtures())).filter(fixture => fixture.code === 'E25').length).toBe(2)

  const fixtures = await savedFixtures(page)
  const conduits = fixtures.filter(fixture => fixture.code === 'E25')
  expect(conduits).toHaveLength(2)
  expect(conduits.map(fixture => fixture.breakdown?.middle).sort()).toEqual(['動力幹線', '電灯幹線'])
  expect(conduits.every(fixture => fixture.kind === 'length' && fixture.method === 'polyline')).toBe(true)
  expect(conduits.every(fixture => fixture.breakdown?.item === '電線管')).toBe(true)
})

test('searches rows and exposes the standard summary choices', async ({ page }) => {
  await open(page)
  const dialog = await breakdownDialog(page)
  await dialog.getByLabel('内訳書を検索', { exact: true }).fill('煙感知器')
  await expect(dialog.getByRole('group', { name: '内訳書の編', exact: true })).toHaveCount(0)

  const row = dialog.locator('.breakdown-row').filter({
    has: dialog.page().getByRole('checkbox', { name: /^煙感知器（.+）$/ }),
  }).first()
  await expect(row).toBeVisible()
  await row.getByRole('checkbox', { name: /^煙感知器（.+）$/ }).check()
  const input = row.getByRole('checkbox', { name: '煙感知器の形式 光電式スポット型2種', exact: true })
  await expect(input).toBeVisible()
  await expect(row.locator('datalist')).toHaveCount(0)

  await input.check()
  await dialog.getByLabel('内訳書を検索', { exact: true }).fill('存在しない細目')
  await expect(dialog.getByText('該当する細目がありません。', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '選んだ項目を追加（1件）', exact: true })).toBeEnabled()
  await dialog.getByLabel('内訳書を検索', { exact: true }).fill('')
  await expect(dialog.getByRole('group', { name: '内訳書の編', exact: true })).toBeVisible()
  await dialog.getByLabel('内訳書を検索', { exact: true }).fill('煙感知器')
  await expect(row.getByRole('checkbox', { name: /^煙感知器（.+）$/ })).toBeChecked()
  await expect(input).toBeChecked()

  await input.uncheck()
  const other = row.getByLabel('煙感知器の形式のほかの値', { exact: true })
  await other.fill('あ'.repeat(61))
  await expect(dialog.getByRole('alert')).toContainText('摘要は8区分まで')
  await expect(dialog.getByRole('button', { name: /^選んだ項目を追加（\d+件）$/ })).toBeDisabled()
  await other.fill('')
  await input.check()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: '選んだ項目を追加（1件）', exact: true })).toBeEnabled()
})

test('loads the unified catalog and breakdown data only when the master dialog is opened', async ({ page }) => {
  const requests: string[] = [], bodies: Array<{ url: string; text: string }> = [], reads: Promise<void>[] = []
  page.on('request', request => {
    if (request.resourceType() === 'script') requests.push(request.url())
  })
  page.on('response', response => {
    if (response.request().resourceType() === 'script') {
      reads.push(response.text().then(text => { bodies.push({ url: response.url(), text }) }))
    }
  })

  await open(page)
  await page.waitForLoadState('networkidle')
  await Promise.all(reads)
  expect(bodies.filter(body =>
    body.text.includes('組合せが100件を超えます。選ぶ値を減らしてください。'),
  )).toHaveLength(0)

  const before = requests.length
  await page.getByRole('button', { name: '標準マスタから追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '標準マスタから追加', exact: true })
  await expect(dialog.getByRole('checkbox').first()).toBeVisible()
  await page.waitForLoadState('networkidle')
  await Promise.all(reads)
  expect(bodies.filter(body =>
    body.text.includes('組合せが100件を超えます。選ぶ値を減らしてください。'),
  )).toHaveLength(1)

  await dialog.getByRole('tab', { name: '内訳書から選ぶ', exact: true }).click()
  await expect(dialog.getByRole('group', { name: '内訳書の編', exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await Promise.all(reads)
  const masterResponses = bodies.filter(body =>
    body.text.includes('組合せが100件を超えます。選ぶ値を減らしてください。'),
  )
  expect(masterResponses).toHaveLength(1)
  expect(requests.slice(before)).toContain(masterResponses[0].url)
  expect(requests.length).toBeGreaterThan(before)
})

test('exports a counted distribution board from the breakdown master to the item sheet', async ({ page }) => {
  test.setTimeout(120_000)
  await page.addInitScript(() => { delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker })
  await open(page)
  const dialog = await breakdownDialog(page)
  await lightingGroup(dialog, '電灯分岐')
  const boardRow = distributionBoardRow(dialog)
  await boardRow.getByRole('checkbox', { name: '分電盤（面）', exact: true }).check()
  await boardRow.getByLabel('分電盤の盤名称のほかの値', { exact: true }).fill('L-1')
  await dialog.getByRole('button', { name: '選んだ項目を追加（1件）', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  const panel = page.getByTestId('fixture-panel')
  await panel.getByRole('button', { name: 'L-1 分電盤', exact: true }).click()
  const fixture = (await savedFixtures(page)).find(f => f.code === 'L-1')!
  expect(fixture).toBeDefined()
  const layer = page.getByTestId('annotation-layer-0')
  await layer.click({ position: { x: 100, y: 100 } })
  await layer.click({ position: { x: 200, y: 100 } })
  await expect.poll(() => page.evaluate(fixtureId =>
    window.__karu!.getEditableAnnotations(0).filter(annotation =>
      annotation.count?.version === 2 && annotation.count.fixtureId === fixtureId).length,
  fixture.id)).toBe(2)

  await page.getByRole('button', { name: '集計表を開く', exact: true }).click()
  const table = page.getByRole('region', { name: '数量の集計表', exact: true })
  await expect(table).toBeVisible()
  const download = page.waitForEvent('download')
  await table.getByRole('button', { name: 'Excelに書き出す', exact: true }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('内訳書マスタ試験_数量集計表.xlsx')
  const bytes = await fs.readFile(await file.path())
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK')

  const files = new Map<string, string>()
  let offset = 0
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    expect(bytes.readUInt16LE(offset + 8)).toBe(0)
    const size = bytes.readUInt32LE(offset + 18)
    const nameLength = bytes.readUInt16LE(offset + 26)
    const extraLength = bytes.readUInt16LE(offset + 28)
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8')
    const start = offset + 30 + nameLength + extraLength
    files.set(name, bytes.subarray(start, start + size).toString('utf8'))
    offset = start + size
  }
  const workbook = files.get('xl/workbook.xml')!
  const sheet = workbook.match(/<sheet name="細目別内訳" sheetId="(\d+)"/)
  expect(sheet).not.toBeNull()
  expect(workbook).toContain('<calcPr fullCalcOnLoad="1"/>')
  const unescape = (value: string) => value.replace(/&#13;/g, '\r')
    .replace(/&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
  const strings = [...files.get('xl/sharedStrings.xml')!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
    .map(match => unescape(match[1]))
  const sheetXml = files.get(`xl/worksheets/sheet${sheet![1]}.xml`)!
  const rows = [...sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(match => {
    const values = new Map<string, string | number | null>()
    for (const cell of match[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const column = cell[1].match(/\br="([A-Z]+)\d+"/)![1]
      const value = cell[2]?.match(/<v>([^<]*)<\/v>/)?.[1]
      values.set(column, value === undefined ? null
        : /\bt="s"/.test(cell[1]) ? strings[Number(value)] : Number(value))
    }
    return values
  })
  const boards = rows.filter(row => row.get('A') === '分電盤')
  expect(boards).toHaveLength(1)
  expect(boards[0].get('B')).toBe('L-1')
  expect(boards[0].get('C')).toBe(2)
  expect(boards[0].get('D')).toBe('面')
  expect(sheetXml).toMatch(/<f>IF\(E\d+=&quot;&quot;,&quot;&quot;,C\d+\*E\d+\)<\/f>/)
  await expect(table.getByRole('button', { name: 'Excelに書き出す', exact: true })).toBeEnabled()
  await expect(table.getByRole('alert')).toHaveCount(0)
})

test('adds E25 pipe painting to only the rise of a cable route and displays square metres', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const doc = new mupdf.PDFDocument(new Uint8Array(blankPdf()))
  let bytes: number[]
  try {
    const pdfPage = doc.loadPage(0)
    try {
      writePageScale(doc, pdfPage, {
        denominator: 100, paper: 'PDF', source: 'ratio',
        mmPerPoint: 25.4 / 72 * 100, unit: 'm', decimals: 2,
      })
    } finally { pdfPage.destroy() }
    const buffer = doc.saveToBuffer('compress')
    try { bytes = [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { doc.destroy() }

  await open(page, bytes)
  const dialog = await breakdownDialog(page)
  await lightingGroup(dialog, '電灯幹線')
  const paintingRow = dialog.locator('.breakdown-row').filter({
    has: page.getByText('塗装工事', { exact: true }),
  }).first()
  await paintingRow.getByRole('button', { name: /^明細を選ぶ（\d+）$/ }).click()
  await paintingRow.getByRole('checkbox', { name: 'E25塗装 配管塗装（㎡）', exact: true }).check()
  const paintChoice = paintingRow.getByRole('checkbox', { name: '配管塗装の塗料 SOP', exact: true })
  if (await paintChoice.count()) {
    await paintChoice.check()
  } else {
    const other = paintingRow.getByLabel('配管塗装の塗料のほかの値', { exact: true })
    const input = await other.count() ? other : paintingRow.getByLabel('配管塗装の塗料', { exact: true })
    await input.fill('SOP')
  }
  await dialog.getByRole('button', { name: '選んだ項目を追加（1件）', exact: true }).click()

  const panel = page.getByTestId('fixture-panel')
  await panel.getByRole('button', { name: '項目を追加', exact: true }).click()
  const fixtureDialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await fixtureDialog.getByLabel('略号', { exact: true }).fill('EM-CE')
  await fixtureDialog.getByLabel('規格', { exact: true }).fill('5.5sq-3C')
  await fixtureDialog.getByLabel('名称', { exact: true }).fill('ケーブル')
  await fixtureDialog.getByRole('radio', { name: '長さ', exact: true }).check()
  await fixtureDialog.getByRole('button', { name: '追加する', exact: true }).click()
  await panel.getByRole('button', { name: 'EM-CE 5.5sq-3C ケーブル', exact: true }).click()

  const layer = page.getByTestId('annotation-layer-0')
  const point = async (x: number, y: number) => {
    const position = await layer.evaluate((element, p) => {
      const svg = element as SVGSVGElement, rect = svg.getBoundingClientRect()
      return {
        x: p.x * rect.width / svg.viewBox.baseVal.width,
        y: p.y * rect.height / svg.viewBox.baseVal.height,
      }
    }, { x, y })
    await layer.click({ position })
  }
  await point(100, 220)
  await point(172, 220)
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: '選択', exact: true }).click()
  await point(136, 220)

  const format = page.getByTestId('format-panel')
  await expect(format.getByText('経路構成', { exact: true })).toBeVisible()
  await format.getByRole('button', { name: '線要素を追加', exact: true }).click()
  const picker = page.getByRole('dialog', { name: '線要素を追加', exact: true })
  await picker.getByLabel('線要素を検索', { exact: true }).fill('E25塗装')
  const pdfItems = picker.locator('section').filter({
    has: page.getByRole('heading', { name: 'この PDF の項目', exact: true }),
  })
  await pdfItems.getByRole('button', { name: 'E25塗装 E25', exact: true }).click()
  await expect(picker).toHaveCount(0)

  const rise = format.getByLabel('立上り・立下り1', { exact: true })
  if (await rise.count() === 0) {
    await format.getByRole('button', { name: '＋ 立上り・立下りを足す', exact: true }).click()
  }
  await rise.fill('2')
  await rise.blur()

  const routeItem = format.locator('.route-item').filter({
    has: page.locator('.route-item-identity strong').filter({ hasText: /^E25塗装 E25$/ }),
  })
  await routeItem.getByLabel('平面', { exact: true }).selectOption('exclude')
  await routeItem.getByLabel('立上り', { exact: true }).selectOption('add')
  await routeItem.getByLabel('立上りの新しい条件', { exact: true }).fill('立上り')
  await routeItem.getByRole('button', { name: '追加', exact: true }).click()
  await expect(routeItem.locator('.route-item-length')).toContainText('（≒ 0.16 ㎡）')

  const fixtures = await savedFixtures(page)
  const paint = fixtures.find(fixture => fixture.code === 'E25塗装')!
  expect(paint.kind).toBe('length')
  expect(paint.convert?.unit).toBe('㎡')
  const paintRow = panel.locator(`li[data-fixture-id="${paint.id}"]`)
  await expect(paintRow.locator('.fixture-row-unit')).toHaveText('㎡')
  await expect(paintRow.locator('.fixture-row > .fixture-row-count')).toHaveText('0.16')
  await expect(paintRow.locator('.fixture-total-button')).toHaveText('0.16')
  await expect(layer.locator('text').filter({ hasText: 'E25塗装' }).first()).toBeVisible()
  await expect.poll(() => page.evaluate(() =>
    window.__karu!.getEditableAnnotations(0).find(annotation => annotation.quantity)?.text ?? '',
  )).toContain('E25塗装')

  await page.getByRole('button', { name: '集計表を開く', exact: true }).click()
  const table = page.getByRole('region', { name: '数量の集計表', exact: true })
  const tableRow = table.locator(`tr[data-fixture-id="${paint.id}"]`).first()
  await expect(tableRow.locator('.quantity-table-fixed-4')).toHaveText('㎡')
  await expect(tableRow.locator('.quantity-table-fixed-5 button')).toHaveText('0.16')
})

test('stacks both catalog tabs without horizontal scrolling at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page)
  const dialog = await breakdownDialog(page)
  await lightingGroup(dialog, '電灯分岐')
  const row = distributionBoardRow(dialog)
  await row.getByRole('checkbox', { name: '分電盤（面）', exact: true }).check()
  await row.getByLabel('分電盤の盤名称のほかの値', { exact: true }).fill('L-1、L-2')

  const breakdownPanel = dialog.getByRole('tabpanel', { name: '内訳書から選ぶ', exact: true })
  const boxes = await breakdownPanel.locator('.quantity-master-navigation, .quantity-master-specs').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom, left: rect.left }
  }))
  expect(boxes).toHaveLength(5)
  for (let index = 1; index < boxes.length; index++) {
    expect(boxes[index].top).toBeGreaterThanOrEqual(boxes[index - 1].bottom)
    expect(boxes[index].left).toBe(boxes[0].left)
  }
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)

  await lightingGroup(dialog, '電灯幹線')
  await selectE25(conduitRow(dialog))
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)

  await dialog.getByRole('tab', { name: '規格から選ぶ', exact: true }).click()
  const specPanel = dialog.getByRole('tabpanel', { name: '規格から選ぶ', exact: true })
  const specBoxes = await specPanel.locator('.quantity-master-navigation, .quantity-master-specs').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom, left: rect.left }
  }))
  expect(specBoxes).toHaveLength(4)
  for (let index = 1; index < specBoxes.length; index++) {
    expect(specBoxes[index].top).toBeGreaterThanOrEqual(specBoxes[index - 1].bottom)
    expect(specBoxes[index].left).toBe(specBoxes[0].left)
  }
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await dialog.getByLabel('標準マスタを検索', { exact: true }).fill('分電盤')
  await dialog.getByRole('checkbox', { name: '分電盤（面）', exact: true }).check()
  await dialog.getByLabel('分電盤の盤名称のほかの値', { exact: true }).fill('L-1、L-2')
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
})

test('recognizes E25 added from specifications at the same breakdown position', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '標準マスタから追加', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: '標準マスタから追加', exact: true })
  await expect(dialog.getByLabel('位置の編', { exact: true })).toHaveValue('')
  for (const label of ['位置の種目', '位置の科目', '位置の中科目']) {
    await expect(dialog.getByLabel(label, { exact: true })).toBeDisabled()
  }
  await dialog.getByLabel('位置の編', { exact: true }).selectOption('電気設備')
  await dialog.getByLabel('位置の種目', { exact: true }).selectOption('庁舎')
  await dialog.getByLabel('位置の科目', { exact: true }).selectOption('電灯設備')
  await dialog.getByLabel('位置の中科目', { exact: true }).selectOption('電灯幹線')
  await dialog.getByLabel('標準マスタを検索', { exact: true }).fill('E25')
  await dialog.getByRole('checkbox', { name: 'E25 ねじなし電線管（長さ・m）', exact: true }).check()
  await dialog.getByRole('button', { name: '選んだ項目を追加（1件）', exact: true }).click()

  dialog = await breakdownDialog(page)
  await lightingGroup(dialog, '電灯幹線')
  const row = conduitRow(dialog)
  await row.getByRole('button', { name: /^明細を選ぶ（\d+）$/ }).click()
  await row.getByRole('button', { name: /の種類 E$/ }).click()
  const option = row.getByRole('checkbox', { name: 'E25 ねじなし電線管（長さ・m）', exact: true })
  await expect(option).toBeChecked()
  await expect(option).toBeDisabled()
  await expect(option.locator('..').getByText('追加済み', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '選んだ項目を追加（0件）', exact: true })).toBeDisabled()

  await dialog.getByRole('tab', { name: '規格から選ぶ', exact: true }).click()
  await expect(dialog.getByLabel('位置の編', { exact: true })).toHaveValue('電気設備')
  await expect(dialog.getByLabel('位置の種目', { exact: true })).toHaveValue('庁舎')
  await expect(dialog.getByLabel('位置の科目', { exact: true })).toHaveValue('電灯設備')
  await expect(dialog.getByLabel('位置の中科目', { exact: true })).toHaveValue('電灯幹線')
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click()

  const panel = page.getByTestId('fixture-panel')
  await expect(panel.locator('li[data-fixture-id]')).toHaveCount(1)
  await panel.getByRole('checkbox', { name: '内訳書の構成で表示', exact: true }).uncheck()
  const category = panel.locator('.fixture-groups > section').filter({
    has: page.getByRole('button', { name: '電線管（1）', exact: true }),
  })
  await expect(category.getByRole('button', { name: 'E25 ねじなし電線管', exact: true })).toBeVisible()
  const fixtures = await savedFixtures(page)
  expect(fixtures).toHaveLength(1)
  expect(fixtures[0].category).toBe('電線管')
  expect(fixtures[0].breakdown).toEqual({
    book: '電気設備',
    section: '庁舎',
    subject: '電灯設備',
    middle: '電灯幹線',
    item: '電線管',
  })
})

test('SPEC-B28: 規格のチェックで代表位置を表示し、品目ごとの修正位置で追加する', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await open(page)
  const storageKey = 'karu-pdf:master-breakdown-position'
  const storedBefore = await page.evaluate(key => localStorage.getItem(key), storageKey)

  await page.getByRole('button', { name: '標準マスタから追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '標準マスタから追加', exact: true })
  await expect(dialog.getByRole('tab', { name: '規格から選ぶ', exact: true }))
    .toHaveAttribute('aria-selected', 'true')

  const fields = dialog.getByRole('group', { name: '標準マスタの分野', exact: true })
  await fields.getByRole('button', { name: '電気設備', exact: true }).click()
  await dialog.getByRole('group', { name: '標準マスタの分類', exact: true })
    .getByRole('button', { name: '照明器具', exact: true }).click()
  await dialog.getByRole('searchbox').fill('ダウンライト')

  const dlOption = dialog.getByRole('checkbox', {
    name: 'DL φ150 ＬＥＤ照明器具（個）', exact: true,
  })
  await dlOption.check()
  const dlPosition = {
    book: '電気設備',
    section: '庁舎',
    subject: '電灯設備',
    middle: '電灯分岐',
    item: 'ＬＥＤ照明器具',
  }
  const dlLine = '内訳書: 電気設備 › 庁舎 › 電灯設備 › 電灯分岐 › ＬＥＤ照明器具'
  const dlChooser = dialog.locator('.catalog-chooser').filter({ has: dlOption })
  await expect(dialog.getByRole('button', { name: dlLine, exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: dlLine, exact: true }))
    .toHaveAttribute('aria-pressed', 'true')

  const expectPosition = async (position: {
    book: string; section: string; subject: string; middle?: string;
  }) => {
    await expect(dialog.getByLabel('位置の編', { exact: true })).toHaveValue(position.book)
    await expect(dialog.getByLabel('位置の種目', { exact: true })).toHaveValue(position.section)
    await expect(dialog.getByLabel('位置の科目', { exact: true })).toHaveValue(position.subject)
    await expect(dialog.getByLabel('位置の中科目', { exact: true }))
      .toHaveValue(position.middle ?? '')
  }
  await expectPosition(dlPosition)
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(storedBefore)

  await dialog.getByRole('searchbox').fill('')
  await dialog.getByRole('group', { name: '標準マスタの分類', exact: true })
    .getByRole('button', { name: '電線', exact: true }).click()
  await dialog.getByRole('group', { name: '標準マスタの種類', exact: true })
    .getByRole('button', { name: /^IV（\d+件）$/ }).click()
  const ivItem = catalogItems().find(item =>
    item.key.startsWith('master:') && item.field === '電気設備' && item.type === 'IV',
  )
  expect(ivItem).toBeDefined()
  const ivPosition = representativeBreakdownPosition(ivItem!)
  expect(ivPosition).toBeDefined()

  const ivOption = dialog.getByRole('checkbox', { name: /^IV .+（長さ・m）$/ }).first()
  await ivOption.check()
  await expectPosition(ivPosition!)
  const ivChooser = dialog.locator('.catalog-chooser').filter({ has: ivOption })
  const ivLine = `内訳書: ${[
    ivPosition!.book,
    ivPosition!.section,
    ivPosition!.subject,
    ...(ivPosition!.middle ? [ivPosition!.middle] : []),
    ivPosition!.item,
  ].join(' › ')}`
  await expect(dialog.getByRole('button', { name: ivLine, exact: true })).toBeVisible()
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(storedBefore)

  const middle = dialog.getByLabel('位置の中科目', { exact: true })
  const alternative = await middle.locator('option').evaluateAll((options, current) =>
    options.map(option => (option as HTMLOptionElement).value)
      .find(value => value !== current),
  ivPosition!.middle ?? '')
  expect(alternative).toBeDefined()
  await middle.selectOption(alternative!)
  const changedIvPosition = { ...ivPosition!, middle: alternative! }
  await expectPosition(changedIvPosition)
  const changedIvLine = `内訳書: ${[
    changedIvPosition.book,
    changedIvPosition.section,
    changedIvPosition.subject,
    ...(changedIvPosition.middle ? [changedIvPosition.middle] : []),
    changedIvPosition.item,
  ].join(' › ')}`
  await expect(dialog.getByRole('button', { name: changedIvLine, exact: true })).toBeVisible()
  const storedAfterManual = await page.evaluate(key => localStorage.getItem(key), storageKey)
  expect(JSON.parse(storedAfterManual!)).toEqual({
    book: changedIvPosition.book,
    section: changedIvPosition.section,
    subject: changedIvPosition.subject,
    ...(changedIvPosition.middle ? { middle: changedIvPosition.middle } : {}),
  })

  // 表示を戻して位置の行を押すと、その品目だけが欄の編集対象になる。
  await dialog.getByRole('group', { name: '標準マスタの分類', exact: true })
    .getByRole('button', { name: '照明器具', exact: true }).click()
  await dialog.getByRole('searchbox').fill('ダウンライト')
  await expect(dialog.getByRole('button', { name: dlLine, exact: true })).toBeVisible()
  await expectPosition(changedIvPosition)
  await dialog.getByRole('button', { name: dlLine, exact: true }).click()
  await expectPosition(dlPosition)
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(storedAfterManual)

  // 全解除で位置を忘れ、再チェックで代表位置を選び直す。
  await dialog.getByLabel('位置の編', { exact: true }).selectOption('')
  await expect(dialog.getByRole('button', { name: '内訳書: 付けない', exact: true }))
    .toBeVisible()
  await dlOption.uncheck()
  await expect(dlChooser.locator('.catalog-position-summary')).toHaveCount(0)
  await expectPosition(changedIvPosition)
  await dlOption.check()
  await expectPosition(dlPosition)
  await expect(dialog.getByRole('button', { name: dlLine, exact: true })).toBeVisible()
  // 自動選択で、手動の「付けない」の保存を上書きしない。
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull()

  await dialog.getByRole('button', { name: '選んだ項目を追加（2件）', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.__karu!.getCountFixtures().length)).toBe(2)
  const fixtures = await savedFixtures(page)
  expect(fixtures).toHaveLength(2)
  const dl = fixtures.find(fixture => fixture.code === 'DL')
  const iv = fixtures.find(fixture => fixture.code === 'IV')
  expect(dl).toBeDefined()
  expect(iv).toBeDefined()
  expect(dl!.breakdown).toEqual(dlPosition)
  expect(dl!.spec).toBe('φ150')
  expect(dl!.summary).toEqual([{ label: '記号', value: 'DL' }])
  expect(iv!.breakdown).toEqual(changedIvPosition)
  expect(ivItem!.options.some(option => option.spec === iv!.spec)).toBe(true)
})

test('SPEC-B30: 保存された機械設備の位置にかかわらず舗装の代表位置で追加する', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const storageKey = 'karu-pdf:master-breakdown-position'
  const storedPosition = {
    book: '機械設備',
    section: '庁舎',
    subject: '空気調和設備',
    middle: 'ダクト設備',
  }
  await page.addInitScript(({ key, position }) => {
    localStorage.setItem(key, JSON.stringify(position))
  }, { key: storageKey, position: storedPosition })

  await open(page)
  await page.getByRole('button', { name: '標準マスタから追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '標準マスタから追加', exact: true })
  await expect(dialog.getByRole('tab', { name: '規格から選ぶ', exact: true }))
    .toHaveAttribute('aria-selected', 'true')

  const expectPosition = async (position: {
    book: string; section: string; subject: string; middle?: string;
  }) => {
    await expect(dialog.getByLabel('位置の編', { exact: true })).toHaveValue(position.book)
    await expect(dialog.getByLabel('位置の種目', { exact: true })).toHaveValue(position.section)
    await expect(dialog.getByLabel('位置の科目', { exact: true })).toHaveValue(position.subject)
    await expect(dialog.getByLabel('位置の中科目', { exact: true }))
      .toHaveValue(position.middle ?? '')
  }
  await expectPosition(storedPosition)

  await dialog.getByRole('group', { name: '標準マスタの分野', exact: true })
    .getByRole('button', { name: '建築', exact: true }).click()
  await dialog.getByRole('group', { name: '標準マスタの分類', exact: true })
    .getByRole('button', { name: '外部（面積）', exact: true }).click()
  await dialog.getByRole('group', { name: '標準マスタの種類', exact: true })
    .getByRole('button', { name: /^舗装（\d+件）$/ }).click()

  const specPanel = dialog.getByRole('tabpanel', { name: '規格から選ぶ', exact: true })
  const pavingOption = specPanel.locator('.catalog-options').getByRole('checkbox').first()
  await expect(pavingOption).toBeVisible()
  await pavingOption.check()

  const pavingPosition = {
    book: '建築',
    section: '構内舗装',
    subject: '構内舗装',
    item: 'アスファルト舗装',
  }
  await expectPosition(pavingPosition)
  const positionButton = dialog.getByRole('button', {
    name: '内訳書: 建築 › 構内舗装 › 構内舗装 › アスファルト舗装',
    exact: true,
  })
  await expect(positionButton).toBeVisible()
  await expect(positionButton).toHaveAttribute('aria-pressed', 'true')
  // 代表位置の自動選択は、保存されている手動の位置を上書きしない。
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey))
    .toBe(JSON.stringify(storedPosition))

  await dialog.getByRole('button', { name: '選んだ項目を追加（1件）', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.__karu!.getCountFixtures().length))
    .toBe(1)

  const fixtures = await savedFixtures(page)
  expect(fixtures).toHaveLength(1)
  expect(fixtures[0].breakdown).toEqual(pavingPosition)
  expect(fixtures[0].breakdown).not.toHaveProperty('middle')
})

test('adds a searched distribution board under the board category', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '標準マスタから追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '標準マスタから追加', exact: true })
  await dialog.getByLabel('標準マスタを検索', { exact: true }).fill('分電盤')
  await dialog.getByRole('checkbox', { name: '分電盤（面）', exact: true }).check()
  await dialog.getByLabel('分電盤の盤名称のほかの値', { exact: true }).fill('L-1')
  await dialog.getByRole('button', { name: '選んだ項目を追加（1件）', exact: true }).click()

  const panel = page.getByTestId('fixture-panel')
  await panel.getByRole('checkbox', { name: '内訳書の構成で表示', exact: true }).uncheck()
  const category = panel.locator('.fixture-groups > section').filter({
    has: page.getByRole('button', { name: '盤類（1）', exact: true }),
  })
  await expect(category.getByRole('button', { name: 'L-1 分電盤', exact: true })).toBeVisible()
  const fixtures = await savedFixtures(page)
  expect(fixtures).toHaveLength(1)
  expect(fixtures[0].category).toBe('盤類')
  expect(fixtures[0].unit).toBe('面')
  expect(fixtures[0].summary).toEqual([{ label: '盤名称', value: 'L-1' }])
  const board = catalogItems().find(item =>
    item.key.startsWith('row:') && item.name === '分電盤' && item.unit === '面',
  )
  expect(board).toBeDefined()
  const boardPosition = representativeBreakdownPosition(board!)
  expect(boardPosition).toBeDefined()
  expect(fixtures[0].breakdown).toEqual(boardPosition)
})

test('creates two outlet-box dimensions and keeps construction conditions as candidates', async ({ page }) => {
  await open(page)
  const dialog = await breakdownDialog(page)
  await lightingGroup(dialog, '電灯幹線')
  const row = dialog.locator('.breakdown-row').filter({
    has: dialog.page().getByText('ボックス類', { exact: true }),
  }).first()
  await row.getByRole('button', { name: /^明細を選ぶ（\d+）$/ }).click()
  const chooser = row.locator('.catalog-chooser').filter({
    has: page.getByRole('checkbox', { name: /^アウトレットボックス（.+）$/ }),
  })
  await chooser.getByRole('checkbox', { name: /^アウトレットボックス（.+）$/ }).check()
  await chooser.getByRole('checkbox', { name: 'アウトレットボックスの寸法 中浅形', exact: true }).check()
  await chooser.getByRole('checkbox', { name: 'アウトレットボックスの寸法 中深形', exact: true }).check()
  await expect(chooser.getByText('施工条件の候補: 隠ぺい（埋込）・露出（拾うときに選びます）', { exact: true })).toBeVisible()
  await expect(chooser.getByText('この品目で 2 件追加', { exact: true })).toBeVisible()

  await dialog.getByRole('tab', { name: '規格から選ぶ', exact: true }).click()
  await dialog.getByRole('tab', { name: '内訳書から選ぶ', exact: true }).click()
  await expect(chooser.getByRole('checkbox', { name: 'アウトレットボックスの寸法 中浅形', exact: true })).toBeChecked()
  await expect(chooser.getByRole('checkbox', { name: 'アウトレットボックスの寸法 中深形', exact: true })).toBeChecked()
  await dialog.getByRole('button', { name: '選んだ項目を追加（2件）', exact: true }).click()
  await expect.poll(async () => (await page.evaluate(() => window.__karu!.getCountFixtures())).length).toBe(2)

  const fixtures = await savedFixtures(page)
  expect(fixtures).toHaveLength(2)
  expect(fixtures.every(fixture => fixture.name === 'アウトレットボックス')).toBe(true)
  expect(fixtures.map(fixture => fixture.summary?.find(field => field.label === '寸法')?.value).sort())
    .toEqual(['中浅形', '中深形'].sort())
  for (const fixture of fixtures) {
    expect(fixture.conditions).toEqual(['隠ぺい（埋込）', '露出', '二重床'])
    expect(fixture.summary?.some(field => field.label === '施工')).toBe(false)
    expect(fixture.breakdown?.middle).toBe('電灯幹線')
    expect(fixture.breakdown?.item).toBe('ボックス類')
  }
})

test('adds E25 painting directly from the route catalog search', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await open(page)
  await page.evaluate(field => window.__karu!.addFixturePresets(field), '電気設備')
  const panel = page.getByTestId('fixture-panel')
  await panel.getByRole('button', { name: 'CV ケーブル（CV）', exact: true }).click()
  await page.getByRole('button', { name: '数量拾い', exact: true }).click()

  const layer = page.getByTestId('annotation-layer-0')
  const point = async (x: number, y: number) => {
    const position = await layer.evaluate((element, p) => {
      const svg = element as SVGSVGElement, rect = svg.getBoundingClientRect()
      return {
        x: p.x * rect.width / svg.viewBox.baseVal.width,
        y: p.y * rect.height / svg.viewBox.baseVal.height,
      }
    }, { x, y })
    await layer.click({ position })
  }
  await point(100, 220)
  const scale = page.getByRole('dialog', { name: '縮尺の設定（1 ページ）', exact: true })
  await scale.getByLabel('縮尺の分母').fill('100')
  await scale.getByRole('button', { name: '決定', exact: true }).click()
  await point(100, 220)
  await point(172, 220)
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: '選択', exact: true }).click()
  await point(136, 220)

  const format = page.getByTestId('format-panel')
  await format.getByRole('button', { name: '線要素を追加', exact: true }).click()
  const picker = page.getByRole('dialog', { name: '線要素を追加', exact: true })
  await picker.getByLabel('線要素を検索', { exact: true }).fill('E25塗装')
  const catalog = picker.locator('section').filter({
    has: page.getByRole('heading', { name: '標準マスタ', exact: true }),
  })
  await catalog.getByRole('button', { name: 'E25塗装', exact: true }).click()
  await expect(picker).toHaveCount(0)

  const paint = (await savedFixtures(page)).find(fixture => fixture.code === 'E25塗装')!
  expect(paint).toBeDefined()
  expect(paint.kind).toBe('length')
  expect(paint.method).toBe('polyline')
  expect(paint.convert?.unit).toBe('㎡')
  expect(paint.convert!.factor).toBeGreaterThan(0)
  expect(paint.breakdown).toBeUndefined()
  await expect.poll(() => page.evaluate(id =>
    window.__karu!.getEditableAnnotations(0).some(annotation =>
      annotation.quantity?.extra?.some(item => item.itemId === id)),
  paint.id)).toBe(true)
})

test('fills legacy fixture conditions together and restores them with one undo', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await open(page)
  await page.evaluate(field => window.__karu!.addFixturePresets(field), '電気設備')

  const panel = page.getByTestId('fixture-panel')
  await expect.poll(() => page.evaluate(() =>
    window.__karu!.getCountFixtures().some(fixture =>
      fixture.code === 'DL' && fixture.category === '照明器具'),
  )).toBe(true)

  const dl = await page.evaluate(() =>
    window.__karu!.getCountFixtures().find(fixture =>
      fixture.code === 'DL' && fixture.category === '照明器具')!,
  )
  await panel.locator(`li[data-fixture-id="${dl.id}"] .fixture-row`).click()
  await panel.getByRole('button', { name: '編集', exact: true }).click()
  let editor = page.getByRole('dialog', { name: '項目を編集', exact: true })
  await editor.getByLabel('既定の施工条件', { exact: true }).selectOption('壁付')
  await editor.getByRole('button', { name: '変更する', exact: true }).click()
  await expect(editor).toHaveCount(0)

  const dialog = await breakdownDialog(page)
  await lightingGroup(dialog, '電灯分岐')
  const boardRow = distributionBoardRow(dialog)
  await boardRow.getByRole('checkbox', { name: '分電盤（面）', exact: true }).check()
  await boardRow.getByLabel('分電盤の盤名称のほかの値', { exact: true }).fill('L-1')
  await dialog.getByRole('button', { name: '選んだ項目を追加（1件）', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  // 編集画面で候補を外し、第1版の候補がない分電盤を再現する。
  await panel.getByRole('button', { name: 'L-1 分電盤', exact: true }).click()
  await panel.getByRole('button', { name: '編集', exact: true }).click()
  editor = page.getByRole('dialog', { name: '項目を編集', exact: true })
  const conditions = editor.locator('.fixture-conditions')
  await expect(conditions.getByRole('button', { name: '削除', exact: true })).toHaveCount(3)
  for (let remaining = 3; remaining > 0; remaining--) {
    await conditions.getByRole('button', { name: '削除', exact: true }).first().click()
    await expect(conditions.getByRole('button', { name: '削除', exact: true }))
      .toHaveCount(remaining - 1)
  }
  await editor.getByRole('button', { name: '変更する', exact: true }).click()
  await expect(editor).toHaveCount(0)

  const before = await page.evaluate(() => window.__karu!.getCountFixtures())
  const board = before.find(fixture => fixture.code === 'L-1' && fixture.name === '分電盤')!
  const originalDl = before.find(fixture => fixture.id === dl.id)!
  expect(board.conditions).toEqual([])
  expect(originalDl.conditions).toEqual([
    '天井直付', '天井埋込', '壁付', '吊下げ', '床置・据置',
  ])
  expect(originalDl.defaultCondition).toBe('壁付')

  await panel.getByRole('button', { name: 'L-1 分電盤', exact: true }).click()
  await page.getByRole('button', { name: '数量拾い', exact: true }).click()
  const layer = page.getByTestId('annotation-layer-0')
  await layer.click({ position: { x: 120, y: 120 } })
  await expect.poll(() => page.evaluate(id =>
    window.__karu!.getEditableAnnotations(0).filter(annotation =>
      annotation.count?.version === 2 && annotation.count.fixtureId === id).length,
  board.id)).toBe(1)
  await page.getByRole('button', { name: '選択', exact: true }).click()
  await layer.click({ position: { x: 120, y: 120 } })

  const format = page.getByTestId('format-panel')
  await expect(format).toBeVisible()
  const wallOption = format.locator('select option').filter({ hasText: /^壁掛$/ })
  await expect(wallOption).toHaveCount(0)

  const settings = panel.locator('details.fixture-panel-settings')
  if (!await settings.evaluate(element => (element as HTMLDetailsElement).open)) {
    await settings.locator('summary').click()
  }
  const fill = settings.getByRole('button', {
    name: 'すべての項目に標準の施工条件の候補を入れる', exact: true,
  })
  await fill.click()
  await expect.poll(() => page.evaluate(id =>
    window.__karu!.getCountFixtures().find(fixture => fixture.id === id)?.conditions,
  board.id)).toEqual(['壁掛', '自立', '埋込'])

  const after = await page.evaluate(() => window.__karu!.getCountFixtures())
  expect(after.find(fixture => fixture.id === dl.id)?.conditions).toEqual([
    '天井直付', '天井埋込', '壁付', '吊下げ', '床置・据置',
    '一般（天井・壁）', '金属線ぴ取付け', 'システム天井',
  ])
  let changed = 0
  for (const original of before) {
    const updated = after.find(fixture => fixture.id === original.id)!
    expect(updated).toBeDefined()
    expect({ ...updated, conditions: original.conditions }).toEqual(original)
    expect(updated.conditions?.slice(0, original.conditions?.length ?? 0))
      .toEqual(original.conditions ?? [])
    expect(updated.conditions?.length ?? 0).toBeLessThanOrEqual(30)
    if ((updated.conditions?.length ?? 0) > (original.conditions?.length ?? 0)) changed++
  }
  expect(changed).toBeGreaterThanOrEqual(2)
  await expect(panel.getByRole('status').filter({
    hasText: `${changed} 項目に施工条件の候補を入れました（Ctrl+Z で戻せます）`,
  })).toBeVisible()

  await expect(wallOption).toHaveCount(1)
  await expect(wallOption).toBeEnabled()
  await expect(format.getByRole('combobox', { name: '施工条件', exact: true })).toBeEnabled()

  // 再実行で追加がなければ、取り消し履歴も増やさない。
  await expect(fill).toBeEnabled()
  await fill.click()
  await expect(panel.getByRole('status').filter({
    hasText: '足す候補はありませんでした',
  })).toBeVisible()
  expect(await page.evaluate(() => window.__karu!.getCountFixtures())).toEqual(after)

  await fill.blur()
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(() => window.__karu!.getCountFixtures()))
    .toEqual(before)
  await expect(wallOption).toHaveCount(0)
  await expect.poll(() => page.evaluate(id =>
    window.__karu!.getEditableAnnotations(0).filter(annotation =>
      annotation.count?.version === 2 && annotation.count.fixtureId === id).length,
  board.id)).toBe(1)
})

test('shows the fixture list in breakdown order with subtree controls and a persistent category fallback', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await open(page)
  const panel = page.getByTestId('fixture-panel')
  await expect(panel.getByRole('checkbox', { name: '内訳書の構成で表示', exact: true })).toHaveCount(0)
  await page.evaluate(field => window.__karu!.addFixturePresets(field), '電気設備')

  const dialog = await breakdownDialog(page)
  await lightingGroup(dialog, '電灯分岐')
  const boardRow = distributionBoardRow(dialog)
  await boardRow.getByRole('checkbox', { name: '分電盤（面）', exact: true }).check()
  await boardRow.getByLabel('分電盤の盤名称のほかの値', { exact: true }).fill('L-1、L-2')

  const cableRow = dialog.locator('.breakdown-row').filter({
    has: page.getByText('ケーブル', { exact: true }),
  }).first()
  await cableRow.getByRole('button', { name: /^明細を選ぶ（\d+）$/ }).click()
  const cableType = cableRow.getByRole('button', { name: /の種類 / }).first()
  if (await cableType.count()) await cableType.click()
  await cableRow.getByRole('checkbox', { name: /（長さ・m）$/ }).first().check()
  await dialog.getByRole('button', { name: '選んだ項目を追加（3件）', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  const toggle = panel.getByRole('checkbox', { name: '内訳書の構成で表示', exact: true })
  await expect(toggle).toBeChecked()
  await expect(panel.locator('.fixture-groups')).toHaveAttribute('data-grouping', 'breakdown')
  const fixtures = await page.evaluate(() => window.__karu!.getCountFixtures())
  const positioned = fixtures.filter(fixture => fixture.breakdown !== undefined)
  const missing = fixtures.filter(fixture => fixture.breakdown === undefined)
  const boards = positioned.filter(fixture => fixture.breakdown?.item === '分電盤')
  const cables = positioned.filter(fixture => fixture.breakdown?.item === 'ケーブル')
  const lights = missing.filter(fixture => fixture.category === '照明器具')
  expect(boards).toHaveLength(2)
  expect(cables).toHaveLength(1)
  expect(lights.length).toBeGreaterThan(0)

  const headings = panel.locator('.fixture-category > button:first-child')
  await expect(headings).toHaveText([
    `電気設備（${positioned.length}）`,
    `庁舎（${positioned.length}）`,
    `電灯設備（${positioned.length}）`,
    `電灯分岐（${positioned.length}）`,
    `ケーブル（別紙明細）（${cables.length}）`,
    `（内訳書の位置なし）（${missing.length}）`,
    ...[...new Set([...missing].sort((a, b) => a.order - b.order).map(fixture => fixture.category))]
      .map(category => `${category}（${missing.filter(fixture => fixture.category === category).length}）`),
  ])
  await expect(panel.locator('.fixture-category').filter({
    has: page.getByRole('button', { name: /^電灯設備（\d+）$/ }),
  })).toHaveAttribute('data-level', '2')
  await expect(panel.locator('.fixture-category').filter({
    has: page.getByRole('button', { name: /^電灯分岐（\d+）$/ }),
  })).toHaveAttribute('data-level', '3')
  await expect(panel.locator('.fixture-category').filter({
    has: page.getByRole('button', { name: /^ケーブル（別紙明細）（\d+）$/ }),
  })).toHaveAttribute('data-level', '4')
  for (const heading of await headings.all()) {
    const level = await heading.locator('..').getAttribute('data-level')
    const breakdownKey = await heading.locator('..').getAttribute('data-breakdown-heading')
    if ((level === '1' && breakdownKey !== null) || level === '2' || level === '3' || level === '4') {
      await expect(heading).toHaveAttribute('draggable', 'true')
    } else {
      await expect(heading).not.toHaveAttribute('draggable', 'true')
    }
  }

  const branchSection = panel.locator('.fixture-groups > section').filter({
    has: page.getByRole('button', { name: /^電灯分岐（\d+）$/ }),
  })
  for (const board of boards) {
    await expect(branchSection.locator(`li[data-fixture-id="${board.id}"]`)).toBeVisible()
  }
  const cableSection = panel.locator('.fixture-groups > section').filter({
    has: page.getByRole('button', { name: /^ケーブル（別紙明細）（\d+）$/ }),
  })
  await expect(cableSection.locator(`li[data-fixture-id="${cables[0].id}"]`)).toBeVisible()
  const lightSection = panel.locator('.fixture-groups > section').filter({
    has: page.getByRole('button', { name: /^照明器具（\d+）$/ }),
  })
  await expect(lightSection.locator(`li[data-fixture-id="${lights[0].id}"]`)).toBeVisible()

  // A heading controls the complete subtree, including separate-detail items.
  await panel.getByRole('button', { name: '電灯分岐の表示切替', exact: true }).click()
  for (const fixture of positioned) {
    await expect(panel.locator(`li[data-fixture-id="${fixture.id}"] > button`).first())
      .toHaveAttribute('aria-pressed', 'false')
  }
  await expect(lightSection.locator(`li[data-fixture-id="${lights[0].id}"] > button`).first())
    .toHaveAttribute('aria-pressed', 'true')
  await panel.getByRole('button', { name: '電灯分岐の表示切替', exact: true }).click()

  const branchHeading = panel.getByRole('button', { name: /^電灯分岐（\d+）$/ })
  await branchHeading.click()
  await expect(branchHeading).toHaveAttribute('aria-expanded', 'false')
  await expect(panel.getByRole('button', { name: /^ケーブル（別紙明細）（\d+）$/ })).toHaveCount(0)
  for (const fixture of positioned) {
    await expect(panel.locator(`li[data-fixture-id="${fixture.id}"]`)).toHaveCount(0)
  }
  await expect(lightSection.locator(`li[data-fixture-id="${lights[0].id}"]`)).toBeVisible()
  await branchHeading.click()
  await expect(branchHeading).toHaveAttribute('aria-expanded', 'true')

  // Search removes headings whose subtree has no matching items.
  const search = panel.getByLabel('名称・略号で検索', { exact: true })
  await search.fill('L-1')
  await expect(headings).toHaveText([
    '電気設備（1）', '庁舎（1）', '電灯設備（1）', '電灯分岐（1）',
  ])
  await search.fill('')

  // Located fixtures may change only their order slots within the same detail.
  const firstBoard = boards.find(fixture => fixture.code === 'L-1')!
  const secondBoard = boards.find(fixture => fixture.code === 'L-2')!
  await panel.locator(`li[data-fixture-id="${firstBoard.id}"] .fixture-row`).click()
  await expect(panel.getByRole('button', { name: '上へ', exact: true })).toBeDisabled()
  await expect(panel.getByRole('button', { name: '下へ', exact: true })).toBeEnabled()
  await panel.getByRole('button', { name: '下へ', exact: true }).click()
  const reordered = await page.evaluate(() => window.__karu!.getCountFixtures())
  expect(reordered.find(fixture => fixture.id === firstBoard.id)!.order).toBe(secondBoard.order)
  expect(reordered.find(fixture => fixture.id === secondBoard.id)!.order).toBe(firstBoard.order)
  for (const original of fixtures) {
    const updated = reordered.find(fixture => fixture.id === original.id)!
    expect({ ...updated, order: original.order }).toEqual(original)
    if (!boards.some(board => board.id === original.id)) expect(updated.order).toBe(original.order)
  }
  await expect(panel.getByRole('button', { name: '下へ', exact: true })).toBeDisabled()

  await panel.locator(`li[data-fixture-id="${firstBoard.id}"]`)
    .dragTo(panel.locator(`li[data-fixture-id="${cables[0].id}"]`))
  // SPEC-R6e: 細目の項目も別紙明細の項目の位置へ移せる。
  await expect.poll(() => page.evaluate(id =>
    window.__karu!.getCountFixtures().find(fixture => fixture.id === id)?.breakdown, firstBoard.id,
  )).toEqual(cables[0].breakdown)
  await expect(panel.getByRole('status').filter({
    hasText: `${firstBoard.name}を「`,
  }).filter({ hasText: ' › ケーブル」へ移しました（Ctrl+Z で戻せます）' })).toBeVisible()
  expect((await savedFixtures(page)).find(fixture => fixture.id === firstBoard.id)!.breakdown)
    .toEqual(cables[0].breakdown)
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(() => window.__karu!.getCountFixtures())).toEqual(reordered)

  await toggle.uncheck()
  await expect(panel.locator('.fixture-groups')).toHaveAttribute('data-grouping', 'category')
  await expect(panel.getByRole('button', { name: /^盤類（\d+）$/ })).toBeVisible()
  await expect(panel.getByRole('button', { name: /^電灯分岐（\d+）$/ })).toHaveCount(0)
  expect(await page.evaluate(() =>
    localStorage.getItem('karu-pdf:group-by-breakdown'),
  )).toBe('false')

  const saved = await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!])
  await page.reload()
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '内訳書マスタ試験.pdf'), saved)
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await expect(panel.getByRole('checkbox', { name: '内訳書の構成で表示', exact: true })).not.toBeChecked()
  await expect(panel.locator('.fixture-groups')).toHaveAttribute('data-grouping', 'category')
  await expect(panel.getByRole('button', { name: /^盤類（\d+）$/ })).toBeVisible()
  await expect(panel.getByRole('button', { name: /^電灯分岐（\d+）$/ })).toHaveCount(0)
})

async function chooseSeparateDetails(dialog: Locator, name: string, count: number) {
  const row = dialog.locator('.breakdown-row').filter({
    has: dialog.page().getByText(name, { exact: true }),
  }).first()
  await row.getByRole('button', { name: /^明細を選ぶ（\d+）$/ }).click()
  const types = row.getByRole('button', { name: /の種類 / })
  for (const type of await types.all()) {
    if (await type.getAttribute('aria-expanded') !== 'true') await type.click()
  }
  const choices = row.getByRole('checkbox', { name: /（(?:個数・)?(?:個|枚|組|箇所)）$/ })
  await expect.poll(() => choices.count()).toBeGreaterThanOrEqual(count)
  for (let index = 0; index < count; index++) await choices.nth(index).check()
}

function outlineHeading(panel: Locator, level: number, name: string) {
  return panel.locator(`.fixture-category[data-level="${level}"]`).filter({
    has: panel.page().getByRole('button', { name: new RegExp(`^${name}（\\d+）$`) }),
  })
}

test('moves separate details and middle headings with one undo and restores master order', async ({ page }) => {
  // Tall enough that source and target rows stay in view: scrolling mid-drag would start the drag on a heading.
  await page.setViewportSize({ width: 1600, height: 1400 })
  await open(page)
  let dialog = await breakdownDialog(page)
  await lightingGroup(dialog, '電灯分岐')
  await chooseSeparateDetails(dialog, '配線器具', 2)
  await chooseSeparateDetails(dialog, '設備プレート', 1)
  const boardRow = distributionBoardRow(dialog)
  await boardRow.getByRole('checkbox', { name: '分電盤（面）', exact: true }).check()
  await boardRow.getByLabel('分電盤の盤名称のほかの値', { exact: true }).fill('L-1')
  await dialog.getByRole('button', { name: '選んだ項目を追加（4件）', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  // Add the earlier master position last to verify ranked insertion.
  dialog = await breakdownDialog(page)
  await lightingGroup(dialog, '電灯幹線')
  await selectE25(conduitRow(dialog))
  await dialog.getByRole('button', { name: '選んだ項目を追加（1件）', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  const panel = page.getByTestId('fixture-panel')
  await expect(panel.locator('li[data-fixture-id]')).toHaveCount(5)
  await expect(panel.locator('.fixture-category[data-level="3"] > button:first-child'))
    .toHaveText(['電灯幹線（1）', '電灯分岐（4）'])
  const before = await page.evaluate(() => window.__karu!.getCountFixtures())
  const switches = before.filter(fixture => fixture.breakdown?.item === '配線器具')
    .sort((a, b) => a.order - b.order)
  const plate = before.find(fixture => fixture.breakdown?.item === '設備プレート')!
  const board = before.find(fixture => fixture.breakdown?.item === '分電盤')!
  const trunk = before.find(fixture => fixture.breakdown?.middle === '電灯幹線')!
  expect(switches).toHaveLength(2)
  expect(plate).toBeDefined()
  expect(board).toBeDefined()
  expect(trunk).toBeDefined()
  const sourceRow = () => panel.locator(`li[data-fixture-id="${switches[0].id}"]`)

  await sourceRow().dragTo(panel.locator(`li[data-fixture-id="${plate.id}"]`), {
    targetPosition: { x: 20, y: 2 },
  })
  await expect(panel.getByRole('button', { name: '配線器具（別紙明細）（1）', exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: '設備プレート（別紙明細）（2）', exact: true })).toBeVisible()
  await expect(panel.getByRole('status').filter({
    // SPEC-B20: 移した先は 種目 › 科目 › 中科目 › 細目 で出す。
    hasText: `${switches[0].name}を「`,
  }).filter({ hasText: ' › 設備プレート」へ移しました（Ctrl+Z で戻せます）' })).toBeVisible()
  const moved = await savedFixtures(page)
  expect(moved.find(fixture => fixture.id === switches[0].id)!.breakdown?.item).toBe('設備プレート')
  const plateItems = moved.filter(fixture => fixture.breakdown?.item === '設備プレート')
    .sort((a, b) => a.order - b.order)
  expect(plateItems.map(fixture => fixture.id)).toEqual([switches[0].id, plate.id])
  for (const original of before) {
    const updated = moved.find(fixture => fixture.id === original.id)!
    expect({ ...updated, order: original.order, breakdown: original.breakdown }).toEqual(original)
    if (original.id !== switches[0].id) expect(updated.breakdown).toEqual(original.breakdown)
  }
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(() => window.__karu!.getCountFixtures())).toEqual(before)

  // A separate heading receives the item at the end of that detail.
  await sourceRow().dragTo(panel.locator('.fixture-category[data-level="4"]').filter({
    has: page.getByRole('button', { name: '設備プレート（別紙明細）（1）', exact: true }),
  }))
  await expect.poll(() => page.evaluate(() =>
    window.__karu!.getCountFixtures().filter(fixture => fixture.breakdown?.item === '設備プレート')
      .sort((a, b) => a.order - b.order).map(fixture => fixture.id),
  )).toEqual([plate.id, switches[0].id])
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(() => window.__karu!.getCountFixtures())).toEqual(before)

  // SPEC-R6e: 別紙明細から細目へも、落とした項目の位置をそのままコピーする。
  await sourceRow().dragTo(panel.locator(`li[data-fixture-id="${board.id}"]`), {
    targetPosition: { x: 20, y: 2 },
  })
  await expect.poll(() => page.evaluate(id =>
    window.__karu!.getCountFixtures().find(fixture => fixture.id === id)?.breakdown, switches[0].id,
  )).toEqual(board.breakdown)
  await expect(panel.getByRole('status').filter({
    hasText: `${switches[0].name}を「`,
  }).filter({ hasText: ' › 分電盤」へ移しました（Ctrl+Z で戻せます）' })).toBeVisible()
  const movedToOrdinary = await savedFixtures(page)
  expect(movedToOrdinary.find(fixture => fixture.id === switches[0].id)!.breakdown).toEqual(board.breakdown)
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(() => window.__karu!.getCountFixtures())).toEqual(before)
  // SPEC-B20: 別の中科目の別紙明細へも移せる（Ctrl+Z 1 回で戻る）。
  await sourceRow().dragTo(panel.locator(`li[data-fixture-id="${trunk.id}"]`), {
    targetPosition: { x: 20, y: 2 },
  })
  await expect.poll(() => page.evaluate(id =>
    window.__karu!.getCountFixtures().find(fixture => fixture.id === id)?.breakdown?.middle, switches[0].id,
  )).toBe(trunk.breakdown!.middle)
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(() => window.__karu!.getCountFixtures())).toEqual(before)

  const moveBranchBeforeTrunk = async () => {
    const branchHeading = outlineHeading(panel, 3, '電灯分岐')
    const trunkHeading = outlineHeading(panel, 3, '電灯幹線')
    await branchHeading.locator('button:first-child').dragTo(trunkHeading, {
      targetPosition: { x: 20, y: 2 },
    })
    await expect(panel.locator('.fixture-category[data-level="3"] > button:first-child'))
      .toHaveText(['電灯分岐（4）', '電灯幹線（1）'])
    await expect(panel.getByRole('status').filter({
      hasText: '電灯分岐を「庁舎 › 電灯設備 › 電灯分岐」へ移しました（Ctrl+Z で戻せます）',
    })).toBeVisible()
  }
  await moveBranchBeforeTrunk()
  const headingsMoved = await page.evaluate(() => window.__karu!.getCountFixtures())
  for (const original of before) {
    const updated = headingsMoved.find(fixture => fixture.id === original.id)!
    expect({ ...updated, order: original.order }).toEqual(original)
  }

  await page.getByRole('button', { name: '集計表を開く', exact: true }).click()
  const table = page.getByRole('region', { name: '数量の集計表', exact: true })
  await expect(table).toBeVisible()
  await expect.poll(async () => [...new Set(
    (await table.getByText(/^(?:電灯分岐|電灯幹線)$/).allTextContents()).map(text => text.trim()),
  )]).toEqual(['電灯分岐', '電灯幹線'])
  await table.getByRole('button', { name: /閉じ/ }).click()
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(() => window.__karu!.getCountFixtures())).toEqual(before)
  await expect(panel.locator('.fixture-category[data-level="3"] > button:first-child'))
    .toHaveText(['電灯幹線（1）', '電灯分岐（4）'])

  await moveBranchBeforeTrunk()
  const beforeReset = await page.evaluate(() => window.__karu!.getCountFixtures())
  const reset = panel.getByRole('button', { name: '内訳書の順に並べ直す', exact: true })
  await reset.click()
  await expect(panel.locator('.fixture-category[data-level="3"] > button:first-child'))
    .toHaveText(['電灯幹線（1）', '電灯分岐（4）'])
  await expect(panel.getByRole('status').filter({
    hasText: '内訳書の順に並べ直しました（Ctrl+Z で戻せます）',
  })).toBeVisible()
  const restored = await page.evaluate(() => window.__karu!.getCountFixtures())
  expect([...restored].sort((a, b) => a.order - b.order).map(fixture => fixture.id))
    .toEqual([...before].sort((a, b) => a.order - b.order).map(fixture => fixture.id))
  for (const original of before) {
    expect({ ...restored.find(fixture => fixture.id === original.id)!, order: original.order }).toEqual(original)
  }
  await reset.blur()
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(() => window.__karu!.getCountFixtures())).toEqual(beforeReset)

  const search = panel.getByLabel('名称・略号で検索', { exact: true })
  await search.fill(switches[0].code || switches[0].name)
  await expect(reset).toBeDisabled()
  for (const heading of await panel.locator('.fixture-outline-heading').all()) {
    await expect(heading).toHaveAttribute('draggable', 'false')
  }
  await search.fill('')
  await panel.getByRole('checkbox', { name: '内訳書の構成で表示', exact: true }).uncheck()
  await expect(reset).toHaveCount(0)
})

async function internalScaffoldRow(dialog: Locator): Promise<Locator> {
  await dialog.getByLabel('内訳書を検索', { exact: true }).fill('')
  await dialog.getByRole('group', { name: '内訳書の編', exact: true })
    .getByRole('button', { name: '建築', exact: true }).click()
  const row = dialog.locator('.breakdown-row').filter({
    has: dialog.page().getByText('内部足場', { exact: true }),
  }).first()
  const sectionGroup = dialog.getByRole('group', { name: '内訳書の種目', exact: true })
  const subjectGroup = dialog.getByRole('group', { name: '内訳書の科目', exact: true })
  const middleGroup = dialog.getByRole('group', { name: '内訳書の中科目', exact: true })
  const sections = await sectionGroup.getByRole('button').allTextContents()
  for (const section of sections) {
    await sectionGroup.getByRole('button', { name: section, exact: true }).click()
    const subjects = await subjectGroup.getByRole('button').allTextContents()
    for (const subject of subjects) {
      await subjectGroup.getByRole('button', { name: subject, exact: true }).click()
      if (await row.count()) return row
      const middles = await middleGroup.getByRole('button').allTextContents()
      for (const middle of middles) {
        await middleGroup.getByRole('button', { name: middle, exact: true }).click()
        if (await row.count()) return row
      }
    }
  }
  throw new Error('建築の内訳書マスタに内部足場の行が見つかりません')
}

test('moves an unlocated fixture into the internal scaffold separate heading with one undo', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1400 })
  await open(page)
  await page.evaluate(field => window.__karu!.addFixturePresets(field), '電気設備')
  const dialog = await breakdownDialog(page)
  const row = await internalScaffoldRow(dialog)
  const detailButton = row.getByRole('button', { name: /^明細を選ぶ（\d+）$/ })
  if (await detailButton.count()) {
    await detailButton.click()
    for (const type of await row.getByRole('button', { name: /の種類 / }).all()) {
      if (await type.getAttribute('aria-expanded') !== 'true') await type.click()
    }
  }
  await expect(row.getByRole('checkbox').first()).toBeVisible()
  await row.getByRole('checkbox').first().check()
  await dialog.getByRole('button', { name: '選んだ項目を追加（1件）', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  const panel = page.getByTestId('fixture-panel')
  await expect(panel.locator('.fixture-groups')).toHaveAttribute('data-grouping', 'breakdown')
  const before = await page.evaluate(() => window.__karu!.getCountFixtures())
  const destination = before.find(fixture => fixture.breakdown?.item === '内部足場')!
  const source = [...before].filter(fixture => fixture.breakdown === undefined)
    .sort((a, b) => a.order - b.order)[0]!
  expect(destination).toBeDefined()
  expect(source).toBeDefined()
  const heading = panel.locator('.fixture-category[data-level="4"]').filter({
    has: page.getByRole('button', { name: '内部足場（別紙明細）（1）', exact: true }),
  })
  await expect(heading).toBeVisible()
  await panel.locator(`li[data-fixture-id="${source.id}"]`).dragTo(heading)

  await expect.poll(() => page.evaluate(id =>
    window.__karu!.getCountFixtures().find(fixture => fixture.id === id)?.breakdown, source.id,
  )).toEqual(destination.breakdown)
  const movedSection = panel.locator('.fixture-groups > section').filter({
    has: page.getByRole('button', { name: '内部足場（別紙明細）（2）', exact: true }),
  })
  await expect(movedSection.locator(`li[data-fixture-id="${source.id}"]`)).toBeVisible()
  await expect(movedSection.locator('li[data-fixture-id]')).toHaveAttribute('draggable', 'true')
    .catch(async () => {
      for (const item of await movedSection.locator('li[data-fixture-id]').all()) {
        await expect(item).toHaveAttribute('draggable', 'true')
      }
    })
  const moved = await savedFixtures(page)
  const peers = moved.filter(fixture =>
    fixture.breakdown?.book === destination.breakdown!.book
      && fixture.breakdown?.section === destination.breakdown!.section
      && fixture.breakdown?.subject === destination.breakdown!.subject
      && (fixture.breakdown?.middle ?? '') === (destination.breakdown!.middle ?? '')
      && fixture.breakdown?.item === '内部足場',
  ).sort((a, b) => a.order - b.order)
  expect(peers.map(fixture => fixture.id)).toEqual([destination.id, source.id])
  await expect(panel.getByRole('status').filter({
    hasText: `${source.name}を「`,
  }).filter({ hasText: ' › 内部足場」へ移しました（Ctrl+Z で戻せます）' })).toBeVisible()

  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(() => window.__karu!.getCountFixtures())).toEqual(before)
  await expect(panel.getByRole('button', { name: '内部足場（別紙明細）（1）', exact: true })).toBeVisible()
  const restored = await savedFixtures(page)
  expect(restored.find(fixture => fixture.id === source.id)!.breakdown).toBeUndefined()
})

test('falls back to no position for invalid stored hierarchy', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('karu-pdf:master-breakdown-position', JSON.stringify({
      book: '電気設備', section: '存在しない種目', subject: '電灯設備', middle: '電灯幹線',
    }))
  })
  await open(page)
  await page.getByRole('button', { name: '標準マスタから追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '標準マスタから追加', exact: true })
  await expect(dialog.getByLabel('位置の編', { exact: true })).toHaveValue('')
  for (const label of ['位置の種目', '位置の科目', '位置の中科目']) {
    await expect(dialog.getByLabel(label, { exact: true })).toBeDisabled()
  }
})

test('機械の給水管を追加し、配管の分類と施工条件の候補を保持する', async ({ page }) => {
  await open(page)
  const dialog = await breakdownDialog(page)
  const books = dialog.getByRole('group', { name: '内訳書の編', exact: true })

  const elevator = books.getByRole('button', { name: '昇降機設備', exact: true })
  await expect(elevator).toBeEnabled()
  await elevator.click()
  await dialog.getByRole('group', { name: '内訳書の種目', exact: true })
    .getByRole('button', { name: '庁舎', exact: true }).click()
  await expect(dialog.getByRole('group', { name: '内訳書の科目', exact: true })
    .getByRole('button', { name: 'エレベーター設備', exact: true })).toBeEnabled()

  await books.getByRole('button', { name: '機械設備', exact: true }).click()
  await dialog.getByRole('group', { name: '内訳書の種目', exact: true })
    .getByRole('button', { name: '庁舎', exact: true }).click()
  await dialog.getByRole('group', { name: '内訳書の科目', exact: true })
    .getByRole('button', { name: '給水設備', exact: true }).click()

  const waterRow = dialog.locator('.breakdown-row').filter({
    has: page.getByRole('checkbox', { name: /^給水管（(?:長さ・)?m）$/ }),
  })
  // 中科目名を固定せず、給水設備内の給水管を選ぶ。
  if (await waterRow.count() === 0) {
    const middles = dialog.getByRole('group', { name: '内訳書の中科目', exact: true })
      .getByRole('button')
    for (let index = 0; index < await middles.count(); index += 1) {
      await middles.nth(index).click()
      if (await waterRow.count() > 0) break
    }
  }

  await expect(waterRow).toHaveCount(1)
  await waterRow.getByRole('checkbox', {
    name: 'SGP-VB 20A 給水管（m）', exact: true,
  }).check()
  await dialog.getByRole('button', { name: /追加/ }).click()
  await expect(dialog).toBeHidden()

  const fixtures = page.getByTestId('fixture-panel')
  // The list opens in the breakdown view, so check the saved category rather than a category heading.
  await expect.poll(async () => (await page.evaluate(() => window.__karu!.getCountFixtures())).find(f => f.name === '給水管')?.category).toBe('配管（給水・給湯）')
  // 登録直後は関連の候補カードにも起点の「給水管」ボタンが出るため、先頭（項目の見出し）を見る。
  await expect(fixtures.getByRole('button', { name: 'SGP-VB 20A 給水管', exact: true })).toBeVisible()
  // The pipe's location (区分) is a construction condition, not a separate item.
  const water = (await page.evaluate(() => window.__karu!.getCountFixtures())).find(f => f.name === '給水管')!
  expect(water).toMatchObject({ name: '給水管', code: 'SGP-VB', spec: '20A' })
  expect(water.summary).toEqual([
    { label: '管種', value: '水道用硬質塩化ビニルライニング鋼管（SGP-VB）' },
    { label: '呼び径', value: '20A' },
  ])
  expect(water.conditions).toEqual(['屋内一般配管', '機械室・便所配管', '屋外配管（架空・暗渠内・共同溝内）', '屋外露出配管', '地中配管'])
  expect(water.breakdown?.book).toBe('機械設備')
})

test('建築の普通コンクリートを強度・スランプ付きの体積項目として追加し、異形鉄筋は連動の項目になる', async ({ page }) => {
  await open(page)
  const before = await page.evaluate(() => window.__karu!.getCountFixtures())
  const dialog = await breakdownDialog(page)

  await dialog.getByRole('group', { name: '内訳書の編', exact: true })
    .getByRole('button', { name: '建築', exact: true }).click()
  await dialog.getByRole('group', { name: '内訳書の種目', exact: true })
    .getByRole('button', { name: '庁舎', exact: true }).click()
  await dialog.getByRole('group', { name: '内訳書の科目', exact: true })
    .getByRole('button', { name: 'コンクリート', exact: true }).click()
  await dialog.getByRole('group', { name: '内訳書の中科目', exact: true })
    .getByRole('button', { name: '躯体', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: '躯体の細目', exact: true })).toBeVisible()
  const concreteRow = dialog.locator('.breakdown-row').filter({ has: page.getByRole('checkbox', { name: '普通コンクリート（軸部）（㎥）', exact: true }) })
  await concreteRow.getByRole('checkbox', { name: '普通コンクリート（軸部）（㎥）', exact: true }).check()

  async function chooseSummary(label: string, value: string) {
    // The catalog chooser names each value checkbox 「細目の区分 値」.
    const valueBox = dialog.getByRole('checkbox', { name: `普通コンクリート（軸部）の${label} ${value}`, exact: true })
    if (await valueBox.count()) { await valueBox.check(); return }
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

  await chooseSummary('強度', '24')
  await chooseSummary('スランプ', '18')
  await dialog.getByRole('button', { name: /追加/ }).click()

  await expect.poll(async () => (
    await page.evaluate(() => window.__karu!.getCountFixtures())
  ).length).toBe(before.length + 1)

  const added = (await page.evaluate(() => window.__karu!.getCountFixtures()))
    .find(fixture => fixture.name === '普通コンクリート（軸部）')!
  expect(added).toBeDefined()
  expect(added).toMatchObject({
    category: 'コンクリート',
    kind: 'volume',
    method: 'polygonDepth',
    breakdown: {
      book: '建築',
      section: '庁舎',
      subject: 'コンクリート',
      middle: '躯体',
      item: '普通コンクリート（軸部）',
    },
  })
  expect(added.summary).toEqual([
    { label: '強度', value: '24' },
    { label: 'スランプ', value: '18' },
  ])

  const rebarDialog = await breakdownDialog(page)
  await rebarDialog.getByRole('group', { name: '内訳書の編', exact: true })
    .getByRole('button', { name: '建築', exact: true }).click()
  await rebarDialog.getByLabel('内訳書を検索', { exact: true }).fill('異形鉄筋')
  // 異形鉄筋 (t) has a link rule, so it can be added and becomes a linked item (SPEC-B07-2a).
  const rebarPanel = rebarDialog.getByRole('tabpanel', { name: '内訳書から選ぶ', exact: true })
  await expect(rebarPanel).toContainText('異形鉄筋')
  await rebarPanel.getByRole('checkbox', { name: /^異形鉄筋/ }).first().check()
  await rebarDialog.getByRole('button', { name: /追加/ }).click()
  await expect.poll(async () => (
    await page.evaluate(() => window.__karu!.getCountFixtures())
  ).length).toBe(before.length + 2)
  const rebar = (await page.evaluate(() => window.__karu!.getCountFixtures()))
    .find(fixture => fixture.name === '異形鉄筋')!
  expect(rebar.link).toMatchObject({ kind: 'rc', rc: { output: 'rebar', basis: 'required' } })
  // The concrete added above stays an ordinary volume item: the document has no RC members.
  const concrete = (await page.evaluate(() => window.__karu!.getCountFixtures()))
    .find(fixture => fixture.name === '普通コンクリート（軸部）')!
  expect(concrete.link).toBeUndefined()
})

test('建築の形鋼は鉄骨の連動の項目になり、区画の無いスリーブはふつうの項目になる', async ({ page }) => {
  await open(page)
  const before = await page.evaluate(() => window.__karu!.getCountFixtures())

  const steelDialog = await breakdownDialog(page)
  await steelDialog.getByRole('group', { name: '内訳書の編', exact: true })
    .getByRole('button', { name: '建築', exact: true }).click()
  await steelDialog.getByLabel('内訳書を検索', { exact: true }).fill('形鋼')
  const steelPanel = steelDialog.getByRole('tabpanel', { name: '内訳書から選ぶ', exact: true })
  await steelPanel.getByRole('checkbox', {
    name: '鉄骨の部材から（連動） 形鋼（t）', exact: true,
  }).first().check()
  await steelDialog.getByRole('button', { name: /追加/ }).click()
  await expect.poll(async () => (
    await page.evaluate(() => window.__karu!.getCountFixtures())
  ).length).toBe(before.length + 1)
  const steel = (await page.evaluate(() => window.__karu!.getCountFixtures()))
    .find(fixture => fixture.name === '形鋼')!
  expect(steel.link).toMatchObject({ kind: 'steel', steel: { output: 'mass', basis: 'required' } })
  // A dialog that attached link rules stays open to show which rules were attached.
  await expect(steelDialog.getByRole('status').filter({ hasText: '連動の規則を付けました: 形鋼' })).toBeVisible()
  await steelDialog.getByRole('button', { name: '閉じる', exact: true }).click()

  const sleeveDialog = await breakdownDialog(page)
  await sleeveDialog.getByRole('group', { name: '内訳書の編', exact: true })
    .getByRole('button', { name: '建築', exact: true }).click()
  await sleeveDialog.getByLabel('内訳書を検索', { exact: true }).fill('スリーブ')
  const sleevePanel = sleeveDialog.getByRole('tabpanel', { name: '内訳書から選ぶ', exact: true })
  await sleevePanel.getByRole('checkbox', { name: /^スリーブ/ }).first().check()
  await sleeveDialog.getByRole('button', { name: /追加/ }).click()
  await expect.poll(async () => (
    await page.evaluate(() => window.__karu!.getCountFixtures())
  ).length).toBe(before.length + 2)
  const sleeve = (await page.evaluate(() => window.__karu!.getCountFixtures()))
    .find(fixture => fixture.name === 'スリーブ')!
  expect(sleeve.link).toBeUndefined()
})

test('電灯分岐のＬＥＤ照明器具からDLのφ150を選び、位置・単位・記号を保持する', async ({ page }) => {
  await open(page)
  const dialog = await breakdownDialog(page)
  await lightingGroup(dialog, '電灯分岐')
  const row = dialog.locator('.breakdown-row').filter({
    has: page.getByRole('checkbox', { name: 'ＬＥＤ照明器具（個）', exact: true }),
  })
  await expect(row).toHaveCount(1)

  const specificationGroup = row.getByRole('group', {
    name: 'ダウンライトの規格', exact: true,
  })
  const specification = specificationGroup.getByRole('checkbox', {
    name: 'DL φ150 ＬＥＤ照明器具（個）', exact: true,
  })
  await specification.check()
  // 記号は規格から入る（欄は出ない）。保存した摘要で確かめる。
  await expect(row.getByText('記号は規格から入ります', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', {
    name: '選んだ項目を追加（1件）', exact: true,
  })).toBeEnabled()

  await expect(specification).toBeChecked()

  await dialog.getByRole('button', {
    name: '選んだ項目を追加（1件）', exact: true,
  }).click()
  await expect(dialog).toHaveCount(0)

  const panel = page.getByTestId('fixture-panel')
  await expect(panel.locator('li[data-fixture-id]')).toHaveCount(1)
  await expect(panel.getByRole('button', {
    name: 'DL φ150 ＬＥＤ照明器具', exact: true,
  })).toBeVisible()

  const fixtures = await savedFixtures(page)
  expect(fixtures).toHaveLength(1)
  expect(fixtures[0]).toMatchObject({
    category: '照明器具',
    code: 'DL',
    name: 'ＬＥＤ照明器具',
    spec: 'φ150',
    kind: 'count',
    method: 'click',
  })
  expect(quantityUnit(fixtures[0])).toBe('個')
  expect(fixtures[0].breakdown).toEqual({
    book: '電気設備',
    section: '庁舎',
    subject: '電灯設備',
    middle: '電灯分岐',
    item: 'ＬＥＤ照明器具',
  })
  expect(fixtures[0].summary).toEqual([{ label: '記号', value: 'DL' }])
})

test('形鋼の寸法規格を小見出しから選び、摘要を自動入力した長さ項目として追加する', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await open(page)
  const dialog = await breakdownDialog(page)
  await dialog.getByRole('group', { name: '内訳書の編', exact: true })
    .getByRole('button', { name: '建築', exact: true }).click()
  await dialog.getByRole('group', { name: '内訳書の種目', exact: true })
    .getByRole('button', { name: '庁舎', exact: true }).click()
  await dialog.getByRole('group', { name: '内訳書の科目', exact: true })
    .getByRole('button', { name: '鉄骨', exact: true }).click()
  await dialog.getByRole('group', { name: '内訳書の中科目', exact: true })
    .getByRole('button', { name: '本体鉄骨・鋼材', exact: true }).click()

  const row = dialog.locator('.breakdown-row').filter({
    has: page.getByRole('checkbox', {
      name: '鉄骨の部材から（連動） 形鋼（t）', exact: true,
    }),
  })
  await expect(row).toHaveCount(1)
  await expect(row.locator('.catalog-options input[type="checkbox"]')).toHaveCount(49)
  for (const heading of ['H形鋼（21）', '山形鋼（14）', '溝形鋼（7）', 'I形鋼（6）']) {
    await expect(row.getByRole('heading', { name: heading, exact: true })).toBeVisible()
  }

  const hSections = row.getByRole('group', { name: 'H形鋼の規格', exact: true })
  await expect(hSections.getByRole('checkbox')).toHaveCount(21)
  await hSections.getByRole('checkbox', {
    name: 'H-400×200×8×13 形鋼（t）', exact: true,
  }).check()
  await expect(row.getByText('形状・寸法は規格から入ります', { exact: true })).toBeVisible()
  await expect(row.getByRole('group', { name: '形鋼の形状', exact: true })).toHaveCount(0)
  await expect(row.getByLabel(/^形鋼の形状(?: |$)/)).toHaveCount(0)
  await expect(row.getByLabel(/^形鋼の寸法(?: |$)/)).toHaveCount(0)
  await row.getByRole('checkbox', { name: '形鋼の規格 SS400', exact: true }).check()
  await expect(row.getByText('この品目で 1 件追加', { exact: true })).toBeVisible()

  await dialog.getByRole('button', {
    name: '選んだ項目を追加（1件）', exact: true,
  }).click()
  await expect(dialog).toHaveCount(0)
  const panel = page.getByTestId('fixture-panel')
  await expect(panel.locator('li[data-fixture-id]')).toHaveCount(1)

  const fixtures = await savedFixtures(page)
  expect(fixtures).toHaveLength(1)
  const steel = fixtures[0]
  expect(steel).toMatchObject({
    name: '形鋼',
    spec: 'H-400×200×8×13',
    kind: 'length',
    method: 'polyline',
    aggregation: 'document',
    convert: { unit: 't' },
    breakdown: {
      book: '建築',
      section: '庁舎',
      subject: '鉄骨',
      middle: '本体鉄骨・鋼材',
      item: '形鋼',
    },
  })
  expect(steel.link).toBeUndefined()
  expect(steel.convert?.factor).toBeCloseTo(65.4 * 1.05 / 1000, 6)
  expect(quantityUnit(steel)).toBe('t')
  expect(steel.summary).toHaveLength(3)
  expect(steel.summary).toEqual(expect.arrayContaining([
    { label: '規格', value: 'SS400' },
    { label: '形状', value: 'H形鋼' },
    { label: '寸法', value: 'H-400×200×8×13' },
  ]))
  const fixtureRow = panel.locator(`li[data-fixture-id="${steel.id}"]`)
  await expect(fixtureRow.locator('.fixture-row-unit')).toHaveText('t')
  await expect(fixtureRow.getByRole('button', {
    name: `${steel.code} H-400×200×8×13 形鋼`, exact: true,
  })).toBeVisible()
})
