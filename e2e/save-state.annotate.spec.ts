import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import { listAnnotations } from '../src/core/annotations'
import { writePageScale } from '../src/core/measure'
import type { PdfFileHandle } from '../src/editor/fileAccess'

interface SaveStateFiles {
  files: Record<string, { bytes: number[]; writes: number; closes: number }>
  handles: Record<string, PdfFileHandle>
  nextOpen: string
  nextSave: string
  failure: 'none' | 'write' | 'close'
  failRecordOnClose: boolean
}
declare global { interface Window { __saveStateFiles: SaveStateFiles } }

function blankPdf(): number[] {
  const doc = new mupdf.PDFDocument()
  try {
    for (let i = 0; i < 2; i++) {
      const ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
      try { doc.insertPage(-1, ref) } finally { ref.destroy() }
      const pdfPage = doc.loadPage(i)
      try {
        writePageScale(doc, pdfPage, { denominator: 100, paper: 'PDF', source: 'ratio', mmPerPoint: 25.4 / 72 * 100, unit: 'm', decimals: 2 })
      } finally { pdfPage.destroy() }
    }
    const buffer = doc.saveToBuffer('compress')
    try { return Array.from(buffer.asUint8Array()) } finally { buffer.destroy() }
  } finally { doc.destroy() }
}

test.beforeEach(async ({ page }) => {
  // Same picker/recording handle approach as save-as.annotate.spec.ts.
  // PDF bytes stay in memory; no fixture or output is written to work/.
  await page.addInitScript(bytes => {
    const state: SaveStateFiles = {
      files: { 'A.pdf': { bytes: [...bytes], writes: 0, closes: 0 }, 'B.pdf': { bytes: [...bytes], writes: 0, closes: 0 } },
      handles: {}, nextOpen: 'A.pdf', nextSave: 'A.pdf', failure: 'none', failRecordOnClose: false,
    }
    for (const name of ['A.pdf', 'B.pdf']) {
      state.handles[name] = {
        name,
        getFile: async () => new File([new Uint8Array(state.files[name].bytes)], name, { type: 'application/pdf' }),
        queryPermission: async () => 'granted', requestPermission: async () => 'granted',
        isSameEntry: async other => other === state.handles[name],
        createWritable: async () => {
          let pending: number[] = []
          return {
            write: async data => {
              if (state.failure === 'write') throw new Error('test write failed')
              pending = Array.from(new Uint8Array(data as ArrayBuffer))
              state.files[name].writes++
            },
            close: async () => {
              if (state.failure === 'close') throw new Error('test close failed')
              state.files[name].bytes = pending
              state.files[name].closes++
              if (state.failRecordOnClose) {
                // saveLastOpenedHandle constructs openedAt before its storage
                // fallback. Fail that post-write operation exactly once.
                const original = Date.now
                Date.now = () => {
                  Date.now = original
                  throw new Error('test recent record failed')
                }
              }
            },
          }
        },
      }
    }
    window.__saveStateFiles = state
    window.showOpenFilePicker = async () => [state.handles[state.nextOpen]]
    window.showSaveFilePicker = async () => state.handles[state.nextSave]
  }, blankPdf())
})

async function openPdf(page: Page, name = 'A.pdf'): Promise<string> {
  await page.evaluate(name => { window.__saveStateFiles.nextOpen = name }, name)
  await page.getByRole('button', { name: 'PDFを開く', exact: true }).click()
  await expect(page.locator('.menu-file-name')).toHaveAttribute('title', name)
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.evaluate(() => window.__karu!.setZoom(1))
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await expect(page.getByTestId('fixture-panel').getByRole('button', { name: '項目を追加', exact: true })).toBeEnabled()
  return page.evaluate(name => window.__karu!.listTabs().find(tab => tab.name === name)!.docId, name)
}
async function start(page: Page) {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  return openPdf(page)
}
async function clickPoint(page: Page, x: number, y: number) {
  const layer = page.getByTestId('annotation-layer-0')
  const position = await layer.evaluate((element, p) => {
    const svg = element as SVGSVGElement, box = svg.getBoundingClientRect()
    return { x: p.x * box.width / svg.viewBox.baseVal.width, y: p.y * box.height / svg.viewBox.baseVal.height }
  }, { x, y })
  await layer.click({ position })
}
async function addItem(page: Page, code: string, name: string, length = false) {
  await page.getByTestId('fixture-panel').getByRole('button', { name: '項目を追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await dialog.getByLabel('名称', { exact: true }).fill(name)
  await dialog.getByLabel('略号', { exact: true }).fill(code)
  await dialog.getByRole('radio', { name: length ? '長さ' : '個数', exact: true }).check()
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
}
const format = (page: Page) => page.getByTestId('format-panel')
async function selectRoute(page: Page) {
  await page.getByRole('button', { name: '選択', exact: true }).click()
  await clickPoint(page, 136, 300)
  await expect(format(page).getByLabel('CVの条数', { exact: true })).toBeVisible()
}
async function createCaseA(page: Page) {
  const docId = await start(page)
  await addItem(page, 'CV', 'ケーブル', true)
  await addItem(page, 'PF28', '電線管', true)
  await page.getByTestId('fixture-panel').getByRole('button', { name: 'CV ケーブル', exact: true }).click()
  await clickPoint(page, 100, 300); await clickPoint(page, 172, 300); await page.keyboard.press('Enter')
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).filter(a => a.quantity).length)).toBe(1)
  for (const [label, value] of [['CVの条数', '2'], ['立上り・立下り', '3'], ['余長・その他', '1']]) {
    await format(page).getByLabel(label, { exact: true }).fill(value)
    await format(page).getByLabel(label, { exact: true }).press('Enter')
  }
  await format(page).getByLabel('長さの項目を選ぶ', { exact: true }).selectOption({ label: 'PF28 電線管' })
  await format(page).getByRole('button', { name: 'この経路に足す', exact: true }).click()
  await format(page).getByLabel('PF28の範囲', { exact: true }).selectOption('rise')
  await addItem(page, 'LED', '照明器具')
  await page.getByTestId('fixture-panel').getByRole('button', { name: 'LED 照明器具', exact: true }).click()
  await clickPoint(page, 100, 180)
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).filter(a => a.count).length)).toBe(1)
  return docId
}
async function save(page: Page, name = 'A.pdf') {
  const closes = await page.evaluate(name => window.__saveStateFiles.files[name].closes, name)
  await page.keyboard.press('Control+S')
  await expect.poll(() => page.evaluate(name => window.__saveStateFiles.files[name].closes, name)).toBe(closes + 1)
  await expect.poll(() => page.evaluate(name => window.__karu!.listTabs().find(tab => tab.name === name)!.dirty, name)).toBe(false)
  // Stream close and dirty=false precede optional bookkeeping. Wait until
  // saving has ended before another save, tab close or application close.
  await page.getByRole('button', { name: 'ファイル▼', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: '上書き保存', exact: true })).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(page.locator('.status-bar')).toContainText('保存しました')
}
async function savedBytes(page: Page, name = 'A.pdf') {
  return page.evaluate(name => window.__saveStateFiles.files[name].bytes, name)
}
function readSaved(bytes: number[]) {
  const doc = new mupdf.PDFDocument(new Uint8Array(bytes))
  try { return listAnnotations(doc, 0) } finally { doc.destroy() }
}
function rawSavedQuantity(bytes: number[]) {
  const doc = new mupdf.PDFDocument(new Uint8Array(bytes)), pdfPage = doc.loadPage(0), annotations = pdfPage.getAnnotations()
  try {
    for (const annotation of annotations) {
      const object = annotation.getObject(), raw = object.get('KaruQuantity')
      try { if (!raw.isNull()) return JSON.parse(raw.asString()) as { slackM?: number } }
      finally { raw.destroy(); object.destroy() }
    }
    throw new Error('/KaruQuantity missing')
  } finally { for (const annotation of annotations) annotation.destroy(); pdfPage.destroy(); doc.destroy() }
}

test('A: saved shared route/count closes without tab or beforeunload dialogs', async ({ page }) => {
  const docId = await createCaseA(page)
  await save(page)
  expect(await page.evaluate(() => window.__saveStateFiles.files['A.pdf'].closes)).toBe(1)
  const annotations = readSaved(await savedBytes(page))
  expect(annotations.find(a => a.quantity)?.quantity).toMatchObject({ count: 2, addM: 3, slackM: 1, extra: [{ count: 1, scope: 'rise' }] })
  expect(annotations.filter(a => a.count)).toHaveLength(1)
  const dialogs: string[] = []
  page.on('dialog', dialog => { dialogs.push(dialog.type()); void dialog.dismiss() })
  await page.getByTestId(`document-tab-${docId}`).getByRole('button', { name: 'A.pdfを閉じる', exact: true }).click()
  await expect(page.getByTestId(`document-tab-${docId}`)).toHaveCount(0)
  expect(dialogs).toEqual([])
  await openPdf(page)
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).length)).toBe(2)
  await save(page)
  await page.close({ runBeforeUnload: true })
  await expect.poll(() => page.isClosed()).toBe(true)
  expect(dialogs).toEqual([])
})

test("A': Ctrl+S commits a focused slack draft into /KaruQuantity", async ({ page }) => {
  await createCaseA(page)
  await selectRoute(page)
  const slack = format(page).getByLabel('余長・その他', { exact: true })
  await slack.fill('2')
  await expect(slack).toBeFocused()
  expect(await page.evaluate(() => window.__karu!.getEditableAnnotations(0).find(a => a.quantity)?.quantity?.slackM)).toBe(1)
  await save(page)
  expect(rawSavedQuantity(await savedBytes(page)).slackM).toBe(2)
})

test('B: post-save route edit warns with the PDF name and unsaved contents', async ({ page }) => {
  const docId = await createCaseA(page)
  await save(page); await selectRoute(page)
  await format(page).getByLabel('CVの条数', { exact: true }).fill('3')
  await format(page).getByLabel('CVの条数', { exact: true }).press('Enter')
  await expect.poll(() => page.evaluate(() => window.__karu!.listTabs()[0].dirty)).toBe(true)
  const confirmPromise = page.waitForEvent('dialog')
  const closeClick = page.getByTestId(`document-tab-${docId}`).getByRole('button', { name: 'A.pdfを閉じる', exact: true }).click()
  const confirmation = await confirmPromise
  expect(confirmation.type()).toBe('confirm')
  expect(confirmation.message()).toBe('「A.pdf」に保存していない変更があります（書き込み・数量の拾い 1件）。\n保存せずに閉じますか？')
  await confirmation.dismiss(); await closeClick
  await expect(page.getByTestId(`document-tab-${docId}`)).toBeVisible()
  const unloadPromise = page.waitForEvent('dialog')
  await page.close({ runBeforeUnload: true })
  const unload = await unloadPromise
  expect(unload.type()).toBe('beforeunload')
  await unload.dismiss()
  await expect(page.getByTestId(`document-tab-${docId}`)).toBeVisible()
  await expect(page.locator('.status-bar')).toContainText('保存していない変更があるPDF: A.pdf')
})

for (const failure of ['write', 'close'] as const) {
  test(`C: ${failure} failure stays dirty and a successful retry clears it`, async ({ page }) => {
    await createCaseA(page)
    const original = await savedBytes(page)
    await page.evaluate(failure => { window.__saveStateFiles.failure = failure }, failure)
    await page.keyboard.press('Control+S')
    await expect(page.getByRole('alert')).toContainText(`保存できませんでした: test ${failure} failed`)
    expect(await page.evaluate(() => window.__karu!.listTabs()[0].dirty)).toBe(true)
    expect(await savedBytes(page)).toEqual(original)
    expect(await page.evaluate(() => window.__saveStateFiles.files['A.pdf'].closes)).toBe(0)
    await page.evaluate(() => { window.__saveStateFiles.failure = 'none' })
    await save(page)
    expect(readSaved(await savedBytes(page)).filter(a => a.quantity || a.count)).toHaveLength(2)
  })
}

test('D: beforeunload names only the unsaved PDF and both indicators describe its changes', async ({ page }) => {
  const firstId = await createCaseA(page)
  await save(page)
  const secondId = await openPdf(page, 'B.pdf')
  await addItem(page, 'LED', '照明器具')
  await page.getByTestId('fixture-panel').getByRole('button', { name: 'LED 照明器具', exact: true }).click()
  await clickPoint(page, 100, 180)
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).filter(a => a.count).length)).toBe(1)
  await expect.poll(() => page.evaluate(() => window.__karu!.listTabs().map(tab => tab.dirty))).toEqual([false, true])
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false)
  await expect(page.locator('.status-bar')).toContainText('保存していない変更があるPDF: B.pdf')
  await expect(page.locator('.status-bar')).not.toContainText('A.pdf')
  await expect(page.getByTestId(`document-tab-${firstId}`).getByLabel('未保存', { exact: true })).toHaveCount(0)
  const description = '書き込み・数量の拾い 1件、数量拾いの項目'
  await expect(page.getByTestId(`document-tab-${secondId}`).getByLabel('未保存', { exact: true })).toHaveAttribute('title', description)
  await expect(page.locator('.menu-file-name').getByLabel('未保存', { exact: true })).toHaveAttribute('title', description)
})

test('post-save recent recording failure reports a warning while remaining saved', async ({ page }) => {
  await createCaseA(page)
  await page.evaluate(() => { window.__saveStateFiles.failRecordOnClose = true })
  await save(page)
  await expect(page.locator('.status-bar')).toContainText('保存しました（最近使ったファイルの記録に失敗しました: test recent record failed）')
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(readSaved(await savedBytes(page)).filter(a => a.quantity || a.count)).toHaveLength(2)
})
