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
const rcPreview = (dialog: Locator) =>
  dialog.getByRole('region', { name: 'RC 部材の見本', exact: true })

// 縮尺1:100。PDFの1pt = 25.4/72mm。
const pointsForMeters = (meters: number) => meters * 1000 * 72 / (25.4 * 100)

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
  const dialog = page.getByRole('dialog', { name: '縮尺の設定（1 ページ）', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('縮尺の分母', { exact: true }).fill('100')
  await dialog.getByRole('button', { name: '決定', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

async function rectangle(
  page: Page,
  x = 100,
  y = 120,
  widthM = 4,
  heightM = 3,
) {
  const width = pointsForMeters(widthM)
  const height = pointsForMeters(heightM)
  await click(page, x, y)
  await click(page, x + width, y)
  await click(page, x + width, y + height)
  await click(page, x, y + height)
  await page.keyboard.press('Enter')
}

async function createSlab(page: Page) {
  const dialog = await addDialog(page, 'S1', '床板')
  await dialog.getByRole('radio', { name: '面積', exact: true }).check()
  await dialog.getByRole('radio', { name: '囲む', exact: true }).check()
  await openDetails(dialog, '.fixture-rc')
  await dialog.getByRole('checkbox', { name: 'RC 部材にする', exact: true }).check()

  const rc = dialog.locator('.fixture-rc')
  await expect(rc.getByLabel('部材の種類', { exact: true })).toHaveValue('slab')
  await expect(rc.locator('option[value="beam"]')).toHaveAttribute('disabled', '')
  await expect(rc.locator('option[value="column"]')).toHaveAttribute('disabled', '')

  await rc.getByLabel('厚さ（mm）', { exact: true }).fill('150')
  for (const [index, role] of ['x', 'y'].entries()) {
    const n = index + 1
    await rc.getByRole('button', { name: '＋ 鉄筋を足す', exact: true }).click()
    await rc.getByLabel(`鉄筋${n}の役割`, { exact: true }).selectOption(role)
    await rc.getByLabel(`鉄筋${n}の径`, { exact: true }).selectOption('D13')
    await rc.getByLabel(`鉄筋${n}の間隔（mm）`, { exact: true }).fill('200')
    await rc.getByLabel(`鉄筋${n}の段`, { exact: true }).selectOption('2')
  }

  await expect(rc).toContainText('既定値 35d・40d（要確認）')
  await expect(rcPreview(dialog)).toContainText('拾うと計算します')
  await saveDialog(dialog)

  await fixtureRow(page, 'S1', '床板').click()
  await setScale(page)
  await rectangle(page)
  await expect(total(page, 'S1', '床板')).toHaveText('12.00')
}

async function linkedDialog(
  page: Page,
  code: string,
  name: string,
  quantity: 'count' | 'length' | 'area' | 'volume',
  kind: 'factor' | 'rc' | 'shape',
) {
  const dialog = await addDialog(page, code, name)
  const labels = { count: '個数', length: '長さ', area: '面積', volume: '体積' }
  await dialog.getByRole('radio', { name: labels[quantity], exact: true }).check()
  await openDetails(dialog, '.fixture-link')
  await dialog.getByRole('checkbox', { name: '連動にする', exact: true }).check()
  const kinds = {
    factor: '係数で計算する',
    rc: 'RC 部材から（コンクリート・型枠・鉄筋）',
    shape: '形から（面積・周長・根切り など）',
  }
  await dialog.getByRole('radio', { name: kinds[kind], exact: true }).check()
  return dialog
}

async function createExcavation(page: Page) {
  const dialog = await linkedDialog(page, 'E1', '根切り', 'volume', 'shape')
  await dialog.getByLabel('形の出力', { exact: true }).selectOption('excavation')
  await expect(dialog.getByLabel('ゆとり幅（m）', { exact: true })).toHaveValue('0.5')
  await expect(dialog.getByLabel('余幅を手で入れる（m）', { exact: true })).toHaveValue('')
  await dialog.getByLabel('深さ（m）', { exact: true }).fill('2.0')
  await dialog.getByRole('checkbox', { name: 'S1 床板を元にする', exact: true }).check()
  await expect(linkPreview(dialog)).toContainText('合計 51.52')
  await saveDialog(dialog)
  await expect(total(page, 'E1', '根切り')).toHaveText('51.52')
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('karu-pdf:fixture-panel-settings-open', 'true')
  })
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, 'RC部材の試験.pdf'), blankPdf())
  await page.evaluate(() => window.__karu!.setZoom(1))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await expect(panel(page).getByRole('button', { name: '項目を追加', exact: true }))
    .toBeEnabled()
})

test('基礎スラブの鉄筋を摘要の径・規格で絞り、規格の編集で数量を更新する', async ({ page }) => {
  const source = await addDialog(page, 'S31', '基礎スラブ')
  await source.getByRole('radio', { name: '面積', exact: true }).check()
  await source.getByRole('radio', { name: '囲む', exact: true }).check()
  await openDetails(source, '.fixture-rc')
  await source.getByRole('checkbox', { name: 'RC 部材にする', exact: true }).check()
  const rc = source.locator('.fixture-rc')
  await rc.getByLabel('部材の種類', { exact: true }).selectOption('foundationSlab')
  await rc.getByLabel('厚さ（mm）', { exact: true }).fill('150')

  for (const [index, role] of ['x', 'y'].entries()) {
    const n = index + 1
    await rc.getByRole('button', { name: '＋ 鉄筋を足す', exact: true }).click()
    const grade = rc.getByLabel(`鉄筋${n}の規格`, { exact: true })
    if (n === 1) {
      await expect(grade).toHaveValue('')
      await expect(grade.locator('option'))
        .toHaveText(['—', 'SD295', 'SD345', 'SD390', 'SD490'])
      await grade.selectOption('SD295')
    } else {
      await expect(grade).toHaveValue('SD295')
      await rc.getByLabel(`鉄筋${n}の役割`, { exact: true }).selectOption('x')
    }
    await rc.getByLabel(`鉄筋${n}の役割`, { exact: true }).selectOption(role)
    await expect(grade).toHaveValue('SD295')
    await rc.getByLabel(`鉄筋${n}の径`, { exact: true }).selectOption('D13')
    await rc.getByLabel(`鉄筋${n}の間隔（mm）`, { exact: true }).fill('200')
    await rc.getByLabel(`鉄筋${n}の段`, { exact: true }).selectOption('2')
  }
  await saveDialog(source)
  await fixtureRow(page, 'S31', '基礎スラブ').click()
  await setScale(page)
  await rectangle(page)
  await expect(total(page, 'S31', '基礎スラブ')).toHaveText('12.00')

  for (const [code, size, expected] of [
    ['R10', 'D10', '0.00'],
    ['R13', 'D13', '0.35'],
  ] as const) {
    const dialog = await linkedDialog(page, code, '異形鉄筋', 'count', 'rc')
    await dialog.getByLabel('RC の出力', { exact: true }).selectOption('rebar')
    await dialog.getByRole('radio', { name: '所要数量（×1.04）', exact: true }).check()
    await dialog.getByRole('checkbox', {
      name: 'RC 部材を自動で元にする', exact: true,
    }).check()
    await openDetails(dialog, '.fixture-breakdown')
    for (const [index, label, value] of [
      [1, '規格', 'SD295'],
      [2, '径', size],
    ] as const) {
      await dialog.getByRole('button', { name: '摘要の区分を追加', exact: true }).click()
      await dialog.getByLabel(`摘要の区分名${index}`, { exact: true }).fill(label)
      await dialog.getByLabel(`摘要の値${index}`, { exact: true }).fill(value)
    }
    await expect(dialog.getByText(
      `径で絞る（どれも付けなければ摘要の径 ${size}。摘要にも無ければ全部）`,
      { exact: true },
    )).toBeVisible()
    await expect(dialog.getByText(
      '規格: 摘要の SD295 の鉄筋と、規格の指定が無い鉄筋を数えます',
      { exact: true },
    )).toBeVisible()
    await expect(dialog.getByRole('checkbox', {
      name: `RC の径 ${size}`, exact: true,
    })).not.toBeChecked()
    await expect(linkPreview(dialog)).toContainText(`合計 ${expected}`)
    if (size === 'D10') {
      await expect(linkPreview(dialog))
        .toContainText('この部材に D10 の鉄筋はありません')
    } else {
      await expect(linkPreview(dialog)).toContainText('SD295 D13 x方向')
      await expect(linkPreview(dialog)).toContainText('SD295 D13 y方向')
    }
    await saveDialog(dialog)
    await expect(total(page, code, '異形鉄筋')).toHaveText(expected)
  }

  const editor = await editDialog(page, 'S31', '基礎スラブ')
  const editedRc = editor.locator('.fixture-rc')
  await expect(rcPreview(editor).getByRole('rowheader', {
    name: 'SD295 D13', exact: true,
  })).toHaveCount(1)
  await editedRc.getByLabel('鉄筋1の規格', { exact: true }).selectOption('SD345')
  await expect(rcPreview(editor).getByRole('rowheader', {
    name: 'SD295 D13', exact: true,
  })).toHaveCount(1)
  await expect(rcPreview(editor).getByRole('rowheader', {
    name: 'SD345 D13', exact: true,
  })).toHaveCount(1)
  await editedRc.getByLabel('鉄筋2の規格', { exact: true }).selectOption('SD345')
  await saveDialog(editor, true)
  await expect(total(page, 'R10', '異形鉄筋')).toHaveText('0.00')
  await expect(total(page, 'R13', '異形鉄筋')).toHaveText('0.00')

  const reopened = await editDialog(page, 'S31', '基礎スラブ')
  await expect(reopened.getByLabel('鉄筋1の規格', { exact: true })).toHaveValue('SD345')
  await expect(reopened.getByLabel('鉄筋2の規格', { exact: true })).toHaveValue('SD345')
  await closeDialog(reopened)
})

test('床板のRC設定と4m×3mの拾いからコンクリート・型枠・鉄筋の見本を表示する', async ({ page }) => {
  await createSlab(page)
  const dialog = await editDialog(page, 'S1', '床板')
  const rc = dialog.locator('.fixture-rc')

  await expect(rc).toHaveAttribute('open', '')
  await expect(rc.getByLabel('厚さ（mm）', { exact: true })).toHaveValue('150')
  await expect(rc.getByLabel('鉄筋1の役割', { exact: true })).toHaveValue('x')
  await expect(rc.getByLabel('鉄筋2の役割', { exact: true })).toHaveValue('y')
  await expect(rc.getByLabel('鉄筋1の段', { exact: true })).toHaveValue('2')
  await expect(rc.getByLabel('鉄筋2の段', { exact: true })).toHaveValue('2')
  await expect(rcPreview(dialog)).toContainText('コンクリート 1.80 ㎥')
  await expect(rcPreview(dialog)).toContainText('型枠 12.00 ㎡')
  const d13 = rcPreview(dialog).getByRole('row').filter({
    has: dialog.page().getByRole('rowheader', { name: 'D13', exact: true }),
  })
  await expect(d13).toContainText(/340\.5\d/)
  await expect(d13).toContainText('0.339')
  await expect(rcPreview(dialog)).toContainText('ガス圧接 0 か所')
  await expect(rcPreview(dialog)).toContainText('重ね継手 37 か所')

  await rc.getByLabel('厚さ（mm）', { exact: true }).fill('')
  await dialog.getByRole('button', { name: '変更する', exact: true }).click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('alert').filter({
    hasText: 'RC部材の厚さを入れてください。',
  }).first()).toBeVisible()

  await rc.getByLabel('厚さ（mm）', { exact: true }).fill('150')
  await saveDialog(dialog, true)
})

test('RC部材を自動で元にして鉄筋の所要数量と設計数量を切り替える', async ({ page }) => {
  await createSlab(page)
  const dialog = await linkedDialog(page, 'R1', '鉄筋', 'count', 'rc')
  await expect(dialog.locator('.fixture-rc')).toHaveCount(0)
  await dialog.getByLabel('RC の出力', { exact: true }).selectOption('rebar')
  await dialog.getByRole('radio', { name: '所要数量（×1.04）', exact: true }).check()
  await dialog.getByRole('checkbox', { name: 'RC 部材を自動で元にする', exact: true }).check()
  await expect(dialog.getByRole('checkbox', { name: '床板を自動で元にする', exact: true }))
    .not.toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: 'RC の径 D13', exact: true }))
    .not.toBeChecked()
  await expect(linkPreview(dialog)).toContainText('合計 0.35')
  await expect(linkPreview(dialog)).toContainText('D13')
  await saveDialog(dialog)
  await expect(total(page, 'R1', '鉄筋')).toHaveText('0.35')
  await expect(fixtureLi(page, 'R1', '鉄筋').locator('.fixture-row-unit')).toHaveText('t')

  const editor = await editDialog(page, 'R1', '鉄筋')
  await editor.getByRole('radio', { name: '設計数量', exact: true }).check()
  await expect(linkPreview(editor)).toContainText('合計 0.34')

  await editor.getByRole('checkbox', { name: 'RC の径 D10', exact: true }).check()
  await expect(linkPreview(editor)).toContainText('合計 0.00')
  await editor.getByRole('checkbox', { name: 'RC の径 D10', exact: true }).uncheck()
  await expect(linkPreview(editor)).toContainText('合計 0.34')

  await editor.getByRole('checkbox', { name: '壁を自動で元にする', exact: true }).check()
  await expect(linkPreview(editor)).toContainText('合計 0.00')
  await editor.getByRole('checkbox', { name: '壁を自動で元にする', exact: true }).uncheck()
  await expect(linkPreview(editor)).toContainText('合計 0.34')
  await saveDialog(editor, true)
  await expect(total(page, 'R1', '鉄筋')).toHaveText('0.34')
})

test('形から根切りを計算し基準の余幅と手入力の余幅を切り替える', async ({ page }) => {
  await createSlab(page)
  await createExcavation(page)
  const dialog = await editDialog(page, 'E1', '根切り')
  await expect(dialog.getByLabel('深さ（m）', { exact: true })).toHaveValue('2')

  // (12 + 14×0.8 + 4×0.8²)×2 = 51.52。
  await expect(linkPreview(dialog)).toContainText('合計 51.52')
  await dialog.getByLabel('余幅を手で入れる（m）', { exact: true }).fill('0')
  await expect(linkPreview(dialog)).toContainText('合計 24.00')
  await dialog.getByLabel('余幅を手で入れる（m）', { exact: true }).fill('')
  await expect(linkPreview(dialog)).toContainText('合計 51.52')
  await saveDialog(dialog, true)
  await expect(total(page, 'E1', '根切り')).toHaveText('51.52')
})

test('建具の開口周長を係数にして3個分のシーリングを計算する', async ({ page }) => {
  const opening = await addDialog(page, 'W1', '建具')
  await opening.getByRole('radio', { name: '個数', exact: true }).check()
  await opening.getByLabel('開口幅（m）', { exact: true }).fill('1.8')
  await opening.getByLabel('開口高さ（m）', { exact: true }).fill('2.1')
  await saveDialog(opening)
  await fixtureRow(page, 'W1', '建具').click()
  await click(page, 100, 120)
  await click(page, 180, 120)
  await click(page, 260, 120)
  await expect(total(page, 'W1', '建具')).toHaveText('3')

  const dialog = await linkedDialog(page, 'C1', 'シーリング', 'length', 'factor')
  await dialog.getByRole('checkbox', { name: 'W1 建具を元にする', exact: true }).check()
  await dialog.getByLabel('W1の係数の元', { exact: true }).selectOption('openingPerimeter')
  await expect(dialog.getByLabel('W1の係数の元', { exact: true }).locator('option'))
    .toHaveText(['数値', '開口の面積', '開口の周長', '開口の幅'])
  await expect(linkPreview(dialog)).toContainText('合計 23.40')
  await saveDialog(dialog)
  await expect(total(page, 'C1', 'シーリング')).toHaveText('23.40')

  const editor = await editDialog(page, 'C1', 'シーリング')
  await expect(editor.getByLabel('W1の係数の元', { exact: true }))
    .toHaveValue('openingPerimeter')
  await expect(linkPreview(editor)).toContainText('合計 23.40')
  await closeDialog(editor)
})

test('根切りの連動数量から別の体積の拾いを引いて埋戻しを計算する', async ({ page }) => {
  await createSlab(page)
  await createExcavation(page)

  const volume = await addDialog(page, 'V1', '別の体積')
  await volume.getByRole('radio', { name: '体積', exact: true }).check()
  await volume.getByRole('radio', { name: '囲む×深さ', exact: true }).check()
  await volume.getByLabel('深さ（新しく拾うときの初期値）', { exact: true }).fill('1')
  await saveDialog(volume)
  await fixtureRow(page, 'V1', '別の体積').click()
  await rectangle(page, 270, 120)
  await expect(total(page, 'V1', '別の体積')).toHaveText('12.00')

  const dialog = await linkedDialog(page, 'B1', '埋戻し', 'volume', 'factor')
  await dialog.getByRole('checkbox', { name: 'E1 根切りを元にする', exact: true }).check()
  await dialog.getByRole('checkbox', { name: 'V1 別の体積を元にする', exact: true }).check()
  await expect(dialog.getByLabel('V1の係数の元', { exact: true }).locator('option'))
    .toHaveText(['数値'])
  await dialog.getByRole('checkbox', { name: 'V1を引き算にする', exact: true }).check()
  await expect(linkPreview(dialog)).toContainText('合計 39.52')
  await saveDialog(dialog)
  await expect(total(page, 'B1', '埋戻し')).toHaveText('39.52')

  const editor = await editDialog(page, 'B1', '埋戻し')
  await expect(editor.getByRole('checkbox', { name: 'V1を引き算にする', exact: true }))
    .toBeChecked()
  await editor.getByRole('checkbox', { name: 'V1を引き算にする', exact: true }).uncheck()
  await expect(linkPreview(editor)).toContainText('合計 63.52')
  await editor.getByRole('checkbox', { name: 'V1を引き算にする', exact: true }).check()
  await expect(linkPreview(editor)).toContainText('合計 39.52')
  await saveDialog(editor, true)
  await expect(total(page, 'B1', '埋戻し')).toHaveText('39.52')
})

test('鉄筋の設定は20件までに制限し部材に合う役割と段だけを設定できる', async ({ page }) => {
  const dialog = await addDialog(page, 'B2', '梁')
  await dialog.getByRole('radio', { name: '長さ', exact: true }).check()
  await openDetails(dialog, '.fixture-rc')
  await dialog.getByRole('checkbox', { name: 'RC 部材にする', exact: true }).check()
  const rc = dialog.locator('.fixture-rc')
  await expect(rc.getByLabel('部材の種類', { exact: true })).toHaveValue('beam')
  await expect(rc.locator('option[value="slab"]')).toHaveAttribute('disabled', '')
  await rc.getByLabel('幅 b（mm）', { exact: true }).fill('300')
  await rc.getByLabel('せい D（mm）', { exact: true }).fill('600')
  await rc.getByLabel('控除する床板の厚さ（mm）', { exact: true }).fill('150')

  const add = rc.getByRole('button', { name: '＋ 鉄筋を足す', exact: true })
  await add.click()
  await rc.getByLabel('鉄筋1の役割', { exact: true }).selectOption('top')
  await expect(rc.getByLabel('鉄筋1の本数', { exact: true })).toHaveValue('1')
  await rc.getByLabel('鉄筋1の段', { exact: true }).selectOption('2')
  await rc.getByLabel('鉄筋1の役割', { exact: true }).selectOption('stirrup')
  await expect(rc.getByLabel('鉄筋1の本数', { exact: true })).toHaveCount(0)
  await expect(rc.getByLabel('鉄筋1の間隔（mm）', { exact: true })).toHaveValue('200')
  await expect(rc.getByLabel('鉄筋1の段', { exact: true })).toHaveValue('1')
  await expect(rc.getByLabel('鉄筋1の段', { exact: true }).locator('option[value="2"]'))
    .toHaveAttribute('disabled', '')

  for (let i = 1; i < 20; i++) await add.click()
  await expect(rc.locator('.fixture-rc-bars tbody tr')).toHaveCount(20)
  await expect(add).toBeDisabled()
  await rc.getByRole('button', { name: '鉄筋20を外す', exact: true }).click()
  await expect(rc.locator('.fixture-rc-bars tbody tr')).toHaveCount(19)
  await expect(add).toBeEnabled()
  await saveDialog(dialog)

  const editor = await editDialog(page, 'B2', '梁')
  await expect(editor.locator('.fixture-rc-bars tbody tr')).toHaveCount(19)
  await closeDialog(editor)
})
