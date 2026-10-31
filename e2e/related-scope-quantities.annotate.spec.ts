import { expect, test, type Locator, type Page } from '@playwright/test'
import mupdf from 'mupdf'

function blankPdf(): number[] {
  const doc = new mupdf.PDFDocument()
  const ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
  try {
    doc.insertPage(-1, ref)
    const buffer = doc.saveToBuffer('compress')
    try {
      return [...buffer.asUint8Array()]
    } finally {
      buffer.destroy()
    }
  } finally {
    ref.destroy()
    doc.destroy()
  }
}

async function open(page: Page): Promise<void> {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(
    bytes => window.__karu!.openBytes(bytes, '関連数量試験.pdf'),
    blankPdf(),
  )
  await page.evaluate(() => window.__karu!.setZoom(1))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('button', { name: '数量拾い', exact: true }).click()
}

async function click(page: Page, x: number, y: number): Promise<void> {
  const position = await page.getByTestId('annotation-layer-0')
    .evaluate((element, p) => {
      const svg = element as SVGSVGElement
      const box = svg.getBoundingClientRect()
      return {
        x: box.left + p.x * box.width / svg.viewBox.baseVal.width,
        y: box.top + p.y * box.height / svg.viewBox.baseVal.height,
      }
    }, { x, y })
  await page.mouse.click(position.x, position.y)
}

async function polygon(
  page: Page,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<void> {
  await click(page, x, y)
  await click(page, x + width, y)
  await click(page, x + width, y + height)
  await click(page, x, y + height)
  await page.keyboard.press('Enter')
}

async function setScale(page: Page): Promise<void> {
  await click(page, 60, 100)
  const dialog = page.getByRole('dialog', { name: '縮尺の設定（1 ページ）' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('縮尺の分母').fill('100')
  await dialog.getByRole('button', { name: '決定', exact: true }).click()
}

async function addWall(
  page: Page,
  code: string,
  method: '囲む' | '長さ×高さ',
): Promise<void> {
  await page.getByRole('button', { name: '項目を追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await dialog.getByLabel('名称', { exact: true }).fill('軽量鉄骨壁下地')
  await dialog.getByLabel('略号', { exact: true }).fill(code)
  await dialog.getByRole('radio', { name: '面積', exact: true }).check()
  await dialog.getByRole('radio', { name: method, exact: true }).check()
  if (method === '長さ×高さ') {
    await dialog.getByLabel('高さ（新しく拾うときの初期値）').fill('3.6')
  }
  await dialog.getByLabel('分類', { exact: true }).selectOption('')
  await dialog.getByLabel('新しい分類の名前', { exact: true })
    .fill('軽量鉄骨壁下地')
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

function total(page: Page, label: string): Locator {
  return page.getByRole('button', { name: label, exact: true })
    .locator('..').locator('.fixture-row-count').first()
}

function card(page: Page, name: RegExp): Locator {
  return page.getByTestId('related-origin-list')
    .getByTestId('related-suggestion')
    .filter({ has: page.getByRole('heading', { name }) })
    .first()
}

/**
 * 関連候補の通常導線を使う。
 * 確認事項は項目ダイアログ、標準品目はマスタの候補選択を経由する。
 */
async function addRelated(
  page: Page,
  name: RegExp,
  code: string,
  output: 'area' | 'length',
): Promise<string> {
  const suggestion = card(page, name)
  await expect(suggestion).toBeVisible()
  await suggestion.getByRole('button', { name: '追加する', exact: true }).first().click()

  const editor = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await expect.poll(async () =>
    await editor.isVisible() || await page.getByRole('dialog').count() > 0,
  ).toBe(true)

  if (!await editor.isVisible()) {
    // 標準品目は「標準マスタから追加」を検索語つきで開く（related-mark-link と同じ操作）
    const master = page.getByRole('dialog', { name: '標準マスタから追加', exact: true })
    await expect(master).toBeVisible()
    await expect(master.getByRole('checkbox').first()).toBeVisible()
    await master.getByRole('checkbox').first().check()
    await master.getByRole('button', { name: /^選んだ項目を追加/u }).click()
    await expect(master).toBeHidden()
  }

  if (await editor.isVisible()) {
    const itemName = await editor.getByLabel('名称', { exact: true }).inputValue()
    await editor.getByLabel('略号', { exact: true }).fill(code)
    await editor.getByRole('radio', {
      name: output === 'area' ? '面積' : '長さ',
      exact: true,
    }).check()
    await editor.getByRole('button', { name: '追加する', exact: true }).click()
    await expect(editor).toHaveCount(0)
    return `${code} ${itemName}`
  }

  // マスタから直接確定する導線では、数量の一覧の行（.fixture-row）の名前で特定する。
  const row = page.getByTestId('fixture-panel').locator('button.fixture-row')
    .filter({ hasText: name }).filter({ visible: true }).last()
  await expect(row).toBeVisible()
  return (await row.getAttribute('aria-label')) ?? ''
}

const pointsPerMetre = 1000 / (100 * 25.4 / 72)

test('related wall marking and baseboard use both drawn pickup methods', async ({ page }) => {
  await open(page)
  await addWall(page, 'WA', '長さ×高さ')
  await page.getByRole('button', { name: 'WA 軽量鉄骨壁下地', exact: true }).click()
  await setScale(page)
  await click(page, 60, 100)
  await click(page, 60 + 10 * pointsPerMetre, 100)
  await page.keyboard.press('Enter')
  await expect(total(page, 'WA 軽量鉄骨壁下地')).toHaveText('36.00')

  await addWall(page, 'WB', '囲む')
  await page.getByRole('button', { name: 'WB 軽量鉄骨壁下地', exact: true }).click()
  await polygon(page, 80, 230, 5 * pointsPerMetre, 3.6 * pointsPerMetre)
  await expect(total(page, 'WB 軽量鉄骨壁下地')).toHaveText('18.00')

  const related = page.getByTestId('format-panel').getByTestId('related-suggestions')
  const list = related.getByTestId('related-origin-list')
  if (await list.getAttribute('open') === null) {
    await list.locator(':scope > summary').click()
  }
  await related.getByLabel('関連提案の案件区分', { exact: true }).selectOption('改修')
  await related.getByLabel('関連提案の品目作業', { exact: true }).selectOption('新設')

  const markLabel = await addRelated(page, /墨出し/u, 'MK', 'area')
  await expect(total(page, markLabel)).toHaveText('15.00')

  await page.getByRole('button', { name: 'WA 軽量鉄骨壁下地', exact: true }).click()
  const baseboardLabel = await addRelated(page, /幅木|巾木/u, 'BB', 'length')
  await expect(total(page, baseboardLabel)).toHaveText('30.00')

  await addWall(page, 'WC', '長さ×高さ')
  await page.getByRole('button', { name: 'WC 軽量鉄骨壁下地', exact: true }).click()
  await click(page, 300, 380)
  await click(page, 300 + 2 * pointsPerMetre, 380)
  await page.keyboard.press('Enter')

  await expect(total(page, markLabel)).toHaveText('17.00')
  await expect(total(page, baseboardLabel)).toHaveText('34.00')
})
