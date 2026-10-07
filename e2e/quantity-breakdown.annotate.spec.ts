import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import mupdf from 'mupdf'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { applyEdits } from '../src/core/annotations'
import { nextCountStyle, type CountFixture } from '../src/core/countFixtures'
import { createFontResource } from '../src/core/fontMetrics'

// Create a saved drawing with real PDF quantity annotations; no files are written.
async function drawingPdf() {
  const doc = new mupdf.PDFDocument(), store = new AnnotationStore()
  const font = createFontResource(new Uint8Array(await fs.readFile('public/fonts/BIZUDGothic-Regular.ttf')))
  const fixtures: CountFixture[] = [
    { id: 'cable', name: 'ケーブル（EM-CE）', code: 'EM-CE', spec: '3C-5.5sq', kind: 'length', category: '電気', order: 0, style: nextCountStyle([]) },
    { id: 'earth', name: '根切り', code: '根切り', kind: 'volume', method: 'polygonDepth', category: '土工', order: 1, style: nextCountStyle([]) },
    { id: 'led', name: 'LED埋込形', code: 'LED', category: '電気', order: 2, style: nextCountStyle([]) },
    { id: 'zero', name: '未使用', code: 'Z', category: '電気', order: 3, style: nextCountStyle([]) },
  ]
  try {
    for (let p = 0; p < 4; p++) {
      const page = doc.addPage([0, 0, 500, 600], 0, {}, '')
      try { doc.insertPage(-1, page) } finally { page.destroy() }
    }
    await store.ensureCountFixtures(async () => fixtures, async () => {})
    for (let p = 0; p < 3; p++) store.setDrawingInfo([p], { number: `E-10${p + 1}`, name: `${p + 1}階 幹線設備平面図`, numberManual: true, nameManual: true, scanned: true })
    // Deliberately insert the lower mark first to verify geometric ordering.
    for (const [p, value, y] of [[0, 30, 240], [1, 12, 360], [1, 8, 180], [2, 50, 240]]) {
      store.create({ kind: 'perimeter', pageIndex: p, rect: [100, y, 200, y], vertices: [[100, y], [200, y]], measure: { kind: 'perimeter', unit: 'mm', decimals: null, mmPerPoint: value * 10 }, quantity: { version: 1, id: `c${p}${y}`, itemId: 'cable', method: 'polyline' } })
    }
    for (const [p, value] of [[0, 30], [1, 20], [2, 50]]) {
      store.create({ kind: 'area', pageIndex: p, rect: [260, 100, 360, 200], vertices: [[260,100],[360,100],[360,200],[260,200]], measure: { kind: 'area', unit: 'mm', decimals: null, mmPerPoint: 10 }, quantity: { version: 1, id: `e${p}`, itemId: 'earth', method: 'polygonDepth', depthM: value } })
    }
    for (const [p, floor, room, n] of [[0, '1階', '事務室', 24], [0, '1階', '会議室', 8], [1, '2階', '事務室', 32]] as const) {
      for (let i = 0; i < n; i++) store.create({ kind: 'symbol', symbol: 'circle', pageIndex: p, rect: [20 + i % 8 * 20, 420 + Math.floor(i / 8) * 20, 30 + i % 8 * 20, 430 + Math.floor(i / 8) * 20], count: { version: 2, id: `${p}${room}${i}`, fixtureId: 'led', floor, room } })
    }
    expect(applyEdits(doc, store.toEdits(), { BIZUDGothic: font }).errors).toEqual([])
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { font.font.destroy(); doc.destroy() }
}
async function open(page: Page) {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(b => window.__karu!.openBytes(b, '内訳試験.pdf'), await drawingPdf())
  await page.evaluate(() => window.__karu!.setZoom(1))
  await page.getByRole('tab', { name: '数量', exact: true }).click(); await page.getByTestId('fixture-panel').getByRole('button', { name: '管理', exact: true }).click()
  await expect(page.getByRole('button', { name: '項目を追加', exact: true })).toBeEnabled()
}
const breakdown = (page: Page) => page.getByTestId('quantity-breakdown')
const totalButton = (page: Page, name = 'EM-CE 3C-5.5sq ケーブル（EM-CE）') => page.getByRole('button', { name: `${name}の全図面の内訳`, exact: true }).last()

test('page breakdown, live updates, top-to-bottom navigation, cycling, visibility and Esc', async ({ page }) => {
  await open(page)
  await expect(totalButton(page, 'Z 未使用')).toBeDisabled()
  await page.getByRole('button', { name: 'EM-CE 3C-5.5sq ケーブル（EM-CE）', exact: true }).click()
  await page.getByRole('button', { name: 'EM-CE 3C-5.5sq ケーブル（EM-CE）の表示切替', exact: true }).click()
  await totalButton(page).click()
  const b = breakdown(page)
  await expect(b.getByRole('button', { name: 'ページ別', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(b.locator('.quantity-breakdown-page')).toHaveCount(3)
  for (const [p, value] of [[0, '30.00'], [1, '20.00'], [2, '50.00']] as const) {
    await expect(b.locator(`[data-page-index="${p}"]`)).toContainText(`E-10${p + 1}${p + 1}階 幹線設備平面図${value} m`)
  }
  await expect(b.locator('.quantity-breakdown-total')).toHaveText('合計 100.00 m')
  const second = b.locator('[data-page-index="1"]')
  await second.click()
  await expect(second).toContainText('1 / 2')
  await expect.poll(() => page.evaluate(() => {
    const selected = window.__karu!.getSelectedAnnotationIds()
    return window.__karu!.getEditableAnnotations(1).find(a => selected.includes(a.id))?.rect[1]
  })).toBeLessThan(200)
  await expect(page.getByTestId('annotation-layer-1').locator('.annotation-selection')).toBeVisible()
  await expect.poll(() => page.evaluate(() => {
    const id = window.__karu!.getSelectedAnnotationIds()[0], a = window.__karu!.getEditableAnnotations(1).find(a => a.id === id)!
    const svg = document.querySelector<SVGSVGElement>('[data-testid="annotation-layer-1"]')!, viewer = document.querySelector('[data-testid="viewer"]')!
    const s = svg.getBoundingClientRect(), v = viewer.getBoundingClientRect()
    return Math.abs(s.top + (a.rect[1] + a.rect[3]) / 2 * s.height / svg.viewBox.baseVal.height - (v.top + viewer.clientHeight / 2))
  })).toBeLessThan(3)
  await expect(page.getByRole('button', { name: 'EM-CE 3C-5.5sq ケーブル（EM-CE）の表示切替', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const firstId = await page.evaluate(() => window.__karu!.getSelectedAnnotationIds()[0])
  await second.click(); await expect(second).toContainText('2 / 2')
  await expect.poll(() => page.evaluate(() => window.__karu!.getSelectedAnnotationIds()[0])).not.toBe(firstId)
  await second.click(); await expect(second).toContainText('1 / 2')
  await expect.poll(() => page.evaluate(() => window.__karu!.getSelectedAnnotationIds()[0])).toBe(firstId)
  // Delete selected quantity using the normal editor command; the open index must refresh.
  await page.keyboard.press('Delete')
  await expect(b.locator('.quantity-breakdown-total')).toHaveText('合計 92.00 m')
  await page.keyboard.press('Control+z')
  await expect(b.locator('.quantity-breakdown-total')).toHaveText('合計 100.00 m')
  await page.getByRole('button', { name: '数量をCSVに書き出す', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '数量をCSVに書き出す', exact: true })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0)
  await expect(b).toBeVisible()
  await page.keyboard.press('Escape'); await expect(b).toHaveCount(0)
})

test('location-first breakdown shows floor/room totals and filters page quantities', async ({ page }) => {
  await open(page); await totalButton(page, 'LED LED埋込形').click()
  const b = breakdown(page)
  await expect(b.getByRole('button', { name: '階・部屋別', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(b.locator('.quantity-breakdown-floor')).toHaveText(['1階 32 個', '2階 32 個'])
  await expect(b.locator('.quantity-breakdown-room')).toHaveText(['会議室 8 個', '事務室 24 個', '事務室 32 個'])
  await b.getByRole('button', { name: '会議室 8 個', exact: true }).click()
  await expect(b.locator('.quantity-breakdown-page')).toHaveCount(1)
  await expect(b.locator('.quantity-breakdown-page')).toContainText('E-1011階 幹線設備平面図8 個')
  await expect(b.locator('.quantity-breakdown-total')).toHaveText('合計 8 個')
  await b.getByRole('button', { name: '絞り込みを解除', exact: true }).click()
  await expect(b.locator('.quantity-breakdown-page')).toHaveCount(2)
  await b.getByRole('button', { name: '閉じる', exact: true }).click()
  await expect(b).toHaveCount(0)
})

test('deletion and reorder rebuild cable/earth totals and drawing page identities', async ({ page }) => {
  await open(page)
  await page.evaluate(async () => { await window.__karu!.openOrganize(); const d = window.__karu!.organizeDraft()!; d.delete([d.getCards()[1].id]); await window.__karu!.applyOrganize() })
  await page.getByRole('tab', { name: '数量', exact: true }).click(); await page.getByTestId('fixture-panel').getByRole('button', { name: '管理', exact: true }).click()
  await totalButton(page).click(); await expect(breakdown(page).locator('.quantity-breakdown-total')).toHaveText('合計 80.00 m')
  await expect(breakdown(page).locator('.quantity-breakdown-page')).toHaveCount(2)
  await expect(breakdown(page).locator('[data-page-index="1"]')).toContainText('E-103')
  await breakdown(page).getByRole('button', { name: '閉じる', exact: true }).click()
  await totalButton(page, '根切り 根切り').click(); await expect(breakdown(page).locator('.quantity-breakdown-total')).toHaveText('合計 80.00 m³')
  await page.evaluate(async () => { await window.__karu!.openOrganize(); const d = window.__karu!.organizeDraft()!; d.move([d.getCards()[1].id], 0); await window.__karu!.applyOrganize() })
  await page.getByRole('tab', { name: '数量', exact: true }).click(); await page.getByTestId('fixture-panel').getByRole('button', { name: '管理', exact: true }).click()
  await totalButton(page).click(); await expect(breakdown(page).locator('.quantity-breakdown-total')).toHaveText('合計 80.00 m')
  await expect(breakdown(page).locator('[data-page-index="0"]')).toContainText('E-103')
  await expect(breakdown(page).locator('[data-page-index="1"]')).toContainText('E-101')
  await breakdown(page).getByRole('button', { name: '閉じる', exact: true }).click()
  await totalButton(page, '根切り 根切り').click(); await expect(breakdown(page).locator('.quantity-breakdown-total')).toHaveText('合計 80.00 m³')
})

test('exports summary/detail CSV with metadata, values, locations and mark counts', async ({ page }) => {
  await open(page)
  await page.evaluate(() => Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }))
  for (const detail of [false, true]) {
    await page.getByRole('button', { name: '数量をCSVに書き出す', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '数量をCSVに書き出す', exact: true })
    if (detail) await dialog.getByRole('radio', { name: '明細（項目・ページ・場所ごと）', exact: true }).check()
    const pending = page.waitForEvent('download')
    await dialog.getByRole('button', { name: '書き出す', exact: true }).click()
    const download = await pending, stream = await download.createReadStream(), chunks: Buffer[] = []
    for await (const chunk of stream!) chunks.push(chunk)
    const csv = Buffer.concat(chunks).toString('utf8')
    expect(download.suggestedFilename()).toBe(`内訳試験_数量${detail ? '明細' : '集計'}.csv`)
    expect(csv.charCodeAt(0)).toBe(0xFEFF)
    if (detail) {
      expect(csv).toContain('階,部屋,ページ番号,図面番号,図面名称,数量,拾いの件数')
      expect(csv).toContain('電気,EM-CE,ケーブル（EM-CE）,3C-5.5sq,長さ,m,全図面,,,2,E-102,2階 幹線設備平面図,20.00,2')
      expect(csv).toContain('場所別,1階,事務室,1,E-101,1階 幹線設備平面図,24,24')
      expect(csv).toContain('場所別,1階,会議室,1,E-101,1階 幹線設備平面図,8,8')
    } else {
      expect(csv).toContain('p.1 E-101,p.2 E-102,p.3 E-103')
      expect(csv).not.toContain('p.4')
      expect(csv).toContain('電気,EM-CE,ケーブル（EM-CE）,3C-5.5sq,長さ,m,全図面,100.00,30.00,30.00,20.00,50.00')
      expect(csv).toContain('土工,根切り,根切り,,体積,m³,全図面,100.00,30.00,30.00,20.00,50.00')
    }
    await download.delete()
  }
  const annotations = await page.evaluate(() => window.__karu!.exportCsv(['count']))
  expect(annotations).toContain('階,部屋\r\n')
  expect(annotations).toContain('E-101')
  expect(annotations).toContain(',1階,事務室')
})
