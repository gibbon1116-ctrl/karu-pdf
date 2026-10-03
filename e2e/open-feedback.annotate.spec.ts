import fs from 'node:fs/promises'
import path from 'node:path'
import mupdf from 'mupdf'
import { expect, test } from '@playwright/test'

const sample = path.resolve('test-data/sample-small.pdf')

test('ファイルの読込が終わる前に反応し、初描画で待機表示を消す', async ({ page }) => {
  await page.addInitScript(() => {
    const read = File.prototype.arrayBuffer
    File.prototype.arrayBuffer = async function () {
      await new Promise(resolve => setTimeout(resolve, 1200))
      return read.call(this)
    }
  })
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(sample)
  const feedback = page.getByTestId('pdf-opening')
  await expect(feedback).toBeVisible({ timeout: 500 })
  await expect(feedback).toContainText('PDFを開いています')
  await expect(feedback).toHaveAttribute('title', 'sample-small.pdf')
  await expect(feedback).not.toContainText('%')
  expect(await page.evaluate(() => window.__karu!.listTabs().length)).toBe(0)
  await expect.poll(() => page.evaluate(() => window.__karu!.getMetrics().open.count)).toBe(1)
  await expect(feedback).toBeHidden()
})

test('壊れたPDFとファイル読込失敗で待機を解除し、次のPDFを開ける', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    const read = File.prototype.arrayBuffer
    File.prototype.arrayBuffer = async function () {
      if (this.name === 'read-failure.pdf') throw new Error('ファイルを読み取れません')
      return read.call(this)
    }
  })
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles({ name: 'read-failure.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') })
  await expect(page.getByRole('alert')).toContainText('ファイルを読み取れません')
  await expect(page.getByTestId('pdf-opening')).toBeHidden()
  await page.getByTestId('file-input').setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') })
  await expect(page.getByRole('alert')).toContainText('PDFを開けませんでした')
  await expect(page.getByTestId('pdf-opening')).toBeHidden()
  await page.getByTestId('file-input').setInputFiles(sample)
  await expect(page.getByText('1 / 5')).toBeVisible()
  await expect(page.getByTestId('pdf-opening')).toBeHidden()
  expect(errors).toEqual([])
})

test('複数ファイルを順番に読み、前の描画完了で次の待機表示を消さない', async ({ page }) => {
  const bytes = await fs.readFile(sample)
  await page.addInitScript(() => {
    const read = File.prototype.arrayBuffer
    File.prototype.arrayBuffer = async function () {
      if (this.name === 'second.pdf') await new Promise(resolve => setTimeout(resolve, 1200))
      return read.call(this)
    }
  })
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles([
    { name: 'first.pdf', mimeType: 'application/pdf', buffer: bytes },
    { name: 'second.pdf', mimeType: 'application/pdf', buffer: bytes },
  ])
  await expect(page.getByTestId('pdf-opening')).toHaveAttribute('title', 'second.pdf')
  await expect.poll(() => page.evaluate(() => window.__karu!.listTabs().length)).toBe(2)
  await expect(page.getByTestId('pdf-opening')).toBeHidden()
})

test('ファイルハンドルの取得中にも表示し、同じ文書への切替で待機を解除する', async ({ page }) => {
  const pdfBytes = Array.from(await fs.readFile(sample))
  await page.addInitScript(pdfBytes => {
    const handle = {
      name: 'handle.pdf',
      getFile: async () => {
        await new Promise(resolve => setTimeout(resolve, 1200))
        return new File([new Uint8Array(pdfBytes)], 'handle.pdf', { type: 'application/pdf' })
      },
    }
    Object.assign(window, { showOpenFilePicker: async () => [handle] })
  }, pdfBytes)
  await page.goto('/karu-pdf/?test=1')
  await page.getByRole('button', { name: 'PDFを開く', exact: true }).click()
  await expect(page.getByTestId('pdf-opening')).toHaveAttribute('title', 'handle.pdf', { timeout: 500 })
  await expect(page.getByText('1 / 5')).toBeVisible()
  await expect(page.getByTestId('pdf-opening')).toBeHidden()
  await page.getByRole('button', { name: 'PDFを開く', exact: true }).click()
  await expect(page.getByTestId('pdf-opening')).toBeVisible()
  await expect(page.getByTestId('pdf-opening')).toBeHidden()
  expect(await page.evaluate(() => window.__karu!.listTabs().length)).toBe(1)
})

test('Worker初期化失敗は待ち続けずエラーにする', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = Worker
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        queueMicrotask(() => this.dispatchEvent(new ErrorEvent('error', { message: 'Worker初期化の失敗' })))
      }
    }
  })
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(sample)
  await expect(page.getByRole('alert')).toContainText('Worker初期化の失敗')
  await expect(page.getByTestId('pdf-opening')).toBeHidden()
})

test('ドロップイベント中に全ハンドルを要求し、取得失敗でも待機を残さない', async ({ page }) => {
  const pdfBytes = Array.from(await fs.readFile(sample))
  await page.goto('/karu-pdf/?test=1')
  await expect(page.getByTestId('file-input')).toBeAttached()
  const requested = await page.evaluate(pdfBytes => {
    const data = new DataTransfer()
    let requested = 0
    const prototype = DataTransferItem.prototype
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'getAsFileSystemHandle')!
    Object.defineProperty(prototype, 'getAsFileSystemHandle', { configurable: true, value: function (this: DataTransferItem) {
      requested++
      const file = this.getAsFile()!
      return new Promise(resolve => setTimeout(() => resolve({ name: file.name, getFile: async () => file }), 1200))
    } })
    for (const name of ['drop-first.pdf', 'drop-second.pdf']) {
      const file = new File([new Uint8Array(pdfBytes)], name, { type: 'application/pdf' })
      data.items.add(file)
    }
    document.querySelector('main.app')!.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: data }))
    Object.defineProperty(prototype, 'getAsFileSystemHandle', descriptor)
    return requested
  }, pdfBytes)
  expect(requested).toBe(2)
  await expect(page.getByTestId('pdf-opening')).toHaveAttribute('title', 'drop-first.pdf', { timeout: 500 })
  expect(await page.evaluate(() => window.__karu!.listTabs().length)).toBe(0)
  await expect.poll(() => page.evaluate(() => window.__karu!.listTabs().length)).toBe(2)
  await expect(page.getByTestId('pdf-opening')).toBeHidden()
  await page.evaluate(() => {
    const data = new DataTransfer()
    data.items.add(new File(['bad'], 'drop-failure.pdf', { type: 'application/pdf' }))
    const prototype = DataTransferItem.prototype
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'getAsFileSystemHandle')!
    Object.defineProperty(prototype, 'getAsFileSystemHandle', { configurable: true, value: () => Promise.reject(new Error('ハンドル取得失敗')) })
    document.querySelector('main.app')!.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: data }))
    Object.defineProperty(prototype, 'getAsFileSystemHandle', descriptor)
  })
  await expect(page.getByRole('alert')).toContainText('ハンドル取得失敗')
  await expect(page.getByTestId('pdf-opening')).toBeHidden()
})

test('初ページの描画失敗でも待機表示を解除する', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = Worker
    window.Worker = class extends NativeWorker {
      postMessage(message: { type?: string }, transfer?: Transferable[] | StructuredSerializeOptions): void {
        if (message.type === 'render') {
          queueMicrotask(() => this.dispatchEvent(new ErrorEvent('error', { message: '描画の失敗' })))
          return
        }
        if (Array.isArray(transfer)) super.postMessage(message, transfer)
        else super.postMessage(message, transfer)
      }
    }
  })
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(sample)
  await expect(page.getByRole('alert')).toContainText('描画の失敗')
  await expect(page.getByTestId('pdf-opening')).toBeHidden()
})

test('0ページPDFと文書数の上限で待機を残さない', async ({ page }) => {
  const document = new mupdf.PDFDocument()
  const saved = document.saveToBuffer('compress')
  const empty = Buffer.from(saved.asUint8Array())
  saved.destroy(); document.destroy()
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles({ name: 'empty.pdf', mimeType: 'application/pdf', buffer: empty })
  await expect(page.getByRole('alert')).toContainText('ページがありません')
  await expect(page.getByTestId('pdf-opening')).toBeHidden()
  const pdfBytes = Array.from(await fs.readFile(sample))
  for (let index = 0; index < 8; index++) await page.evaluate(({ pdfBytes, index }) => window.__karu!.openBytes(pdfBytes, `${index}.pdf`), { pdfBytes, index })
  await page.getByTestId('file-input').setInputFiles(sample)
  await expect(page.getByRole('alert')).toContainText('8ファイルまで')
  await expect(page.getByTestId('pdf-opening')).toBeHidden()
  expect(await page.evaluate(() => window.__karu!.listTabs().length)).toBe(8)
})
