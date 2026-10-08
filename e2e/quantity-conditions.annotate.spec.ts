import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import mupdf from 'mupdf'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { applyEdits } from '../src/core/annotations'
import { nextCountStyle, type CountFixture } from '../src/core/countFixtures'
import { createFontResource } from '../src/core/fontMetrics'

async function drawingPdf(unset = false, extraRack = false) {
  const doc = new mupdf.PDFDocument(), store = new AnnotationStore()
  const font = createFontResource(new Uint8Array(await fs.readFile('public/fonts/BIZUDGothic-Regular.ttf')))
  const fixtures: CountFixture[] = [
    { id: 'cv', code: 'CV', spec: '38sq-3C', name: 'ケーブル', category: '電気', order: 0, kind: 'length',
      conditions: ['ケーブルラック配線', '管内配線'], style: nextCountStyle([]) },
    { id: 'old', code: 'OLD', name: '候補なし', category: '電気', order: 1, style: nextCountStyle([]) },
    { id: 'unused', code: 'U', name: '未使用', category: '電気', order: 2, conditions: ['露出'], style: nextCountStyle([]) },
  ]
  try {
    for (let i = 0; i < 2; i++) {
      const pdfPage = doc.addPage([0, 0, 500, 600], 0, {}, '')
      try { doc.insertPage(-1, pdfPage) } finally { pdfPage.destroy() }
    }
    await store.ensureCountFixtures(async () => fixtures, async () => {})
    const routes = [
      { pageIndex: 0, y: 100, length: 10, condition: 'ケーブルラック配線' },
      { pageIndex: 0, y: 200, length: 20, condition: '管内配線' },
      ...(extraRack ? [{ pageIndex: 1, y: 100, length: 15, condition: 'ケーブルラック配線' }] : []),
      ...(unset ? [{ pageIndex: 1, y: 200, length: 4, condition: undefined }] : []),
    ]
    for (const [i, a] of routes.entries()) store.create({ kind: 'perimeter', pageIndex: a.pageIndex,
      rect: [80, a.y, 80 + a.length * 10, a.y + 1], vertices: [[80, a.y], [80 + a.length * 10, a.y]],
      measure: { kind: 'perimeter', unit: 'mm', decimals: null, mmPerPoint: 100 },
      quantity: { version: 1, id: 'r' + i, itemId: 'cv', method: 'polyline', floor: '1階', room: '事務室',
        ...(a.condition ? { rises: [{ m: 2 }, { m: 3 }], cond: { plan: a.condition, rise: a.condition } } : {}) } })
    store.create({ kind: 'symbol', pageIndex: 0, rect: [80, 400, 90, 410],
      count: { version: 2, id: 'old', fixtureId: 'old' } })
    expect(applyEdits(doc, store.toEdits(), { BIZUDGothic: font }).errors).toEqual([])
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { font.font.destroy(); doc.destroy() }
}
async function open(page: Page, unset = false, extraRack = false) {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(b => window.__karu!.openBytes(b, '施工条件試験.pdf'), await drawingPdf(unset, extraRack))
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await page.getByTestId('fixture-panel').getByRole('button', { name: '管理', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__karu!.getDrawingScanMetrics().scanning)).toBe(false)
}
const table = (page: Page) => page.getByRole('region', { name: '数量の集計表', exact: true })
const material = (page: Page) => table(page).locator('tr[data-fixture-id="cv"]:not([data-condition])')
const conditionRow = (page: Page, condition: string) => table(page).locator(`tr[data-fixture-id="cv"][data-condition="${condition}"]`)

test('two CV routes split into two conditions whose sum equals the material total', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '集計表を開く', exact: true }).click()
  await table(page).getByRole('button', { name: '施工条件別', exact: true }).click()
  const rows = table(page).locator('tr[data-fixture-id="cv"][data-condition]')
  await expect(rows).toHaveCount(2)
  await expect(material(page).locator('.quantity-table-fixed-4 button')).toHaveText('40.00')
  await expect(conditionRow(page, 'ケーブルラック配線').locator('.quantity-table-fixed-4 button')).toHaveText('15.00')
  await expect(conditionRow(page, '管内配線').locator('.quantity-table-fixed-4 button')).toHaveText('25.00')
  await expect(conditionRow(page, 'ケーブルラック配線').locator('.quantity-table-parts')).toHaveText('平面 10.0 ／ 立上り・立下り 5.0')
  const heights = await rows.evaluateAll(elements => elements.map(e => e.getBoundingClientRect().height))
  expect(heights).toEqual([32, 32])
})

test('condition value reviews only matching routes across pages and keeps its own cursor', async ({ page }) => {
  await open(page, false, true)
  await page.getByRole('button', { name: '集計表を開く', exact: true }).click()
  await table(page).getByRole('button', { name: '施工条件別', exact: true }).click()
  const rack = conditionRow(page, 'ケーブルラック配線').locator('.quantity-table-fixed-4 button')
  const pipe = conditionRow(page, '管内配線').locator('.quantity-table-fixed-4 button')
  const current = () => page.evaluate(() => {
    const ids = window.__karu!.getSelectedAnnotationIds()
    const a = [0, 1].flatMap(p => window.__karu!.getEditableAnnotations(p)).find(a => ids.includes(a.id))
    return [a?.pageIndex, a?.quantity?.cond?.plan]
  })
  await rack.click(); await expect.poll(current).toEqual([0, 'ケーブルラック配線'])
  await pipe.click(); await expect.poll(current).toEqual([0, '管内配線'])
  await rack.click(); await expect.poll(current).toEqual([1, 'ケーブルラック配線'])
  await expect(rack).toContainText('2 / 2')
  await rack.click(); await expect.poll(current).toEqual([0, 'ケーブルラック配線'])
  await page.keyboard.press('Delete')
  await expect(material(page).locator('.quantity-table-fixed-4 button')).toHaveText('45.00')
  await expect(conditionRow(page, 'ケーブルラック配線')).toBeVisible()
  await rack.click(); await expect.poll(current).toEqual([1, 'ケーブルラック配線'])
  await expect(rack).toContainText('1 / 1')
})

test('unset filter excludes items without candidates and without unset entries', async ({ page }) => {
  await open(page, true)
  await page.getByRole('button', { name: '集計表を開く', exact: true }).click()
  await table(page).getByRole('checkbox', { name: '未設定だけ', exact: true }).check()
  await expect(table(page).locator('tr[data-fixture-id]')).toHaveCount(2)
  await expect(conditionRow(page, '')).toContainText('└ 未設定')
  await expect(conditionRow(page, 'ケーブルラック配線')).toHaveCount(0)
  await conditionRow(page, '').locator('button[data-column-key="1"]').click()
  await expect.poll(() => page.evaluate(() => window.__karu!.getSelectedAnnotationIds().length)).toBe(1)
})

test('assigning a condition in the format panel removes the unset row on index update', async ({ page }) => {
  test.fixme(true, 'SPEC-07cの部分別施工条件の書式欄がこのworktreeに未導入。結合時に有効化しラベルを確認する。')
  await open(page, true)
  await page.getByRole('button', { name: '集計表を開く', exact: true }).click()
  await table(page).getByRole('checkbox', { name: '未設定だけ', exact: true }).check()
  await conditionRow(page, '').locator('button[data-column-key="1"]').click()
  await page.getByTestId('format-panel').getByLabel('平面の施工条件', { exact: true }).selectOption({ label: 'ケーブルラック配線' })
  await expect(table(page).locator('tr[data-fixture-id]')).toHaveCount(0)
  await expect(table(page).getByText('該当する項目はありません', { exact: true })).toBeVisible()
})

test('condition breakdown filters pages and clears the condition filter', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'CV 38sq-3C ケーブルの全図面の内訳', exact: true }).last().click()
  const b = page.getByTestId('quantity-breakdown')
  await b.getByRole('button', { name: '施工条件別', exact: true }).click()
  await b.locator('[data-condition="ケーブルラック配線"]').click()
  await expect(b.getByRole('button', { name: 'ページ別', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(b).toContainText('施工条件: ケーブルラック配線')
  await expect(b.locator('.quantity-breakdown-total')).toHaveText('合計 15.00 m')
  await b.locator('[data-page-index="0"]').click()
  await expect.poll(() => page.evaluate(() => {
    const ids = window.__karu!.getSelectedAnnotationIds()
    return window.__karu!.getEditableAnnotations(0).find(a => ids.includes(a.id))?.quantity?.cond?.plan
  })).toBe('ケーブルラック配線')
  await b.getByRole('button', { name: '絞り込みを解除', exact: true }).click()
  await expect(b.locator('.quantity-breakdown-total')).toHaveText('合計 40.00 m')
})

test('CSV downloads preserve filename/BOM and include condition, material, section and deduplicated counts', async ({ page }) => {
  await open(page)
  await page.evaluate(() => Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }))
  for (const detail of [false, true]) {
    await page.getByRole('button', { name: '数量をCSVに書き出す', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '数量をCSVに書き出す', exact: true })
    if (detail) await dialog.getByRole('radio', { name: '明細（項目・施工条件・区間・ページ・場所ごと）', exact: true }).check()
    const pending = page.waitForEvent('download')
    await dialog.getByRole('button', { name: '書き出す', exact: true }).click()
    const download = await pending, stream = await download.createReadStream(), chunks: Buffer[] = []
    for await (const chunk of stream!) chunks.push(chunk)
    const csv = Buffer.concat(chunks).toString('utf8')
    expect(download.suggestedFilename()).toBe(`施工条件試験_数量${detail ? '明細' : '集計'}.csv`)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    if (detail) {
      expect(csv).toContain('規格,施工条件,区間,種別,単位,集計方式,階,部屋,ページ番号,図面番号,図面名称,数量,拾いの件数')
      expect(csv).toContain('ケーブルラック配線,立上り・立下り,長さ,m,全図面,1階,事務室,1,,,5.00,1')
    } else {
      expect(csv).toContain('規格,施工条件,集計区分,種別,単位,集計方式,平面,立上り・立下り,その他の加算,全図面の合計')
      expect(csv).toContain('ケーブルラック配線,施工条件別,長さ,m,全図面,10.00,5.00,0.00,15.00')
      expect(csv).toContain('管内配線,施工条件別,長さ,m,全図面,20.00,5.00,0.00,25.00')
      expect(csv).toContain(',材料計,長さ,m,全図面,30.00,10.00,0.00,40.00')
    }
    await download.delete()
  }
})
