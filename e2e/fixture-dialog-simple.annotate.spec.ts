import { expect, test, type Locator, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import { readCountFixtures, type CountFixture } from '../src/core/countFixtures'

test.use({ serviceWorkers: 'block' })

function blankPdf(): number[] {
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

async function open(page: Page): Promise<void> {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(
    bytes => window.__karu!.openBytes(bytes, '項目の簡単設定試験.pdf'),
    blankPdf(),
  )
  await page.evaluate(() => window.__karu!.setZoom(1))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '項目を追加', exact: true }),
  ).toBeEnabled()
}

async function addDialog(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: '項目を追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

async function customName(dialog: Locator, name: string): Promise<void> {
  // 名称は候補一覧付きの1つの入力欄（候補から選んでも、打ってもよい）
  await dialog.getByLabel('名称', { exact: true }).fill(name)
}

async function savedFixtures(page: Page): Promise<CountFixture[]> {
  const bytes = await page.evaluate(async () => {
    const saved = await window.__karu!.saveToBytes()
    if (!saved) throw new Error('PDFを保存できませんでした')
    return [...saved]
  })
  const doc = new mupdf.PDFDocument(new Uint8Array(bytes))
  try {
    return readCountFixtures(doc)
  } finally {
    doc.destroy()
  }
}

/**
 * The supplied test API has no fixture setter. This adapter is used only to
 * prepare an existing document containing a legacy memo. Editing and saving
 * are exercised through the actual dialog.
 */
async function seedFixtures(page: Page, fixtures: CountFixture[]): Promise<void> {
  await page.evaluate(value => {
    type Store = {
      getCountFixtures(): CountFixture[]
      setCountFixtures(fixtures: CountFixture[]): void
      selectFixture(id: string | null): void
    }
    type Fiber = {
      memoizedProps?: {
        session?: {
          annotationStore?: Store
        }
      }
      return?: Fiber | null
    }

    const element = document.querySelector('[data-testid="fixture-panel"]')
    if (!element) throw new Error('数量拾いのパネルがありません')

    const property = Object.keys(element).find(key => key.startsWith('__reactFiber$'))
    if (!property) {
      throw new Error('試験用のセッション取得方法を現在のReactに合わせてください')
    }

    let fiber = (element as unknown as Record<string, unknown>)[property] as
      Fiber | null | undefined

    while (fiber) {
      const store = fiber.memoizedProps?.session?.annotationStore
      if (store) {
        store.setCountFixtures(value)
        store.selectFixture(null)
        return
      }
      fiber = fiber.return
    }

    throw new Error('数量拾いのセッションを取得できませんでした')
  }, fixtures)
}

function fixtureRow(page: Page, id: string): Locator {
  return page.getByTestId('fixture-panel')
    .locator('li[data-fixture-id]')
    .filter({
      has: page.locator(`.fixture-row`),
    })
    .and(page.locator(`li[data-fixture-id="${id}"]`))
}

async function editFixture(page: Page, id: string): Promise<Locator> {
  const row = fixtureRow(page, id)
  await expect(row).toBeVisible()
  // 項目を選び、右欄の「項目を編集…」で開く（既存の e2e と同じ操作）
  await row.locator('.fixture-row').first().click()
  await page.getByTestId('format-panel').getByRole('button', { name: '項目を編集…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を編集', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

const visibleTextInputs = (dialog: Locator) => dialog.locator(
  'input:not([type]):visible, input[type="text"]:visible, input[type="search"]:visible',
)

test('新しい個数の項目では詳しい設定を閉じ、文字の入力欄は名称・規格・略号・分類とメモだけ', async ({
  page,
}) => {
  await open(page)
  const dialog = await addDialog(page)
  const basic = dialog.getByTestId('fixture-basic')
  const advanced = dialog.getByTestId('fixture-advanced')

  await expect(basic).toBeVisible()
  await expect(advanced).not.toHaveAttribute('open', '')

  // 基本に出る文字の入力欄は、候補一覧付きの名称・規格・略号・分類だけ
  const labels = await visibleTextInputs(basic).evaluateAll(inputs => inputs.map(input =>
    input.getAttribute('aria-label') ?? (input as HTMLInputElement).labels?.[0]?.textContent?.trim() ?? ''))
  for (const label of labels) expect(['名称', '規格', '略号', '分類', '新しい分類の名前']).toContain(label)
  // 文章を書く欄はメモ（特殊な仕様のときだけ）の1つだけ
  await expect(dialog.locator('textarea:visible')).toHaveCount(1)
  await expect(dialog.locator('textarea:visible')).toHaveAttribute('placeholder', '特殊な仕様のときだけ')
  await expect(dialog.locator('input[type="number"]:visible')).toHaveCount(0)

  await expect(basic.getByLabel('名称', { exact: true })).toHaveAttribute('list', /.+/)
  await expect(basic.getByLabel('規格', { exact: true })).toHaveAttribute('list', /.+/)
  await expect(
    basic.getByRole('radio', { name: '個数', exact: true }),
  ).toBeChecked()

  await customName(dialog, '手入力の項目')
  await expect(dialog.getByLabel('名称', { exact: true })).toHaveValue('手入力の項目')

  await dialog.getByLabel('規格', { exact: true }).fill('特注仕様')
  // 文章を書く欄はメモ（特殊な仕様のときだけ）の1つだけ
  await expect(dialog.locator('textarea:visible')).toHaveCount(1)
  await expect(dialog.locator('textarea:visible')).toHaveAttribute('placeholder', '特殊な仕様のときだけ')

  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  await expect(dialog).toBeHidden()

  const fixtures = await savedFixtures(page)
  const fixture = fixtures.find(entry => entry.name === '手入力の項目')
  expect(fixture).toBeDefined()
  expect(fixture!.spec).toBe('特注仕様')
  expect(fixture!.memo).toBeUndefined()
})

test('面積の長さ×高さでは高さを表示し、個数に戻すと寸法欄を隠す', async ({
  page,
}) => {
  await open(page)
  const dialog = await addDialog(page)

  await dialog.getByRole('radio', { name: '面積', exact: true }).check()
  const necessary = dialog.getByTestId('fixture-necessary')
  await expect(necessary).toBeVisible()

  await dialog.getByRole('radio', { name: '長さ×高さ', exact: true }).check()
  const height = necessary.getByLabel('高さ（新しく拾うときの初期値）', { exact: true })
  await expect(height).toBeVisible()
  await expect(height).toHaveAttribute('type', 'number')
  await height.fill('2.8')

  await dialog.getByRole('radio', { name: '個数', exact: true }).check()
  await expect(height).toHaveCount(0)
  await expect(dialog.locator('input[type="number"]:visible')).toHaveCount(0)
})

test('旧データのメモは詳細を開かず保存しても残り、明示的に空にしたときだけ消える', async ({
  page,
}) => {
  await open(page)

  const adding = await addDialog(page)
  await customName(adding, '旧データの項目')
  await adding.getByRole('button', { name: '追加する', exact: true }).click()
  await expect(adding).toBeHidden()

  const original = (await savedFixtures(page)).find(
    fixture => fixture.name === '旧データの項目',
  )
  expect(original).toBeDefined()

  const legacyMemo = '旧版で入力したメモ\n二行目も保持する'
  const legacy: CountFixture = {
    ...original!,
    memo: legacyMemo,
  }
  await seedFixtures(page, [legacy])

  let editing = await editFixture(page, legacy.id)
  await expect(editing.getByTestId('fixture-advanced')).not.toHaveAttribute('open', '')
  await expect(editing.getByLabel('メモ', { exact: true })).toBeHidden()
  await editing.getByRole('button', { name: '変更する', exact: true }).click()
  await expect(editing).toBeHidden()

  let fixtures = await savedFixtures(page)
  expect(fixtures.find(fixture => fixture.id === legacy.id)?.memo).toBe(legacyMemo)

  // Reopen the saved PDF to verify persistence beyond the in-memory store.
  const bytes = await page.evaluate(async () => {
    const saved = await window.__karu!.saveToBytes()
    if (!saved) throw new Error('PDFを保存できませんでした')
    return [...saved]
  })
  await page.evaluate(async () => {
    await window.__karu!.closeTab(window.__karu!.listTabs()[0].docId)
  })
  await page.evaluate(
    saved => window.__karu!.openBytes(saved, '旧メモを保持した図面.pdf'),
    bytes,
  )
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await expect(page.getByTestId('fixture-panel')).toBeVisible()

  editing = await editFixture(page, legacy.id)

  const memo = editing.getByRole('textbox', { name: 'メモ', exact: true })
  await expect(memo).toBeVisible()
  await expect(memo).toHaveValue(legacyMemo)
  await memo.fill('')
  await editing.getByRole('button', { name: '変更する', exact: true }).click()
  await expect(editing).toBeHidden()

  fixtures = await savedFixtures(page)
  expect(fixtures.find(fixture => fixture.id === legacy.id)?.memo ?? '').toBe('')
})
