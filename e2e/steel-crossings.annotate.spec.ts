import { expect, test, type Locator, type Page } from '@playwright/test'
import mupdf from 'mupdf'

const panel = (page: Page) => page.getByTestId('fixture-panel')
const fixtureRow = (page: Page, code: string, name: string) =>
  panel(page).getByRole('button', { name: `${code} ${name}`, exact: true })
const fixtureLi = (page: Page, code: string, name: string) =>
  fixtureRow(page, code, name).locator('..')
const total = (page: Page, code: string, name: string) =>
  fixtureLi(page, code, name).locator('.fixture-total-button')
const linkPreview = (dialog: Locator) =>
  dialog.getByRole('region', { name: '連動の見本', exact: true })
const steelPreview = (dialog: Locator) =>
  dialog.getByRole('region', { name: '鉄骨の部材の見本', exact: true })

// 縮尺1:100。PDFの1pt = 25.4/72mm。
const pointsForMeters = (meters: number) =>
  meters * 1000 * 72 / (25.4 * 100)

function blankPdf() {
  const doc = new mupdf.PDFDocument()
  try {
    const ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
    try { doc.insertPage(-1, ref) } finally { ref.destroy() }
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { doc.destroy() }
}

async function click(page: Page, x: number, y: number) {
  const layer = page.getByTestId('annotation-layer-0')
  const position = await layer.evaluate((element, value) => {
    const svg = element as SVGSVGElement
    const rect = svg.getBoundingClientRect()
    return {
      x: value.x * rect.width / svg.viewBox.baseVal.width,
      y: value.y * rect.height / svg.viewBox.baseVal.height,
    }
  }, { x, y })
  await layer.click({ position })
}

async function openDetails(dialog: Locator, selector: string) {
  const details = dialog.locator(selector)
  if (!await details.evaluate(element => (element as HTMLDetailsElement).open)) {
    await details.locator('summary').click()
  }
}

async function addDialog(page: Page, code: string, name: string) {
  await panel(page).getByRole('button', { name: '項目を追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('略号', { exact: true }).fill(code)
  await dialog.getByLabel('規格', { exact: true }).fill('')
  await dialog.getByLabel('名称', { exact: true }).fill(name)
  return dialog
}

async function saveDialog(dialog: Locator, editing = false) {
  await dialog.getByRole('button', {
    name: editing ? '変更する' : '追加する', exact: true,
  }).click()
  await expect(dialog).toHaveCount(0)
}

async function editDialog(page: Page, code: string, name: string) {
  await fixtureRow(page, code, name).click()
  await panel(page).getByRole('button', { name: '編集', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を編集', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

async function closeDialog(dialog: Locator) {
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

async function setScale(page: Page) {
  await click(page, 60, 80)
  const dialog = page.getByRole('dialog', {
    name: '縮尺の設定（1 ページ）', exact: true,
  })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('縮尺の分母', { exact: true }).fill('100')
  await dialog.getByRole('button', { name: '決定', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

async function polyline(page: Page, points: Array<[number, number]>) {
  for (const [x, y] of points) await click(page, x, y)
  await page.keyboard.press('Enter')
}

async function createBeam(page: Page) {
  const dialog = await addDialog(page, 'G1', '梁')
  await dialog.getByRole('radio', { name: '長さ', exact: true }).check()
  await openDetails(dialog, '.fixture-steel')
  await dialog.getByRole('checkbox', {
    name: '鉄骨の部材にする', exact: true,
  }).check()
  await expect(dialog.locator('.fixture-rc')).toHaveCount(0)
  await dialog.getByLabel('断面', { exact: true })
    .selectOption('H-400×200×8×13')
  await expect(dialog.getByLabel('部材の長さ（mm）', { exact: true }))
    .toHaveCount(0)
  await expect(steelPreview(dialog)).toContainText('拾うと計算します')
  await saveDialog(dialog)

  await fixtureRow(page, 'G1', '梁').click()
  await setScale(page)
  await polyline(page, [[70, 120], [70 + pointsForMeters(12), 120]])
  await expect(total(page, 'G1', '梁')).toHaveText('12.00')
}

async function createColumn(page: Page) {
  const dialog = await addDialog(page, 'C1', '柱')
  await dialog.getByRole('radio', { name: '個数', exact: true }).check()
  await openDetails(dialog, '.fixture-steel')
  await dialog.getByRole('checkbox', {
    name: '鉄骨の部材にする', exact: true,
  }).check()
  await dialog.getByLabel('断面', { exact: true })
    .selectOption('H-300×300×10×15')
  await dialog.getByLabel('部材の長さ（mm）', { exact: true }).fill('3500')
  await saveDialog(dialog)

  await fixtureRow(page, 'C1', '柱').click()
  await click(page, 110, 220)
  await click(page, 190, 220)
  await expect(total(page, 'C1', '柱')).toHaveText('2')
}

async function linkedDialog(
  page: Page,
  code: string,
  name: string,
  kind: 'crossing' | 'steel',
) {
  const dialog = await addDialog(page, code, name)
  await openDetails(dialog, '.fixture-link')
  await dialog.getByRole('checkbox', { name: '連動にする', exact: true }).check()
  await dialog.getByRole('radio', {
    name: kind === 'crossing'
      ? '交差から（防火区画貫通・スリーブ など）'
      : '鉄骨の部材から（質量・塗装・耐火被覆）',
    exact: true,
  }).check()
  await expect(dialog.locator('.fixture-steel')).toHaveCount(0)
  await expect(dialog.locator('.fixture-rc')).toHaveCount(0)
  return dialog
}

async function createCrossingPickups(page: Page) {
  const barrier = await addDialog(page, '区画', '防火区画')
  await barrier.getByRole('radio', { name: '長さ', exact: true }).check()
  await saveDialog(barrier)
  await fixtureRow(page, '区画', '防火区画').click()
  await setScale(page)
  await polyline(page, [[240, 100], [240, 380]])

  const pipe = await addDialog(page, '配管', '配管')
  await pipe.getByRole('radio', { name: '長さ', exact: true }).check()
  await saveDialog(pipe)
  await fixtureRow(page, '配管', '配管').click()
  // 垂直な区画の線と、y=180・y=300でそれぞれ1回交わる。
  await polyline(page, [
    [140, 180], [340, 180], [340, 300], [140, 300],
  ])
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('karu-pdf:fixture-panel-settings-open', 'true')
  })
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(
    bytes => window.__karu!.openBytes(bytes, '鉄骨・交差の試験.pdf'),
    blankPdf(),
  )
  await page.evaluate(() => window.__karu!.setZoom(1))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await expect(panel(page).getByRole('button', {
    name: '項目を追加', exact: true,
  })).toBeEnabled()
})

test('12mの梁の断面を保存し質量・所要数量・表面積の見本を表示する', async ({ page }) => {
  await createBeam(page)
  const dialog = await editDialog(page, 'G1', '梁')

  await expect(dialog.locator('.fixture-steel')).toHaveAttribute('open', '')
  await expect(dialog.getByLabel('断面', { exact: true }))
    .toHaveValue('H-400×200×8×13')
  await expect(steelPreview(dialog)).toContainText('長さ 12.00 m')
  await expect(steelPreview(dialog)).toContainText('質量 0.785 t')
  await expect(steelPreview(dialog)).toContainText('所要 0.824 t')
  await expect(steelPreview(dialog)).toContainText('表面積 19.01 ㎡')
  // 箱は2(H+B)×長さ。梁の上面を除くboxBeamとは区別する。
  await expect(steelPreview(dialog)).toContainText('箱 14.40 ㎡')
  await closeDialog(dialog)
})

test('3500mmの柱を2個拾い質量0.651tを表示する', async ({ page }) => {
  await createColumn(page)
  const dialog = await editDialog(page, 'C1', '柱')

  await expect(dialog.locator('.fixture-steel')).toHaveAttribute('open', '')
  await expect(dialog.getByLabel('断面', { exact: true }))
    .toHaveValue('H-300×300×10×15')
  await expect(dialog.getByLabel('部材の長さ（mm）', { exact: true }))
    .toHaveValue('3500')
  await expect(steelPreview(dialog)).toContainText('長さ 7.00 m')
  await expect(steelPreview(dialog)).toContainText('質量 0.651 t')
  await expect(steelPreview(dialog)).toContainText('所要 0.684 t')

  await dialog.getByLabel('部材の長さ（mm）', { exact: true }).fill('')
  await dialog.getByRole('button', { name: '変更する', exact: true }).click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('alert').filter({
    hasText: '個数で拾う鉄骨部材には部材の長さ（mm）を入れてください。',
  }).first()).toBeVisible()

  await dialog.getByLabel('部材の長さ（mm）', { exact: true }).fill('3500')
  await saveDialog(dialog, true)
})

test('鉄骨の部材を自動で元にして所要質量と塗装・耐火被覆を計算する', async ({ page }) => {
  await createBeam(page)
  await createColumn(page)
  const dialog = await linkedDialog(page, '形鋼', '形鋼', 'steel')

  await dialog.getByLabel('鉄骨の出力', { exact: true }).selectOption('mass')
  await dialog.getByRole('radio', {
    name: '所要数量（×1.05）', exact: true,
  }).check()
  await dialog.getByRole('checkbox', {
    name: '鉄骨の部材を自動で元にする', exact: true,
  }).check()
  await expect(linkPreview(dialog)).toContainText('合計 1.51 t')
  await saveDialog(dialog)
  await expect(total(page, '形鋼', '形鋼')).toHaveText('1.51')
  await expect(fixtureLi(page, '形鋼', '形鋼').locator('.fixture-row-unit'))
    .toHaveText('t')

  const editor = await editDialog(page, '形鋼', '形鋼')
  await expect(editor.getByRole('checkbox', {
    name: '鉄骨の部材を自動で元にする', exact: true,
  })).toBeChecked()
  await editor.getByRole('radio', { name: '設計数量', exact: true }).check()
  await expect(linkPreview(editor)).toContainText('合計 1.44 t')

  await editor.getByLabel('鉄骨の出力', { exact: true }).selectOption('paint')
  await expect(editor.getByLabel('表面の種類', { exact: true }))
    .toHaveValue('contour')
  // 梁19.008㎡ + 柱12.46㎡。
  await expect(linkPreview(editor)).toContainText('合計 31.47 ㎡')
  await editor.getByLabel('表面の種類', { exact: true }).selectOption('box')
  await expect(linkPreview(editor)).toContainText('合計 22.80 ㎡')

  await editor.getByLabel('鉄骨の出力', { exact: true }).selectOption('fireproof')
  await editor.getByLabel('表面の種類', { exact: true }).selectOption('boxBeam')
  await expect(linkPreview(editor)).toContainText('合計 18.30 ㎡')

  // 自動の元を手動でも選ぶと、その行の引き算・係数が優先される。
  await editor.getByRole('checkbox', {
    name: 'C1 柱を元にする', exact: true,
  }).check()
  await editor.getByRole('checkbox', {
    name: 'C1を引き算にする', exact: true,
  }).check()
  await editor.getByLabel('C1の係数', { exact: true }).fill('0.5')
  await expect(linkPreview(editor)).toContainText('合計 8.85 ㎡')
  await saveDialog(editor, true)
  await expect(total(page, '形鋼', '形鋼')).toHaveText('8.85')
  await expect(fixtureLi(page, '形鋼', '形鋼').locator('.fixture-row-unit'))
    .toHaveText('㎡')
})

test('名称で区画を選び配管の平面交差を2か所数える', async ({ page }) => {
  await createCrossingPickups(page)
  const dialog = await linkedDialog(page, '貫通', '貫通', 'crossing')

  await expect(dialog.getByRole('checkbox', {
    name: '平面で区画の線との交差を数える', exact: true,
  })).toBeChecked()
  await dialog.getByRole('checkbox', {
    name: '配管 配管を元にする', exact: true,
  }).check()
  await expect(dialog.getByRole('checkbox', {
    name: '配管を区画にする', exact: true,
  })).toHaveCount(0)
  await expect(dialog.getByRole('checkbox', {
    name: '貫通を区画にする', exact: true,
  })).toHaveCount(0)

  await dialog.getByLabel('区画の名称に含む語', { exact: true }).fill('防火区画')
  await expect(dialog.locator('.fixture-link-crossing'))
    .toContainText('区画の拾い 1 本')
  await expect(linkPreview(dialog)).toContainText('合計 2 か所')
  await saveDialog(dialog)
  await expect(total(page, '貫通', '貫通')).toHaveText('2')
  await expect(fixtureLi(page, '貫通', '貫通').locator('.fixture-row-unit'))
    .toHaveText('か所')

  const editor = await editDialog(page, '貫通', '貫通')
  await expect(editor.getByLabel('区画の名称に含む語', { exact: true }))
    .toHaveValue('防火区画')
  await expect(linkPreview(editor)).toContainText('合計 2 か所')

  // 名称指定を外し、項目IDのチェックでも同じ区画を選べる。
  await editor.getByLabel('区画の名称に含む語', { exact: true }).fill('')
  await expect(editor.locator('.fixture-link-crossing'))
    .toContainText('区画の項目がありません')
  await expect(linkPreview(editor)).toContainText('合計 0 か所')
  await editor.getByRole('checkbox', {
    name: '区画を区画にする', exact: true,
  }).check()
  await expect(linkPreview(editor)).toContainText('合計 2 か所')

  await editor.getByRole('checkbox', {
    name: '平面で区画の線との交差を数える', exact: true,
  }).uncheck()
  await expect(linkPreview(editor)).toContainText('合計 0 か所')
  await editor.getByRole('checkbox', {
    name: '平面で区画の線との交差を数える', exact: true,
  }).check()

  await editor.getByLabel('配管の係数', { exact: true }).fill('2')
  await expect(linkPreview(editor)).toContainText('合計 4 か所')
  await editor.getByRole('checkbox', {
    name: '配管を引き算にする', exact: true,
  }).check()
  await expect(linkPreview(editor)).toContainText('合計 0 か所')
  await editor.getByRole('checkbox', {
    name: '配管を引き算にする', exact: true,
  }).uncheck()
  await editor.getByLabel('配管の係数', { exact: true }).fill('1')
  await saveDialog(editor, true)
  await expect(total(page, '貫通', '貫通')).toHaveText('2')
})

test('自由な断面の単位質量が空なら計算部の検査文を表示して保存を止める', async ({ page }) => {
  const dialog = await addDialog(page, '自由', '自由な断面')
  await dialog.getByRole('radio', { name: '長さ', exact: true }).check()
  await openDetails(dialog, '.fixture-steel')
  await dialog.getByRole('checkbox', {
    name: '鉄骨の部材にする', exact: true,
  }).check()
  await dialog.getByLabel('断面', { exact: true }).selectOption('')
  await dialog.getByLabel('断面の名前', { exact: true }).fill('□-200×200×9')
  await dialog.getByLabel('単位質量（kg/m）', { exact: true }).fill('')
  await dialog.getByLabel('表面積（㎡/m）', { exact: true }).fill('0.8')
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()

  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('alert').filter({
    hasText: '表にない鉄骨断面には単位質量と単位表面積を設定してください。',
  }).first()).toBeVisible()
  await expect(fixtureRow(page, '自由', '自由な断面')).toHaveCount(0)

  await dialog.getByLabel('単位質量（kg/m）', { exact: true }).fill('54')
  await saveDialog(dialog)

  const editor = await editDialog(page, '自由', '自由な断面')
  await expect(editor.getByLabel('断面', { exact: true })).toHaveValue('')
  await expect(editor.getByLabel('断面の名前', { exact: true }))
    .toHaveValue('□-200×200×9')
  await expect(editor.getByLabel('単位質量（kg/m）', { exact: true }))
    .toHaveValue('54')
  await expect(editor.getByLabel('表面積（㎡/m）', { exact: true }))
    .toHaveValue('0.8')
  await closeDialog(editor)
})

test('RC部材と鉄骨の部材の欄を排他的に表示する', async ({ page }) => {
  const dialog = await addDialog(page, '切替', '部材の切替')
  await dialog.getByRole('radio', { name: '長さ', exact: true }).check()
  await openDetails(dialog, '.fixture-steel')
  await dialog.getByRole('checkbox', {
    name: '鉄骨の部材にする', exact: true,
  }).check()
  await expect(dialog.locator('.fixture-rc')).toHaveCount(0)

  await dialog.getByRole('checkbox', {
    name: '鉄骨の部材にする', exact: true,
  }).uncheck()
  await openDetails(dialog, '.fixture-rc')
  await dialog.getByRole('checkbox', {
    name: 'RC 部材にする', exact: true,
  }).check()
  await expect(dialog.locator('.fixture-steel')).toHaveCount(0)

  await dialog.getByRole('checkbox', {
    name: 'RC 部材にする', exact: true,
  }).uncheck()
  await openDetails(dialog, '.fixture-steel')
  await dialog.getByRole('checkbox', {
    name: '鉄骨の部材にする', exact: true,
  }).check()
  await openDetails(dialog, '.fixture-link')
  await dialog.getByRole('checkbox', {
    name: '連動にする', exact: true,
  }).check()
  await expect(dialog.locator('.fixture-steel')).toHaveCount(0)
  await expect(dialog.locator('.fixture-rc')).toHaveCount(0)
  await expect(dialog.getByRole('status').filter({
    hasText: '鉄骨部材を外しました',
  })).toBeVisible()
  await closeDialog(dialog)
})
