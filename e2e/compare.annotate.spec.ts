import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import { makeComparePdf } from '../tests/compareFixtures'

async function openComparison(page: Page, shift = 0, seedIssue = false) {
  await page.addInitScript(() => {
    const target = window as Window & { __compareJobs?: Array<{ oldPage: number; newPage: number; worker: number }> }
    target.__compareJobs = []
    const workers = new WeakMap<Worker, number>()
    let workerId = 0
    const original = Worker.prototype.postMessage
    Worker.prototype.postMessage = function(message, options) {
      if (message?.type === 'renderCompare') {
        if (!workers.has(this)) workers.set(this, workerId++)
        target.__compareJobs!.push({ oldPage: message.pageIndex, newPage: message.newPageIndex, worker: workers.get(this)! })
      }
      return Reflect.apply(original, this, [message, options])
    }
  })
  await page.goto('/karu-pdf/?test=1&workers=4&warm=0')
  await page.waitForFunction(() => Boolean(window.__karu))
  let oldBytes = [...makeComparePdf({ count: 3 })]
  if (seedIssue) {
    const doc = new mupdf.PDFDocument(new Uint8Array(oldBytes)), nativePage = doc.loadPage(0), a = nativePage.createAnnotation('Stamp'), object = a.getObject(), resources = doc.newDictionary()
    const data = doc.newString(JSON.stringify({ number: 12, status: 'open', id: 'old-issue-12', version: 1 }))
    try {
      a.setRect([160,160,176,176]); a.setContents('回路名称を確認'); object.put('KaruIssue', data)
      a.setAppearance('N', null, mupdf.Matrix.identity, [0,0,16,16], resources, '1 0 0 RG 1 w 1 1 14 14 re S')
      const buffer = doc.saveToBuffer('compress')
      try { oldBytes = [...buffer.asUint8Array()] } finally { buffer.destroy() }
    } finally { data.destroy(); resources.destroy(); object.destroy(); a.destroy(); nativePage.destroy(); doc.destroy() }
  }
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, 'old.pdf'), oldBytes)
  const oldId = await page.evaluate(() => window.__karu!.listTabs()[0].docId)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, 'new.pdf'), [...makeComparePdf({ revised: true, shift, count: 4, annotation: true })])
  await page.evaluate(id => window.__karu!.activateTab(id), oldId)
  await page.getByRole('button', { name: '表示▼', exact: true }).click()
  await page.getByRole('menuitem', { name: '2つの PDF を比較…', exact: true }).click()
  await expect(page.getByLabel('比較する旧版')).toHaveValue(oldId)
  await page.getByRole('button', { name: '比較', exact: true }).click()
  await expect(page.getByTestId('compare-view')).toBeVisible()
  await expect(page.getByTestId('compare-old').locator('.page-view')).toHaveAttribute('data-sharp', 'true')
  await expect(page.getByTestId('compare-view')).toHaveAttribute('data-detection-ms', /\d/)
}

test('透過を切り替え、2組の基準点で図面のずれを補正し、ページ対応を呼び戻す', async ({ page }) => {
  test.setTimeout(60000)
  await openComparison(page, 20)
  await page.getByLabel('重ね合わせの表示').selectOption('blend')
  await page.getByLabel('新版の濃さ').fill('0.25')
  await expect(page.getByLabel('新版の濃さ')).toHaveValue('0.25')
  await page.getByText('位置合わせ・ページ対応・指摘引継ぎ', { exact: true }).click()
  await page.getByRole('button', { name: '2点で位置合わせ', exact: true }).click()
  await expect(page.getByTestId('compare-new').locator('.page-view')).toHaveAttribute('data-has-bitmap','true')
  await expect.poll(() => page.getByTestId('compare-old').evaluate(el => el.querySelector('.page-view')!.getBoundingClientRect().width-el.getBoundingClientRect().width)).toBeLessThan(1)
  const anchor = async (pane: string,x: number,y: number) => {
    const p = await page.getByTestId(pane).locator('.page-view').evaluate((el, v) => { const b=el.getBoundingClientRect(), x=b.left+b.width*v.x/400,y=b.top+b.height*v.y/400; return { x,y,hit:document.elementFromPoint(x,y)?.closest('.compare-pane')?.getAttribute('data-testid'), box:[b.left,b.top,b.width,b.height] } }, {x,y})
    expect(p.hit, JSON.stringify(p)).toBe(pane)
    await page.mouse.click(p.x,p.y)
  }
  await anchor('compare-old',80,80); await anchor('compare-new',100,80)
  await anchor('compare-old',200,180); await anchor('compare-new',220,180)
  await expect.poll(() => page.getByTestId('compare-view').getAttribute('data-offset-x').then(Number)).toBeCloseTo(-20,2)
  await expect.poll(() => page.getByTestId('compare-view').getAttribute('data-alignment-scale').then(Number)).toBeCloseTo(1,3)
  await page.getByText('位置合わせ・ページ対応・指摘引継ぎ', { exact: true }).click()
  await page.getByLabel('比較の図面番号').fill('E-01')
  await page.getByRole('button', { name: 'このページ対応を記録' }).click()
  await page.screenshot({path:'work/review-comparison.png'})
  await page.getByRole('button', { name: '次の組 ›', exact: true }).click()
  await page.getByLabel('記録したページ対応').selectOption('0')
  await expect(page.getByLabel('比較の旧ページ番号')).toHaveValue('1')
  await expect(page.getByLabel('比較の図面番号')).toHaveValue('E-01')
})

test('前回指摘は候補を確認してから追加し、再実行で重複せず新版のPDFに保存できる', async ({ page }) => {
  test.setTimeout(60000)
  await openComparison(page, 0, true)
  await page.getByText('位置合わせ・ページ対応・指摘引継ぎ', { exact: true }).click()
  await page.getByLabel('比較の新ページ番号').fill('2')
  await page.getByLabel('比較の図面番号').fill('E-01')
  await page.getByRole('button', { name: 'この図面の指摘を引き継ぐ' }).click()
  const dialog = page.getByRole('dialog', { name: '前回指摘の引継ぎ' })
  await dialog.getByRole('button', { name: '全候補を選択' }).click()
  await expect(dialog.getByRole('button', { name: '選択した指摘を新版に追加' })).toBeDisabled()
  await dialog.getByLabel('図面番号・ページ対応・候補位置を確認しました').check()
  await dialog.getByRole('button', { name: '選択した指摘を新版に追加' }).click()
  await expect(dialog).toContainText('番号を保った 1件、番号が重なったため付け直した 0件')
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
  await page.getByRole('button', { name: 'この図面の指摘を引き継ぐ' }).click()
  await expect(dialog).toContainText('引継ぎ済')
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
  await page.getByRole('button', { name: '終わる', exact: true }).click()
  await page.evaluate(async () => { const id=window.__karu!.listTabs().find(t=>t.name==='new.pdf')!.docId; await window.__karu!.activateTab(id); const b=await window.__karu!.saveToBytes(); if(!b)throw Error('保存失敗'); await window.__karu!.openBytes(b,'引継ぎ済.pdf') })
  await page.getByRole('tab', { name: '書き込み', exact: true }).click()
  await expect(page.locator('.annotation-type-icon')).toContainText(['12'])
  const issue = await page.evaluate(() => window.__karu!.getEditableAnnotations(1).find(a=>a.issue))
  expect(issue).toMatchObject({ text: '回路名称を確認', issue: { number: 12, sourceNumber: 12, sourceId: 'old-issue-12', sourceDocument: 'old.pdf', drawingNumber: 'E-01', status: 'open' } })
})
async function raster(page: Page, pane = 'compare-old') {
  return page.getByTestId(pane).locator('.preview-canvas').evaluate(el => {
    const c = el as HTMLCanvasElement
    const pixel = (x: number, y: number) => [...c.getContext('2d')!.getImageData(Math.floor(x * c.width / 400), Math.floor(y * c.height / 400), 1, 1).data].slice(0, 3)
    return { a: pixel(60, 40), bOld: pixel(201, 90), bNew: pixel(211, 90), c: pixel(300, 185), annotation: pixel(160, 260) }
  })
}
test('比較の実画素と3領域を確認し、一覧とN/Pで拡大・移動、書き込みを切り替える', async ({ page }) => {
  await openComparison(page)
  await expect(page.getByTestId('compare-difference')).toHaveCount(3)
  const colors = await raster(page)
  expect(colors).toEqual({ a: [128, 128, 128], bOld: [255, 0, 0], bNew: [0, 0, 255], c: [0, 0, 255], annotation: [255, 255, 255] })
  const boxes = await page.getByTestId('compare-difference').evaluateAll(rows => rows.map(row => row.getAttribute('data-rect')!.split(',').map(Number)))
  expect(boxes[0]).toEqual([200, 70, 203, 130]); expect(boxes[1]).toEqual([210, 70, 213, 130])
  expect(boxes[2][0]).toBeGreaterThan(280)
  await page.getByTestId('compare-difference').nth(2).click()
  await expect(page.getByTestId('compare-difference').nth(2)).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.getByTestId('compare-old').locator('.viewer').getAttribute('data-zoom').then(Number)).toBeGreaterThan(3)
  const contained = await page.getByTestId('compare-old').evaluate(el => {
    const viewport = el.querySelector('.viewer')!.getBoundingClientRect(), box = el.querySelector('.compare-region-layer rect.active')!.getBoundingClientRect()
    return box.left >= viewport.left && box.right <= viewport.right && box.top >= viewport.top && box.bottom <= viewport.bottom
  })
  expect(contained).toBe(true)
  await page.keyboard.press('n')
  await expect(page.getByTestId('compare-difference').nth(0)).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('p')
  await expect(page.getByTestId('compare-difference').nth(2)).toHaveAttribute('aria-pressed', 'true')
  await page.getByLabel('書き込みも比べる').check()
  await expect(page.getByTestId('compare-difference')).toHaveCount(4)
  await page.getByLabel('書き込みも比べる').uncheck()
  await expect(page.getByTestId('compare-difference')).toHaveCount(3)
})
test('方向キーは1px、Shiftは10px、150msの仮表示とページ組ごとのずれを戻す', async ({ page }) => {
  await openComparison(page, 2)
  const viewer = page.getByTestId('compare-old').locator('.viewer')
  const scale = await viewer.getAttribute('data-zoom').then(Number)
  const edgeColor = () => page.getByTestId('compare-old').locator('.preview-canvas').evaluate(el => {
    const c = el as HTMLCanvasElement
    return [...c.getContext('2d')!.getImageData(Math.floor(43 * c.width / 400), Math.floor(60 * c.height / 400), 1, 1).data].slice(0, 3)
  })
  expect(await edgeColor()).toEqual([0, 0, 255])
  await viewer.focus()
  await page.keyboard.press('ArrowLeft')
  const offset = -1 / (scale * 96 / 72)
  await expect.poll(() => page.getByTestId('compare-view').getAttribute('data-offset-x').then(Number)).toBeCloseTo(offset, 5)
  await page.keyboard.press('Shift+ArrowLeft')
  await expect.poll(() => page.getByTestId('compare-view').getAttribute('data-offset-x').then(Number)).toBeCloseTo(offset * 11, 5)
  await expect.poll(edgeColor).toEqual([255, 255, 255])
  await page.getByRole('button', { name: '次の組 ›', exact: true }).click()
  await expect(page.getByTestId('compare-view')).toHaveAttribute('data-offset-x', '0')
  await page.getByRole('button', { name: '‹ 前の組', exact: true }).click()
  await expect.poll(() => page.getByTestId('compare-view').getAttribute('data-offset-x').then(Number)).toBeCloseTo(offset * 11, 5)
  await page.getByRole('button', { name: '戻す', exact: true }).click()
  await expect(page.getByTestId('compare-view')).toHaveAttribute('data-offset-x', '0')
  await expect(page.getByTestId('compare-view')).toHaveAttribute('data-offset-y', '0')
  await expect.poll(edgeColor).toEqual([0, 0, 255])
})
test('並べると両側の実画素と囲みが正しく、左右の移動と倍率が同期し、終わると破棄する', async ({ page }) => {
  await openComparison(page)
  await page.getByLabel('並べる', { exact: true }).check()
  for (const side of ['compare-old', 'compare-new']) {
    await expect(page.getByTestId(side).locator('.page-view')).toHaveAttribute('data-sharp', 'true')
    await expect(page.getByTestId(side).locator('.compare-region-layer rect')).toHaveCount(3)
    await expect(page.getByTestId(side).locator('[data-testid^="annotation-layer-"]')).toHaveCount(0)
  }
  expect((await raster(page)).bOld).toEqual([0, 0, 0])
  expect((await raster(page, 'compare-new')).bNew).toEqual([0, 0, 0])
  expect((await raster(page, 'compare-new')).annotation).toEqual([255, 255, 255])
  await page.getByRole('button', { name: '比較を拡大' }).click()
  const left = page.getByTestId('compare-old').locator('.viewer'), right = page.getByTestId('compare-new').locator('.viewer')
  await expect.poll(async () => Math.abs(Number(await left.getAttribute('data-zoom')) - Number(await right.getAttribute('data-zoom')))).toBeLessThan(.002)
  await right.focus(); await page.keyboard.press('PageDown')
  await expect.poll(async () => Math.abs(await left.evaluate(el => el.scrollTop) - await right.evaluate(el => el.scrollTop))).toBeLessThan(2)
  await page.getByRole('button', { name: '終わる', exact: true }).click()
  await expect(page.getByTestId('compare-view')).toHaveCount(0)
  await expect(page.locator('.compare-region-layer')).toHaveCount(0)
  await expect(page.getByTestId('viewer')).toBeVisible()
  await page.keyboard.press('r')
  await expect(page.getByRole('button', { name: '四角', exact: true })).toHaveAttribute('aria-pressed', 'true')
})
test('旧と新の対応を変えても現在の組だけを比較し、終了後は要求を増やさない', async ({ page }) => {
  await openComparison(page)
  const jobs = () => page.evaluate(() => (window as Window & { __compareJobs?: Array<{ oldPage: number; newPage: number; worker: number }> }).__compareJobs ?? [])
  expect((await jobs()).every(job => job.oldPage === 0 && job.newPage === 0)).toBe(true)
  expect(new Set((await jobs()).map(job => job.worker)).size).toBe(1)
  const before = (await jobs()).length
  await page.getByLabel('比較の旧ページ番号').fill('2')
  await page.getByLabel('比較の新ページ番号').fill('3')
  await expect(page.getByTestId('compare-difference')).toHaveCount(3)
  await expect(page.getByTestId('compare-difference').first()).toContainText('p.2')
  await expect(page.getByTestId('compare-old').locator('.page-empty')).toHaveCount(1)
  const changed = (await jobs()).slice(before)
  expect(changed.some(job => job.oldPage === 1 && job.newPage === 2)).toBe(true)
  expect(changed.every(job => job.oldPage === 1 && [0, 2].includes(job.newPage))).toBe(true)
  await page.getByRole('button', { name: '終わる', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__karu!.isIdle())).toBe(true)
  const processed = await page.evaluate(async () => (await window.__karu!.getWorkerStats()).processedCount)
  const count = (await jobs()).length
  await page.waitForTimeout(300)
  expect(await page.evaluate(async () => (await window.__karu!.getWorkerStats()).processedCount)).toBe(processed)
  expect((await jobs()).length).toBe(count)
})

test('旧版→新版の順に開いたまま比較を始めると、先に開いた方が旧版になる', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.waitForFunction(() => Boolean(window.__karu))
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, 'old.pdf'), [...makeComparePdf({ count: 1 })])
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, 'new.pdf'), [...makeComparePdf({ revised: true, count: 1 })])
  const [oldId, newId] = await page.evaluate(() => window.__karu!.listTabs().map(tab => tab.docId))
  await page.getByRole('button', { name: '表示▼', exact: true }).click()
  await page.getByRole('menuitem', { name: '2つの PDF を比較…', exact: true }).click()
  await expect(page.getByLabel('比較する旧版')).toHaveValue(oldId)
  await expect(page.getByLabel('比較する新版')).toHaveValue(newId)
})
