import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import { applyOutline, readOutline } from '../src/core/outline'
import { pdfOperation } from '../src/core/editTransaction'
import type { OutlinePlanItem } from '../src/core/outlineModel'

function fixture(withOutline = false, count = 0): number[] {
  const doc = new mupdf.PDFDocument()
  try {
    for (let i = 0; i < 5; i++) {
      const ref = doc.addPage([0, 0, 600, 900], 0, {}, '')
      try { doc.insertPage(-1, ref) } finally { ref.destroy() }
    }
    const item = (id: string, title: string, pageIndex: number, children: OutlinePlanItem[] = []): OutlinePlanItem => ({
      id: `new:${id}`, title, open: children.length > 0,
      target: { kind: 'page', pageIndex, view: { type: 'XYZ', params: [80, 700, 1.5] } }, children,
    })
    if (withOutline || count) {
      const items = count ? Array.from({ length: count }, (_, i) => item(String(i), `架空項目${i + 1}`, i % 5)) : [
        item('1', '架空の章', 0, [item('2', '架空の節', 1, [item('3', '架空の小節', 2)])]),
        item('4', '架空の付録', 4), item('5', '架空の外部', 0),
      ]
      const result = pdfOperation(doc, () => applyOutline(doc, { baseRevision: readOutline(doc).revision, items }))
      if (!count) pdfOperation(doc, () => {
        const first = doc.newIndirect(Number(result.snapshot.items[0].id.slice(4)))
        const external = doc.newIndirect(Number(result.snapshot.items[2].id.slice(4)))
        const action = doc.newDictionary(), kind = doc.newName('URI'), uri = doc.newString('https://example.test/fictional-outline')
        try {
          first.put('C', [0.25, 0.5, 0.75]); first.put('F', 3)
          action.put('S', kind); action.put('URI', uri)
          external.delete('Dest'); external.put('A', action)
        } finally { first.destroy(); external.destroy(); action.destroy(); kind.destroy(); uri.destroy() }
      })
    }
    const buffer = doc.saveToBuffer('compress')
    try { return Array.from(buffer.asUint8Array()) } finally { buffer.destroy() }
  } finally { doc.destroy() }
}

async function open(page: Page, withOutline = false, count = 0) {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '架空の目次試験.pdf'), fixture(withOutline, count))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
}
async function openOutline(page: Page) {
  await page.getByRole('tab', { name: '目次', exact: true }).click()
  await expect(page.getByRole('tree', { name: '目次', exact: true })).toBeVisible()
}
function row(page: Page, title: string) {
  return page.getByRole('treeitem').filter({ has: page.getByText(title, { exact: true }) })
}
async function rename(page: Page, title: string) {
  const field = page.getByLabel('名称', { exact: true })
  await field.fill(title); await field.press('Enter')
}
async function draftItems(page: Page) { return page.evaluate(() => window.__karu!.outlineDraft()!.getItems()) }
async function apply(page: Page) {
  await page.getByRole('button', { name: '目次を反映', exact: true }).click()
  await expect(page.getByTestId('outline-panel')).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByText('未反映の変更があります', { exact: true })).toHaveCount(0)
}
async function roundtrip(page: Page) {
  const expected = await page.evaluate(() => window.__karu!.getOutline())
  const bytes = await page.evaluate(async () => Array.from((await window.__karu!.saveToBytes())!))
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '架空の再読込.pdf'), bytes)
  await openOutline(page)
  expect(await page.evaluate(() => window.__karu!.getOutline())).toEqual(expected)
  return expected!
}
async function drag(page: Page, source: string, target: string, fraction: number) {
  const origin = row(page, source), destination = row(page, target)
  const sourceBox = await origin.boundingBox(), targetBox = await destination.boundingBox()
  if (!sourceBox || !targetBox) throw new Error('ドラッグ対象がありません。')
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + 13)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height * fraction, { steps: 12 })
  // Native dragover needs another mouse move in Chromium.
  await page.mouse.move(targetBox.x + targetBox.width / 2 + 1, targetBox.y + targetBox.height * fraction)
  await page.mouse.up()
}

test('空の目次から日本語の項目を作成し、反映と保存・再読込を行う', async ({ page }) => {
  await open(page)
  await openOutline(page)
  await expect(page.getByText('目次がありません', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '表示中のページで目次を作成', exact: true }).click()
  await expect(page.getByLabel('名称', { exact: true })).toBeFocused()
  await rename(page, '架空の設備計画①')
  await apply(page)
  await expect(page.getByRole('button', { name: /未保存/ }).getByLabel('未保存', { exact: true })).toBeVisible()
  expect((await roundtrip(page)).items).toMatchObject([{ title: '架空の設備計画①', target: { kind: 'page', pageIndex: 0 } }])
  await expect(row(page, '架空の設備計画①')).toBeVisible()
})

test('多階層・色・URI・XYZを表示し、移動と開閉、編集後の情報保存を行う', async ({ page }) => {
  await open(page, true)
  await page.evaluate(() => window.__karu!.setZoom(2))
  await openOutline(page)
  await expect(row(page, '架空の章')).toHaveAttribute('aria-level', '1')
  await expect(row(page, '架空の節')).toHaveAttribute('aria-level', '2')
  await expect(row(page, '架空の小節')).toHaveAttribute('aria-level', '3')
  await expect(row(page, '架空の付録')).toContainText('p.5')
  await expect(row(page, '架空の章').locator('.outline-title')).toHaveCSS('font-style', 'italic')
  await expect(row(page, '架空の章').locator('.outline-title')).toHaveCSS('font-weight', '700')
  await expect(row(page, '架空の章').locator('.outline-title')).toHaveCSS('color', 'rgb(64, 128, 191)')
  await row(page, '架空の付録').click()
  await expect(page.getByText('5 / 5 ページ', { exact: true })).toBeVisible()
  const zoom = await page.getByTestId('viewer').getAttribute('data-zoom')
  await row(page, '架空の外部').click()
  await expect(page.getByText('外部リンク: https://example.test/fictional-outline（かるPDFからは開きません）', { exact: true })).toBeVisible()
  await expect(page.getByText('5 / 5 ページ', { exact: true })).toBeVisible()
  expect(page.context().pages()).toHaveLength(1)
  await row(page, '架空の章').getByRole('button', { name: '架空の章を閉じる' }).click()
  await expect(row(page, '架空の節')).toHaveCount(0)
  await row(page, '架空の章').getByRole('button', { name: '架空の章を開く' }).click()
  await row(page, '架空の章').click()
  await expect(page.getByText('1 / 5 ページ', { exact: true })).toBeVisible()
  expect(await page.getByTestId('viewer').getAttribute('data-zoom')).toBe(zoom)
  await expect.poll(() => page.evaluate(() => {
    const viewer = document.querySelector<HTMLElement>('[data-testid="viewer"]')!
    const layer = document.querySelector('[data-testid="annotation-layer-0"]')
    if (!layer) return Infinity
    const box = viewer.getBoundingClientRect(), pageBox = layer.getBoundingClientRect()
    const scale = Number(viewer.dataset.zoom) * 96 / 72
    return Math.max(Math.abs(pageBox.left + 80 * scale - box.left - viewer.clientLeft),
      Math.abs(pageBox.top + 200 * scale - box.top - viewer.clientTop))
  })).toBeLessThan(3)
  await rename(page, '架空の章・改名')
  await page.getByLabel('移動先のページ番号').fill('2')
  await page.getByRole('button', { name: '設定', exact: true }).click()
  await row(page, '架空の外部').click()
  await rename(page, '架空の外部・改名')
  await apply(page)
  await expect(page.getByText('未反映の変更があります', { exact: true })).toHaveCount(0)
  const snapshot = await roundtrip(page)
  expect(snapshot.items[0]).toMatchObject({ title: '架空の章・改名', style: { bold: true, italic: true, color: [0.25, 0.5, 0.75] }, target: { kind: 'page', pageIndex: 1, view: { type: 'XYZ', params: [80, 700, 1.5] } } })
  expect(snapshot.items[2].target).toEqual({ kind: 'external', uri: 'https://example.test/fictional-outline' })
})

test('子の追加・改名・上下と階層・Undo/Redo・子を残す削除・ドラッグを操作する', async ({ page }) => {
  await open(page, true); await openOutline(page)
  await row(page, '架空の付録').click()
  const field = page.getByLabel('名称', { exact: true })
  await field.fill('取り消す名前'); await field.press('Escape')
  await expect(field).toHaveValue('架空の付録')
  await field.fill('  '); await field.press('Enter')
  await expect(field).toHaveValue('架空の付録')
  await expect(page.getByRole('alert').filter({ hasText: '目次の名称を入力してください' })).toBeVisible()
  await page.locator('.outline-add-menu summary').click()
  await page.getByRole('button', { name: '子として追加', exact: true }).click()
  await rename(page, '架空の追加項目')
  await expect(row(page, '架空の追加項目')).toHaveAttribute('aria-level', '2')
  await page.getByRole('button', { name: '階層を上げる', exact: true }).click()
  await expect(row(page, '架空の追加項目')).toHaveAttribute('aria-level', '1')
  await page.getByRole('button', { name: '上へ移動', exact: true }).click()
  expect((await draftItems(page)).map(item => item.title)).toEqual(['架空の章', '架空の追加項目', '架空の付録', '架空の外部'])
  await page.getByRole('button', { name: '下へ移動', exact: true }).click()
  await page.getByRole('button', { name: '階層を下げる', exact: true }).click()
  await expect(row(page, '架空の追加項目')).toHaveAttribute('aria-level', '2')
  const tree = page.getByRole('tree', { name: '目次', exact: true })
  await tree.focus(); await tree.press('Control+z')
  await expect(row(page, '架空の追加項目')).toHaveAttribute('aria-level', '1')
  await tree.press('Control+y')
  await expect(row(page, '架空の追加項目')).toHaveAttribute('aria-level', '2')
  await row(page, '架空の付録').click()
  await page.getByRole('button', { name: '削除', exact: true }).click()
  await page.getByRole('dialog', { name: '目次の削除' }).getByRole('button', { name: '子項目を残して削除（上の階層へ移す）', exact: true }).click()
  await expect(row(page, '架空の付録')).toHaveCount(0)
  await expect(row(page, '架空の追加項目')).toHaveAttribute('aria-level', '1')
  await drag(page, '架空の追加項目', '架空の章', .1)
  expect((await draftItems(page))[0].title).toBe('架空の追加項目')
  const beforeInvalidMove = await draftItems(page)
  await drag(page, '架空の章', '架空の小節', .5)
  expect(await draftItems(page)).toEqual(beforeInvalidMove)
  await drag(page, '架空の追加項目', '架空の章', .5)
  await expect(row(page, '架空の追加項目')).toHaveAttribute('aria-level', '2')
  await apply(page)
  await expect(page.getByText('未反映の変更があります', { exact: true })).toHaveCount(0)
  await roundtrip(page)
})

test('未反映の下書きがあると閉じる確認を行い、整理・ヘッダー操作を拒否する', async ({ page }) => {
  await open(page); await openOutline(page)
  await page.getByRole('button', { name: '表示中のページで目次を作成', exact: true }).click()
  await rename(page, '架空の未反映')
  const dialogPromise = page.waitForEvent('dialog')
  const closePromise = page.getByRole('button', { name: '架空の目次試験.pdfを閉じる', exact: true }).click()
  const dialog = await dialogPromise
  expect(dialog.message()).toContain('目次に反映していない変更があります')
  await dialog.dismiss(); await closePromise
  await expect(row(page, '架空の未反映')).toBeVisible()
  await page.evaluate(() => window.__karu!.openOrganize())
  await expect(page.getByText('目次に反映していない変更があります。［目次を反映］するか［変更を破棄］してから操作してください。', { exact: true })).toBeVisible()
  await expect(page.getByTestId('organize-view')).toHaveCount(0)
  expect(await page.evaluate(() => window.__karu!.removeHeaderFooter())).toBeNull()
  await expect(row(page, '架空の未反映')).toBeVisible()
})

test('保存時に未反映の変更を含めるか選べ、除いて保存しても下書きが残る', async ({ page }) => {
  await open(page); await openOutline(page)
  await page.getByRole('button', { name: '表示中のページで目次を作成', exact: true }).click()
  await rename(page, '架空の保存前確認')
  page.once('dialog', dialog => dialog.dismiss())
  const omitted = await page.evaluate(async () => Array.from((await window.__karu!.saveToBytes())!))
  const document = new mupdf.PDFDocument(new Uint8Array(omitted))
  try { expect(readOutline(document).itemCount).toBe(0) } finally { document.destroy() }
  expect(await page.evaluate(() => window.__karu!.outlineDraft()!.isChanged())).toBe(true)
  await page.getByRole('tab', { name: 'ページ', exact: true }).click()
  page.once('dialog', dialog => dialog.accept())
  const included = await page.evaluate(async () => Array.from((await window.__karu!.saveToBytes())!))
  await openOutline(page)
  await expect(row(page, '架空の保存前確認')).toHaveAttribute('aria-selected', 'true')
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '架空の保存確認.pdf'), included)
  await openOutline(page)
  await expect(row(page, '架空の保存前確認')).toBeVisible()
})

test('目次タブを開くまでパネルと下書きを作らず、表示メニューから開ける', async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as Window & { __outlineReadRequests?: number }
    target.__outlineReadRequests = 0
    const original = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (message, options) {
      if (message?.type === 'getOutline') target.__outlineReadRequests!++
      return Reflect.apply(original, this, [message, options])
    }
  })
  await open(page, true)
  expect(await page.evaluate(() => (window as Window & { __outlineReadRequests?: number }).__outlineReadRequests)).toBe(0)
  await expect(page.getByTestId('outline-panel')).toHaveCount(0)
  expect(await page.evaluate(() => window.__karu!.outlineDraft())).toBeNull()
  await page.getByRole('button', { name: '表示▼', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: '目次（しおり）', exact: true }).click()
  await expect(row(page, '架空の章')).toBeVisible()
  expect(await page.evaluate(() => (window as Window & { __outlineReadRequests?: number }).__outlineReadRequests)).toBeGreaterThan(0)
})

test('多数の項目は表示範囲だけ描画し、文書の切り替えで選択とスクロールを保つ', async ({ page }) => {
  await open(page, false, 600); await openOutline(page)
  expect(await page.getByRole('treeitem').count()).toBeLessThan(200)
  const tree = page.getByRole('tree', { name: '目次', exact: true })
  await tree.evaluate(element => { element.scrollTop = 6000 })
  await expect(row(page, '架空項目240')).toBeVisible()
  await row(page, '架空項目240').click()
  await page.getByRole('tab', { name: 'ページ', exact: true }).click()
  await openOutline(page)
  await expect(row(page, '架空項目240')).toHaveAttribute('aria-selected', 'true')
  expect(await tree.evaluate(element => element.scrollTop)).toBeGreaterThan(5000)
  const first = (await page.evaluate(() => window.__karu!.listTabs()))[0].docId
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '架空の別文書.pdf'), fixture())
  await openOutline(page)
  await expect(page.getByText('目次がありません', { exact: true })).toBeVisible()
  await page.evaluate(id => window.__karu!.activateTab(id), first)
  await expect(row(page, '架空項目240')).toHaveAttribute('aria-selected', 'true')
})
