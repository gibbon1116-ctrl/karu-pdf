import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import {
  readCountFixtures,
  writeCountFixtures,
  type CountFixture,
} from '../src/core/countFixtures'
import { RELATED_RULES } from '../src/core/related/rules'

test.use({ serviceWorkers: 'block' })

function pdf(fixtures: CountFixture[] = []): number[] {
  const doc = new mupdf.PDFDocument()
  const ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
  try {
    doc.insertPage(-1, ref)
    if (fixtures.length) writeCountFixtures(doc, fixtures)
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] }
    finally { buffer.destroy() }
  } finally {
    ref.destroy()
    doc.destroy()
  }
}

function origin(name: string, category: string): CountFixture {
  return {
    id: 'r5-origin', name, category, code: 'R5', order: 0,
    style: {
      shape: 'circle', fill: 'none', color: [1, 0, 0],
      size: 10, opacity: 1, showCode: true,
    },
  }
}

async function open(page: Page, bytes: number[]) {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0&perf=1')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(value => window.__karu!.openBytes(value, 'R5a試験.pdf'), bytes)
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  const left = page.getByTestId('fixture-panel')
  await expect(left.getByRole('button', {
    name: '標準マスタから追加', exact: true,
  })).toBeEnabled()
  await expect(left.getByTestId('related-suggestions')).toHaveCount(0)
  return left
}

test('給水管を登録すると右の数量拾いに関連候補が出る', async ({ page }) => {
  const left = await open(page, pdf())
  await left.getByRole('button', { name: '標準マスタから追加', exact: true }).click()
  const master = page.getByRole('dialog', { name: '標準マスタから追加', exact: true })
  await master.getByLabel('標準マスタを検索', { exact: true }).fill('給水管')
  await expect(master.getByRole('checkbox').first()).toBeVisible()
  await master.getByRole('checkbox').first().check()
  await master.getByRole('button', { name: '選んだ項目を追加（1件）', exact: true }).click()
  await expect(master).toBeHidden()
  await expect(left.locator('.fixture-row')).toHaveCount(1)
  await expect(left.getByTestId('related-suggestions')).toHaveCount(0)
  const right = page.getByTestId('format-panel')
  await expect(right.getByRole('heading', { name: '数量拾い', exact: true })).toBeVisible()
  const related = right.getByTestId('related-suggestions')
  await expect(related.getByTestId('related-origin-list')).toHaveAttribute('open', '')
  await expect(related.locator(
    '[data-testid="related-suggestion"][data-related-kind="item"]',
  ).first()).toBeVisible()
})

test('check の追加は新規ダイアログを開き、保存後は元の候補に選択済みを付ける', async ({ page }) => {
  const rule = RELATED_RULES.find(value => value.id === 'E-016')
  expect(rule?.kind).toBe('check')
  expect(rule?.create).toBeDefined()
  if (!rule?.create || !('any' in rule.origin)) {
    throw new Error('E-016 の作成用ルールがありません')
  }
  const match = rule.origin.any.find(value => value.subjects === undefined)
  if (!match) throw new Error('E-016 の科目不要の起点がありません')
  const fixture = origin(match.names?.[0] ?? 'R5起点', match.categories?.[0] ?? '電線管')
  const left = await open(page, pdf([fixture]))
  await left.locator('.fixture-row').first().click()
  const related = page.getByTestId('format-panel').getByTestId('related-suggestions')
  await related.getByTestId('related-origin-list').locator(':scope > summary').click()
  await related.getByLabel('関連提案の案件区分', { exact: true }).selectOption('混在')
  if (match.works?.[0]) {
    await related.getByLabel('関連提案の品目作業', { exact: true })
      .selectOption(match.works[0])
  }
  const card = related.locator(
    '[data-testid="related-suggestion"][data-rule-ids~="E-016"]',
  ).first()
  const all = related.getByRole('button', { name: 'すべて見る', exact: true })
  // 候補が描かれてから「すべて見る」の有無を見る。
  await expect(related.locator('[data-testid="related-suggestion"][data-related-kind="item"]').first()).toBeVisible()
  if (await all.isVisible()) await all.click()
  await expect(card.getByRole('button', { name: '追加する', exact: true })).toBeVisible()

  // 左の数量パネルを閉じても右から開ける。
  await page.getByRole('tab', { name: '書き込み', exact: true }).click()
  await card.getByRole('button', { name: '追加する', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({
    has: page.getByLabel('名称', { exact: true }),
  })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('名称', { exact: true })).toHaveValue(rule.create.name)
  await dialog.getByRole('button', {
    name: /^(?:保存|追加|作成|保存する|追加する|項目を追加)$/,
  }).last().click()
  await expect(dialog).toBeHidden()

  const bytes = await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!])
  const saved = new mupdf.PDFDocument(new Uint8Array(bytes))
  try {
    const fixtures = readCountFixtures(saved)
    expect(fixtures).toHaveLength(2)
    expect(fixtures.find(value => value.name === rule.create!.name)?.category)
      .toBe(fixture.category)
  } finally {
    saved.destroy()
  }

  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await page.getByTestId('fixture-panel').getByRole('button', {
    name: `${fixture.code} ${fixture.name}`, exact: true,
  }).click()
  const returned = page.getByTestId('format-panel').getByTestId('related-suggestions')
  const registered = returned.locator(
    '[data-testid="related-suggestion"][data-rule-ids~="E-016"]',
  ).first()
  await expect(registered).toHaveAttribute('data-registered', 'true')
  await expect(registered.locator('h4')).toContainText('選択済み')
})

test('note は注意の中に名称と質問を出し、判断操作を出さない', async ({ page }) => {
  const rule = RELATED_RULES.find(value => value.kind === 'note'
    && 'any' in value.origin
    && value.origin.any.some(match => match.subjects === undefined
      && (match.categories === undefined || match.categories.length > 0)
      && (match.names === undefined || match.names.length > 0)
      && (match.works === undefined || match.works.length > 0)))
  if (!rule || !('any' in rule.origin)) throw new Error('注意の試験起点がありません')
  const match = rule.origin.any.find(value => value.subjects === undefined
    && (value.categories === undefined || value.categories.length > 0)
    && (value.names === undefined || value.names.length > 0)
    && (value.works === undefined || value.works.length > 0))!
  const fixture = origin(match.names?.[0] ?? '注意の起点', match.categories?.[0] ?? 'その他')
  const left = await open(page, pdf([fixture]))
  await left.locator('.fixture-row').first().click()
  const related = page.getByTestId('format-panel').getByTestId('related-suggestions')
  await related.getByTestId('related-origin-list').locator(':scope > summary').click()
  await related.getByLabel('関連提案の案件区分', { exact: true }).selectOption('混在')
  if (match.works?.[0]) {
    await related.getByLabel('関連提案の品目作業', { exact: true })
      .selectOption(match.works[0])
  }
  const summary = related.locator('summary').filter({ hasText: /^注意 \d+件$/ })
  await expect(summary).toBeVisible()
  await summary.click()
  const note = related.locator(
    `[data-testid="related-suggestion"][data-related-kind="note"][data-rule-ids~="${rule.id}"]`,
  )
  await expect(note).toBeVisible()
  await expect(note).toContainText(rule.targetText)
  if (rule.question) await expect(note).toContainText(rule.question)
  await expect(note.getByRole('button')).toHaveCount(0)
  await expect(note.getByRole('combobox')).toHaveCount(0)
  await expect(note.locator('fieldset')).toHaveCount(0)
})

test('構成要素で拾うとボックスを全印に追加し、取消では残り、Ctrl+Zで戻る', async ({ page }) => {
  const rule = RELATED_RULES.find(value => value.id === 'E-039')
  if (!rule || !('any' in rule.origin)) {
    throw new Error('E-039 の起点がありません')
  }
  const match = rule.origin.any.find(value => value.subjects === undefined)
  if (!match?.categories?.[0]) {
    throw new Error('E-039 の科目不要の起点分類がありません')
  }

  const fixture = origin(match.names?.[0] ?? 'コンセント', match.categories[0])
  const left = await open(page, pdf([fixture]))
  await left.locator('.fixture-row').first().click()
  const layer = page.getByTestId('annotation-layer-0')
  await layer.click({ position: { x: 100, y: 100 } })
  await layer.click({ position: { x: 180, y: 100 } })
  // 印を置いた後、一覧で項目を選び直して右の数量拾いにその項目を出す。
  await left.locator('.fixture-row').first().click()

  const right = page.getByTestId('format-panel')
  const related = right.getByTestId('related-suggestions')
  const originList = related.getByTestId('related-origin-list')
  if (await originList.getAttribute('open') === null) {
    await originList.locator(':scope > summary').click()
  }
  await related.getByLabel('関連提案の案件区分', { exact: true }).selectOption('混在')
  if (match.works?.[0]) {
    await related.getByLabel('関連提案の品目作業', { exact: true })
      .selectOption(match.works[0])
  }
  await expect(related.locator(
    '[data-testid="related-suggestion"][data-related-kind="item"]',
  ).first()).toBeVisible()
  const all = related.getByRole('button', { name: 'すべて見る', exact: true })
  if (await all.isVisible()) await all.click()

  const card = related.locator(
    '[data-testid="related-suggestion"][data-rule-ids~="E-039"]',
  ).first()
  await card.getByLabel('ほかの判断', { exact: true }).selectOption('構成要素で拾う')
  const select = card.getByLabel('構成要素にする品目', { exact: true })
  await expect(select).toBeVisible()
  const boxName = (await select.locator('option').first().textContent())?.trim()
  if (!boxName) throw new Error('ボックスの選択肢がありません')

  // 選択待ち・中止では項目も数量も増やさない。
  await expect(left.locator('.fixture-row')).toHaveCount(1)
  await card.getByRole('button', { name: 'やめる', exact: true }).click()
  await expect(select).toBeHidden()
  await expect(left.locator('.fixture-row')).toHaveCount(1)

  await card.getByLabel('ほかの判断', { exact: true }).selectOption('構成要素で拾う')
  await card.getByRole('button', { name: '構成要素に入れる', exact: true }).click()
  await expect(left.locator('.fixture-row')).toHaveCount(2)
  const boxRow = left.locator('.fixture-row').filter({ hasText: boxName })
  await expect(boxRow).toHaveCount(1)
  await expect(boxRow.getByText(/^2(?:\s*個)?$/)).toBeVisible()

  // 数量拾いの道具のままだと印が増えるので、選択の道具で印を選ぶ。
  await page.getByRole('button', { name: '選択', exact: true }).click()
  await layer.click({ position: { x: 100, y: 100 } })
  await expect(right.getByText('構成要素', { exact: true }).first()).toBeVisible()
  await expect(right.getByText(boxName, { exact: true }).first()).toBeVisible()
  await page.keyboard.press('Escape')
  await layer.click({ position: { x: 180, y: 100 } })
  await expect(right.getByText(boxName, { exact: true }).first()).toBeVisible()

  const decided = related.locator(
    '[data-testid="related-suggestion"][data-rule-ids~="E-039"]'
    + '[data-decision="構成要素で拾う"]',
  ).first()
  const summary = related.locator('summary').filter({ hasText: /^判断済み \d+件$/ }).first()
  await summary.click()
  await decided.getByRole('button', { name: '判断を取消', exact: true }).click()
  await expect(boxRow.getByText(/^2(?:\s*個)?$/)).toBeVisible()

  // 最初のUndoは判断の取消を戻す。次のUndoが構成要素追加を丸ごと戻す。
  await page.keyboard.press('Control+z')
  // Undo で印の選択が外れるので、一覧で起点の項目を選び直して右の表示を見る。
  await left.locator('.fixture-row').first().click()
  await expect(related.locator(
    '[data-testid="related-suggestion"][data-rule-ids~="E-039"]'
    + '[data-decision="構成要素で拾う"]',
  ).first()).toHaveCount(1)
  await page.keyboard.press('Control+z')
  await expect(left.locator('.fixture-row')).toHaveCount(1)
  await expect(right.getByText(boxName, { exact: true })).toHaveCount(0)

  const bytes = await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!])
  const saved = new mupdf.PDFDocument(new Uint8Array(bytes))
  try {
    expect(readCountFixtures(saved).map(value => value.id)).toEqual([fixture.id])
  } finally {
    saved.destroy()
  }

  await page.keyboard.press('Control+Shift+z')
  await expect(left.locator('.fixture-row')).toHaveCount(2)
  await expect(left.locator('.fixture-row').filter({ hasText: boxName })
    .getByText(/^2(?:\s*個)?$/)).toBeVisible()
})
