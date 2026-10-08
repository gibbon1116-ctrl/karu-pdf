import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import mupdf from 'mupdf'
import { nextCountStyle, writeCountFixtures, readCountFixtures, type CountFixture } from '../src/core/countFixtures'
import { applyEdits } from '../src/core/annotations'
import { createFontResource } from '../src/core/fontMetrics'
import { writePageScale } from '../src/core/measure'
import { QuantityIndex } from '../src/core/quantityIndex'
const rounded = (o: object | undefined) => o && Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 100) / 100 : v]))

const fixtures: CountFixture[] = [
  { id: 'cv', code: 'CV', spec: '5.5sq-3C', name: 'ケーブル', category: 'ケーブル', kind: 'length', method: 'polyline', conditions: ['ケーブルラック配線', '管内配線'], defaults: { addM: 3 }, order: 0, style: nextCountStyle([]) },
  { id: 'pf', code: 'PF22', name: '電線管', category: '電線管', kind: 'length', method: 'polyline', conditions: ['隠ぺい配管', '露出配管'], order: 1, style: nextCountStyle([]) },
  { id: 'area', code: '床', name: '床面積', category: '建築', kind: 'area', method: 'polygon', conditions: ['屋内', '屋外'], order: 2, style: nextCountStyle([]) },
  { id: 'led', code: 'LED', name: '照明器具', category: '照明', kind: 'count', method: 'click', conditions: ['天井直付', '壁付'], order: 3, style: nextCountStyle([]) },
]
async function pdf(legacy = false) {
  const doc = new mupdf.PDFDocument()
  const font = createFontResource(new Uint8Array(await fs.readFile('public/fonts/BIZUDGothic-Regular.ttf')))
  try {
    const ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
    try { doc.insertPage(-1, ref) } finally { ref.destroy() }
    const p = doc.loadPage(0)
    try { writePageScale(doc, p, { denominator: 100, paper: 'PDF', source: 'ratio', mmPerPoint: 1000, unit: 'm', decimals: 2 }) } finally { p.destroy() }
    writeCountFixtures(doc, fixtures)
    if (legacy) {
      applyEdits(doc, [{ kind: 'createMeasure', pageIndex: 0, vertices: [[100, 220], [172, 220]], measure: { kind: 'perimeter', mmPerPoint: 1000, unit: 'm', decimals: 2 }, quantity: { version: 1, id: 'old', itemId: 'cv', method: 'polyline', addM: 3, cond: { plan: null, slack: null } }, text: 'CV 3.00 m', color: [1, 0, 0], fontSize: 12, borderWidth: 2, opacity: 1 }], { BIZUDGothic: font })
      const page = doc.loadPage(0)
      try {
        const annots = page.getAnnotations()!
        const wire = doc.newString(JSON.stringify({ version: 1, id: 'old', itemId: 'cv', method: 'polyline', addM: 3, scope: 'rise' }))
        try { annots[0].getObject().put('KaruQuantity', wire) } finally { wire.destroy(); annots.forEach(a => a.destroy()) }
      } finally { page.destroy() }
    }
    const b = doc.saveToBuffer('compress')
    try { return [...b.asUint8Array()] } finally { b.destroy() }
  } finally { font.font.destroy(); doc.destroy() }
}
const format = (p: Page) => p.getByTestId('format-panel')
const card = (p: Page, code: string) => format(p).locator('.route-item').filter({ hasText: code })
async function point(page: Page, x: number, y: number, shift = false) {
  const layer = page.getByTestId('annotation-layer-0')
  const position = await layer.evaluate((el, p) => { const svg = el as SVGSVGElement, r = svg.getBoundingClientRect(); return { x: p.x * r.width / svg.viewBox.baseVal.width, y: p.y * r.height / svg.viewBox.baseVal.height } }, { x, y })
  await layer.click({ position, modifiers: shift ? ['Shift'] : [] })
}
async function open(page: Page, legacy = false) {
  await page.setViewportSize({ width: 1600, height: 1000 }); await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(b => window.__karu!.openBytes(b, '施工条件.pdf'), await pdf(legacy))
  await page.evaluate(() => window.__karu!.setZoom(1))
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await expect(page.getByTestId('fixture-panel').getByRole('button', { name: 'CV 5.5sq-3C ケーブル', exact: true })).toBeVisible()
}
async function draw(page: Page) {
  await page.getByTestId('fixture-panel').getByRole('button', { name: 'CV 5.5sq-3C ケーブル', exact: true }).click()
  await point(page, 100, 220); await point(page, 172, 220); await point(page, 172, 292); await page.keyboard.press('Enter')
  await expect(card(page, 'CV')).toBeVisible()
}
const annotations = (p: Page) => p.evaluate(() => window.__karu!.getEditableAnnotations(0))
async function index(page: Page) { return QuantityIndex.build(await annotations(page), fixtures) }
async function select(page: Page, x = 136, y = 220, shift = false) {
  await page.getByRole('button', { name: '選択', exact: true }).click(); await point(page, x, y, shift)
}
async function addPF(page: Page) {
  await format(page).getByRole('button', { name: '線要素を追加', exact: true }).click()
  const d = page.getByRole('dialog', { name: '線要素を追加', exact: true })
  await d.getByLabel('線要素を検索', { exact: true }).fill('PF22'); await d.getByRole('button', { name: 'PF22', exact: true }).first().click()
}

test('CVの部分別条件とPFの立上りだけの拾いがカード・条件別集計に一致する', async ({ page }) => {
  await open(page); await draw(page)
  await card(page, 'CV').getByLabel('平面', { exact: true }).selectOption('value:ケーブルラック配線')
  await card(page, 'CV').getByLabel('立上り', { exact: true }).selectOption('value:管内配線')
  await expect(card(page, 'CV')).toContainText('平面 144.00 ＋ 立上り 3.00 ＝ 147.00 m')
  expect(rounded((await index(page)).byCondition('cv').get('ケーブルラック配線'))).toMatchObject({ plan: 144, total: 144 })
  expect(rounded((await index(page)).byCondition('cv').get('管内配線'))).toMatchObject({ rise: 3, total: 3 })
  await addPF(page)
  await card(page, 'PF22').getByLabel('平面', { exact: true }).selectOption('exclude')
  await card(page, 'PF22').getByLabel('立上り', { exact: true }).selectOption('value:隠ぺい配管')
  await expect(card(page, 'PF22')).toContainText('立上り 3.00 ＝ 3.00 m')
  expect((await index(page)).total('pf')).toBe(3)
  expect(rounded((await index(page)).byCondition('pf').get('隠ぺい配管'))).toMatchObject({ plan: 0, rise: 3, total: 3 })
})
test('立上りごとの条件、途中の削除とUndo、候補追加も1回のUndo', async ({ page }) => {
  await open(page); await draw(page)
  await format(page).getByRole('button', { name: '＋ 立上り・立下りを足す', exact: true }).click()
  await format(page).getByLabel('立上り・立下り2', { exact: true }).fill('2'); await format(page).getByLabel('立上り・立下り2', { exact: true }).press('Enter')
  await card(page, 'CV').getByLabel('CV 5.5sq-3Cの立上りごとに選ぶ', { exact: true }).check()
  await card(page, 'CV').getByLabel('立上り1（3.00 m）', { exact: true }).selectOption('value:管内配線')
  await card(page, 'CV').getByLabel('立上り2（2.00 m）', { exact: true }).selectOption('value:ケーブルラック配線')
  expect((await index(page)).byCondition('cv').get('管内配線')!.rise).toBe(3)
  expect((await index(page)).byCondition('cv').get('ケーブルラック配線')!.rise).toBe(2)
  await format(page).getByRole('button', { name: '立上り1を削除', exact: true }).click()
  expect((await index(page)).byCondition('cv').get('ケーブルラック配線')!.rise).toBe(2)
  await page.keyboard.press('Control+z'); await select(page)
  await card(page, 'CV').getByLabel('平面', { exact: true }).selectOption('add')
  await card(page, 'CV').getByLabel('平面の新しい条件', { exact: true }).fill('工区A')
  await card(page, 'CV').getByLabel('平面の新しい条件', { exact: true }).press('Enter')
  expect((await annotations(page))[0].quantity!.cond!.plan).toBe('工区A')
  const bytes = await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!]), doc = new mupdf.PDFDocument(new Uint8Array(bytes))
  try { expect(readCountFixtures(doc).find(f => f.id === 'cv')!.conditions).toContain('工区A') } finally { doc.destroy() }
  await page.keyboard.press('Control+z'); await select(page)
  await expect(card(page, 'CV').getByLabel('平面', { exact: true })).toHaveValue('unset')
  await expect(card(page, 'CV').getByLabel('平面', { exact: true }).locator('option').filter({ hasText: /^工区A$/ })).toHaveCount(0)
})
test('頂点2で分割して合計を保ち、2本の平面を一括変更する', async ({ page }) => {
  await open(page); await draw(page)
  await format(page).getByLabel('立上り1の位置', { exact: true }).selectOption('2')
  const before = (await index(page)).total('cv')
  await format(page).getByRole('button', { name: '経路を分ける', exact: true }).click()
  await format(page).getByLabel('分ける頂点', { exact: true }).selectOption('1')
  await expect(page.getByTestId('route-split-vertex')).toHaveCount(1)
  await format(page).getByRole('button', { name: '分ける', exact: true }).click()
  expect((await annotations(page)).filter(a => a.quantity)).toHaveLength(2)
  expect((await index(page)).total('cv')).toBe(before)
  await page.keyboard.press('Control+z'); expect((await annotations(page)).filter(a => a.quantity)).toHaveLength(1)
  await page.keyboard.press('Control+y')
  await select(page); await point(page, 172, 256, true)
  await format(page).getByLabel('まとめて変える部材', { exact: true }).selectOption('cv')
  await format(page).getByLabel('まとめて変える条件', { exact: true }).selectOption('value:ケーブルラック配線')
  await format(page).getByRole('button', { name: '適用', exact: true }).click()
  await expect(format(page).getByRole('status')).toContainText('2 本の CV 5.5sq-3C の平面')
  expect((await annotations(page)).filter(a => a.quantity).map(a => a.quantity!.cond!.plan)).toEqual(['ケーブルラック配線', 'ケーブルラック配線'])
  await page.keyboard.press('Control+z')
  expect((await index(page)).byCondition('cv').get('ケーブルラック配線')).toBeUndefined()
})
test('3か所の立上りの2か所目を削除しても元の1か所目と3か所目の条件を保つ', async ({ page }) => {
  await open(page); await draw(page)
  for (const [n, m] of [[2, '2'], [3, '4']] as const) {
    await format(page).getByRole('button', { name: '＋ 立上り・立下りを足す', exact: true }).click()
    const input = format(page).getByLabel('立上り・立下り' + n, { exact: true })
    await input.fill(m); await input.press('Enter')
  }
  await card(page, 'CV').getByLabel('CV 5.5sq-3Cの立上りごとに選ぶ', { exact: true }).check()
  await card(page, 'CV').getByLabel('立上り1（3.00 m）', { exact: true }).selectOption('value:管内配線')
  await card(page, 'CV').getByLabel('立上り2（2.00 m）', { exact: true }).selectOption('value:ケーブルラック配線')
  await card(page, 'CV').getByLabel('立上り3（4.00 m）', { exact: true }).selectOption('add')
  const newCondition = card(page, 'CV').getByLabel('立上り3（4.00 m）の新しい条件', { exact: true })
  await newCondition.fill('工区C'); await newCondition.press('Enter')
  await format(page).getByLabel('立上り1の位置', { exact: true }).selectOption('0')
  await format(page).getByLabel('立上り2の位置', { exact: true }).selectOption('1')
  await format(page).getByLabel('立上り3の位置', { exact: true }).selectOption('2')
  const original = (await annotations(page))[0].quantity!
  await format(page).getByRole('button', { name: '立上り2を削除', exact: true }).click()
  await expect(card(page, 'CV').getByLabel('立上り1（3.00 m）', { exact: true })).toHaveValue('value:管内配線')
  await expect(card(page, 'CV').getByLabel('立上り2（4.00 m）', { exact: true })).toHaveValue('value:工区C')
  await expect(format(page).getByLabel('立上り2の位置', { exact: true })).toHaveValue('2')
  expect((await annotations(page))[0].quantity).toMatchObject({ rises: [{ m: 3, at: 0 }, { m: 4, at: 2 }], addM: 7, cond: { rise: ['管内配線', '工区C'] } })
  const totals = (await index(page)).byCondition('cv')
  expect(totals.get('管内配線')!.rise).toBe(3); expect(totals.get('工区C')!.rise).toBe(4)
  expect(totals.get('ケーブルラック配線')).toBeUndefined()
  await page.keyboard.press('Control+z'); expect((await annotations(page))[0].quantity).toEqual(original)
  await page.keyboard.press('Control+y'); expect((await annotations(page))[0].quantity!.cond!.rise).toEqual(['管内配線', '工区C'])
})

test('旧scope:riseは平面を数えない表示で数量が変わらない', async ({ page }) => {
  await open(page, true); await select(page)
  await expect(card(page, 'CV').getByLabel('平面', { exact: true })).toHaveValue('exclude')
  expect((await index(page)).total('cv')).toBe(3)
})
test('面積と器具の施工条件を選べる', async ({ page }) => {
  await open(page)
  await page.getByTestId('fixture-panel').getByRole('button', { name: '床 床面積', exact: true }).click()
  await point(page, 100, 100); await point(page, 150, 100); await point(page, 150, 150); await point(page, 100, 150); await page.keyboard.press('Enter')
  await format(page).getByLabel('施工条件', { exact: true }).selectOption('value:屋内')
  expect((await index(page)).byCondition('area').get('屋内')!.total).toBeCloseTo(2500, 1)
  await page.getByTestId('fixture-panel').getByRole('button', { name: 'LED 照明器具', exact: true }).click(); await point(page, 250, 200)
  await format(page).getByLabel('施工条件', { exact: true }).selectOption('value:天井直付')
  expect((await index(page)).byCondition('led').get('天井直付')!.total).toBe(1)
})
