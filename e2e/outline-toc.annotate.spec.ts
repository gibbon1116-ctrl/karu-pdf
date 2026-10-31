import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import { flattenOutline } from '../src/core/outlineModel'

// Synthetic text only. Authored for Claude Code to execute; no real book content.
function fixture(): number[] {
  const doc = new mupdf.PDFDocument()
  const font = new mupdf.Font('Helvetica')
  const resource = doc.addSimpleFont(font)
  const text = (value: string, x: number, top: number) => `BT /F1 12 Tf 1 0 0 1 ${x} ${900 - top} Tm (${value}) Tj ET\n`
  try {
    for (let p = 0; p < 15; p++) {
      let content = ''
      if (p === 1 || p === 2) {
        content += text(`Chapter ${p} Fictional volume`, 60, 110)
        for (let i = 0; i < 5; i++) {
          const label = `${p}.${i + 1}`, title = `Fictional topic ${i + 1}`, printed = String((p - 1) * 5 + i + 1), top = 145 + i * 30
          // A: three independent text blocks; B: a whole line with leaders.
          content += p === 1 ? text(label, 85, top) + text(`${title} ............`, 180, top) + text(printed, 540, top) : text(`${label} ${title} ................................ ${printed}`, 85, top)
        }
      } else if (p >= 3) content = text(`Fictional body ${p - 2}`, 60, 120) + text(`- ${p - 2} -`, 285, 870)
      const ref = doc.addPage([0, 0, 600, 900], 0, { Font: { F1: resource } }, content)
      try { doc.insertPage(-1, ref) } finally { ref.destroy() }
    }
    const buffer = doc.saveToBuffer('compress')
    try { return Array.from(buffer.asUint8Array()) } finally { buffer.destroy() }
  } finally { resource.destroy(); font.destroy(); doc.destroy() }
}
function numberlessFixture(): number[] {
  const doc = new mupdf.PDFDocument(), font = new mupdf.Font('Helvetica'), resource = doc.addSimpleFont(font)
  const text = (value: string, x: number, top: number) => `BT /F1 12 Tf 1 0 0 1 ${x} ${900 - top} Tm (${value.replace(/[()\\]/g, '\\$&')}) Tj ET\n`
  try {
    for (let p = 0; p < 10; p++) {
      let content = ''
      if (p === 1) {
        content = text('CONTENTS', 240, 50) + text('Chapter 1 Fictional volume', 60, 110)
          + text('1. Alpha form', 85, 145) + text('2. Beta form', 320, 145)
          + text('3. Gamma form', 85, 180) + text('Chapter 2 Second volume', 60, 215)
          + text('1. Alpha form', 85, 250) + text('2. Beta form', 85, 285)
      } else if (p >= 2) {
        content = text('Fictional common header', 60, 25) + text('Fictional common footer', 60, 875)
        const headings: Record<number, string[]> = {
          2: ['(Fictional volume)', '(Alpha form)'], 3: ['(Beta form)'], 4: ['(Gamma form)'],
          5: ['(Second volume)', '(Alpha form)'], 6: ['(Beta form)'],
        }
        for (const [i, heading] of (headings[p] ?? [`Synthetic body page ${p}`]).entries()) content += text(heading, 60, 120 + i * 40)
      }
      const ref = doc.addPage([0, 0, 600, 900], 0, { Font: { F1: resource } }, content)
      try { doc.insertPage(-1, ref) } finally { ref.destroy() }
    }
    const buffer = doc.saveToBuffer('compress')
    try { return Array.from(buffer.asUint8Array()) } finally { buffer.destroy() }
  } finally { resource.destroy(); font.destroy(); doc.destroy() }
}
function drawingFixture(interspersedHeading = false): number[] {
  const doc = new mupdf.PDFDocument(), font = new mupdf.Font('Helvetica'), resource = doc.addSimpleFont(font)
  const text = (value: string, x: number, top: number) => `BT /F1 12 Tf 1 0 0 1 ${x} ${900 - top} Tm (${value.replace(/[()\\]/g, '\\$&')}) Tj ET\n`
  try {
    for (let p = 0; p < 7; p++) {
      let content = ''
      if (p === 1) {
        content = text('CONTENTS', 240, 50) + text('Fictional project', 60, 100) + text('Drawing list', 60, 135)
        for (let i = 0; i < 6; i++) content += text(`A-0${i} Fictional drawing ${i} ${i % 2 ? '1:100 1:200' : 'N.S N.S'}`, 85,
          170 + i * 35 + (interspersedHeading && i >= 3 ? 25 : 0))
        if (interspersedHeading) content += text('Fictional discipline', 60, 270)
      } else if (p > 1) content = text('Reference ( A-03 drawing ) only', 60, 180)
      if (p >= 1) {
        content += text('Synthetic project', 330, 865)
        content += p === 6 ? text('A-', 500, 865) + text('05', 520, 865) : text(`A-0${p - 1}`, 500, 865)
      }
      const ref = doc.addPage([0, 0, 600, 900], 0, { Font: { F1: resource } }, content)
      try { doc.insertPage(-1, ref) } finally { ref.destroy() }
    }
    const buffer = doc.saveToBuffer('compress')
    try { return Array.from(buffer.asUint8Array()) } finally { buffer.destroy() }
  } finally { resource.destroy(); font.destroy(); doc.destroy() }
}
function candidateFixture(count: number, unresolvedFirst = false): number[] {
  const doc = new mupdf.PDFDocument(), font = new mupdf.Font('Helvetica'), resource = doc.addSimpleFont(font)
  const tocPages = Math.ceil(count / 30)
  try {
    for (let p = 0; p < tocPages + 4; p++) {
      let content = ''
      if (p < tocPages) {
        for (let i = p * 30; i < Math.min(count, (p + 1) * 30); i++) {
          const printed = unresolvedFirst && i === 0 ? 999 : 1
          content += `BT /F1 12 Tf 1 0 0 1 60 ${800 - (i % 30) * 23} Tm (${i + 1}. Synthetic candidate ${i + 1} ............ ${printed}) Tj ET\n`
        }
      }
      const ref = doc.addPage([0, 0, 600, 900], 0, { Font: { F1: resource } }, content)
      try { doc.insertPage(-1, ref) } finally { ref.destroy() }
    }
    const buffer = doc.saveToBuffer('compress')
    try { return Array.from(buffer.asUint8Array()) } finally { buffer.destroy() }
  } finally { resource.destroy(); font.destroy(); doc.destroy() }
}
async function openCandidates(page: Page, count: number, unresolvedFirst = false) {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '架空の候補一覧.pdf'), candidateFixture(count, unresolvedFirst))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('tab', { name: '目次', exact: true }).click()
  return dialog(page)
}
async function open(page: Page) {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '架空の目次ページ.pdf'), fixture())
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('tab', { name: '目次', exact: true }).click()
  await expect(page.getByRole('button', { name: '目次ページから作成', exact: true })).toBeVisible()
}
async function dialog(page: Page) {
  await page.getByRole('button', { name: '目次ページから作成', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '目次ページから作成', exact: true })
  await expect(dialog.getByRole('button', { name: '読み直す', exact: true })).toBeEnabled()
  return dialog
}
async function items(page: Page) { return page.evaluate(() => window.__karu!.outlineDraft()!.getItems()) }
async function apply(page: Page) {
  await page.getByRole('button', { name: '目次を反映', exact: true }).click()
  await expect(page.getByTestId('outline-panel')).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByText('未反映の変更があります', { exact: true })).toHaveCount(0)
}

test('printed TOC detects A/B, supports shape edits, applies, saves and reloads', async ({ page }) => {
  await open(page)
  const modal = await dialog(page)
  await expect(modal.getByLabel('目次の開始ページ')).toHaveValue('2')
  await expect(modal.getByLabel('目次の終了ページ')).toHaveValue('3')
  await expect(modal.getByLabel('en:chapterの段')).toHaveValue('1')
  await expect(modal.getByLabel('num:2:.の段')).toHaveValue('2')
  await expect(modal.getByLabel('印刷上の1ページに対応するPDFページ')).toHaveValue('4')
  await expect(modal.getByText(/12 ページ中 12 ページで一致/)).toBeVisible()
  await expect(modal.getByText('12 件中 12 件を入れます（深さ 2 段目まで）')).toBeVisible()
  await modal.getByLabel('num:2:.の段').selectOption('3')
  await expect(modal.getByText('12 件中 2 件を入れます（深さ 2 段目まで）')).toBeVisible()
  await modal.getByLabel('入れる深さ').selectOption('3')
  const candidate = modal.getByRole('row').filter({ hasText: '1.1 Fictional topic 1' })
  await candidate.getByText('1.1 Fictional topic 1', { exact: true }).dblclick()
  await modal.getByLabel('toc-2の名称').fill('Edited fictional topic')
  await modal.getByLabel('toc-2の名称').press('Enter')
  await modal.getByRole('button', { name: '目次の下書きに入れる', exact: true }).click()
  const draft = await items(page)
  expect(draft).toHaveLength(2)
  expect(draft[0].children).toHaveLength(5)
  expect(draft[0].children[0]).toMatchObject({ title: '1.1 Edited fictional topic', target: { kind: 'page', pageIndex: 3 } })
  await apply(page)
  const expected = await page.evaluate(() => window.__karu!.getOutline())
  const bytes = await page.evaluate(async () => Array.from((await window.__karu!.saveToBytes())!))
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '架空の再読込.pdf'), bytes)
  await page.getByRole('tab', { name: '目次', exact: true }).click()
  expect(await page.evaluate(() => window.__karu!.getOutline())).toEqual(expected)
})

test('repeated append has unique IDs; append and replacement each undo in one step', async ({ page }) => {
  await open(page)
  let modal = await dialog(page)
  await modal.getByRole('button', { name: '目次の下書きに入れる', exact: true }).click()
  const before = await items(page)
  modal = await dialog(page)
  await modal.getByRole('button', { name: '目次の下書きに入れる', exact: true }).click()
  const appended = flattenOutline([...(await items(page))])
  expect(appended).toHaveLength(24)
  expect(new Set(appended.map(({ item }) => item.id)).size).toBe(24)
  await page.getByRole('button', { name: '目次の操作を元に戻す', exact: true }).click()
  expect(await items(page)).toEqual(before)
  modal = await dialog(page)
  await modal.getByLabel('既存の目次を置き換える', { exact: true }).check()
  await expect(modal.getByText(/既存の目次 12 件を削除/)).toBeVisible()
  await modal.getByLabel('番号を名称に含める').uncheck()
  await modal.getByRole('button', { name: '目次の下書きに入れる', exact: true }).click()
  expect((await items(page))[0].title).toBe('Fictional volume')
  await page.getByRole('button', { name: '目次の操作を元に戻す', exact: true }).click()
  expect(await items(page)).toEqual(before)
})

test('cancel discards results and leaves the draft unchanged', async ({ page }) => {
  await open(page)
  const before = await items(page)
  await page.getByRole('button', { name: '目次ページから作成', exact: true }).click()
  await page.getByRole('dialog', { name: '目次ページから作成' }).getByRole('button', { name: 'キャンセル', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '目次ページから作成' })).toHaveCount(0)
  expect(await items(page)).toEqual(before)
})

test('numberless two-column TOC defaults to body lookup, resolves repeated forms, applies and saves', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '架空の番号なし目次.pdf'), numberlessFixture())
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('tab', { name: '目次', exact: true }).click()
  const modal = await dialog(page)
  await expect(modal.getByLabel('本文から見出しを探す', { exact: true })).toBeChecked()
  await expect(modal.getByLabel('印刷上の1ページに対応するPDFページ')).toHaveCount(0)
  await expect(modal.getByText(/本文から 7 \/ 7 項目の位置が見つかりました/)).toBeVisible()
  const alpha = modal.getByRole('row').filter({ hasText: '1. Alpha form' })
  await expect(alpha).toHaveCount(2)
  await expect(alpha.nth(0).getByRole('cell').nth(3)).toHaveText('—')
  await expect(alpha.nth(0).getByRole('cell').nth(4)).toHaveText('3')
  await expect(alpha.nth(1).getByRole('cell').nth(4)).toHaveText('6')
  await expect(modal.getByRole('row').filter({ hasText: '2. Beta form' }).nth(0).getByRole('cell').nth(4)).toHaveText('4')
  await modal.getByRole('button', { name: '目次の下書きに入れる', exact: true }).click()
  const flat = flattenOutline([...(await items(page))])
  expect(flat.map(({ item }) => item.target?.kind === 'page' ? item.target.pageIndex : null)).toEqual([2, 2, 3, 4, 5, 5, 6])
  await apply(page)
  const expected = await page.evaluate(() => window.__karu!.getOutline())
  const bytes = await page.evaluate(async () => Array.from((await window.__karu!.saveToBytes())!))
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '架空の番号なし目次_保存後.pdf'), bytes)
  await page.getByRole('tab', { name: '目次', exact: true }).click()
  expect(await page.evaluate(() => window.__karu!.getOutline())).toEqual(expected)
})

test('unresolved candidates remain selectable, focus the page input and block insertion until corrected', async ({ page }) => {
  const modal = await openCandidates(page, 6, true)
  const row = modal.getByRole('row').filter({ has: page.getByLabel('toc-1を含める', { exact: true }) })
  const checkbox = modal.getByLabel('toc-1を含める', { exact: true })
  const input = modal.getByLabel('toc-1のPDFページ', { exact: true })
  const insert = modal.getByRole('button', { name: '目次の下書きに入れる', exact: true })
  const warning = modal.getByText('ページが決まっていない項目が 1 件あります。PDF ページを入力するか、チェックを外してください', { exact: true })
  await expect(checkbox).toBeEnabled()
  await expect(checkbox).toBeChecked()
  await expect(input).toHaveValue('')
  await expect(row.getByText('ページ未設定', { exact: true })).toBeVisible()
  await expect(warning).toBeVisible()
  await expect(insert).toBeDisabled()
  await checkbox.uncheck()
  await expect(warning).toHaveCount(0)
  await expect(insert).toBeEnabled()
  await checkbox.check()
  await expect(input).toBeFocused()
  await expect(insert).toBeDisabled()
  for (const invalid of ['0', '6', '1.5']) {
    await input.fill(invalid)
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    await expect(row.getByText('ページが範囲外', { exact: true })).toBeVisible()
    await expect(insert).toBeDisabled()
  }
  await input.fill('5')
  await expect(input).toHaveAttribute('aria-invalid', 'false')
  await expect(row.getByRole('cell').last()).toHaveText('')
  await expect(warning).toHaveCount(0)
  await expect(modal.getByText('6 件中 6 件を入れます（深さ 1 段目まで）', { exact: true })).toBeVisible()
  await input.fill('')
  await expect(input).toHaveValue('')
  await expect(warning).toBeVisible()
  await input.fill('5')
  await insert.click()
  expect((await items(page))[0].target).toMatchObject({ kind: 'page', pageIndex: 4 })
})

test('depth and shape exclusions hide checks with reasons and preserve the underlying selections', async ({ page }) => {
  await open(page)
  const modal = await dialog(page)
  const child = modal.getByLabel('toc-2を含める', { exact: true })
  const row = modal.getByRole('row').filter({ has: page.getByLabel('toc-2を含める', { exact: true }) })
  await modal.getByLabel('入れる深さ').selectOption('1')
  await expect(child).not.toBeChecked()
  await expect(child).toBeDisabled()
  await expect(child).toHaveAttribute('title', '入れる深さ（1 段目まで）の外です。深さを変えると入れられます')
  await expect(row.getByText('深さの外', { exact: true })).toBeVisible()
  await expect(modal.getByText('12 件中 2 件を入れます（深さ 1 段目まで）', { exact: true })).toBeVisible()
  await modal.getByLabel('入れる深さ').selectOption('2')
  await expect(child).toBeChecked()
  await expect(child).toBeEnabled()
  await expect(modal.getByText('12 件中 12 件を入れます（深さ 2 段目まで）', { exact: true })).toBeVisible()
  await child.uncheck()
  await modal.getByLabel('num:2:.の段').selectOption('')
  await expect(child).toBeDisabled()
  await expect(modal.getByLabel('toc-3を含める', { exact: true })).not.toBeChecked()
  await expect(child).toHaveAttribute('title', 'この形は『入れない』に設定されています。見出しの形と段で変更できます')
  await expect(row.getByText('入れない形', { exact: true })).toBeVisible()
  await modal.getByRole('button', { name: 'すべて外す', exact: true }).click()
  await expect(modal.getByText('12 件中 0 件を入れます（深さ 2 段目まで）', { exact: true })).toBeVisible()
  await modal.getByRole('button', { name: 'すべて含める', exact: true }).click()
  await expect(modal.getByText('12 件中 2 件を入れます（深さ 2 段目まで）', { exact: true })).toBeVisible()
  await modal.getByLabel('num:2:.の段').selectOption('2')
  await expect(child).not.toBeChecked()
  await expect(modal.getByLabel('toc-3を含める', { exact: true })).toBeChecked()
  await expect(modal.getByText('12 件中 11 件を入れます（深さ 2 段目まで）', { exact: true })).toBeVisible()
  await modal.getByLabel('入れる深さ').selectOption('1')
  await modal.getByRole('button', { name: 'すべて外す', exact: true }).click()
  await modal.getByRole('button', { name: 'すべて含める', exact: true }).click()
  await modal.getByLabel('入れる深さ').selectOption('2')
  await expect(child).not.toBeChecked()
  await expect(modal.getByText('12 件中 11 件を入れます（深さ 2 段目まで）', { exact: true })).toBeVisible()
})

test('bulk and Shift selection include virtualized offscreen rows and update counts', async ({ page }) => {
  const modal = await openCandidates(page, 1100)
  const count = (included: string) => modal.getByText(`1,100 件中 ${included} 件を入れます（深さ 1 段目まで）`, { exact: true })
  const table = modal.getByRole('table', { name: '目次の候補', exact: true })
  await expect(count('1,100')).toBeVisible()
  expect(await table.getByRole('checkbox').count()).toBeLessThanOrEqual(36)
  await modal.getByRole('button', { name: 'すべて外す', exact: true }).click()
  await expect(count('0')).toBeVisible()
  await modal.getByRole('button', { name: 'すべて含める', exact: true }).click()
  await expect(count('1,100')).toBeVisible()
  await modal.getByRole('button', { name: 'すべて外す', exact: true }).click()
  await modal.getByLabel('toc-1を含める', { exact: true }).click()
  await expect(count('1')).toBeVisible()
  await table.locator('.toc-candidate-scroll').evaluate(element => { element.scrollTop = element.scrollHeight })
  await modal.getByLabel('toc-1100を含める', { exact: true }).click({ modifiers: ['Shift'] })
  await expect(count('1,100')).toBeVisible()
  await table.locator('.toc-candidate-scroll').evaluate(element => { element.scrollTop = 0 })
  await modal.getByLabel('toc-1を含める', { exact: true }).click({ modifiers: ['Shift'] })
  await expect(count('0')).toBeVisible()
})

test('Shift ranges skip excluded shapes and depths without clearing their stored selections', async ({ page }) => {
  await open(page)
  const modal = await dialog(page)
  await modal.getByLabel('入れる深さ').selectOption('1')
  await modal.getByLabel('toc-1を含める', { exact: true }).click()
  await modal.getByLabel('toc-7を含める', { exact: true }).click({ modifiers: ['Shift'] })
  await expect(modal.getByText('12 件中 0 件を入れます（深さ 1 段目まで）', { exact: true })).toBeVisible()
  await modal.getByLabel('入れる深さ').selectOption('2')
  await expect(modal.getByText('12 件中 10 件を入れます（深さ 2 段目まで）', { exact: true })).toBeVisible()
  await modal.getByLabel('num:2:.の段').selectOption('')
  await modal.getByLabel('toc-1を含める', { exact: true }).click()
  await modal.getByLabel('toc-7を含める', { exact: true }).click({ modifiers: ['Shift'] })
  await expect(modal.getByText('12 件中 2 件を入れます（深さ 2 段目まで）', { exact: true })).toBeVisible()
  await modal.getByLabel('num:2:.の段').selectOption('2')
  await expect(modal.getByText('12 件中 12 件を入れます（深さ 2 段目まで）', { exact: true })).toBeVisible()
})

for (const method of ['目次のページ番号を使う', '本文から見出しを探す']) {
  test(`manual pages feed the draft and parent inheritance with ${method}`, async ({ page }) => {
    await open(page)
    const modal = await dialog(page)
    await modal.getByLabel(method, { exact: true }).check()
    await expect(modal.getByRole('button', { name: 'すべて外す', exact: true })).toBeEnabled()
    await modal.getByRole('button', { name: 'すべて外す', exact: true }).click()
    await modal.getByLabel('toc-1を含める', { exact: true }).check()
    await modal.getByLabel('toc-2を含める', { exact: true }).check()
    const input = modal.getByLabel('toc-2のPDFページ', { exact: true })
    await input.fill('9')
    await expect(modal.getByLabel('toc-1のPDFページ', { exact: true })).toHaveValue('9')
    await expect(modal.getByText('12 件中 2 件を入れます（深さ 2 段目まで）', { exact: true })).toBeVisible()
    await modal.getByLabel('入れる深さ').selectOption('1')
    await expect(modal.getByLabel('toc-1のPDFページ', { exact: true })).toHaveValue('9')
    await expect(modal.getByText('12 件中 1 件を入れます（深さ 1 段目まで）', { exact: true })).toBeVisible()
    await modal.getByLabel('入れる深さ').selectOption('2')
    await input.fill('')
    if (method === '目次のページ番号を使う') {
      await expect(input).toHaveValue('4')
      await expect(modal.getByLabel('toc-1のPDFページ', { exact: true })).toHaveValue('4')
    } else {
      await expect(input).toHaveValue('')
      await expect(modal.getByText(/ページが決まっていない項目が 2 件あります/)).toBeVisible()
      await expect(modal.getByRole('button', { name: '目次の下書きに入れる', exact: true })).toBeDisabled()
    }
    await input.fill('9')
    // A valid override survives changing the automatic lookup method.
    await modal.getByLabel(method === '目次のページ番号を使う' ? '本文から見出しを探す' : '目次のページ番号を使う', { exact: true }).check()
    await expect(modal.getByRole('button', { name: 'すべて外す', exact: true })).toBeEnabled()
    await expect(input).toHaveValue('9')
    await expect(modal.getByLabel('toc-1のPDFページ', { exact: true })).toHaveValue('9')
    await modal.getByRole('button', { name: '目次の下書きに入れる', exact: true }).click()
    const flat = flattenOutline([...(await items(page))])
    expect(flat).toHaveLength(2)
    expect(flat.map(({ item }) => item.target)).toEqual([
      expect.objectContaining({ kind: 'page', pageIndex: 8 }), expect.objectContaining({ kind: 'page', pageIndex: 8 }),
    ])
  })
}

for (const includeNumber of [true, false]) {
  test(`drawing list resolves title-block numbers, excludes headings and saves (number=${includeNumber})`, async ({ page }) => {
    await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
    await page.waitForFunction(() => !!window.__karu)
    await page.evaluate(bytes => window.__karu!.openBytes(bytes, '架空の図面集.pdf'), drawingFixture())
    await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
    await page.getByRole('tab', { name: '目次', exact: true }).click()
    const modal = await dialog(page)
    await expect(modal.getByLabel('図面番号で探す', { exact: true })).toBeChecked()
    await expect(modal.getByLabel('目次の開始ページ')).toHaveValue('2')
    await expect(modal.getByText('図面番号から 6 / 6 項目のページが見つかりました', { exact: true })).toBeVisible()
    for (const id of ['toc-1', 'toc-2']) {
      await expect(modal.getByLabel(`${id}を含める`, { exact: true })).not.toBeChecked()
      await expect(modal.getByLabel(`${id}を含める`, { exact: true })).toBeEnabled()
    }
    // Excluded project/title rows remain manually includable, as in SPEC-O7.
    await modal.getByLabel('toc-2を含める', { exact: true }).check()
    await modal.getByLabel('toc-2のPDFページ', { exact: true }).fill('2')
    await modal.getByLabel('toc-2を含める', { exact: true }).uncheck()
    await modal.getByLabel('番号を名称に含める', { exact: true }).setChecked(includeNumber)
    for (let i = 0; i < 6; i++) {
      const id = `toc-${i + 3}`, title = `${includeNumber ? `A-0${i} ` : ''}Fictional drawing ${i}`
      const row = modal.getByRole('row').filter({ has: page.getByLabel(`${id}を含める`, { exact: true }) })
      await expect(row.getByRole('checkbox')).toBeChecked()
      await expect(row.getByRole('cell').nth(1)).toHaveText('1')
      await expect(row.getByRole('cell').nth(2)).toHaveText(title)
      await expect(modal.getByLabel(`${id}のPDFページ`, { exact: true })).toHaveValue(String(i + 2))
    }
    await expect(modal.getByText('8 件中 6 件を入れます（深さ 1 段目まで）', { exact: true })).toBeVisible()
    await modal.getByRole('button', { name: '目次の下書きに入れる', exact: true }).click()
    const draft = await items(page)
    expect(draft).toHaveLength(6)
    expect(draft.map(item => item.title)).toEqual(Array.from({ length: 6 }, (_, i) => `${includeNumber ? `A-0${i} ` : ''}Fictional drawing ${i}`))
    expect(draft.map(item => item.target?.kind === 'page' ? item.target.pageIndex : null)).toEqual([1, 2, 3, 4, 5, 6])
    await apply(page)
    const expected = await page.evaluate(() => window.__karu!.getOutline())
    const bytes = await page.evaluate(async () => Array.from((await window.__karu!.saveToBytes())!))
    await page.evaluate(bytes => window.__karu!.openBytes(bytes, '架空の図面集_保存後.pdf'), bytes)
    await page.getByRole('tab', { name: '目次', exact: true }).click()
    expect(await page.evaluate(() => window.__karu!.getOutline())).toEqual(expected)
  })
}

test('drawing list keeps inferred levels for interspersed headings', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '架空の分類付き図面集.pdf'), drawingFixture(true))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('tab', { name: '目次', exact: true }).click()
  const modal = await dialog(page)
  await expect(modal.getByLabel('図面番号で探す', { exact: true })).toBeChecked()
  await expect(modal.getByLabel('toc-6を含める', { exact: true })).not.toBeChecked()
  const heading = modal.getByRole('row').filter({ has: page.getByLabel('toc-6を含める', { exact: true }) })
  const drawing = modal.getByRole('row').filter({ has: page.getByLabel('toc-7を含める', { exact: true }) })
  await expect(heading.getByRole('cell').nth(1)).toHaveText('1')
  await expect(drawing.getByRole('cell').nth(1)).toHaveText('2')
  await expect(modal.getByLabel('toc-7のPDFページ', { exact: true })).toHaveValue('5')
  await modal.getByLabel('toc-6を含める', { exact: true }).check()
  await modal.getByRole('button', { name: '目次の下書きに入れる', exact: true }).click()
  const draft = await items(page)
  expect(draft).toHaveLength(4)
  expect(draft[3]).toMatchObject({ title: 'Fictional discipline', target: { kind: 'page', pageIndex: 4 } })
  expect(draft[3].children).toHaveLength(3)
})
