import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import { FIXTURE_PRESETS, fixtureCode, readCountFixtures } from '../src/core/countFixtures'
import { listAnnotations } from '../src/core/annotations'

test.use({ serviceWorkers: 'block' })

function blankPdf() {
  const doc = new mupdf.PDFDocument(), ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
  try {
    doc.insertPage(-1, ref)
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { ref.destroy(); doc.destroy() }
}
async function open(page: Page) {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '標準マスタ試験.pdf'), blankPdf())
  await page.evaluate(() => window.__karu!.setZoom(1))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await expect(page.getByTestId('fixture-panel').getByRole('button', { name: '標準マスタから追加', exact: true })).toBeEnabled()
  await expect(page.getByTestId('fixture-panel').getByText('数量拾いを読み込んでいます…', { exact: true })).toHaveCount(0)
}
async function masterDialog(page: Page) {
  await page.getByRole('button', { name: '標準マスタから追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '標準マスタから追加', exact: true })
  await expect(dialog.getByRole('tab', { name: '規格から選ぶ', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByLabel('標準マスタを検索', { exact: true })).toBeFocused()
  await expect(dialog.getByRole('checkbox').first()).toBeVisible()
  return dialog
}
async function pfType(page: Page) {
  const dialog = page.getByRole('dialog', { name: '標準マスタから追加', exact: true })
  await dialog.getByLabel('標準マスタを検索', { exact: true }).fill('')
  await dialog.getByRole('group', { name: '標準マスタの分野', exact: true }).getByRole('button', { name: '電気設備', exact: true }).click()
  await dialog.getByRole('group', { name: '標準マスタの分類', exact: true }).getByRole('button', { name: '電線管', exact: true }).click()
  await dialog.getByRole('group', { name: '標準マスタの種類', exact: true }).getByRole('button', { name: 'PF（6件）', exact: true }).click()
  return dialog
}
async function clickPoint(page: Page, x: number, y: number) {
  const point = await page.getByTestId('annotation-layer-0').evaluate((el, p) => {
    const svg = el as SVGSVGElement, rect = svg.getBoundingClientRect()
    return { x: rect.left + p.x * rect.width / svg.viewBox.baseVal.width, y: rect.top + p.y * rect.height / svg.viewBox.baseVal.height }
  }, { x, y })
  await page.mouse.click(point.x, point.y)
}
const emName = 'EM-CE 60sq-3C 600V架橋ポリエチレン絶縁耐燃性ポリエチレンシースケーブル'
const cvName = 'CV 60sq-3C 600V架橋ポリエチレン絶縁ビニルシースケーブル'
const pfName = (code: string) => `${code} 合成樹脂製可とう電線管（PF管）`

async function addCVAndEdit(page: Page) {
  await open(page)
  const master = await masterDialog(page)
  await master.getByLabel('標準マスタを検索', { exact: true }).fill('CV 60sq-3C')
  await master.getByRole('checkbox', { name: `${cvName}（長さ・m）`, exact: true }).check()
  await master.getByRole('button', { name: '選んだ項目を追加（1件）', exact: true }).click()
  const panel = page.getByTestId('fixture-panel')
  await panel.getByRole('button', { name: cvName, exact: true }).click()
  await panel.getByRole('button', { name: '管理', exact: true }).click()
  await panel.getByRole('button', { name: '編集', exact: true }).click()
  return page.getByRole('dialog', { name: '項目を編集', exact: true })
}

test('CV candidates start unset and support validation, add, rename, delete, reorder and explicit standard refill', async ({ page }) => {
  let editor = await addCVAndEdit(page)
  const section = editor.locator('.fixture-conditions')
  await expect(section.locator('li')).toHaveCount(8)
  await expect(editor.getByLabel('施工条件の候補1', { exact: true })).toHaveValue('管内配線')
  for (const part of ['平面', '立上り・立下り', 'その他の加算']) await expect(editor.getByLabel(part + 'の既定', { exact: true })).toHaveValue('unset')
  await editor.getByLabel('追加する施工条件', { exact: true }).fill(' 前後空白 ')
  await section.getByRole('button', { name: '追加', exact: true }).click()
  await expect(section.getByRole('alert')).toContainText('前後の空白')
  await editor.getByLabel('追加する施工条件', { exact: true }).fill('特殊配線')
  await section.getByRole('button', { name: '追加', exact: true }).click()
  await expect(section.locator('li')).toHaveCount(9)
  const custom = section.locator('li').last()
  await custom.getByRole('textbox').fill('指定配線')
  await custom.getByRole('button', { name: '名前の変更', exact: true }).click()
  await custom.getByRole('button', { name: '上へ', exact: true }).click()
  await expect(editor.getByLabel('施工条件の候補8', { exact: true })).toHaveValue('指定配線')
  await section.locator('li').nth(7).getByRole('button', { name: '下へ', exact: true }).click()
  await expect(editor.getByLabel('施工条件の候補9', { exact: true })).toHaveValue('指定配線')
  await section.locator('li').first().getByRole('button', { name: '削除', exact: true }).click()
  await section.getByRole('button', { name: '標準の候補を入れる', exact: true }).click()
  await expect(editor.getByLabel('施工条件の候補9', { exact: true })).toHaveValue('管内配線')
  await section.getByRole('button', { name: '標準の候補を入れる', exact: true }).click()
  await expect(section.locator('li')).toHaveCount(9)
  await editor.getByRole('button', { name: '変更する', exact: true }).click()
  await page.getByTestId('fixture-panel').getByRole('button', { name: '編集', exact: true }).click()
  editor = page.getByRole('dialog', { name: '項目を編集', exact: true })
  await expect(editor.getByLabel('施工条件の候補8', { exact: true })).toHaveValue('指定配線')
  await expect(editor.getByLabel('平面の既定', { exact: true })).toHaveValue('unset')
})

test('new CV routes use the user-selected defaults for each part and persist them', async ({ page }) => {
  const editor = await addCVAndEdit(page)
  for (const part of ['平面', '立上り・立下り', 'その他の加算']) await editor.getByLabel(part + 'の既定', { exact: true }).selectOption('condition:ケーブルラック配線')
  await editor.getByRole('button', { name: '変更する', exact: true }).click()
  await page.getByRole('button', { name: '数量拾い', exact: true }).click()
  await clickPoint(page, 100, 220)
  const scale = page.getByRole('dialog', { name: '縮尺の設定（1 ページ）', exact: true })
  await scale.getByLabel('縮尺の分母').fill('100')
  await scale.getByRole('button', { name: '決定', exact: true }).click()
  await clickPoint(page, 100, 220); await clickPoint(page, 172, 220); await page.keyboard.press('Enter')
  await expect(page.locator('.measurement-shape')).toHaveCount(1)
  const bytes = await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!])
  const doc = new mupdf.PDFDocument(new Uint8Array(bytes))
  try {
    const expected = { plan: 'ケーブルラック配線', rise: 'ケーブルラック配線', slack: 'ケーブルラック配線' }
    expect(readCountFixtures(doc)[0].routeDefaults).toEqual(expected)
    expect(listAnnotations(doc, 0).find(a => a.quantity)?.quantity?.cond).toEqual(expected)
  } finally { doc.destroy() }
})

test('selects only requested specs, undoes one batch, draws PF22 and persists four items', async ({ page }) => {
  await open(page)
  let dialog = await masterDialog(page)
  await dialog.getByLabel('標準マスタを検索', { exact: true }).fill('60')
  const em = dialog.getByRole('checkbox', { name: `${emName}（長さ・m）`, exact: true })
  const cv = dialog.getByRole('checkbox', { name: `${cvName}（長さ・m）`, exact: true })
  await expect(em).toBeVisible(); await expect(cv).toBeVisible()
  await em.check(); await cv.check()
  await dialog.getByRole('button', { name: '選んだ項目を追加（2件）', exact: true }).click()
  const panel = page.getByTestId('fixture-panel'), rows = panel.locator('li[data-fixture-id]')
  await expect(rows).toHaveCount(2)
  const cableCategory = panel.locator('.fixture-groups > section').filter({ has: page.getByRole('button', { name: 'ケーブル（低圧）（2）', exact: true }) })
  await expect(cableCategory.getByRole('button', { name: emName, exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: emName, exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: cvName, exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(panel.getByText('2件を追加しました', { exact: true })).toBeVisible()
  await page.keyboard.press('Control+z'); await expect(rows).toHaveCount(0)
  await page.keyboard.press('Control+y'); await expect(rows).toHaveCount(2)

  await masterDialog(page); dialog = await pfType(page)
  await dialog.getByRole('checkbox', { name: /^PF16 / }).check()
  await dialog.getByRole('checkbox', { name: /^PF22 / }).check()
  await dialog.getByRole('button', { name: '選んだ項目を追加（2件）', exact: true }).click()
  await expect(rows).toHaveCount(4)
  await expect(panel.getByRole('button', { name: pfName('PF16'), exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(panel.getByRole('button', { name: pfName('PF22'), exact: true })).toBeVisible()

  await masterDialog(page); dialog = await pfType(page)
  const added = dialog.getByRole('checkbox', { name: /^PF16 .*追加済み/ })
  await expect(added).toBeChecked(); await expect(added).toBeDisabled()
  await expect(dialog.getByRole('button', { name: '選んだ項目を追加（0件）', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click()

  await panel.getByRole('button', { name: pfName('PF22'), exact: true }).click()
  await page.getByRole('button', { name: '数量拾い', exact: true }).click()
  await clickPoint(page, 100, 220)
  const scale = page.getByRole('dialog', { name: '縮尺の設定（1 ページ）', exact: true })
  await scale.getByLabel('縮尺の分母').fill('100')
  await scale.getByRole('button', { name: '決定', exact: true }).click()
  await clickPoint(page, 100, 220); await clickPoint(page, 172, 220); await page.keyboard.press('Enter')
  await expect(page.locator('.measurement-shape .measurement-label')).toHaveText('PF22 2.54 m')
  await expect(panel.locator('.fixture-count-summary')).toContainText('全図面: 2.54 m')

  const saved = await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!])
  const doc = new mupdf.PDFDocument(new Uint8Array(saved))
  try {
    const fixtures = readCountFixtures(doc)
    expect(fixtures).toHaveLength(4)
    expect(fixtures.map(fixtureCode)).toEqual(['CV 60sq-3C', 'EM-CE 60sq-3C', 'PF16', 'PF22'])
    expect(fixtures.every(f => !('key' in f || 'field' in f || 'type' in f || 'search' in f))).toBe(true)
    const root = doc.getTrailer().get('Root'), value = root.get('KaruCountFixtures')
    try {
      const raw = JSON.parse(value.asString()) as { fixtures: Record<string, unknown>[] }
      expect(raw.fixtures).toHaveLength(4)
      expect(raw.fixtures.every(f => !('key' in f || 'field' in f || 'type' in f || 'search' in f))).toBe(true)
    } finally { value.destroy(); root.destroy() }
  } finally { doc.destroy() }
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '標準マスタ再読込.pdf'), saved)
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await expect(rows).toHaveCount(4)
  await panel.getByRole('button', { name: pfName('PF22'), exact: true }).click()
  await expect(panel.locator('.fixture-count-summary')).toContainText('全図面: 2.54 m')
})

test('retains checked specs across searches, hierarchy and tabs, rendering at most 200 search results', async ({ page }) => {
  await open(page)
  let dialog = await masterDialog(page)
  await expect(dialog.getByRole('group', { name: '標準マスタの分野' }).getByRole('button', { name: '電気設備', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.getByRole('checkbox')).toHaveCount(14)
  await expect(dialog.getByRole('checkbox', { name: /^IV 1.6mm / })).not.toBeChecked()
  await dialog.getByRole('checkbox', { name: /^IV 1.6mm / }).check()
  dialog = await pfType(page)
  await dialog.getByRole('button', { name: 'すべて選ぶ', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '選んだ項目を追加（7件）', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: '選択を解除', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '選んだ項目を追加（1件）', exact: true })).toBeEnabled()
  await dialog.getByRole('checkbox', { name: /^PF22 / }).check()
  const search = dialog.getByLabel('標準マスタを検索', { exact: true })
  await search.fill('設備')
  await expect(dialog.getByRole('checkbox')).toHaveCount(200)
  await expect(dialog.getByText(/ほか \d+ 件。言葉を足して絞り込んでください/)).toBeVisible()
  await search.fill('pf22'); await expect(dialog.getByRole('checkbox')).toHaveCount(1)
  await expect(dialog.getByRole('checkbox')).toBeChecked()
  await search.fill('存在しない規格'); await expect(dialog.getByRole('checkbox')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: '選んだ項目を追加（2件）', exact: true })).toBeEnabled()
  await dialog.getByRole('tab', { name: '分野の一式', exact: true }).click()
  await dialog.getByRole('tab', { name: '規格から選ぶ', exact: true }).click()
  await expect(search).toBeFocused()
  await search.fill('iv 1.6mm'); await expect(dialog.getByRole('checkbox', { name: /^IV / })).toBeChecked()
  await dialog.getByRole('button', { name: '選んだ項目を追加（2件）', exact: true }).click()
  await expect(page.getByTestId('fixture-panel').locator('li[data-fixture-id]')).toHaveCount(2)
})

test('keeps the existing all-selected field bundles and imports exactly the legacy items', async ({ page }) => {
  await open(page)
  const dialog = await masterDialog(page)
  await dialog.getByRole('tab', { name: '分野の一式', exact: true }).click()
  await expect(dialog.getByRole('checkbox')).toHaveCount(FIXTURE_PRESETS['電気設備'].length)
  expect(await dialog.getByRole('checkbox').evaluateAll(inputs => inputs.every(input => (input as HTMLInputElement).checked))).toBe(true)
  await dialog.getByLabel('見本の分野', { exact: true }).selectOption('仮設・土工')
  await expect(dialog.getByRole('checkbox')).toHaveCount(8)
  await dialog.getByRole('button', { name: '選んだ項目を追加', exact: true }).click()
  const panel = page.getByTestId('fixture-panel')
  await expect(panel.locator('li[data-fixture-id]')).toHaveCount(8)
  const saved = await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!])
  const doc = new mupdf.PDFDocument(new Uint8Array(saved))
  try {
    expect(readCountFixtures(doc).map(({ category, code, name, kind, method, defaults }) => ({ category, code, name, kind, method, defaults }))).toEqual(
      FIXTURE_PRESETS['仮設・土工'].map(({ category, code, name, kind, method, defaults }) => ({ category, code, name, kind, method, defaults })))
  } finally { doc.destroy() }
})

test('loads the master JS only when its spec dialog is opened', async ({ page }) => {
  const requests: string[] = [], bodies: Array<{ url: string; text: string }> = [], reads: Promise<void>[] = []
  page.on('request', request => { if (request.resourceType() === 'script') requests.push(request.url()) })
  page.on('response', response => {
    if (response.request().resourceType() === 'script') reads.push(response.text().then(text => { bodies.push({ url: response.url(), text }) }))
  })
  await open(page)
  await page.waitForLoadState('networkidle'); await Promise.all(reads)
  expect(bodies.filter(body => body.text.includes('EM-CEE-S'))).toHaveLength(0)
  const before = requests.length
  await masterDialog(page)
  await page.waitForLoadState('networkidle'); await Promise.all(reads)
  const masterResponses = bodies.filter(body => body.text.includes('EM-CEE-S'))
  expect(masterResponses).toHaveLength(1)
  expect(requests.slice(before)).toContain(masterResponses[0].url)
  expect(requests.length).toBeGreaterThan(before)
})

test('stacks field, category, type and specs on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page)
  const dialog = await masterDialog(page)
  const boxes = await dialog.locator('.quantity-master-navigation, .quantity-master-specs').evaluateAll(elements => elements.map(el => {
    const rect = el.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom, left: rect.left }
  }))
  expect(boxes).toHaveLength(4)
  for (let i = 1; i < boxes.length; i++) { expect(boxes[i].top).toBeGreaterThanOrEqual(boxes[i - 1].bottom); expect(boxes[i].left).toBe(boxes[0].left) }
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
})
