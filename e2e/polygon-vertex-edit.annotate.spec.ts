import { expect, test, type Locator, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import { readDocumentRoomRegions } from '../src/core/rooms'

function blankPdf() {
  const doc = new mupdf.PDFDocument(), ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
  try {
    doc.insertPage(-1, ref)
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { ref.destroy(); doc.destroy() }
}

async function open(page: Page) {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '多角形編集試験.pdf'), blankPdf())
  await page.evaluate(() => window.__karu!.setZoom(1))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
}

async function point(page: Page, x: number, y: number) {
  return page.getByTestId('annotation-layer-0').evaluate((element, value) => {
    const svg = element as SVGSVGElement, box = svg.getBoundingClientRect()
    return {
      x: box.left + value.x * box.width / svg.viewBox.baseVal.width,
      y: box.top + value.y * box.height / svg.viewBox.baseVal.height,
    }
  }, { x, y })
}

async function click(page: Page, x: number, y: number) {
  const p = await point(page, x, y)
  await page.mouse.click(p.x, p.y)
}

async function polygon(page: Page, x: number, y: number, width = 72, height = width) {
  await click(page, x, y)
  await click(page, x + width, y)
  await click(page, x + width, y + height)
  await click(page, x, y + height)
  await page.keyboard.press('Enter')
}

async function drag(page: Page, handle: Locator, x: number, y: number) {
  const box = await handle.boundingBox()
  expect(box).not.toBeNull()
  const end = await point(page, x, y)
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 8 })
  await page.mouse.up()
}

async function undo(page: Page) {
  await page.locator('.viewer').focus()
  await page.keyboard.press('Control+z')
}

async function setScale(page: Page) {
  await click(page, 100, 120)
  const dialog = page.getByRole('dialog', { name: '縮尺の設定（1 ページ）' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('縮尺の分母').fill('100')
  await dialog.getByRole('button', { name: '決定', exact: true }).click()
}

async function addItem(page: Page, kind: 'count' | 'area', name: string, code: string) {
  await page.getByRole('button', { name: '項目を追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await dialog.getByLabel('名称', { exact: true }).fill(name)
  await dialog.getByLabel('略号', { exact: true }).fill(code)
  await dialog.getByRole('radio', { name: kind === 'count' ? '個数' : '面積', exact: true }).check()
  if (kind === 'area') await dialog.getByRole('radio', { name: '囲む', exact: true }).check()
  await dialog.getByLabel('分類', { exact: true }).selectOption('')
  await dialog.getByLabel('新しい分類の名前', { exact: true }).fill('試験')
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.getByRole('button', { name: `${code} ${name}`, exact: true }).click()
}

const measureHandles = (page: Page) => page.locator('[data-measure-vertex]')
const measureMidpoints = (page: Page) => page.locator('[data-measure-midpoint]')
const labels = (page: Page) => page.locator('.measurement-shape .measurement-label')
const roomHandles = (page: Page) => page.locator('.room-region-editing [data-room-vertex]')
const roomMidpoints = (page: Page) => page.locator('.room-region-editing [data-room-midpoint]')
const roomPolygon = (page: Page) => page.locator('.room-region-editing > polygon')
const confirmation = (page: Page) => page.getByRole('dialog', { name: '既存の拾いに部屋を入れる' })

// Undo clears the selection, so read the point count from the store and select again to keep editing.
async function vertexCount(page: Page) {
  return page.evaluate(() => window.__karu!.getEditableAnnotations(0).find(a => a.measure)?.vertices?.length ?? 0)
}

async function reselect(page: Page) {
  // The left edge of the 72pt square drawn at (100, 120).
  await click(page, 100, 156)
  await expect(measureHandles(page).first()).toBeVisible()
}

async function startAreaPickup(page: Page) {
  await open(page)
  await page.getByRole('button', { name: '数量拾い', exact: true }).click()
  await addItem(page, 'area', '床', 'A')
  await setScale(page)
  await polygon(page, 100, 120)
  await expect(labels(page)).toHaveText('A 6.45 m²')
  await page.getByRole('button', { name: '選択', exact: true }).click()
  await expect(measureHandles(page)).toHaveCount(4)
  await expect(measureMidpoints(page)).toHaveCount(4)
}

async function registerRoom(page: Page, name = '会議室', floor = '2階') {
  await page.getByRole('button', { name: '部屋の範囲を囲む', exact: true }).click()
  await polygon(page, 80, 80, 100)
  const dialog = page.getByRole('dialog', { name: '部屋の範囲', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('部屋名', { exact: true }).fill(name)
  await dialog.getByLabel('階', { exact: true }).fill(floor)
  await dialog.getByRole('button', { name: '登録する', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

async function currentLocation(page: Page, floor: string, room: string) {
  const floorInput = page.getByLabel('現在の階', { exact: true })
  await floorInput.fill(floor)
  await floorInput.press('Tab')
  const roomInput = page.getByLabel('現在の部屋', { exact: true })
  await roomInput.fill(room)
  await roomInput.press('Tab')
}

interface SavedPickup {
  fixtureId?: string
  itemId?: string
  room?: string
  floor?: string
}

async function savedMetadata(page: Page) {
  const bytes = new Uint8Array(await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!]))
  const doc = new mupdf.PDFDocument(bytes)
  try {
    const rooms = readDocumentRoomRegions(doc), pickups: SavedPickup[] = []
    for (let pageIndex = 0; pageIndex < doc.countPages(); pageIndex++) {
      const pdfPage = doc.loadPage(pageIndex)
      try {
        const annotations = pdfPage.getAnnotations()
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
                  if (typeof mark.fixtureId === 'string' || typeof mark.itemId === 'string') pickups.push(mark)
                } finally { value.destroy() }
              })
            } finally { object.destroy() }
          }
        } finally { for (const annotation of annotations) annotation.destroy() }
      } finally { pdfPage.destroy() }
    }
    return { rooms, pickups }
  } finally { doc.destroy() }
}

test('囲む面積の辺をドラッグして点と値が増え、1回のUndoで戻る', async ({ page }) => {
  await startAreaPickup(page)
  await drag(page, page.getByTestId('measure-midpoint-0'), 136, 100)
  await expect(measureHandles(page)).toHaveCount(5)
  await expect(measureMidpoints(page)).toHaveCount(5)
  await expect(labels(page)).not.toHaveText('A 6.45 m²')
  await undo(page)
  await expect.poll(() => vertexCount(page)).toBe(4)
  await expect(labels(page)).toHaveText('A 6.45 m²')
})

test('閉じる辺の中点はクリックでも追加でき、頂点削除は3点で止まる', async ({ page }) => {
  await startAreaPickup(page)
  await page.getByTestId('measure-midpoint-3').click()
  await expect(measureHandles(page)).toHaveCount(5)
  await expect(labels(page)).toHaveText('A 6.45 m²')
  await undo(page)
  await expect.poll(() => vertexCount(page)).toBe(4)
  await reselect(page)

  await page.getByTestId('measure-handle-0').dblclick()
  await expect(measureHandles(page)).toHaveCount(3)
  await page.getByTestId('measure-handle-0').dblclick()
  await expect(measureHandles(page)).toHaveCount(3)
  await expect(page.getByText('面積の点は3つより少なくできません', { exact: true })).toBeVisible()

  await undo(page)
  await expect.poll(() => vertexCount(page)).toBe(4)
  await expect(labels(page)).toHaveText('A 6.45 m²')
})

test('計測の面積でも中点をドラッグして追加でき、1回のUndoで値と点が戻る', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '計測▼' }).click()
  await page.getByRole('menuitemcheckbox', { name: '面積', exact: false }).click()
  await setScale(page)
  await polygon(page, 100, 120)
  await page.getByRole('button', { name: '選択', exact: true }).click()
  await expect(measureHandles(page)).toHaveCount(4)
  const original = (await labels(page).textContent())!

  await drag(page, page.getByTestId('measure-midpoint-0'), 136, 100)
  await expect(measureHandles(page)).toHaveCount(5)
  await expect(labels(page)).not.toHaveText(original)
  await undo(page)
  await expect.poll(() => vertexCount(page)).toBe(4)
  await expect(labels(page)).toHaveText(original)
})

test('部屋の形と中点を編集して各操作を1回でUndoでき、非表示でも編集できる', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '数量拾い', exact: true }).click()
  await registerRoom(page)
  await page.getByRole('button', { name: '範囲を直す', exact: true }).click()
  await expect(roomHandles(page)).toHaveCount(4)
  await expect(roomMidpoints(page)).toHaveCount(4)
  const original = await roomPolygon(page).getAttribute('points')

  await drag(page, page.getByTestId('room-handle-1'), 280, 80)
  await expect(roomPolygon(page)).not.toHaveAttribute('points', original!)
  await undo(page)
  await expect(roomPolygon(page)).toHaveAttribute('points', original!)
  await expect(roomHandles(page)).toHaveCount(4)

  await drag(page, page.getByTestId('room-midpoint-0'), 130, 60)
  await expect(roomHandles(page)).toHaveCount(5)
  await undo(page)
  await expect(roomHandles(page)).toHaveCount(4)
  await expect(roomPolygon(page)).toHaveAttribute('points', original!)

  await page.getByRole('button', { name: '直し終える', exact: true }).click()
  await expect(roomHandles(page)).toHaveCount(0)
  await expect(confirmation(page)).toHaveCount(0)
  const settings = page.locator('.fixture-panel-settings')
  if (!await settings.getAttribute('open')) await settings.locator('summary').click()
  await page.getByLabel('部屋の範囲を表示', { exact: true }).uncheck()
  await expect(page.locator('.room-region')).toHaveCount(0)
  await page.getByRole('button', { name: '範囲を直す', exact: true }).click()
  await expect(roomHandles(page)).toHaveCount(4)
  await expect(roomPolygon(page)).toBeVisible()
  await page.locator('.viewer').focus()
  await page.keyboard.press('Escape')
  await expect(roomHandles(page)).toHaveCount(0)
  await expect(page.locator('.room-region')).toHaveCount(0)
})

test('部屋の点の追加・削除は各1回のUndoで戻り、3点より少なくならない', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '数量拾い', exact: true }).click()
  await registerRoom(page)
  await page.getByRole('button', { name: '範囲を直す', exact: true }).click()

  await page.getByTestId('room-midpoint-3').click()
  await expect(roomHandles(page)).toHaveCount(5)
  await undo(page)
  await expect(roomHandles(page)).toHaveCount(4)

  await page.getByTestId('room-handle-0').dblclick()
  await expect(roomHandles(page)).toHaveCount(3)
  await page.getByTestId('room-handle-0').dblclick()
  await expect(roomHandles(page)).toHaveCount(3)
  await expect(page.getByRole('alert').filter({ hasText: '部屋の範囲の点は3つより少なくできません' })).toBeVisible()
  await undo(page)
  await expect(roomHandles(page)).toHaveCount(4)
})

test('広げた部屋の違う拾いだけに部屋と階を入れ、外の拾いは変えない', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '数量拾い', exact: true }).click()
  await addItem(page, 'count', '器具', 'C')

  await currentLocation(page, '1階', '別室')
  await click(page, 240, 110)
  await currentLocation(page, '3階', '外の部屋')
  await click(page, 350, 110)
  await registerRoom(page)
  await expect(confirmation(page)).toHaveCount(0)

  // An existing pickup already matching the region must not be in the confirmation.
  await currentLocation(page, '2階', '会議室')
  await click(page, 120, 120)

  const initial = await savedMetadata(page)
  expect(initial.pickups).toHaveLength(3)
  const initialRoom = initial.rooms[0][1][0]

  await page.getByRole('button', { name: '範囲を直す', exact: true }).click()
  await drag(page, page.getByTestId('room-handle-1'), 280, 80)
  await page.keyboard.press('Enter')
  await expect(confirmation(page)).toBeVisible()
  await expect(confirmation(page)).toContainText('この範囲の 1 件の拾いの部屋を「会議室」にしますか')
  await confirmation(page).getByRole('button', { name: '部屋を入れる', exact: true }).click()
  await expect(confirmation(page)).toHaveCount(0)

  const changed = await savedMetadata(page)
  expect(changed.pickups.filter(mark => mark.room === '会議室' && mark.floor === '2階')).toHaveLength(2)
  expect(changed.pickups.filter(mark => mark.room === '外の部屋' && mark.floor === '3階')).toHaveLength(1)
  expect(changed.rooms[0][1][0]).toMatchObject({
    id: initialRoom.id,
    name: initialRoom.name,
    floor: initialRoom.floor,
  })
  expect(changed.rooms[0][1][0].points).not.toEqual(initialRoom.points)

  await undo(page)
  const restored = await savedMetadata(page)
  expect(restored.pickups.filter(mark => mark.room === '別室' && mark.floor === '1階')).toHaveLength(1)
  expect(restored.rooms[0][1][0].points).toEqual(changed.rooms[0][1][0].points)
})

test('Escと直し終えるでも確認でき、入れない場合は拾いを変えない', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '数量拾い', exact: true }).click()
  await addItem(page, 'count', '器具', 'C')
  await currentLocation(page, '1階', '別室')
  await click(page, 240, 110)
  await registerRoom(page)

  await page.getByRole('button', { name: '範囲を直す', exact: true }).click()
  await drag(page, page.getByTestId('room-handle-1'), 280, 80)
  await page.keyboard.press('Escape')
  await expect(confirmation(page)).toBeVisible()
  await confirmation(page).getByRole('button', { name: '入れない', exact: true }).click()
  expect((await savedMetadata(page)).pickups).toEqual([
    expect.objectContaining({ room: '別室', floor: '1階' }),
  ])

  await page.getByRole('button', { name: '範囲を直す', exact: true }).click()
  await drag(page, page.getByTestId('room-handle-1'), 300, 80)
  await page.getByRole('button', { name: '直し終える', exact: true }).click()
  await expect(confirmation(page)).toBeVisible()
  await confirmation(page).getByRole('button', { name: '入れない', exact: true }).click()
  expect((await savedMetadata(page)).pickups).toEqual([
    expect.objectContaining({ room: '別室', floor: '1階' }),
  ])
})

test('Undoで編集中の範囲が消えると編集が終わり、確認は出ない', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '数量拾い', exact: true }).click()
  await registerRoom(page)
  await page.getByRole('button', { name: '範囲を直す', exact: true }).click()
  await expect(roomHandles(page)).toHaveCount(4)

  await undo(page)
  await expect(roomHandles(page)).toHaveCount(0)
  await expect(page.locator('.room-region')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '直し終える', exact: true })).toHaveCount(0)
  await expect(confirmation(page)).toHaveCount(0)
  await expect(page.getByText(
    '部屋の範囲の点をドラッグで動かし、辺の中の○をドラッグで点を足します。点のダブルクリックで消します（Enter・Esc で終える）',
    { exact: true },
  )).toHaveCount(0)
})

test('一覧で編集中の範囲を削除すると編集が終わる', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '数量拾い', exact: true }).click()
  await registerRoom(page)
  await page.getByRole('button', { name: '範囲を直す', exact: true }).click()
  await expect(roomHandles(page)).toHaveCount(4)

  await page.getByRole('list', { name: 'このページの部屋の範囲' })
    .getByRole('button', { name: '削除', exact: true }).click()
  await expect(roomHandles(page)).toHaveCount(0)
  await expect(confirmation(page)).toHaveCount(0)
})

test('道具変更と部屋の囲み開始は編集を終了し、確認を出さない', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '数量拾い', exact: true }).click()
  await addItem(page, 'count', '器具', 'C')
  await currentLocation(page, '1階', '別室')
  await click(page, 240, 110)
  await registerRoom(page)

  await page.getByRole('button', { name: '範囲を直す', exact: true }).click()
  await drag(page, page.getByTestId('room-handle-1'), 280, 80)
  await page.getByRole('button', { name: '選択', exact: true }).click()
  await expect(roomHandles(page)).toHaveCount(0)
  await expect(confirmation(page)).toHaveCount(0)

  await page.getByRole('button', { name: '範囲を直す', exact: true }).click()
  await drag(page, page.getByTestId('room-handle-1'), 300, 80)
  await page.getByRole('button', { name: '部屋の範囲を囲む', exact: true }).click()
  await expect(roomHandles(page)).toHaveCount(0)
  await expect(confirmation(page)).toHaveCount(0)
  await expect(page.getByText(
    '部屋の範囲を囲んでください（Enter・ダブルクリックで決定、Esc で中止）',
    { exact: true },
  )).toBeVisible()
  await page.keyboard.press('Escape')
})
