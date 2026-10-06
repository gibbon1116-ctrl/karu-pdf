import { expect, test, type Locator, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import { countHex, countRgb, nextCountStyle, nextQuantityLineStyle, quantityKind, quantityLine, readCountFixtures, writeCountFixtures, type CountFixture } from '../src/core/countFixtures'

function pdf(fixtures: CountFixture[] = []) {
  const doc = new mupdf.PDFDocument(), ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
  try {
    doc.insertPage(-1, ref)
    writeCountFixtures(doc, fixtures)
    const bytes = doc.saveToBuffer('compress')
    try { return [...bytes.asUint8Array()] } finally { bytes.destroy() }
  } finally { ref.destroy(); doc.destroy() }
}
async function open(page: Page, fixtures: CountFixture[] = []) {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '線の提案.pdf'), pdf(fixtures))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('button', { name: '数量拾い', exact: true }).click()
  await expect(page.getByTestId('fixture-panel').getByRole('heading', { name: '数量拾い' })).toBeVisible()
}
async function savedFixtures(page: Page) {
  const bytes = await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!])
  const doc = new mupdf.PDFDocument(new Uint8Array(bytes))
  try { return readCountFixtures(doc) } finally { doc.destroy() }
}
const key = (f: CountFixture) => `${countHex(f.style.color)}:${quantityLine(f).dash}:${quantityLine(f).width}`
async function dialogKey(dialog: Locator) {
  const color = await dialog.getByLabel('任意の色', { exact: true }).inputValue()
  const dash = await dialog.getByRole('group', { name: '線の種類', exact: true }).locator('button[aria-pressed="true"]').getAttribute('aria-label')
  const width = await dialog.getByLabel('線の太さ', { exact: true }).inputValue()
  return `${color}:${dash}:${width}`
}
const warning = (dialog: Locator) => dialog.getByRole('status').filter({ hasText: '同じ見た目の項目があります' })

test('six length presets and three successive suggestions have distinct appearances, with collision warnings retained', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '見本から追加', exact: true }).click()
  const presets = page.getByRole('dialog', { name: '見本から追加', exact: true })
  await presets.getByLabel('見本の分野', { exact: true }).selectOption('機械設備')
  const labels = presets.locator('.fixture-presets > label')
  for (const label of await labels.all()) if (!(await label.innerText()).includes('（長さ・m）')) await label.getByRole('checkbox').uncheck()
  await presets.getByRole('button', { name: '選んだ項目を追加', exact: true }).click()
  const fixtures = await savedFixtures(page)
  expect(fixtures).toHaveLength(6)
  expect(fixtures.every(f => quantityKind(f) === 'length')).toBe(true)
  expect(new Set(fixtures.map(key)).size).toBe(6)
  expect(new Set(fixtures.map(f => countHex(f.style.color))).size).toBe(6)

  const original = fixtures[0]
  await page.getByTestId('fixture-panel').getByRole('button', { name: `${original.code} ${original.name}`, exact: true }).click()
  await page.getByTestId('fixture-panel').getByRole('button', { name: '編集', exact: true }).click()
  const edit = page.getByRole('dialog', { name: '項目を編集', exact: true })
  const suggestions = new Set([await dialogKey(edit)])
  for (let i = 0; i < 3; i++) {
    await edit.getByRole('button', { name: '別の組合せを提案', exact: true }).click()
    const proposed = await dialogKey(edit)
    expect(suggestions.has(proposed)).toBe(false); suggestions.add(proposed)
    await expect(warning(edit)).toHaveCount(0)
  }
  await edit.getByRole('button', { name: '変更する', exact: true }).click()
  const after = await savedFixtures(page), updated = after.find(f => f.id === original.id)!
  expect(updated.style.shape).toBe(original.style.shape)
  expect(updated.style.fill).toBe(original.style.fill)
  expect(new Set(after.map(key)).size).toBe(6)
  expect(key(updated)).not.toBe(key(original))

  // Manually matching another item must still display the existing warning.
  await page.getByTestId('fixture-panel').getByRole('button', { name: '編集', exact: true }).click()
  await edit.getByRole('button', { name: `色 ${countHex(fixtures[1].style.color)}`, exact: true }).click()
  await expect(warning(edit)).toContainText(fixtures[1].name)
  await edit.getByRole('button', { name: '別の組合せを提案', exact: true }).click()
  await expect(warning(edit)).toHaveCount(0)
  await edit.getByRole('button', { name: '閉じる', exact: true }).click()
})

test('new length, area and volume items and their duplicates use the same line allocator', async ({ page }) => {
  await open(page)
  for (const name of ['長さ', '面積', '体積']) {
    await page.getByRole('button', { name: '項目を追加', exact: true }).click()
    const add = page.getByRole('dialog', { name: '項目を追加', exact: true })
    await add.getByRole('radio', { name, exact: true }).check()
    await add.getByLabel('名称', { exact: true }).fill(name)
    await add.getByRole('button', { name: '追加する', exact: true }).click()
    const original = (await savedFixtures(page)).find(f => f.name === name)!
    await page.getByTestId('fixture-panel').getByRole('button', { name: '複製', exact: true }).click()
    await expect(warning(add)).toHaveCount(0)
    await add.getByRole('button', { name: '別の組合せを提案', exact: true }).click()
    await expect(warning(add)).toHaveCount(0)
    await add.getByRole('button', { name: '追加する', exact: true }).click()
    const copy = (await savedFixtures(page)).find(f => f.name === `${name} のコピー`)!
    expect(countHex(copy.style.color)).not.toBe(countHex(original.style.color))
    expect(copy.style.shape).toBe(original.style.shape)
    expect(copy.style.fill).toBe(original.style.fill)
  }
  const fixtures = await savedFixtures(page)
  expect(fixtures).toHaveLength(6)
  expect(new Set(fixtures.map(key)).size).toBe(6)
})

test('PDF imports preserve free appearances and reassign collisions across kinds and within a batch', async ({ page }) => {
  const first = nextQuantityLineStyle([])
  const base: CountFixture = { id: 'existing', name: '既存の長さ', code: 'L', category: '試験', order: 0, kind: 'length', method: 'polyline', style: { ...nextCountStyle([]), color: first.color }, line: first.line }
  const free: CountFixture = { ...base, id: 'free', name: '元の線を保つ', code: 'F', style: { ...base.style, shape: 'diamond', fill: 'hatch', color: countRgb('#123456') }, line: { width: 3, dash: 'dotted' } }
  const source: CountFixture[] = [
    { ...base, id: 'length', name: '読込の長さ', code: 'I-L', order: 0 },
    { ...base, id: 'area', name: '読込の面積', code: 'I-A', kind: 'area', method: 'lengthHeight', order: 1, defaults: { heightM: 2 } },
    { ...base, id: 'volume', name: '読込の体積', code: 'I-V', kind: 'volume', method: 'polygonDepth', order: 2, defaults: { depthM: .3 } },
    { ...free, order: 3 },
  ]
  await open(page, source)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '読込先.pdf'), pdf([base]))
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await page.getByRole('button', { name: '他のPDFから読み込む', exact: true }).click()
  await page.getByRole('dialog', { name: '他のPDFから読み込む', exact: true }).getByRole('button', { name: '選んだ項目を追加', exact: true }).click()
  const imported = await savedFixtures(page)
  expect(imported).toHaveLength(5)
  expect(new Set(imported.map(key)).size).toBe(5)
  const retained = imported.find(f => f.name === free.name)!
  expect(retained.style).toEqual(free.style); expect(retained.line).toEqual(free.line)
  for (const item of source.slice(0, 3)) {
    const actual = imported.find(f => f.name === item.name)!
    expect(key(actual)).not.toBe(key(item))
    expect(actual.kind).toBe(item.kind); expect(actual.method).toBe(item.method)
    expect(actual.defaults).toEqual(item.defaults)
    expect(actual.style.shape).toBe(item.style.shape); expect(actual.style.fill).toBe(item.style.fill)
  }
  await page.getByRole('button', { name: '他のPDFから読み込む', exact: true }).click()
  await page.getByRole('dialog', { name: '他のPDFから読み込む', exact: true }).getByRole('button', { name: '選んだ項目を追加', exact: true }).click()
  await expect(page.getByTestId('fixture-panel').locator('li[data-fixture-id]')).toHaveCount(5)
})
