import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import { writeCountFixtures, type CountFixture } from '../src/core/countFixtures'

// SPEC-R7a: 関連の候補の判断は起点の項目ごと。選択済みのカードにも判断のボタンを出す。

test.use({ serviceWorkers: 'block' })

const style = { shape: 'circle', fill: 'none', size: 10, opacity: 1, showCode: true } as const
const conduit = (id: string, name: string, order: number): CountFixture => ({
  id, name, code: name, category: '電線管', order, kind: 'length', method: 'polyline',
  style: { ...style, color: [1, 0, order / 4] },
})
const fire: CountFixture = {
  id: 'fire', name: '防火区画貫通処理', code: 'FP', category: '防火区画貫通処理', order: 2,
  style: { ...style, color: [0, .5, 0] },
}

function pdf(fixtures: CountFixture[]): number[] {
  const doc = new mupdf.PDFDocument(), ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
  try {
    doc.insertPage(-1, ref)
    writeCountFixtures(doc, fixtures)
    const b = doc.saveToBuffer('compress')
    try { return [...b.asUint8Array()] } finally { b.destroy() }
  } finally { ref.destroy(); doc.destroy() }
}

async function open(page: Page, fixtures: CountFixture[]) {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '起点ごとの判断.pdf'), pdf(fixtures))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  return page.getByTestId('fixture-panel')
}

async function openRelated(page: Page) {
  const related = page.getByTestId('format-panel').getByTestId('related-suggestions')
  const list = related.getByTestId('related-origin-list')
  if (await list.getAttribute('open') === null) await list.locator(':scope > summary').click()
  await expect(related.locator('[data-testid="related-suggestion"][data-related-kind="item"]').first()).toBeVisible()
  const all = related.getByRole('button', { name: 'すべて見る', exact: true })
  if (await all.isVisible()) await all.click()
  return related
}

test('同じ提案先でも、起点の項目ごとに判断が分かれる', async ({ page }) => {
  const left = await open(page, [conduit('a', 'PF16', 0), conduit('b', 'PF22', 1)])
  await left.getByRole('button', { name: 'PF16 PF16', exact: true }).click()
  let related = await openRelated(page)
  const cardA = related.locator('[data-testid="related-suggestion"][data-rule-ids~="E-015"]').first()
  await cardA.getByRole('button', { name: '不要', exact: true }).click()
  await expect(related.locator('[data-testid="related-suggestion"][data-rule-ids~="E-015"][data-decision="不要"]')).toHaveCount(1)

  await left.getByRole('button', { name: 'PF22 PF22', exact: true }).click()
  related = await openRelated(page)
  const cardB = related.locator('[data-testid="related-suggestion"][data-rule-ids~="E-015"]').first()
  await expect(cardB).not.toHaveAttribute('data-decision', /.+/)
  await expect(cardB.getByRole('button', { name: '追加する', exact: true })).toBeVisible()

  await left.getByRole('button', { name: 'PF16 PF16', exact: true }).click()
  related = await openRelated(page)
  await expect(related.locator('[data-testid="related-suggestion"][data-rule-ids~="E-015"][data-decision="不要"]')).toHaveCount(1)
})

test('選択済みの候補にも「追加する」などの判断のボタンがある', async ({ page }) => {
  const left = await open(page, [conduit('a', 'PF16', 0), fire])
  await left.getByRole('button', { name: 'PF16 PF16', exact: true }).click()
  const related = await openRelated(page)
  const card = related.locator('[data-testid="related-suggestion"][data-rule-ids~="E-015"]').first()
  await expect(card).toHaveAttribute('data-registered', 'true')
  await expect(card.getByRole('button', { name: '追加する', exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: '不要', exact: true })).toBeVisible()
})
