import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import type { PdfFileHandle } from '../src/editor/fileAccess'

const sample = path.resolve('test-data/sample-small.pdf')
type PickerMode = 'save' | 'abort' | 'write-failure' | 'close-failure'
interface SaveFiles {
  files: Record<string, { bytes: number[]; writes: number; closes: number }>
  handles: Record<string, PdfFileHandle>
  mode: PickerMode
  saveCalls: Array<{ suggestedName?: string; startIn?: string }>
  openCalls: Array<{ startIn?: string }>
}
declare global { interface Window { __saveFiles: SaveFiles } }

test.beforeEach(async ({ page }) => {
  await page.addInitScript(pdfBytes => {
    const state: SaveFiles = {
      files: {
        'A.pdf': { bytes: pdfBytes, writes: 0, closes: 0 },
        'B.pdf': { bytes: [], writes: 0, closes: 0 },
      },
      handles: {}, mode: 'save', saveCalls: [], openCalls: [],
    }
    for (const name of ['A.pdf', 'B.pdf']) {
      state.handles[name] = {
        name,
        getFile: async () => new File([new Uint8Array(state.files[name].bytes)], name, { type: 'application/pdf' }),
        queryPermission: async () => 'granted',
        requestPermission: async () => 'granted',
        isSameEntry: async other => other === state.handles[name],
        createWritable: async () => {
          let pending: number[] = []
          return {
            write: async data => {
              if (name === 'B.pdf' && state.mode === 'write-failure') throw new Error('write failed')
              pending = Array.from(new Uint8Array(data as ArrayBuffer))
              state.files[name].writes++
            },
            close: async () => {
              if (name === 'B.pdf' && state.mode === 'close-failure') throw new Error('close failed')
              state.files[name].bytes = pending
              state.files[name].closes++
            },
          }
        },
      }
    }
    window.__saveFiles = state
    window.showOpenFilePicker = async options => {
      state.openCalls.push({ startIn: options.startIn?.name })
      return [state.handles['A.pdf']]
    }
    window.showSaveFilePicker = async options => {
      state.saveCalls.push({ suggestedName: options.suggestedName, startIn: options.startIn?.name })
      if (state.mode === 'abort') throw new DOMException('cancelled', 'AbortError')
      return state.handles['B.pdf']
    }
  }, Array.from(await fs.readFile(sample)))
})

async function openA(page: Page): Promise<string> {
  await page.goto('/karu-pdf/?test=1')
  await page.getByRole('button', { name: 'PDFを開く', exact: true }).click()
  await expect(page.getByText('1 / 5')).toBeVisible()
  return page.evaluate(() => window.__karu!.listTabs()[0].docId)
}

async function addText(page: Page, text: string, y = 300): Promise<void> {
  const count = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).length)
  await page.getByRole('button', { name: '文字', exact: true }).click()
  await page.getByTestId('annotation-layer-0').click({ position: { x: 120, y } })
  await page.getByTestId('text-editor').fill(text)
  await page.keyboard.press('Control+Enter')
  await expect(page.getByTestId('text-editor')).toBeHidden()
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).length)).toBe(count + 1)
  await expect.poll(() => page.evaluate(value => window.__karu!.getEditableAnnotations(0).some(a => a.text === value), text)).toBe(true)
}

async function saveAs(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'ファイル▼' }).click()
  await page.getByRole('menuitem', { name: '別名で保存', exact: true }).click()
}

async function expectName(page: Page, name: string, docId: string): Promise<void> {
  await expect(page.getByTestId(`document-tab-${docId}`).locator('.document-tab-name')).toHaveAttribute('title', name)
  await expect(page.locator('.menu-file-name')).toHaveAttribute('title', name)
  await expect.poll(() => page.evaluate(() => window.__karu!.listTabs().map(tab => ({ docId: tab.docId, name: tab.name })))).toEqual([{ docId, name }])
}

async function savedView(page: Page, name: string) {
  return page.evaluate(fileName => {
    const size = window.__saveFiles.files[fileName].bytes.length
    return (JSON.parse(localStorage.getItem('karu-pdf:view') ?? '{}') as Record<string, { page: number; zoom: number }>)[`${fileName}\n${size}`]
  }, name)
}

test('別名保存後は名前・上書き先・履歴・復元キー・次の提案名をBへ切り替える', async ({ page }) => {
  const docId = await openA(page)
  await addText(page, 'first edit')
  await saveAs(page)
  await expectName(page, 'B.pdf', docId)
  await expect.poll(() => page.evaluate(() => window.__karu!.listTabs()[0].dirty)).toBe(false)
  await expect.poll(() => savedView(page, 'B.pdf')).toMatchObject({ page: 1 })
  await expect.poll(() => page.evaluate(() => window.__saveFiles.files['B.pdf'].closes)).toBe(1)

  await addText(page, 'second edit', 430)
  await page.evaluate(() => { window.__karu!.scrollToPage(2); window.__karu!.setZoom(1.5) })
  await expect(page.getByText('3 / 5')).toBeVisible()
  await expect(page.locator('.zoom-value')).toHaveText('150%')
  await page.keyboard.press('Control+S')
  await expect.poll(() => page.evaluate(() => window.__saveFiles.files['B.pdf'].closes)).toBe(2)
  await expect.poll(() => savedView(page, 'B.pdf')).toMatchObject({ page: 3, zoom: 1.5 })
  expect(await page.evaluate(() => ({ a: window.__saveFiles.files['A.pdf'].writes, b: window.__saveFiles.files['B.pdf'].writes }))).toEqual({ a: 0, b: 2 })

  await page.evaluate(() => { window.__saveFiles.mode = 'abort' })
  await saveAs(page)
  await expect.poll(() => page.evaluate(() => window.__saveFiles.saveCalls)).toEqual([
    { suggestedName: 'A.pdf', startIn: 'A.pdf' },
    { suggestedName: 'B.pdf', startIn: 'B.pdf' },
  ])
  await expectName(page, 'B.pdf', docId)
  await page.evaluate(id => window.__karu!.closeTab(id), docId)
  await expect(page.locator('.recent-open').first()).toContainText('B.pdf')
  await page.locator('.recent-open').first().click()
  await expect(page.locator('.menu-file-name')).toHaveAttribute('title', 'B.pdf')
  await expect(page.getByText('3 / 5')).toBeVisible()
  await expect(page.locator('.zoom-value')).toHaveText('150%')
  await page.evaluate(() => window.__karu!.scrollToPage(0))
  await expect(page.getByText('1 / 5')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).map(a => a.text))).toEqual(expect.arrayContaining(['first edit', 'second edit']))
  await page.getByRole('button', { name: 'PDFを開く', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__saveFiles.openCalls.at(-1)?.startIn)).toBe('B.pdf')
})

test('別名保存のキャンセルではAの名前・保存先・未保存の編集を保つ', async ({ page }) => {
  const docId = await openA(page)
  await addText(page, 'cancel edit')
  await page.evaluate(() => { window.__saveFiles.mode = 'abort' })
  await saveAs(page)
  await expect.poll(() => page.evaluate(() => window.__saveFiles.saveCalls.length)).toBe(1)
  await expectName(page, 'A.pdf', docId)
  expect(await page.evaluate(() => window.__karu!.listTabs()[0].dirty)).toBe(true)
  expect(await page.evaluate(() => window.__saveFiles.files['B.pdf'].writes)).toBe(0)
  await page.keyboard.press('Control+S')
  await expect.poll(() => page.evaluate(() => window.__saveFiles.files['A.pdf'].closes)).toBe(1)
  await expectName(page, 'A.pdf', docId)
  await page.evaluate(id => window.__karu!.closeTab(id), docId)
  await expect(page.locator('.recent-open').first()).toContainText('A.pdf')
})

for (const mode of ['write-failure', 'close-failure'] as const) {
  test(`別名保存の${mode}では名前・保存先・履歴を切り替えない`, async ({ page }) => {
    const docId = await openA(page)
    await addText(page, 'retry edit')
    await page.evaluate(value => { window.__saveFiles.mode = value }, mode)
    await saveAs(page)
    await expect(page.getByRole('alert')).toContainText('保存できませんでした')
    await expectName(page, 'A.pdf', docId)
    expect(await page.evaluate(() => window.__karu!.listTabs()[0].dirty)).toBe(true)
    expect(await page.evaluate(() => window.__saveFiles.files['B.pdf'].closes)).toBe(0)
    expect(await savedView(page, 'B.pdf')).toBeUndefined()
    await page.getByRole('button', { name: 'PDFを開く', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.__saveFiles.openCalls.at(-1)?.startIn)).toBe('A.pdf')
    await page.keyboard.press('Control+S')
    await expect.poll(() => page.evaluate(() => window.__saveFiles.files['A.pdf'].closes)).toBe(1)
    await page.evaluate(id => window.__karu!.closeTab(id), docId)
    await expect(page.locator('.recent-open').first()).toContainText('A.pdf')
    await page.locator('.recent-open').first().click()
    await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).map(a => a.text))).toContain('retry edit')
  })
}

test('普通の上書き保存でも新しいファイルサイズのキーで表示位置を復元する', async ({ page }) => {
  const docId = await openA(page)
  const beforeSize = await page.evaluate(() => window.__saveFiles.files['A.pdf'].bytes.length)
  await addText(page, 'overwrite edit')
  await page.evaluate(() => { window.__karu!.scrollToPage(2); window.__karu!.setZoom(1.5) })
  await expect(page.getByText('3 / 5')).toBeVisible()
  await page.keyboard.press('Control+S')
  await expect.poll(() => page.evaluate(() => window.__saveFiles.files['A.pdf'].closes)).toBe(1)
  expect(await page.evaluate(() => window.__saveFiles.files['A.pdf'].bytes.length)).not.toBe(beforeSize)
  await expect.poll(() => savedView(page, 'A.pdf')).toMatchObject({ page: 3, zoom: 1.5 })
  await page.evaluate(id => window.__karu!.closeTab(id), docId)
  await page.locator('.recent-open').first().click()
  await expect(page.getByText('3 / 5')).toBeVisible()
  await expect(page.locator('.zoom-value')).toHaveText('150%')
})

test('別名保存後に再読み込みしてもBのハンドル・履歴・表示位置を復元する', async ({ page }) => {
  // chrome-headless-shell (the CI browser) crashes when a reloaded page reads an
  // OPFS file handle back from IndexedDB, even without the app; Edge does not.
  test.skip(process.env.PLAYWRIGHT_CHANNEL === 'chromium', 'chrome-headless-shell crashes reading a stored OPFS handle after reload')
  // Native handles in browser-private storage can be structured-cloned into
  // IndexedDB, unlike the recording mocks used by the other save tests.
  await page.addInitScript(pdfBytes => {
    const handles = (async () => {
      const directory = await navigator.storage.getDirectory()
      const a = await directory.getFileHandle('A.pdf', { create: true })
      const b = await directory.getFileHandle('B.pdf', { create: true })
      const writable = await a.createWritable()
      await writable.write(new Uint8Array(pdfBytes))
      await writable.close()
      return { a, b }
    })()
    window.showOpenFilePicker = async options => {
      window.__saveFiles.openCalls.push({ startIn: options.startIn?.name })
      return [(await handles).a as unknown as PdfFileHandle]
    }
    window.showSaveFilePicker = async () => (await handles).b as unknown as PdfFileHandle
  }, Array.from(await fs.readFile(sample)))
  const docId = await openA(page)
  await addText(page, 'persistent edit')
  await page.evaluate(() => { window.__karu!.scrollToPage(2); window.__karu!.setZoom(1.5) })
  await expect(page.getByText('3 / 5')).toBeVisible()
  await saveAs(page)
  await expectName(page, 'B.pdf', docId)
  await expect.poll(() => page.evaluate(() => window.__karu!.listTabs()[0].dirty)).toBe(false)

  await page.reload()
  await expect(page.locator('.recent-open').first()).toContainText('B.pdf')
  await page.locator('.recent-open').first().click()
  await expect(page.locator('.menu-file-name')).toHaveAttribute('title', 'B.pdf')
  await expect(page.getByText('3 / 5')).toBeVisible()
  await expect(page.locator('.zoom-value')).toHaveText('150%')
  await page.evaluate(() => window.__karu!.scrollToPage(0))
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).map(a => a.text))).toContain('persistent edit')
  await page.getByRole('button', { name: 'PDFを開く', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__saveFiles.openCalls.at(-1)?.startIn)).toBe('B.pdf')
})

test('ファイルの場所がない文書の最初の保存もBへ切り替える', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(sample)
  await expect(page.getByText('1 / 5')).toBeVisible()
  const docId = await page.evaluate(() => window.__karu!.listTabs()[0].docId)
  await addText(page, 'first save')
  await page.keyboard.press('Control+S')
  await expectName(page, 'B.pdf', docId)
  await expect.poll(() => page.evaluate(() => window.__saveFiles.files['B.pdf'].closes)).toBe(1)
  await page.keyboard.press('Control+S')
  await expect.poll(() => page.evaluate(() => window.__saveFiles.files['B.pdf'].closes)).toBe(2)
  expect(await page.evaluate(() => window.__saveFiles.saveCalls)).toEqual([{ suggestedName: 'sample-small.pdf' }])
})

test('分割表示の復元用文書名もBへ切り替え、文書IDを保つ', async ({ page }) => {
  const docId = await openA(page)
  await page.getByRole('button', { name: '表示▼' }).click()
  await page.getByRole('menuitemcheckbox', { name: '左右に並べて表示' }).click()
  await expect(page.getByTestId('right-viewer')).toHaveAttribute('data-doc-id', docId)
  await saveAs(page)
  await expectName(page, 'B.pdf', docId)
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('karu-pdf:split-view') ?? '{}')))
    .toMatchObject({ rightId: docId, rightName: 'B.pdf' })
  await expect(page.getByTestId('right-viewer')).toHaveAttribute('data-doc-id', docId)
  await expect(page.getByLabel('右に表示する文書')).toContainText('B.pdf')
})

test('保存先を選べない別名保存はダウンロードしAを上書き・切り替えしない', async ({ page }) => {
  const docId = await openA(page)
  await addText(page, 'download edit')
  await page.evaluate(() => { window.showSaveFilePicker = undefined })
  const downloadPromise = page.waitForEvent('download')
  await saveAs(page)
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('A.pdf')
  await expect.poll(() => page.evaluate(() => window.__karu!.listTabs()[0].dirty)).toBe(false)
  await expectName(page, 'A.pdf', docId)
  expect(await page.evaluate(() => window.__saveFiles.files['A.pdf'].writes)).toBe(0)
  await page.keyboard.press('Control+S')
  await expect.poll(() => page.evaluate(() => window.__saveFiles.files['A.pdf'].closes)).toBe(1)
})
