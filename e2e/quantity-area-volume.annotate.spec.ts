import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'

function blankPdf() {
  const doc = new mupdf.PDFDocument(), ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
  try {
    doc.insertPage(-1, ref)
    const b = doc.saveToBuffer('compress')
    try { return [...b.asUint8Array()] } finally { b.destroy() }
  } finally { ref.destroy(); doc.destroy() }
}
async function point(page: Page, x: number, y: number) {
  return page.getByTestId('annotation-layer-0').evaluate((el, p) => {
    const svg = el as SVGSVGElement, box = svg.getBoundingClientRect()
    return { x: box.left + p.x * box.width / svg.viewBox.baseVal.width, y: box.top + p.y * box.height / svg.viewBox.baseVal.height }
  }, { x, y })
}
async function click(page: Page, x: number, y: number) { const p = await point(page, x, y); await page.mouse.click(p.x, p.y) }
async function open(page: Page) {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '数量試験.pdf'), blankPdf())
  await page.evaluate(() => window.__karu!.setZoom(1))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
}

const names = {
 internal: '内部足場 内部足場（囲む）', external: '外部足場 外部足場（長さ×高さ）',
 root: '根切り 根切り（囲む×深さ）', trench: '溝掘削 ケーブル・配管の溝掘削（長さ×幅×深さ）',
}
async function addPresets(page: Page) {
 await page.getByRole('button', { name: '数量拾い', exact: true }).click()
 await page.getByRole('button', { name: '見本から追加', exact: true }).click()
 const dialog = page.getByRole('dialog', { name: '見本から追加' })
 await dialog.getByLabel('見本の分野').selectOption('仮設・土工')
 await expect(dialog.getByText('仮設／内部足場 内部足場（囲む）（面積・m²）', { exact: true })).toBeVisible()
 await expect(dialog.getByText('土工／根切り 根切り（囲む×深さ）（体積・m³）', { exact: true })).toBeVisible()
 await dialog.getByRole('button', { name: '選んだ項目を追加', exact: true }).click()
 await page.getByRole('button', { name: names.internal, exact: true }).click()
 await click(page,100,120)
 const scale = page.getByRole('dialog', { name: '縮尺の設定（1 ページ）' })
 await scale.getByLabel('縮尺の分母').fill('100')
 await scale.getByRole('button', { name: '決定', exact: true }).click()
}
async function polygon(page: Page, x: number, y: number) {
 await click(page,x,y); await click(page,x+72,y); await click(page,x+72,y+72); await click(page,x,y+72)
 await page.keyboard.press('Enter')
}
async function line(page: Page, x: number, y: number) {
 await click(page,x,y); await click(page,x+72,y); await page.keyboard.press('Enter')
}
const value = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).locator('..').locator('.fixture-row-count').first()
const labels = (page: Page) => page.locator('.measurement-shape .measurement-label')

test('four area/volume methods: prompts, format Undo, totals, CSV and PDF reload', async ({ page }) => {
 await open(page); await addPresets(page)
 await polygon(page,100,120)
 await expect(value(page,names.internal)).toHaveText('6.45')
 await expect(labels(page)).toHaveText('内部足場 6.45 m²')
 await expect(page.locator('.measurement-shape polygon').first()).toHaveAttribute('fill-opacity','.15')
 await page.getByRole('button', { name: names.external, exact: true }).click()
 await line(page,100,250)
 const dimensions = page.getByRole('dialog', { name: '拾いの寸法' })
 await expect(dimensions).toBeVisible()
 expect((await dimensions.boundingBox())!.width).toBeLessThan(400)
 await expect(labels(page)).toHaveCount(1)
 await dimensions.getByLabel('高さ', { exact: true }).fill('3.5')
 await dimensions.getByLabel('高さ', { exact: true }).press('Enter')
 await expect(labels(page).nth(1)).toHaveText('外部足場 2.54×H3.50=8.89 m²')
 await expect(value(page,names.external)).toHaveText('8.89')
 const format = page.getByTestId('format-panel')
 await expect(format.getByText('長さ　2.54 m', { exact: true })).toBeVisible()
 await format.getByLabel('高さ', { exact: true }).fill('4'); await format.getByLabel('高さ', { exact: true }).press('Enter')
 await expect(labels(page).nth(1)).toHaveText('外部足場 2.54×H4.00=10.16 m²')
 await expect(value(page,names.external)).toHaveText('10.16')
 await page.keyboard.press('Control+z')
 await expect(value(page,names.external)).toHaveText('8.89')
 await expect(labels(page).nth(1)).toHaveText('外部足場 2.54×H3.50=8.89 m²')
 await format.getByRole('button', { name: '項目を編集…' }).click()
 const editor = page.getByRole('dialog', { name: '項目を編集', exact: true })
 await expect(editor.getByRole('radio', { name: '面積', exact: true })).toBeDisabled()
 await expect(editor.getByRole('radio', { name: '囲む', exact: true })).toBeDisabled()
 await expect(editor.getByLabel('高さ（新しく拾うときの初期値）')).toHaveValue('')
 await expect(editor.locator('.quantity-preview')).toContainText('外部足場 24.00×H?=? m²')
 await editor.getByRole('button', { name: '閉じる', exact: true }).click()
 await page.getByRole('button', { name: names.root, exact: true }).click()
 await polygon(page,300,120)
 await dimensions.getByLabel('深さ', { exact: true }).fill('1.2')
 await dimensions.getByRole('button', { name: '決定', exact: true }).click()
 await expect(labels(page).nth(2)).toHaveText('根切り 6.45×D1.20=7.74 m³')
 await expect(value(page,names.root)).toHaveText('7.74')
 await expect(format.getByText('面積　6.45 m²', { exact: true })).toBeVisible()
 await page.getByRole('button', { name: names.trench, exact: true }).click()
 await line(page,100,360)
 await expect(dimensions).toHaveCount(0)
 await expect(labels(page).nth(3)).toHaveText('溝掘削 2.54×W0.60×D0.80=1.22 m³')
 await expect(value(page,names.trench)).toHaveText('1.22')
 await expect(format.getByLabel('幅', { exact: true })).toHaveValue('0.60')
 await expect(format.getByLabel('深さ', { exact: true })).toHaveValue('0.80')
 await expect(format.getByLabel('項目を変更').locator('option')).toHaveCount(1)
 await page.evaluate(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }) })
 const downloaded = page.waitForEvent('download')
 await page.getByRole('button', { name: '数量をCSVに書き出す', exact: true }).click()
  await page.getByRole('dialog', { name: '数量をCSVに書き出す', exact: true }).getByRole('button', { name: '書き出す', exact: true }).click()
 const download = await downloaded, stream = await download.createReadStream(), chunks: Buffer[] = []
 for await (const chunk of stream!) chunks.push(chunk)
 const csv = Buffer.concat(chunks).toString('utf8')
 for (const row of [
  '仮設,内部足場,内部足場（囲む）,,面積,m²,全図面,6.45,6.45,6.45',
  '仮設,外部足場,外部足場（長さ×高さ）,,面積,m²,全図面,8.89,8.89,8.89',
  '土工,根切り,根切り（囲む×深さ）,,体積,m³,全図面,7.74,7.74,7.74',
  '土工,溝掘削,ケーブル・配管の溝掘削（長さ×幅×深さ）,,体積,m³,全図面,1.22,1.22,1.22',
 ]) expect(csv).toContain(row)
 await download.delete()
 const expectedLabels = await labels(page).allTextContents()
 const saved = await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!])
 await page.evaluate(bytes => window.__karu!.openBytes(bytes, '再読込.pdf'), saved)
 await page.getByRole('tab', { name: '数量', exact: true }).click()
 await expect(labels(page)).toHaveText(expectedLabels)
 for (const [key, expected] of [['internal','6.45'],['external','8.89'],['root','7.74'],['trench','1.22']] as const) {
  const row = page.getByRole('button', { name: names[key], exact: true }).locator('..').locator('.fixture-row-count')
  await expect(row).toHaveText([expected,expected])
 }
 await page.getByRole('button', { name: names.internal + 'の表示切替', exact: true }).click()
 await expect(labels(page)).toHaveCount(3)
 await page.getByRole('button', { name: names.internal + 'の表示切替', exact: true }).click()
 await expect(labels(page)).toHaveCount(4)
 await page.getByRole('tab', { name: '書き込み', exact: true }).click()
 await page.getByLabel('書き込みの種類', { exact: true }).selectOption('count')
 await expect(page.locator('.annotation-kind')).toHaveCount(4)
 expect((await page.locator('.annotation-kind').allTextContents()).sort()).toEqual(['数量拾い（面積）','数量拾い（面積）','数量拾い（体積）','数量拾い（体積）'].sort())
})

test('item kind/method controls and dimension defaults round-trip, with line/fill previews', async ({ page }) => {
 await open(page)
 await page.getByRole('button', { name: '数量拾い', exact: true }).click()
 await page.getByRole('button', { name: '項目を追加', exact: true }).click()
 const editor = page.getByRole('dialog', { name: '項目を追加', exact: true })
 await editor.getByLabel('名称', { exact: true }).fill('試験')
 await editor.getByLabel('略号', { exact: true }).fill('T')
 await editor.getByRole('radio', { name: '面積', exact: true }).check()
 await expect(editor.getByRole('radio', { name: '囲む', exact: true })).toBeChecked()
 await expect(editor.getByRole('group', { name: '形', exact: true })).toHaveCount(0)
 await expect(editor.getByRole('button', { name: '図面から見本を切り取る' })).toHaveCount(0)
 await expect(editor.locator('.quantity-preview')).toContainText('T 48.00 m²')
 await editor.getByRole('radio', { name: '長さ×高さ', exact: true }).check()
 await expect(editor.locator('.quantity-preview')).toContainText('T 24.00×H?=? m²')
 await editor.getByLabel('高さ（新しく拾うときの初期値）').fill('3.5')
 await expect(editor.locator('.quantity-preview')).toContainText('T 24.00×H3.50=84.00 m²')
 await editor.getByRole('radio', { name: '体積', exact: true }).check()
 await expect(editor.getByRole('radio', { name: '囲む×深さ', exact: true })).toBeChecked()
 await expect(editor.locator('.quantity-preview')).toContainText('T 48.00×D?=? m³')
 await editor.getByRole('radio', { name: '長さ×幅×深さ', exact: true }).check()
 await editor.getByLabel('幅（新しく拾うときの初期値）').fill('0.6')
 await editor.getByLabel('深さ（新しく拾うときの初期値）').fill('0.8')
 await editor.getByRole('button', { name: '破線', exact: true }).click()
 await editor.getByLabel('線の太さ', { exact: true }).selectOption('2')
 await editor.getByRole('button', { name: '追加する', exact: true }).click()
 await page.getByRole('button', { name: 'T 試験', exact: true }).click()
 await page.getByTestId('fixture-panel').getByRole('button', { name: '編集', exact: true }).click()
 const saved = page.getByRole('dialog', { name: '項目を編集', exact: true })
 await expect(saved.getByRole('radio', { name: '体積', exact: true })).toBeChecked()
 await expect(saved.getByRole('radio', { name: '長さ×幅×深さ', exact: true })).toBeChecked()
 await expect(saved.getByLabel('幅（新しく拾うときの初期値）')).toHaveValue('0.6')
 await expect(saved.getByLabel('深さ（新しく拾うときの初期値）')).toHaveValue('0.8')
 await expect(saved.locator('.quantity-preview')).toContainText('T 24.00×W0.60×D0.80=11.52 m³')
 await saved.getByRole('button', { name: '閉じる', exact: true }).click()
})

test('cancelled and zero-default dimensions do not create a pickup, polygon minimum and Backspace', async ({ page }) => {
 await open(page); await addPresets(page)
 await click(page,100,120); await click(page,172,120); await page.keyboard.press('Enter')
 await expect(labels(page)).toHaveCount(0)
 await click(page,172,192); await page.keyboard.press('Backspace'); await page.keyboard.press('Enter')
 await expect(labels(page)).toHaveCount(0)
 await page.keyboard.press('Escape')
 await page.getByRole('button', { name: names.external, exact: true }).click()
 await line(page,100,250)
 const dimensions = page.getByRole('dialog', { name: '拾いの寸法' })
 await dimensions.getByLabel('高さ').fill('0'); await dimensions.getByRole('button', { name: '決定', exact: true }).click()
 await expect(dimensions).toBeVisible()
 await page.keyboard.press('Escape'); await expect(labels(page)).toHaveCount(0)
 await line(page,100,250); await dimensions.getByRole('button', { name: 'やめる' }).click()
 await expect(value(page,names.external)).toHaveText('0.00')
 await page.getByRole('button', { name: names.trench, exact: true }).click()
 await page.getByTestId('fixture-panel').getByRole('button', { name: '編集', exact: true }).click()
 const editor = page.getByRole('dialog', { name: '項目を編集', exact: true })
 await editor.getByLabel('幅（新しく拾うときの初期値）').fill('0')
 await editor.getByLabel('深さ（新しく拾うときの初期値）').fill('')
 await editor.getByRole('button', { name: '変更する' }).click()
 await line(page,100,360)
 await dimensions.getByLabel('幅', { exact: true }).fill('0.6')
 await dimensions.getByLabel('深さ', { exact: true }).fill('0.8')
 await dimensions.getByRole('button', { name: '決定', exact: true }).click()
 await expect(value(page,names.trench)).toHaveText('1.22')
})
