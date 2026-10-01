import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import './resume.spec'
import './shell.spec'

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
  await layer.click({ position: { x: 100, y: 260 } })
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
  await expect(page.getByRole('button', { name: '文字', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '選択', exact: true }).click()
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

  await page.getByRole('button', { name: '図形▼' }).click()
  await page.getByRole('menuitemcheckbox', { name: /^(?:✓\s*)?四角(?:\s|$)/ }).click()
  await page.mouse.move(box.x + 350, box.y + 300)
  await page.mouse.down()
  await page.mouse.move(box.x + 460, box.y + 380, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByRole('button', { name: '四角', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '選択', exact: true }).click()
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

async function dragOnLayer(
  page: Page,
  tool: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
  steps = 8,
): Promise<void> {
  const layer = page.getByTestId('annotation-layer-0')
  const box = await layer.boundingBox()
  if (!box) throw new Error('1ページ目の注釈レイヤーがありません。')
  const main = page.getByRole('button', { name: tool, exact: true })
  if (await main.count()) {
    await main.click()
  } else {
    const group = ['線', '矢印', '四角', '丸'].includes(tool) ? '図形' : 'ペン'
    await page.getByRole('button', { name: `${group}▼` }).click()
    await page.getByRole('menuitemcheckbox', { name: new RegExp(`^(?:✓\\s*)?${tool}(?:\\s|$)`) }).click()
  }
  await page.mouse.move(box.x + start.x, box.y + start.y)
  await page.mouse.down()
  await page.mouse.move(box.x + end.x, box.y + end.y, { steps })
  await page.mouse.up()
}

test('全種類の書き込みを作成し、保存して開き直せる', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(sample)
  await waitForPage(page)

  const layer = page.getByTestId('annotation-layer-0')
  await page.getByRole('button', { name: '文字', exact: true }).click()
  await page.getByLabel('書体').selectOption('BIZUDMincho')
  await layer.click({ position: { x: 80, y: 80 } })
  await page.getByTestId('text-editor').fill('明朝の文字')
  await page.keyboard.press('Control+Enter')

  await page.getByRole('button', { name: '線', exact: true }).click()
  await expect(page.getByLabel('線の太さ')).toBeVisible()
  await expect(page.getByLabel('書体')).toHaveCount(0)
  await expect(page.getByText('次に作る書き込み')).toBeVisible()

  await dragOnLayer(page, '線', { x: 70, y: 150 }, { x: 170, y: 150 })
  await dragOnLayer(page, '矢印', { x: 200, y: 150 }, { x: 300, y: 205 })
  await dragOnLayer(page, '四角', { x: 335, y: 145 }, { x: 415, y: 205 })
  await dragOnLayer(page, '丸', { x: 450, y: 145 }, { x: 525, y: 210 })
  await dragOnLayer(page, '蛍光ペン', { x: 205, y: 270 }, { x: 340, y: 280 }, 20)
  await dragOnLayer(page, '手書き', { x: 380, y: 260 }, { x: 445, y: 295 }, 12)
  await dragOnLayer(page, '手書き', { x: 450, y: 295 }, { x: 500, y: 260 }, 12)

  await expect(page.getByRole('button', { name: '手書き', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.evaluate(() => {
    const items = window.__karu!.getEditableAnnotations(0)
    return {
      kinds: [...new Set(items.filter((item) => item.objNum === null).map((item) => item.kind))].sort(),
      joinedInk: items.some((item) => item.kind === 'ink' && item.inkList?.length === 2),
      mincho: items.some((item) => item.kind === 'freetext' && item.text === '明朝の文字' && item.font === 'BIZUDMincho'),
    }
  })).toEqual({
    kinds: ['arrow', 'circle', 'freetext', 'highlight', 'ink', 'line', 'square'],
    joinedInk: true,
    mincho: true,
  })

  await saveAndReopen(page)
  await expect.poll(() => page.evaluate(() => {
    const items = window.__karu!.getEditableAnnotations(0)
    return {
      kinds: [...new Set(items.filter((item) => item.text === '明朝の文字' || item.kind !== 'freetext').map((item) => item.kind))].sort(),
      joinedInk: items.some((item) => item.kind === 'ink' && item.inkList?.length === 2),
      highlight: items.some((item) => item.kind === 'highlight' && Math.abs(item.opacity - 0.35) < 0.01),
      mincho: items.some((item) => item.text === '明朝の文字' && item.font === 'BIZUDMincho'),
    }
  })).toEqual({
    kinds: ['arrow', 'circle', 'freetext', 'highlight', 'ink', 'line', 'square', 'textHighlight'],
    joinedInk: true,
    highlight: true,
    mincho: true,
  })
})

test('塗り・白塗り・文字枠・吹き出し・Ctrl直線を保存して再編集できる', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(sample)
  await waitForPage(page)
  const layer = page.getByTestId('annotation-layer-0')
  const box = await layer.boundingBox()
  if (!box) throw new Error('1ページ目の注釈レイヤーがありません。')

  await dragOnLayer(page, '四角', { x: 70, y: 150 }, { x: 170, y: 215 })
  await page.getByLabel('塗り 青').click()
  await page.getByLabel('透明度').selectOption('0.5')

  await dragOnLayer(page, '四角', { x: 195, y: 150 }, { x: 290, y: 210 })
  await page.getByRole('button', { name: '白塗りにする' }).click()
  expect(await page.evaluate(() => {
    const squares = window.__karu!.getEditableAnnotations(0).filter((item) => item.kind === 'square' && item.objNum === null)
    return squares.some((item) => item.interiorColor?.every((value) => value === 1) && item.borderColor === null && item.opacity === 1)
  })).toBe(true)

  await page.getByRole('button', { name: '文字', exact: true }).click()
  await page.getByLabel('背景色 黄').click()
  await page.getByLabel('枠線の色 黒').click()
  await layer.click({ position: { x: 80, y: 260 } })
  await page.getByTestId('text-editor').fill('背景と枠')
  await page.keyboard.press('Control+Enter')

  await page.getByRole('button', { name: '文字▼' }).click()
  await page.getByRole('menuitemcheckbox', { name: '吹き出し' }).click()
  await page.mouse.move(box.x + 260, box.y + 280)
  await page.mouse.down()
  await page.mouse.move(box.x + 350, box.y + 350, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByTestId('text-editor')).toBeVisible()
  await page.getByTestId('text-editor').fill('吹き出し本文')
  await page.keyboard.press('Control+Enter')

  await page.getByRole('button', { name: '蛍光ペン', exact: true }).click()
  await page.keyboard.down('Control')
  await page.mouse.move(box.x + 80, box.y + 400)
  await page.mouse.down()
  await page.mouse.move(box.x + 130, box.y + 430)
  await page.mouse.move(box.x + 190, box.y + 390)
  await page.mouse.move(box.x + 250, box.y + 420)
  await page.mouse.up()
  await page.keyboard.up('Control')
  expect(await page.evaluate(() => window.__karu!.getEditableAnnotations(0).find((item) => item.kind === 'highlight' && item.objNum === null)?.inkList?.[0].length)).toBe(2)

  await saveAndReopen(page)
  const restored = await page.evaluate(() => {
    const items = window.__karu!.getEditableAnnotations(0)
    const callout = items.find((item) => item.kind === 'callout' && item.text === '吹き出し本文')
    return {
      blue: items.some((item) => item.kind === 'square' && item.interiorColor?.[2] === 1 && Math.abs(item.opacity - 0.5) < 0.01),
      whiteout: items.some((item) => item.kind === 'square' && item.interiorColor?.every((value) => value === 1) && item.borderColor === null),
      textStyle: items.some((item) => item.kind === 'freetext' && item.text === '背景と枠' && item.interiorColor?.[0] === 1 && item.borderColor?.every((value) => value === 0)),
      calloutId: callout?.id ?? null,
      calloutPoint: callout?.calloutPoint ?? null,
      straight: items.some((item) => item.kind === 'highlight' && item.inkList?.[0].length === 2),
    }
  })
  expect(restored).toMatchObject({ blue: true, whiteout: true, textStyle: true, straight: true })
  expect(restored.calloutId).not.toBeNull()
  expect(restored.calloutPoint).not.toBeNull()

  await layer.locator(`g[data-annotation-id="${restored.calloutId}"] .annotation-hit`).first().click()
  const handle = page.getByTestId('callout-point-handle')
  const handleBox = await handle.boundingBox()
  if (!handleBox) throw new Error('吹き出しの指示点の取っ手がありません。')
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleBox.x - 35, handleBox.y + 25, { steps: 6 })
  await page.mouse.up()
  const movedPoint = await page.evaluate((id) => window.__karu!.getEditableAnnotations(0).find((item) => item.id === id)?.calloutPoint, restored.calloutId!)
  expect(movedPoint).not.toEqual(restored.calloutPoint)
  await saveAndReopen(page)
  await expect.poll(() => page.evaluate((point) => {
    const callout = window.__karu!.getEditableAnnotations(0).find((item) => item.kind === 'callout' && item.text === '吹き出し本文')
    return Boolean(callout?.calloutPoint && point && callout.calloutPoint.every((value, index) => Math.abs(value - point[index]) < 0.05))
  }, movedPoint)).toBe(true)
})

test('四角の移動を元に戻し、やり直せる', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(sample)
  await waitForPage(page)
  await dragOnLayer(page, '四角', { x: 220, y: 180 }, { x: 320, y: 250 })
  await page.getByRole('button', { name: '選択', exact: true }).click()
  const square = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).find((item) => item.kind === 'square' && item.objNum === null))
  if (!square) throw new Error('作成した四角がありません。')
  const hit = page.locator(`g[data-annotation-id="${square.id}"] .annotation-hit`)
  const hitBox = await hit.boundingBox()
  if (!hitBox) throw new Error('四角の当たり判定がありません。')
  await page.mouse.move(hitBox.x + hitBox.width / 2, hitBox.y + hitBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(hitBox.x + hitBox.width / 2 + 45, hitBox.y + hitBox.height / 2 + 30, { steps: 8 })
  await page.mouse.up()
  const moved = await page.evaluate((id) => window.__karu!.getEditableAnnotations(0).find((item) => item.id === id)!.rect, square.id)
  expect(moved[0]).toBeGreaterThan(square.rect[0])

  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate((id) => window.__karu!.getEditableAnnotations(0).find((item) => item.id === id)?.rect, square.id)).toEqual(square.rect)
  await page.keyboard.press('Control+y')
  await expect.poll(() => page.evaluate((id) => window.__karu!.getEditableAnnotations(0).find((item) => item.id === id)?.rect, square.id)).toEqual(moved)
})

test('保存済みの作成を元に戻して保存すると注釈が消える', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(sample)
  await waitForPage(page)
  await dragOnLayer(page, '丸', { x: 260, y: 180 }, { x: 350, y: 260 })
  const first = await page.evaluate(async () => Array.from((await window.__karu!.saveToBytes())!))
  expect(first.length).toBeGreaterThan(0)
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).some((item) => item.kind === 'circle'))).toBe(false)
  const second = await page.evaluate(async () => Array.from((await window.__karu!.saveToBytes())!))
  await page.evaluate(async (bytes) => window.__karu!.openBytes(bytes, 'undo-saved-create.pdf'), second)
  await waitForPage(page)
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).some((item) => item.kind === 'circle'))).toBe(false)
})
