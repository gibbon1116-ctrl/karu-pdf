import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import { writeDrawingInfo } from '../src/core/drawingInfo'
import { readDocumentPageRoomSets, readRoomSets } from '../src/core/rooms'

function blankPdf() {
  const doc = new mupdf.PDFDocument()
  try {
    for (const name of ['1階電灯設備平面図', '1階コンセント設備平面図']) {
      const ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
      try { doc.insertPage(-1, ref) } finally { ref.destroy() }
      const page = doc.loadPage(doc.countPages() - 1)
      try { writeDrawingInfo(doc, page, { name, scanned: true }) } finally { page.destroy() }
    }
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { doc.destroy() }
}

async function open(page: Page, bytes = blankPdf()) {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(value => window.__karu!.openBytes(value, '位置合わせ試験.pdf'), bytes)
  await page.evaluate(() => window.__karu!.setZoom(1))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('button', { name: '数量拾い', exact: true }).click()
}

async function goToPage(page: Page, pageIndex: number) {
  const layer = page.getByTestId(`annotation-layer-${pageIndex}`)
  await layer.scrollIntoViewIfNeeded()
  await layer.evaluate(element => element.scrollIntoView({ block: 'start' }))
  await expect(layer).toBeVisible()
  // The status bar shows the current page whether or not an item is selected.
  await expect(page.locator('.status-bar')).toContainText(`${pageIndex + 1} / `)
}

async function point(page: Page, pageIndex: number, x: number, y: number) {
  return page.getByTestId(`annotation-layer-${pageIndex}`).evaluate((element, value) => {
    const svg = element as SVGSVGElement, box = svg.getBoundingClientRect()
    return {
      x: box.left + value.x * box.width / svg.viewBox.baseVal.width,
      y: box.top + value.y * box.height / svg.viewBox.baseVal.height,
    }
  }, { x, y })
}

async function click(page: Page, pageIndex: number, x: number, y: number) {
  const target = await point(page, pageIndex, x, y)
  await page.mouse.click(target.x, target.y)
}

async function drag(page: Page, pageIndex: number, from: [number, number], to: [number, number]) {
  const start = await point(page, pageIndex, ...from), end = await point(page, pageIndex, ...to)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 5 })
  await page.mouse.up()
}

async function addItem(page: Page) {
  await page.getByRole('button', { name: '項目を追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await dialog.getByLabel('名称', { exact: true }).fill('コンセント')
  await dialog.getByLabel('略号', { exact: true }).fill('C')
  await dialog.getByRole('radio', { name: '個数', exact: true }).check()
  await dialog.getByLabel('分類', { exact: true }).selectOption('')
  await dialog.getByLabel('新しい分類の名前', { exact: true }).fill('試験')
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  await page.getByRole('button', { name: 'C コンセント', exact: true }).click()
}

async function createSet(page: Page) {
  await page.getByRole('button', { name: '部屋の範囲を囲む', exact: true }).click()
  for (const [x, y] of [[80, 80], [180, 80], [180, 180], [80, 180]]) {
    await click(page, 0, x, y)
  }
  await page.keyboard.press('Enter')
  const roomDialog = page.getByRole('dialog', { name: '部屋の範囲', exact: true })
  await roomDialog.getByLabel('部屋名', { exact: true }).fill('事務室')
  await roomDialog.getByLabel('階', { exact: true }).fill('1階')
  await roomDialog.getByRole('button', { name: '登録する', exact: true }).click()
  await expect(roomDialog).toHaveCount(0)
  await page.getByRole('button', { name: 'この図面の範囲を部屋の組にする', exact: true }).click()
  const setDialog = page.getByRole('dialog', { name: '部屋の組', exact: true })
  await setDialog.getByRole('button', { name: '作る', exact: true }).click()
  await expect(setDialog).toHaveCount(0)
}

async function save(page: Page) {
  return new Uint8Array(await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!]))
}

function metadata(bytes: Uint8Array) {
  const doc = new mupdf.PDFDocument(bytes)
  try {
    const sets = readRoomSets(doc), links = readDocumentPageRoomSets(doc, sets)
    const pickups: Array<{ pageIndex: number; room?: string }> = []
    for (let pageIndex = 0; pageIndex < doc.countPages(); pageIndex++) {
      const page = doc.loadPage(pageIndex)
      try {
        const annotations = page.getAnnotations()
        try {
          for (const annotation of annotations) {
            const object = annotation.getObject()
            try {
              object.forEach(value => {
                try {
                  if (!value.isString()) return
                  let raw: unknown
                  try { raw = JSON.parse(value.asString()) } catch { return }
                  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
                  const mark = raw as { fixtureId?: unknown; itemId?: unknown; room?: string }
                  if (typeof mark.fixtureId === 'string' || typeof mark.itemId === 'string') {
                    pickups.push({ pageIndex, room: mark.room })
                  }
                } finally { value.destroy() }
              })
            } finally { object.destroy() }
          }
        } finally { annotations.forEach(annotation => annotation.destroy()) }
      } finally { page.destroy() }
    }
    return { sets, links, pickups }
  } finally { doc.destroy() }
}

function polygon(page: Page, pageIndex: number) {
  return page.getByTestId(`annotation-layer-${pageIndex}`).locator('.room-region polygon')
}
// Screen-to-page conversion leaves sub-pt noise; compare whole points.
async function expectPoints(page: Page, pageIndex: number, expected: string) {
  await expect.poll(async () => (await polygon(page, pageIndex).getAttribute('points'))?.split(' ')
    .map(point => point.split(',').map(n => Math.round(Number(n))).join(',')).join(' ')).toBe(expected)
}

test('支点・図面ごとの位置合わせ・ドラッグ・矢印・拾い・形の共有・保存と位置を戻す', async ({ page }) => {
  await open(page)
  await addItem(page)
  await createSet(page)
  await expect(page.locator('.room-set-controls')).toContainText('支点：未設定')
  await page.getByRole('button', { name: '位置を合わせる', exact: true }).click()
  await click(page, 0, 50, 50)
  await expect(page.getByTestId('annotation-layer-0').getByTestId('room-set-anchor')).toHaveCount(1)
  await page.keyboard.press('Enter')

  await goToPage(page, 1)
  await page.getByRole('button', { name: '部屋の組「1階」を使う（1室）', exact: true }).click()
  await page.getByRole('button', { name: '位置を合わせる', exact: true }).click()
  await click(page, 1, 80, 70)
  await expectPoints(page, 1, '110,100 210,100 210,200 110,200')
  await page.locator('.viewer').focus()
  await page.keyboard.press('Control+z')
  await expectPoints(page, 1, '80,80 180,80 180,180 80,180')
  await click(page, 1, 80, 70)
  await drag(page, 1, [150, 140], [155, 147])
  await expectPoints(page, 1, '115,107 215,107 215,207 115,207')
  await page.keyboard.press('ArrowRight')
  await expectPoints(page, 1, '116,107 216,107 216,207 116,207')
  await page.keyboard.press('Shift+ArrowDown')
  await expectPoints(page, 1, '116,117 216,117 216,217 116,217')
  await page.getByRole('button', { name: '合わせ終える', exact: true }).click()

  await click(page, 1, 150, 150)
  await click(page, 1, 90, 90)
  const pickups = metadata(await save(page)).pickups.filter(mark => mark.pageIndex === 1)
  expect(pickups).toHaveLength(2)
  expect(pickups.filter(mark => mark.room === '事務室')).toHaveLength(1)
  expect(pickups.filter(mark => !mark.room)).toHaveLength(1)

  const row = page.getByRole('list', { name: 'このページの部屋の範囲', exact: true })
    .locator('li').filter({ hasText: '事務室' })
  await row.getByRole('button', { name: '範囲を直す', exact: true }).click()
  await drag(page, 1, [216, 117], [236, 107])
  await row.getByRole('button', { name: '直し終える', exact: true }).click()
  await expectPoints(page, 1, '116,117 236,107 216,217 116,217')
  await goToPage(page, 0)
  await expectPoints(page, 0, '80,80 200,70 180,180 80,180')

  const saved = await save(page), persisted = metadata(saved)
  expect(persisted.sets[0].anchor?.map(Math.round)).toEqual([50, 50])
  expect(persisted.links.map(([pageIndex, link]) => [pageIndex, {
    ...link,
    ...(link.dx !== undefined ? { dx: Math.round(link.dx) } : {}),
    ...(link.dy !== undefined ? { dy: Math.round(link.dy) } : {}),
  }])).toEqual([
    [0, { id: persisted.sets[0].id }],
    [1, { id: persisted.sets[0].id, dx: 36, dy: 37 }],
  ])
  await open(page, [...saved])
  await goToPage(page, 1)
  await expectPoints(page, 1, '116,117 236,107 216,217 116,217')
  await page.getByRole('button', { name: '位置を戻す', exact: true }).click()
  await expectPoints(page, 1, '80,80 200,70 180,180 80,180')
  await page.locator('.viewer').focus()
  await page.keyboard.press('Control+z')
  await expectPoints(page, 1, '116,117 236,107 216,217 116,217')
  await page.getByRole('button', { name: '位置を戻す', exact: true }).click()
  const reset = metadata(await save(page))
  expect(reset.links[1]).toEqual([1, { id: reset.sets[0].id }])
  expect(reset.sets[0].anchor?.map(Math.round)).toEqual([50, 50])
})

test('支点の決め直しはずらしを変えず、位置合わせ終了時の確認と自動終了を扱う', async ({ page }) => {
  await open(page)
  await addItem(page)
  await createSet(page)
  await page.getByRole('button', { name: '位置を合わせる', exact: true }).click()
  await click(page, 0, 50, 50)
  await page.keyboard.press('Escape')
  await goToPage(page, 1)
  await page.getByRole('button', { name: '部屋の組「1階」を使う（1室）', exact: true }).click()
  const roomInput = page.getByLabel('現在の部屋', { exact: true })
  await roomInput.fill('廊下')
  await roomInput.press('Tab')
  await click(page, 1, 200, 120)

  await page.getByRole('button', { name: '位置を合わせる', exact: true }).click()
  await click(page, 1, 80, 70)
  await page.getByRole('button', { name: '支点を決め直す', exact: true }).click()
  await click(page, 1, 150, 140)
  await expectPoints(page, 1, '110,100 210,100 210,200 110,200')
  await page.locator('.viewer').focus()
  await page.keyboard.press('Control+z')
  expect(metadata(await save(page)).sets[0].anchor?.map(Math.round)).toEqual([50, 50])
  await page.keyboard.press('Escape')
  const confirmation = page.getByRole('dialog', { name: '既存の拾いに部屋を入れる', exact: true })
  await expect(confirmation).toContainText('この図面の 1 件の拾いに部屋を入れますか（Ctrl+Z で戻せます）')
  await confirmation.getByRole('button', { name: '部屋を入れる', exact: true }).click()
  expect(metadata(await save(page)).pickups[0].room).toBe('事務室')
  await page.locator('.viewer').focus()
  await page.keyboard.press('Control+z')
  expect(metadata(await save(page)).pickups[0].room).toBe('廊下')

  await page.getByRole('button', { name: '位置を合わせる', exact: true }).click()
  await page.keyboard.press('ArrowRight')
  await goToPage(page, 0)
  await expect(page.locator('.room-set-align-guide')).toHaveCount(0)
  await expect(confirmation).toHaveCount(0)
  await goToPage(page, 1)
  await page.getByRole('button', { name: '位置を合わせる', exact: true }).click()
  await page.getByRole('button', { name: '組を外す', exact: true }).click()
  await expect(page.locator('.room-set-align-guide')).toHaveCount(0)
  await expect(confirmation).toHaveCount(0)
})
