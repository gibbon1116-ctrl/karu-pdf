import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import { readCountFixtures, writeCountFixtures, type CountFixture } from '../src/core/countFixtures'

test.use({ serviceWorkers: 'block' })

const style = {
  shape: 'circle', fill: 'none', size: 10, opacity: 1, showCode: true,
} as const
const fixtures: CountFixture[] = [
  {
    id: 'origin', name: 'PF22', code: 'PF', category: '電線管', order: 0,
    kind: 'length', method: 'polyline',
    style: { ...style, color: [1, 0, 0] },
  },
  {
    id: 'cable', name: 'VVF 1.6-2C', code: 'VVF', category: 'ケーブル（低圧）', order: 1,
    kind: 'length', method: 'polyline',
    style: { ...style, color: [0, 0, 1] },
  },
]

function pdf(): number[] {
  const doc = new mupdf.PDFDocument()
  const ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
  try {
    doc.insertPage(-1, ref)
    writeCountFixtures(doc, fixtures)
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] }
    finally { buffer.destroy() }
  } finally {
    ref.destroy()
    doc.destroy()
  }
}

async function click(page: Page, x: number, y: number) {
  const point = await page.getByTestId('annotation-layer-0').evaluate((element, value) => {
    const svg = element as SVGSVGElement
    const box = svg.getBoundingClientRect()
    return {
      x: box.left + value.x * box.width / svg.viewBox.baseVal.width,
      y: box.top + value.y * box.height / svg.viewBox.baseVal.height,
    }
  }, { x, y })
  await page.mouse.click(point.x, point.y)
}

async function savedFixtures(page: Page): Promise<CountFixture[]> {
  const bytes = await page.evaluate(async () => [
    ...(await window.__karu!.saveToBytes())!,
  ])
  const doc = new mupdf.PDFDocument(new Uint8Array(bytes))
  try { return readCountFixtures(doc) }
  finally { doc.destroy() }
}

test('関連の追加を線要素・頂点に反映し、関連の選択肢とボタンから追加できる', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '関連経路試験.pdf'), pdf())
  await page.evaluate(() => window.__karu!.setZoom(1))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  const left = page.getByTestId('fixture-panel')
  await left.getByRole('button', { name: 'PF PF22', exact: true }).click()

  await click(page, 100, 150)
  const scale = page.getByRole('dialog', { name: '縮尺の設定（1 ページ）' })
  await expect(scale).toBeVisible()
  await scale.getByLabel('縮尺の分母').fill('100')
  await scale.getByRole('button', { name: '決定', exact: true }).click()

  await click(page, 100, 150)
  await click(page, 172, 150)
  await click(page, 172, 220)
  await page.keyboard.press('Enter')

  await left.getByRole('button', { name: 'PF PF22', exact: true }).click()
  await click(page, 250, 260)
  await click(page, 322, 260)
  await click(page, 322, 330)
  await page.keyboard.press('Enter')

  const right = page.getByTestId('format-panel')
  const related = right.getByTestId('related-suggestions')
  await related.getByTestId('related-origin-list').locator('summary').first().click()
  const fireCandidate = related.locator(
    '[data-testid="related-suggestion"][data-rule-ids~="E-015"]',
  ).filter({ hasText: '防火区画' }).first()
  await expect(fireCandidate).toBeVisible()
  const beforeFire = new Set((await page.evaluate(() => window.__karu!.getCountFixtures()))
    .map(fixture => fixture.id))
  await fireCandidate.getByRole('button', { name: '追加する', exact: true }).click()

  const master = page.getByRole('dialog', { name: '標準マスタから追加', exact: true })
  await expect(master).toBeVisible()
  await expect(master.getByRole('checkbox').first()).toBeVisible()
  await master.getByRole('checkbox').first().check()
  await master.getByRole('button', { name: '選んだ項目を追加（1件）', exact: true }).click()
  await expect(master).toBeHidden()

  // SPEC-T12: E-015（防火区画等貫通処理）は原本「同一開口に複数回路が通っても開口1件」。
  // 経路の頂点は貫通の位置ではないので、項目だけ作り、頂点へは自動で置かない。
  const pointSelect = right.getByLabel('頂点の個数1の項目', { exact: true })
  await expect(pointSelect).toHaveCount(0)
  // 保存（saveToBytes）は選択を外すので、ここでは画面のストアの項目を見る。
  const afterFire = await page.evaluate(() => window.__karu!.getCountFixtures())
  const fire = afterFire.find(fixture =>
    !beforeFire.has(fixture.id) && fixture.name.includes('防火区画'))
  expect(fire).toBeDefined()
  const fireId = fire!.id

  // 利用者が頂点に置く操作は従来どおり使える。
  const addFireFirst = right.getByRole('button', {
    name: `頂点に ${fire!.name} を足す`, exact: true,
  })
  await expect(addFireFirst).toBeEnabled()
  await addFireFirst.click()
  await expect(pointSelect).toBeVisible()
  await expect(pointSelect).toHaveValue(fireId)
  await expect(right.getByLabel('頂点の個数1の位置', { exact: true })).toHaveValue('1')

  const groups = pointSelect.locator('optgroup')
  await expect(groups.first()).toHaveAttribute('label', '関連の項目')
  await expect(groups.first().locator(`option[value="${fireId}"]`)).toHaveCount(1)
  await expect(groups.nth(1)).toHaveAttribute('label', 'そのほかの個数の項目')

  const addFire = right.getByRole('button', {
    name: `頂点に ${fire!.name} を足す`, exact: true,
  })
  await expect(addFire).toBeEnabled()
  await addFire.click()
  await expect(right.getByLabel('頂点の個数2の項目', { exact: true })).toHaveValue(fireId)
  await expect(right.getByLabel('頂点の個数2の位置', { exact: true })).toHaveValue('2')
  await expect(addFire).toBeDisabled()
  await expect(addFire).toHaveAttribute('title', /終点/)
  await page.keyboard.press('Control+z')
  // Undo は印の選択を外すので、選択の道具で（追加したときに選んでいた2本目の）経路を選び直す。
  await page.getByRole('button', { name: '選択', exact: true }).click()
  await click(page, 286, 260)
  await expect(right.getByLabel('頂点の個数1の項目', { exact: true })).toBeVisible()
  await expect(right.getByLabel('頂点の個数2の項目', { exact: true })).toHaveCount(0)
  await expect(addFire).toBeEnabled()

  // 線要素への反映: ケーブル（低圧）の経路を2本引き、E-002（電線 → ケーブルラック）の「追加する」でラックを追加する（PF22 があるので E-001 の電線管は選択済み）。
  await left.getByRole('button', { name: 'VVF VVF 1.6-2C', exact: true }).click()
  await click(page, 100, 380); await click(page, 172, 380); await page.keyboard.press('Enter')
  await left.getByRole('button', { name: 'VVF VVF 1.6-2C', exact: true }).click()
  await click(page, 250, 420); await click(page, 322, 420); await page.keyboard.press('Enter')
  const cableRelated = right.getByTestId('related-suggestions')
  const conduit = cableRelated.locator(
    '[data-testid="related-suggestion"][data-rule-ids~="E-002"]',
  ).first()
  await expect(conduit).toBeVisible()
  const beforeLine = await page.evaluate(() => window.__karu!.getCountFixtures())
  await conduit.getByRole('button', { name: '追加する', exact: true }).click()
  await expect(master).toBeVisible()
  const conduitOption = master.getByRole('checkbox').first()
  await expect(conduitOption).toBeVisible()
  await conduitOption.check()
  await master.getByRole('button', { name: '選んだ項目を追加（1件）', exact: true }).click()
  await expect(master).toBeHidden()

  const beforeIds = new Set(beforeLine.map(fixture => fixture.id))
  const afterLine = await page.evaluate(() => window.__karu!.getCountFixtures())
  const added = afterLine.filter(fixture => !beforeIds.has(fixture.id))
  expect(added).toHaveLength(1)
  expect(added[0].method ?? 'polyline').toBe('polyline')

  // 選んでいた経路（2本目の VVF）に線要素が入り、経路は選んだまま。
  await expect(right.locator('.route-item')).toHaveCount(2)
  // もう一方の VVF の経路にも入る。
  await page.getByRole('button', { name: '選択', exact: true }).click()
  await click(page, 136, 380)
  await expect(right.locator('.route-item')).toHaveCount(2)

  // 関連の追加一回を戻すと、項目と2本の経路が一緒に戻る。
  await page.keyboard.press('Control+z')
  await click(page, 136, 380)
  await expect(right.locator('.route-item')).toHaveCount(1)
  expect((await page.evaluate(() => window.__karu!.getCountFixtures()))
    .some(fixture => fixture.id === added[0].id)).toBe(false)
})

test('選択済みの電線管をケーブルの2本の経路に入れ、Ctrl+Zで戻す', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '既存項目経路試験.pdf'), pdf())
  await page.evaluate(() => window.__karu!.setZoom(1))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  const left = page.getByTestId('fixture-panel')
  await left.getByRole('button', { name: 'VVF VVF 1.6-2C', exact: true }).click()

  await click(page, 100, 150)
  const scale = page.getByRole('dialog', { name: '縮尺の設定（1 ページ）' })
  await expect(scale).toBeVisible()
  await scale.getByLabel('縮尺の分母').fill('100')
  await scale.getByRole('button', { name: '決定', exact: true }).click()
  await click(page, 100, 150)
  await click(page, 172, 150)
  await page.keyboard.press('Enter')

  await left.getByRole('button', { name: 'VVF VVF 1.6-2C', exact: true }).click()
  await click(page, 250, 260)
  await click(page, 322, 260)
  await page.keyboard.press('Enter')

  const right = page.getByTestId('format-panel')
  const related = right.getByTestId('related-suggestions')
  await related.getByTestId('related-origin-list').locator('summary').first().click()
  const candidate = related.locator(
    '[data-testid="related-suggestion"][data-rule-ids~="E-001"]',
  ).first()
  await expect(candidate).toBeVisible()
  await expect(candidate).toHaveAttribute('data-registered', 'true')
  // SPEC-R7a: 選択済みのカードにも判断のボタンがある。
  await expect(candidate.getByRole('button', {
    name: '追加する', exact: true,
  })).toHaveCount(1)
  await expect(right.locator('.route-item')).toHaveCount(1)
  const beforeFixtures = await page.evaluate(() => window.__karu!.getCountFixtures())

  await candidate.getByRole('button', {
    name: '経路に入れる', exact: true,
  }).click()

  // 2本目の経路を選んだ状態を維持している。
  await expect(right.locator('.route-item')).toHaveCount(2)
  await expect(right.locator('.route-item').nth(1)).toContainText('PF22')
  await expect(right.getByRole('status').filter({
    hasText: 'PF22 を VVF 1.6-2C の経路 2 本とこれからの経路の線要素に入れました',
  })).toContainText('Ctrl+Z で戻せます')
  await expect(candidate).toHaveAttribute('data-decision', '必要')
  expect(await page.evaluate(() => window.__karu!.getCountFixtures()))
    .toEqual(beforeFixtures)

  // もう一方の経路にもPF22が入る。
  await page.getByRole('button', { name: '選択', exact: true }).click()
  await click(page, 136, 150)
  await expect(right.locator('.route-item')).toHaveCount(2)
  await expect(right.locator('.route-item').nth(1)).toContainText('PF22')

  // 判断の記録とは別に、経路への一括反映を一回のUndoで戻す。
  await page.keyboard.press('Control+z')
  await click(page, 136, 150)
  await expect(right.locator('.route-item')).toHaveCount(1)
  await click(page, 286, 260)
  await expect(right.locator('.route-item')).toHaveCount(1)
  expect(await page.evaluate(() => window.__karu!.getCountFixtures()))
    .toEqual(beforeFixtures)
})

test('関連未使用の文書では頂点の個数の選択肢をグループ化しない', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  const bytes = (() => {
    const doc = new mupdf.PDFDocument()
    const ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
    try {
      doc.insertPage(-1, ref)
      writeCountFixtures(doc, [
        ...fixtures,
        {
          id: 'fire', name: '防火区画貫通処理', code: 'FP', category: '防火区画貫通処理', order: 2,
          style: { ...style, color: [0, .5, 0] },
        },
      ])
      const buffer = doc.saveToBuffer('compress')
      try { return [...buffer.asUint8Array()] }
      finally { buffer.destroy() }
    } finally {
      ref.destroy()
      doc.destroy()
    }
  })()
  const relatedRuleRequests: string[] = []
  page.on('request', request => {
    if (/\/core\/related\/rules(?:\.ts|[.?/])/.test(request.url())) {
      relatedRuleRequests.push(request.url())
    }
  })

  await page.evaluate(value => window.__karu!.openBytes(value, '未使用.pdf'), bytes)
  await page.evaluate(() => window.__karu!.setZoom(1))
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await page.getByTestId('fixture-panel')
    .getByRole('button', { name: 'PF PF22', exact: true }).click()
  await click(page, 100, 220)
  const scale = page.getByRole('dialog', { name: '縮尺の設定（1 ページ）' })
  await scale.getByLabel('縮尺の分母').fill('100')
  await scale.getByRole('button', { name: '決定', exact: true }).click()
  await click(page, 100, 220)
  await click(page, 172, 220)
  await click(page, 172, 300)
  await page.keyboard.press('Enter')

  const right = page.getByTestId('format-panel')
  await right.getByRole('button', {
    name: '＋ 頂点に個数の項目を足す', exact: true,
  }).click()
  const select = right.getByLabel('頂点の個数1の項目', { exact: true })
  await expect(select).toHaveValue('fire')
  await expect(select.locator('optgroup')).toHaveCount(0)
  await expect(right.getByRole('group', { name: '関連の項目', exact: true })).toHaveCount(0)
  expect(relatedRuleRequests).toEqual([])
})
