import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import { applyOutline, readOutline } from '../src/core/outline'
import { pdfOperation } from '../src/core/editTransaction'
import type { OutlineItem, OutlinePlanItem } from '../src/core/outlineModel'

// Synthetic documents only. These tests are authored here and run by Claude Code.
function fixture(withOutline: boolean): number[] {
  const doc = new mupdf.PDFDocument()
  try {
    for (let i = 0; i < 5; i++) {
      const ref = doc.addPage([0, 0, 600, 900], 0, {}, '')
      try { doc.insertPage(-1, ref) } finally { ref.destroy() }
    }
    if (withOutline) {
      const item = (id: string, title: string, pageIndex: number, children: OutlinePlanItem[] = []): OutlinePlanItem => ({
        id: `new:${id}`, title, open: !!children.length, target: { kind: 'page', pageIndex, view: null }, children,
      })
      pdfOperation(doc, () => applyOutline(doc, { baseRevision: readOutline(doc).revision, items: [
        item('parent', '架空の章', 0, [item('child', '架空の子項目', 2)]), item('appendix', '架空の付録', 4),
      ] }))
    }
    const buffer = doc.saveToBuffer('compress')
    try { return Array.from(buffer.asUint8Array()) } finally { buffer.destroy() }
  } finally { doc.destroy() }
}
async function open(page: Page, withOutline = true) {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '架空の連携試験.pdf'), fixture(withOutline))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
}
async function openOutline(page: Page) {
  await page.getByRole('tab', { name: '目次', exact: true }).click()
  await expect(page.getByRole('tree', { name: '目次', exact: true })).toBeVisible()
}
async function deleteFirst(page: Page) {
  await page.evaluate(async () => {
    await window.__karu!.openOrganize()
    window.__karu!.organizeDraft()!.delete(['page-1'])
  })
  await page.getByTestId('organize-view').getByRole('button', { name: '適用', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '目次が指すページが変わります', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}
async function snapshot(page: Page) { return page.evaluate(() => window.__karu!.getOutline()) }
async function draftItems(page: Page) { return page.evaluate(() => window.__karu!.outlineDraft()!.getItems()) }
async function appliedLayout(page: Page) {
  await expect(page.getByTestId('organize-view')).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: '目次が指すページが変わります', exact: true })).toHaveCount(0)
}
async function drawingDialog(page: Page) {
  await page.getByRole('button', { name: '図面情報から目次を作成', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '図面情報から目次を作成', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

test('目次の削除前に確認し、やめると整理の下書きと元の目次を残してbusyを解除する', async ({ page }) => {
  await open(page)
  const before = await snapshot(page), dialog = await deleteFirst(page)
  await expect(dialog).toContainText('架空の章')
  await expect(dialog).toContainText('元の1ページ')
  await expect(dialog).toContainText('子項目あり')
  await expect(dialog.getByRole('button', { name: '適用', exact: true })).toBeDisabled()
  await dialog.getByRole('radio', { name: 'ページ整理をやめる', exact: true }).check()
  await dialog.getByRole('button', { name: '適用', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('organize-view')).toBeVisible()
  await expect(page.getByTestId('organize-view').getByRole('button', { name: '適用', exact: true })).toBeEnabled()
  expect(await page.evaluate(() => window.__karu!.organizeDraft()!.getCards().length)).toBe(4)
  expect(await snapshot(page)).toEqual(before)
  await expect(page.getByText(/ページ整理を適用できませんでした/)).toHaveCount(0)
})

test('該当目次を削除すると子は上の階層に残り、他の移動先も新しいページ番号になる', async ({ page }) => {
  await open(page)
  const dialog = await deleteFirst(page)
  await dialog.getByRole('radio', { name: '該当する目次を削除する（子項目は上の階層に残す）', exact: true }).check()
  await dialog.getByRole('button', { name: '適用', exact: true }).click()
  await appliedLayout(page)
  expect((await snapshot(page))!.items).toMatchObject([
    { title: '架空の子項目', target: { kind: 'page', pageIndex: 1 }, children: [] },
    { title: '架空の付録', target: { kind: 'page', pageIndex: 3 }, children: [] },
  ])
  expect((await snapshot(page))!.itemCount).toBe(2)
})

test('付け替えは空欄・範囲外・小数を拒否し、利用者が指定した整理後のページに設定する', async ({ page }) => {
  await open(page)
  const dialog = await deleteFirst(page)
  await dialog.getByRole('radio', { name: '新しいページを移動先に指定する', exact: true }).check()
  const input = dialog.getByRole('spinbutton'), apply = dialog.getByRole('button', { name: '適用', exact: true })
  for (const value of ['', '0', '5', '1.5']) { await input.fill(value); await expect(apply).toBeDisabled() }
  await input.fill('4'); await expect(apply).toBeEnabled(); await apply.click()
  await appliedLayout(page)
  expect((await snapshot(page))!.items).toMatchObject([
    { title: '架空の章', target: { kind: 'page', pageIndex: 3 }, children: [{ title: '架空の子項目', target: { kind: 'page', pageIndex: 1 } }] },
    { title: '架空の付録', target: { kind: 'page', pageIndex: 3 } },
  ])
})

test('並べ替えだけなら確認を出さずに適用して目次の移動先を維持する', async ({ page }) => {
  await open(page)
  await page.evaluate(async () => { await window.__karu!.openOrganize(); window.__karu!.organizeDraft()!.move(['page-5'], 0) })
  // Awaiting the hook also detects an unexpected confirmation: that promise would remain pending.
  expect(await page.evaluate(() => window.__karu!.applyOrganize())).not.toBeNull()
  await appliedLayout(page)
  expect((await snapshot(page))!.items).toMatchObject([
    { title: '架空の章', target: { kind: 'page', pageIndex: 1 }, children: [{ title: '架空の子項目', target: { kind: 'page', pageIndex: 3 } }] },
    { title: '架空の付録', target: { kind: 'page', pageIndex: 0 } },
  ])
})

test('目次のないPDFは確認を出さずに従来どおりページ整理できる', async ({ page }) => {
  await open(page, false)
  await page.evaluate(async () => { await window.__karu!.openOrganize(); window.__karu!.organizeDraft()!.delete(['page-1']) })
  expect(await page.evaluate(() => window.__karu!.applyOrganize())).not.toBeNull()
  await appliedLayout(page)
  expect((await page.evaluate(() => window.__karu!.getPageInfo())).length).toBe(4)
  expect((await snapshot(page))!.items).toEqual([])
})

test('元ページより前の複製先を指す場合は明示的な位置の確認を必須にする', async ({ page }) => {
  await open(page)
  await page.evaluate(async () => {
    await window.__karu!.openOrganize()
    const draft = window.__karu!.organizeDraft()!, copies = draft.duplicate(['page-1'])
    draft.move([copies[0].id], 0)
  })
  await page.getByTestId('organize-view').getByRole('button', { name: '適用', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '目次が指すページが変わります', exact: true })
  await expect(dialog).toContainText('目次は整理後の最初の位置（1ページ）を指します。')
  await dialog.getByRole('radio', { name: '該当する目次を削除する（子項目は上の階層に残す）', exact: true }).check()
  await expect(dialog.getByRole('button', { name: '適用', exact: true })).toBeDisabled()
  await dialog.getByRole('checkbox', { name: 'この位置で続ける', exact: true }).check()
  await dialog.getByRole('button', { name: '適用', exact: true }).click()
  await appliedLayout(page)
  expect((await snapshot(page))!.items[0]).toMatchObject({ title: '架空の章', target: { kind: 'page', pageIndex: 0 } })
  expect((await snapshot(page))!.itemCount).toBe(3)
})

test('図面候補の修正・追加・繰り返し追加・置き換えとUndo、反映・保存・再読込を行う', async ({ page }) => {
  await open(page)
  await page.evaluate(() => {
    for (let i = 0; i < 5; i++) window.__karu!.setDrawingInfo(i, { scanned: true })
    window.__karu!.setDrawingInfo(0, { number: 'E-001', name: '架空配置図', scanned: true })
    window.__karu!.setDrawingInfo(2, { number: 'M101', name: '架空平面図', scanned: true })
    window.__karu!.setDrawingInfo(4, { number: 'E-002', name: '架空詳細図', scanned: true })
  })
  await openOutline(page)
  const original = await draftItems(page)
  let dialog = await drawingDialog(page)
  await expect(dialog.getByRole('checkbox', { name: '図面番号の英字の頭でまとめる', exact: true })).not.toBeChecked()
  const title = dialog.getByRole('textbox', { name: '1ページの名称', exact: true })
  await title.fill(' ')
  await expect(dialog.getByRole('button', { name: '目次の下書きに入れる', exact: true })).toBeDisabled()
  await title.fill('修正した架空配置図')
  await dialog.getByRole('button', { name: '5ページを上へ', exact: true }).click()
  await dialog.getByRole('button', { name: '目次の下書きに入れる', exact: true }).click()
  let items = await draftItems(page)
  expect(items.slice(2).map(item => item.title)).toEqual(['修正した架空配置図', 'E-002 架空詳細図', 'M101 架空平面図'])
  // Import twice before applying: generated ids must not collide with earlier imports.
  dialog = await drawingDialog(page)
  await dialog.getByRole('button', { name: '目次の下書きに入れる', exact: true }).click()
  expect(await page.evaluate(() => {
    const ids: string[] = []
    const visit = (list: readonly OutlineItem[]) => {
      for (const item of list) { ids.push(item.id); visit(item.children) }
    }
    visit([...window.__karu!.outlineDraft()!.getItems()]); return new Set(ids).size === ids.length
  })).toBe(true)
  await page.getByRole('button', { name: '目次の操作を元に戻す', exact: true }).click()
  await page.getByRole('button', { name: '目次の操作を元に戻す', exact: true }).click()
  expect(await draftItems(page)).toEqual(original)
  dialog = await drawingDialog(page)
  await dialog.getByRole('textbox', { name: '1ページの名称', exact: true }).fill('修正した架空配置図')
  await dialog.getByRole('checkbox', { name: '図面番号の英字の頭でまとめる', exact: true }).check()
  await expect(dialog.getByText('（推定）', { exact: true })).toHaveCount(2)
  await dialog.getByRole('textbox', { name: 'Eのグループ名', exact: true }).fill('確認した電気図')
  await dialog.getByRole('radio', { name: '既存の目次を置き換える', exact: true }).check()
  await expect(dialog).toContainText('次の目次（3件）が削除されます')
  await expect(dialog).toContainText('架空の子項目')
  await dialog.getByRole('button', { name: '目次の下書きに入れる', exact: true }).click()
  items = await draftItems(page)
  expect(items.map(item => item.title)).toEqual(['確認した電気図', '機械設備図'])
  expect(items[0].children.map(item => item.title)).toEqual(['修正した架空配置図', 'E-002 架空詳細図'])
  await page.getByRole('button', { name: '目次の操作を元に戻す', exact: true }).click()
  expect(await draftItems(page)).toEqual(original)
  await page.getByRole('button', { name: '目次の操作をやり直す', exact: true }).click()
  expect(await draftItems(page)).toEqual(items)
  await page.getByRole('button', { name: '目次を反映', exact: true }).click()
  await expect(page.getByText('未反映の変更があります', { exact: true })).toHaveCount(0)
  const expected = await snapshot(page)
  const bytes = await page.evaluate(async () => Array.from((await window.__karu!.saveToBytes())!))
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '架空の再読込.pdf'), bytes)
  await openOutline(page)
  expect(await snapshot(page)).toEqual(expected)
})

test('図面作成画面を開くだけでは未読取りページを解析せず、キャンセルは下書きを変えない', async ({ page }) => {
  await open(page, false); await openOutline(page)
  const original = await draftItems(page), before = await page.evaluate(() => window.__karu!.getDrawingInfos())
  const dialog = await drawingDialog(page)
  await expect(dialog).toContainText('まだ読み取っていないページがあります')
  await expect(dialog.getByRole('button', { name: '図面番号・図面名称を読み取る', exact: true })).toBeEnabled()
  await expect(dialog.getByRole('button', { name: '目次の下書きに入れる', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => window.__karu!.getDrawingScanMetrics().scanning)).toBe(false)
  expect(await page.evaluate(() => window.__karu!.getDrawingInfos())).toEqual(before)
  await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click()
  expect(await draftItems(page)).toEqual(original)
})
