import { expect, test, type Locator, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import type { BreakdownPosition, CountFixture, FixturePreset } from '../src/core/countFixtures'
import {
  breakdownEntries,
  detailMasterEntries,
  presetsFromDetail,
  type BreakdownEntry,
} from '../src/core/breakdownMaster'
import { appendFixtures } from '../src/app/fixtureAppend'

const sourcePosition: BreakdownPosition = {
  book: '電気設備',
  section: '庁舎',
  subject: '電灯設備',
  middle: '電灯幹線',
  item: 'ケーブル',
}
const targetPosition: BreakdownPosition = {
  book: '電気設備',
  section: '屋外',
  subject: '構内配電線路',
  middle: '電力引込み',
  item: 'ケーブル',
}
const emptyPosition: BreakdownPosition = {
  book: '電気設備',
  section: '庁舎',
  subject: '動力設備',
  middle: '動力幹線',
  item: 'ケーブル',
}

const panel = (page: Page) => page.getByTestId('fixture-panel')
const row = (page: Page, id: string) =>
  panel(page).locator(`li[data-fixture-id="${id}"]`)
const rowButton = (page: Page, id: string) => row(page, id).locator('.fixture-row')
const positionKey = (position: BreakdownPosition) => JSON.stringify([
  position.book, position.section, position.subject, position.middle ?? '', position.item,
])
const positionLabel = (position: BreakdownPosition) =>
  [position.section, position.subject, position.middle, position.item].filter(Boolean).join(' › ')
const heading = (page: Page, position: BreakdownPosition) =>
  panel(page).locator(`.fixture-category[data-breakdown-heading=${JSON.stringify(positionKey(position))}]`)

function blankPdf(): number[] {
  const doc = new mupdf.PDFDocument()
  const ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
  try {
    doc.insertPage(-1, ref)
    const bytes = doc.saveToBuffer('compress')
    try { return [...bytes.asUint8Array()] } finally { bytes.destroy() }
  } finally {
    ref.destroy()
    doc.destroy()
  }
}

function masterEntry(position: BreakdownPosition): BreakdownEntry {
  const result = breakdownEntries(position.book).find(entry =>
    entry.section === position.section
    && entry.subject === position.subject
    && (entry.middle ?? '') === (position.middle ?? '')
    && entry.row.name === position.item
    && entry.row.separate === true,
  )
  if (!result) throw new Error(`標準マスタに位置がありません：${positionLabel(position)}`)
  return result
}

function cablePreset(position: BreakdownPosition): FixturePreset {
  const entry = masterEntry(position)
  for (const template of entry.details) {
    if (template.master === undefined) continue
    const choices = detailMasterEntries(template)
    const choice = choices.find(candidate => candidate.code === 'CV')
      ?? choices.find(candidate => candidate.code.startsWith('CV'))
      ?? choices[0]
    if (!choice) continue
    const presets = presetsFromDetail(entry, template, undefined, [choice])
    if (presets[0]) return presets[0]
  }
  throw new Error(`ケーブルの標準明細がありません：${positionLabel(position)}`)
}

function standardFixtures(): CountFixture[] {
  const fixtures = appendFixtures([], [
    cablePreset(sourcePosition),
    cablePreset(targetPosition),
  ])
  if (fixtures.length !== 2) throw new Error('標準マスタから2件を準備できませんでした')
  return fixtures.map((fixture, index) => ({
    ...fixture,
    id: index === 0 ? 'move-source' : 'move-target',
  }))
}

/**
 * Only test preparation/state inspection uses the mounted FixturePanel's session.
 * The supplied test API has no positioned-fixture setter, so this adapter locates
 * the existing session through React's fiber. User operations use the actual UI.
 */
async function panelFixtures(page: Page, seed?: CountFixture[]): Promise<CountFixture[]> {
  return page.evaluate(value => {
    type Store = {
      getCountFixtures: () => CountFixture[]
      setCountFixtures: (fixtures: CountFixture[]) => void
      selectFixture: (id: string | null) => void
    }
    type Fiber = {
      memoizedProps?: { session?: { annotationStore?: Store } }
      return?: Fiber | null
    }
    const element = document.querySelector('[data-testid="fixture-panel"]')
    if (!element) throw new Error('数量拾いのパネルがありません')
    const property = Object.keys(element).find(key => key.startsWith('__reactFiber$'))
    if (!property) throw new Error('試験用のセッション取得方法を現在のReactに合わせてください')
    let fiber = (element as unknown as Record<string, unknown>)[property] as Fiber | null | undefined
    while (fiber) {
      const store = fiber.memoizedProps?.session?.annotationStore
      if (store && typeof store.getCountFixtures === 'function'
        && typeof store.setCountFixtures === 'function') {
        if (value) {
          store.setCountFixtures(value)
          store.selectFixture(value[0]?.id ?? null)
        }
        return store.getCountFixtures()
      }
      fiber = fiber.return
    }
    throw new Error('FixturePanelのセッションを取得できませんでした')
  }, seed)
}

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 2200 })
  await page.addInitScript(() => {
    localStorage.setItem('karu-pdf:fixture-panel-settings-open', 'false')
  })
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '内訳書の移動試験.pdf'), blankPdf())
  await page.evaluate(() => window.__karu!.setZoom(1))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('button', { name: '数量拾い', exact: true }).click()
  await expect(panel(page).getByRole('button', { name: '標準マスタから追加', exact: true })).toBeEnabled()
  await panelFixtures(page, standardFixtures())
  await panel(page).getByLabel('内訳書の構成で表示', { exact: true }).check()
  await expect(panel(page).locator('.fixture-groups')).toHaveAttribute('data-grouping', 'breakdown')
  await expect(row(page, 'move-source')).toBeVisible()
  await expect(row(page, 'move-target')).toBeVisible()
}

async function expectPosition(page: Page, id: string, position: BreakdownPosition): Promise<void> {
  await expect.poll(async () => {
    const fixture = (await panelFixtures(page)).find(item => item.id === id)
    return fixture?.breakdown ? positionKey(fixture.breakdown) : null
  }).toBe(positionKey(position))
}

async function dragInside(source: Locator, target: Locator): Promise<void> {
  await source.scrollIntoViewIfNeeded()
  await target.scrollIntoViewIfNeeded()
  await source.dragTo(target, {
    sourcePosition: { x: 5, y: 10 },
    targetPosition: { x: 40, y: 10 },
  })
}

test('drags a cable across sections to a separate heading and restores it with one Undo', async ({ page }) => {
  await open(page)
  const destination = heading(page, targetPosition)
  await destination.locator('button[aria-expanded]').click()
  await expect(destination.locator('button[aria-expanded]')).toHaveAttribute('aria-expanded', 'false')
  await dragInside(row(page, 'move-source'), destination)
  await expectPosition(page, 'move-source', targetPosition)
  await expect(destination.locator('button[aria-expanded]')).toHaveAttribute('aria-expanded', 'true')
  await expect(destination.locator('..').locator('li')).toHaveCount(2)
  await expect(destination.locator('..').locator('li').last()).toHaveAttribute('data-fixture-id', 'move-source')
  await expect(row(page, 'move-source')).toHaveClass(/selected/)
  await expect(rowButton(page, 'move-source')).toBeFocused()
  await page.keyboard.press('Control+z')
  await expectPosition(page, 'move-source', sourcePosition)
  await expect(heading(page, sourcePosition).locator('..').locator('li'))
    .toHaveAttribute('data-fixture-id', 'move-source')
})

test('chooses an empty master position, reveals it and restores it with one Undo', async ({ page }) => {
  await open(page)
  await expect(heading(page, emptyPosition)).toHaveCount(0)
  await rowButton(page, 'move-source').click()
  await panel(page).getByRole('button', { name: '位置を移す…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '内訳書の位置を移す', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('radio', {
    name: `${positionLabel(sourcePosition)}（今の位置）`, exact: true,
  })).toBeDisabled()
  await expect(dialog.getByLabel('同じ別紙明細の項目をすべて移す', { exact: true })).not.toBeChecked()
  await expect(dialog.getByLabel('ほかの別紙明細も表示', { exact: true })).not.toBeChecked()

  await dialog.getByRole('textbox', { name: '移す先を検索' }).count()
  await dialog.getByLabel('移す先を検索', { exact: true }).fill('動力設備 動力幹線 ケーブル')
  await dialog.getByRole('radio', { name: positionLabel(emptyPosition), exact: true }).check()
  await dialog.getByRole('button', { name: '移す', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expectPosition(page, 'move-source', emptyPosition)
  await expect(heading(page, emptyPosition).locator('..').locator('li'))
    .toHaveAttribute('data-fixture-id', 'move-source')
  await expect(row(page, 'move-source')).toBeVisible()
  await expect(row(page, 'move-source')).toHaveClass(/selected/)
  await expect(rowButton(page, 'move-source')).toBeFocused()

  await page.keyboard.press('Control+z')
  await expectPosition(page, 'move-source', sourcePosition)
  await expect(heading(page, emptyPosition)).toHaveCount(0)
})

test('moves all peers together to an empty position with a single Undo', async ({ page }) => {
  await open(page)
  const fixtures = await panelFixtures(page)
  const source = fixtures.find(fixture => fixture.id === 'move-source')!
  const peer: CountFixture = {
    ...structuredClone(source),
    id: 'move-peer',
    // order は整数、名前は保存の上限（文字数）に収める。
    order: Math.max(...fixtures.map(fixture => fixture.order)) + 1,
    name: `${source.name.slice(0, 30)}別項目`,
  }
  await panelFixtures(page, [...fixtures, peer])
  await rowButton(page, 'move-source').click()
  await panel(page).getByRole('button', { name: '位置を移す…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '内訳書の位置を移す', exact: true })
  await dialog.getByLabel('移す先を検索', { exact: true }).fill('動力設備 動力幹線 ケーブル')
  await dialog.getByRole('radio', { name: positionLabel(emptyPosition), exact: true }).check()
  await dialog.getByLabel('同じ別紙明細の項目をすべて移す', { exact: true }).check()
  await dialog.getByRole('button', { name: '移す', exact: true }).click()
  await expectPosition(page, 'move-source', emptyPosition)
  await expectPosition(page, 'move-peer', emptyPosition)
  await expect(heading(page, emptyPosition).locator('..').locator('li'))
    .toHaveCount(2)
  await page.keyboard.press('Control+z')
  await expectPosition(page, 'move-source', sourcePosition)
  await expectPosition(page, 'move-peer', sourcePosition)
})

test('Delete confirms removal, cancellation preserves the fixture, and search input does not delete it', async ({ page }) => {
  await open(page)
  const source = (await panelFixtures(page)).find(fixture => fixture.id === 'move-source')!
  let accept = false
  let confirmations = 0
  page.on('dialog', async dialog => {
    expect(dialog.type()).toBe('confirm')
    expect(dialog.message()).toBe(`${source.name}を削除しますか？`)
    confirmations++
    if (accept) await dialog.accept()
    else await dialog.dismiss()
  })

  await rowButton(page, 'move-source').click()
  await rowButton(page, 'move-source').press('Delete')
  await expect.poll(() => confirmations).toBe(1)
  await expect(row(page, 'move-source')).toBeVisible()
  expect((await panelFixtures(page)).some(fixture => fixture.id === 'move-source')).toBe(true)

  const search = panel(page).getByLabel('名称・略号で検索', { exact: true })
  await search.fill(source.name)
  await search.press('Delete')
  expect(confirmations).toBe(1)
  expect((await panelFixtures(page)).some(fixture => fixture.id === 'move-source')).toBe(true)
  await search.fill('')

  accept = true
  await rowButton(page, 'move-source').click()
  await rowButton(page, 'move-source').press('Delete')
  await expect.poll(() => confirmations).toBe(2)
  await expect(row(page, 'move-source')).toHaveCount(0)
  expect((await panelFixtures(page)).some(fixture => fixture.id === 'move-source')).toBe(false)
  await expect(row(page, 'move-target')).toHaveClass(/selected/)
  await expect(rowButton(page, 'move-target')).toBeFocused()
})

test('Delete in an edit dialog leaves fixtures intact', async ({ page }) => {
  await open(page)
  const before = await panelFixtures(page)
  let confirmations = 0
  page.on('dialog', async dialog => {
    confirmations++
    await dialog.dismiss()
  })
  await rowButton(page, 'move-source').click()
  await panel(page).getByRole('button', { name: '編集', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を編集', exact: true })
  await dialog.getByLabel('名称', { exact: true }).press('Delete')
  expect(confirmations).toBe(0)
  expect(await panelFixtures(page)).toEqual(before)
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
})
