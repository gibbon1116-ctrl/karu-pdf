import fs from 'node:fs/promises'
import path from 'node:path'
import mupdf from 'mupdf'
import { expect, test } from '@playwright/test'

const sample = path.resolve('test-data/sample-small.pdf')

test('確定出力は注釈を焼き付け、開いている文書は編集可能なままにする', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(sample)
  await expect(page.getByText('1 / 5')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).length)).toBeGreaterThan(0)

  const before = await page.evaluate(() => ({
    tabs: window.__karu!.listTabs(),
    annotations: window.__karu!.getEditableAnnotations(0).map((item) => ({ id: item.id, kind: item.kind })),
  }))
  const finalized = await page.evaluate(async () => Array.from((await window.__karu!.finalizeToBytes())!))
  const after = await page.evaluate(() => ({
    tabs: window.__karu!.listTabs(),
    annotations: window.__karu!.getEditableAnnotations(0).map((item) => ({ id: item.id, kind: item.kind })),
  }))
  expect(after).toEqual(before)

  const document = new mupdf.PDFDocument(Uint8Array.from(finalized))
  try {
    const outputPage = document.loadPage(0)
    try {
      const annotations = outputPage.getAnnotations()
      try { expect(annotations).toHaveLength(0) } finally { annotations.forEach((item) => item.destroy()) }
      const text = outputPage.toStructuredText('preserve-spans')
      try { expect(text.asText()).toContain('Existing note') } finally { text.destroy() }
    } finally { outputPage.destroy() }
  } finally { document.destroy() }
})

test('確定保存ボタンとCtrl+Pが別出力を作り、開いている文書を変えない', async ({ page, context }) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      __finalizedBytes: [] as number[],
      __finalizedName: '',
      showSaveFilePicker: async (options: { suggestedName?: string }) => {
        ;(window as unknown as Window & { __finalizedName: string }).__finalizedName = options.suggestedName ?? ''
        return {
          createWritable: async () => ({
            write: async (data: ArrayBuffer) => {
              ;(window as unknown as Window & { __finalizedBytes: number[] }).__finalizedBytes = Array.from(new Uint8Array(data))
            },
            close: async () => undefined,
          }),
        }
      },
    })
  })
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(sample)
  await expect(page.getByText('1 / 5')).toBeVisible()
  const before = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).map((item) => item.id))

  await page.getByRole('button', { name: 'ファイル▼' }).click()
  await page.getByRole('menuitem', { name: '確定して別名で保存' }).click()
  const status = page.locator('.status-bar [role="status"]')
  await expect(status).toContainText('確定版を保存しました。確定版の書き込みは編集できません。')
  const saved = await page.evaluate(() => {
    const target = window as unknown as Window & { __finalizedBytes: number[]; __finalizedName: string }
    return { bytes: target.__finalizedBytes, name: target.__finalizedName }
  })
  expect(saved.name).toBe('sample-small_確定.pdf')
  expect(saved.bytes.length).toBeGreaterThan(0)
  expect(await page.evaluate(() => window.__karu!.getEditableAnnotations(0).map((item) => item.id))).toEqual(before)

  const popupPromise = context.waitForEvent('page')
  await page.keyboard.press('Control+P')
  const popup = await popupPromise
  await expect(status).toContainText('新しいタブの印刷ボタンから印刷してください')
  expect(await page.evaluate(() => window.__karu!.getEditableAnnotations(0).map((item) => item.id))).toEqual(before)
  await popup.close()
})

test('使い方を開始画面とツールバーから開き、Escで閉じられる', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('start-screen').getByRole('button', { name: '使い方' }).click()
  const dialog = page.getByRole('dialog', { name: 'かるPDFの使い方' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('確定して別名で保存')
  await expect(dialog).toContainText('プログラムから開く')
  await expect(dialog).toContainText('PDFはパソコンの外へ送信しません')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  await page.getByTestId('file-input').setInputFiles(sample)
  await expect(page.getByText('1 / 5')).toBeVisible()
  await page.getByRole('button', { name: 'ヘルプ▼' }).click()
  await page.getByRole('menuitem', { name: '使い方' }).click()
  await expect(dialog).toBeVisible()
})

test('File Handling APIから渡されたPDFをタブで開く', async ({ page }) => {
  const bytes = Array.from(await fs.readFile(sample))
  await page.addInitScript(({ pdfBytes }) => {
    const handle = {
      name: 'プログラムから開いた.pdf',
      getFile: async () => new File([new Uint8Array(pdfBytes)], 'プログラムから開いた.pdf', { type: 'application/pdf' }),
    }
    Object.defineProperty(window, 'launchQueue', {
      configurable: true,
      value: {
        setConsumer: (consumer: (params: { files: unknown[] }) => void) => {
          setTimeout(() => consumer({ files: [handle] }), 0)
        },
      },
    })
  }, { pdfBytes: bytes })
  await page.goto('/karu-pdf/?test=1')
  await expect(page.getByText('1 / 5')).toBeVisible()
  await expect(page.getByRole('button', { name: 'プログラムから開いた.pdf', exact: true })).toBeVisible()
})

test('一度開いた後はオフラインで再読み込みして開始画面を表示できる', async ({ page, context }) => {
  await page.goto('/karu-pdf/')
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await page.reload()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  await expect(page.getByTestId('start-screen')).toBeVisible()
  await context.setOffline(true)
  try {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('start-screen')).toBeVisible()
  } finally {
    await context.setOffline(false)
  }
})
