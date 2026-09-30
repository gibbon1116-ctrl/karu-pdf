import fs from 'node:fs/promises'
import path from 'node:path'
import mupdf from 'mupdf'
import { expect, test, type Page } from '@playwright/test'
import type { EditableAnnotation } from '../src/editor/AnnotationStore'

const sample = path.resolve('test-data/sample-small.pdf')
const blank = path.resolve('test-results/text-mark-blank.tmp.pdf')

test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

test.beforeAll(async () => {
  await fs.mkdir(path.dirname(blank), { recursive: true })
  const document = new mupdf.PDFDocument()
  const page = document.addPage([0, 0, 595, 842], 0, {}, '')
  try { document.insertPage(-1, page) } finally { page.destroy() }
  const buffer = document.saveToBuffer('compress,garbage=4')
  try { await fs.writeFile(blank, buffer.asUint8Array()) } finally { buffer.destroy(); document.destroy() }
})

test.afterAll(async () => { await fs.rm(blank, { force: true }) })

async function waitForPage(page: Page, pageIndex = 0): Promise<void> {
  await expect(page.locator(`.page-view[data-page-index="${pageIndex}"]`)).toBeVisible()
  await expect.poll(() => page.evaluate((index) => window.__karu?.getEditableAnnotations(index).length ?? -1, pageIndex)).toBeGreaterThanOrEqual(0)
}

async function textBounds(page: Page, text = 'Sample page 1') {
  await page.keyboard.press('Control+f')
  const input = page.getByLabel('検索する文字')
  await input.fill(text)
  await input.press('Enter')
  const polygon = page.locator('.search-highlight-layer polygon.active')
  await expect(polygon).toBeVisible()
  const box = await polygon.boundingBox()
  if (!box) throw new Error('選択対象の文字が見つかりません。')
  return box
}

async function chooseMarkTool(page: Page, name: '文字を選択' | 'ハイライト' | '下線' | '取り消し線'): Promise<void> {
  await page.getByRole('button', { name: '文字に印▼' }).click()
  await page.getByRole('menuitemcheckbox', { name, exact: true }).click()
}

async function dragText(page: Page, box: { x: number; y: number; width: number; height: number }): Promise<void> {
  await page.mouse.move(box.x + 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
}

test('文字を選択してコピーし、3種類の印を保存して開き直せる', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(sample)
  await waitForPage(page)
  const bounds = await textBounds(page)

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('m')
  await expect(page.getByRole('button', { name: '文字を選択', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await dragText(page, bounds)
  await expect(page.getByRole('button', { name: 'コピー', exact: true })).toBeVisible()
  await page.keyboard.press('Control+c')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('Sample page 1')

  // ダブルクリックで単語、3回クリックで行を選ぶ
  const copied = async () => {
    await page.keyboard.press('Control+c')
    return page.evaluate(() => navigator.clipboard.readText())
  }
  await page.mouse.dblclick(bounds.x + 10, bounds.y + bounds.height / 2)
  await expect.poll(copied).toBe('Sample')
  await page.mouse.click(bounds.x + 10, bounds.y + bounds.height / 2, { clickCount: 3 })
  await expect.poll(copied).toBe('Sample page 1')

  // 別のページで選び直すと、前のページの選択は消え、コピーされるのは新しい文字になる
  const secondBounds = await textBounds(page, 'Sample page 2')
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await dragText(page, secondBounds)
  await expect(page.locator('[data-testid="annotation-layer-1"] .text-selection-quads polygon')).not.toHaveCount(0)
  await expect(page.locator('[data-testid="annotation-layer-0"] .text-selection-quads polygon')).toHaveCount(0)
  await expect.poll(copied).toContain('Sample page 2')
  const firstBounds = await textBounds(page)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())

  for (const [tool, kind] of [
    ['ハイライト', 'textHighlight'], ['下線', 'underline'], ['取り消し線', 'strikeout'],
  ] as const) {
    await chooseMarkTool(page, tool)
    await dragText(page, firstBounds)
    await expect.poll(() => page.evaluate((value) => window.__karu!.getEditableAnnotations(0).filter((item) => item.kind === value).length, kind)).toBe(1)
    // 印を付けたら、青い選択の表示は残さない
    await expect(page.locator('[data-testid="annotation-layer-0"] .text-selection-quads polygon')).toHaveCount(0)
  }

  expect(await page.evaluate(() => window.__karu!.getEditableAnnotations(0)
    .filter((item) => item.objNum === null && ['textHighlight', 'underline', 'strikeout'].includes(item.kind))
    .map((item) => item.text))).toEqual([
      expect.stringContaining('Sample page 1'), expect.stringContaining('Sample page 1'), expect.stringContaining('Sample page 1'),
    ])

  const bytes = await page.evaluate(async () => Array.from((await window.__karu!.saveToBytes())!))
  await page.evaluate(async (value) => window.__karu!.openBytes(value, 'text-mark-roundtrip.pdf'), bytes)
  await waitForPage(page)
  await expect.poll(() => page.evaluate(() => {
    const marks = window.__karu!.getEditableAnnotations(0).filter((item) => (
      ['textHighlight', 'underline', 'strikeout'].includes(item.kind) && item.text.includes('Sample page 1')
    ))
    return marks.map((item) => ({ kind: item.kind, text: item.text, saved: item.objNum !== null })).sort((a, b) => a.kind.localeCompare(b.kind))
  })).toEqual([
    { kind: 'strikeout', text: expect.stringContaining('Sample page 1'), saved: true },
    { kind: 'textHighlight', text: expect.stringContaining('Sample page 1'), saved: true },
    { kind: 'underline', text: expect.stringContaining('Sample page 1'), saved: true },
  ])
})

test('文字のないページでは短い案内を表示する', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(blank)
  await waitForPage(page)
  await page.keyboard.press('m')
  const layer = page.getByTestId('annotation-layer-0')
  const box = await layer.boundingBox()
  if (!box) throw new Error('注釈レイヤーがありません。')
  await page.mouse.move(box.x + 100, box.y + 100)
  await page.mouse.down()
  await page.mouse.move(box.x + 220, box.y + 130)
  await page.mouse.up()
  await expect(page.getByText('このページには選択できる文字がありません（スキャン画像など）', { exact: true })).toBeVisible()
})

test('方向キー移動をまとめて戻し、複数選択も一緒に動かす', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(sample)
  await waitForPage(page)
  const layer = page.getByTestId('annotation-layer-0')
  const layerBox = await layer.boundingBox()
  if (!layerBox) throw new Error('注釈レイヤーがありません。')

  const squares: EditableAnnotation[] = []
  for (let index = 0; index < 3; index += 1) {
    await page.getByRole('button', { name: '図形▼' }).click()
    await page.getByRole('menuitemcheckbox', { name: '四角' }).click()
    const x = layerBox.x + 230 + index * 90
    await page.mouse.move(x, layerBox.y + 230)
    await page.mouse.down()
    await page.mouse.move(x + 55, layerBox.y + 275)
    await page.mouse.up()
    const item = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).filter((annotation) => annotation.kind === 'square' && annotation.objNum === null).at(-1))
    if (!item) throw new Error('四角を作れませんでした。')
    squares.push(item)
  }

  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+ArrowDown')
  await expect.poll(() => page.evaluate((id) => window.__karu!.getEditableAnnotations(0).find((item) => item.id === id)?.rect, squares[2].id))
    .toEqual(squares[2].rect.map((value, index) => value + (index % 2 === 0 ? 3 : 10)))
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate((id) => window.__karu!.getEditableAnnotations(0).find((item) => item.id === id)?.rect, squares[2].id)).toEqual(squares[2].rect)

  for (const [index, square] of squares.entries()) {
    const hit = layer.locator(`g[data-annotation-id="${square.id}"] .annotation-hit`).first()
    if (index > 0) await page.keyboard.down('Shift')
    await hit.click()
    if (index > 0) await page.keyboard.up('Shift')
  }
  await page.keyboard.press('ArrowLeft')
  await expect.poll(() => page.evaluate((ids) => ids.map((id) => window.__karu!.getEditableAnnotations(0).find((item) => item.id === id)?.rect[0]), squares.map((item) => item.id)))
    .toEqual(squares.map((item) => item.rect[0] - 1))

  await page.keyboard.press('Escape')
  const viewer = page.getByTestId('viewer')
  await viewer.focus()
  const scrollBefore = await viewer.evaluate((element) => element.scrollTop)
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => viewer.evaluate((element) => element.scrollTop)).toBeGreaterThan(scrollBefore)
})
