import fs from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { DRAWING_TEXTS, makeTextExtractFixture } from '../tests/textExtractFixtures'

let pdf: Buffer
test.setTimeout(60_000)
test.use({ actionTimeout: 10_000 })
test.beforeAll(async () => { pdf = Buffer.from(await makeTextExtractFixture()) })

async function setup(page: Page, delay = 0) {
  page.on('pageerror', error => console.log('TEXT_PAGE_ERROR:', error.message))
  await page.addInitScript(delay => {
    const requests: number[] = []
    Object.assign(window, { __textRequestPages: requests })
    const NativeWorker = Worker
    window.Worker = class extends NativeWorker {
      postMessage(message: { type?: string; pageIndex?: number }, transfer?: Transferable[] | StructuredSerializeOptions): void {
        const send = () => { if (Array.isArray(transfer)) super.postMessage(message, transfer); else super.postMessage(message, transfer) }
        if (message.type === 'extractPageText') {
          requests.push(message.pageIndex!)
          if (delay) { setTimeout(send, delay); return }
        }
        send()
      }
    }
  }, delay)
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles({ name: '=図面.pdf', mimeType: 'application/pdf', buffer: pdf })
  await expect.poll(() => page.evaluate(() => window.__karu!.getMetrics().openSharp.count)).toBe(1)
  await expect.poll(() => page.evaluate(() => window.__karu!.isSharp())).toBe(true)
}
const requests = (page: Page) => page.evaluate(() => (window as unknown as { __textRequestPages: number[] }).__textRequestPages)
async function openDialog(page: Page) {
  await page.getByRole('button', { name: 'ファイル▼', exact: true }).click()
  await page.getByRole('menuitem', { name: '図面内文字を抽出…', exact: true }).click()
  return page.getByRole('dialog', { name: '図面内文字を抽出' })
}

test('通常読込と抽出画面を開いただけでは解析せず、実行したページのCSVだけを出す', async ({ page }) => {
  const chunks: string[] = []
  page.on('request', request => { if (request.url().includes('TextExportDialog-')) chunks.push(request.url()) })
  await setup(page)
  expect(await requests(page)).toEqual([])
  expect(chunks).toEqual([])
  const dialog = await openDialog(page)
  await expect(dialog).toBeVisible()
  expect(chunks.length).toBeGreaterThan(0)
  expect(await requests(page)).toEqual([])
  await dialog.getByLabel('図面番号（任意）').fill('Ｅ－０１')
  await dialog.getByRole('button', { name: '文字を抽出', exact: true }).click()
  await expect(dialog.getByRole('link', { name: '抽出結果を保存' })).toBeVisible()
  expect(await requests(page)).toEqual([0])
  const download = page.waitForEvent('download')
  await dialog.getByRole('link', { name: '抽出結果を保存' }).click()
  const csv = await fs.readFile(await (await download).path() as string, 'utf8')
  expect(csv.startsWith('\uFEFF')).toBe(true)
  expect(csv).toContain(DRAWING_TEXTS[0])
  expect(csv).toContain("'=図面.pdf,1,Ｅ－０１")
  expect(csv).not.toContain(DRAWING_TEXTS[3])
  await page.screenshot({ path: 'work/text-export-dialog.png' })
})

test('指定ページの順序・位置・回転と、文字なしをCSVに残す', async ({ page }) => {
  await setup(page)
  const dialog = await openDialog(page)
  await dialog.getByLabel('抽出するページ').selectOption('range')
  await dialog.getByLabel('抽出ページ範囲').fill('4,2-3')
  await dialog.getByRole('button', { name: '文字を抽出', exact: true }).click()
  await expect(dialog.getByRole('link', { name: '抽出結果を保存' })).toBeVisible()
  expect(await requests(page)).toEqual([3, 1, 2])
  const waiting = page.waitForEvent('download')
  await dialog.getByRole('link', { name: '抽出結果を保存' }).click()
  const csv = await fs.readFile(await (await waiting).path() as string, 'utf8')
  expect(csv).toContain(DRAWING_TEXTS[3])
  expect(csv).toContain("\"'=1+1 \"\"quote\"\",comma ")
  expect(csv).toContain('90,横,0,1,抽出')
  expect(csv).toContain('文字なし')
  expect(csv).not.toContain(DRAWING_TEXTS[0])
})

test('全ページのテキスト出力は数式用の文字を付けず、ページを区別する', async ({ page }) => {
  await setup(page)
  const dialog = await openDialog(page)
  await dialog.getByLabel('抽出するページ').selectOption('all')
  await dialog.getByLabel('文字抽出の形式').selectOption('txt')
  await dialog.getByRole('button', { name: '文字を抽出', exact: true }).click()
  await expect(dialog.getByRole('link', { name: '抽出結果を保存' })).toBeVisible()
  const waiting = page.waitForEvent('download')
  await dialog.getByRole('link', { name: '抽出結果を保存' }).click()
  const text = await fs.readFile(await (await waiting).path() as string, 'utf8')
  expect(text).toContain(DRAWING_TEXTS[0]); expect(text).toContain(DRAWING_TEXTS[1])
  expect(text).toContain('3ページ (文字なし)'); expect(text).toContain('4ページ')
})

test('中止とタブ切替では遅いWorker結果を採用しない', async ({ page }) => {
  await setup(page, 1500)
  let dialog = await openDialog(page)
  await dialog.getByLabel('抽出するページ').selectOption('all')
  await dialog.getByRole('button', { name: '文字を抽出', exact: true }).click()
  await expect.poll(() => requests(page)).toEqual([0])
  await dialog.getByRole('button', { name: '中止', exact: true }).click()
  await expect(dialog.getByText('中止しました。出力ファイルは作成していません。')).toBeVisible()
  expect(await requests(page)).toEqual([0])
  await expect(dialog.getByRole('link', { name: '抽出結果を保存' })).toBeHidden()
  await dialog.getByRole('button', { name: '文字を抽出', exact: true }).click()
  await expect.poll(() => requests(page)).toEqual([0, 0])
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '新版.pdf'), [...pdf])
  dialog = page.getByRole('dialog', { name: '図面内文字を抽出' })
  await expect(dialog).toBeVisible()
  await page.waitForTimeout(1600)
  await expect(dialog.getByRole('link', { name: '抽出結果を保存' })).toBeHidden()
})

test('図面のスクロール中は次のページ解析を待機する', async ({ page }) => {
  await setup(page, 300)
  const dialog = await openDialog(page)
  await dialog.getByLabel('抽出するページ').selectOption('all')
  await dialog.getByRole('button', { name: '文字を抽出', exact: true }).click()
  // Observe the first request before its delayed reply. Backoff polling can
  // skip this short interval after the initial one-second quiet period.
  await page.waitForFunction(() => (window as unknown as { __textRequestPages: number[] }).__textRequestPages.length > 0, null, { polling: 'raf' })
  expect(await requests(page)).toEqual([0])
  await page.mouse.move(400, 600)
  for (let index = 0; index < 15; index++) { await page.mouse.wheel(0, index % 2 ? -20 : 20); await page.waitForTimeout(40) }
  expect(await requests(page)).toEqual([0])
  await expect(dialog.getByRole('link', { name: '抽出結果を保存' })).toBeVisible()
  expect(await requests(page)).toEqual([0, 1, 2, 3])
})
