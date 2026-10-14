import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import { writeCountFixtures, type CountFixture } from '../src/core/countFixtures'

// SPEC-R7d: 部位の組の見出しと、採用済みの oneOf の畳み。
test.use({ serviceWorkers: 'block' })

const style = {
  shape: 'circle',
  fill: 'none',
  size: 10,
  opacity: 1,
  showCode: true,
} as const

const ceiling: CountFixture = {
  id: 'ceiling',
  name: '軽量鉄骨天井下地',
  code: 'CEIL',
  category: '内外装',
  order: 0,
  kind: 'area',
  method: 'polygon',
  style: { ...style, color: [1, 0, 0] },
}

const board: CountFixture = {
  id: 'board',
  name: '天井せっこうボ－ド張り',
  code: 'BOARD',
  category: '内外装',
  order: 1,
  kind: 'area',
  method: 'polygon',
  style: { ...style, color: [0, .5, 0] },
}

function pdf(fixtures: CountFixture[]): number[] {
  const doc = new mupdf.PDFDocument()
  const ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
  try {
    doc.insertPage(-1, ref)
    writeCountFixtures(doc, fixtures)
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

async function openRelated(page: Page, fixtures: CountFixture[] = [ceiling]) {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes =>
    window.__karu!.openBytes(bytes, '部位の組.pdf'), pdf(fixtures))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await page.getByTestId('fixture-panel')
    .getByRole('button', { name: 'CEIL 軽量鉄骨天井下地', exact: true }).click()

  const related = page.getByTestId('format-panel')
    .getByTestId('related-suggestions')
  const list = related.getByTestId('related-origin-list')
  if (await list.getAttribute('open') === null) {
    await list.locator(':scope > summary').click()
  }
  await related.getByRole('combobox', { name: '関連提案の案件区分' })
    .selectOption('改修')
  await related.getByRole('combobox', { name: '関連提案の品目作業' })
    .selectOption('更新・交換')
  await expect(related.locator(
    '[data-testid="related-suggestion"][data-rule-ids~="A-ceiling-23"]',
  )).toHaveCount(1)

  return { related, list }
}

test('部位の組を役割の順で表示し、主仕上げを5件で省略しない', async ({ page }) => {
  const { related, list } = await openRelated(page)
  await expect(list.getByTestId('related-role-group')).toHaveText([
    /^仮設 \d+件$/,
    /^撤去 \d+件$/,
    /^下地 \d+件$/,
    /^主仕上げ \d+件$/,
    /^表面処理 \d+件$/,
    /^附属 \d+件$/,
    /^処理 \d+件$/,
    /^確認 \d+件$/,
  ])

  const main = list.locator(
    '[data-testid="related-role-group"][data-role="主仕上げ"]',
  ).locator('..')
  const cards = main.locator(
    '[data-testid="related-suggestion"][data-one-of="ceiling-board"]',
  )
  await expect(cards).toHaveCount(8)
  for (let index = 0; index < 8; index++) {
    await expect(cards.nth(index)).toBeVisible()
  }
  await expect(main.getByRole('button', { name: 'すべて見る', exact: true }))
    .toHaveCount(0)
  await expect(related.locator(
    '[data-testid="related-suggestion"][data-rule-ids~="A-ceiling-05"]',
  )).toBeVisible()
})

test('追加するで必要を記録すると、同じ主仕上げの未判断候補を畳む', async ({ page }) => {
  const { list } = await openRelated(page)
  const main = list.locator(
    '[data-testid="related-role-group"][data-role="主仕上げ"]',
  ).locator('..')
  const chosen = list.locator(
    '[data-testid="related-suggestion"][data-rule-ids~="A-ceiling-23"]',
  )

  await chosen.getByRole('button', { name: '追加する', exact: true }).click()

  const alternatives = main.locator(
    '[data-testid="related-oneof-alternatives"][data-one-of="ceiling-board"]',
  )
  await expect(alternatives).toHaveCount(1)
  await expect(alternatives.locator(':scope > summary'))
    .toHaveText('ほかの候補 7件')
  await expect(alternatives).not.toHaveAttribute('open', /.*/)
  await expect(alternatives.getByTestId('related-suggestion')).toHaveCount(7)
  await expect(list.locator(
    '[data-testid="related-suggestion"][data-rule-ids~="A-ceiling-23"]',
  )).toHaveAttribute('data-decision', '必要')
})

test('文書に旧表記の仕上げがある場合も選択済みとして畳み、展開できる', async ({ page }) => {
  const { list } = await openRelated(page, [ceiling, board])
  const main = list.locator(
    '[data-testid="related-role-group"][data-role="主仕上げ"]',
  ).locator('..')
  const chosen = main.locator(
    '[data-testid="related-suggestion"][data-rule-ids~="A-ceiling-23"]',
  )
  await expect(chosen).toHaveAttribute('data-registered', 'true')
  await expect(chosen).toBeVisible()

  const alternatives = main.locator(
    '[data-testid="related-oneof-alternatives"][data-one-of="ceiling-board"]',
  )
  await expect(alternatives.locator(':scope > summary'))
    .toHaveText('ほかの候補 7件')

  const alternative = alternatives.locator(
    '[data-testid="related-suggestion"][data-rule-ids~="A-ceiling-24"]',
  )
  await expect(alternative).not.toBeVisible()
  await alternatives.locator(':scope > summary').click()
  await expect(alternative).toBeVisible()

  const surface = list.locator(
    '[data-testid="related-role-group"][data-role="表面処理"]',
  ).locator('..')
  await expect(surface.locator(
    '[data-testid="related-suggestion"][data-rule-ids~="A-ceiling-31"]',
  )).toBeVisible()
  await expect(surface.locator(
    '[data-testid="related-suggestion"][data-rule-ids~="A-ceiling-32"]',
  )).toBeVisible()
})
