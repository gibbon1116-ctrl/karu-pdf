import { expect, test, type Locator, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import mupdf from 'mupdf'
import { nextCountStyle, readCountFixtures, writeCountFixtures, type CountFixture } from '../src/core/countFixtures'

const LINK_STATUS =
  '連動の項目は図面に拾いません（ほかの項目の拾いから計算します）'

test('連動の元と先を一覧・カード・集計表に表示し、構成要素の同名項目を摘要で区別する', async ({ page }) => {
  test.setTimeout(120_000)
  const fixtures: CountFixture[] = []
  const append = (id: string, code: string, name: string, changes: Partial<CountFixture> = {}) => {
    const fixture: CountFixture = {
      id, code, name, category: '電気', order: fixtures.length,
      style: nextCountStyle(fixtures), ...changes,
    }
    fixtures.push(fixture)
    return fixture
  }
  const main = append('b23-switch', 'S', 'スイッチ')
  const ceiling = append('b23-ceiling', 'OB-C', 'アウトレットボックス', {
    summary: [{ label: '種別', value: '天井用' }],
  })
  const wall = append('b23-wall', 'OB-W', 'アウトレットボックス', {
    summary: [{ label: '種別', value: '壁用' }],
  })
  const concrete = append('b23-concrete', 'CON', '普通コンクリート（軸部）', {
    category: 'コンクリート',
    kind: 'volume',
    method: 'polygonDepth',
    defaults: { depthM: .15 },
    rc: {
      kind: 'slab',
      thicknessMm: 150,
      bars: [
        { role: 'x', size: 'D13', spacingMm: 200, layers: 2 },
        { role: 'y', size: 'D13', spacingMm: 200, layers: 2 },
      ],
    } as NonNullable<CountFixture['rc']>,
  })
  const rebar = append('b23-rebar', 'RB', '異形鉄筋', {
    category: '鉄筋',
    link: {
      kind: 'rc',
      sources: [],
      auto: { rcKinds: [] },
      rc: { output: 'rebar', basis: 'required' },
    },
  })

  const doc = new mupdf.PDFDocument(new Uint8Array(blankPdf()))
  let bytes: number[]
  try {
    writeCountFixtures(doc, fixtures)
    const buffer = doc.saveToBuffer('compress')
    try { bytes = [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { doc.destroy() }

  await page.evaluate(value => window.__karu!.openBytes(value, 'B23表示試験.pdf'), bytes)
  await page.evaluate(() => window.__karu!.setZoom(1))
  // 2 つ目の PDF を開いたので、数量タブを選び直して項目の読み込みを待つ。
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await expect(panel(page).getByText('数量拾いを読み込んでいます…', { exact: true })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.__karu!.getCountFixtures().length)).toBe(5)
  await expect(fixtureRow(page, ceiling.code, ceiling.name)).toBeVisible()
  const card = page.getByRole('tooltip').filter({ has: page.locator('.fixture-hover-line') })

  // 数量タブでも摘要と同名の強調表示を保つ。
  await fixtureLi(page, ceiling.code, ceiling.name).hover()
  await expect(card).toHaveCount(1)
  await expect(card).toContainText('摘要: 種別 天井用')
  await expect(card.locator('.fixture-hover-emphasis'))
    .toHaveText('摘要: 種別 天井用')
  await fixtureLi(page, wall.code, wall.name).hover()
  await expect(card).toContainText('摘要: 種別 壁用')

  // 拾いのない RC 部材でも、元と先は項目の設定だけで分かる。
  const rebarLi = fixtureLi(page, rebar.code, rebar.name)
  const concreteLi = fixtureLi(page, concrete.code, concrete.name)
  await expect(rebarLi.locator('.fixture-link-source-text'))
    .toHaveText('← 普通コンクリート（軸部）')
  await expect(concreteLi.locator('.fixture-link-dependent-count'))
    .toHaveText('→ 1件')
  await rebarLi.hover()
  await expect(card).toContainText('連動: RC 部材から（鉄筋・所要数量）')
  await expect(card).toContainText('元: CON 普通コンクリート（軸部）（自動）')
  await concreteLi.hover()
  await expect(card).toContainText('連動先: RB 異形鉄筋')
  await panel(page).locator('.fixture-groups').evaluate(element => {
    element.dispatchEvent(new Event('scroll'))
  })
  await expect(card).toHaveCount(0)

  await page.getByRole('button', { name: '集計表を開く', exact: true }).click()
  const table = page.getByRole('region', { name: '数量の集計表', exact: true })
  const rebarTableRow = table.locator(`tr[data-fixture-id="${rebar.id}"]`)
  const concreteTableRow = table.locator(`tr[data-fixture-id="${concrete.id}"]`)
  await expect(rebarTableRow.locator('.fixture-link-source-text'))
    .toHaveText('← 普通コンクリート（軸部）')
  await expect(rebarTableRow.locator('.fixture-link-badge'))
    .toHaveAttribute('title', 'CON 普通コンクリート（軸部）（自動）')
  await expect(concreteTableRow.locator('.fixture-link-dependent-count'))
    .toHaveText('→ 1件')
  await expect(concreteTableRow.locator('.fixture-link-dependent-count'))
    .toHaveAttribute('title', '異形鉄筋')
  await table.getByRole('button', { name: '集計表を閉じる', exact: true }).click()

  await fixtureRow(page, main.code, main.name).click()
  await point(page, 100, 220)
  await page.getByRole('button', { name: '選択', exact: true }).click()
  await point(page, 100, 220)
  const components = page.getByTestId('format-panel')
    .getByRole('region', { name: '構成要素', exact: true })
  await expect(components).toBeVisible()
  await components.getByRole('button', { name: '構成要素を追加', exact: true }).click()
  const picker = page.getByRole('dialog', { name: '構成要素を追加', exact: true })
  const pdf = picker.locator('section').filter({
    has: page.getByRole('heading', { name: 'この PDF の項目', exact: true }),
  })
  const boxes = pdf.getByRole('button').filter({ hasText: 'アウトレットボックス' })
  await expect(boxes).toHaveCount(2)

  await boxes.nth(0).hover()
  await expect(card).toHaveCount(1)
  await expect(card).toContainText('摘要: 種別 天井用')
  await expect(card.locator('.fixture-hover-emphasis'))
    .toHaveText('摘要: 種別 天井用')
  expect(await card.evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none')
  expect(await card.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return rect.left >= 8 && rect.top >= 8
      && rect.right <= window.innerWidth - 8
      && rect.bottom <= window.innerHeight - 8
  })).toBe(true)

  // 候補に規格・摘要の行が付いて背が高くなったので、先に見える所へ動かす（スクロールでカードは閉じる）。
  await boxes.nth(1).scrollIntoViewIfNeeded()
  await boxes.nth(1).hover()
  await expect(card).toContainText('摘要: 種別 壁用')
  await picker.getByLabel('構成要素を検索', { exact: true }).hover()
  await expect(card).toHaveCount(0)

  await boxes.nth(0).hover()
  await picker.locator('.line-picker-results').evaluate(element => {
    element.dispatchEvent(new Event('scroll'))
  })
  await expect(card).toHaveCount(0)

  await boxes.nth(1).hover()
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await expect(card).toHaveCount(0)

  await components.getByRole('button', { name: '構成要素を追加', exact: true }).click()
  await boxes.nth(0).hover()
  await boxes.nth(0).click()
  await expect(picker).toHaveCount(0)
  await expect(card).toHaveCount(0)
  await expect(components.getByRole('button', { name: 'OB-Cを外す', exact: true }))
    .toBeVisible()

  // 最近の選択にも同じカードを出し、選ぶと消す。
  const recent = panel(page).getByRole('group', { name: '最近使った項目', exact: true })
  const recentBox = recent.getByRole('button', {
    name: '最近のOB-C アウトレットボックス', exact: true,
  })
  await recentBox.hover()
  await expect(card).toContainText('摘要: 種別 天井用')
  await recentBox.click()
  await expect(card).toHaveCount(0)
})

const panel = (page: Page) => page.getByTestId('fixture-panel')
const fixtureRow = (page: Page, code: string, name: string) =>
  panel(page).getByRole('button', { name: `${code} ${name}`, exact: true })
const fixtureLi = (page: Page, code: string, name: string) =>
  fixtureRow(page, code, name).locator('..')
const total = (page: Page, code: string, name: string) =>
  fixtureLi(page, code, name).locator('.fixture-total-button')
const breakdown = (page: Page) => page.getByTestId('quantity-breakdown')
const basis = (page: Page) =>
  breakdown(page).getByRole('region', { name: '計算の根拠', exact: true })
const preview = (dialog: Locator) =>
  dialog.getByRole('region', { name: '連動の見本', exact: true })

function linkedWorkbookCells(bytes: Uint8Array): Map<string, Map<string, string | number | null>> {
  const decoder = new TextDecoder()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const files = new Map<string, string>()
  let offset = 0
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    expect(view.getUint16(offset + 8, true)).toBe(0)
    const size = view.getUint32(offset + 18, true)
    const nameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength))
    const start = offset + 30 + nameLength + extraLength
    files.set(name, decoder.decode(bytes.subarray(start, start + size)))
    offset = start + size
  }
  const unescape = (value: string) => value.replace(/&#13;/g, '\r')
    .replace(/&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
  const strings = [...files.get('xl/sharedStrings.xml')!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
    .map(match => unescape(match[1]))
  const workbook = files.get('xl/workbook.xml')!
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*\bname="([^"]+)"/g)]
  return new Map(sheets.map((sheet, index) => {
    const xml = files.get(`xl/worksheets/sheet${index + 1}.xml`)!
    const cells = new Map<string, string | number | null>()
    for (const match of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const reference = match[1].match(/\br="([^"]+)"/)![1]
      const value = match[2]?.match(/<v>([^<]*)<\/v>/)?.[1]
      cells.set(reference, value === undefined ? null
        : /\bt="s"/.test(match[1]) ? strings[Number(value)] : Number(value))
    }
    return [unescape(sheet[1]), cells] as const
  }))
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('karu-pdf:fixture-panel-settings-open', 'true')
  })
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '連動の試験.pdf'), blankPdf())
  await page.evaluate(() => window.__karu!.setZoom(1))
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await expect(panel(page).getByRole('button', { name: '項目を追加', exact: true }))
    .toBeEnabled()
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

async function markCount(page: Page) {
  return page.evaluate(() => window.__karu!.getEditableAnnotations(0)
    .filter(annotation => annotation.count && !annotation.quantity).length)
}

async function addDialog(page: Page, code: string, name: string) {
  await panel(page).getByRole('button', { name: '項目を追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await dialog.getByLabel('略号', { exact: true }).fill(code)
  await dialog.getByLabel('規格', { exact: true }).fill('')
  await dialog.getByLabel('名称', { exact: true }).fill(name)
  await dialog.getByRole('radio', { name: '個数', exact: true }).check()
  return dialog
}

async function addFixture(page: Page, code: string, name: string) {
  const dialog = await addDialog(page, code, name)
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

async function editDialog(page: Page, code: string, name: string) {
  await fixtureRow(page, code, name).click()
  await panel(page).getByRole('button', { name: '編集', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を編集', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

async function openDetails(dialog: Locator, selector: string) {
  const details = dialog.locator(selector)
  if (!await details.evaluate(element => (element as HTMLDetailsElement).open)) {
    await details.locator('summary').click()
  }
}

async function closeBreakdown(page: Page) {
  await breakdown(page).getByRole('button', { name: '閉じる', exact: true }).click()
  await expect(breakdown(page)).toHaveCount(0)
}

async function setupSources(page: Page) {
  await addFixture(page, 'DL', 'ダウンライト')
  await fixtureRow(page, 'DL', 'ダウンライト').click()
  await point(page, 100, 200)
  await point(page, 180, 200)
  await point(page, 260, 200)
  await expect(total(page, 'DL', 'ダウンライト')).toHaveText('3')

  await addFixture(page, 'SL', 'スポットライト')
  await fixtureRow(page, 'SL', 'スポットライト').click()
  await point(page, 100, 300)
  await expect(total(page, 'SL', 'スポットライト')).toHaveText('1')
  expect(await markCount(page)).toBe(4)
}

async function addInstallation(page: Page) {
  const dialog = await addDialog(page, 'INST', '器具取付')
  await openDetails(dialog, '.fixture-link')
  await dialog.getByLabel('連動にする', { exact: true }).check()
  await dialog.getByLabel('DL ダウンライトを元にする', { exact: true }).check()
  await dialog.getByLabel('SL スポットライトを元にする', { exact: true }).check()
  await dialog.getByLabel('SLの係数', { exact: true }).fill('2')
  await expect(preview(dialog)).toContainText('合計 5 個')
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(total(page, 'INST', '器具取付')).toHaveText('5')
}

async function setFixtureCategory(dialog: Locator, category: string) {
  const select = dialog.getByLabel('分類', { exact: true })
  const exists = await select.locator('option').evaluateAll((options, value) =>
    options.some(option => (option as HTMLOptionElement).value === value), category)
  if (exists) await select.selectOption(category)
  else {
    await select.selectOption('')
    await dialog.getByLabel('新しい分類の名前', { exact: true }).fill(category)
  }
}

async function savedFixture(page: Page, name: string) {
  const bytes = await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!])
  const doc = new mupdf.PDFDocument(new Uint8Array(bytes))
  try {
    const fixture = readCountFixtures(doc).find(item => item.name === name)
    expect(fixture, `${name}が保存されていること`).toBeDefined()
    return fixture!
  } finally { doc.destroy() }
}

async function addStandardLinkedDetail(page: Page, name: string, carryClass?: string) {
  await panel(page).getByRole('button', { name: /標準マスタ/ }).click()
  const dialog = page.getByRole('dialog', { name: '標準マスタから追加', exact: true })
  await dialog.getByRole('tab', { name: '内訳書から選ぶ', exact: true }).click()
  await expect(dialog.getByText('内訳書のマスタを読み込んでいます…', { exact: true }))
    .toHaveCount(0)
  const picker = dialog.getByRole('tabpanel', { name: '内訳書から選ぶ', exact: true })
  // Search the master, then open the first 別紙明細 that offers this detail (器具取付 is under 施工費).
  await dialog.getByLabel('内訳書を検索', { exact: true }).fill(name)
  const detail = picker.getByRole('checkbox', { name: new RegExp(`^${name}（`) }).first()
  if (!await detail.isVisible()) await picker.getByRole('button', { name: /^明細を選ぶ/ }).first().click()
  await expect(detail, `内訳書から「${name}」を選べること`).toBeVisible()
  await detail.check()
  if (carryClass) {
    const value = picker.getByRole('checkbox', { name: new RegExp(carryClass) }).first()
    if (await value.count()) await value.check()
  }
  await dialog.getByRole('button', { name: /^選んだ項目を追加（/ }).click()
  await expect(dialog.getByRole('status')).toContainText(
    `連動の規則を付けました: ${name}${carryClass ? `（${carryClass}）` : ''}`,
  )
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  return savedFixture(page, name)
}

test('標準マスタの器具取付は照明器具を自動で元にし、後から追加した項目も反映する', async ({ page }) => {
  test.setTimeout(180_000)
  let dialog = await addDialog(page, 'DL', 'ダウンライト')
  await setFixtureCategory(dialog, '照明器具')
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  await fixtureRow(page, 'DL', 'ダウンライト').click()
  await point(page, 100, 200)
  await point(page, 180, 200)

  dialog = await addDialog(page, 'P-1', '盤 P-1')
  await setFixtureCategory(dialog, '盤類')
  await openDetails(dialog, '.fixture-attributes')
  await dialog.getByLabel('単体質量（kg）', { exact: true }).fill('1200')
  await dialog.getByLabel('幅（mm）', { exact: true }).fill('800')
  await dialog.getByLabel('奥行（mm）', { exact: true }).fill('400')
  await dialog.getByLabel('高さ（mm）', { exact: true }).fill('1800')
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  await fixtureRow(page, 'P-1', '盤 P-1').click()
  await point(page, 260, 200)

  const installation = await addStandardLinkedDetail(page, '器具取付')
  expect(installation.link?.sources).toEqual([])
  expect(installation.link?.auto).toEqual({ categories: ['照明器具'], kinds: ['count'] })
  expect(installation.convert).toBeUndefined()
  await expect(fixtureLi(page, installation.code, installation.name).locator('.fixture-link-badge'))
    .toHaveText('連動')
  await expect(total(page, installation.code, installation.name)).toHaveText('2')
  await total(page, installation.code, installation.name).click()
  await expect(breakdown(page)).toContainText('全図面 2 個')
  await expect(basis(page)).toContainText('DL ダウンライト（自動）')
  await expect(basis(page)).not.toContainText('盤 P-1')
  await closeBreakdown(page)

  dialog = await addDialog(page, 'SL', 'スポットライト')
  await setFixtureCategory(dialog, '照明器具')
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  await fixtureRow(page, 'SL', 'スポットライト').click()
  await point(page, 100, 300)
  await expect(total(page, installation.code, installation.name)).toHaveText('3')

  dialog = await editDialog(page, installation.code, installation.name)
  await expect(dialog.getByLabel('標準の規則', { exact: true }))
    .toHaveValue('install-fixtures')
  const automatic = dialog.getByRole('region', { name: '自動で元にする項目', exact: true })
  await expect(automatic).toContainText('分類「照明器具」・個数の項目')
  await expect(automatic).toContainText('今当たっている項目: 2件')
  await dialog.getByRole('button', { name: '変更する', exact: true }).click()
  await expect(dialog).toHaveCount(0)
})

test('標準マスタの機器搬入は重量品の補正率と単独搬入を反映する', async ({ page }) => {
  test.setTimeout(180_000)
  // SPEC-T15: 電気の機器搬入は受変電・電力貯蔵装置等（単価積算基準 第3編）。受配電盤を元にする
  let dialog = await addDialog(page, 'P-1', '受配電盤 P-1')
  await setFixtureCategory(dialog, '盤類')
  await openDetails(dialog, '.fixture-attributes')
  await dialog.getByLabel('単体質量（kg）', { exact: true }).fill('1200')
  await dialog.getByLabel('幅（mm）', { exact: true }).fill('800')
  await dialog.getByLabel('奥行（mm）', { exact: true }).fill('400')
  await dialog.getByLabel('高さ（mm）', { exact: true }).fill('1800')
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  await fixtureRow(page, 'P-1', '受配電盤 P-1').click()
  await point(page, 100, 200)

  const carry = await addStandardLinkedDetail(page, '機器搬入', '重量品')
  expect(carry.link?.carry).toEqual({ class: 'heavy' })
  expect(carry.convert).toBeUndefined()
  await expect(total(page, carry.code, carry.name)).toHaveText('1.02')
  await expect(fixtureLi(page, carry.code, carry.name).locator('.fixture-row-unit'))
    .toHaveText('t')
  await total(page, carry.code, carry.name).click()
  await expect(breakdown(page)).toContainText('全図面 1.02 t')
  await expect(basis(page)).toContainText('質量 1200kg × 補正率 0.85')
  await closeBreakdown(page)

  dialog = await editDialog(page, carry.code, carry.name)
  await expect(dialog.getByRole('radio', { name: '重量品だけ', exact: true })).toBeChecked()
  await expect(preview(dialog)).toContainText('重量品 1,200kg・補正率 0.85')
  await dialog.getByLabel('単独搬入（補正率を30％増し）', { exact: true }).check()
  await expect(preview(dialog)).toContainText('合計 1.33 t')
  await expect(preview(dialog)).toContainText('補正率 1.105')
  await dialog.getByRole('button', { name: '変更する', exact: true }).click()
  await expect(total(page, carry.code, carry.name)).toHaveText('1.33')
  expect((await savedFixture(page, carry.name)).link?.carry)
    .toEqual({ class: 'heavy', alone: true })
})

test('発生材処分の種類だけで単位が㎥になり、配管撤去のJIS根拠を表示する', async ({ page }) => {
  test.setTimeout(180_000)
  const waste = await addStandardLinkedDetail(page, '発生材処分')
  expect(waste.link?.kind).toBe('mass')
  expect(waste.link?.auto).toEqual({ condition: '撤去（廃棄）' })
  expect(waste.attributes?.wasteType).toBeUndefined()

  let dialog = await editDialog(page, waste.code, waste.name)
  await dialog.getByLabel('発生材の種類', { exact: true }).selectOption('金属くず')
  await expect(dialog.getByLabel('見かけ比重（t/㎥）', { exact: true })).toHaveValue('')
  await expect(dialog.getByText(/^単位: ㎥/)).toBeVisible()
  await dialog.getByRole('button', { name: '変更する', exact: true }).click()
  await expect(fixtureLi(page, waste.code, waste.name).locator('.fixture-row-unit'))
    .toHaveText('㎥')

  dialog = await addDialog(page, 'E25', '配管撤去')
  await dialog.getByRole('radio', { name: '長さ', exact: true }).check()
  await dialog.getByLabel('追加する施工条件', { exact: true }).fill('撤去（廃棄）')
  await dialog.locator('.fixture-condition-add')
    .getByRole('button', { name: '追加', exact: true }).click()
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()

  await total(page, waste.code, waste.name).click()
  await expect(basis(page)).toContainText('E25 配管撤去（自動）')
  await expect(basis(page)).toContainText('JIS C 8305 の質量')
  await expect(basis(page)).toContainText('÷ 1.13 t/㎥（金属くず）')
  await closeBreakdown(page)

  dialog = await editDialog(page, waste.code, waste.name)
  await dialog.getByLabel('見かけ比重（t/㎥）', { exact: true }).fill('0.5')
  await expect(preview(dialog)).toContainText('÷ 0.5 t/㎥')
  await dialog.getByLabel('発生材の種類', { exact: true }).selectOption('金属くず')
  await expect(dialog.getByLabel('見かけ比重（t/㎥）', { exact: true })).toHaveValue('')
  await dialog.getByRole('button', { name: '変更する', exact: true }).click()
})

test('標準の規則を切り替えても手動の元と係数を残し、自動の選択を解除できる', async ({ page }) => {
  await setupSources(page)
  let dialog = await editDialog(page, 'DL', 'ダウンライト')
  await setFixtureCategory(dialog, '照明器具')
  await dialog.getByRole('button', { name: '変更する', exact: true }).click()
  dialog = await editDialog(page, 'SL', 'スポットライト')
  await setFixtureCategory(dialog, '照明器具')
  await dialog.getByRole('button', { name: '変更する', exact: true }).click()

  dialog = await addDialog(page, 'RULE', '規則の確認')
  await openDetails(dialog, '.fixture-link')
  await dialog.getByLabel('連動にする', { exact: true }).check()
  await dialog.getByLabel('DL ダウンライトを元にする', { exact: true }).check()
  await dialog.getByLabel('DLの係数', { exact: true }).fill('2')
  await dialog.getByLabel('標準の規則', { exact: true }).selectOption('install-fixtures')
  await expect(dialog.getByLabel('DL ダウンライトを元にする', { exact: true })).toBeChecked()
  await expect(dialog.getByLabel('DLの係数', { exact: true })).toHaveValue('2')
  await expect(preview(dialog)).toContainText('合計 7 個')

  await dialog.getByLabel('標準の規則', { exact: true }).selectOption('outlet-box')
  await expect(dialog.getByLabel('標準の規則', { exact: true })).toHaveValue('outlet-box')
  await dialog.getByRole('button', { name: '自動の選択をやめる', exact: true }).click()
  await expect(dialog.getByRole('region', { name: '自動で元にする項目', exact: true }))
    .toHaveCount(0)
  await expect(preview(dialog)).toContainText('合計 6 個')
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()

  const fixture = await savedFixture(page, '規則の確認')
  expect(fixture.link?.auto).toBeUndefined()
  expect(fixture.link?.sources).toHaveLength(1)
  expect(fixture.link?.sources[0].factor).toBe(2)
})

test('集計表の連動の札と元への移動、Excelの計算根拠', async ({ page }) => {
  test.setTimeout(120_000)
  // ネイティブの保存画面を使わず、ダウンロードで検証する。
  await page.evaluate(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker
  })
  await setupSources(page)
  await addInstallation(page)
  await page.getByRole('button', { name: '集計表を開く', exact: true }).click()
  const table = page.getByRole('region', { name: '数量の集計表', exact: true })
  const installation = table.locator('tr[data-fixture-id]').filter({ hasText: '器具取付' })
  await expect(installation).toHaveCount(1)
  await expect(installation.locator('.fixture-link-badge')).toHaveText('連動')
  await expect(installation.getByRole('button', {
    name: 'INST 器具取付の全図面の内訳', exact: true,
  })).toHaveText('5')
  const drawingQuantity = installation.locator('button[data-column-key]').first()
  await expect(drawingQuantity).toHaveText('5')
  await drawingQuantity.click()
  await expect(fixtureRow(page, 'DL', 'ダウンライト')).toHaveAttribute('aria-pressed', 'true')
  expect(await markCount(page)).toBe(4)

  const download = page.waitForEvent('download')
  await table.getByRole('button', { name: 'Excelに書き出す', exact: true }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('連動の試験_数量集計表.xlsx')
  const bytes = await fs.readFile(await file.path())
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK')
  const sheets = linkedWorkbookCells(bytes)
  expect([...sheets.keys()].at(-1)).toBe('計算根拠')
  const cells = sheets.get('計算根拠')!
  expect(cells).toBeDefined()
  expect(cells.get('A1')).toBe('連動の試験 連動の計算根拠')
  expect(cells.get('A3')).toBe('連動項目')
  expect(cells.get('H3')).toBe('小計')
  for (const [code, quantity, calculation, subtotal] of [
    ['DL', 3, '× 1', 3],
    ['SL', 1, '× 2', 2],
  ] as const) {
    const matches = [...cells].filter(([reference, value]) => /^C\d+$/.test(reference) && value === code)
    expect(matches).toHaveLength(1)
    const row = matches[0][0].slice(1)
    expect(cells.get(`E${row}`)).toBe(quantity)
    expect(cells.get(`F${row}`)).toBe('個')
    expect(cells.get(`G${row}`)).toBe(calculation)
    expect(cells.get(`H${row}`)).toBe(subtotal)
  }
  const totals = [...cells].filter(([reference, value]) => /^A\d+$/.test(reference) && value === '合計')
  expect(totals).toHaveLength(1)
  expect(cells.get(`H${totals[0][0].slice(1)}`)).toBe(5)
  expect([...sheets.get('集計表')!.values()]).toContain('器具取付［連動］')
  await expect(table.getByRole('button', { name: 'Excelに書き出す', exact: true })).toBeEnabled()
  await expect(table.getByRole('alert')).toHaveCount(0)
})

test('見本、連動の札、拾い防止、根拠、元の削除とUndo、上書き', async ({ page }) => {
  await setupSources(page)
  await addInstallation(page)

  const installation = fixtureLi(page, 'INST', '器具取付')
  await expect(installation.locator('.fixture-link-badge'))
    .toHaveText('連動')

  // 選択の道具から連動項目を選んでも、拾いの道具へ切り替えない。
  const selectionTool = page.getByRole('button', { name: '選択', exact: true })
  await selectionTool.click()
  await fixtureRow(page, 'INST', '器具取付').click()
  await expect(selectionTool).toHaveAttribute('aria-pressed', 'true')
  await expect(panel(page).getByText(LINK_STATUS, { exact: true })).toBeVisible()
  await point(page, 350, 350)
  expect(await markCount(page)).toBe(4)

  // 既に拾いの道具が有効でも、連動項目のクリックで印を作らない。
  await fixtureRow(page, 'DL', 'ダウンライト').click()
  await fixtureRow(page, 'INST', '器具取付').click()
  await point(page, 380, 380)
  expect(await markCount(page)).toBe(4)
  await expect(total(page, 'INST', '器具取付')).toHaveText('5')

  await total(page, 'INST', '器具取付').click()
  await expect(basis(page)).toContainText('DL ダウンライト')
  await expect(basis(page)).toContainText('SL スポットライト')
  await expect(basis(page)).toContainText('3個 × 1 ＝ 3 個')
  await expect(basis(page)).toContainText('1個 × 2 ＝ 2 個')
  await expect(basis(page)).toContainText('合計 5 個')
  await expect(basis(page)).toContainText('合計で切り上げ')

  // 派生した内訳の位置へ移動すると、元の拾い自身の項目を選ぶ。
  await breakdown(page).getByRole('button', { name: 'ページ別', exact: true }).click()
  await breakdown(page).locator('.quantity-breakdown-page').click()
  await expect(fixtureRow(page, 'DL', 'ダウンライト'))
    .toHaveAttribute('aria-pressed', 'true')
  await closeBreakdown(page)

  await fixtureRow(page, 'SL', 'スポットライト').click()
  const confirmation = page.waitForEvent('dialog')
  const deletion = panel(page).getByRole('button', { name: '削除', exact: true }).click()
  const message = await confirmation
  expect(message.message()).toContain('連動項目「器具取付」の元から外れ')
  await message.accept()
  await deletion
  await expect(total(page, 'INST', '器具取付')).toHaveText('3')
  await expect(fixtureRow(page, 'SL', 'スポットライト')).toHaveCount(0)

  await page.keyboard.press('Control+z')
  await expect(total(page, 'INST', '器具取付')).toHaveText('5')
  await expect(total(page, 'SL', 'スポットライト')).toHaveText('1')

  const dialog = await editDialog(page, 'INST', '器具取付')
  await expect(dialog.locator('.fixture-link')).toHaveAttribute('open', '')
  await dialog.getByLabel('数量を手で上書きする', { exact: true }).check()
  await dialog.getByLabel('上書きの数量', { exact: true }).fill('10')
  await dialog.getByLabel('上書きの理由の候補', { exact: true }).selectOption('other')
  await dialog.getByLabel('上書きの理由', { exact: true }).fill('現場の指示による')
  await expect(preview(dialog)).toContainText('合計 10 個')
  await dialog.getByRole('button', { name: '変更する', exact: true }).click()

  await expect(total(page, 'INST', '器具取付')).toHaveText('10')
  await expect(installation.locator('.fixture-link-override')).toHaveText('上書き')
  await total(page, 'INST', '器具取付').click()
  await expect(basis(page)).toContainText('計算値 5、差 +5')
  await expect(basis(page)).toContainText('現場の指示による')
  await closeBreakdown(page)

  // 保存されたPDFにも連動・係数・上書き理由が残る。
  const bytes = await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!])
  const doc = new mupdf.PDFDocument(new Uint8Array(bytes))
  try {
    const fixtures = readCountFixtures(doc)
    const installed = fixtures.find(f => f.code === 'INST')!
    const sl = fixtures.find(f => f.code === 'SL')!
    expect(installed.link?.kind).toBe('factor')
    expect(installed.link?.sources.find(source => source.itemId === sl.id)?.factor).toBe(2)
    expect(installed.link?.override).toEqual({
      value: 10, note: '現場の指示による',
    })
  } finally { doc.destroy() }
})

test('質量・寸法、tと㎥、拾いのある項目の禁止、循環の保存拒否', async ({ page }) => {
  await setupSources(page)
  await addInstallation(page)

  let dialog = await editDialog(page, 'DL', 'ダウンライト')
  await openDetails(dialog, '.fixture-link')
  await expect(dialog.getByLabel('連動にする', { exact: true })).toBeDisabled()
  await expect(dialog.getByText('拾いがある項目は連動にできません', { exact: true }))
    .toBeVisible()

  await openDetails(dialog, '.fixture-attributes')
  await dialog.getByLabel('単体質量（kg）', { exact: true }).fill('2')
  await dialog.getByLabel('幅（mm）', { exact: true }).fill('100')
  await dialog.getByLabel('奥行（mm）', { exact: true }).fill('80')
  await dialog.getByLabel('高さ（mm）', { exact: true }).fill('60')
  await dialog.getByLabel('外径（mm）', { exact: true }).fill('50')
  await dialog.getByLabel('発生材の種類', { exact: true }).fill('金属くず')
  await dialog.getByRole('button', { name: '変更する', exact: true }).click()

  dialog = await addDialog(page, 'WASTE', '発生材')
  await openDetails(dialog, '.fixture-link')
  await dialog.getByLabel('連動にする', { exact: true }).check()
  await dialog.getByRole('radio', { name: '質量に換算する（t・㎥）', exact: true }).check()
  await dialog.getByLabel('DL ダウンライトを元にする', { exact: true }).check()
  await expect(dialog.getByText('単体 2 kg', { exact: true })).toBeVisible()
  await expect(preview(dialog)).toContainText('合計 0.01 t')
  await expect(preview(dialog)).toContainText('0.006 t')
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()

  await expect(total(page, 'WASTE', '発生材')).toHaveText('0.01')
  await expect(fixtureLi(page, 'WASTE', '発生材').locator('.fixture-row-unit'))
    .toHaveText('t')
  await total(page, 'WASTE', '発生材').click()
  await expect(basis(page)).toContainText('× 2 kg ÷ 1000')
  await expect(basis(page)).toContainText('合計 0.01 t')
  await closeBreakdown(page)

  dialog = await editDialog(page, 'WASTE', '発生材')
  await dialog.getByLabel('見かけ比重（t/㎥）', { exact: true }).fill('0.5')
  await expect(preview(dialog)).toContainText('合計 0.01 ㎥')
  await expect(preview(dialog)).toContainText('0.012 ㎥')
  await dialog.getByRole('button', { name: '変更する', exact: true }).click()
  await expect(fixtureLi(page, 'WASTE', '発生材').locator('.fixture-row-unit'))
    .toHaveText('㎥')

  // 器具取付 → 発生材を保存し、発生材 → 器具取付で循環させる。
  dialog = await editDialog(page, 'INST', '器具取付')
  await dialog.getByLabel('WASTE 発生材を元にする', { exact: true }).check()
  await dialog.getByRole('button', { name: '変更する', exact: true }).click()

  dialog = await editDialog(page, 'WASTE', '発生材')
  await dialog.getByLabel('INST 器具取付を元にする', { exact: true }).check()
  await expect(preview(dialog)).toContainText('連動の元が循環しています。')
  await dialog.getByRole('button', { name: '変更する', exact: true }).click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('alert').filter({
    hasText: '連動の元が循環しています。',
  }).last()).toHaveText('連動の元が循環しています。')
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click()

  const bytes = await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!])
  const doc = new mupdf.PDFDocument(new Uint8Array(bytes))
  try {
    const fixtures = readCountFixtures(doc)
    const dl = fixtures.find(f => f.code === 'DL')!
    const waste = fixtures.find(f => f.code === 'WASTE')!
    const installed = fixtures.find(f => f.code === 'INST')!
    expect(dl.attributes).toEqual({
      massKg: 2, widthMm: 100, depthMm: 80, heightMm: 60,
      outerDiameterMm: 50, wasteType: '金属くず',
    })
    // Mass links are never rounded up, so no rounding setting is stored for them.
    expect(waste.link?.rounding).toBeUndefined()
    expect(waste.link?.densityTPerM3).toBe(.5)
    expect(waste.link?.sources.some(source => source.itemId === installed.id)).toBe(false)
  } finally { doc.destroy() }
})

test('元なしと不正係数の検査、換算の解除、検索、条件、間隔と切り上げ', async ({ page }) => {
  await setupSources(page)

  let dialog = await editDialog(page, 'DL', 'ダウンライト')
  await dialog.getByLabel('追加する施工条件', { exact: true }).fill('露出')
  await dialog.locator('.fixture-condition-add')
    .getByRole('button', { name: '追加', exact: true }).click()
  await dialog.getByRole('button', { name: '変更する', exact: true }).click()

  dialog = await addDialog(page, 'CHECK', '入力確認')
  await openDetails(dialog, '.fixture-convert')
  await dialog.getByLabel('数量を換算する', { exact: true }).check()
  await dialog.getByLabel('換算の係数', { exact: true }).fill('2')

  await openDetails(dialog, '.fixture-link')
  await dialog.getByLabel('連動にする', { exact: true }).check()
  await expect(dialog.getByText(
    '連動にすると数量の換算は使えません（換算を外しました）',
    { exact: true },
  )).toBeVisible()
  await expect(dialog.getByLabel('数量を換算する', { exact: true })).not.toBeChecked()
  await expect(dialog.getByLabel('数量を換算する', { exact: true })).toBeDisabled()

  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  await expect(dialog.getByRole('alert').last())
    .toHaveText('元の項目を1つ以上選んでください')

  const search = dialog.getByLabel('元の項目を検索', { exact: true })
  await search.fill('DL')
  await expect(dialog.getByLabel('DL ダウンライトを元にする', { exact: true }))
    .toBeVisible()
  await expect(dialog.getByLabel('SL スポットライトを元にする', { exact: true }))
    .toHaveCount(0)
  await search.fill('ダウンライト')
  await expect(dialog.getByLabel('DL ダウンライトを元にする', { exact: true }))
    .toBeVisible()
  await search.fill('その他')
  await expect(dialog.getByLabel('SL スポットライトを元にする', { exact: true }))
    .toBeVisible()

  await dialog.getByLabel('DL ダウンライトを元にする', { exact: true }).check()
  await dialog.getByLabel('DLの係数', { exact: true }).fill('0')
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  await expect(dialog.getByRole('alert').last())
    .toHaveText('連動の係数は0より大きく10000以下の数で入れてください。')

  await dialog.getByLabel('DLの計算', { exact: true }).selectOption('spacing')
  await expect(dialog.getByLabel('DLの間隔（m）', { exact: true })).toHaveValue('1.5')
  await dialog.getByLabel('切り上げ', { exact: true }).selectOption('each')
  await expect(preview(dialog)).toContainText('合計 3 個')
  await dialog.getByLabel('切り上げ', { exact: true }).selectOption('none')
  await expect(preview(dialog)).toContainText('合計 2 個')
  await dialog.getByLabel('切り上げ', { exact: true }).selectOption('total')

  await dialog.getByLabel('DLを露出だけにする', { exact: true }).check()
  await expect(preview(dialog)).toContainText('合計 0 個')
  await dialog.getByLabel('DLを未設定だけにする', { exact: true }).check()
  await expect(preview(dialog)).toContainText('合計 2 個')
  await dialog.getByLabel('DLを露出だけにする', { exact: true }).uncheck()

  await dialog.getByRole('radio', { name: '固定する', exact: true }).check()
  await expect(dialog.getByText('施工条件の候補を先に入れてください', { exact: true }))
    .toBeVisible()
  await dialog.getByLabel('追加する施工条件', { exact: true }).fill('取付')
  await dialog.locator('.fixture-condition-add')
    .getByRole('button', { name: '追加', exact: true }).click()
  await dialog.getByLabel('連動の施工条件', { exact: true }).selectOption('取付')
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  await expect(total(page, 'CHECK', '入力確認')).toHaveText('2')

  await total(page, 'CHECK', '入力確認').click()
  await breakdown(page).getByRole('button', { name: '施工条件別', exact: true }).click()
  await expect(breakdown(page).locator('[data-condition="取付"]')).toContainText('2 個')
  await closeBreakdown(page)

  // 連動を解除すると数量の換算を再び設定できる。
  dialog = await editDialog(page, 'CHECK', '入力確認')
  await dialog.getByLabel('連動にする', { exact: true }).uncheck()
  await openDetails(dialog, '.fixture-convert')
  await expect(dialog.getByLabel('数量を換算する', { exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: '変更する', exact: true }).click()
  await expect(fixtureLi(page, 'CHECK', '入力確認').locator('.fixture-link-badge'))
    .toHaveCount(0)
  await expect(total(page, 'CHECK', '入力確認')).toHaveText('0')
})
