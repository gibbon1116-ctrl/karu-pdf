import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import { listAnnotations } from '../src/core/annotations'
import { readCountFixtures } from '../src/core/countFixtures'
import { writePageScale } from '../src/core/measure'

// The display settings sit in a folded section of the quantity tab (SPEC-S14); these tests use them.
test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.setItem('karu-pdf:fixture-panel-settings-open', 'true')) })

// All PDFs and saved bytes remain in memory; this suite writes no fixture files.
function blankPdf(mmPerPoint = 25.4 / 72 * 100) {
  const doc = new mupdf.PDFDocument()
  try {
    const ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
    try { doc.insertPage(-1, ref) } finally { ref.destroy() }
    const page = doc.loadPage(0)
    try { writePageScale(doc, page, { denominator: mmPerPoint * 72 / 25.4, paper: 'PDF', source: 'ratio', mmPerPoint, unit: 'm', decimals: 2 }) } finally { page.destroy() }
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { doc.destroy() }
}
const panel = (p: Page) => p.getByTestId('fixture-panel')
const format = (p: Page) => p.getByTestId('format-panel')
const picker = (p: Page) => p.getByRole('dialog', { name: '線要素を追加', exact: true })
const row = (p: Page, code: string, name: string) => panel(p).getByRole('button', { name: code + ' ' + name, exact: true })
async function point(page: Page, x: number, y: number) {
  const layer = page.getByTestId('annotation-layer-0')
  const position = await layer.evaluate((element, p) => { const svg = element as SVGSVGElement, rect = svg.getBoundingClientRect(); return { x: p.x * rect.width / svg.viewBox.baseVal.width, y: p.y * rect.height / svg.viewBox.baseVal.height } }, { x, y })
  await layer.click({ position })
}
async function draw(page: Page, y: number) { await point(page, 100, y); await point(page, 172, y); await page.keyboard.press('Enter') }
async function selectRoute(page: Page, y = 220) { await page.getByRole('button', { name: '選択', exact: true }).click(); await point(page, 136, y); await expect(format(page).getByText('経路構成', { exact: true })).toBeVisible() }
async function open(page: Page, bytes = blankPdf()) {
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(b => window.__karu!.openBytes(b, '経路構成.pdf'), bytes)
  await page.evaluate(() => window.__karu!.setZoom(1))
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await expect(panel(page).getByRole('button', { name: '項目を追加', exact: true })).toBeEnabled()
}
async function addFixture(
  page: Page, code: string, spec: string, name: string,
  configure?: (dialog: ReturnType<Page['getByRole']>) => Promise<void>,
) {
  await panel(page).getByRole('button', { name: '項目を追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await dialog.getByLabel('略号', { exact: true }).fill(code)
  await dialog.getByLabel('規格', { exact: true }).fill(spec)
  await dialog.getByLabel('名称', { exact: true }).fill(name)
  await dialog.getByRole('radio', { name: '長さ', exact: true }).check()
  if (configure) await configure(dialog)
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
}
async function setup(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await open(page)
  await addFixture(page, 'EM-CE', '5.5sq-3C', 'ケーブル')
  await addFixture(page, 'IV', '5.5sq', '接地線')
  await addFixture(page, 'PF22', '', '電線管')
  await row(page, 'EM-CE 5.5sq-3C', 'ケーブル').click()
  await draw(page, 220)
}
async function addLine(page: Page, query: string, code: string, master = false) {
  await format(page).getByRole('button', { name: '線要素を追加', exact: true }).click()
  await expect(picker(page).getByLabel('線要素を検索', { exact: true })).toBeFocused()
  await picker(page).getByLabel('線要素を検索', { exact: true }).fill(query)
  const section = picker(page).locator('section').filter({ has: page.getByRole('heading', { name: master ? '標準マスタ' : 'この PDF の項目', exact: true }) })
  await section.getByRole('button', { name: code, exact: true }).click()
  await expect(picker(page)).toHaveCount(0)
}
const routes = (p: Page) => p.evaluate(() => window.__karu!.getEditableAnnotations(0).filter(a => a.quantity).map(a => a.quantity!))
async function saveBytes(page: Page) { return page.evaluate(async () => [...(await window.__karu!.saveToBytes())!]) }

test('経路構成、1クリック追加、原子的Undo、条数、主の変更、図面の札と保存', async ({ page }) => {
  await setup(page)
  await expect(format(page).getByText('経路構成', { exact: true })).toBeVisible()
  await expect(format(page).getByText('1種類・1条', { exact: true })).toBeVisible()
  await expect(format(page).locator('.route-item-main')).toContainText('EM-CE 5.5sq-3C')
  await expect(format(page).locator('.route-item')).toHaveCount(1)
  await expect(page.locator('.route-composition-badge')).toHaveCount(0)

  await addLine(page, 'iv', 'IV 5.5sq')
  await expect(format(page).locator('.route-item')).toHaveCount(2)
  await expect(format(page).getByText('2種類・2条', { exact: true })).toBeVisible()
  await expect(format(page).locator('.route-item-added')).toContainText('IV 5.5sq')
  await expect(format(page).getByRole('status')).toContainText('IV 5.5sq を足しました')
  await expect(page.locator('.pickup-route-row .route-item-added')).toContainText('IV 5.5sq')
  await format(page).getByRole('button', { name: '線要素を追加', exact: true }).click()
  await picker(page).getByLabel('線要素を検索', { exact: true }).fill('iv')
  const added = picker(page).getByRole('button', { name: 'IV 5.5sq 追加済み', exact: true })
  await expect(added.first()).toBeDisabled()
  await page.keyboard.press('Escape'); await expect(picker(page)).toHaveCount(0)
  await expect(format(page).getByText('経路構成', { exact: true })).toBeVisible()

  await addLine(page, 'pf2', 'PF28', true)
  await expect(format(page).locator('.route-item')).toHaveCount(3)
  await expect(panel(page).locator('.fixture-row-code').filter({ hasText: /^PF28\s*$/ })).toHaveCount(1)
  await page.keyboard.press('Control+z')
  await expect(panel(page).locator('.fixture-row-code').filter({ hasText: /^PF28\s*$/ })).toHaveCount(0)
  expect((await routes(page))[0].extra).toHaveLength(1)
  await page.keyboard.press('Control+y')
  await expect(panel(page).locator('.fixture-row-code').filter({ hasText: /^PF28\s*$/ })).toHaveCount(1)
  expect((await routes(page))[0].extra).toHaveLength(2)
  await selectRoute(page)

  const total = row(page, 'EM-CE 5.5sq-3C', 'ケーブル').locator('..').locator('.fixture-row-count').last()
  await expect(total).toHaveText('2.54')
  await format(page).getByRole('button', { name: 'EM-CE 5.5sq-3Cの条数を増やす', exact: true }).click()
  await expect(format(page).getByLabel('EM-CE 5.5sq-3Cの条数', { exact: true })).toHaveValue('2')
  await expect(format(page).getByText('3種類・4条', { exact: true })).toBeVisible()
  await expect(total).toHaveText('5.08')
  await expect(format(page).getByRole('status')).toContainText('EM-CE 5.5sq-3C を 2条にしました')
  await format(page).getByRole('button', { name: 'EM-CE 5.5sq-3Cの条数を減らす', exact: true }).click()
  await expect(format(page).getByRole('button', { name: 'EM-CE 5.5sq-3Cの条数を減らす', exact: true })).toBeDisabled()
  await expect(page.locator('.pickup-route-row .pickup-route-chip')).toHaveCount(3)
  await page.getByRole('button', { name: '拾いバーのEM-CE 5.5sq-3Cの条数を増やす', exact: true }).click()
  await expect(format(page).getByLabel('EM-CE 5.5sq-3Cの条数', { exact: true })).toHaveValue('2')
  await expect(page.locator('.route-composition-badge text')).toHaveText('3')
  await expect(page.locator('.route-composition-badge title')).toContainText('EM-CE 5.5sq-3C×2、IV 5.5sq、PF28')
  await expect(page.locator('.route-composition-badge')).toHaveAttribute('pointer-events', 'none')
  await panel(page).getByLabel('図面に長さ・面積・体積の数値を表示', { exact: true }).uncheck()
  await expect(page.locator('.measurement-label')).toHaveCount(0)
  await expect(page.locator('.route-composition-badge text')).toHaveText('3')
  await panel(page).getByLabel('図面に長さ・面積・体積の数値を表示', { exact: true }).check()
  await format(page).getByRole('button', { name: 'PF28を外す', exact: true }).click()
  await expect(format(page).getByRole('status')).toContainText('PF28 を外しました（Ctrl+Z で戻せます）')
  await format(page).getByRole('button', { name: 'IV 5.5sqを外す', exact: true }).click()
  await expect(page.locator('.route-composition-badge')).toHaveCount(0)
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await selectRoute(page)

  const originalColor = await page.locator('.measurement-shape > polyline').getAttribute('stroke')
  const ivColor = await format(page).getByRole('button', { name: 'IV 5.5sqを主にする', exact: true }).locator('..').locator('.fixture-swatch path').evaluate(el => getComputedStyle(el).stroke)
  await format(page).getByRole('button', { name: 'IV 5.5sqを主にする', exact: true }).click()
  await expect(format(page).locator('.route-item-main')).toContainText('IV 5.5sq')
  await expect.poll(() => page.locator('.measurement-shape > polyline').evaluate(el => getComputedStyle(el).stroke)).toBe(ivColor)
  await page.keyboard.press('Control+z'); await selectRoute(page)
  await expect(format(page).locator('.route-item-main')).toContainText('EM-CE 5.5sq-3C')
  await expect(page.locator('.measurement-shape > polyline')).toHaveAttribute('stroke', originalColor!)
  await format(page).locator('.route-item').filter({ hasText: 'PF28' }).getByLabel('平面', { exact: true }).selectOption('exclude')
  await format(page).getByRole('button', { name: '＋ 立上り・立下りを足す', exact: true }).click()
  await format(page).getByLabel('立上り・立下り1', { exact: true }).fill('3')
  await format(page).getByLabel('立上り・立下り1', { exact: true }).press('Enter')
  const before = (await routes(page))[0], bytes = await saveBytes(page), doc = new mupdf.PDFDocument(new Uint8Array(bytes))
  try {
    const saved = listAnnotations(doc, 0)[0].quantity!
    expect(saved).toMatchObject({ itemId: before.itemId, count: 2, extra: JSON.parse(JSON.stringify(before.extra)) })
    expect(readCountFixtures(doc).some(f => f.code === 'PF28')).toBe(true)
  } finally { doc.destroy() }
  await open(page, bytes); await selectRoute(page)
  expect((await routes(page))[0]).toEqual(before)
  await expect(format(page).locator('.route-item')).toHaveCount(3)
  await expect(format(page).locator('.route-item').filter({ hasText: 'PF28' }).getByLabel('平面', { exact: true })).toHaveValue('exclude')
})

test('よく使う構成を別の経路と新しい経路に使い、解除・再読込・名前変更・削除', async ({ page }) => {
  await setup(page)
  await addLine(page, 'iv', 'IV 5.5sq')
  await addLine(page, 'pf2', 'PF28', true)
  await format(page).getByLabel('EM-CE 5.5sq-3Cの条数', { exact: true }).fill('2')
  await format(page).getByLabel('EM-CE 5.5sq-3Cの条数', { exact: true }).press('Enter')
  await format(page).locator('.route-item').filter({ hasText: 'PF28' }).getByLabel('平面', { exact: true }).selectOption('exclude')
  const composition = (await routes(page))[0]
  const itemsOf = (q: typeof composition) => ({ itemId: q.itemId, count: q.count ?? 1, cond: q.cond ?? {}, extra: q.extra })
  await format(page).getByRole('button', { name: 'よく使う構成', exact: true }).click()
  const sets = page.getByRole('dialog', { name: 'よく使う構成', exact: true })
  await expect(sets.getByText('この経路の構成を登録', { exact: true })).toBeVisible()
  await sets.getByLabel('構成の名前', { exact: true }).fill('幹線A')
  await sets.getByRole('button', { name: '登録', exact: true }).click()
  await expect(sets.getByRole('button', { name: '幹線A', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await row(page, 'EM-CE 5.5sq-3C', 'ケーブル').click(); await draw(page, 300)
  await expect(format(page).locator('.route-item')).toHaveCount(3)
  // Last composition is inherited; make a different route to test saved-set Undo.
  await format(page).getByRole('button', { name: 'PF28を外す', exact: true }).click()
  await format(page).getByRole('button', { name: 'IV 5.5sqを外す', exact: true }).click()
  await expect(format(page).locator('.route-item')).toHaveCount(1)
  await format(page).getByRole('button', { name: 'よく使う構成', exact: true }).click()
  await sets.getByRole('button', { name: '幹線A', exact: true }).click()
  expect(itemsOf((await routes(page))[1])).toEqual(itemsOf(composition))
  await page.keyboard.press('Control+z'); expect((await routes(page))[1].extra).toBeUndefined()
  await page.keyboard.press('Control+y'); expect(itemsOf((await routes(page))[1])).toEqual(itemsOf(composition))
  await panel(page).getByRole('region', { name: 'よく使う構成', exact: true }).getByRole('button', { name: '幹線A', exact: true }).click()
  await expect(page.locator('.pickup-template').filter({ hasText: /^構成:/ })).toContainText('構成: 幹線A')
  await draw(page, 380)
  expect(itemsOf((await routes(page))[2])).toEqual(itemsOf(composition))
  await expect(format(page).locator('.route-item')).toHaveCount(3)
  await page.getByRole('button', { name: '構成を外す', exact: true }).click()
  await expect(page.locator('.pickup-template').filter({ hasText: /^構成:/ })).toHaveCount(0)
  await draw(page, 440); expect(itemsOf((await routes(page))[3])).toEqual(itemsOf(composition))

  const bytes = await saveBytes(page)
  await page.reload(); await open(page, bytes)
  await expect(panel(page).getByRole('region', { name: 'よく使う構成', exact: true }).getByRole('button', { name: '幹線A', exact: true })).toBeVisible()
  await selectRoute(page, 220)
  await format(page).getByRole('button', { name: 'よく使う構成', exact: true }).click()
  await sets.getByRole('button', { name: '幹線Aの名前を変える', exact: true }).click()
  await sets.getByLabel('構成の新しい名前', { exact: true }).fill('幹線B')
  await sets.getByRole('button', { name: '保存', exact: true }).click()
  await expect(sets.getByRole('button', { name: '幹線B', exact: true })).toBeVisible()
  await sets.getByRole('button', { name: '幹線Bを削除', exact: true }).click()
  await expect(sets.getByRole('button', { name: '幹線B', exact: true })).toHaveCount(0)
  await expect(panel(page).getByRole('region', { name: 'よく使う構成', exact: true })).toHaveCount(0)
})

test('追加画面のキーボードと外側クリック、条数入力の確定・上限・ホイール', async ({ page }) => {
  await setup(page)
  await format(page).getByRole('button', { name: '線要素を追加', exact: true }).click()
  await picker(page).getByLabel('線要素を検索', { exact: true }).fill('接地線')
  await picker(page).getByLabel('線要素を検索', { exact: true }).press('ArrowDown')
  await picker(page).getByLabel('線要素を検索', { exact: true }).press('Enter')
  await expect(picker(page)).toHaveCount(0); await expect(format(page).locator('.route-item')).toHaveCount(2)
  await format(page).getByRole('button', { name: '線要素を追加', exact: true }).click()
  await format(page).getByText('経路構成', { exact: true }).click()
  await expect(picker(page)).toHaveCount(0)
  const input = format(page).getByLabel('EM-CE 5.5sq-3Cの条数', { exact: true })
  await input.fill('99'); await input.press('Enter')
  await expect(format(page).getByRole('button', { name: 'EM-CE 5.5sq-3Cの条数を増やす', exact: true })).toBeDisabled()
  await input.fill('0'); await input.press('Enter'); await expect(input).toHaveValue('99')
  await input.fill('2'); await format(page).getByText('経路構成', { exact: true }).click(); await expect(input).toHaveValue('2')
  await input.focus(); await input.hover(); await page.mouse.wheel(0, -100)
  await expect(input).toHaveValue('2'); expect((await routes(page))[0].count).toBe(2)
  await format(page).getByText('経路構成', { exact: true }).click()
  await page.keyboard.press('Control+z'); await selectRoute(page); await expect(input).toHaveValue('99')
  await expect(format(page).locator('.route-item-added')).toHaveCount(0)
})

test('拾いバーからの追加、11項目の上限と収まらない札の省略', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: '拾いバーで線要素を追加', exact: true }).click()
  await expect(picker(page).getByLabel('線要素を検索', { exact: true })).toBeFocused()
  await picker(page).getByLabel('線要素を検索', { exact: true }).fill('iv')
  await picker(page).locator('section').filter({ has: page.getByRole('heading', { name: 'この PDF の項目', exact: true }) }).getByRole('button', { name: 'IV 5.5sq', exact: true }).click()
  await expect(picker(page)).toHaveCount(0)
  await expect(format(page).locator('.route-item')).toHaveCount(2)
  for (let i = 0; i < 9; i++) await addFixture(page, 'L' + i, '', '追加線' + i)
  await selectRoute(page)
  await addLine(page, 'PF22', 'PF22')
  for (let i = 0; i < 8; i++) await addLine(page, '追加線' + i, 'L' + i)
  await expect(format(page).getByText('11種類・11条', { exact: true })).toBeVisible()
  await expect(format(page).locator('.route-item')).toHaveCount(11)
  await format(page).getByRole('button', { name: '線要素を追加', exact: true }).click()
  await expect(picker(page).getByRole('status')).toHaveText('これ以上足せません（最大 11 項目）')
  await picker(page).getByLabel('線要素を検索', { exact: true }).fill('追加線8')
  await expect(picker(page).getByRole('button', { name: 'L8', exact: true }).first()).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.locator('.pickup-route-more')).toContainText('ほか ')
  expect(await page.locator('.pickup-route-row').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
})

test('別のPDFに構成の項目を作り、同じ項目の再選択では雛形を保つ', async ({ page }) => {
  await setup(page)
  await addLine(page, 'iv', 'IV 5.5sq')
  await addLine(page, 'pf2', 'PF28', true)
  await format(page).locator('.route-item').filter({ hasText: 'PF28' }).getByLabel('平面', { exact: true }).selectOption('exclude')
  await format(page).getByRole('button', { name: 'よく使う構成', exact: true }).click()
  const sets = page.getByRole('dialog', { name: 'よく使う構成', exact: true })
  await sets.getByLabel('構成の名前', { exact: true }).fill('別PDF幹線')
  await sets.getByRole('button', { name: '登録', exact: true }).click()
  await page.keyboard.press('Escape')
  await open(page, blankPdf())
  await panel(page).getByRole('region', { name: 'よく使う構成', exact: true }).getByRole('button', { name: '別PDF幹線', exact: true }).click()
  await expect(panel(page).locator('.fixture-row-code')).toHaveCount(3)
  await row(page, 'EM-CE 5.5sq-3C', 'ケーブル').click()
  await expect(page.locator('.pickup-template').filter({ hasText: /^構成:/ })).toContainText('構成: 別PDF幹線')
  await draw(page, 220)
  await expect(format(page).locator('.route-item')).toHaveCount(3)
  await expect(format(page).locator('.route-item').filter({ hasText: 'PF28' }).getByLabel('平面', { exact: true })).toHaveValue('exclude')
  // Choosing another item clears the in-memory template.
  await row(page, 'IV 5.5sq', '接地線').click()
  await expect(page.locator('.pickup-template').filter({ hasText: /^構成:/ })).toHaveCount(0)
  await draw(page, 300)
  expect((await routes(page))[1].extra).toBeUndefined()
  const doc = new mupdf.PDFDocument(new Uint8Array(await saveBytes(page)))
  try {
    const all = readCountFixtures(doc)
    const appearances = all.map(f => JSON.stringify([f.style.color, f.line?.dash, f.line?.width]))
    expect(new Set(appearances).size).toBe(3)
    expect(listAnnotations(doc, 0)[0].contents).toContain('IV 5.5sq')
    expect(listAnnotations(doc, 0)[0].contents).not.toContain((await routes(page))[0].extra![0].itemId)
  } finally { doc.destroy() }
})

test('SPEC-B27: 埋設管25mに標準マスタの溝掘削を追加し12.00㎥を保存する', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await open(page, blankPdf(1000))
  await addFixture(page, 'FEP', '', '埋設管')
  await row(page, 'FEP', '埋設管').click()
  await point(page, 100, 220)
  await point(page, 125, 220)
  await page.keyboard.press('Enter')
  await expect(format(page).getByText('経路構成', { exact: true })).toBeVisible()

  await format(page).getByRole('button', { name: '線要素を追加', exact: true }).click()
  await picker(page).getByLabel('線要素を検索', { exact: true }).fill('ケーブル・配管の溝掘削')
  const master = picker(page).locator('section').filter({
    has: page.getByRole('heading', { name: '標準マスタ', exact: true }),
  })
  await master.getByRole('button').filter({ hasText: 'ケーブル・配管の溝掘削' }).first().click()
  await expect(picker(page)).toHaveCount(0)
  const trenchRow = format(page).locator('.route-item')
    .filter({ hasText: 'ケーブル・配管の溝掘削' })
  await expect(trenchRow).toContainText('12.00 ㎥')
  await expect(trenchRow).toContainText('平面の長さだけで計算します。')
  await expect(trenchRow.getByRole('button', { name: /を主にする$/u })).toBeDisabled()

  const total = panel(page).getByRole('button')
    .filter({ hasText: 'ケーブル・配管の溝掘削' }).first()
    .locator('..').locator('.fixture-row-count').last()
  await expect(total).toHaveText('12.00')
  await format(page).getByRole('button', { name: '＋ 立上り・立下りを足す', exact: true }).click()
  await format(page).getByLabel('立上り・立下り1', { exact: true }).fill('3')
  await format(page).getByLabel('立上り・立下り1', { exact: true }).press('Enter')
  await format(page).getByLabel('その他の加算', { exact: true }).fill('2')
  await format(page).getByLabel('その他の加算', { exact: true }).press('Enter')
  await expect(total).toHaveText('12.00')

  const bytes = await saveBytes(page)
  const doc = new mupdf.PDFDocument(new Uint8Array(bytes))
  try {
    // 標準マスタの名前は「ケーブル・配管の溝掘削（長さ×幅×深さ）」。
    const f = readCountFixtures(doc).find(f => f.name.startsWith('ケーブル・配管の溝掘削'))!
    expect(f).toMatchObject({
      kind: 'volume', method: 'lengthWidthDepth',
      defaults: { widthM: 0.6, depthM: 0.8 },
    })
    expect(listAnnotations(doc, 0)[0].quantity!.extra).toContainEqual(
      expect.objectContaining({ itemId: f.id, count: 1, cond: { rise: null, slack: null } }),
    )
  } finally { doc.destroy() }
  await open(page, bytes)
  await expect(total).toHaveText('12.00')
})

test('SPEC-B27: 線の柱とスパイラル筋の径・ピッチ計算、t換算と再読込', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await open(page, blankPdf(1000))
  await addFixture(page, '柱', '', '柱', async dialog => {
    // コンクリートの項目でない「柱」は RC 部材の欄が閉じて始まる。
    await dialog.locator('.fixture-rc').evaluate(element => { (element as HTMLDetailsElement).open = true })
    await dialog.getByLabel('RC 部材にする', { exact: true }).check()
    await expect(dialog.getByLabel('部材の種類', { exact: true })).toHaveValue('column')
    await dialog.getByLabel('幅 b（mm）', { exact: true }).fill('600')
    await dialog.getByLabel('せい D（mm）', { exact: true }).fill('600')
    await expect(dialog.locator('.fixture-rc').getByLabel('高さ（mm）', { exact: true })).toHaveCount(0)
  })
  await addFixture(page, 'SP', 'D10', 'スパイラル筋', async dialog => {
    await dialog.locator('details.fixture-convert > summary').click()
    await dialog.getByLabel('数量を換算する', { exact: true }).check()
    await dialog.getByLabel('換算後の単位', { exact: true }).selectOption('t')
    await dialog.getByLabel('換算の係数', { exact: true }).fill('0.00056')
    await dialog.getByLabel('換算の根拠の候補', { exact: true }).selectOption('other')
    await dialog.getByLabel('換算の根拠', { exact: true }).fill('D10 0.56kg/m ÷ 1000')
  })
  await row(page, '柱', '柱').click()
  await point(page, 100, 220)
  await point(page, 110, 220)
  await page.keyboard.press('Enter')
  await addLine(page, 'スパイラル', 'SP D10')

  const spiralRow = format(page).locator('.route-item').filter({ hasText: 'スパイラル筋' })
  const factor = spiralRow.getByLabel('SP D10 スパイラル筋の1mあたり', { exact: true })
  await expect(factor).toHaveValue('')
  await spiralRow.getByRole('button', { name: '径とピッチから', exact: true }).click()
  await spiralRow.getByLabel('SP D10 スパイラル筋の径（m）', { exact: true }).fill('0.6')
  await spiralRow.getByLabel('SP D10 スパイラル筋のピッチ（m）', { exact: true }).fill('0.1')
  await spiralRow.getByRole('button', { name: '1m あたりに入れる', exact: true }).click()
  await expect(factor).toHaveValue('18.850')
  await expect(spiralRow).toContainText('SP D10 ×18.850/m')
  await expect(spiralRow).toContainText(/18[89].[0-9]{3} m/)
  const total = row(page, 'SP D10', 'スパイラル筋')
    .locator('..').locator('.fixture-row-count').last()
  await expect(total).toHaveText('0.11')

  const before = (await routes(page))[0]
  expect(before.extra![0].perM).toBe(18.85)
  const bytes = await saveBytes(page)
  const doc = new mupdf.PDFDocument(new Uint8Array(bytes))
  try {
    expect(readCountFixtures(doc).find(f => f.code === '柱')!.rc).toMatchObject({
      kind: 'column', widthMm: 600, depthMm: 600,
    })
    expect(listAnnotations(doc, 0)[0].quantity!.extra![0].perM).toBe(18.85)
    expect(listAnnotations(doc, 0)[0].contents).toContain('SP D10 ×18.850/m')
  } finally { doc.destroy() }
  await open(page, bytes)
  expect((await routes(page))[0]).toEqual(before)
  await expect(total).toHaveText('0.11')
  await page.getByRole('button', { name: '選択', exact: true }).click()
  await point(page, 105, 220)
  await expect(factor).toHaveValue('18.850')
})

test('SPEC-B29: 項目の深さ変更を既存の拾いへ反映し1回のUndoで戻す', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await open(page, blankPdf(1000))
  await addFixture(page, '溝', '', '溝掘削', async dialog => {
    await dialog.getByRole('radio', { name: '体積', exact: true }).check()
    await dialog.getByRole('radio', { name: '長さ×幅×深さ', exact: true }).check()
    await dialog.getByLabel('幅（新しく拾うときの初期値）', { exact: true }).fill('0.6')
    await dialog.getByLabel('深さ（新しく拾うときの初期値）', { exact: true }).fill('0.8')
  })
  const fixtureRow = row(page, '溝', '溝掘削').locator('..')
  const total = fixtureRow.locator('.fixture-row-count').last()
  await row(page, '溝', '溝掘削').click()
  await point(page, 100, 220)
  await point(page, 110, 220)
  await page.keyboard.press('Enter')
  await expect(total).toHaveText('4.80')

  // 項目の「編集」は一覧の上の、選んだ項目の操作にある。
  await panel(page).getByRole('button', { name: '編集', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を編集', exact: true })
  await dialog.getByLabel('深さ（新しく拾うときの初期値）', { exact: true }).fill('1.2')
  const propagate = dialog.getByRole('checkbox', {
    name: '既存の拾い 1 件の幅・深さ・高さも新しい値にする', exact: true,
  })
  await expect(propagate).toBeChecked()
  await dialog.getByRole('button', { name: '変更する', exact: true }).click()
  await expect(total).toHaveText('7.20')
  expect((await routes(page))[0]).toMatchObject({ widthM: 0.6, depthM: 1.2 })
  await expect(page.locator('.measurement-label')).toContainText('7.20')

  await page.keyboard.press('Control+z')
  await expect(total).toHaveText('4.80')
  expect((await routes(page))[0].depthM).toBe(0.8)
  await expect(page.locator('.measurement-label')).toContainText('4.80')

  await page.keyboard.press('Control+y')
  await expect(total).toHaveText('7.20')
  const doc = new mupdf.PDFDocument(new Uint8Array(await saveBytes(page)))
  try {
    expect(readCountFixtures(doc).find(f => f.code === '溝')?.defaults?.depthM).toBe(1.2)
    expect(listAnnotations(doc, 0)[0].quantity?.depthM).toBe(1.2)
  } finally { doc.destroy() }
})

test('SPEC-B29: 地中管路内ケーブルと埋設FEPの経路で管を控除し保存する', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await open(page, blankPdf(1000))
  const addPlanCondition = async (
    dialog: ReturnType<Page['getByRole']>, condition: string,
  ) => {
    await dialog.getByLabel('追加する施工条件', { exact: true }).fill(condition)
    await dialog.locator('.fixture-conditions')
      .getByRole('button', { name: '追加', exact: true }).click()
    await dialog.getByLabel('平面の既定', { exact: true })
      .selectOption('condition:' + condition)
  }
  await addFixture(page, 'CV', '', 'ケーブル', async dialog => {
    await addPlanCondition(dialog, '地中管路内')
  })
  await addFixture(page, 'FEP65', '', '波付硬質合成樹脂管', async dialog => {
    await addPlanCondition(dialog, '地中埋設')
    await dialog.locator('details.fixture-attributes > summary').click()
    await dialog.getByLabel('外径（mm）', { exact: true }).fill('82')
  })
  await addFixture(page, '埋戻し', '', '溝埋戻し', async dialog => {
    await dialog.getByRole('radio', { name: '体積', exact: true }).check()
    await dialog.getByRole('radio', { name: '長さ×幅×深さ', exact: true }).check()
    await dialog.getByLabel('幅（新しく拾うときの初期値）', { exact: true }).fill('0.6')
    await dialog.getByLabel('深さ（新しく拾うときの初期値）', { exact: true }).fill('1.2')
    await dialog.getByLabel('埋戻し: 同じ経路の管の体積を引く', { exact: true }).check()
    await expect(dialog.getByLabel('引く管の施工条件（含む語）', { exact: true }))
      .toHaveValue('埋設')
  })

  await row(page, 'CV', 'ケーブル').click()
  await point(page, 100, 220)
  await point(page, 110, 220)
  await page.keyboard.press('Enter')
  await addLine(page, 'FEP65', 'FEP65')
  await addLine(page, '溝埋戻し', '埋戻し')

  const backfillRow = format(page).locator('.route-item').filter({ hasText: '溝埋戻し' })
  await expect(backfillRow).toContainText('− 管 FEP65')
  await expect(backfillRow).toContainText('φ82mm')
  await expect(backfillRow).toContainText('7.15 ㎥')
  await expect(backfillRow).not.toContainText('− 管 CV')
  const total = row(page, '埋戻し', '溝埋戻し')
    .locator('..').locator('.fixture-row-count').last()
  await expect(total).toHaveText('7.15')
  await expect(page.locator('.measurement-label')).toContainText('−管 0.05')

  const bytes = await saveBytes(page)
  const doc = new mupdf.PDFDocument(new Uint8Array(bytes))
  try {
    expect(readCountFixtures(doc).find(f => f.code === '埋戻し')?.backfill)
      .toEqual({ deductPipes: true, conditionIncludes: ['埋設'] })
    expect(readCountFixtures(doc).find(f => f.code === 'FEP65')?.attributes?.outerDiameterMm)
      .toBe(82)
    expect(listAnnotations(doc, 0)[0].contents).toContain('−管 0.05')
    expect(listAnnotations(doc, 0)[0].contents).toContain('7.15 ㎥')
  } finally { doc.destroy() }
  await open(page, bytes)
  await expect(total).toHaveText('7.15')
  // この経路は x 100〜110 なので、線の上（105）を選ぶ。
  await page.getByRole('button', { name: '選択', exact: true }).click()
  await point(page, 105, 220)
  await expect(format(page).getByText('経路構成', { exact: true })).toBeVisible()
  await expect(backfillRow).toContainText('− 管 FEP65')
  await expect(backfillRow).toContainText('7.15 ㎥')
})
