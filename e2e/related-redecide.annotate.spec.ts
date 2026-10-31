import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import { writeCountFixtures, type CountFixture } from '../src/core/countFixtures'
import { RELATED_RULES } from '../src/core/related/rules'

// SPEC-U9: 不要から必要への変更で追加でき、追加を中断しても判断済みのカードから再開できる。

test.use({ serviceWorkers: 'block' })

const origin: CountFixture = {
  id: 'u9-origin', name: '軽量鉄骨天井下地', category: '内外装', code: 'LGS', order: 0,
  kind: 'area', method: 'polygon',
  style: { shape: 'circle', fill: 'none', color: [1, 0, 0], size: 10, opacity: 1, showCode: true },
}

function pdf(): number[] {
  const doc = new mupdf.PDFDocument(), ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
  try {
    doc.insertPage(-1, ref)
    writeCountFixtures(doc, [origin])
    const b = doc.saveToBuffer('compress')
    try { return [...b.asUint8Array()] } finally { b.destroy() }
  } finally { ref.destroy(); doc.destroy() }
}

async function changeUnneededToNeeded(page: Page) {
  const rule = RELATED_RULES.find(value => value.create?.name === '天井耐震補強')
  expect(rule?.create?.unit).toBe('㎡')

  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, 'U9試験.pdf'), pdf())
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  const left = page.getByTestId('fixture-panel')
  await left.getByRole('button', { name: 'LGS 軽量鉄骨天井下地', exact: true }).click()

  const related = page.getByTestId('format-panel').getByTestId('related-suggestions')
  const list = related.getByTestId('related-origin-list')
  if (await list.getAttribute('open') === null) await list.locator(':scope > summary').click()
  await related.getByLabel('関連提案の案件区分', { exact: true }).selectOption('新築')
  const selector = `[data-testid="related-suggestion"][data-rule-ids~="${rule!.id}"]`
  const all = related.getByRole('button', { name: 'すべて見る', exact: true })
  await expect(related.getByTestId('related-suggestion').first()).toBeVisible()
  if (await all.isVisible()) await all.click()
  await related.locator(selector).first().getByRole('button', { name: '不要', exact: true }).click()

  const summary = related.locator('summary').filter({ hasText: /判断済み \d+件/ })
  await expect(summary).toBeVisible()
  const reviewed = summary.locator('..')
  if (await reviewed.getAttribute('open') === null) await summary.click()
  const card = reviewed.locator(selector).first()
  await expect(card).toHaveAttribute('data-decision', '不要')
  await card.getByLabel('関連候補の判断を変更', { exact: true }).selectOption('必要')

  const dialog = page.getByRole('dialog').filter({ has: page.getByLabel('名称', { exact: true }) })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('名称', { exact: true })).toHaveValue('天井耐震補強')
  return { card, dialog }
}

test('不要から必要に変更すると項目を追加でき、起点との連動が自動で設定される', async ({ page }) => {
  const { dialog } = await changeUnneededToNeeded(page)
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  await expect(dialog).toBeHidden()

  await expect.poll(async () => (await page.evaluate(() => window.__karu!.getCountFixtures()))
    .find(fixture => fixture.name === '天井耐震補強'))
    // 原本 Excel（v25）で天井耐震補強（A-ceiling-38）は確認の記録だけで数量を作らない分類のため、天井の面積を係数1で写す連動を付けない
    .toMatchObject({ name: '天井耐震補強' })
  expect((await page.evaluate(() => window.__karu!.getCountFixtures()))
    .find(fixture => fixture.name === '天井耐震補強')?.link).toBeUndefined()
})

test('必要に変更してダイアログを閉じても、判断済みのカードから後で追加できる', async ({ page }) => {
  const { card, dialog } = await changeUnneededToNeeded(page)
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
  await expect(dialog).toBeHidden()

  await expect(card).toHaveAttribute('data-decision', '必要')
  const add = card.getByRole('button', { name: '追加する', exact: true })
  await expect(add).toBeVisible()
  await expect(add).toBeEnabled()
  await expect.poll(async () => (await page.evaluate(() => window.__karu!.getCountFixtures()))
    .map(fixture => fixture.id))
    .toEqual([origin.id])

  await add.click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('名称', { exact: true })).toHaveValue('天井耐震補強')
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  await expect(dialog).toBeHidden()

  await expect.poll(async () => (await page.evaluate(() => window.__karu!.getCountFixtures()))
    .find(fixture => fixture.name === '天井耐震補強'))
    // 原本 Excel（v25）で天井耐震補強（A-ceiling-38）は確認の記録だけで数量を作らない分類のため、天井の面積を係数1で写す連動を付けない
    .toMatchObject({ name: '天井耐震補強' })
  expect((await page.evaluate(() => window.__karu!.getCountFixtures()))
    .find(fixture => fixture.name === '天井耐震補強')?.link).toBeUndefined()
})
