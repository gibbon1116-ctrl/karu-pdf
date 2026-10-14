import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import { readCountFixtures, writeCountFixtures, type CountFixture } from '../src/core/countFixtures'
import { RELATED_RULES } from '../src/core/related/rules'

test.use({ serviceWorkers: 'block' })

function blankPdf(): number[] {
  const doc = new mupdf.PDFDocument()
  const ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
  try {
    doc.insertPage(-1, ref)
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally {
    ref.destroy()
    doc.destroy()
  }
}

async function open(page: Page, bytes = blankPdf()) {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0&perf=1')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(value =>
    window.__karu!.openBytes(value, '関連品目試験.pdf'), bytes)
  await page.evaluate(() => window.__karu!.setZoom(1))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  const panel = page.getByTestId('fixture-panel')
  await expect(panel.getByRole('button', {
    name: '標準マスタから追加', exact: true,
  })).toBeEnabled()
  await expect(panel.getByText('数量拾いを読み込んでいます…', {
    exact: true,
  })).toHaveCount(0)
  return panel
}

async function tableContents(page: Page): Promise<string[]> {
  await page.getByTestId('fixture-panel').getByRole('button', {
    name: '集計表を開く', exact: true,
  }).click()
  // 集計表はダイアログではなく領域（e2e/quantity-table.annotate.spec.ts と同じ）
  const region = page.getByRole('region', { name: '数量の集計表', exact: true })
  await expect(region).toBeVisible()
  const contents = await region.getByRole('table').allTextContents()
  expect(contents.length).toBeGreaterThan(0)
  await region.getByRole('button', { name: '集計表を閉じる', exact: true }).click()
  await expect(region).toBeHidden()
  return contents
}

async function relatedCounts(page: Page) {
  // React の effect と、文書評価の setTimeout が動く機会を作る。
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setTimeout(resolve, 50)
    }))
  }))
  return page.evaluate(() => {
    const counters = window.__karuPerf!.get()
    return {
      origin: counters['related.suggest']?.count ?? 0,
      document: counters['related.suggest.document']?.count ?? 0,
    }
  })
}

test('既存項目の選択・検索だけでは照合せず、候補を開くか項目を登録すると照合する', async ({ page }) => {
  const seedPanel = await open(page)
  await seedPanel.getByRole('button', {
    name: '標準マスタから追加', exact: true,
  }).click()
  const seedMaster = page.getByRole('dialog', {
    name: '標準マスタから追加', exact: true,
  })
  await seedMaster.getByLabel('標準マスタを検索', { exact: true }).fill('コンセント')
  await expect(seedMaster.getByRole('checkbox').nth(1)).toBeVisible()
  await seedMaster.getByRole('checkbox').nth(0).check()
  await seedMaster.getByRole('checkbox').nth(1).check()
  await seedMaster.getByRole('button', {
    name: '選んだ項目を追加（2件）', exact: true,
  }).click()
  await expect(seedMaster).toBeHidden()
  await expect(seedPanel.locator('.fixture-row')).toHaveCount(2)
  const bytes = await page.evaluate(async () => [
    ...(await window.__karu!.saveToBytes())!,
  ])

  // 再読込で登録直後の起点と計数器をリセットし、既存項目だけの文書を試す。
  const panel = await open(page, bytes)
  await expect(panel.getByTestId('related-suggestions')).toHaveCount(0)
  await panel.locator('.fixture-row').first().click()
  const related = page.getByTestId('format-panel').getByTestId('related-suggestions')
  const originList = related.getByTestId('related-origin-list')
  await expect(related.getByLabel('関連提案の案件区分', {
    exact: true,
  })).toBeEnabled()
  await expect(originList.locator(':scope > summary'))
    .toHaveText('関連の候補（開くと確認します）')
  await expect(originList).not.toHaveAttribute('open', '')
  const before = await relatedCounts(page)
  expect(before).toEqual({ origin: 0, document: 0 })

  for (const index of [0, 1, 0, 1]) {
    const row = panel.locator('.fixture-row').nth(index)
    await row.click()
    await expect(row).toHaveAttribute('aria-pressed', 'true')
  }
  await panel.getByLabel('名称・略号で検索', { exact: true }).fill('コンセント')
  await panel.getByLabel('名称・略号で検索', { exact: true }).fill('')
  expect(await relatedCounts(page)).toEqual(before)

  await originList.locator(':scope > summary').click()
  await expect(originList).toHaveAttribute('open', '')
  await expect.poll(async () => (await relatedCounts(page)).origin)
    .toBeGreaterThan(before.origin)
  expect((await relatedCounts(page)).document).toBe(before.document)
  for (const index of [0, 1]) {
    await panel.locator('.fixture-row').nth(index).click()
    await expect.poll(async () => (await relatedCounts(page)).origin)
      .toBeGreaterThan(before.origin)
  }
  const afterOpen = await relatedCounts(page)

  await originList.getByRole('button', { name: '閉じる', exact: true }).click()
  await expect(originList.locator(':scope > summary'))
    .toHaveText('関連の候補（開くと確認します）')
  for (const index of [0, 1, 0]) {
    await panel.locator('.fixture-row').nth(index).click()
  }
  expect(await relatedCounts(page)).toEqual(afterOpen)

  // 親を開き直した後、未判断一覧を開く操作で文書全体を評価する。
  await originList.locator(':scope > summary').click()
  const beforeDocument = await relatedCounts(page)
  const documentList = related.getByTestId('related-review-document-list')
  await documentList.locator(':scope > summary').click()
  await expect(documentList).toHaveAttribute('open', '')
  await expect(related.getByTestId('related-review-summary'))
    .toHaveText(/^未判断一覧（未判断 \d+件・後で確認 \d+件）$/)
  expect((await relatedCounts(page)).origin).toBe(beforeDocument.origin)
  expect((await relatedCounts(page)).document).toBeGreaterThan(beforeDocument.document)
  await documentList.locator(':scope > summary').click()
  await expect(documentList).not.toHaveAttribute('open', '')
  await originList.getByRole('button', { name: '閉じる', exact: true }).click()
  const beforeAdd = await relatedCounts(page)

  await panel.getByRole('button', {
    name: '標準マスタから追加', exact: true,
  }).click()
  const master = page.getByRole('dialog', {
    name: '標準マスタから追加', exact: true,
  })
  await master.getByLabel('標準マスタを検索', { exact: true }).fill('スイッチ')
  await expect(master.getByRole('checkbox').first()).toBeVisible()
  await master.getByRole('checkbox').first().check()
  await master.getByRole('button', {
    name: '選んだ項目を追加（1件）', exact: true,
  }).click()
  await expect(master).toBeHidden()
  await expect(panel.locator('.fixture-row')).toHaveCount(3)
  await expect(originList).toHaveAttribute('open', '')
  await expect.poll(async () => (await relatedCounts(page)).origin)
    .toBeGreaterThan(beforeAdd.origin)
  expect((await relatedCounts(page)).document).toBe(beforeAdd.document)
})

test('関連候補の判断・マスタ検索で数量を変えず、保存後も数量を保つ', async ({ page }) => {
  const panel = await open(page)
  await panel.getByRole('button', {
    name: '標準マスタから追加', exact: true,
  }).click()
  const master = page.getByRole('dialog', {
    name: '標準マスタから追加', exact: true,
  })
  await master.getByLabel('標準マスタを検索', { exact: true }).fill('コンセント')
  await expect(master.getByRole('checkbox').first()).toBeVisible()
  await master.getByRole('checkbox').first().check()
  await master.getByRole('button', { name: '選んだ項目を追加（1件）', exact: true }).click()
  await expect(master).toBeHidden()

  await expect(panel.getByTestId('related-suggestions')).toHaveCount(0)
  const related = page.getByTestId('format-panel').getByTestId('related-suggestions')
  const candidates = related.locator(
    '[data-testid="related-suggestion"][data-related-kind="item"]:not([data-decision]):not([data-registered])',
  )
  await expect(related.getByText(/^関連の候補 \d+件$/)).toBeVisible()
  await expect(candidates.first()).toBeVisible()
  await expect.poll(() => page.evaluate(() =>
    window.__karuPerf!.get()['related.suggest']?.count ?? 0)).toBeGreaterThan(0)

  const evaluationsBeforeMark = await page.evaluate(() =>
    window.__karuPerf!.get()['related.suggest']?.count ?? 0)
  // 追加した項目を一覧で選び、数量拾いの道具にしてから印を1つ打つ（他の e2e と同じ手順）
  await panel.locator('.fixture-row-name').first().click()
  await expect(page.getByRole('button', { name: '数量拾い', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('annotation-layer-0').click({ position: { x: 100, y: 100 } })
  await expect(panel.locator('.fixture-total-button').first()).toHaveText('1')
  expect(await page.evaluate(() =>
    window.__karuPerf!.get()['related.suggest']?.count ?? 0))
    .toBe(evaluationsBeforeMark)

  const quantitiesBefore = await panel.locator('.fixture-total-button').allTextContents()
  const tableBefore = await tableContents(page)
  const fixtureNamesBefore = await panel.locator('.fixture-row-name').allTextContents()

  const first = candidates.first()
  const ruleIds = await first.getAttribute('data-rule-ids')
  const undecidedBefore = await candidates.count()
  await first.getByRole('button', { name: '不要', exact: true }).click()
  await expect(candidates).toHaveCount(undecidedBefore - 1)
  await expect(related.locator(
    `[data-rule-ids="${ruleIds}"][data-decision="不要"]`,
  )).toHaveCount(1)

  const adding = candidates.first()
  const query = await adding.getAttribute('data-master-query')
  expect(query).toBeTruthy()
  await adding.getByRole('button', { name: '追加する', exact: true }).click()
  await expect(master).toBeVisible()
  await expect(master.getByLabel('標準マスタを検索', { exact: true }))
    .toHaveValue(query!)
  await master.getByRole('button', { name: '閉じる', exact: true }).click()

  expect(await panel.locator('.fixture-total-button').allTextContents())
    .toEqual(quantitiesBefore)
  expect(await panel.locator('.fixture-row-name').allTextContents())
    .toEqual(fixtureNamesBefore)
  expect(await tableContents(page)).toEqual(tableBefore)

  // 保存は既存の e2e と同じく試験用の入口で行う（e2e/count-fixtures.annotate.spec.ts の savedFixtures）
  const bytes = await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!])
  expect(bytes.length).toBeGreaterThan(0)
  const saved = new mupdf.PDFDocument(new Uint8Array(bytes))
  try {
    const fixtures = readCountFixtures(saved)
    expect(fixtures).toHaveLength(fixtureNamesBefore.length)
    expect(fixtures.some(fixture => fixture.category === '配線器具')).toBe(true)
  } finally {
    saved.destroy()
  }

  const reopened = await open(page, bytes)
  expect(await reopened.locator('.fixture-row-name').allTextContents())
    .toEqual(fixtureNamesBefore)
  expect(await reopened.locator('.fixture-total-button').allTextContents())
    .toEqual(quantitiesBefore)
  expect(await tableContents(page)).toEqual(tableBefore)
})
