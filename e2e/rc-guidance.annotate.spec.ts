import { expect, test, type Locator, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import { fixtureCode, type CountFixture } from '../src/core/countFixtures'

test.use({ serviceWorkers: 'block' })

const panel = (page: Page) => page.getByTestId('fixture-panel')
const fixtureRow = (page: Page, fixture: CountFixture) =>
  panel(page).getByRole('button', {
    name: `${fixtureCode(fixture)} ${fixture.name}`.trim(), exact: true,
  })
const fixtureLi = (page: Page, fixture: CountFixture) =>
  fixtureRow(page, fixture).locator('..')
const total = (page: Page, fixture: CountFixture) =>
  fixtureLi(page, fixture).locator('.fixture-total-button')

const concreteName = '普通コンクリート（軸部）'
const rebarName = '異形鉄筋'
const concreteGuidance =
  '配筋を入れると、異形鉄筋・型枠・ガス圧接などの連動の項目に数量が出ます。'
const missingGuidance =
  '元になる RC 部材の項目がありません。コンクリートなどの項目を開いて「RC 部材」で配筋を入れてください。'

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

async function closeDialog(dialog: Locator) {
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

async function editDialog(page: Page, fixture: CountFixture) {
  await fixtureRow(page, fixture).click()
  await panel(page).getByRole('button', { name: '編集', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を編集', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('名称', { exact: true })).toHaveValue(fixture.name)
  return dialog
}

async function breakdownDialog(page: Page) {
  await panel(page).getByRole('button', {
    name: '標準マスタから追加', exact: true,
  }).click()
  const dialog = page.getByRole('dialog', {
    name: '標準マスタから追加', exact: true,
  })
  await dialog.getByRole('tab', { name: '内訳書から選ぶ', exact: true }).click()
  await expect(dialog.getByRole('group', { name: '内訳書の編', exact: true })
    .getByRole('button', { name: '建築', exact: true })).toBeEnabled()
  return dialog
}

async function buildingGroup(dialog: Locator, subject: string) {
  await dialog.getByLabel('内訳書を検索', { exact: true }).fill('')
  await dialog.getByRole('group', { name: '内訳書の編', exact: true })
    .getByRole('button', { name: '建築', exact: true }).click()
  await dialog.getByRole('group', { name: '内訳書の種目', exact: true })
    .getByRole('button', { name: '庁舎', exact: true }).click()
  await dialog.getByRole('group', { name: '内訳書の科目', exact: true })
    .getByRole('button', { name: subject, exact: true }).click()
  await dialog.getByRole('group', { name: '内訳書の中科目', exact: true })
    .getByRole('button', { name: '躯体', exact: true }).click()
  await expect(dialog.getByRole('heading', {
    name: '躯体の細目', exact: true,
  })).toBeVisible()
}

async function chooseConcreteSummary(
  dialog: Locator, label: string, value: string, name = concreteName,
) {
  const valueBox = dialog.getByRole('checkbox', {
    name: `${name}の${label} ${value}`, exact: true,
  })
  if (await valueBox.count()) {
    await valueBox.check()
    return
  }
  const select = dialog.getByRole('combobox', { name: label, exact: true })
  if (await select.count()) {
    await select.selectOption({ label: value })
    return
  }
  const group = dialog.getByRole('group', { name: label, exact: true })
  const checkbox = group.getByRole('checkbox', { name: value, exact: true })
  if (await checkbox.count()) {
    await checkbox.check()
    return
  }
  await group.getByRole('button', { name: value, exact: true }).click()
}

async function fixtureNamed(page: Page, name: string) {
  const fixtures = await page.evaluate(() => window.__karu!.getCountFixtures())
  const fixture = fixtures.find(fixture => fixture.name === name)
  expect(fixture).toBeDefined()
  return fixture!
}

async function addConcreteAndRebar(page: Page) {
  const before = await page.evaluate(() => window.__karu!.getCountFixtures().length)
  const concreteDialog = await breakdownDialog(page)
  await buildingGroup(concreteDialog, 'コンクリート')
  await concreteDialog.getByRole('checkbox', {
    name: `${concreteName}（㎥）`, exact: true,
  }).check()
  await chooseConcreteSummary(concreteDialog, '強度', '24')
  await chooseConcreteSummary(concreteDialog, 'スランプ', '18')
  await concreteDialog.getByRole('button', {
    name: '選んだ項目を追加（1件）', exact: true,
  }).click()
  await expect(concreteDialog).toHaveCount(0)
  await expect.poll(async () => page.evaluate(() =>
    window.__karu!.getCountFixtures().length)).toBe(before + 1)

  const concrete = await fixtureNamed(page, concreteName)
  expect(concrete).toMatchObject({
    category: 'コンクリート', kind: 'volume', method: 'polygonDepth',
    breakdown: {
      book: '建築', section: '庁舎', subject: 'コンクリート',
      middle: '躯体', item: concreteName,
    },
  })
  expect(concrete.rc).toBeUndefined()
  expect(concrete.link).toBeUndefined()

  const rebarDialog = await breakdownDialog(page)
  await buildingGroup(rebarDialog, '鉄筋')
  const breakdownPanel = rebarDialog.getByRole('tabpanel', {
    name: '内訳書から選ぶ', exact: true,
  })
  await breakdownPanel.getByRole('checkbox', { name: /^異形鉄筋/ }).first().check()
  await rebarDialog.getByRole('button', {
    name: '選んだ項目を追加（1件）', exact: true,
  }).click()
  await expect.poll(async () => page.evaluate(() =>
    window.__karu!.getCountFixtures().length)).toBe(before + 2)
  await expect(rebarDialog.getByRole('status').filter({
    hasText: 'RC 部材の項目から計算します',
  })).toContainText(
    '異形鉄筋は RC 部材の項目から計算します。コンクリートの項目を開き「RC 部材」で配筋を入れてください。',
  )
  await closeDialog(rebarDialog)

  const rebar = await fixtureNamed(page, rebarName)
  expect(rebar.link).toMatchObject({
    kind: 'rc', sources: [], auto: { rcKinds: [] },
    rc: { output: 'rebar', basis: 'required' },
  })
  return { concrete, rebar }
}

async function addFoundationMasterItem(
  page: Page, name: string, unit: '㎥' | '㎡', subject: string,
) {
  const before = await page.evaluate(() => window.__karu!.getCountFixtures().length)
  const dialog = await breakdownDialog(page)
  await dialog.getByRole('group', { name: '内訳書の編', exact: true })
    .getByRole('button', { name: '建築', exact: true }).click()
  await dialog.getByRole('group', { name: '内訳書の種目', exact: true })
    .getByRole('button', { name: '庁舎', exact: true }).click()
  await dialog.getByRole('group', { name: '内訳書の科目', exact: true })
    .getByRole('button', { name: subject, exact: true }).click()
  await dialog.getByLabel('内訳書を検索', { exact: true }).fill(name)
  // 検索では同じ名前の細目が複数の中科目から出るので、最初（躯体）を選ぶ。
  await dialog.getByRole('checkbox', {
    name: `${name}（${unit}）`, exact: true,
  }).first().check()
  if (subject === 'コンクリート') {
    await chooseConcreteSummary(dialog, '強度', '24', name)
    await chooseConcreteSummary(dialog, 'スランプ', '18', name)
  }
  await dialog.getByRole('button', {
    name: '選んだ項目を追加（1件）', exact: true,
  }).click()
  await expect.poll(() => page.evaluate(() =>
    window.__karu!.getCountFixtures().length)).toBe(before + 1)
  if (await dialog.isVisible()) await closeDialog(dialog)
  return fixtureNamed(page, name)
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

async function rectangle(page: Page, widthM = 4, heightM = 3) {
  const x = 100, y = 120
  const width = pointsForMeters(widthM), height = pointsForMeters(heightM)
  await click(page, x, y)
  await click(page, x + width, y)
  await click(page, x + width, y + height)
  await click(page, x, y + height)
  await page.keyboard.press('Enter')
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('karu-pdf:fixture-panel-settings-open', 'true')
  })
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes =>
    window.__karu!.openBytes(bytes, 'RC入口の案内試験.pdf'), blankPdf())
  await page.evaluate(() => window.__karu!.setZoom(1))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await expect(panel(page).getByRole('button', {
    name: '標準マスタから追加', exact: true,
  })).toBeEnabled()
  await expect(panel(page).getByText(
    '数量拾いを読み込んでいます…', { exact: true },
  )).toHaveCount(0)
})

test('元なしの鉄筋から配筋設定へ移り、拾いの深さで床板と所要鉄筋を計算する', async ({ page }) => {
  const { concrete, rebar } = await addConcreteAndRebar(page)

  const missing = fixtureLi(page, rebar).locator('.fixture-link-missing')
  await expect(missing).toHaveText('元なし')
  await expect(missing).toHaveClass('fixture-link-badge fixture-link-missing')
  await expect(missing).toHaveAttribute(
    'title', '元になる項目がありません。項目を開くと案内が出ます。',
  )
  await expect(fixtureLi(page, concrete).locator('.fixture-link-badge')).toHaveCount(0)

  // 通常の編集でもコンクリートの RC 欄は開く。チェックは自動で付けない。
  const directEditor = await editDialog(page, concrete)
  await expect(directEditor.locator('.fixture-rc')).toHaveAttribute('open', '')
  await expect(directEditor.locator('.fixture-rc')).toContainText(concreteGuidance)
  await expect(directEditor.getByRole('checkbox', {
    name: 'RC 部材にする', exact: true,
  })).not.toBeChecked()
  await closeDialog(directEditor)

  const editor = await editDialog(page, rebar)
  const guidance = editor.getByRole('region', { name: 'RC 部材の案内', exact: true })
  await expect(guidance.getByRole('status')).toHaveText(missingGuidance)
  await guidance.getByRole('button', {
    name: `${fixtureCode(concrete)} ${concreteName}に配筋を入れる`, exact: true,
  }).click()

  // 同じ名前のダイアログを Locator が再取得し、別項目へ切り替わったことを確認する。
  await expect(page.getByRole('dialog', { name: '項目を編集', exact: true }))
    .toHaveCount(1)
  await expect(editor.getByLabel('名称', { exact: true })).toHaveValue(concreteName)
  const rc = editor.locator('.fixture-rc')
  await expect(rc).toHaveAttribute('open', '')
  await expect(rc).toContainText(concreteGuidance)
  const enabled = rc.getByRole('checkbox', { name: 'RC 部材にする', exact: true })
  await expect(enabled).toBeFocused()
  await expect(enabled).not.toBeChecked()
  await expect(enabled).toBeInViewport()
  await enabled.check()
  await expect(rc.getByLabel('部材の種類', { exact: true })).toHaveValue('slab')

  const thickness = rc.getByLabel('厚さ（mm）', { exact: true })
  await expect(thickness).toHaveValue('')
  await expect(thickness).toHaveAttribute('placeholder', '空なら拾いの形から')
  await expect(rc).toContainText('空なら拾いの深さを厚さにします')

  for (const [index, role] of ['x', 'y'].entries()) {
    const n = index + 1
    await rc.getByRole('button', { name: '＋ 鉄筋を足す', exact: true }).click()
    await rc.getByLabel(`鉄筋${n}の役割`, { exact: true }).selectOption(role)
    await rc.getByLabel(`鉄筋${n}の径`, { exact: true }).selectOption('D13')
    await rc.getByLabel(`鉄筋${n}の間隔（mm）`, { exact: true }).fill('200')
    await rc.getByLabel(`鉄筋${n}の段`, { exact: true }).selectOption('2')
  }

  // 既存 RC e2e と同じく、体積の拾いに使う深さを初期値で指定する。
  await editor.getByLabel('深さ（新しく拾うときの初期値）', {
    exact: true,
  }).fill('0.15')
  await editor.getByRole('button', { name: '変更する', exact: true }).click()
  await expect(editor).toHaveCount(0)

  const savedConcrete = await fixtureNamed(page, concreteName)
  expect(savedConcrete.rc).toMatchObject({
    kind: 'slab',
    bars: [
      { role: 'x', size: 'D13', spacingMm: 200, layers: 2 },
      { role: 'y', size: 'D13', spacingMm: 200, layers: 2 },
    ],
  })
  expect(savedConcrete.rc!.thicknessMm).toBeUndefined()
  expect(savedConcrete.defaults?.depthM).toBe(.15)
  expect(savedConcrete.link).toBeUndefined()

  await fixtureRow(page, concrete).click()
  await setScale(page)
  await rectangle(page)
  await expect(total(page, concrete)).toHaveText('1.80')
  await expect(fixtureLi(page, concrete).locator('.fixture-row-unit')).toHaveText('m³')
  await expect(fixtureLi(page, rebar).locator('.fixture-link-missing')).toHaveCount(0)
  await expect(fixtureLi(page, rebar).locator('.fixture-link-badge')).toHaveText('連動')
  await expect(total(page, rebar)).toHaveText('0.35')
  await expect(fixtureLi(page, rebar).locator('.fixture-row-unit')).toHaveText('t')

  const previewEditor = await editDialog(page, concrete)
  const preview = previewEditor.getByRole('region', {
    name: 'RC 部材の見本', exact: true,
  })
  await expect(preview).toContainText('コンクリート 1.80 ㎥')
  await expect(preview).toContainText('型枠 12.00 ㎡')
  await expect(previewEditor.getByLabel('厚さ（mm）', { exact: true })).toHaveValue('')
  await closeDialog(previewEditor)

  // 同じ編集画面内で外して付け直した場合は、開いた時点の設定へ戻す。
  const rebarEditor = await editDialog(page, rebar)
  const linkEnabled = rebarEditor.getByRole('checkbox', {
    name: '連動にする', exact: true,
  })
  await linkEnabled.uncheck()
  await linkEnabled.check()
  await expect(rebarEditor.getByLabel('RC の出力', { exact: true }))
    .toHaveValue('rebar')
  await expect(rebarEditor.getByRole('radio', { name: /^所要数量/ }))
    .toBeChecked()
  await expect(rebarEditor.getByRole('checkbox', {
    name: 'RC 部材を自動で元にする', exact: true,
  })).toBeChecked()
  const panelPreview = rebarEditor.getByRole('region', {
    name: '連動の見本', exact: true,
  })
  await expect(panelPreview).toContainText('合計 0.35 t')
  await expect(panelPreview).not.toContainText('形の計量')

  // 外して保存した後の再設定は、名称に対応する標準の規則で始める。
  await linkEnabled.uncheck()
  await rebarEditor.getByRole('button', { name: '変更する', exact: true }).click()
  await expect(rebarEditor).toHaveCount(0)
  expect((await fixtureNamed(page, rebarName)).link).toBeUndefined()

  const restoredEditor = await editDialog(page, rebar)
  await openDetails(restoredEditor, '.fixture-link')
  await restoredEditor.getByRole('checkbox', {
    name: '連動にする', exact: true,
  }).check()
  await expect(restoredEditor.getByRole('status').filter({
    hasText: '標準の規則「',
  })).toContainText('で始めました')
  await expect(restoredEditor.getByRole('radio', {
    name: 'RC 部材から（コンクリート・型枠・鉄筋）', exact: true,
  })).toBeChecked()
  await expect(restoredEditor.getByLabel('RC の出力', { exact: true }))
    .toHaveValue('rebar')
  await expect(restoredEditor.getByRole('radio', { name: /^所要数量/ }))
    .toBeChecked()

  // 種類を切り替えて戻した場合も、名称・規則に合う出力と数量を使う。
  await restoredEditor.getByRole('radio', {
    name: '係数で計算する', exact: true,
  }).check()
  await restoredEditor.getByRole('radio', {
    name: 'RC 部材から（コンクリート・型枠・鉄筋）', exact: true,
  }).check()
  await expect(restoredEditor.getByLabel('RC の出力', { exact: true }))
    .toHaveValue('rebar')
  await expect(restoredEditor.getByRole('radio', { name: /^所要数量/ }))
    .toBeChecked()
  await restoredEditor.getByRole('button', {
    name: '変更する', exact: true,
  }).click()
  await expect(restoredEditor).toHaveCount(0)
  const restoredRebar = await fixtureNamed(page, rebarName)
  expect(restoredRebar.link).toMatchObject({
    kind: 'rc', rc: { output: 'rebar', basis: 'required' },
  })
  await expect(total(page, restoredRebar)).toHaveText('0.35')
  await expect(fixtureLi(page, restoredRebar).locator('.fixture-row-unit'))
    .toHaveText('t')

  // 画面右の入口から開く App 側の編集画面にも同じ見本を渡す。
  await fixtureRow(page, restoredRebar).click()
  await page.getByRole('button', { name: '項目を編集…', exact: true }).click()
  const rightEditor = page.getByRole('dialog', {
    name: '項目を編集', exact: true,
  })
  await expect(rightEditor.getByLabel('名称', { exact: true }))
    .toHaveValue(rebarName)
  const rightPreview = rightEditor.getByRole('region', {
    name: '連動の見本', exact: true,
  })
  const listTotal = (await total(page, restoredRebar).textContent())!.trim()
  await expect(rightPreview).toContainText(`合計 ${listTotal} t`)
  await expect(rightPreview).toContainText('合計 0.35 t')
  await expect(rightPreview).not.toContainText('形の計量')
  await expect(rightPreview).toContainText('÷0.200m→16本')
  await expect(rightPreview).toContainText('本')
  await expect(rightPreview).toContainText('kg/m')
  await expect(rightPreview).toContainText('1.04')
  const sourceRows = rightPreview.locator('li')
  await expect(sourceRows).toHaveCount(1)
  await expect(sourceRows.first()).not.toContainText('m³')
  await expect(sourceRows.first()).not.toContainText('× 1 ＝')
  await expect(sourceRows.first()).toContainText('t')
  await closeDialog(rightEditor)

  await total(page, restoredRebar).click()
  const basis = page.getByRole('region', { name: '計算の根拠', exact: true })
  await expect(basis).toContainText('kg/m')
  await expect(basis).toContainText('1.04')
  await expect(basis.locator('li').first()).not.toContainText('m³')
  await expect(basis.locator('li').first()).not.toContainText('× 1 ＝')
})

test('別項目へ移る前に独立した入力欄の下書きを確認し、保存せずに移る', async ({ page }) => {
  const { concrete, rebar } = await addConcreteAndRebar(page)
  const editor = await editDialog(page, rebar)

  // 属性欄は value と別の下書きを持つため、その変更も確認の対象にする。
  await openDetails(editor, '.fixture-attributes')
  const attribute = editor.locator('.fixture-attributes').getByRole('textbox').first()
  await attribute.fill('100')
  const moveButton = editor.getByRole('region', {
    name: 'RC 部材の案内', exact: true,
  }).getByRole('button', {
    name: `${fixtureCode(concrete)} ${concreteName}に配筋を入れる`, exact: true,
  })

  const firstConfirmation = page.waitForEvent('dialog')
  const firstClick = moveButton.click()
  const cancelled = await firstConfirmation
  expect(cancelled.type()).toBe('confirm')
  expect(cancelled.message()).toBe('変更を保存せずに移りますか？')
  await cancelled.dismiss()
  await firstClick
  await expect(editor.getByLabel('名称', { exact: true })).toHaveValue(rebarName)
  await expect(attribute).toHaveValue('100')

  const secondConfirmation = page.waitForEvent('dialog')
  const secondClick = moveButton.click()
  const accepted = await secondConfirmation
  expect(accepted.type()).toBe('confirm')
  expect(accepted.message()).toBe('変更を保存せずに移りますか？')
  await accepted.accept()
  await secondClick

  await expect(editor.getByLabel('名称', { exact: true })).toHaveValue(concreteName)
  await expect(editor.locator('.fixture-rc')).toHaveAttribute('open', '')
  await expect(editor.getByRole('checkbox', {
    name: 'RC 部材にする', exact: true,
  })).toBeFocused()
  await expect(editor.getByRole('checkbox', {
    name: 'RC 部材にする', exact: true,
  })).not.toBeChecked()

  const unchangedRebar = await fixtureNamed(page, rebarName)
  expect(unchangedRebar.attributes).toEqual(rebar.attributes)
  expect(unchangedRebar.link).toEqual(rebar.link)
  await closeDialog(editor)
})

test('基礎の既定種類と拾いの深さで型枠を計算し、種類の不一致から修正へ案内する', async ({ page }) => {
  const name = '普通コンクリート（基礎部）'
  const concrete = await addFoundationMasterItem(page, name, '㎥', 'コンクリート')
  const editor = await editDialog(page, concrete)
  const rc = editor.locator('.fixture-rc')
  await rc.getByRole('checkbox', { name: 'RC 部材にする', exact: true }).check()
  await expect(rc.getByLabel('部材の種類', { exact: true }))
    .toHaveValue('foundationSlab')
  await expect(rc.getByLabel('厚さ（mm）', { exact: true })).toHaveValue('')
  await expect(rc.getByRole('status').filter({
    hasText: '名前が「基礎」です',
  })).toHaveCount(0)
  await editor.getByLabel('深さ（新しく拾うときの初期値）', {
    exact: true,
  }).fill('2.5')
  await editor.getByRole('button', { name: '変更する', exact: true }).click()
  await expect(editor).toHaveCount(0)

  const saved = await fixtureNamed(page, name)
  expect(saved.rc).toMatchObject({ kind: 'foundationSlab', bars: [] })
  expect(saved.rc!.thicknessMm).toBeUndefined()
  expect(saved.defaults?.depthM).toBe(2.5)

  await fixtureRow(page, concrete).click()
  await setScale(page)
  await rectangle(page)
  await expect(total(page, concrete)).toHaveText('30.00')

  const formwork = await addFoundationMasterItem(
    page, '普通合板型枠（基礎部）', '㎡', '型枠',
  )
  const transport = await addFoundationMasterItem(page, '型枠運搬', '㎡', '型枠')
  expect(formwork.link).toMatchObject({
    kind: 'rc', rc: { output: 'formwork' },
  })
  expect(formwork.link!.auto?.rcKinds).toEqual(expect.arrayContaining([
    'foundationSlab', 'foundationBeam', 'footing',
  ]))
  expect(transport.link).toMatchObject({
    kind: 'rc', rc: { output: 'formwork' },
  })
  await expect(total(page, formwork)).toHaveText('35.00')
  await expect(total(page, transport)).toHaveText('35.00')

  // 集計表の全図面にも、周長 14m × 深さ 2.5m が反映される。
  await fixtureRow(page, formwork).click()
  await panel(page).getByRole('button', { name: '集計表を開く', exact: true }).click()
  const table = page.getByRole('region', { name: '数量の集計表', exact: true })
  await expect(table.locator(`tr[data-fixture-id="${formwork.id}"]`)
    .locator('.quantity-table-fixed-5 button')).toHaveText('35.00')
  await fixtureRow(page, transport).click()
  await expect(table.locator(`tr[data-fixture-id="${transport.id}"]`)
    .locator('.quantity-table-fixed-5 button')).toHaveText('35.00')
  await table.getByRole('button', { name: '集計表を閉じる', exact: true }).click()

  const slabEditor = await editDialog(page, concrete)
  await slabEditor.getByLabel('部材の種類', { exact: true }).selectOption('slab')
  const warning = '名前が「基礎」です。部材の種類を基礎スラブ（基礎梁・独立基礎）にすると、型枠は側面（周長 × 厚さ）になり、型枠（基礎部）の連動の元になります。'
  await expect(slabEditor.locator('.fixture-rc').getByRole('status'))
    .toHaveText(warning)
  await slabEditor.getByRole('button', { name: '変更する', exact: true }).click()
  await expect(slabEditor).toHaveCount(0)
  await expect(fixtureLi(page, formwork).locator('.fixture-link-missing'))
    .toHaveText('元なし')
  await expect(total(page, transport)).toHaveText('12.00')

  const linkEditor = await editDialog(page, formwork)
  const guidance = linkEditor.locator('.fixture-link').getByRole('region', {
    name: 'RC 部材の案内', exact: true,
  })
  await expect(guidance.getByRole('status'))
    .toContainText('部材の種類が合う RC 部材がありません')
  await expect(guidance.getByRole('status'))
    .toContainText('この連動は 基礎スラブ、基礎梁、独立基礎 を元にします。')
  await expect(guidance.getByRole('status'))
    .toContainText(`今ある RC 部材: ${name}（床板）`)
  await expect(linkEditor.getByRole('status').filter({
    hasText: missingGuidance,
  })).toHaveCount(0)
  await guidance.getByRole('button', {
    name: `${fixtureCode(concrete)} ${name}の部材の種類を直す`, exact: true,
  }).click()

  await expect(linkEditor.getByLabel('名称', { exact: true })).toHaveValue(name)
  await expect(linkEditor.locator('.fixture-rc')).toHaveAttribute('open', '')
  await expect(linkEditor.getByRole('checkbox', {
    name: 'RC 部材にする', exact: true,
  })).toBeFocused()
  await expect(linkEditor.locator('.fixture-rc').getByRole('status'))
    .toHaveText(warning)
  await linkEditor.getByLabel('部材の種類', { exact: true })
    .selectOption('foundationSlab')
  await linkEditor.getByRole('button', { name: '変更する', exact: true }).click()
  await expect(linkEditor).toHaveCount(0)
  await expect(fixtureLi(page, formwork).locator('.fixture-link-missing'))
    .toHaveCount(0)
  await expect(total(page, formwork)).toHaveText('35.00')
  await expect(total(page, transport)).toHaveText('35.00')
})

test('体積で全種類を選べ、寸法が空の梁を平面と深さから計算する', async ({ page }) => {
  const { concrete } = await addConcreteAndRebar(page)
  const editor = await editDialog(page, concrete)
  const rc = editor.locator('.fixture-rc')
  await rc.getByRole('checkbox', { name: 'RC 部材にする', exact: true }).check()

  const kinds = rc.getByLabel('部材の種類', { exact: true })
  await expect(kinds.locator('option')).toHaveCount(7)
  for (const kind of [
    'slab', 'foundationSlab', 'wall', 'beam', 'foundationBeam', 'column', 'footing',
  ]) {
    await expect(kinds.locator(`option[value="${kind}"]`)).toBeEnabled()
  }
  await kinds.selectOption('beam')
  await expect(rc).toContainText(
    '幅が空なら平面の短い辺、長さは 面積 ÷ 幅、せいが空なら拾いの深さ',
  )
  for (const label of ['幅 b（mm）', 'せい D（mm）']) {
    const input = rc.getByLabel(label, { exact: true })
    await expect(input).toHaveValue('')
    await expect(input).toHaveAttribute('placeholder', '空なら拾いの形から')
  }

  for (const [index, role] of ['top', 'bottom', 'stirrup'].entries()) {
    const n = index + 1
    await rc.getByRole('button', { name: '＋ 鉄筋を足す', exact: true }).click()
    await rc.getByLabel(`鉄筋${n}の役割`, { exact: true }).selectOption(role)
    await rc.getByLabel(`鉄筋${n}の径`, { exact: true })
      .selectOption(role === 'stirrup' ? 'D10' : 'D22')
    if (role === 'stirrup') {
      await rc.getByLabel(`鉄筋${n}の間隔（mm）`, { exact: true }).fill('200')
    } else {
      await rc.getByLabel(`鉄筋${n}の本数`, { exact: true }).fill('4')
    }
  }
  await editor.getByLabel('深さ（新しく拾うときの初期値）', {
    exact: true,
  }).fill('0.7')
  await editor.getByRole('button', { name: '変更する', exact: true }).click()
  await expect(editor).toHaveCount(0)

  const saved = await fixtureNamed(page, concreteName)
  expect(saved.rc).toMatchObject({
    kind: 'beam',
    bars: [
      { role: 'top', size: 'D22', count: 4, layers: 1 },
      { role: 'bottom', size: 'D22', count: 4, layers: 1 },
      { role: 'stirrup', size: 'D10', spacingMm: 200, layers: 1 },
    ],
  })
  expect(saved.rc!.widthMm).toBeUndefined()
  expect(saved.rc!.depthMm).toBeUndefined()
  expect(saved.rc!.slabDeductMm).toBeUndefined()
  expect(saved.defaults?.depthM).toBe(.7)

  await fixtureRow(page, concrete).click()
  await setScale(page)
  await rectangle(page, .6, 10)
  await expect(total(page, concrete)).toHaveText('4.20')

  const previewEditor = await editDialog(page, concrete)
  await expect(previewEditor.getByLabel('部材の種類', { exact: true }))
    .toHaveValue('beam')
  await expect(previewEditor.getByLabel('幅 b（mm）', { exact: true }))
    .toHaveValue('')
  await expect(previewEditor.getByLabel('せい D（mm）', { exact: true }))
    .toHaveValue('')
  const preview = previewEditor.getByRole('region', {
    name: 'RC 部材の見本', exact: true,
  })
  await expect(preview).toContainText('コンクリート 4.20 ㎥')
  await expect(preview).toContainText('型枠 20.00 ㎡')
  await expect(preview).toContainText(
    '梁 面積 6.00㎡ ÷ 幅 0.60m = 長さ 10.00m、せい 0.70m（拾いの深さ）',
  )
  await closeDialog(previewEditor)
})

test('名称・細目・中科目から、拾い方で選べる RC 部材の既定種類を決める', async ({ page }) => {
  const { concrete } = await addConcreteAndRebar(page)
  const editor = await editDialog(page, concrete)
  await openDetails(editor, '.fixture-breakdown')
  const enabled = editor.getByRole('checkbox', {
    name: 'RC 部材にする', exact: true,
  })
  const cases = [
    { name: '普通コンクリート', item: '基礎', middle: '', kind: 'volume', expected: 'foundationSlab' },
    { name: '普通コンクリート', item: '', middle: '基礎', kind: 'length', expected: 'foundationBeam' },
    { name: '基礎コンクリート', item: '', middle: '', kind: 'count', expected: 'footing' },
    { name: '柱コンクリート', item: '', middle: '', kind: 'count', expected: 'column' },
    { name: '梁コンクリート', item: '', middle: '', kind: 'length', expected: 'beam' },
    { name: '壁コンクリート', item: '', middle: '', kind: 'area', method: '長さ×高さ', expected: 'wall' },
    { name: '床コンクリート', item: '', middle: '', kind: 'area', method: '囲む', expected: 'slab' },
    { name: 'スラブコンクリート', item: '', middle: '', kind: 'volume', method: '囲む×深さ', expected: 'slab' },
    { name: '土間コンクリート', item: '', middle: '', kind: 'volume', method: '囲む×深さ', expected: 'slab' },
    { name: '普通コンクリート', item: '', middle: '', kind: 'volume', method: '囲む×深さ', expected: 'slab' },
    { name: '柱コンクリート', item: '', middle: '', kind: 'length', expected: 'column' },
    { name: '柱コンクリート', item: '', middle: '', kind: 'volume', method: '囲む×深さ', expected: 'column' },
    { name: '梁コンクリート', item: '', middle: '', kind: 'volume', method: '囲む×深さ', expected: 'beam' },
    { name: '壁コンクリート', item: '', middle: '', kind: 'volume', method: '囲む×深さ', expected: 'wall' },
  ] as const
  const kindLabels = { count: '個数', length: '長さ', area: '面積', volume: '体積' } as const
  for (const entry of cases) {
    await enabled.uncheck()
    await editor.getByLabel('名称', { exact: true }).fill(entry.name)
    await editor.getByLabel('細目', { exact: true }).fill(entry.item)
    await editor.getByLabel('中科目', { exact: true }).fill(entry.middle)
    await editor.getByRole('radio', {
      name: kindLabels[entry.kind], exact: true,
    }).check()
    if ('method' in entry) {
      await editor.getByRole('radio', { name: entry.method, exact: true }).check()
    }
    await enabled.check()
    await expect(editor.getByLabel('部材の種類', { exact: true }))
      .toHaveValue(entry.expected)
  }
  await closeDialog(editor)
})
