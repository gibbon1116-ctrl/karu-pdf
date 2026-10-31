import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'

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
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '面積除外試験.pdf'), blankPdf())
  await page.evaluate(() => window.__karu!.setZoom(1))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
}

async function point(page: Page, x: number, y: number) {
  return page.getByTestId('annotation-layer-0').evaluate((element, p) => {
    const svg = element as SVGSVGElement, box = svg.getBoundingClientRect()
    return {
      x: box.left + p.x * box.width / svg.viewBox.baseVal.width,
      y: box.top + p.y * box.height / svg.viewBox.baseVal.height,
    }
  }, { x, y })
}

async function click(page: Page, x: number, y: number) {
  const p = await point(page, x, y)
  await page.mouse.click(p.x, p.y)
}

async function polygon(page: Page, x: number, y: number, width = 72, height = width) {
  await click(page, x, y)
  await click(page, x + width, y)
  await click(page, x + width, y + height)
  await click(page, x, y + height)
  await page.keyboard.press('Enter')
}

async function setScale(page: Page) {
  await click(page, 100, 120)
  const dialog = page.getByRole('dialog', { name: '縮尺の設定（1 ページ）' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('縮尺の分母').fill('100')
  await dialog.getByRole('button', { name: '決定', exact: true }).click()
}

async function addItem(page: Page, options: {
  name: string
  code: string
  kind: 'count' | 'area' | 'volume'
  method?: '囲む' | '長さ×高さ' | '囲む×深さ' | '長さ×幅×深さ'
  height?: string
  opening?: [string, string]
  category?: string
}) {
  await page.getByRole('button', { name: '項目を追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await dialog.getByLabel('名称', { exact: true }).fill(options.name)
  await dialog.getByLabel('略号', { exact: true }).fill(options.code)
  await dialog.getByRole('radio', {
    name: { count: '個数', area: '面積', volume: '体積' }[options.kind], exact: true,
  }).check()
  if (options.method) await dialog.getByRole('radio', { name: options.method, exact: true }).check()
  if (options.height) await dialog.getByLabel('高さ（新しく拾うときの初期値）').fill(options.height)
  if (options.opening) {
    await dialog.getByLabel('開口幅（m）').fill(options.opening[0])
    await dialog.getByLabel('開口高さ（m）').fill(options.opening[1])
  }
  await dialog.getByLabel('分類', { exact: true }).selectOption('')
  await dialog.getByLabel('新しい分類の名前', { exact: true }).fill(options.category ?? '試験')
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

const labels = (page: Page) => page.locator('.measurement-shape .measurement-label')
const format = (page: Page) => page.getByTestId('format-panel')
const total = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true }).locator('..').locator('.fixture-row-count').first()

async function startPolygonPickup(page: Page) {
  await open(page)
  await page.getByRole('button', { name: '数量拾い', exact: true }).click()
  await addItem(page, { name: '外壁', code: 'W', kind: 'area', method: '長さ×高さ', height: '4' })
  await page.getByRole('button', { name: 'W 外壁', exact: true }).click()
  const methods = page.getByRole('group', { name: '計上方法', exact: true })
  await methods.getByRole('button', { name: '囲む', exact: true }).click()
  await expect(methods.getByRole('button', { name: '囲む', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await setScale(page)
  await polygon(page, 100, 120)
  await expect(labels(page)).toHaveText('W 6.45 m²')
  await expect(total(page, 'W 外壁')).toHaveText('6.45')
  await expect(page.getByRole('dialog', { name: '拾いの寸法' })).toHaveCount(0)
  await expect(format(page).getByText('面積　6.45 m²', { exact: true })).toBeVisible()
  await expect(format(page).getByLabel('高さ', { exact: true })).toHaveCount(0)
}


test('switch length×height to polygon, subtract a hole and undo once', async ({ page }) => {
  await startPolygonPickup(page)
  const holes = format(page).getByRole('group', { name: '除外範囲', exact: true })
  await holes.getByRole('button', { name: '除外範囲を囲む', exact: true }).click()
  await expect(page.getByText('除外する範囲を囲んでください（Enter・ダブルクリックで決定、Esc で中止）', { exact: true })).toBeVisible()
  await polygon(page, 118, 138, 36)
  await expect(total(page, 'W 外壁')).toHaveText('4.84')
  await expect(labels(page)).toHaveText(/6\.45.*−.*1\.61.*=.*4\.84 m²/)
  await expect(holes.getByText('除外 1　1.61 m²', { exact: true })).toBeVisible()
  await expect(page.locator('.measurement-hole')).toHaveCount(1)
  await expect(holes.getByRole('button', { name: '囲み終える', exact: true })).toBeVisible()
  await page.keyboard.press('Control+z')
  await expect(total(page, 'W 外壁')).toHaveText('6.45')
  await expect(labels(page)).toHaveText('W 6.45 m²')
  await expect(page.locator('.measurement-hole')).toHaveCount(0)
})

test('outside hole is rejected; Backspace, continuous drawing, deletion and Escape work', async ({ page }) => {
  await startPolygonPickup(page)
  const holes = format(page).getByRole('group', { name: '除外範囲', exact: true })
  await holes.getByRole('button', { name: '除外範囲を囲む', exact: true }).click()

  await click(page, 110, 130)
  await click(page, 182, 130)
  await click(page, 182, 166)
  await click(page, 110, 166)
  await page.keyboard.press('Enter')
  await expect(page.locator('.area-hole-guide').getByRole('alert')).toHaveText('除外範囲は外形の内側を囲んでください')
  await expect(page.locator('.measurement-hole')).toHaveCount(0)
  await expect(total(page, 'W 外壁')).toHaveText('6.45')

  for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace')
  await polygon(page, 100, 120, 18)
  await expect(page.locator('.measurement-hole')).toHaveCount(1)
  await expect(total(page, 'W 外壁')).toHaveText('6.05')
  await expect(holes.getByRole('button', { name: '囲み終える', exact: true })).toBeVisible()

  await polygon(page, 140, 160, 18)
  await expect(page.locator('.measurement-hole')).toHaveCount(2)
  await expect(total(page, 'W 外壁')).toHaveText('5.65')

  await holes.getByRole('button', { name: '除外1を削除', exact: true }).click()
  await expect(page.locator('.measurement-hole')).toHaveCount(1)
  await expect(total(page, 'W 外壁')).toHaveText('6.05')
  await page.keyboard.press('Escape')
  await expect(page.locator('.area-hole-guide')).toHaveCount(0)
  await expect(holes.getByRole('button', { name: '除外範囲を囲む', exact: true })).toBeVisible()
})

test('fixture and manual openings commit on blur/Enter, undo once, and follow fixture dimensions', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '数量拾い', exact: true }).click()
  await addItem(page, { name: 'アルミ窓', code: 'AW-1', kind: 'count', opening: ['1.8', '1.2'], category: '建具' })
  await addItem(page, { name: '外壁', code: 'W', kind: 'area', method: '長さ×高さ', height: '4' })
  await page.getByRole('button', { name: 'W 外壁', exact: true }).click()
  await setScale(page)
  await click(page, 100, 250)
  await click(page, 172, 250)
  await page.keyboard.press('Enter')
  await expect(total(page, 'W 外壁')).toHaveText('10.16')

  const openings = format(page).getByRole('group', { name: '開口部（差し引く）', exact: true })
  await openings.getByRole('button', { name: '開口部を追加', exact: true }).click()
  await expect(openings.getByText('? m²', { exact: true }).first()).toBeVisible()
  await expect(total(page, 'W 外壁')).toHaveText('10.16')
  const option = openings.getByLabel('開口部1の種類').locator('option').filter({ hasText: 'AW-1 アルミ窓（1.80×1.20）' })
  const itemId = await option.getAttribute('value')
  expect(itemId).toBeTruthy()
  await openings.getByLabel('開口部1の種類').selectOption(itemId!)
  await openings.getByLabel('開口部1の箇所数').fill('2')
  await openings.getByLabel('開口部1の箇所数').press('Enter')
  await expect(total(page, 'W 外壁')).toHaveText('5.84')

  await openings.getByRole('button', { name: '開口部を追加', exact: true }).click()
  await openings.getByLabel('開口部2の幅（m）').fill('0.5')
  await openings.getByLabel('開口部2の高さ（m）').focus()
  await expect(total(page, 'W 外壁')).toHaveText('5.84')
  await openings.getByLabel('開口部2の高さ（m）').fill('1')
  await openings.getByLabel('開口部2の高さ（m）').press('Enter')
  await expect(openings.getByText('合計　4.82 m²', { exact: true })).toBeVisible()
  await expect(total(page, 'W 外壁')).toHaveText('5.34')
  await expect(labels(page)).toHaveText(/−.*=.*5\.34 m²/)

  await page.keyboard.press('Control+z')
  await expect(total(page, 'W 外壁')).toHaveText('5.84')
  await page.keyboard.press('Control+Shift+z')
  await expect(total(page, 'W 外壁')).toHaveText('5.34')

  await page.getByRole('button', { name: 'AW-1 アルミ窓', exact: true }).click()
  await page.getByTestId('fixture-panel').getByRole('button', { name: '編集', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '項目を編集', exact: true })
  await editor.getByLabel('開口幅（m）').fill('2')
  await editor.getByRole('button', { name: '変更する', exact: true }).click()
  await expect(total(page, 'W 外壁')).toHaveText('4.86')
  await expect(labels(page)).toHaveText(/−.*=.*4\.86 m²$/)

  const expected = await labels(page).allTextContents()
  const saved = await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!])
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '開口再読込.pdf'), saved)
  // Fixtures load with the quantity tab; labels need them.
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await expect(labels(page)).toHaveText(expected)
})

test('polygon can be reassigned to an area item whose default is length×height', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '数量拾い', exact: true }).click()
  await addItem(page, { name: '床', code: 'F', kind: 'area', method: '囲む' })
  await addItem(page, { name: '別の面積', code: 'A', kind: 'area', method: '長さ×高さ', height: '3' })
  await page.getByRole('button', { name: 'F 床', exact: true }).click()
  await setScale(page)
  await polygon(page, 100, 120)
  await expect(labels(page)).toHaveText('F 6.45 m²')

  const select = format(page).getByLabel('項目を変更', { exact: true })
  const target = select.locator('option').filter({ hasText: 'A 別の面積' })
  await expect(target).toHaveCount(1)
  await select.selectOption((await target.getAttribute('value'))!)
  await expect(labels(page)).toHaveText('A 6.45 m²')
  await expect(total(page, 'A 別の面積')).toHaveText('6.45')
  await expect(format(page).getByLabel('高さ', { exact: true })).toHaveCount(0)

  await format(page).getByRole('button', { name: '項目を編集…', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '項目を編集', exact: true })
  await expect(editor.getByRole('radio', { name: '面積', exact: true })).toBeDisabled()
  await expect(editor.getByRole('radio', { name: '囲む', exact: true })).toBeEnabled()
  await editor.getByRole('radio', { name: '囲む', exact: true }).check()
  await editor.getByRole('button', { name: '変更する', exact: true }).click()
  await expect(labels(page)).toHaveText('A 6.45 m²')
})

test('measurement area supports holes and finish button', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: /^計測/ }).first().click()
  await page.getByText('面積', { exact: true }).last().click()
  await setScale(page)
  await polygon(page, 100, 120)
  await expect(labels(page)).toHaveText('6.45 m²')

  const holes = format(page).getByRole('group', { name: '除外範囲', exact: true })
  await holes.getByRole('button', { name: '除外範囲を囲む', exact: true }).click()
  await polygon(page, 118, 138, 36)
  await expect(labels(page)).toHaveText(/6\.45.*−.*1\.61.*=.*4\.84 m²/)
  await expect(page.locator('.measurement-hole')).toHaveCount(1)
  await holes.getByRole('button', { name: '囲み終える', exact: true }).click()
  await expect(page.locator('.area-hole-guide')).toHaveCount(0)
  await page.keyboard.press('Control+z')
  await expect(labels(page)).toHaveText('6.45 m²')
})

test('fixture opening validation rejects incomplete, zero and oversized dimensions', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '数量拾い', exact: true }).click()
  await page.getByRole('button', { name: '項目を追加', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await editor.getByLabel('名称', { exact: true }).fill('窓')
  await editor.getByLabel('略号', { exact: true }).fill('AW')
  await editor.getByLabel('新しい分類の名前', { exact: true }).fill('建具')
  await editor.getByLabel('開口幅（m）').fill('1.8')
  await editor.getByRole('button', { name: '追加する', exact: true }).click()
  await expect(editor.getByRole('alert')).toHaveText('開口寸法は幅と高さの両方を入力してください。')

  await editor.getByLabel('開口高さ（m）').fill('0')
  await editor.getByRole('button', { name: '追加する', exact: true }).click()
  await expect(editor.getByRole('alert')).toHaveText('開口寸法は0より大きく100以下の数値で入力してください。')

  await editor.getByLabel('開口高さ（m）').fill('101')
  await editor.getByRole('button', { name: '追加する', exact: true }).click()
  await expect(editor.getByRole('alert')).toHaveText('開口寸法は0より大きく100以下の数値で入力してください。')

  await editor.getByLabel('開口高さ（m）').fill('1.2')
  await editor.getByRole('button', { name: '追加する', exact: true }).click()
  await expect(editor).toHaveCount(0)
})
