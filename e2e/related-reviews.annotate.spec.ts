import { test, expect, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import { RELATED_RULES } from '../src/core/related/rules'
import type { CountFixture } from '../src/core/countFixtures'
import { readCountFixtures, writeCountFixtures } from '../src/core/countFixtures'
import {
  readRelatedReviews,
  type RelatedReviews,
} from '../src/core/related/reviews'
import type { WorkType } from '../src/core/related/types'

/*
 * 接続契約:
 * - 既存 e2e の baseURL で '/' を開ける。
 * - PDF 入力は input[type="file"]。
 * - 数量パネルの入口は名前「数量拾い」の tab または button。
 * - 文書タブは role="tab"、アクセシブル名にファイル名を含む。
 * - __karu.saveToBytes() は Uint8Array / ArrayBuffer / number[] を返す。
 * 既存ハーネスの契約が異なる場合、下の openPdf / documentTab / saveBytes のみ合わせる。
 */

function testOrigin(): { fixture: CountFixture; work: WorkType; ruleId: string } {
  for (const rule of RELATED_RULES) {
    if (rule.kind === 'note' || !('any' in rule.origin)) continue
    for (const match of rule.origin.any) {
      if (match.subjects !== undefined
        || match.categories !== undefined && !match.categories.length
        || match.names !== undefined && !match.names.length
        || match.works !== undefined && !match.works.length) continue
      return {
        fixture: {
          id: 'r2-origin', code: 'R2',
          name: match.names?.[0] ?? 'R2試験起点',
          category: match.categories?.[0] ?? 'その他',
          order: 0,
          style: {
            shape: 'circle', fill: 'none', color: [1, 0, 0],
            size: 10, opacity: 1, showCode: true,
          },
        },
        work: match.works?.find((value): value is WorkType => value !== '未設定') ?? '更新・交換',
        ruleId: rule.id,
      }
    }
  }
  throw new Error('科目の指定を必要としない試験起点のルールがありません。')
}

function originalPdf(fixture?: CountFixture): Buffer {
  const doc = new mupdf.PDFDocument()
  try {
    const resources = doc.newDictionary()
    try {
      const page = doc.addPage([0, 0, 300, 400], 0, resources, '')
      try { doc.insertPage(-1, page) }
      finally { page.destroy() }
    } finally { resources.destroy() }
    if (fixture) writeCountFixtures(doc, [fixture])
    const buffer = doc.saveToBuffer('garbage=4')
    try { return Buffer.from(buffer.asUint8Array()) }
    finally { buffer.destroy() }
  } finally { doc.destroy() }
}

async function openPdf(page: Page, bytes: Buffer, name = 'related.pdf'): Promise<void> {
  // 既存 e2e と同じ試験用の入口（?test=1 の window.__karu.openBytes）で開く
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0&perf=1')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(([value, fileName]) =>
    window.__karu!.openBytes(value as number[], fileName as string), [[...bytes], name] as const)
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  const panel = page.getByTestId('fixture-panel')
  await expect(panel).toBeVisible()
  await expect(panel.getByTestId('related-suggestions')).toHaveCount(0)
  await panel.locator('.fixture-row').first().click()
  await expect(page.getByTestId('format-panel').getByTestId('related-suggestions'))
    .toBeVisible()
  // 関連の機能を使う前（判断なし・案件区分なし）は件数を数えない（SPEC-R2b）
  await expect(page.getByTestId('related-review-summary'))
    .toHaveText(/未判断 \d+件・後で確認 \d+件|未判断一覧（開くと確認します）/)
}

/** 文書の未保存の状態（タブの ● と同じ値）を試験用の入口で読む */
async function tabMark(page: Page): Promise<string> {
  const tabs = await page.evaluate(() => window.__karu!.listTabs())
  const tab = tabs.find(item => item.name === 'related.pdf')
  expect(tab).toBeDefined()
  return JSON.stringify({ dirty: tab!.dirty })
}

async function saveBytes(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(async () => {
    const api = (window as unknown as {
      __karu: {
        saveToBytes(): Promise<Uint8Array | ArrayBuffer | number[]>
      }
    }).__karu
    const value = await api.saveToBytes()
    return Array.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value)
  })
  return Buffer.from(bytes)
}

function inspect(bytes: Buffer): {
  reviews: RelatedReviews
  fixtures: CountFixture[]
  hasReviewsKey: boolean
} {
  const opened = mupdf.Document.openDocument(bytes, 'application/pdf')
  try {
    const doc = opened.asPDF()
    if (!doc) throw new Error('保存した文書が PDF ではありません。')
    const trailer = doc.getTrailer(), root = trailer.get('Root')
    let hasReviewsKey = false
    try {
      const value = root.get('KaruRelatedReviews')
      try { hasReviewsKey = value.isString() }
      finally { value.destroy() }
    } finally { root.destroy(); trailer.destroy() }
    return {
      reviews: readRelatedReviews(doc),
      fixtures: readCountFixtures(doc),
      hasReviewsKey,
    }
  } finally { opened.destroy() }
}

test('判断・案件区分・品目作業の保存、再読込、未保存表示と Ctrl+Z', async ({ page }) => {
  const origin = testOrigin()
  await openPdf(page, originalPdf(origin.fixture))
  const cleanTab = await tabMark(page)
  await page.getByTestId('fixture-panel')
    .getByRole('button', { name: `${origin.fixture.code} ${origin.fixture.name}`, exact: true })
    .click()

  const originList = page.getByTestId('format-panel').getByTestId('related-origin-list')
  if (!await originList.evaluate(element => element.hasAttribute('open'))) {
    await originList.locator(':scope > summary').click()
  }
  await page.getByLabel('関連提案の案件区分').selectOption('混在')
  await page.getByLabel('関連提案の品目作業').selectOption(origin.work)
  await expect.poll(() => tabMark(page)).not.toBe(cleanTab)

  const documentList = page.getByTestId('related-review-document-list')
  await documentList.locator(':scope > summary').click()
  const candidate = documentList.getByTestId('related-suggestion')
    .filter({ has: page.locator(`[data-rule-ids~="${origin.ruleId}"]`) })

  // data-rule-ids は article 自身にあるので、その属性で選ぶ。
  const card = documentList.locator(
    `[data-testid="related-suggestion"][data-rule-ids~="${origin.ruleId}"]`,
  ).first()
  await expect(card).toBeVisible()
  const key = await card.getAttribute('data-related-key')
  if (!key) throw new Error('候補の key がありません。')
  await card.getByRole('button', { name: '後で確認', exact: true }).click()
  await expect(documentList.getByTestId('related-suggestion')
    .filter({ hasText: '判断：後で確認' }).first()).toBeVisible()

  // フォームのブラウザ Undo ではなく、文書の Undo にキーを届ける。
  await page.getByTestId('fixture-panel').getByRole('heading', {
    name: '数量拾い', exact: true,
  }).click()
  await page.keyboard.press('Control+z')
  await expect(documentList.locator(
    `[data-testid="related-suggestion"][data-rule-ids~="${origin.ruleId}"]`,
  ).first()).not.toHaveAttribute('data-decision', '後で確認')

  const restoredCard = documentList.locator(
    `[data-testid="related-suggestion"][data-rule-ids~="${origin.ruleId}"]`,
  ).first()
  await restoredCard.getByRole('button', { name: '後で確認', exact: true }).click()
  const saved = await saveBytes(page)
  // 試験用の saveToBytes は文書を書き換えるが、ファイルへ書くまで未保存（fileOutdated）のまま。
  // 未保存の印が消えることは save-state の e2e（実際の保存）で確認済みの経路のため、ここでは保存内容だけを確かめる。
  const data = inspect(saved)
  expect(data.reviews.projectMode).toBe('混在')
  expect(data.reviews.works[origin.fixture.id]).toBe(origin.work)
  expect(data.reviews.decisions[key]).toMatchObject({
    decision: '後で確認',
    originFixtureIds: [origin.fixture.id],
  })
  expect(data.reviews.decisions[key].ruleIds).toContain(origin.ruleId)
  expect(data.fixtures).toEqual([origin.fixture])

  await openPdf(page, saved)
  await expect(page.getByLabel('関連提案の案件区分')).toHaveValue('混在')
  await page.getByTestId('fixture-panel')
    .getByRole('button', { name: `${origin.fixture.code} ${origin.fixture.name}`, exact: true })
    .click()
  await expect(page.getByLabel('関連提案の品目作業')).toHaveValue(origin.work)
  const reopenedList = page.getByTestId('related-review-document-list')
  await reopenedList.locator(':scope > summary').click()
  await expect(reopenedList.locator(
    `[data-testid="related-suggestion"][data-rule-ids~="${origin.ruleId}"]`,
  ).first()).toHaveAttribute('data-decision', '後で確認')

  // 判断変更と取消も保存内容に反映する。
  const reopenedCard = reopenedList.locator(
    `[data-testid="related-suggestion"][data-rule-ids~="${origin.ruleId}"]`,
  ).first()
  await reopenedCard.getByLabel('関連候補の判断を変更').selectOption('不要')
  await reopenedList.getByText(/判断済み \d+件/).click()
  await reopenedList.locator(
    `[data-testid="related-suggestion"][data-rule-ids~="${origin.ruleId}"]`,
  ).first().getByRole('button', { name: '判断を取消', exact: true }).click()
  expect(inspect(await saveBytes(page)).reviews.decisions[key]).toBeUndefined()

  // 上の操作で使わない補助 locator が型検査の未使用扱いにならないようにする。
  void candidate
})

test('KaruRelatedReviews のない既存 PDF は、関連データを作らず開いて保存できる', async ({ page }) => {
  const origin = testOrigin()
  const bytes = originalPdf(origin.fixture)
  const before = inspect(bytes)
  expect(before.hasReviewsKey).toBe(false)
  await openPdf(page, bytes)
  await expect(page.getByLabel('関連提案の案件区分')).toHaveValue('')
  const saved = inspect(await saveBytes(page))
  expect(saved.hasReviewsKey).toBe(false)
  expect(saved.reviews).toEqual({ version: 1, works: {}, decisions: {} })
  expect(saved.fixtures).toEqual(before.fixtures)
})
