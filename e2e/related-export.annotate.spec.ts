import { readFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import { catalogItems, catalogPresets, representativeBreakdownPosition } from '../src/core/catalog'
import { fixtureFromPreset } from '../src/core/quantityMaster'
import type { CountFixture } from '../src/core/countFixtures'
import { writeCountFixtures } from '../src/core/countFixtures'
import { parseRelatedReviews, writeRelatedReviews } from '../src/core/related/reviews'

/** 品目一覧の「配線器具」の項目（関連の候補が出る実データの起点） */
function wiringFixture(): CountFixture {
  for (const item of catalogItems()) {
    if (item.field !== '電気設備' || item.category !== '配線器具') continue
    for (const preset of catalogPresets(item, { options: [item.options[0].key] }, representativeBreakdownPosition(item))) {
      if (preset.breakdown?.book === '電気設備') return { ...fixtureFromPreset(preset, []), id: 'r3-fixture' }
    }
  }
  throw new Error('配線器具の項目が品目一覧にありません。')
}

function relatedPdf(reviews: unknown, fixture?: CountFixture): number[] {
  const doc = new mupdf.PDFDocument()
  try {
    const page = doc.addPage([0, 0, 300, 400], 0, {}, '')
    try { doc.insertPage(-1, page) } finally { page.destroy() }
    writeCountFixtures(doc, [fixture ?? {
      id: 'r3-fixture', code: 'R3', name: 'R3試験項目', category: 'その他', order: 0,
      style: { shape: 'circle', fill: 'none', color: [1, 0, 0], size: 10, opacity: 1, showCode: true },
    }])
    writeRelatedReviews(doc, parseRelatedReviews(reviews))
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { doc.destroy() }
}

/** 既存 e2e と同じく、組み立てた PDF を試験用の入口で開き、数量パネルと集計表を開く */
async function mount(page: Page, reviews: unknown, fixture?: CountFixture): Promise<Locator> {
  // Use the download fallback; a native save dialog cannot be driven headless.
  await page.addInitScript(() => { delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker })
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '集計表試験.pdf'), relatedPdf(reviews, fixture))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await page.getByTestId('fixture-panel').getByRole('button', { name: '集計表を開く', exact: true }).click()
  const host = page.locator('body')
  await expect(host.getByRole('button', { name: 'Excelに書き出す', exact: true })).toBeVisible()
  return host
}

function storedXmlEntries(bytes: Buffer): Map<string, string> {
  const entries = new Map<string, string>()
  let offset = 0
  while (offset + 30 <= bytes.length
    && bytes.readUInt32LE(offset) === 0x04034b50) {
    const method = bytes.readUInt16LE(offset + 8)
    if (method !== 0) throw new Error('試験は既存の非圧縮ZIP形式を対象にしています。')
    const size = bytes.readUInt32LE(offset + 18)
    const nameLength = bytes.readUInt16LE(offset + 26)
    const extraLength = bytes.readUInt16LE(offset + 28)
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    const dataEnd = dataStart + size
    if (dataEnd > bytes.length) throw new Error('ExcelのZIPが途中で切れています。')
    const name = bytes.subarray(nameStart, nameStart + nameLength).toString('utf8')
    if (name.endsWith('.xml')) {
      entries.set(name, bytes.subarray(dataStart, dataEnd).toString('utf8'))
    }
    offset = dataEnd
  }
  return entries
}

function unescapeXml(value: string): string {
  return value.replace(/&#13;/g, '\r')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function required(entries: Map<string, string>, name: string): string {
  const value = entries.get(name)
  if (value === undefined) throw new Error(`Excelに ${name} がありません。`)
  return value
}

function sheetNames(entries: Map<string, string>): string[] {
  const workbook = required(entries, 'xl/workbook.xml')
  return [...workbook.matchAll(/<sheet\b[^>]*name="([^"]*)"[^>]*\/>/g)]
    .map(match => unescapeXml(match[1]))
}

function stringRows(entries: Map<string, string>, sheetNumber: number): string[][] {
  const shared = required(entries, 'xl/sharedStrings.xml')
  const strings = [...shared.matchAll(/<si><t\b[^>]*>([\s\S]*?)<\/t><\/si>/g)]
    .map(match => unescapeXml(match[1]))
  const sheet = required(entries, `xl/worksheets/sheet${sheetNumber}.xml`)
  return [...sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(row =>
    [...row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)].map(cell => {
      const value = /<v>([\s\S]*?)<\/v>/.exec(cell[2])?.[1] ?? ''
      return /\bt="s"/.test(cell[1]) ? strings[Number(value)] : value
    }))
}

async function exportWorkbook(
  page: Page,
  host: Locator,
): Promise<Map<string, string>> {
  const download = page.waitForEvent('download')
  await host.getByRole('button', {
    name: 'Excelに書き出す', exact: true,
  }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('集計表試験_数量集計表.xlsx')
  const path = await file.path()
  if (!path) throw new Error('Excelのダウンロード先を取得できませんでした。')
  return storedXmlEntries(await readFile(path))
}

test('other-work assignee can be recorded, changed and exported on the final sheet', async ({
  page,
}) => {
  const fixture = wiringFixture()
  const host = await mount(page, { version: 1, projectMode: '新築', works: {}, decisions: {} }, fixture)
  // 項目を選び、関連の候補を開いて最初の拾い候補を「他工事」にする
  await host.getByTestId('fixture-panel').locator('.fixture-row-name').first().click()
  const related = host.getByTestId('format-panel').getByTestId('related-suggestions')
  const originList = related.getByTestId('related-origin-list')
  if (!await originList.evaluate(element => element.hasAttribute('open'))) {
    await originList.locator(':scope > summary').click()
  }
  const card = related.locator('[data-testid="related-suggestion"][data-related-kind="item"]:not([data-decision]):not([data-registered])').first()
  await expect(card).toBeVisible()
  const key = await card.getAttribute('data-related-key')
  expect(key).toBeTruthy()
  await card.getByLabel('ほかの判断', { exact: true }).selectOption('他工事')
  // 提案の key は引用符を含むので、CSS の文字列として逃がす
  const chosen = related.locator(`[data-related-key=${JSON.stringify(key)}]`).first()
  await expect(chosen.getByLabel('他工事の担当', { exact: true })).toHaveValue('その他')
  // 担当の確定前は判断を変更しない
  await expect(chosen).not.toHaveAttribute('data-decision', '他工事')
  await chosen.getByLabel('他工事の担当', { exact: true }).selectOption('機械設備')
  await chosen.getByRole('button', { name: '担当を記録', exact: true }).click()
  await expect(chosen).toHaveAttribute('data-decision', '他工事')
  await expect(chosen).toHaveAttribute('data-related-assignee', '機械設備')
  // 判断した候補は「判断済み」（折りたたみ）へ移る。開いて担当を変える
  await related.locator('summary').filter({ hasText: /^判断済み \d+件$/ }).first().click()
  await chosen.getByLabel('他工事の担当を変更', { exact: true }).selectOption('電気設備')
  await expect(chosen).toHaveAttribute('data-related-assignee', '電気設備')
  await expect(host.getByTestId('quantity-related-pending')).toHaveText(/^関連候補：未判断 \d+件$/)

  const entries = await exportWorkbook(page, host)
  expect(sheetNames(entries)).toEqual(['集計表', '明細', '関連候補の確認'])
  const rows = stringRows(entries, 3)
  expect(rows[0]).toEqual(['関連候補の確認'])
  expect(rows[1]).toEqual(['提案は拾い漏れの確認用で、別途計上の根拠ではありません'])
  const other = rows.slice(4).filter(row => row[0] === '他工事')
  expect(other).toHaveLength(1)
  expect(other[0][5]).toBe('電気設備')
})

test('unused documents keep the original sheets and do not load related rules', async ({
  page,
}) => {
  const requests: string[] = []
  page.on('request', request => requests.push(request.url()))
  const host = await mount(page, {
    version: 1,
    works: {},
    decisions: {},
  })
  await expect(host.getByTestId('quantity-related-pending')).toHaveCount(0)
  const entries = await exportWorkbook(page, host)
  expect(sheetNames(entries)).toEqual(['集計表', '明細'])
  expect(requests.filter(url =>
    /\/assets\/rules-[^/]*\.js(?:\?|$)/.test(url))).toEqual([])
})
