import { test, expect, type Locator, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import {
  readCountFixtures,
  writeCountFixtures,
  type CountFixture,
} from '../src/core/countFixtures'
import { RELATED_RULES } from '../src/core/related/rules'
import scopes from '../src/core/takeoff/ruleScopes.data'
import type { WorkType } from '../src/core/related/types'

interface WallOrigin {
  fixture: CountFixture
  work: WorkType
  ruleId: string
}

function wallOrigin(): WallOrigin {
  for (const rule of RELATED_RULES) {
    if (rule.kind === 'note'
      || scopes.rules[rule.id]?.classId !== 'MARK'
      || !('any' in rule.origin)) continue

    for (const match of rule.origin.any) {
      if (match.subjects !== undefined
        || match.categories !== undefined && !match.categories.length
        || match.names !== undefined && !match.names.length
        || match.works !== undefined && !match.works.length) continue

      const name = match.names === undefined
        ? '軽量鉄骨壁下地'
        : match.names.find(value =>
          value.includes('壁') && !/建具|扉|窓/u.test(value))
      if (!name) continue

      return {
        fixture: {
          id: 't7-wall',
          code: '壁',
          name,
          category: match.categories?.[0] ?? 'その他',
          kind: 'area',
          method: 'lengthHeight',
          order: 0,
          style: {
            shape: 'circle',
            fill: 'none',
            color: [1, 0, 0],
            size: 10,
            opacity: 1,
            showCode: true,
          },
        },
        work: match.works?.find(
          (value): value is WorkType => value !== '未設定',
        ) ?? '更新・交換',
        ruleId: rule.id,
      }
    }
  }

  throw new Error('壁を起点にできるMARKの試験ルールがありません。')
}

function originalPdf(fixture: CountFixture): Buffer {
  const doc = new mupdf.PDFDocument()
  try {
    const resources = doc.newDictionary()
    try {
      // 240ptの線。縮尺1:100では8.466666...m。
      const page = doc.addPage(
        [0, 0, 300, 400],
        0,
        resources,
        '0 0 0 RG 1 w 20 200 m 260 200 l S',
      )
      try { doc.insertPage(-1, page) }
      finally { page.destroy() }
    } finally { resources.destroy() }

    writeCountFixtures(doc, [fixture])
    const buffer = doc.saveToBuffer('garbage=4')
    try { return Buffer.from(buffer.asUint8Array()) }
    finally { buffer.destroy() }
  } finally { doc.destroy() }
}

async function openPdf(page: Page, bytes: Buffer): Promise<void> {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0&perf=1')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(value =>
    window.__karu!.openBytes(value, 'related-mark.pdf'), [...bytes])

  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await expect(page.getByTestId('fixture-panel')).toBeVisible()
}

async function saveFixtures(page: Page): Promise<CountFixture[]> {
  const value = await page.evaluate(async () => {
    const api = (window as unknown as {
      __karu: {
        saveToBytes(): Promise<Uint8Array | ArrayBuffer | number[]>
      }
    }).__karu
    const bytes = await api.saveToBytes()
    return Array.from(
      bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes,
    )
  })

  const opened = mupdf.Document.openDocument(
    Buffer.from(value),
    'application/pdf',
  )
  try {
    const doc = opened.asPDF()
    if (!doc) throw new Error('保存結果がPDFではありません。')
    return readCountFixtures(doc)
  } finally { opened.destroy() }
}

/**
 * 既存UIの縮尺設定を使う。
 * 未提示のUI操作をこのhelperに集約する。
 */
async function setScale100(page: Page): Promise<void> {
  await page.getByRole('button', { name: /縮尺/u }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  await dialog.getByLabel(/縮尺/u).fill('100')
  await dialog.getByRole('button', {
    name: /^(適用|設定|OK)$/u,
  }).click()

  await expect(dialog).toBeHidden()
}

async function drawWall(
  page: Page,
  fixture: CountFixture,
): Promise<void> {
  const panel = page.getByTestId('fixture-panel')
  await panel.getByRole('button', {
    name: `${fixture.code} ${fixture.name}`,
    exact: true,
  }).click()

  const height = page.getByTestId('format-panel').getByLabel(/高さ/u).first()
  await height.fill('3.6')
  await height.press('Tab')

  const layer = page.getByTestId('annotation-layer-0')
  const bounds = await layer.boundingBox()
  if (!bounds) throw new Error('図面の表示範囲を取得できません。')

  const start = {
    x: bounds.x + bounds.width * 20 / 300,
    y: bounds.y + bounds.height / 2,
  }
  const end = {
    x: bounds.x + bounds.width * 260 / 300,
    y: bounds.y + bounds.height / 2,
  }

  await page.mouse.click(start.x, start.y)
  await page.mouse.dblclick(end.x, end.y)
  await page.keyboard.press('Escape')
}

async function confirmMarkAddition(page: Page): Promise<void> {
  // 拾い候補の「追加する」は既存の「標準マスタから追加」を検索語つきで開く（related-route と同じ操作）
  const master = page.getByRole('dialog', { name: '標準マスタから追加', exact: true })
  await expect(master).toBeVisible()
  await expect(master.getByRole('checkbox').first()).toBeVisible()
  await master.getByRole('checkbox').first().check()
  await master.getByRole('button', { name: /^選んだ項目を追加/u }).click()
  await expect(master).toBeHidden()
}

async function areaOf(row: Locator): Promise<number> {
  const text = await row.innerText()
  const matches = [...text.matchAll(/(-?[\d,]+(?:\.\d+)?)\s*(?:㎡|m²)/gu)]
  const last = matches[matches.length - 1]
  if (!last?.[1]) throw new Error(`面積表示を取得できません: ${text}`)
  return Number(last[1].replaceAll(',', ''))
}

test('壁の線＋高さから墨出しを追加すると線の長さ×帯幅1mになる', async ({ page }) => {
  const origin = wallOrigin()
  await openPdf(page, originalPdf(origin.fixture))
  // 数量の数値（線の長さ × 1m）は単体試験（fixtureLink.baseEdge・relatedLinkRules.store）で確かめる。ここでは付く連動を確かめる。
  await page.getByTestId('fixture-panel').getByRole('button', {
    name: `${origin.fixture.code} ${origin.fixture.name}`, exact: true,
  }).click()

  const format = page.getByTestId('format-panel')
  const originList = format.getByTestId('related-origin-list')
  if (!await originList.evaluate(element => element.hasAttribute('open'))) {
    await originList.locator(':scope > summary').click()
  }

  await page.getByLabel('関連提案の案件区分').selectOption('混在')
  await page.getByLabel('関連提案の品目作業').selectOption(origin.work)

  const card = originList.locator(
    `[data-testid="related-suggestion"][data-rule-ids~="${origin.ruleId}"]`,
  ).filter({ hasText: '墨出し' }).first()

  await expect(card).toBeVisible()
  await expect(card.getByText('拾う対象：', { exact: true })).toBeVisible()
  await expect(card.getByText('関連元との違い：', { exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: '拾い範囲に追加…' }))
    .toHaveCount(0)

  await card.getByRole('button', { name: '追加する', exact: true }).click()
  await confirmMarkAddition(page)

  const saved = await saveFixtures(page)
  // SPEC-T13: 元は押した起点と同じ名称の項目（自動の元）。撤去の項目は除く。
  const mark = saved.find(fixture =>
    fixture.id !== origin.fixture.id
    && fixture.link?.kind === 'shape'
    && (fixture.link.auto?.nameIncludes ?? []).includes(origin.fixture.name))

  expect(mark).toBeDefined()
  expect(mark?.link).toMatchObject({
    kind: 'shape',
    shape: {
      output: 'lengthTimesHeight',
      heightM: 1,
    },
    sources: [],
    auto: { nameIncludes: [origin.fixture.name], nameExcludes: ['撤去'] },
  })

  // 壁の面積を写す係数1の連動（factor）ではないこと
  expect(saved.some(fixture => fixture.link?.kind === 'factor'
    && (fixture.link.auto?.nameIncludes ?? []).includes(origin.fixture.name))).toBe(false)
})
