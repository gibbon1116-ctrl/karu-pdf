import fs from 'node:fs/promises'
import mupdf from 'mupdf'
import { expect, test, type Page } from '@playwright/test'
import { readCountFixtures, type CountFixture } from '../src/core/countFixtures'

function blankPdf() {
  const doc = new mupdf.PDFDocument()
  try {
    for (let i = 0; i < 3; i++) { const ref = doc.addPage([0, 0, 400, 400], 0, {}, ''); try { doc.insertPage(-1, ref) } finally { ref.destroy() } }
    const bytes = doc.saveToBuffer('compress'); try { return [...bytes.asUint8Array()] } finally { bytes.destroy() }
  } finally { doc.destroy() }
}
async function open(page: Page) {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '項目試験.pdf'), blankPdf())
  await page.evaluate(() => window.__karu!.setZoom(1))
  await page.getByRole('tab', { name: '数量', exact: true }).click(); await page.getByTestId('fixture-panel').getByRole('button', { name: '管理', exact: true }).click()
  await expect(page.getByRole('button', { name: '項目を追加', exact: true })).toBeEnabled()
}
async function clickPoint(page: Page, pageIndex: number, x: number, y: number, modifiers?: Array<'Shift'>) {
  const layer = page.getByTestId(`annotation-layer-${pageIndex}`)
  const position = await layer.evaluate((el, p) => { const svg = el as SVGSVGElement, box = svg.getBoundingClientRect(); return { x: p.x * box.width / svg.viewBox.baseVal.width, y: p.y * box.height / svg.viewBox.baseVal.height } }, { x, y })
  await layer.click({ position, modifiers })
}
async function select(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click()
  await expect(page.getByRole('button', { name: '数量拾い', exact: true })).toHaveAttribute('aria-pressed', 'true')
}

function samplePdf() {
  const doc = new mupdf.PDFDocument(), ref = doc.addPage([0, 0, 400, 400], 0, {}, '0 0 0 rg 180 180 40 40 re f')
  try {
    doc.insertPage(-1, ref)
    const pdfPage = doc.loadPage(0), annotation = pdfPage.createAnnotation('Square')
    try { annotation.setRect([100, 100, 140, 140]); annotation.setColor([1, 0, 0]); annotation.setInteriorColor([1, 0, 0]); annotation.update() } finally { annotation.destroy(); pdfPage.destroy() }
    const bytes = doc.saveToBuffer('compress')
    try { return [...bytes.asUint8Array()] } finally { bytes.destroy() }
  } finally { ref.destroy(); doc.destroy() }
}
async function dragSample(page: Page, from: [number, number], to: [number, number]) {
  const layer = page.getByTestId('fixture-sample-selection-0')
  await expect(layer).toBeVisible()
  const points = await layer.evaluate((el, points) => {
    const svg = el as SVGSVGElement, bounds = svg.getBoundingClientRect()
    return points.map(([x, y]) => ({ x: bounds.left + x * bounds.width / svg.viewBox.baseVal.width, y: bounds.top + y * bounds.height / svg.viewBox.baseVal.height }))
  }, [from, to])
  await page.mouse.move(points[0].x, points[0].y); await page.mouse.down()
  await page.mouse.move(points[1].x, points[1].y, { steps: 4 }); await page.mouse.up()
}
async function savedFixtures(page: Page): Promise<CountFixture[]> {
  const saved = await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!])
  const doc = new mupdf.PDFDocument(new Uint8Array(saved))
  try { return readCountFixtures(doc) } finally { doc.destroy() }
}

for (const openTab of ['数量', '書き込み'] as const) {
  test(`${openTab}タブを開いたまま未保存の個数を整理・保存・復元できる`, async ({ page }) => {
    await open(page)
    for (const [code, name] of [['A', '項目A'], ['B', '項目B']]) {
      await page.getByRole('button', { name: '項目を追加', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
      await dialog.getByLabel('名称', { exact: true }).fill(name)
      await dialog.getByLabel('略号', { exact: true }).fill(code)
      await dialog.getByRole('button', { name: '追加する', exact: true }).click()
    }
    // Original page totals: A = [2, 1, 1], B = [1, 1, 2]. No save before organize.
    for (let i = 0; i < 3; i++) {
      await page.evaluate(index => window.__karu!.scrollToPage(index), i)
      await select(page, 'A 項目A'); await clickPoint(page, i, 80, 100)
      if (i === 0) await clickPoint(page, i, 130, 100)
      await select(page, 'B 項目B'); await clickPoint(page, i, 200, 100)
      if (i === 2) await clickPoint(page, i, 250, 100)
    }
    await page.evaluate(() => window.__karu!.scrollToPage(0))
    await expect(page.getByTestId('fixture-panel')).toContainText('表示中の図面（p.1）: 1個 ／ 全図面: 4個')
    await page.getByRole('button', { name: 'A 項目Aの表示切替', exact: true }).click()
    await page.getByRole('tab', { name: openTab, exact: true }).click()
    if (openTab === '書き込み') await expect(page.locator('.annotation-rows > li')).toHaveCount(8)

    await page.evaluate(async () => {
      await window.__karu!.openOrganize()
      const draft = window.__karu!.organizeDraft()!, cards = draft.getCards().slice()
      draft.move([cards[2].id], 0)
      draft.delete([cards[1].id])
      draft.insertBlank(2, 400, 400)
    })
    await page.getByRole('button', { name: '適用', exact: true }).click()
    await expect(page.getByTestId('organize-view')).toBeHidden()
    if (openTab === '書き込み') await expect(page.locator('.annotation-rows > li')).toHaveCount(6)
    await page.getByRole('tab', { name: '数量', exact: true }).click(); await page.getByTestId('fixture-panel').getByRole('button', { name: '管理', exact: true }).click()
    const panel = page.getByTestId('fixture-panel')
    await expect(panel.locator('li[data-fixture-id]')).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'B 項目B', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: 'A 項目Aの表示切替', exact: true })).toHaveAttribute('aria-pressed', 'false')
    await expect(panel).toContainText('表示中の図面（p.1）: 2個 ／ 全図面: 3個')
    await select(page, 'A 項目A')
    await expect(panel).toContainText('表示中の図面（p.1）: 1個 ／ 全図面: 3個')
    await page.evaluate(() => window.__karu!.scrollToPage(1))
    await expect(panel).toContainText('表示中の図面（p.2）: 2個 ／ 全図面: 3個')
    await page.evaluate(() => window.__karu!.scrollToPage(2))
    await expect(panel).toContainText('表示中の図面（p.3）: 0個 ／ 全図面: 3個')
    await page.getByRole('tab', { name: '書き込み', exact: true }).click()
    await expect(page.locator('.annotation-rows > li')).toHaveCount(6)
    await expect(page.locator('.annotation-rows')).toContainText('個数: 項目A')
    await expect(page.locator('.annotation-rows')).toContainText('個数: 項目B')

    const saved = await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!])
    await page.getByRole('button', { name: 'ページ▼' }).click()
    await page.getByRole('menuitem', { name: '直前のページ操作を元に戻す', exact: true }).click()
    await expect(page.locator('.annotation-rows > li')).toHaveCount(8)
    await page.getByRole('tab', { name: '数量', exact: true }).click(); await page.getByTestId('fixture-panel').getByRole('button', { name: '管理', exact: true }).click()
    await select(page, 'A 項目A'); await expect(panel).toContainText('全図面: 4個')
    await select(page, 'B 項目B'); await expect(panel).toContainText('全図面: 4個')

    await page.evaluate(async () => window.__karu!.closeTab(window.__karu!.listTabs()[0].docId))
    await page.evaluate(bytes => window.__karu!.openBytes(bytes, '整理を保存した図面.pdf'), saved)
    await page.getByRole('tab', { name: '数量', exact: true }).click(); await page.getByTestId('fixture-panel').getByRole('button', { name: '管理', exact: true }).click()
    await expect(panel.locator('li[data-fixture-id]')).toHaveCount(2)
    await select(page, 'A 項目A'); await expect(panel).toContainText('全図面: 3個')
    await select(page, 'B 項目B'); await expect(panel).toContainText('全図面: 3個')
    await page.getByRole('tab', { name: '書き込み', exact: true }).click()
    await expect(page.locator('.annotation-rows > li')).toHaveCount(6)
  })
}

test('項目を読み込んだ文書ではヘッダー・フッターの適用と削除の後も個数を読み直す', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '項目を追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await dialog.getByLabel('名称', { exact: true }).fill('設定変更の項目')
  await dialog.getByLabel('略号', { exact: true }).fill('T')
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  await select(page, 'T 設定変更の項目'); await clickPoint(page, 0, 80, 100)
  await page.evaluate(() => window.__karu!.scrollToPage(1))
  await clickPoint(page, 1, 80, 100)
  await expect(page.getByTestId('fixture-panel')).toContainText('全図面: 2個')
  // Keep fixtures loaded while displaying the annotation tab during both resets.
  await page.getByRole('tab', { name: '書き込み', exact: true }).click()
  for (const action of ['適用', '削除']) {
    await page.getByRole('button', { name: 'ページ▼' }).click()
    await page.getByRole('menuitem', { name: 'ページ番号・ヘッダー・フッター…' }).click()
    const headerFooter = page.getByRole('dialog', { name: 'ページ番号・ヘッダー・フッター' })
    await expect(headerFooter).toBeVisible()
    await headerFooter.getByRole('button', { name: action, exact: true }).click()
    await expect(headerFooter).toBeHidden()
    await expect(page.locator('.annotation-rows > li')).toHaveCount(2)
    await expect(page.locator('.annotation-rows')).toContainText('個数: 設定変更の項目')
    await page.getByRole('tab', { name: '数量', exact: true }).click(); await page.getByTestId('fixture-panel').getByRole('button', { name: '管理', exact: true }).click()
    await expect(page.getByRole('button', { name: 'T 設定変更の項目', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('fixture-panel')).toContainText('全図面: 2個')
    await page.getByRole('tab', { name: '書き込み', exact: true }).click()
  }
})

async function dragFixtureDialog(page: Page, dx: number, dy: number) {
  const heading = page.locator('.fixture-editor-dialog[open] .fixture-drag-handle')
  const rect = (await heading.boundingBox())!, viewport = page.viewportSize()!
  // The previous drag may have left only 80px of the heading on screen.
  const x = (Math.max(0, rect.x) + Math.min(viewport.width, rect.x + rect.width)) / 2
  const y = (Math.max(0, rect.y) + Math.min(viewport.height, rect.y + rect.height)) / 2
  await page.mouse.move(x, y); await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 6 }); await page.mouse.up()
}

async function expectFixtureHeadingInside(page: Page) {
  await expect.poll(() => page.locator('.fixture-editor-dialog[open] .fixture-drag-handle').evaluate(el => {
    const rect = el.getBoundingClientRect()
    return {
      top: rect.top >= -2, bottom: rect.bottom <= innerHeight + 2,
      visibleWidth: Math.min(rect.right, innerWidth) - Math.max(rect.left, 0) >= 78,
    }
  })).toEqual({ top: true, bottom: true, visibleWidth: true })
}

test('見出しだけで項目画面を移動し、追加・複製・編集で位置を保ち、再読込で中央に戻す', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await open(page); await page.getByRole('button', { name: '項目を追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  const heading = dialog.getByRole('heading', { name: '項目を追加', exact: true })
  await expect(heading).toHaveAttribute('title', 'ドラッグして移動できます')
  await expect(heading).toHaveCSS('cursor', 'move')
  await expect(heading.locator('span')).toHaveAttribute('aria-hidden', 'true')
  const initial = (await dialog.boundingBox())!
  await dragFixtureDialog(page, 120, 35)
  const moved = (await dialog.boundingBox())!
  expect(Math.abs(moved.x - initial.x - 120)).toBeLessThanOrEqual(2)
  expect(Math.abs(moved.y - initial.y - 35)).toBeLessThanOrEqual(2)
  const translation = await dialog.evaluate(el => (el as HTMLElement).style.translate)
  const memo = dialog.getByRole('textbox', { name: 'メモ', exact: true })
  await memo.fill('見出し以外は動かない')
  const memoRect = (await memo.boundingBox())!
  await page.mouse.move(memoRect.x + 12, memoRect.y + 10); await page.mouse.down()
  await page.mouse.move(memoRect.x + 55, memoRect.y + 10); await page.mouse.up()
  expect(await dialog.evaluate(el => (el as HTMLElement).style.translate)).toBe(translation)
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible()
  await page.getByRole('button', { name: '項目を追加', exact: true }).click()
  const reopened = (await dialog.boundingBox())!
  expect(Math.abs(reopened.x - moved.x)).toBeLessThanOrEqual(2)
  expect(Math.abs(reopened.y - moved.y)).toBeLessThanOrEqual(2)
  await dialog.getByLabel('名称', { exact: true }).fill('移動後の項目')
  await dialog.getByLabel('略号', { exact: true }).fill('M')
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  await expect(page.getByRole('button', { name: 'M 移動後の項目', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '複製', exact: true }).click()
  await expect(dialog).toBeVisible()
  expect(await dialog.evaluate(el => (el as HTMLElement).style.translate)).toBe(translation)
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
  await page.getByRole('button', { name: '編集', exact: true }).click()
  const edit = page.getByRole('dialog', { name: '項目を編集', exact: true })
  await expect(edit).toBeVisible()
  expect(await edit.evaluate(el => (el as HTMLElement).style.translate)).toBe(translation)
  await edit.getByLabel('名称', { exact: true }).fill('編集後の項目')
  await edit.getByRole('button', { name: '変更する', exact: true }).click()
  await expect(page.getByRole('button', { name: 'M 編集後の項目', exact: true })).toBeVisible()
  await page.reload(); await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '再読込.pdf'), blankPdf())
  await page.getByRole('tab', { name: '数量', exact: true }).click(); await page.getByTestId('fixture-panel').getByRole('button', { name: '管理', exact: true }).click()
  await page.getByRole('button', { name: '項目を追加', exact: true }).click()
  await expect(dialog).toBeVisible()
  expect(await dialog.evaluate(el => (el as HTMLElement).style.translate)).toMatch(/^0px( 0px)?$/)
  const centered = (await dialog.boundingBox())!
  expect(Math.abs(centered.x + centered.width / 2 - 720)).toBeLessThanOrEqual(2)
  expect(Math.abs(centered.y + centered.height / 2 - 500)).toBeLessThanOrEqual(2)
})

test('画面外へのドラッグとウインドウ縮小でも項目画面の見出しをつかめる', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await open(page); await page.getByRole('button', { name: '項目を追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await expect(dialog).toBeVisible()
  await dragFixtureDialog(page, 5000, 5000); await expectFixtureHeadingInside(page)
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 720, height: 540 })
  await page.getByRole('button', { name: '項目を追加', exact: true }).click()
  await expectFixtureHeadingInside(page)
  await dragFixtureDialog(page, -5000, -5000); await expectFixtureHeadingInside(page)
  await page.setViewportSize({ width: 600, height: 480 }); await expectFixtureHeadingInside(page)
  const offset = await dialog.evaluate(el => (el as HTMLElement).style.translate.split(' ').map(value => parseFloat(value)))
  await dragFixtureDialog(page, -offset[0], -offset[1]); await expectFixtureHeadingInside(page)
  await dialog.getByLabel('名称', { exact: true }).fill('画面内へ戻した項目')
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  await expect(page.getByTestId('fixture-panel')).toContainText('画面内へ戻した項目')
})

test('crops original drawing without annotations, keeps drafts on Esc, and preserves samples on save, copy and import', async ({ page }) => {
  await open(page)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '見本元.pdf'), samplePdf())
  // Show the whole page so the drag points below are inside the viewer.
  await page.evaluate(() => window.__karu!.setZoom(1))
  await page.getByRole('tab', { name: '数量', exact: true }).click(); await page.getByTestId('fixture-panel').getByRole('button', { name: '管理', exact: true }).click()
  await page.getByRole('button', { name: '項目を追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await expect(dialog).toBeVisible()
  await dragFixtureDialog(page, 60, 20)
  const translation = await dialog.evaluate(el => (el as HTMLElement).style.translate)
  await dialog.getByLabel('名称', { exact: true }).fill('記号見本')
  await dialog.getByLabel('略号', { exact: true }).fill('S')
  await dialog.getByRole('textbox', { name: 'メモ', exact: true }).fill('切り取り中も保持')
  await dialog.getByRole('button', { name: '図面から見本を切り取る', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  expect(await dialog.evaluate(el => (el as HTMLElement).style.translate)).toBe(translation)
  await expect(dialog.getByLabel('名称', { exact: true })).toHaveValue('記号見本')
  await expect(dialog.getByRole('textbox', { name: 'メモ', exact: true })).toHaveValue('切り取り中も保持')
  await dialog.getByRole('button', { name: '図面から見本を切り取る', exact: true }).click()
  await dragSample(page, [80, 80], [81, 81])
  await expect(page.locator('.fixture-sample-instruction')).toContainText('範囲が小さすぎます')
  await dragSample(page, [80, 80], [240, 240])
  await expect(dialog).toBeVisible()
  expect(await dialog.evaluate(el => (el as HTMLElement).style.translate)).toBe(translation)
  const preview = dialog.getByAltText('図面から切り取った見本', { exact: true })
  await expect(preview).toBeVisible()
  const pixels = await preview.evaluate(async el => {
    const image = el as HTMLImageElement
    await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0)
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data
    let black = 0, red = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 40 && data[i + 1] < 40 && data[i + 2] < 40) black++
      if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] < 60) red++
    }
    return { width: canvas.width, height: canvas.height, black, red }
  })
  expect(pixels.width).toBe(160); expect(pixels.height).toBe(160)
  expect(pixels.black).toBeGreaterThan(100); expect(pixels.red).toBe(0)
  const png = await preview.getAttribute('src')
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  const thumbnail = page.getByTestId('fixture-panel').getByAltText('記号見本の見本', { exact: true })
  await expect(thumbnail).toHaveAttribute('src', png!)
  await thumbnail.hover(); await expect(page.getByRole('tooltip').getByRole('img')).toBeVisible()
  const original = (await savedFixtures(page))[0]
  await page.getByRole('button', { name: '複製', exact: true }).click()
  await expect(dialog.getByAltText('図面から切り取った見本', { exact: true })).toHaveAttribute('src', png!)
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  const copy = (await savedFixtures(page)).find(f => f.id !== original.id)!
  expect(copy.sample).toEqual(original.sample)
  expect([copy.style.shape, copy.style.fill, copy.style.color]).not.toEqual([original.style.shape, original.style.fill, original.style.color])
  const bytes = await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!])
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '見本保存後.pdf'), bytes)
  await page.getByRole('tab', { name: '数量', exact: true }).click(); await page.getByTestId('fixture-panel').getByRole('button', { name: '管理', exact: true }).click()
  await expect(page.getByTestId('fixture-panel').getByAltText('記号見本の見本', { exact: true })).toHaveAttribute('src', png!)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '見本読込先.pdf'), blankPdf())
  await page.getByRole('tab', { name: '数量', exact: true }).click(); await page.getByTestId('fixture-panel').getByRole('button', { name: '管理', exact: true }).click()
  await page.getByRole('button', { name: '他のPDFから読み込む', exact: true }).click()
  await page.getByLabel('読込元PDF', { exact: true }).selectOption({ label: '見本保存後.pdf' })
  await page.getByRole('button', { name: '選んだ項目を追加', exact: true }).click()
  const imported = (await savedFixtures(page)).find(f => f.name === original.name)!
  expect(imported.sample).toEqual(original.sample); expect(imported.style).toEqual(original.style)
  await select(page, 'S 記号見本')
  await page.getByRole('button', { name: '編集', exact: true }).click()
  const edit = page.getByRole('dialog', { name: '項目を編集', exact: true })
  await edit.getByRole('button', { name: '見本を外す', exact: true }).click()
  await expect(edit.getByAltText('図面から切り取った見本', { exact: true })).toHaveCount(0)
  await edit.getByRole('button', { name: '変更する', exact: true }).click()
  expect((await savedFixtures(page)).find(f => f.name === original.name)?.sample).toBeUndefined()
})

test('changes suggestions repeatedly while retaining size, opacity, code display and duplication fields', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '標準マスタから追加', exact: true }).click()
  await page.getByRole('tab', { name: '分野の一式', exact: true }).click()
  await page.getByRole('button', { name: '選んだ項目を追加', exact: true }).click()
  await expect(page.getByTestId('fixture-panel').locator('li[data-fixture-id]')).toHaveCount(41)
  await page.getByRole('button', { name: '項目を追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await dialog.getByLabel('名称', { exact: true }).fill('提案試験')
  await dialog.getByLabel('略号', { exact: true }).fill('P')
  await dialog.getByLabel('分類', { exact: true }).selectOption('')
  await dialog.getByLabel('新しい分類の名前', { exact: true }).fill('提案分類')
  await dialog.getByRole('textbox', { name: 'メモ', exact: true }).fill('複製メモ')
  await dialog.getByRole('combobox', { name: '大きさ', exact: true }).selectOption('20')
  await dialog.getByRole('combobox', { name: '透明度', exact: true }).selectOption('0.5')
  await dialog.getByLabel('略号を図面に表示', { exact: true }).uncheck()
  const appearances: string[] = []
  for (let i = 0; i < 4; i++) {
    appearances.push(await dialog.locator('button[aria-pressed="true"]').evaluateAll(buttons => buttons.map(b => b.getAttribute('aria-label')).join(':')))
    await dialog.getByRole('button', { name: '別の組合せを提案', exact: true }).click()
  }
  expect(new Set(appearances).size).toBe(4)
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  const all = await savedFixtures(page), original = all.find(f => f.name === '提案試験')!
  expect(all.filter(f => f.style.shape === original.style.shape && f.style.fill === original.style.fill && String(f.style.color) === String(original.style.color))).toHaveLength(1)
  await page.getByRole('button', { name: '複製', exact: true }).click()
  await expect(dialog.getByLabel('略号', { exact: true })).toHaveValue('P')
  await expect(dialog.getByLabel('分類', { exact: true })).toHaveValue('提案分類')
  await expect(dialog.getByRole('textbox', { name: 'メモ', exact: true })).toHaveValue('複製メモ')
  await expect(dialog.getByRole('combobox', { name: '大きさ', exact: true })).toHaveValue('20')
  await expect(dialog.getByRole('combobox', { name: '透明度', exact: true })).toHaveValue('0.5')
  await expect(dialog.getByLabel('略号を図面に表示', { exact: true })).not.toBeChecked()
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  const copy = (await savedFixtures(page)).find(f => f.name === '提案試験 のコピー')!
  expect([copy.style.shape, copy.style.fill, copy.style.color]).not.toEqual([original.style.shape, original.style.fill, original.style.color])
  await select(page, 'P 提案試験')
  await page.getByRole('button', { name: '編集', exact: true }).click()
  const edit = page.getByRole('dialog', { name: '項目を編集', exact: true })
  await edit.getByRole('button', { name: '別の組合せを提案', exact: true }).click()
  await edit.getByRole('button', { name: '変更する', exact: true }).click()
  const updated = (await savedFixtures(page)).find(f => f.id === original.id)!
  expect([updated.style.shape, updated.style.fill, updated.style.color]).not.toEqual([original.style.shape, original.style.fill, original.style.color])
  expect(updated.style.size).toBe(20); expect(updated.style.opacity).toBe(.5); expect(updated.style.showCode).toBe(false)
})

test('fixture layout keeps counts and add actions in view at 1440x900 and restores the saved panel width', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => localStorage.setItem('karu-pdf:side-panel-width', '260'))
  await open(page)
  const panel = page.getByTestId('side-panel')
  expect((await panel.boundingBox())!.width).toBeGreaterThanOrEqual(340)
  expect(await page.evaluate(() => localStorage.getItem('karu-pdf:side-panel-width'))).toBe('260')
  await page.getByRole('tab', { name: 'ページ', exact: true }).click()
  const originalWidth = (await panel.boundingBox())!.width
  expect(originalWidth).toBeCloseTo(260, 0)
  await page.getByRole('tab', { name: '数量', exact: true }).click(); await page.getByTestId('fixture-panel').getByRole('button', { name: '管理', exact: true }).click()
  expect((await panel.boundingBox())!.width).toBeGreaterThanOrEqual(340)
  await page.getByRole('tab', { name: '検索', exact: true }).click()
  expect((await panel.boundingBox())!.width).toBeCloseTo(originalWidth, 0)
  expect(await page.evaluate(() => localStorage.getItem('karu-pdf:side-panel-width'))).toBe('260')
  await page.getByRole('tab', { name: '数量', exact: true }).click(); await page.getByTestId('fixture-panel').getByRole('button', { name: '管理', exact: true }).click()

  await page.getByRole('button', { name: '標準マスタから追加', exact: true }).click()
  await page.getByRole('tab', { name: '分野の一式', exact: true }).click()
  await page.getByLabel('見本の分野', { exact: true }).selectOption('電気設備')
  await page.getByRole('button', { name: '選んだ項目を追加', exact: true }).click()
  await select(page, 'DL ダウンライト')
  await clickPoint(page, 0, 80, 90)
  const fixturePanel = page.getByTestId('fixture-panel')
  const row = fixturePanel.getByRole('button', { name: 'DL ダウンライト', exact: true }).locator('..')
  expect((await row.boundingBox())!.height).toBeLessThanOrEqual(40)
  const summary = fixturePanel.locator('.fixture-count-summary')
  await expect(summary).toContainText('表示中の図面（p.1）: 1個 ／ 全図面: 1個')
  await expect(summary).toBeInViewport({ ratio: 1 })
  const groups = fixturePanel.locator('.fixture-groups')
  expect(await groups.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
  await groups.evaluate(el => { el.scrollTop = el.scrollHeight })
  await expect.poll(() => groups.evaluate(el => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop))).toBeLessThanOrEqual(1)
  await expect(summary).toBeInViewport({ ratio: 1 })

  await page.getByRole('button', { name: '項目を追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await expect(dialog).toBeVisible()
  // click() は対象を自動スクロールするため、操作前に画面内か確かめる。
  await expect(dialog.getByRole('button', { name: '追加する', exact: true })).toBeInViewport({ ratio: 1 })
  await expect(dialog.getByLabel('印の見本', { exact: true })).toBeInViewport({ ratio: 1 })
  expect(await dialog.locator('.fixture-dialog-body').evaluate(el => el.scrollTop)).toBe(0)
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
})

test('presets count across pages, visibility excludes hit testing, and quantity CSV includes zero fixtures', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '標準マスタから追加', exact: true }).click()
  await page.getByRole('tab', { name: '分野の一式', exact: true }).click()
  await page.getByRole('button', { name: '選んだ項目を追加', exact: true }).click()
  await select(page, 'DL ダウンライト'); await clickPoint(page, 0, 80, 90); await clickPoint(page, 0, 130, 90)
  await expect(page.getByTestId('fixture-panel')).toContainText('表示中の図面（p.1）: 2個 ／ 全図面: 2個')
  const firstId = await page.evaluate(() => { const a = window.__karu!.getEditableAnnotations(0).find(a => a.count)!; return a.count!.version === 2 ? a.count!.fixtureId : '' })
  await select(page, 'C2 コンセント（2口）'); await clickPoint(page, 0, 200, 90)
  await page.evaluate(() => window.__karu!.scrollToPage(1))
  await expect(page.getByTestId('fixture-panel')).toContainText('表示中の図面（p.2）: 0個 ／ 全図面: 1個')
  await clickPoint(page, 1, 80, 100)
  await expect(page.getByTestId('fixture-panel')).toContainText('表示中の図面（p.2）: 1個 ／ 全図面: 2個')
  await page.evaluate(() => window.__karu!.scrollToPage(0))
  await page.getByRole('button', { name: 'DL ダウンライトの表示切替', exact: true }).click()
  await page.getByRole('button', { name: '選択', exact: true }).click()
  await clickPoint(page, 0, 80, 90)
  await expect(page.getByTestId('annotation-layer-0').locator('.annotation-selection')).toHaveCount(0)
  await page.getByRole('button', { name: 'すべて表示', exact: true }).click()
  await clickPoint(page, 0, 80, 90)
  await expect(page.getByTestId('annotation-layer-0').locator('.annotation-selection')).toHaveCount(1)
  await page.getByLabel('項目を変更', { exact: true }).selectOption({ label: 'C2 コンセント（2口）' })
  await expect(page.getByTestId('fixture-panel')).toContainText('表示中の図面（p.1）: 2個 ／ 全図面: 3個')
  await page.locator('.tool-row').getByRole('button', { name: '元に戻す', exact: true }).click()
  expect(await page.evaluate(id => window.__karu!.getEditableAnnotations(0).filter(a => a.count?.version === 2 && a.count.fixtureId === id).length, firstId)).toBe(2)
  await select(page, 'DL ダウンライト')
  await page.getByLabel('選択中の項目だけ表示', { exact: true }).check()
  await expect(page.getByTestId('annotation-layer-0').locator('g[data-annotation-id]')).toHaveCount(2)
  await page.getByRole('button', { name: 'すべて表示', exact: true }).click()
  await expect(page.getByLabel('選択中の項目だけ表示', { exact: true })).not.toBeChecked()
  await expect(page.getByTestId('annotation-layer-0').locator('g[data-annotation-id]')).toHaveCount(3)
  await page.evaluate(() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }) })
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '数量をCSVに書き出す', exact: true }).click()
  await page.getByRole('dialog', { name: '数量をCSVに書き出す', exact: true }).getByRole('button', { name: '書き出す', exact: true }).click()
  const download = await pending
  expect(download.suggestedFilename()).toBe('項目試験_数量集計.csv')
  const csv = await fs.readFile((await download.path())!, 'utf8')
  expect(csv).toContain('分類,略号,名称,規格,施工条件,集計区分,種別,単位,集計方式,平面,立上り・立下り,その他の加算,全図面の合計,表示中の図面（p.1）,p.1,p.2\r\n')
  expect(csv).toContain('照明器具,DL,ダウンライト,,,施工条件別,個数,個,場所別,,,,2,2,2,0\r\n')
  expect(csv).toContain('コンセント,C2,コンセント（2口）,,,施工条件別,個数,個,場所別,,,,2,1,1,1\r\n')
  expect(csv).toContain('照明器具,BL,ベースライト（直付）,,,施工条件別,個数,個,場所別,,,,0,0,0,0\r\n')
})

test('custom style, duplication, bulk editing, multiple reassignment, undo, and save/reopen', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '項目を追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await dialog.getByLabel('名称', { exact: true }).fill('試験項目'); await dialog.getByLabel('略号', { exact: true }).fill('T')
  await dialog.getByRole('button', { name: '形 逆三角', exact: true }).click()
  await dialog.getByRole('button', { name: '塗り 半分塗り', exact: true }).click()
  await dialog.getByRole('button', { name: '色 #FFF04D', exact: true }).click()
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  await select(page, 'T 試験項目'); await clickPoint(page, 0, 80, 90); await clickPoint(page, 0, 140, 90)
  const layer = page.getByTestId('annotation-layer-0')
  await expect(layer.locator('[data-count-shape="invertedTriangle"][data-count-fill="half"]')).toHaveCount(2)
  await page.getByRole('button', { name: '複製', exact: true }).click()
  const copy = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await expect(copy.getByLabel('名称', { exact: true })).toHaveValue('試験項目 のコピー')
  await copy.getByLabel('略号', { exact: true }).fill('U'); await copy.getByRole('button', { name: '形 四角', exact: true }).click()
  await copy.getByRole('button', { name: '追加する', exact: true }).click()
  await select(page, 'T 試験項目'); await page.getByRole('button', { name: '編集', exact: true }).click()
  const edit = page.getByRole('dialog', { name: '項目を編集', exact: true })
  await edit.getByRole('button', { name: '形 星', exact: true }).click(); await edit.getByRole('button', { name: '変更する', exact: true }).click()
  await expect(layer.locator('[data-count-shape="star"]')).toHaveCount(2)
  await page.getByRole('button', { name: '選択', exact: true }).click()
  await clickPoint(page, 0, 80, 90); await clickPoint(page, 0, 140, 90, ['Shift'])
  await page.getByLabel('項目を変更', { exact: true }).selectOption({ label: 'U 試験項目 のコピー' })
  await expect(layer.locator('[data-count-shape="square"]')).toHaveCount(2)
  await page.locator('.tool-row').getByRole('button', { name: '元に戻す', exact: true }).click()
  await expect(layer.locator('[data-count-shape="star"]')).toHaveCount(2)
  const saved = await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!])
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '保存後.pdf'), saved)
  await page.getByRole('tab', { name: '数量', exact: true }).click(); await page.getByTestId('fixture-panel').getByRole('button', { name: '管理', exact: true }).click(); await select(page, 'T 試験項目')
  await expect(page.getByTestId('fixture-panel')).toContainText('全図面: 2個')
  await expect(page.getByRole('button', { name: 'U 試験項目 のコピー', exact: true })).toBeVisible()
  await expect(page.getByTestId('annotation-layer-0').locator('[data-count-shape="star"]')).toHaveCount(2)
})

test('imports another open PDF without duplicate names/codes and keeps fixture deletion undoable', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '標準マスタから追加', exact: true }).click()
  await page.getByRole('tab', { name: '分野の一式', exact: true }).click()
  await page.getByLabel('見本の分野', { exact: true }).selectOption('建築')
  await page.getByRole('button', { name: '選んだ項目を追加', exact: true }).click()
  await select(page, 'DS 片開き戸'); await clickPoint(page, 0, 90, 90)
  await page.getByRole('button', { name: '削除', exact: true }).click({ trial: true })
  page.once('dialog', async d => { expect(d.message()).toContain('この項目の拾い 1 件を削除します。'); await d.accept() })
  await page.getByRole('button', { name: '削除', exact: true }).click()
  await expect(page.getByRole('button', { name: 'DS 片開き戸', exact: true })).toHaveCount(0)
  await page.locator('.tool-row').getByRole('button', { name: '元に戻す', exact: true }).click()
  await select(page, 'DS 片開き戸'); await expect(page.getByTestId('fixture-panel')).toContainText('全図面: 1個')
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '読込先.pdf'), blankPdf())
  await page.getByRole('tab', { name: '数量', exact: true }).click(); await page.getByTestId('fixture-panel').getByRole('button', { name: '管理', exact: true }).click()
  await page.getByRole('button', { name: '他のPDFから読み込む', exact: true }).click()
  await page.getByRole('button', { name: '選んだ項目を追加', exact: true }).click()
  await select(page, 'DS 片開き戸'); await expect(page.getByTestId('fixture-panel')).toContainText('全図面: 0個')
  const first = await page.getByTestId('fixture-panel').locator('li[data-fixture-id]').count()
  await page.getByRole('button', { name: '他のPDFから読み込む', exact: true }).click()
  await page.getByRole('button', { name: '選んだ項目を追加', exact: true }).click()
  await expect(page.getByTestId('fixture-panel').locator('li[data-fixture-id]')).toHaveCount(first)
})

test('requires a fixture and warns for same-fixture clicks within 3mm without dropping the new mark', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '数量拾い', exact: true }).click(); await page.getByTestId('fixture-panel').getByRole('button', { name: '管理', exact: true }).click()
  await clickPoint(page, 0, 100, 100)
  expect(await page.evaluate(() => window.__karu!.getEditableAnnotations(0).filter(a => a.count).length)).toBe(0)
  await expect(page.getByRole('status')).toContainText('数量拾いの一覧で項目を選んでください')
  await page.getByRole('button', { name: '標準マスタから追加', exact: true }).click()
  await page.getByRole('tab', { name: '分野の一式', exact: true }).click()
  await page.getByRole('button', { name: '選んだ項目を追加', exact: true }).click()
  await select(page, 'DL ダウンライト'); await clickPoint(page, 0, 100, 100); await clickPoint(page, 0, 103, 100)
  await expect(page.locator('.status-bar [role="status"]')).toContainText('近くに同じ数量拾いの印があります')
  await expect(page.getByTestId('fixture-panel')).toContainText('全図面: 2個')
})
