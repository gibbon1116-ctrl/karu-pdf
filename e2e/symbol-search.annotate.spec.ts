import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'

const centers = [[80, 140], [160, 140], [80, 240], [160, 240], [80, 340], [160, 340]] as const
type Probe = { created: number; terminated: number; searches: number; holdAfter: number | null; release: (() => void) | null }
type ProbeWindow = Window & { __visualSearchProbe: Probe }
function symbolPdf(pageCount = 1, withHatching = false) {
  const doc = new mupdf.PDFDocument()
  try {
    // These are PDF page contents, not annotations. Circle + cross, diameter 12 pt.
    const symbols = centers.map(([x, y], index) => {
      if (withHatching) {
        const left = x - 1.5, top = y - 9.5
        const hatch = index < 3 ? '' : [0,1,2,3,4].map(d => `${left} ${top+d} m ${left+3} ${top+19-d} l S`).join('\n')
        return `${left} ${top} 3 19 re S ${hatch}`
      }
      const r = 6, k = r * .5522847498
      return `${x + r} ${y} m ${x + r} ${y + k} ${x + k} ${y + r} ${x} ${y + r} c
        ${x - k} ${y + r} ${x - r} ${y + k} ${x - r} ${y} c
        ${x - r} ${y - k} ${x - k} ${y - r} ${x} ${y - r} c
        ${x + k} ${y - r} ${x + r} ${y - k} ${x + r} ${y} c S
        ${x - r} ${y} m ${x + r} ${y} l S ${x} ${y - r} m ${x} ${y + r} l S`
    }).join('\n')
    const squares = [260, 340, 420].map(x => `${x - 6} 434 12 12 re S`).join('\n')
    for (let i = 0; i < pageCount; i++) {
      const ref = doc.addPage([0, 0, 500, 500], 0, {}, `q 1 0 0 -1 0 500 cm 0 G 0.8 w ${symbols}\n${squares} Q`)
      try { doc.insertPage(-1, ref) } finally { ref.destroy() }
    }
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { doc.destroy() }
}
const panel = (page: Page) => page.getByRole('dialog', { name: '同じ記号を探す', exact: true })
const candidates = (page: Page, state?: string) => state ? page.locator(`[data-testid="symbol-search-candidate"][data-state="${state}"]`) : page.getByTestId('symbol-search-candidate')
const quantity = (page: Page) => page.getByTestId('fixture-panel')
const marks = (page: Page) => page.evaluate(() => window.__karu!.getEditableAnnotations(0).filter(a => a.count).length)

async function open(page: Page, pageCount = 1, withHatching = false) {
  await page.addInitScript(() => {
    const scope = window as unknown as ProbeWindow
    scope.__visualSearchProbe = { created: 0, terminated: 0, searches: 0, holdAfter: null, release: null }
    const NativeWorker = window.Worker
    window.Worker = new Proxy(NativeWorker, {
      construct(Target, args) {
        const worker = Reflect.construct(Target, args) as Worker
        if (!/symbolSearch[.-]worker/.test(String(args[0]))) return worker
        const probe = scope.__visualSearchProbe
        probe.created++
        const send = worker.postMessage.bind(worker), terminate = worker.terminate.bind(worker)
        worker.postMessage = ((message: { type?: string }, transfer: Transferable[]) => {
          if (message.type === 'search' || message.type === 'vector-search') {
            probe.searches++
            // Hold only a selected request to make cancellation deterministic. Other searches are real.
            if (probe.holdAfter !== null && probe.searches >= probe.holdAfter) {
              probe.release = () => { probe.release = null; send(message, transfer) }
              return
            }
          }
          send(message, transfer)
        }) as Worker['postMessage']
        worker.terminate = () => { probe.terminated++; probe.release = null; terminate() }
        return worker
      },
    })
  })
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '同じ記号の試験.pdf'), symbolPdf(pageCount, withHatching))
  await page.evaluate(() => window.__karu!.setZoom(1))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  for (const [code, name, kind] of [['LED', '照明', '個数'], ['CV', 'ケーブル', '長さ']] as const) {
    await quantity(page).getByRole('button', { name: '項目を追加', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
    await dialog.getByLabel('名称', { exact: true }).fill(name)
    await dialog.getByLabel('略号', { exact: true }).fill(code)
    await dialog.getByRole('radio', { name: kind, exact: true }).check()
    await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  }
  await quantity(page).getByRole('button', { name: 'LED 照明', exact: true }).click()
}
async function capture(page: Page, viaBar = false) {
  const source = viaBar ? page.getByRole('toolbar', { name: '拾いバー' }) : quantity(page)
  await source.getByRole('button', { name: '同じ記号を探す', exact: true }).click()
  await expect(page.locator('.fixture-sample-instruction')).toContainText('探す記号を四角で囲んでください（Esc で中止）')
  const svg = page.getByTestId('fixture-sample-selection-0')
  const points = await svg.evaluate(el => {
    const svg = el as SVGSVGElement, box = svg.getBoundingClientRect()
    return [[71, 131], [89, 149]].map(([x, y]) => ({ x: box.left + x * box.width / svg.viewBox.baseVal.width, y: box.top + y * box.height / svg.viewBox.baseVal.height }))
  })
  await page.mouse.move(points[0].x, points[0].y); await page.mouse.down()
  await page.mouse.move(points[1].x, points[1].y, { steps: 4 }); await page.mouse.up()
  await expect(panel(page)).toBeVisible()
  await expect(panel(page).getByRole('slider', { name: '似ている度合い' })).toHaveValue('0.85')
  await expect(panel(page)).not.toHaveAttribute('aria-modal')
  await expect(panel(page).getByRole('img', { name: '探す記号の見本' })).toBeVisible()
  await expect.poll(() => panel(page).getByRole('img').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
}
async function search(page: Page, expected = 6) {
  await panel(page).getByRole('button', { name: '探す', exact: true }).click()
  await expect(panel(page).getByText('検索が終わりました。候補を確認して選んでください')).toBeVisible({ timeout: 60_000 })
  await expect(panel(page)).toContainText(`候補 ${expected} 件`)
}
async function holdNextSearch(page: Page, offset = 1) {
  await page.evaluate(offset => { const p = (window as unknown as ProbeWindow).__visualSearchProbe; p.holdAfter = p.searches + offset }, offset)
}
async function waitForHeldSearch(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as ProbeWindow).__visualSearchProbe.release, undefined, { timeout: 60_000 })
}

test('actual matching, candidate choice, one-step undo/redo, counted candidates and remaining quantity', async ({ page }) => {
  await open(page); await capture(page); await search(page)
  await expect(candidates(page)).toHaveCount(6)
  expect(await marks(page)).toBe(0)
  const foundCenters = await candidates(page).locator('rect').evaluateAll(rects => rects.map(el => {
    const r = el as SVGRectElement
    return [r.x.baseVal.value + r.width.baseVal.value / 2, r.y.baseVal.value + r.height.baseVal.value / 2]
  }))
  for (const [x, y] of foundCenters) expect(centers.some(([cx, cy]) => Math.hypot(x - cx, y - cy) < 2)).toBe(true)
  for (let i = 0; i < 3; i++) await candidates(page, 'pending').first().click()
  await expect(candidates(page, 'chosen')).toHaveCount(3)
  await expect(candidates(page).first().locator('title')).toContainText(/線 [0-9.]+・余分な線 [0-9]+%・画像 [0-9.]+/)
  await panel(page).getByRole('button', { name: '選んだ 3 件を数量へ追加', exact: true }).click()
  expect(await marks(page)).toBe(3)
  await expect(quantity(page)).toContainText('全図面: 3個')
  await expect(candidates(page, 'pending')).toHaveCount(3); await expect(candidates(page, 'counted')).toHaveCount(3)
  await expect(panel(page)).toContainText('3 件を数量へ追加しました（Ctrl+Z で戻せます）')
  await page.keyboard.press('Control+z'); expect(await marks(page)).toBe(0)
  await expect(quantity(page)).toContainText('全図面: 0個'); await expect(candidates(page, 'pending')).toHaveCount(6)
  // Restore the three marks before testing "already counted" on a fresh search.
  await page.keyboard.press('Control+y'); expect(await marks(page)).toBe(3)
  await search(page)
  await expect(candidates(page, 'counted')).toHaveCount(3)
  await candidates(page, 'counted').first().click({ force: true })
  await expect(candidates(page, 'chosen')).toHaveCount(0); expect(await marks(page)).toBe(3)
  await panel(page).getByRole('button', { name: 'すべて選ぶ', exact: true }).click()
  await expect(candidates(page, 'chosen')).toHaveCount(3)
  await panel(page).getByRole('button', { name: '選んだ 3 件を数量へ追加', exact: true }).click()
  expect(await marks(page)).toBe(6); await expect(quantity(page)).toContainText('全図面: 6個')
  await expect(candidates(page, 'counted')).toHaveCount(6)
  await panel(page).getByRole('button', { name: '閉じる', exact: true }).click()
  await expect(candidates(page)).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__visualSearchProbe.terminated)).toBeGreaterThan(0)
})

test('stop preserves finished pages, prevents additional candidates and releases the worker on close', async ({ page }) => {
  await open(page, 2); await capture(page, true)
  await panel(page).getByRole('radio', { name: 'すべてのページ', exact: true }).check()
  await holdNextSearch(page, 2)
  await panel(page).getByRole('button', { name: '探す', exact: true }).click()
  await waitForHeldSearch(page)
  await expect(panel(page)).toContainText('候補 6 件')
  await expect(panel(page)).toContainText(/ページ 2 \/ 2・(線で照合中|画像で確認中)/)
  await panel(page).getByRole('button', { name: '中止', exact: true }).click()
  await expect(panel(page)).toContainText('中止しました')
  await expect(panel(page).getByRole('progressbar')).toHaveCount(0)
  await page.evaluate(() => (window as unknown as ProbeWindow).__visualSearchProbe.release?.())
  await expect.poll(() => page.evaluate(() => window.__karu!.isIdle())).toBe(true)
  await expect(panel(page)).toContainText('候補 6 件'); expect(await marks(page)).toBe(0)
  await panel(page).getByRole('button', { name: '閉じる', exact: true }).click()
  await expect(candidates(page)).toHaveCount(0)
})

test('specified pages are searched sequentially and page totals navigate to the drawing', async ({ page }) => {
  await open(page, 2); await capture(page)
  await panel(page).getByRole('radio', { name: 'ページを指定', exact: true }).check()
  await panel(page).getByRole('textbox', { name: '探すページ' }).fill('1-2')
  await search(page, 12)
  await expect(panel(page).getByRole('button', { name: /^p.1 線で探しました 6 件/  })).toBeVisible()
  await panel(page).getByRole('button', { name: /^p.2 線で探しました 6 件/ }).click()
  await expect(page.getByTestId('annotation-layer-1')).toBeVisible()
  await expect(page.getByTestId('symbol-search-candidates-1').getByTestId('symbol-search-candidate')).toHaveCount(6)
  await panel(page).getByRole('button', { name: 'すべて選ぶ', exact: true }).click()
  await panel(page).getByRole('button', { name: '選んだ 12 件を数量へ追加', exact: true }).click()
  await expect(quantity(page)).toContainText('全図面: 12個')
  const perPage = await page.evaluate(() => [0, 1].map(i => window.__karu!.getEditableAnnotations(i).filter(a => a.count).length))
  expect(perPage).toEqual([6, 6])
  await page.keyboard.press('Control+z')
  await expect(quantity(page)).toContainText('全図面: 0個')
})

test('closing pending candidates adds nothing to the quantity', async ({ page }) => {
  await open(page); await capture(page); await search(page)
  await expect(candidates(page, 'pending')).toHaveCount(6)
  await panel(page).getByRole('button', { name: '閉じる', exact: true }).click()
  await expect(candidates(page)).toHaveCount(0)
  expect(await marks(page)).toBe(0); await expect(quantity(page)).toContainText('全図面: 0個')
})

test('controls, recapture and item/side-tab/document/organize lifecycle clear candidates and dispose search', async ({ page }) => {
  await open(page); await capture(page); await search(page)
  await panel(page).getByRole('slider', { name: '似ている度合い' }).press('ArrowRight')
  await expect(candidates(page)).toHaveCount(0); await expect(panel(page)).toContainText('0.86')
  await panel(page).getByRole('checkbox', { name: '回転した記号も探す' }).check()
  await panel(page).getByRole('radio', { name: 'ページを指定', exact: true }).check()
  await panel(page).getByRole('textbox', { name: '探すページ' }).fill('1-2')
  await panel(page).getByRole('button', { name: '探す', exact: true }).click()
  await expect(panel(page).getByRole('alert')).toContainText('範囲外')
  await panel(page).getByRole('textbox', { name: '探すページ' }).fill('1')
  await search(page)
  await panel(page).getByRole('button', { name: 'すべて選ぶ', exact: true }).click()
  await panel(page).getByRole('button', { name: 'すべて外す', exact: true }).click()
  await expect(candidates(page, 'pending')).toHaveCount(6)
  await panel(page).getByRole('button', { name: '見本を囲み直す' }).click()
  await expect(candidates(page)).toHaveCount(0); await expect(panel(page)).toHaveCount(0)
  await page.keyboard.press('Escape'); await expect(page.getByTestId('fixture-sample-selection-0')).toHaveCount(0)
  await capture(page); await search(page)
  await quantity(page).getByRole('button', { name: 'CV ケーブル', exact: true }).click()
  await expect(panel(page)).toHaveCount(0); await expect(candidates(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: '同じ記号を探す', exact: true })).toHaveCount(0)
  expect(await marks(page)).toBe(0)
  await quantity(page).getByRole('button', { name: 'LED 照明', exact: true }).click()
  await capture(page); await holdNextSearch(page)
  await panel(page).getByRole('button', { name: '探す', exact: true }).click(); await waitForHeldSearch(page)
  await page.getByRole('tab', { name: '書き込み', exact: true }).click()
  await expect(panel(page)).toHaveCount(0); await expect(candidates(page)).toHaveCount(0)
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await page.evaluate(() => { (window as unknown as ProbeWindow).__visualSearchProbe.holdAfter = null })
  await capture(page); await search(page)
  await page.evaluate(() => window.__karu!.openOrganize())
  await expect(panel(page)).toHaveCount(0); await expect(candidates(page)).toHaveCount(0)
  await page.keyboard.press('Escape')
  await capture(page); await search(page)
  const original = await page.evaluate(() => window.__karu!.listTabs()[0].docId)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '別の図面.pdf'), symbolPdf())
  await expect(panel(page)).toHaveCount(0); await expect(candidates(page)).toHaveCount(0)
  await page.evaluate(docId => window.__karu!.activateTab(docId), original)
  await expect(panel(page)).toHaveCount(0)
  await capture(page); await search(page)
  await page.evaluate(docId => window.__karu!.closeTab(docId), original)
  await expect(panel(page)).toHaveCount(0); await expect(candidates(page)).toHaveCount(0)
  expect(await page.evaluate(() => {
    const p = (window as unknown as ProbeWindow).__visualSearchProbe; return p.created === p.terminated
  })).toBe(true)
})

test('ordinary viewing, zoom, scrolling and manual pickup never create the matching worker', async ({ page }) => {
  await open(page)
  await page.getByTestId('viewer').evaluate(el => { el.scrollTop += 100 })
  await page.evaluate(() => window.__karu!.setZoom(.8))
  await page.evaluate(() => window.__karu!.setZoom(1))
  const position = await page.getByTestId('annotation-layer-0').evaluate(el => {
    const svg = el as SVGSVGElement, box = svg.getBoundingClientRect()
    return { x: 80 * box.width / svg.viewBox.baseVal.width, y: 140 * box.height / svg.viewBox.baseVal.height }
  })
  await page.getByTestId('annotation-layer-0').click({ position })
  expect(await marks(page)).toBe(1)
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__visualSearchProbe.created)).toBe(0)
  expect(await page.evaluate(() => performance.getEntriesByType('resource').filter(e => /symbolSearch[.-]worker/.test(e.name)).length)).toBe(0)
  await expect(candidates(page)).toHaveCount(0)
})


test('斜線入りも候補に残し、画像の確認がオフでも要確認に分ける', async ({ page }) => {
  await open(page, 1, true); await capture(page)
  await panel(page).getByRole('checkbox', { name: '画像でも確認する', exact: true }).uncheck()
  await search(page)
  const high = page.locator('[data-testid="symbol-search-candidate"][data-confidence="high"]')
  const check = page.locator('[data-testid="symbol-search-candidate"][data-confidence="check"]')
  await expect(high).toHaveCount(3); await expect(check).toHaveCount(3)
  for (const candidate of await check.all()) {
    const y = await candidate.locator('rect').evaluate(el => {
      const r = el as SVGRectElement; return r.y.baseVal.value + r.height.baseVal.value / 2
    })
    expect(y).toBeGreaterThanOrEqual(240)
    await expect(candidate.locator('title')).toContainText(/線 [0-9.]+・余分な線 [0-9]+%/)
    await expect(candidate.locator('title')).not.toContainText('画像')
  }
  await panel(page).getByRole('button', { name: '確度の高い候補を選ぶ', exact: true }).click()
  await expect(candidates(page, 'chosen')).toHaveCount(3)
  for (const candidate of await high.all()) await expect(candidate).toHaveAttribute('data-state', 'chosen')
  for (const candidate of await check.all()) await expect(candidate).toHaveAttribute('data-state', 'pending')
  expect(await marks(page)).toBe(0)
})
