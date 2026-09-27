import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import './resume.spec'

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
  await expect(page.getByRole('button', { name: '選択', exact: true })).toHaveAttribute('aria-pressed', 'true')

  const createdText = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).find((item) => item.kind === 'freetext' && item.objNum === null))
  if (!createdText) throw new Error('作成した文字がストアにありません。')
  const textWidthBefore = createdText.rect[2] - createdText.rect[0]
  const textHeightBefore = createdText.rect[3] - createdText.rect[1]
  const textLinesBefore = createdText.layout?.lines.length ?? 0
  const textRightHandle = layer.locator(`g[data-annotation-id="${createdText.id}"] [data-resize-handle="e"]`)
  const textHandleBox = await textRightHandle.boundingBox()
  if (!textHandleBox) throw new Error('文字の右辺の取っ手がありません。')
  await page.mouse.move(textHandleBox.x + textHandleBox.width / 2, textHandleBox.y + textHandleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(textHandleBox.x - 190, textHandleBox.y + textHandleBox.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => page.evaluate(({ id, width, height, lines }) => {
    const item = window.__karu!.getEditableAnnotations(0).find((annotation) => annotation.id === id)
    return Boolean(item
      && item.rect[2] - item.rect[0] < width
      && item.rect[3] - item.rect[1] > height
      && (item.layout?.lines.length ?? 0) > lines)
  }, { id: createdText.id, width: textWidthBefore, height: textHeightBefore, lines: textLinesBefore })).toBe(true)
  const resizedText = await page.evaluate((id) => window.__karu!.getEditableAnnotations(0).find((item) => item.id === id)!, createdText.id)
  expect(resizedText.rect[2] - resizedText.rect[0]).toBeLessThan(textWidthBefore)
  expect(resizedText.rect[3] - resizedText.rect[1]).toBeGreaterThan(textHeightBefore)
  expect(resizedText.layout?.lines.length ?? 0).toBeGreaterThan(textLinesBefore)

  await page.getByRole('button', { name: '四角', exact: true }).click()
  await page.mouse.move(box.x + 350, box.y + 300)
  await page.mouse.down()
  await page.mouse.move(box.x + 460, box.y + 380, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByRole('button', { name: '選択', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const createdSquare = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).find((item) => item.kind === 'square' && item.objNum === null))
  if (!createdSquare) throw new Error('作成した四角がストアにありません。')
  await expect(layer.locator(`g[data-annotation-id="${createdSquare.id}"] .annotation-resize-handle`)).toHaveCount(8)
  const squareHandle = layer.locator(`g[data-annotation-id="${createdSquare.id}"] [data-resize-handle="se"]`)
  const squareHandleBox = await squareHandle.boundingBox()
  if (!squareHandleBox) throw new Error('四角の右下の取っ手がありません。')
  await page.mouse.move(squareHandleBox.x + squareHandleBox.width / 2, squareHandleBox.y + squareHandleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(squareHandleBox.x + squareHandleBox.width / 2 + 50, squareHandleBox.y + squareHandleBox.height / 2 + 40, { steps: 8 })
  await page.mouse.up()
  const resizedSquareRect = await page.evaluate((id) => window.__karu!.getEditableAnnotations(0).find((item) => item.id === id)!.rect, createdSquare.id)
  expect(resizedSquareRect[2] - resizedSquareRect[0]).toBeGreaterThan(createdSquare.rect[2] - createdSquare.rect[0])
  expect(resizedSquareRect[3] - resizedSquareRect[1]).toBeGreaterThan(createdSquare.rect[3] - createdSquare.rect[1])

  await saveTwiceAndReopen(page)
  await expect.poll(() => page.evaluate((rect) => {
    const annotations = window.__karu!.getEditableAnnotations(0)
    return {
      textCount: annotations.filter((item) => item.kind === 'freetext' && item.text === '日本語の書き込み\n二行目' && item.madeByKaru).length,
      square: annotations.some((item) => item.kind === 'square' && item.rect.every((value, index) => Math.abs(value - rect[index]) < 0.01)),
    }
  }, resizedSquareRect)).toEqual({ textCount: 1, square: true })

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
  )), resizedSquareRect)
  if (!squareAfterOpen) throw new Error('保存後の四角がありません。')
  await page.locator(`g[data-annotation-id="${squareAfterOpen.id}"] .annotation-hit`).click()
  await page.keyboard.press('Delete')
  const finalBytes = await saveAndReopen(page)
  await expect.poll(() => page.evaluate((rect) => window.__karu!.getEditableAnnotations(0).some((item) => (
    item.kind === 'square' && item.rect.every((value, index) => Math.abs(value - rect[index]) < 0.01)
  )), resizedSquareRect)).toBe(false)

  await fs.mkdir('test-results', { recursive: true })
  await fs.writeFile('test-results/ui-roundtrip.pdf', Buffer.from(finalBytes))
})
