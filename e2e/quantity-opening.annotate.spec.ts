import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'

declare global {
  interface Window { releaseQuantityLoad(): void }
}

async function holdQuantityLoad(page: Page) {
  // Hold only the metadata request: the viewer still paints normally.
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker
    const pending: Array<() => void> = []
    let released = false
    window.Worker = class extends OriginalWorker {
      override postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
        const send = () => Array.isArray(options) ? super.postMessage(message, options) : super.postMessage(message, options)
        if (!released && (message as { type?: string }).type === 'getCountFixtures') pending.push(send)
        else send()
      }
    }
    window.releaseQuantityLoad = () => { released = true; pending.splice(0).forEach(send => send()) }
  })
  const doc = new mupdf.PDFDocument()
  let bytes: number[]
  try {
    for (let i = 0; i < 3; i++) {
      const ref = doc.addPage([0, 0, 500, 600], 0, {}, '')
      try { doc.insertPage(-1, ref) } finally { ref.destroy() }
    }
    const buffer = doc.saveToBuffer('compress')
    try { bytes = [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { doc.destroy() }
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(data => window.__karu!.openBytes(data, '数量拾いの表示試験.pdf'), bytes)
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('button', { name: '数量拾い', exact: true }).click()
  const panel = page.getByTestId('fixture-panel')
  await expect(panel).toBeVisible({ timeout: 5_000 })
  await expect(panel.getByRole('status')).toContainText('数量拾いを読み込んでいます')
  await expect(panel.getByRole('button', { name: '項目を追加', exact: true })).toBeDisabled()
  return panel
}

test('全ページの準備を待たずに枠を開き、準備後に拾い操作を有効にする', async ({ page }) => {
  const panel = await holdQuantityLoad(page)
  await page.evaluate(() => window.releaseQuantityLoad())
  await expect(panel.getByRole('button', { name: '項目を追加', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: '数量拾い', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

for (const cancel of ['選択ボタン', 'Escape'] as const) test(`読込中に${cancel}で選択へ戻ったら、完了しても数量拾いに戻さない`, async ({ page }) => {
  const panel = await holdQuantityLoad(page)
  if (cancel === 'Escape') await page.keyboard.press('Escape')
  else await page.getByRole('button', { name: '選択', exact: true }).click()
  await page.evaluate(() => window.releaseQuantityLoad())
  await expect(panel.getByRole('button', { name: '項目を追加', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: '選択', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '数量拾い', exact: true })).toHaveAttribute('aria-pressed', 'false')
})
