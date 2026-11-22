import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import { writeDrawingInfo } from '../src/core/drawingInfo'

type Point = [number, number]

const fixtureName = 'C コンセント'
const shiftName = 'このページの拾いと部屋をずらす'
const screenshots = 'test-results/room-tools'

function blankPdf(names: (string | null)[] = [null]) {
  const doc = new mupdf.PDFDocument()
  try {
    for (const name of names) {
      const ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
      try { doc.insertPage(-1, ref) } finally { ref.destroy() }
      const pdfPage = doc.loadPage(doc.countPages() - 1)
      try {
        writeDrawingInfo(doc, pdfPage, { ...(name ? { name } : {}), scanned: true })
      } finally { pdfPage.destroy() }
    }
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { doc.destroy() }
}

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const layer = (page: Page, index: number) => page.getByTestId(`annotation-layer-${index}`)
const roomList = (page: Page) => page.getByRole('list', { name: 'このページの部屋の範囲', exact: true })
const roomSet = (page: Page) => page.getByRole('region', { name: '部屋の組', exact: true })
const documentTab = (page: Page, name: string) =>
  page.getByRole('navigation', { name: '開いているPDF', exact: true }).getByTitle(name, { exact: true })

async function openDocument(page: Page, bytes: number[], name: string, zoom = 1) {
  await page.evaluate(value => window.__karu!.openBytes(value.bytes, value.name), { bytes, name })
  await expect(documentTab(page, name)).toHaveAttribute('aria-current', 'page')
  await page.evaluate(value => window.__karu!.setZoom(value), zoom)
  await expect(layer(page, 0)).toBeVisible()
  await button(page, '数量拾い').click()
  await expect(page.getByTestId('fixture-panel')).toBeVisible()
}

async function open(page: Page, bytes = blankPdf(), name = '部屋の道具試験.pdf', zoom = 1) {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await openDocument(page, bytes, name, zoom)
}

async function goToPage(page: Page, pageIndex: number) {
  const drawing = layer(page, pageIndex)
  await drawing.scrollIntoViewIfNeeded()
  await drawing.evaluate(element => element.scrollIntoView({ block: 'start' }))
  await expect(drawing).toBeVisible()
  await expect(page.locator('.status-bar')).toContainText(`${pageIndex + 1} / `)
}

async function point(page: Page, pageIndex: number, x: number, y: number) {
  return layer(page, pageIndex).evaluate((element, value) => {
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

async function drawRectangle(page: Page, pageIndex: number, x: number, y: number, size: number) {
  for (const [px, py] of [[x, y], [x + size, y], [x + size, y + size], [x, y + size]]) {
    await click(page, pageIndex, px, py)
  }
  await page.keyboard.press('Enter')
}

async function registerRoom(page: Page, pageIndex: number, x: number, name: string, floor = '1階') {
  await button(page, '部屋の範囲を囲む').click()
  await drawRectangle(page, pageIndex, x, 80, 100)
  const dialog = page.getByRole('dialog', { name: '部屋の範囲', exact: true })
  await dialog.getByLabel('部屋名', { exact: true }).fill(name)
  await dialog.getByLabel('階', { exact: true }).fill(floor)
  await dialog.getByRole('button', { name: '登録する', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

async function createSet(page: Page, name: string) {
  await button(page, 'この図面の範囲を部屋の組にする').click()
  const dialog = page.getByRole('dialog', { name: '部屋の組', exact: true })
  await dialog.getByLabel('組の名前', { exact: true }).fill(name)
  await dialog.getByRole('button', { name: '作る', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(roomSet(page)).toContainText(`部屋の組「${name}」を使っています`)
}

async function addItem(page: Page) {
  await button(page, '項目を追加').click()
  const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await dialog.getByLabel('名称', { exact: true }).fill('コンセント')
  await dialog.getByLabel('略号', { exact: true }).fill('C')
  await dialog.getByRole('radio', { name: '個数', exact: true }).check()
  await dialog.getByLabel('分類', { exact: true }).selectOption('')
  await dialog.getByLabel('新しい分類の名前', { exact: true }).fill('試験')
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  await button(page, fixtureName).click()
}

async function undo(page: Page) {
  await page.locator('.viewer').focus()
  await page.keyboard.press('Control+z')
}

async function save(page: Page) {
  return new Uint8Array(await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!]))
}

function savedPickupRooms(bytes: Uint8Array) {
  const doc = new mupdf.PDFDocument(bytes)
  try {
    const pdfPage = doc.loadPage(0)
    try {
      const annotations = pdfPage.getAnnotations()
      try {
        const marks: Array<{ left: number; room: string }> = []
        for (const annotation of annotations) {
          const object = annotation.getObject()
          try {
            // Read count metadata from annotation JSON, as in room-regions.annotate.spec.ts.
            object.forEach(value => {
              try {
                if (!value.isString()) return
                let raw: unknown
                try { raw = JSON.parse(value.asString()) } catch { return }
                if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
                const mark = raw as { fixtureId?: unknown; room?: string }
                if (typeof mark.fixtureId === 'string') {
                  marks.push({ left: annotation.getRect()[0], room: mark.room ?? '' })
                }
              } finally { value.destroy() }
            })
          } finally { object.destroy() }
        }
        return marks.sort((a, b) => a.left - b.left).map(mark => mark.room)
      } finally { annotations.forEach(annotation => annotation.destroy()) }
    } finally { pdfPage.destroy() }
  } finally { doc.destroy() }
}

async function pickupPoints(page: Page, pageIndex: number) {
  return page.evaluate(index => window.__karu!.getEditableAnnotations(index)
    .filter(annotation => !!annotation.count)
    .map(({ rect: [x0, y0, x1, y1] }) => [Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2)]), pageIndex)
}

async function expectPoints(page: Page, expected: Point[]) {
  const polygon = layer(page, 0).locator('.room-region polygon')
  await expect.poll(async () => (await polygon.getAttribute('points'))?.trim().split(/\s+/)
    .map(pair => pair.split(',').map(value => Math.round(Number(value))))).toEqual(expected)
}

test('部屋の並び替え・強調と組の複製を図面ごとに確認する', async ({ page }) => {
  await open(page, blankPdf(['1階電灯設備平面図', '1階コンセント設備平面図']))
  await registerRoom(page, 0, 60, '倉庫')
  await registerRoom(page, 0, 200, '事務室')
  await registerRoom(page, 0, 340, '会議室')

  const names = roomList(page).locator('.room-region-row .room-region-name')
  await expect(names).toHaveText(['1階 倉庫', '1階 事務室', '1階 会議室'])
  await roomList(page).getByRole('button', { name: '「会議室」を上へ', exact: true }).click()
  await expect(names).toHaveText(['1階 倉庫', '1階 会議室', '1階 事務室'])
  await roomList(page).getByRole('button', { name: '名前順', exact: true }).click()
  await expect(names).toHaveText(['1階 会議室', '1階 事務室', '1階 倉庫'])
  await undo(page)
  await expect(names).toHaveText(['1階 倉庫', '1階 会議室', '1階 事務室'])

  const meetingRoom = roomList(page).getByRole('button', { name: '1階 会議室', exact: true })
  const highlighted = layer(page, 0).locator('.room-region-highlighted')
  await meetingRoom.click()
  await expect(meetingRoom).toHaveAttribute('aria-pressed', 'true')
  await expect(highlighted).toHaveCount(1)
  await expect(highlighted.locator('.room-region-label')).toHaveText('会議室')
  await expect(highlighted.locator('polygon:not(.room-region-converge)')).toHaveAttribute('stroke', '#ff8c00')
  await meetingRoom.click()
  await expect(meetingRoom).toHaveAttribute('aria-pressed', 'false')
  await expect(highlighted).toHaveCount(0)

  await createSet(page, '改修前')
  await goToPage(page, 1)
  await button(page, '部屋の組「改修前」を使う（3室）').click()
  await expect(roomSet(page)).toContainText('部屋の組「改修前」を使っています（2 図面で共通）')
  await button(page, '組を複製して使う').click()
  const duplicate = page.getByRole('dialog', { name: '部屋の組を複製', exact: true })
  await expect(duplicate.getByLabel('組の名前', { exact: true })).toHaveValue('改修前のコピー')
  await duplicate.getByLabel('組の名前', { exact: true }).fill('改修後')
  await duplicate.getByRole('button', { name: '作る', exact: true }).click()
  await expect(roomSet(page)).toContainText('部屋の組「改修後」を使っています')

  await roomList(page).locator('.room-region-row').filter({ has: button(page, '1階 会議室') })
    .getByRole('button', { name: '名前を変える', exact: true }).click()
  const rename = page.getByRole('dialog', { name: '部屋の範囲', exact: true })
  await rename.getByLabel('部屋名', { exact: true }).fill('応接室')
  await rename.getByRole('button', { name: '登録する', exact: true }).click()
  await expect(names).toHaveText(['1階 倉庫', '1階 応接室', '1階 事務室'])

  await goToPage(page, 0)
  await expect(roomSet(page)).toContainText('部屋の組「改修前」を使っています')
  await expect(names).toHaveText(['1階 倉庫', '1階 会議室', '1階 事務室'])
  await goToPage(page, 1)
  await expect(roomSet(page)).toContainText('部屋の組「改修後」を使っています')
  await expect(names).toHaveText(['1階 倉庫', '1階 応接室', '1階 事務室'])
  // The rename has its own history entry. Undo it before undoing the duplication.
  await undo(page)
  await expect(names).toHaveText(['1階 倉庫', '1階 会議室', '1階 事務室'])
  await expect(roomSet(page)).toContainText('部屋の組「改修後」を使っています')
  await undo(page)
  await expect(roomSet(page)).toContainText('部屋の組「改修前」を使っています（2 図面で共通）')

  const panel = page.getByTestId('fixture-panel')
  const location = panel.getByRole('group', { name: '新しく拾う印の場所', exact: true })
  await location.scrollIntoViewIfNeeded()
  await expect(location.getByText('新しく拾う印の場所', { exact: true })).toBeVisible()
  const panelBox = await panel.boundingBox()
  if (!panelBox) throw new Error('数量拾いパネルが表示されていません。')
  for (const label of ['現在の階', '現在の部屋']) {
    const input = location.getByLabel(label, { exact: true })
    await expect(input).toBeVisible()
    expect((await input.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(panelBox.width / 2)
  }
  await page.screenshot({ path: `${screenshots}/panel.png`, clip: panelBox, animations: 'disabled' })
})

test('部屋の穴を保存し、穴の中と外の拾いを区別する', async ({ page }) => {
  await open(page)
  await addItem(page)
  await registerRoom(page, 0, 80, '事務室')
  await click(page, 0, 120, 120)
  expect(savedPickupRooms(await save(page))).toEqual(['事務室'])

  const row = roomList(page).locator('.room-region-row')
  await row.getByRole('button', { name: '抜く範囲を囲む', exact: true }).click()
  await drawRectangle(page, 0, 108, 108, 44)
  const confirmation = page.getByRole('dialog', { name: '抜いた範囲の拾い', exact: true })
  await expect(confirmation).toContainText('拾いが 1件')
  await confirmation.getByRole('button', { name: '直す', exact: true }).click()
  expect(savedPickupRooms(await save(page))).toEqual([''])
  await expect(row.getByText('抜いた範囲 1か所', { exact: true })).toBeVisible()
  const hole = layer(page, 0).locator('.room-region-hole')
  await expect(hole).toHaveAttribute('fill', /^url\(#/)
  await expect(layer(page, 0).locator('.room-region-fill')).toHaveAttribute('fill-rule', 'evenodd')

  await click(page, 0, 140, 140)
  await click(page, 0, 165, 165)
  const saved = await save(page)
  expect(savedPickupRooms(saved)).toEqual(['', '', '事務室'])

  await row.getByRole('button', { name: '抜く範囲を囲む', exact: true }).click()
  await drawRectangle(page, 0, 155, 95, 40)
  await expect(page.getByRole('alert').filter({ hasText: '抜く範囲は部屋の範囲の内側を囲んでください' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(hole).toHaveCount(1)

  await openDocument(page, [...saved], '部屋の穴を再読込.pdf')
  await expect(row.getByText('抜いた範囲 1か所', { exact: true })).toBeVisible()
  await expect(hole).toHaveCount(1)
  await row.getByRole('button', { name: '「事務室」の抜いた範囲1を戻す', exact: true }).click()
  await expect(row.getByText('抜いた範囲 1か所', { exact: true })).toHaveCount(0)
  await expect(hole).toHaveCount(0)
})

async function carryOverDialog(page: Page, source: string) {
  await button(page, '旧版のPDFから写す…').click()
  const dialog = page.getByRole('dialog', { name: '旧版のPDFから写す', exact: true })
  await dialog.getByLabel('旧版のPDF', { exact: true }).selectOption({ label: source })
  return dialog
}

test('旧版から図面名称で写し、未対応はページ順で補える', async ({ page }) => {
  const oldName = '電灯設備・旧版.pdf', newName = '電灯設備・新版.pdf'
  const first = '1階電灯設備平面図', second = '2階電灯設備平面図', third = '3階電灯設備平面図'
  const draftName = '旧版の作成用.pdf'
  await open(page, blankPdf([first, second, third]), draftName)

  await button(page, '計測▼').click()
  await page.getByRole('menuitem', { name: /^縮尺の設定/ }).click()
  const scale = page.getByRole('dialog', { name: '縮尺の設定（1 ページ）', exact: true })
  await scale.getByLabel('縮尺の分母', { exact: true }).fill('100')
  await scale.getByRole('button', { name: '決定', exact: true }).click()
  await expect(page.locator('.status-scale')).toHaveText('縮尺 1/100')

  await addItem(page)
  await registerRoom(page, 0, 80, '事務室')
  await click(page, 0, 120, 120)
  await goToPage(page, 1)
  await registerRoom(page, 1, 80, '会議室', '2階')
  await createSet(page, '2階共用')
  await click(page, 1, 130, 130)
  const oldBytes = await save(page)

  // Open the exported PDF as a clean tab. Exporting bytes alone leaves its draft tab unsaved.
  await page.evaluate(async name => {
    const draft = window.__karu!.listTabs().find(tab => tab.name === name)
    if (draft) await window.__karu!.closeTab(draft.docId)
  }, draftName)
  await openDocument(page, [...oldBytes], oldName)
  const oldTab = documentTab(page, oldName)
  const unsaved = oldTab.locator('[aria-label="未保存"]')
  await expect(unsaved).toHaveCount(0)
  await openDocument(page, blankPdf([second, '追加図面', first, third]), newName)
  const dialog = await carryOverDialog(page, oldName)

  const firstRow = dialog.getByRole('row').filter({
    has: page.getByRole('rowheader', { name: `p.1 ${first}`, exact: true }),
  })
  const secondRow = dialog.getByRole('row').filter({
    has: page.getByRole('rowheader', { name: `p.2 ${second}`, exact: true }),
  })
  await expect(firstRow.getByRole('combobox', { name: '旧版 p.1 の対応先', exact: true })).toHaveValue('2')
  await expect(secondRow.getByRole('combobox', { name: '旧版 p.2 の対応先', exact: true })).toHaveValue('0')
  await expect(firstRow.getByRole('cell', { name: '図面名称', exact: true })).toBeVisible()
  await expect(secondRow.getByRole('cell', { name: '図面名称', exact: true })).toBeVisible()
  await firstRow.getByRole('button', { name: `p.1 ${first}`, exact: true }).click()
  const comparison = dialog.getByRole('region', { name: '図面の見比べ', exact: true })
  for (const caption of [`旧版 p.1 ${first}`, `新版 p.3 ${first}`]) {
    const preview = comparison.locator('figure').filter({ hasText: caption })
    await expect(preview.locator('canvas')).toBeVisible()
  }
  await dialog.screenshot({ path: `${screenshots}/carry-over.png`, animations: 'disabled' })

  page.once('dialog', confirmation => confirmation.accept())
  await dialog.getByRole('button', { name: '写す', exact: true }).click()
  const result = dialog.locator('.carry-over-result')
  await expect(result).toContainText('拾い 2件（写せなかった拾い 0件）')
  await expect(result).toContainText('項目 1件を追加')
  await expect(result).toContainText('部屋の範囲 1・部屋の組 1')
  await expect(result).toContainText('縮尺 1ページ')
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
  await expect(unsaved).toHaveCount(0)

  await goToPage(page, 2)
  await expect(roomList(page).locator('.room-region-name')).toHaveText('1階 事務室')
  await expect(layer(page, 2).locator('.room-region-label')).toHaveText('事務室')
  await expect.poll(() => pickupPoints(page, 2)).toEqual([[120, 120]])
  await expect(page.locator('.status-scale')).toHaveText('縮尺 1/100')
  await goToPage(page, 0)
  await expect(roomSet(page)).toContainText('部屋の組「2階共用」を使っています')
  await expect(layer(page, 0).locator('.room-region-label')).toHaveText('会議室')
  await expect.poll(() => pickupPoints(page, 0)).toEqual([[130, 130]])
  await expect(button(page, fixtureName)).toBeVisible()

  await undo(page)
  await expect(button(page, fixtureName)).toHaveCount(0)
  await expect(roomSet(page).getByLabel('部屋の組を使う', { exact: true })).toHaveCount(0)
  // With no room sets left the section is empty and hidden, so check the text itself.
  await expect(page.getByText('部屋の組「2階共用」を使っています')).toHaveCount(0)
  await expect(layer(page, 0).locator('.room-region')).toHaveCount(0)
  await expect.poll(() => pickupPoints(page, 0)).toEqual([])
  await goToPage(page, 2)
  await expect(roomList(page)).toHaveCount(0)
  await expect(layer(page, 2).locator('.room-region')).toHaveCount(0)
  await expect.poll(() => pickupPoints(page, 2)).toEqual([])
  await expect(page.locator('.status-scale')).toHaveCount(0)
  await expect(unsaved).toHaveCount(0)
  await oldTab.click()
  await expect(oldTab).toHaveAttribute('aria-current', 'page')
  await goToPage(page, 0)
  await expect.poll(() => pickupPoints(page, 0)).toEqual([[120, 120]])
  await expect(unsaved).toHaveCount(0)

  const unnamedSource = '名称なし・旧版.pdf'
  await openDocument(page, blankPdf(), unnamedSource)
  await addItem(page)
  await click(page, 0, 120, 120)
  await openDocument(page, blankPdf(), '名称なし・新版.pdf')
  const unnamed = await carryOverDialog(page, unnamedSource)
  const target = unnamed.getByRole('combobox', { name: '旧版 p.1 の対応先', exact: true })
  await expect(target).toHaveValue('')
  await expect(unnamed.getByRole('cell', { name: '未対応', exact: true })).toBeVisible()
  await unnamed.getByRole('button', { name: '未対応をページ順で補う', exact: true }).click()
  await expect(target).toHaveValue('0')
  await expect(unnamed.getByRole('cell', { name: 'ページ順', exact: true })).toBeVisible()
})

test('このページの拾いと部屋を2点でずらし、UndoとEscで戻す', async ({ page }) => {
  // At 75% one PDF point is one CSS pixel.
  await open(page, blankPdf(), 'ページの位置試験.pdf', .75)
  await addItem(page)
  await registerRoom(page, 0, 80, '事務室')
  await click(page, 0, 130, 130)
  const original: Point[] = [[80, 80], [180, 80], [180, 180], [80, 180]]
  await expectPoints(page, original)
  await expect.poll(() => pickupPoints(page, 0)).toEqual([[130, 130]])

  await button(page, shiftName).click()
  await click(page, 0, 80, 80)
  await click(page, 0, 100, 90)
  await expect(page.locator('.status-bar').getByRole('status'))
    .toHaveText('拾い 1件・部屋の範囲 1を動かしました（Ctrl+Z で戻せます）')
  await expectPoints(page, [[100, 90], [200, 90], [200, 190], [100, 190]])
  await expect.poll(() => pickupPoints(page, 0)).toEqual([[150, 140]])

  await undo(page)
  await expectPoints(page, original)
  await expect.poll(() => pickupPoints(page, 0)).toEqual([[130, 130]])

  await button(page, shiftName).click()
  await click(page, 0, 80, 80)
  const reference = layer(page, 0).getByTestId('page-shift-reference')
  await expect(reference).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(reference).toBeHidden()
  await expect(button(page, 'ずらすのをやめる')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(button(page, shiftName)).toHaveAttribute('aria-pressed', 'false')
  await expectPoints(page, original)
  await expect.poll(() => pickupPoints(page, 0)).toEqual([[130, 130]])
})
