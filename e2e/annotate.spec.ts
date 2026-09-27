import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const sample = path.resolve('test-data/sample-small.pdf')

async function waitForPage(page: Page, pageIndex = 0): Promise<void> {
  await expect(page.locator(`.page-view[data-page-index="${pageIndex}"]`)).toBeVisible()
  await expect.poll(() => page.evaluate((index) => window.__karu?.getEditableAnnotations(index).length ?? -1, pageIndex)).toBeGreaterThanOrEqual(0)
}

async function saveAndReopen(page: Page): Promise<number[]> {
  const bytes = await page.evaluate(async () => {
    const saved = await window.__karu!.saveToBytes()
    if (!saved) throw new Error('保存結果がありません。')
    return Array.from(saved)
  })
  await page.evaluate(async (value) => window.__karu!.openBytes(value, 'roundtrip.pdf'), bytes)
  await waitForPage(page)
  return bytes
}

async function saveTwiceAndReopen(page: Page): Promise<void> {
  const bytes = await page.evaluate(async () => {
    const [first, second] = await Promise.all([
      window.__karu!.saveToBytes(),
      window.__karu!.saveToBytes(),
    ])
    const saved = first ?? second
    if (!saved) throw new Error('同時保存の結果がありません。')
    return Array.from(saved)
  })
  await page.evaluate(async (value) => window.__karu!.openBytes(value, 'roundtrip.pdf'), bytes)
  await waitForPage(page)
}

test('文字と四角を保存し、開き直して再編集できる', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(sample)
  await expect(page.getByText('1 / 5')).toBeVisible()
  await waitForPage(page)

  const layer = page.getByTestId('annotation-layer-0')
  const box = await layer.boundingBox()
  if (!box) throw new Error('1ページ目の注釈レイヤーがありません。')

  await page.getByRole('button', { name: '文字', exact: true }).click()
  await layer.click({ position: { x: 100, y: 100 } })
  const editor = page.getByTestId('text-editor')
  await expect(editor).toBeVisible()
  await editor.dispatchEvent('compositionstart')
  await editor.dispatchEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })
  await expect(editor).toBeVisible()
  await editor.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', ctrlKey: true, bubbles: true })
  await expect(editor).toBeVisible()
  await editor.dispatchEvent('compositionend')
  await page.keyboard.insertText('日本語の書き込み')
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('二行目')
  await page.mouse.click(box.x + 400, box.y + 350)
  await expect(editor).toBeHidden()
  await expect(layer.locator('.annotation-text')).toContainText(['日本語の書き込み', '二行目'])

  await page.getByRole('button', { name: '四角', exact: true }).click()
  await page.mouse.move(box.x + 250, box.y + 180)
  await page.mouse.down()
  await page.mouse.move(box.x + 360, box.y + 260, { steps: 8 })
  await page.mouse.up()
  const createdSquare = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).find((item) => item.kind === 'square' && item.objNum === null))
  if (!createdSquare) throw new Error('作成した四角がストアにありません。')
  const beforeMove = createdSquare.rect

  await page.getByRole('button', { name: '選択', exact: true }).click()
  const square = layer.locator('.annotation-square')
  await expect(square).toBeVisible()
  const squareBox = await square.boundingBox()
  if (!squareBox) throw new Error('四角注釈がありません。')
  await page.mouse.move(squareBox.x + squareBox.width / 2, squareBox.y + squareBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(squareBox.x + squareBox.width / 2 + 45, squareBox.y + squareBox.height / 2 + 30, { steps: 8 })
  await page.mouse.up()
  const afterMove = await page.evaluate((id) => window.__karu!.getEditableAnnotations(0).find((item) => item.id === id)!.rect, createdSquare.id)
  expect(afterMove[0]).toBeGreaterThan(beforeMove[0])
  expect(afterMove[1]).toBeGreaterThan(beforeMove[1])

  await saveTwiceAndReopen(page)
  await expect.poll(() => page.evaluate((rect) => {
    const annotations = window.__karu!.getEditableAnnotations(0)
    return {
      textCount: annotations.filter((item) => item.kind === 'freetext' && item.text === '日本語の書き込み\n二行目' && item.madeByKaru).length,
      square: annotations.some((item) => item.kind === 'square' && item.rect.every((value, index) => Math.abs(value - rect[index]) < 0.01)),
    }
  }, afterMove)).toEqual({ textCount: 1, square: true })

  const existing = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).find((item) => item.text === 'Existing note'))
  if (!existing) throw new Error('既存の Existing note がありません。')
  const existingHit = page.locator(`g[data-annotation-id="${existing.id}"] .annotation-hit`)
  await existingHit.dblclick()
  await expect(page.getByTestId('text-editor')).toBeVisible()
  await page.getByTestId('text-editor').fill('書き換えた')
  await page.keyboard.press('Control+Enter')
  await expect(page.getByTestId('text-editor')).toBeHidden()
  await saveAndReopen(page)
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).some((item) => item.text === '書き換えた' && item.madeByKaru))).toBe(true)

  const squareAfterOpen = await page.evaluate((rect) => window.__karu!.getEditableAnnotations(0).find((item) => (
    item.kind === 'square' && item.rect.every((value, index) => Math.abs(value - rect[index]) < 0.01)
  )), afterMove)
  if (!squareAfterOpen) throw new Error('保存後の四角がありません。')
  await page.locator(`g[data-annotation-id="${squareAfterOpen.id}"] .annotation-hit`).click()
  await page.keyboard.press('Delete')
  const finalBytes = await saveAndReopen(page)
  await expect.poll(() => page.evaluate((rect) => window.__karu!.getEditableAnnotations(0).some((item) => (
    item.kind === 'square' && item.rect.every((value, index) => Math.abs(value - rect[index]) < 0.01)
  )), afterMove)).toBe(false)

  await fs.mkdir('test-results', { recursive: true })
  await fs.writeFile('test-results/ui-roundtrip.pdf', Buffer.from(finalBytes))
})
