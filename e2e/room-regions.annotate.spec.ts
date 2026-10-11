import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import { normalizeFloor } from '../src/core/location'
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
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '部屋範囲試験.pdf'), blankPdf())
  await page.evaluate(() => window.__karu!.setZoom(1))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('button', { name: '数量拾い', exact: true }).click()
}

async function click(page: Page, x: number, y: number) {
  const p = await page.getByTestId('annotation-layer-0').evaluate((element, value) => {
    const svg = element as SVGSVGElement, box = svg.getBoundingClientRect()
    return {
      x: box.left + value.x * box.width / svg.viewBox.baseVal.width,
      y: box.top + value.y * box.height / svg.viewBox.baseVal.height,
    }
  }, { x, y })
  await page.mouse.click(p.x, p.y)
}

async function polygon(page: Page, x: number, y: number, width: number, height = width) {
  await click(page, x, y)
  await click(page, x + width, y)
  await click(page, x + width, y + height)
  await click(page, x, y + height)
  await page.keyboard.press('Enter')
}

async function addItem(page: Page, kind: 'count' | 'length', name: string, code: string) {
  await page.getByRole('button', { name: '項目を追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await dialog.getByLabel('名称', { exact: true }).fill(name)
  await dialog.getByLabel('略号', { exact: true }).fill(code)
  await dialog.getByRole('radio', { name: kind === 'count' ? '個数' : '長さ', exact: true }).check()
  await dialog.getByLabel('分類', { exact: true }).selectOption('')
  await dialog.getByLabel('新しい分類の名前', { exact: true }).fill('試験')
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.getByRole('button', { name: `${code} ${name}`, exact: true }).click()
}

async function location(page: Page, floor: string, room: string) {
  const floorInput = page.getByLabel('現在の階', { exact: true })
  await floorInput.fill(floor)
  await floorInput.press('Tab')
  const roomInput = page.getByLabel('現在の部屋', { exact: true })
  await roomInput.fill(room)
  await roomInput.press('Tab')
}

async function registerRoom(page: Page, options: {
  x: number; y: number; width: number; height?: number; name: string; floor: string
}) {
  await page.getByRole('button', { name: '部屋の範囲を囲む', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '部屋の範囲を囲んでください' })).toBeVisible()
  await polygon(page, options.x, options.y, options.width, options.height)
  const dialog = page.getByRole('dialog', { name: '部屋の範囲', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('部屋名', { exact: true }).fill(options.name)
  await dialog.getByLabel('階', { exact: true }).fill(options.floor)
  await dialog.getByRole('button', { name: '登録する', exact: true }).click()
  await expect(dialog).toHaveCount(0)
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
  method?: string
  floor?: string
  room?: string
}

function savedMetadata(bytes: Uint8Array) {
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
              // Inspect the annotation's JSON strings without coupling the test
              // to the names of the count/quantity metadata dictionary keys.
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

test('部屋の登録・自動付与・既存拾いへの反映とUndo・始点・集計・保存と表示切替', async ({ page }) => {
  await open(page)
  await addItem(page, 'count', 'コンセント', 'C')
  await location(page, '2階', '廊下')

  await registerRoom(page, { x: 80, y: 80, width: 140, name: '事務室', floor: '1階' })
  await expect(page.locator('.room-region')).toHaveCount(1)
  await expect(page.locator('.room-region-label')).toHaveText('事務室')
  await expect(page.getByRole('dialog', { name: '既存の拾いに部屋を入れる', exact: true })).toHaveCount(0)

  await click(page, 120, 120)
  await click(page, 300, 300)
  const first = savedMetadata(await save(page))
  expect(first.pickups.filter(mark => mark.fixtureId)).toEqual(expect.arrayContaining([
    expect.objectContaining({ room: '事務室', floor: normalizeFloor('1階') }),
    expect.objectContaining({ room: '廊下', floor: normalizeFloor('2階') }),
  ]))

  await registerRoom(page, { x: 250, y: 250, width: 100, name: '倉庫', floor: '4階' })
  const confirmation = page.getByRole('dialog', { name: '既存の拾いに部屋を入れる', exact: true })
  await expect(confirmation).toContainText('この範囲の 1 件の拾いの部屋を「倉庫」にしますか（Ctrl+Z で戻せます）')
  await confirmation.getByRole('button', { name: '部屋を入れる', exact: true }).click()
  const assigned = savedMetadata(await save(page))
  expect(assigned.pickups.filter(mark => mark.fixtureId)).toEqual(expect.arrayContaining([
    expect.objectContaining({ room: '倉庫', floor: normalizeFloor('4階') }),
  ]))

  await undo(page)
  await expect(page.locator('.room-region')).toHaveCount(2)
  const undone = savedMetadata(await save(page))
  expect(undone.pickups.filter(mark => mark.fixtureId)).toEqual(expect.arrayContaining([
    expect.objectContaining({ room: '廊下', floor: normalizeFloor('2階') }),
  ]))
  expect(undone.pickups.some(mark => mark.room === '倉庫')).toBe(false)

  await addItem(page, 'length', '配線', 'L')
  await click(page, 100, 140)
  const scale = page.getByRole('dialog', { name: '縮尺の設定（1 ページ）', exact: true })
  await expect(scale).toBeVisible()
  await scale.getByLabel('縮尺の分母').fill('100')
  await scale.getByRole('button', { name: '決定', exact: true }).click()
  await click(page, 120, 180)
  await click(page, 350, 180)
  await page.keyboard.press('Enter')
  await expect(page.locator('.measurement-shape .measurement-label')).toHaveCount(1)

  const finalBytes = await save(page)
  const final = savedMetadata(finalBytes)
  expect(final.pickups.find(mark => mark.method === 'polyline')).toMatchObject({
    room: '事務室', floor: normalizeFloor('1階'),
  })
  expect(final.rooms[0][1].map(region => region.name)).toEqual(['事務室', '倉庫'])

  await page.getByRole('button', { name: '集計表を開く', exact: true }).click()
  const table = page.getByRole('region', { name: '数量の集計表', exact: true })
  await table.getByRole('button', { name: '階・部屋別', exact: true }).click()
  await expect(table.getByRole('table').filter({ hasText: '事務室' }).first()).toBeVisible()
  await table.getByRole('button', { name: '集計表を閉じる', exact: true }).click()

  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '部屋範囲保存後.pdf'), [...finalBytes])
  await expect(page.locator('.room-region')).toHaveCount(2)
  await expect(page.locator('.room-region-label')).toHaveText(['事務室', '倉庫'])
  await page.getByRole('button', { name: '数量拾い', exact: true }).click()
  const settings = page.locator('.fixture-panel-settings')
  if (!await settings.evaluate(element => (element as HTMLDetailsElement).open)) {
    await settings.locator('summary').click()
  }
  const visible = page.getByRole('checkbox', { name: '部屋の範囲を表示', exact: true })
  await visible.uncheck()
  await expect(page.locator('.room-region')).toHaveCount(0)
  await visible.check()
  await expect(page.locator('.room-region')).toHaveCount(2)
})

test('入れない・名前変更・削除では既存の拾いの場所を変えない', async ({ page }) => {
  await open(page)
  await addItem(page, 'count', 'コンセント', 'C')
  await location(page, '2階', '廊下')
  await click(page, 120, 120)

  await registerRoom(page, { x: 80, y: 80, width: 140, name: '事務室', floor: '1階' })
  const confirmation = page.getByRole('dialog', { name: '既存の拾いに部屋を入れる', exact: true })
  await confirmation.getByRole('button', { name: '入れない', exact: true }).click()
  expect(savedMetadata(await save(page)).pickups).toEqual(expect.arrayContaining([
    expect.objectContaining({ room: '廊下', floor: normalizeFloor('2階') }),
  ]))

  await page.getByRole('list', { name: 'このページの部屋の範囲', exact: true })
    .getByRole('button', { name: '名前を変える', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '部屋の範囲', exact: true })
  await expect(dialog.getByLabel('部屋名', { exact: true })).toHaveValue('事務室')
  await dialog.getByLabel('部屋名', { exact: true }).fill('会議室')
  await dialog.getByLabel('階', { exact: true }).fill('3階')
  await dialog.getByRole('button', { name: '登録する', exact: true }).click()
  await expect(page.locator('.room-region-label')).toHaveText('会議室')
  await expect(page.getByRole('dialog', { name: '既存の拾いに部屋を入れる', exact: true })).toHaveCount(0)
  expect(savedMetadata(await save(page)).pickups).toEqual(expect.arrayContaining([
    expect.objectContaining({ room: '廊下', floor: normalizeFloor('2階') }),
  ]))

  await page.getByRole('list', { name: 'このページの部屋の範囲', exact: true })
    .getByRole('button', { name: '削除', exact: true }).click()
  await expect(page.locator('.room-region')).toHaveCount(0)
  await undo(page)
  await expect(page.locator('.room-region-label')).toHaveText('会議室')
})

test('Escと名前入力の中止は登録せず、Backspaceとダブルクリックで囲める', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '部屋の範囲を囲む', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.room-region-guide')).toHaveCount(0)
  await expect(page.locator('.room-region')).toHaveCount(0)

  await page.getByRole('button', { name: '部屋の範囲を囲む', exact: true }).click()
  await polygon(page, 80, 80, 100)
  let dialog = page.getByRole('dialog', { name: '部屋の範囲', exact: true })
  await dialog.getByRole('button', { name: 'やめる', exact: true }).click()
  await expect(page.locator('.room-region')).toHaveCount(0)
  await expect(page.locator('.room-region-guide')).toHaveCount(0)

  await page.getByRole('button', { name: '部屋の範囲を囲む', exact: true }).click()
  await click(page, 80, 80)
  await click(page, 180, 80)
  await click(page, 220, 220)
  await page.keyboard.press('Backspace')
  await click(page, 180, 180)
  const last = await page.getByTestId('annotation-layer-0').evaluate(element => {
    const svg = element as SVGSVGElement, box = svg.getBoundingClientRect()
    return {
      x: box.left + 80 * box.width / svg.viewBox.baseVal.width,
      y: box.top + 180 * box.height / svg.viewBox.baseVal.height,
    }
  })
  await page.mouse.dblclick(last.x, last.y)
  dialog = page.getByRole('dialog', { name: '部屋の範囲', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('部屋名', { exact: true }).fill('事務室')
  await dialog.getByRole('button', { name: '登録する', exact: true }).click()
  await expect.poll(async () => (await page.locator('.room-region polygon').getAttribute('points'))?.split(' ').map(p => p.split(',').map(n => Math.round(Number(n))).join(',')).join(' '))
    .toBe('80,80 180,80 180,180 80,180')
  await expect(page.getByRole('dialog', { name: '縮尺の設定（1 ページ）', exact: true })).toHaveCount(0)
  await expect(page.locator('.measurement-shape')).toHaveCount(0)
})
