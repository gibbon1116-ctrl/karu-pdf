import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'

test.use({ serviceWorkers: 'block' })
test.setTimeout(90_000)

const stoppedKey = 'karu-pdf.publicationStopped'
const stoppedText = 'かるPDF（通常版）は公開を終了しました。'
const noticeText = '公開を終了しました。開いているPDFを保存して閉じてください。次回から起動しません。'
const appURL = '/karu-pdf/?test=1&warm=0'

async function seedStoppedRecord(page: Page) {
  await page.addInitScript(key => {
    if (!sessionStorage.getItem('publication-test-seeded')) {
      localStorage.setItem(key, '1')
      sessionStorage.setItem('publication-test-seeded', '1')
    }
  }, stoppedKey)
}

test('active なら通常の画面を表示し、停止画面も通知も出ない', async ({ page }) => {
  let requests = 0
  await page.route('**/app-status.json', route => {
    requests++
    expect(route.request().url()).not.toContain('?')
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"active"}' })
  })
  await page.goto(appURL)
  await expect(page.getByRole('button', { name: 'PDFを開く', exact: true })).toBeVisible()
  await expect.poll(() => requests).toBe(1)
  await expect(page.getByText(stoppedText, { exact: true })).toHaveCount(0)
  await expect(page.getByText(noticeText, { exact: true })).toHaveCount(0)
  expect(await page.evaluate(key => localStorage.getItem(key), stoppedKey)).toBeNull()
})

test('PDF が無ければ、2回の404で停止画面に切り替える', async ({ page }) => {
  let requests = 0
  await page.route('**/app-status.json', route => { requests++; return route.fulfill({ status: 404, body: '' }) })
  await page.goto(appURL)
  await expect(page.getByText(stoppedText, { exact: true })).toBeVisible()
  expect(requests).toBe(2)
  const main = page.getByRole('main')
  await expect(main.locator('p')).toHaveCount(3)
  await expect(main).toContainText('保存済みのPDFは、ほかのPDFソフトで開けます。')
  await expect(main).toContainText('Copyright (C) 2026 gibbon1116-ctrl')
  await expect(page.getByRole('button')).toHaveCount(0)
  await expect(page.getByRole('link')).toHaveCount(0)
  expect(await page.evaluate(key => localStorage.getItem(key), stoppedKey)).toBe('1')
})

test('PDF を開いている間は通知だけ表示し、編集・保存・閉じる操作を継続できる', async ({ page }) => {
  // Start the real request after opening the sample, without depending on machine speed.
  await page.addInitScript(() => {
    let sequence = 0
    const pending = new Map<number, IdleRequestCallback>()
    window.requestIdleCallback = callback => { pending.set(++sequence, callback); return sequence }
    window.cancelIdleCallback = id => { pending.delete(id) }
    window.addEventListener('publication-test-idle', () => {
      const callbacks = [...pending.values()]
      pending.clear()
      callbacks.forEach(callback => callback({ didTimeout: false, timeRemaining: () => 50 }))
    })
  })
  let requests = 0
  await page.route('**/app-status.json', route => { requests++; return route.fulfill({ status: 404, body: '' }) })
  await page.goto(appURL)
  await page.getByTestId('file-input').setInputFiles(path.resolve('test-data/sample-small.pdf'))
  const pdfPage = page.locator('.page-view[data-page-index="0"]')
  await expect(pdfPage).toHaveAttribute('data-sharp', 'true')
  expect(requests).toBe(0)
  await page.evaluate(() => window.dispatchEvent(new Event('publication-test-idle')))
  const notice = page.locator('.update-banner')
  await expect(notice).toHaveText(noticeText)
  expect(requests).toBe(2)
  await expect(notice.getByRole('button')).toHaveCount(0)
  await expect(pdfPage).toBeVisible()
  await expect(page.getByText(stoppedText, { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: '文字', exact: true }).click()
  await page.getByTestId('annotation-layer-0').click({ position: { x: 120, y: 300 } })
  await page.getByTestId('text-editor').fill('公開終了後の保存確認')
  await page.keyboard.press('Control+Enter')
  await expect(page.getByTestId('text-editor')).toBeHidden()
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).some(item => item.text === '公開終了後の保存確認'))).toBe(true)
  // Use the existing Save As UI and verify an actual PDF download.
  await page.evaluate(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }) })
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'ファイル▼' }).click()
  await page.getByRole('menuitem', { name: '別名で保存', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i)
  expect(await download.failure()).toBeNull()
  await expect(notice).toHaveText(noticeText)
  await expect(pdfPage).toBeVisible()
  await page.getByRole('button', { name: 'sample-small.pdfを閉じる', exact: true }).click()
  await expect(page.getByText(stoppedText, { exact: true })).toBeVisible()
})

test('停止記録があればオフラインの再読み込みでも停止したままで、Worker とエンジンを起動しない', async ({ page }) => {
  await seedStoppedRecord(page)
  let checks = 0
  await page.route('**/app-status.json', route => { checks++; return route.abort() })
  const workers: string[] = [], engines: string[] = []
  page.on('worker', worker => workers.push(worker.url()))
  page.on('request', request => { if (request.url().includes('.wasm')) engines.push(request.url()) })
  await page.goto(appURL)
  await expect(page.getByText(stoppedText, { exact: true })).toBeVisible()
  await expect.poll(() => checks).toBe(1)
  await page.reload()
  await expect(page.getByText(stoppedText, { exact: true })).toBeVisible()
  await expect.poll(() => checks).toBe(2)
  await expect(page.getByRole('button')).toHaveCount(0)
  expect(await page.evaluate(key => localStorage.getItem(key), stoppedKey)).toBe('1')
  expect(workers).toEqual([])
  expect(page.workers()).toHaveLength(0)
  expect(engines).toEqual([])
})

test('停止記録があっても active が確認できれば記録を消して再読み込みし、通常画面へ戻る', async ({ page }) => {
  await seedStoppedRecord(page)
  await page.route('**/app-status.json', route => route.abort())
  await page.goto(appURL)
  await expect(page.getByText(stoppedText, { exact: true })).toBeVisible()
  await page.unroute('**/app-status.json')
  let checks = 0
  await page.route('**/app-status.json', route => {
    checks++
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"active"}' })
  })
  let navigations = 0
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++ })
  await page.reload()
  await expect.poll(() => navigations).toBe(2)
  await expect(page.getByRole('button', { name: 'PDFを開く', exact: true })).toBeVisible()
  await expect(page.getByText(stoppedText, { exact: true })).toHaveCount(0)
  expect(await page.evaluate(key => localStorage.getItem(key), stoppedKey)).toBeNull()
  expect(checks).toBeGreaterThanOrEqual(1)
})
