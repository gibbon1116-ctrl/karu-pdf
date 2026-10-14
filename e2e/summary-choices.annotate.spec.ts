import { expect, test, type Locator, type Page } from '@playwright/test'
import mupdf from 'mupdf'

test.use({ serviceWorkers: 'block' })

function blankPdf() {
  const doc = new mupdf.PDFDocument()
  const ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
  try {
    doc.insertPage(-1, ref)
    const buffer = doc.saveToBuffer('compress')
    try {
      return [...buffer.asUint8Array()]
    } finally {
      buffer.destroy()
    }
  } finally {
    ref.destroy()
    doc.destroy()
  }
}

async function open(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(
    bytes => window.__karu!.openBytes(bytes, '摘要候補試験.pdf'),
    blankPdf(),
  )
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
}

async function chooseSpec(page: Page, name: string) {
  await page.getByRole('button', {
    name: '標準マスタから追加', exact: true,
  }).click()
  const dialog = page.getByRole('dialog', {
    name: '標準マスタから追加', exact: true,
  })
  await expect(dialog.getByRole('tab', {
    name: '規格から選ぶ', exact: true,
  })).toHaveAttribute('aria-selected', 'true')
  await dialog.getByRole('searchbox', {
    name: '標準マスタを検索', exact: true,
  }).fill(name)

  // 「線状吹出口」等を除き、品目名がちょうど name の品目を選ぶ。
  const chooser = dialog.locator('.catalog-chooser').filter({
    has: page.getByText(new RegExp(`^${name}（`)),
  }).first()
  await expect(chooser).toBeVisible()
  await chooser.locator('.catalog-options input[type="checkbox"]:enabled').first().check()
  return { dialog, chooser }
}

async function addSelected(dialog: Locator) {
  const add = dialog.getByRole('button', { name: /追加/ }).last()
  await expect(add).toBeEnabled()
  await add.click()
  await expect(dialog).toBeHidden()
}

async function expectCandidate(input: Locator, value: string) {
  await expect(input).toHaveAttribute('list', /.+/)
  await expect.poll(() => input.evaluate(element => {
    const list = (element as HTMLInputElement).list
    return list ? Array.from(list.options, option => option.value) : []
  })).toContain(value)
}

async function expectUniqueDatalistIds(page: Page) {
  const ids = await page.locator('datalist').evaluateAll(elements =>
    elements.map(element => element.id),
  )
  expect(ids.every(Boolean)).toBe(true)
  expect(new Set(ids).size).toBe(ids.length)
}

test('SPEC-U3: 文書で使ったPAC-1を規格タブの記号の候補に出す', async ({ page }) => {
  await open(page)

  // 保存形式に触れず、標準マスタの操作で文書内の既存項目を準備する。
  const initial = await chooseSpec(page, 'パッケージ形空気調和機')
  await initial.chooser.getByLabel('パッケージ形空気調和機の記号', {
    exact: true,
  }).fill('PAC-1')
  await addSelected(initial.dialog)

  const { chooser } = await chooseSpec(page, 'パッケージ形空気調和機')
  const symbol = chooser.getByLabel('パッケージ形空気調和機の記号', {
    exact: true,
  })
  await expectCandidate(symbol, 'PAC-1')
  await expect(chooser.getByText('この文書で使った値: PAC-1', {
    exact: true,
  })).toBeVisible()
  await expect(symbol).toHaveAttribute('placeholder', '、で区切ると複数作ります')
  await symbol.fill('PAC-2、PAC-3')
  await expect(symbol).toHaveValue('PAC-2、PAC-3')
  await expectUniqueDatalistIds(page)
})

test('SPEC-U3: 吹出口の寸法はチェックボックスとほかの値を表示する', async ({ page }) => {
  await open(page)
  const { chooser } = await chooseSpec(page, '吹出口')

  await expect(chooser.getByRole('checkbox', {
    name: '吹出口の寸法 300×150', exact: true,
  })).toBeVisible()
  const custom = chooser.getByLabel('吹出口の寸法のほかの値', { exact: true })
  await expect(custom).toBeVisible()
  // 文書で使った値が無いので候補（datalist）は付かない。
  await expect(custom).not.toHaveAttribute('list', /.+/)
  await custom.fill('350×175、450×225')
  await expect(custom).toHaveValue('350×175、450×225')
  await expectUniqueDatalistIds(page)
})

test('SPEC-U3: 項目編集の寸法に位置に対応した標準候補を出す', async ({ page }) => {
  await open(page)
  const { dialog, chooser } = await chooseSpec(page, '吹出口')
  await chooser.getByRole('checkbox', {
    name: '吹出口の寸法 300×150', exact: true,
  }).check()

  const lines = chooser.getByLabel('吹出口の内訳書の行', { exact: true })
  if (await lines.count()) {
    const lineValue = await lines.getByRole('option').evaluateAll(options => {
      const option = options.find(candidate =>
        candidate.textContent?.trim() === '換気設備 › ダクト設備 › 吹出口',
      )
      return option ? (option as HTMLOptionElement).value : null
    })
    expect(lineValue).not.toBeNull()
    await lines.selectOption(lineValue!)
  }
  await expect(chooser.getByRole('button', {
    name: '内訳書: 機械設備 › 庁舎 › 換気設備 › ダクト設備 › 吹出口',
    exact: true,
  })).toBeVisible()
  await addSelected(dialog)

  const panel = page.getByTestId('fixture-panel')
  const itemName = panel.getByText('吹出口', { exact: true }).first()
  await expect(itemName).toBeVisible()
  const item = itemName.locator(
    'xpath=ancestor::*[.//button[contains(@aria-label, "編集") or contains(@title, "編集") or contains(normalize-space(.), "編集")]][1]',
  )
  await item.getByRole('button', { name: /編集/ }).first().click()

  const editor = page.getByRole('dialog').filter({
    has: page.getByLabel('摘要の区分名1', { exact: true }),
  })
  await expect(editor).toBeVisible()
  await expect(editor.getByLabel('編', { exact: true })).toHaveValue('機械設備')
  await expect(editor.getByLabel('科目', { exact: true })).toHaveValue('換気設備')
  await expect(editor.getByLabel('中科目', { exact: true })).toHaveValue('ダクト設備')
  await expect(editor.getByLabel('細目', { exact: true })).toHaveValue('吹出口')

  const labels = editor.locator('input[aria-label^="摘要の区分名"]')
  const dimensionIndex = await labels.evaluateAll(elements =>
    elements.findIndex(element => (element as HTMLInputElement).value === '寸法'),
  )
  expect(dimensionIndex).toBeGreaterThanOrEqual(0)
  await expectCandidate(editor.getByLabel(`摘要の値${dimensionIndex + 1}`, {
    exact: true,
  }), '300×150')
  await expectCandidate(editor.getByLabel(`摘要の区分名${dimensionIndex + 1}`, {
    exact: true,
  }), '寸法')
  await expectUniqueDatalistIds(page)
})
