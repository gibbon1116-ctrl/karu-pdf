import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import { writeDrawingInfo } from '../src/core/drawingInfo'
import { normalizeFloor } from '../src/core/location'
import { readDocumentPageRoomSets, readDocumentRoomRegions, readRoomSets } from '../src/core/rooms'

function blankPdf() {
  const doc = new mupdf.PDFDocument()
  const names = ['1階電灯設備平面図', '1階コンセント設備平面図', '2階電灯設備平面図']
  try {
    for (const name of names) {
      const ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
      try { doc.insertPage(-1, ref) } finally { ref.destroy() }
      const page = doc.loadPage(doc.countPages() - 1)
      try { writeDrawingInfo(doc, page, { name, scanned: true }) } finally { page.destroy() }
    }
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { doc.destroy() }
}

async function open(page: Page, bytes = blankPdf(), name = '部屋の組試験.pdf') {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(value => window.__karu!.openBytes(value.bytes, value.name), { bytes, name })
  await page.evaluate(() => window.__karu!.setZoom(1))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('button', { name: '数量拾い', exact: true }).click()
}

async function goToPage(page: Page, pageIndex: number) {
  const layer = page.getByTestId(`annotation-layer-${pageIndex}`)
  await layer.scrollIntoViewIfNeeded()
  await layer.evaluate(element => element.scrollIntoView({ block: 'start' }))
  await expect(layer).toBeVisible()
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

async function registerRoom(page: Page, x: number, name: string) {
  await page.getByRole('button', { name: '部屋の範囲を囲む', exact: true }).click()
  for (const [px, py] of [[x, 80], [x + 100, 80], [x + 100, 180], [x, 180]]) {
    await click(page, 0, px, py)
  }
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: '部屋の範囲', exact: true })
  await dialog.getByLabel('部屋名', { exact: true }).fill(name)
  await dialog.getByLabel('階', { exact: true }).fill('1階')
  await dialog.getByRole('button', { name: '登録する', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

async function createSet(page: Page) {
  await registerRoom(page, 80, '事務室')
  await registerRoom(page, 250, '会議室')
  await page.getByRole('button', { name: 'この図面の範囲を部屋の組にする', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '部屋の組', exact: true })
  await expect(dialog.getByLabel('組の名前', { exact: true })).toHaveValue('1階')
  await expect(dialog.getByLabel('階', { exact: true })).toHaveValue('1階')
  await dialog.getByRole('button', { name: '作る', exact: true }).click()
  await expect(dialog).toHaveCount(0)
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

async function setCurrentRoom(page: Page, room: string) {
  const input = page.getByLabel('現在の部屋', { exact: true })
  await input.fill(room)
  await input.press('Tab')
}

async function undo(page: Page) {
  await page.locator('.viewer').focus()
  await page.keyboard.press('Control+z')
}

async function save(page: Page) {
  return new Uint8Array(await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!]))
}

interface SavedPickup {
  fixtureId?: string
  itemId?: string
  room?: string
  floor?: string
}

function metadata(bytes: Uint8Array) {
  const doc = new mupdf.PDFDocument(bytes)
  try {
    const sets = readRoomSets(doc)
    const links = readDocumentPageRoomSets(doc, sets)
    const rooms = readDocumentRoomRegions(doc)
    const pickups: Array<SavedPickup & { pageIndex: number }> = []
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
                  const mark = raw as SavedPickup
                  if (typeof mark.fixtureId === 'string' || typeof mark.itemId === 'string') {
                    pickups.push({ ...mark, pageIndex })
                  }
                } finally { value.destroy() }
              })
            } finally { object.destroy() }
          }
        } finally { annotations.forEach(annotation => annotation.destroy()) }
      } finally { page.destroy() }
    }
    return { sets, links, rooms, pickups }
  } finally { doc.destroy() }
}

test('階の候補・共有した範囲での拾い・形の共有・保存と組を外す', async ({ page }) => {
  await open(page)
  await addItem(page)
  await createSet(page)
  await expect(page.getByRole('list', { name: 'このページの部屋の範囲', exact: true })).toContainText('（組）')

  await goToPage(page, 1)
  const candidate = page.getByRole('button', { name: '部屋の組「1階」を使う（2室）', exact: true })
  await expect(candidate).toBeVisible()
  await candidate.click()
  const secondLayer = page.getByTestId('annotation-layer-1')
  await expect(secondLayer.locator('.room-region')).toHaveCount(2)
  await click(page, 1, 120, 120)
  expect(metadata(await save(page)).pickups).toEqual(expect.arrayContaining([
    expect.objectContaining({ pageIndex: 1, room: '事務室', floor: normalizeFloor('1階') }),
  ]))

  await goToPage(page, 2)
  await expect(page.locator('.current-location > small')).toContainText('2階')
  await expect(candidate).toHaveCount(0)
  await expect(page.getByLabel('部屋の組を使う', { exact: true })).toBeVisible()
  await expect(page.getByTestId('annotation-layer-2').locator('.room-region')).toHaveCount(0)

  await goToPage(page, 1)
  await expect(page.locator('.room-set-controls')).toContainText('2 図面で共通')
  const row = page.getByRole('list', { name: 'このページの部屋の範囲', exact: true })
    .locator('li').filter({ hasText: '事務室' })
  await row.getByRole('button', { name: '範囲を直す', exact: true }).click()
  const handle = secondLayer.getByTestId('room-handle-1')
  const box = await handle.boundingBox()
  if (!box) throw new Error('部屋の頂点が見つかりません。')
  const destination = await point(page, 1, 220, 60)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(destination.x, destination.y, { steps: 5 })
  await page.mouse.up()
  await row.getByRole('button', { name: '直し終える', exact: true }).click()

  const changedPoints = await secondLayer.locator('.room-region').filter({ hasText: '事務室' })
    .locator('polygon').getAttribute('points')
  await goToPage(page, 0)
  await expect(page.getByTestId('annotation-layer-0').locator('.room-region').filter({ hasText: '事務室' })
    .locator('polygon')).toHaveAttribute('points', changedPoints!)

  const saved = await save(page), savedMetadata = metadata(saved)
  expect(savedMetadata.sets).toHaveLength(1)
  expect(savedMetadata.sets[0].regions).toHaveLength(2)
  expect(savedMetadata.links).toEqual([[0, { id: savedMetadata.sets[0].id }], [1, { id: savedMetadata.sets[0].id }]])
  expect(savedMetadata.rooms).toEqual([])

  await open(page, [...saved], '部屋の組保存後.pdf')
  await expect(page.getByTestId('annotation-layer-0').locator('.room-region')).toHaveCount(2)
  await goToPage(page, 1)
  await expect(page.getByTestId('annotation-layer-1').locator('.room-region')).toHaveCount(2)
  await page.getByRole('button', { name: '組を外す', exact: true }).click()
  await expect(page.getByTestId('annotation-layer-1').locator('.room-region')).toHaveCount(0)
  await goToPage(page, 0)
  await expect(page.getByTestId('annotation-layer-0').locator('.room-region')).toHaveCount(2)
})

test('組を使い始めた図面の既存拾いを位置別に反映し、1回のUndoで戻す', async ({ page }) => {
  await open(page)
  await addItem(page)
  await createSet(page)

  await goToPage(page, 1)
  await expect(page.getByRole('button', { name: '部屋の組「1階」を使う（2室）', exact: true })).toBeVisible()
  await setCurrentRoom(page, '廊下')
  await click(page, 1, 120, 120)
  await click(page, 1, 290, 120)

  await page.getByRole('button', { name: '部屋の組「1階」を使う（2室）', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: '既存の拾いに部屋を入れる', exact: true })
  await expect(confirmation).toContainText('この図面の 2 件の拾いに部屋を入れますか（Ctrl+Z で戻せます）')
  await confirmation.getByRole('button', { name: '部屋を入れる', exact: true }).click()
  expect(metadata(await save(page)).pickups.filter(mark => mark.pageIndex === 1)).toEqual(expect.arrayContaining([
    expect.objectContaining({ room: '事務室' }),
    expect.objectContaining({ room: '会議室' }),
  ]))

  await undo(page)
  await expect(page.getByTestId('annotation-layer-1').locator('.room-region')).toHaveCount(2)
  const undone = metadata(await save(page)).pickups.filter(mark => mark.pageIndex === 1)
  expect(undone).toHaveLength(2)
  expect(undone.every(mark => mark.room === '廊下')).toBe(true)

  await page.getByRole('button', { name: '組を外す', exact: true }).click()
  await page.getByLabel('部屋の組を使う', { exact: true }).selectOption({ label: '1階（2室）' })
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: '入れない', exact: true }).click()
  expect(metadata(await save(page)).pickups.filter(mark => mark.pageIndex === 1)
    .every(mark => mark.room === '廊下')).toBe(true)
})
