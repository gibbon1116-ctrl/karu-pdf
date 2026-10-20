import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'

const centers = [[80, 140], [160, 140], [80, 240], [160, 240], [80, 340], [160, 340]] as const

function symbolPdf() {
  const doc = new mupdf.PDFDocument()
  try {
    const symbols = centers.map(([x, y]) => {
      const r = 6, k = r * .5522847498
      return `${x + r} ${y} m ${x + r} ${y + k} ${x + k} ${y + r} ${x} ${y + r} c
        ${x - k} ${y + r} ${x - r} ${y + k} ${x - r} ${y} c
        ${x - r} ${y - k} ${x - k} ${y - r} ${x} ${y - r} c
        ${x + k} ${y - r} ${x + r} ${y - k} ${x + r} ${y} c S
        ${x - r} ${y} m ${x + r} ${y} l S ${x} ${y - r} m ${x} ${y + r} l S`
    }).join('\n')
    const squares = [260, 340, 420].map(x => `${x - 6} 434 12 12 re S`).join('\n')
    const ref = doc.addPage([0, 0, 500, 500], 0, {},
      `q 1 0 0 -1 0 500 cm 0 G 0.8 w ${symbols}\n${squares} Q`)
    try { doc.insertPage(-1, ref) } finally { ref.destroy() }
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally {
    doc.destroy()
  }
}

const searchPanel = (page: Page) => page.getByRole('dialog', { name: '同じ記号を探す', exact: true })
const review = (page: Page) => page.getByRole('dialog', { name: '選んだ候補の確認', exact: true })
const rows = (page: Page) => review(page).getByTestId('symbol-candidate-review-row')
const candidates = (page: Page) => page.getByTestId('symbol-search-candidate')

function candidateById(page: Page, id: string) {
  return page.locator(`[data-testid="symbol-search-candidate"][data-candidate-id="${id}"]`)
}

async function openAndSearch(page: Page) {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '候補確認の試験.pdf'), symbolPdf())
  await page.evaluate(() => window.__karu!.setZoom(1))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()

  await page.getByRole('tab', { name: '数量', exact: true }).click()
  const quantity = page.getByTestId('fixture-panel')
  await quantity.getByRole('button', { name: '項目を追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await dialog.getByLabel('名称', { exact: true }).fill('照明')
  await dialog.getByLabel('略号', { exact: true }).fill('LED')
  await dialog.getByRole('radio', { name: '個数', exact: true }).check()
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  await quantity.getByRole('button', { name: 'LED 照明', exact: true }).click()
  await quantity.getByRole('button', { name: '同じ記号を探す', exact: true }).click()

  await expect(page.locator('.fixture-sample-instruction').or(searchPanel(page))).toBeVisible()
  if (await searchPanel(page).isVisible()) {
    await searchPanel(page).getByRole('button', { name: '見本を囲み直す' }).click()
  }
  await expect(page.locator('.fixture-sample-instruction')).toContainText('探す記号を四角で囲んでください')
  const svg = page.getByTestId('fixture-sample-selection-0')
  const points = await svg.evaluate(element => {
    const svg = element as SVGSVGElement
    const box = svg.getBoundingClientRect()
    return [[71, 131], [89, 149]].map(([x, y]) => ({
      x: box.left + x * box.width / svg.viewBox.baseVal.width,
      y: box.top + y * box.height / svg.viewBox.baseVal.height,
    }))
  })
  await page.mouse.move(points[0].x, points[0].y)
  await page.mouse.down()
  await page.mouse.move(points[1].x, points[1].y, { steps: 4 })
  await page.mouse.up()
  await expect(searchPanel(page)).toBeVisible()
  await expect(review(page)).toHaveCount(0)

  await searchPanel(page).getByRole('button', { name: '探す', exact: true }).click()
  await expect(searchPanel(page).getByText('検索が終わりました。候補を確認して選んでください'))
    .toBeVisible({ timeout: 60_000 })
  await expect(candidates(page)).toHaveCount(6)
  await expect(review(page)).toHaveCount(0)
}

test('画像一覧・選択解除・図面の強調・閉じて開き直す・拾い済みの除外', async ({ page }) => {
  await openAndSearch(page)
  const count = await candidates(page).count()
  await searchPanel(page).getByRole('button', { name: 'すべて選ぶ', exact: true }).click()

  await expect(review(page)).toBeVisible()
  await expect(review(page)).not.toHaveAttribute('aria-modal')
  await expect(rows(page)).toHaveCount(count)
  await expect(review(page)).toContainText(`選択 ${count} / 一覧 ${count}`)
  await expect.poll(() => review(page).locator('canvas').count(), { timeout: 30_000 })
    .toBeGreaterThan(0)
  await expect.poll(() => review(page).locator('canvas').first().evaluate(element => {
    const canvas = element as HTMLCanvasElement
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    for (let index = 0; index < data.length; index += 4) {
      if (data[index] < 240 || data[index + 1] < 240 || data[index + 2] < 240) return true
    }
    return false
  })).toBe(true)

  const row = rows(page).first()
  const id = await row.getAttribute('data-candidate-id')
  expect(id).not.toBeNull()
  await row.getByRole('checkbox').uncheck()
  await expect(row.getByRole('checkbox')).not.toBeChecked()
  await expect(rows(page)).toHaveCount(count)
  await expect(searchPanel(page).getByRole('button', {
    name: `選んだ ${count - 1} 件を数量へ追加`, exact: true,
  })).toBeEnabled()
  await expect(candidateById(page, id!)).toHaveAttribute('data-state', 'pending')

  await row.getByRole('button', { name: /を図面で確認$/ }).click()
  await expect(candidateById(page, id!)).toHaveAttribute('data-focused', 'true')
  await expect(row).toHaveClass(/focused/)

  // A second image click releases the focus even for an unchecked candidate.
  await row.getByRole('button', { name: /を図面で確認$/ }).click()
  await expect(row).not.toHaveClass(/focused/)
  await expect(candidateById(page, id!)).not.toHaveAttribute('data-focused', 'true')
  await expect(row.getByRole('checkbox')).not.toBeChecked()

  // A chosen candidate is first located, then excluded on the second click.
  const chosenRow = rows(page).nth(1)
  const chosenId = await chosenRow.getAttribute('data-candidate-id')
  await chosenRow.getByRole('button', { name: /を図面で確認$/ }).click()
  await expect(chosenRow.getByRole('checkbox')).toBeChecked()
  await expect(candidateById(page, chosenId!)).toHaveAttribute('data-focused', 'true')
  await chosenRow.getByRole('button', { name: /を図面で確認$/ }).click()
  await expect(chosenRow.getByRole('checkbox')).not.toBeChecked()
  await expect(candidateById(page, chosenId!)).toHaveAttribute('data-state', 'pending')
  await expect(candidateById(page, chosenId!)).not.toHaveAttribute('data-focused', 'true')
  await expect(rows(page)).toHaveCount(count)
  await chosenRow.getByRole('checkbox').check()

  await review(page).getByRole('button', { name: '選んだ候補の確認を閉じる', exact: true }).click()
  await expect(review(page)).toHaveCount(0)
  await expect(candidateById(page, id!)).not.toHaveAttribute('data-focused', 'true')
  await searchPanel(page).getByRole('button', { name: '選んだ候補を画像で確認', exact: true }).click()
  await expect(review(page)).toBeVisible()
  await expect(rows(page)).toHaveCount(count)
  await expect(rows(page).first().getByRole('checkbox')).not.toBeChecked()
  await expect.poll(() => review(page).locator('canvas').count()).toBeGreaterThan(0)

  await searchPanel(page).getByRole('button', {
    name: `選んだ ${count - 1} 件を数量へ追加`, exact: true,
  }).click()
  await expect(page.locator('[data-testid="symbol-search-candidate"][data-state="counted"]'))
    .toHaveCount(count - 1)
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).first()).toHaveAttribute('data-candidate-id', id!)
  await expect(review(page)).toContainText('選択 0 / 一覧 1')
})

test('図面での選択では自動表示せず一括選択で開く・ドラッグ・検索やり直しによる破棄', async ({ page }) => {
  await openAndSearch(page)
  const id = await candidates(page).first().getAttribute('data-candidate-id')
  expect(id).not.toBeNull()

  await candidates(page).first().click()
  await expect(review(page)).toHaveCount(0)
  // 窓が閉じているときは、図面のクリックでは強調しない（選択の色のまま）。
  await expect(candidateById(page, id!)).not.toHaveAttribute('data-focused', 'true')

  const count = await candidates(page).count()
  await searchPanel(page).getByRole('button', { name: 'すべて選ぶ', exact: true }).click()
  await expect(review(page)).toBeVisible()
  await expect(rows(page)).toHaveCount(count)
  await expect(rows(page).first()).toHaveAttribute('data-candidate-id', id!)

  const before = await review(page).boundingBox()
  const headingBox = await review(page).getByRole('heading', { name: '選んだ候補の確認' }).boundingBox()
  expect(before).not.toBeNull()
  expect(headingBox).not.toBeNull()
  await page.mouse.move(headingBox!.x + headingBox!.width / 2, headingBox!.y + headingBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(headingBox!.x + headingBox!.width / 2, headingBox!.y + headingBox!.height / 2 + 100, { steps: 5 })
  await page.mouse.up()
  const after = await review(page).boundingBox()
  expect(after).not.toBeNull()
  expect(after!.y).toBeGreaterThan(before!.y + 80)

  await review(page).getByRole('button', { name: '一覧をすべて外す', exact: true }).click()
  await expect(rows(page)).toHaveCount(count)
  await expect(rows(page).first().getByRole('checkbox')).not.toBeChecked()
  await expect(page.locator('[data-testid="symbol-search-candidate"][data-state="chosen"]')).toHaveCount(0)

  await review(page).getByRole('button', { name: '一覧をすべて選ぶ', exact: true }).click()
  await expect(page.locator('[data-testid="symbol-search-candidate"][data-state="chosen"]')).toHaveCount(count)
  await expect(searchPanel(page).getByRole('button', {
    name: `選んだ ${count} 件を数量へ追加`, exact: true,
  })).toBeEnabled()

  await review(page).getByRole('button', { name: '折り畳む', exact: true }).click()
  await expect(review(page).getByRole('button', { name: '展開する', exact: true })).toBeVisible()
  await expect(review(page).getByRole('checkbox')).toHaveCount(0)
  await review(page).getByRole('button', { name: '展開する', exact: true }).click()
  await expect(rows(page).first().getByRole('checkbox')).toBeVisible()

  await searchPanel(page).getByRole('button', { name: '探す', exact: true }).click()
  await expect(review(page)).toHaveCount(0)
  await expect(searchPanel(page).getByText('検索が終わりました。候補を確認して選んでください'))
    .toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-testid="symbol-search-candidate"][data-focused="true"]')).toHaveCount(0)
  await searchPanel(page).getByRole('button', { name: '選んだ候補を画像で確認', exact: true }).click()
  await expect(review(page)).toBeVisible()
  await expect(rows(page)).toHaveCount(0)

  await searchPanel(page).getByRole('button', { name: '閉じる', exact: true }).click()
  await expect(review(page)).toHaveCount(0)
})
