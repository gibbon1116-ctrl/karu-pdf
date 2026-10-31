import { expect, test } from '@playwright/test'
import mupdf from 'mupdf'
import { writeCountFixtures, type CountFixture } from '../src/core/countFixtures'
import { RELATED_RULES } from '../src/core/related/rules'

// SPEC-R7b: 面積の起点から「追加する」で面積の項目を作ると、同じ面積の連動（係数 1）になる。Ctrl+Z 1回で戻る。

test.use({ serviceWorkers: 'block' })

const origin: CountFixture = {
  id: 'r7b-origin', name: '軽量鉄骨天井下地', category: '内外装', code: 'LGS', order: 0,
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

test('天井下地から確認事項（㎡）を追加すると、面積の写しの連動を付けず（確認の記録）、Ctrl+Z で戻る', async ({ page }) => {
  const rule = RELATED_RULES.find(value => value.create?.name === '天井耐震補強')
  expect(rule?.create?.unit).toBe('㎡')

  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, 'R7b試験.pdf'), pdf())
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  const left = page.getByTestId('fixture-panel')
  await left.getByRole('button', { name: 'LGS 軽量鉄骨天井下地', exact: true }).click()

  const related = page.getByTestId('format-panel').getByTestId('related-suggestions')
  const list = related.getByTestId('related-origin-list')
  if (await list.getAttribute('open') === null) await list.locator(':scope > summary').click()
  await related.getByLabel('関連提案の案件区分', { exact: true }).selectOption('新築')
  const card = related.locator(`[data-testid="related-suggestion"][data-rule-ids~="${rule!.id}"]`).first()
  const all = related.getByRole('button', { name: 'すべて見る', exact: true })
  await expect(related.getByTestId('related-suggestion').first()).toBeVisible()
  if (await all.isVisible()) await all.click()
  await card.getByRole('button', { name: '追加する', exact: true }).click()

  const dialog = page.getByRole('dialog').filter({ has: page.getByLabel('名称', { exact: true }) })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('名称', { exact: true })).toHaveValue('天井耐震補強')
  await dialog.getByRole('button', { name: /^(?:保存|追加|作成|保存する|追加する|項目を追加)$/ }).last().click()
  await expect(dialog).toBeHidden()

  await expect.poll(async () => (await page.evaluate(() => window.__karu!.getCountFixtures()))
    .find(fixture => fixture.name === '天井耐震補強'))
    // 原本 Excel（v25）で天井耐震補強（A-ceiling-38）は確認の記録だけで数量を作らない分類のため、天井の面積を係数1で写す連動を付けない
    .toMatchObject({ name: '天井耐震補強' })
  expect((await page.evaluate(() => window.__karu!.getCountFixtures()))
    .find(fixture => fixture.name === '天井耐震補強')?.link).toBeUndefined()

  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await page.evaluate(() => window.__karu!.getCountFixtures())).map(f => f.id))
    .toEqual([origin.id])
})
