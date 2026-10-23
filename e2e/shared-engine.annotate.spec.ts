import path from 'node:path'
import { expect, test } from '@playwright/test'
test.use({ serviceWorkers: 'block' })

test('4つのPDF Workerが表示エンジンを1回の取得で共有し、PDFを描画する', async ({ page, context }) => {
  const requests: string[] = [], errors: string[] = []
  context.on('request', request => { if (request.url().endsWith('.wasm')) requests.push(request.url()) })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/karu-pdf/?test=1&workers=4&warm=0')
  await page.getByTestId('file-input').setInputFiles(path.resolve('test-data/sample-small.pdf'))
  await expect(page.locator('.page-view[data-page-index="0"]')).toHaveAttribute('data-sharp', 'true')
  expect(page.workers().filter(worker => worker.url().includes('pdf.bootstrap'))).toHaveLength(4)
  expect(requests).toHaveLength(1)
  expect(errors).toEqual([])
})

test('表示エンジンの取得失敗を起動時に通知し、再読込できる', async ({ page, context }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await context.route('**/*.wasm', route => route.fulfill({ status: 503, body: '' }))
  await page.goto('/karu-pdf/?test=1&workers=4')
  await expect(page.getByRole('alert')).toContainText('503')
  await expect(page.getByRole('button', { name: '再読み込み', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
