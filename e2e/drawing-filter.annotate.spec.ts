import mupdf from 'mupdf'
import { expect, test, type Page } from '@playwright/test'

// Build in memory: do not change test-data or depend on a prebuilt PDF.
function drawingPdf(): number[] {
  const doc = new mupdf.PDFDocument(), ref = doc.addPage([0, 0, 400, 400], 0, {}, '')
  try {
    doc.insertPage(-1, ref)
    const page = doc.loadPage(0), resources = doc.newDictionary()
    try {
      for (let i = 0; i < 4; i++) {
        const a = page.createAnnotation('Stamp'), object = a.getObject()
        const x = i % 2 === 0 ? 40 : 100, y = i < 2 ? 40 : 110
        const value = doc.newString(JSON.stringify(i < 2
          ? { version: 1, id: `issue-${i}`, number: i + 1, status: i === 0 ? 'open' : 'answered', discipline: '電気' }
          : { version: 1, id: `count-${i}`, group: i === 2 ? '器具A' : '器具B' }))
        const symbol = doc.newName('circle')
        try {
          a.setRect([x, y, x + 20, y + 20]); a.setColor([0, 0, 1]); a.setContents(`mark ${i}`)
          object.put(i < 2 ? 'KaruIssue' : 'KaruCount', value)
          if (i >= 2) object.put('KaruSymbol', symbol)
          a.setAppearance('N', null, mupdf.Matrix.identity, [0, 0, 20, 20], resources, '0 0 1 RG 2 w 2 2 16 16 re S')
        } finally { symbol.destroy(); value.destroy(); object.destroy(); a.destroy() }
      }
      const square = page.createAnnotation('Square'), text = page.createAnnotation('FreeText')
      try {
        square.setRect([180, 100, 280, 180]); square.setColor([1, 0, 0]); square.setBorderWidth(8)
        square.setAppearance('N', null, mupdf.Matrix.identity, [0, 0, 100, 80], resources, '1 0 0 RG 8 w 4 4 92 72 re S')
        text.setRect([40, 210, 160, 240]); text.setContents('Existing text'); text.setDefaultAppearance('Helv', 14, [0, 0, 0]); text.update()
      } finally { square.destroy(); text.destroy() }
    } finally { resources.destroy(); page.destroy() }
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { ref.destroy(); doc.destroy() }
}

async function open(page: Page) {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '種類連動.pdf'), drawingPdf())
  await page.evaluate(() => window.__karu!.setZoom(1))
  await page.getByRole('tab', { name: '書き込み', exact: true }).click()
  await expect(page.getByLabel('図面にもこの種類だけ表示')).toBeEnabled()
  await expect(page.locator('.annotation-rows > li')).toHaveCount(6)
}
async function point(page: Page, x: number, y: number) {
  return page.getByTestId('annotation-layer-0').evaluate((el, p) => {
    const svg = el as SVGSVGElement, box = svg.getBoundingClientRect(), view = svg.viewBox.baseVal
    return { x: box.left + p.x * box.width / view.width, y: box.top + p.y * box.height / view.height }
  }, { x, y })
}
async function click(page: Page, x: number, y: number) {
  const p = await point(page, x, y); await page.mouse.click(p.x, p.y)
}
async function redFramePixel(page: Page): Promise<boolean> {
  return page.locator('.page-view[data-page-index="0"] .preview-canvas').evaluate(el => {
    const canvas = el as HTMLCanvasElement, context = canvas.getContext('2d')!
    // Scan across the top edge of the frame: a single pixel can fall on its anti-aliased rim.
    for (let y = 96; y <= 112; y += 0.5) {
      const pixel = context.getImageData(Math.floor(230 * canvas.width / 400), Math.floor(y * canvas.height / 400), 1, 1).data
      if (pixel[0] > 200 && pixel[1] < 70 && pixel[2] < 70) return true
    }
    return false
  })
}
async function follow(page: Page, kind = 'issue', status = '') {
  await page.getByRole('tab', { name: '書き込み', exact: true }).click()
  await expect(page.getByLabel('図面にもこの種類だけ表示')).toBeEnabled()
  await page.getByLabel('書き込みの種類').selectOption(kind)
  await page.getByLabel('状態で絞り込み').selectOption(status)
  await page.getByLabel('図面にもこの種類だけ表示').check()
}

test('一覧に連動した図面表示・選択・解除・保存と器具の表示を維持する', async ({ page }) => {
  await open(page)
  const layer = page.getByTestId('annotation-layer-0'), toggle = page.getByLabel('図面にもこの種類だけ表示'), footer = page.locator('.status-bar')
  const annotations = await page.evaluate(() => window.__karu!.getEditableAnnotations(0))
  const openIssue = annotations.find(a => a.issue?.status === 'open')!, counts = annotations.filter(a => a.count), text = annotations.find(a => a.kind === 'freetext')!
  const csvBefore = await page.evaluate(() => window.__karu!.exportAnnotationCsv())
  await expect.poll(() => redFramePixel(page)).toBe(true)

  await follow(page)
  await expect(layer.locator('.annotation-issue')).toHaveCount(2)
  for (const a of [...counts, text]) await expect(layer.locator(`g[data-annotation-id="${a.id}"]`)).toHaveCount(0)
  await expect.poll(() => redFramePixel(page)).toBe(false)
  await expect(footer).toContainText('図面の表示: 指摘だけ')
  await page.getByRole('button', { name: '選択', exact: true }).click()
  await click(page, 50, 120); await click(page, 60, 220)
  expect(await page.evaluate(() => window.__karu!.getSelectedAnnotationIds())).toEqual([])
  expect(await page.evaluate(() => window.__karu!.exportAnnotationCsv())).toBe(csvBefore)

  await page.getByLabel('状態で絞り込み').selectOption('open')
  await expect(layer.locator('.annotation-issue')).toHaveCount(1)
  const from = await point(page, 20, 20), to = await point(page, 310, 260)
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 6 }); await page.mouse.up()
  expect(await page.evaluate(() => window.__karu!.getSelectedAnnotationIds())).toEqual([openIssue.id])
  await page.getByRole('tab', { name: '器具', exact: true }).click()
  await expect(page.getByTestId('fixture-panel')).toContainText('書き込みタブの絞り込み（指摘・未回答）で、図面に器具の印を出していません。')
  await expect(page.getByRole('button', { name: '図面への反映をやめる', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: '書き込み', exact: true }).click()
  await expect(page.getByLabel('書き込みの種類')).toHaveValue('issue')
  await expect(page.getByLabel('状態で絞り込み')).toHaveValue('open'); await expect(toggle).toBeChecked()
  await page.getByRole('tab', { name: '器具', exact: true }).click()
  await page.getByRole('button', { name: '図面への反映をやめる', exact: true }).click()
  for (const a of counts) await expect(layer.locator(`g[data-annotation-id="${a.id}"]`)).toHaveCount(1)
  await expect(footer.locator('.drawing-filter-status')).toHaveCount(0)
  await page.getByRole('tab', { name: '書き込み', exact: true }).click(); await expect(toggle).not.toBeChecked()

  await follow(page)
  await page.getByRole('tab', { name: '器具', exact: true }).click()
  await page.getByRole('button', { name: '器具A', exact: true }).click()
  await expect(page.getByRole('button', { name: '個数カウント', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(footer).toContainText('図面の絞り込みを解除しました（器具の印を数えるため）')
  await page.getByRole('tab', { name: '書き込み', exact: true }).click(); await expect(toggle).not.toBeChecked()

  await follow(page, 'count')
  await expect(page.getByLabel('書き込みの種類').locator('option:checked')).toHaveText('個数カウント（器具の印）')
  await page.getByRole('button', { name: '次の未対応指摘（ページ範囲内）', exact: true }).click()
  await expect(toggle).not.toBeChecked()
  await expect(footer).toContainText('図面の絞り込みを解除しました（次の未対応指摘を表示するため）')
  await expect(layer.locator('.annotation-issue')).toHaveCount(2)
  expect(await page.evaluate(() => window.__karu!.getSelectedAnnotationIds())).toEqual([openIssue.id])

  await follow(page)
  await page.getByRole('button', { name: '文字▼', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: /^文字/ }).click()
  await click(page, 200, 250)
  await expect(toggle).not.toBeChecked(); await expect(page.getByTestId('text-editor')).toBeVisible()
  await expect(footer).toContainText('図面の絞り込みを解除しました（隠れている種類の書き込みを作ったため）')
  await page.getByTestId('text-editor').fill('Created text'); await page.getByTestId('text-editor').press('Control+Enter')
  await expect(page.getByTestId('text-editor')).toBeHidden()

  await follow(page)
  await page.getByRole('button', { name: '解除', exact: true }).click()
  await expect(toggle).not.toBeChecked(); await expect(page.getByLabel('書き込みの種類')).toHaveValue('issue')
  await expect(footer.locator('.drawing-filter-status')).toHaveCount(0)
  await follow(page)
  const beforeSave = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).length)
  const saved = await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!])
  await expect(toggle).toBeChecked()
  await page.evaluate(async bytes => {
    await window.__karu!.closeTab(window.__karu!.listTabs().find(t => t.name === '種類連動.pdf')!.docId)
    await window.__karu!.openBytes(bytes, '保存後.pdf')
  }, saved)
  await page.getByRole('tab', { name: '書き込み', exact: true }).click()
  await expect(page.locator('.annotation-rows > li')).toHaveCount(beforeSave)
  await expect(toggle).not.toBeChecked(); await expect(page.getByLabel('書き込みの種類')).toHaveValue('all')
  const reopened = await page.evaluate(() => window.__karu!.getEditableAnnotations(0))
  expect(reopened.filter(a => a.issue)).toHaveLength(2); expect(reopened.filter(a => a.count)).toHaveLength(2)
  expect(reopened.filter(a => a.kind === 'square')).toHaveLength(1); expect(reopened.filter(a => a.kind === 'freetext')).toHaveLength(2)

  await page.getByRole('tab', { name: '器具', exact: true }).click()
  const fixtureA = page.getByTestId('fixture-panel').locator('li[data-fixture-id]').filter({ has: page.getByRole('button', { name: '器具A', exact: true }) })
  await fixtureA.getByRole('button', { name: /の表示切替$/ }).click()
  await expect(fixtureA.getByRole('button', { name: /の表示切替$/ })).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: '器具A', exact: true }).click()
  await expect(fixtureA.getByRole('button', { name: /の表示切替$/ })).toHaveAttribute('aria-pressed', 'true')
  await click(page, 200, 320)
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).filter(a => a.count).length)).toBe(3)
  const selected = await page.evaluate(() => {
    const ids = window.__karu!.getSelectedAnnotationIds()
    return window.__karu!.getEditableAnnotations(0).filter(a => ids.includes(a.id))
  })
  expect(selected).toHaveLength(1); expect(selected[0].count).toBeTruthy(); expect(selected[0].objNum).toBeNull()
  expect(await page.evaluate(() => window.__karu!.getDrawingAnnotationIds(0))).toContain(selected[0].id)
  expect(await page.evaluate(() => window.__karu!.getExternalSendRecords())).toEqual([])
  await expect(page.getByRole('alertdialog')).toBeHidden()
})

test('器具・分類の表示、すべて表示、選択中だけ表示で反映を解除する', async ({ page }) => {
  await open(page)
  await page.getByRole('tab', { name: '器具', exact: true }).click()
  const fixtureA = page.getByTestId('fixture-panel').locator('li[data-fixture-id]').filter({ has: page.getByRole('button', { name: '器具A', exact: true }) })
  await expect(fixtureA).toBeVisible()
  for (const action of ['器具', '分類', 'すべて', '選択中'] as const) {
    await follow(page)
    await page.getByRole('tab', { name: '器具', exact: true }).click()
    if (action === '器具' || action === '分類') {
      const eye = action === '器具' ? fixtureA.getByRole('button', { name: /の表示切替$/ }) : page.getByRole('button', { name: 'その他の表示切替', exact: true })
      await eye.click() // Hide; the drawing filter should remain active.
      await expect(page.getByRole('button', { name: '図面への反映をやめる', exact: true })).toBeVisible()
      await eye.click() // Show; now release the drawing filter.
    } else if (action === 'すべて') await page.getByRole('button', { name: 'すべて表示', exact: true }).click()
    else await page.getByLabel('選択中の器具だけ表示', { exact: true }).check()
    await expect(page.locator('.status-bar')).toContainText('図面の絞り込みを解除しました（器具の印を表示するため）')
    await page.getByRole('tab', { name: '書き込み', exact: true }).click()
    await expect(page.getByLabel('図面にもこの種類だけ表示')).not.toBeChecked()
  }
  expect(await page.evaluate(() => window.__karu!.getExternalSendRecords())).toEqual([])
})
