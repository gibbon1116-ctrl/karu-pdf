import mupdf from 'mupdf'
import { extractTextLines } from '../src/core/textExtract'
import fs from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

function pdf(word = 'AAAA'): Buffer {
  const doc = new mupdf.PDFDocument()
  try {
    for (const [width, height] of [[400, 500], [595, 842], [2384, 1684]]) {
      const page = doc.addPage([0, 0, width, height], 0, { Font: { F1: { Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' } } }, `BT /F1 18 Tf 20 ${height - 50} Td (SECRET ${word}) Tj 0 -120 Td (PUBLIC) Tj ET`)
      try { doc.insertPage(-1, page) } finally { page.destroy() }
    }
    const info = doc.newDictionary(); info.put('Author', doc.newString('PRIVATE AUTHOR')); doc.getTrailer().put('Info', doc.addObject(info))
    const buffer = doc.saveToBuffer('garbage=1')
    try { return Buffer.from(buffer.asUint8Array()) } finally { buffer.destroy() }
  } finally { doc.destroy() }
}
async function menu(page: Page, group: string, item: string) {
  await page.getByRole('button', { name: `${group}▼`, exact: true }).click()
  await page.getByRole('menu').getByText(item, { exact: true }).click()
}
async function point(page: Page, x: number, y: number) {
  const layer = page.getByTestId('annotation-layer-0')
  const local = await layer.evaluate((element, position) => {
    const svg = element as SVGSVGElement, box = svg.getBoundingClientRect(), view = svg.viewBox.baseVal
    return { x: position.x * box.width / view.width, y: position.y * box.height / view.height }
  }, { x, y })
  // Let Playwright wait for a stable, unobstructed annotation surface after zoom/menu changes.
  await layer.hover({ position: local })
  return layer.evaluate((element, position) => {
    const svg = element as SVGSVGElement, box = svg.getBoundingClientRect(), view = svg.viewBox.baseVal
    return { x: box.left + position.x * box.width / view.width, y: box.top + position.y * box.height / view.height }
  }, { x, y })
}
async function open(page: Page, url: string) {
  await page.goto(url)
  await page.getByTestId('file-input').setInputFiles({ name: 'drawing.pdf', mimeType: 'application/pdf', buffer: pdf() })
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__karu?.isSharp())).toBe(true)
  await firstPage(page)
}
async function firstPage(page: Page) {
  await page.evaluate(() => window.__karu!.setZoom(1))
  await expect.poll(() => page.locator('.page-view[data-page-index="0"]').evaluate(el => el.getBoundingClientRect().height)).toBeCloseTo(500 * 4 / 3, 0)
  await page.evaluate(() => window.__karu!.scrollToPage(0))
  await expect(page.getByText('1 / 3 ページ', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__karu!.isSharp())).toBe(true)
  await expect.poll(() => page.evaluate(() => window.__karu!.isIdle())).toBe(true)
}
async function square(page: Page) {
  await page.getByRole('button', { name: '図形▼', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: '四角', exact: true }).click()
  const start = await point(page, 15, 25), end = await point(page, 160, 75)
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 4 }); await page.mouse.up()
  await page.getByRole('button', { name: '選択', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).filter(a => a.kind === 'square').length)).toBe(1)
}
async function mockWrites(page: Page, fail = false, injectError = false) {
  await page.addInitScript(({ fail, injectError }) => {
    Object.assign(window, { __writes: [] as number[][], __failWrite: fail, __injectError: injectError })
    const NativeWorker = window.Worker
    class CheckedWorker extends NativeWorker {
      set onmessage(handler: ((this: Worker, ev: MessageEvent) => unknown) | null) {
        super.onmessage = handler ? function(event: MessageEvent) {
          if (event.data?.type === 'appliedAndSaved' && (window as any).__injectError) event.data.errors = [{ editIndex: 0, message: 'SYNTHETIC_REFLECTION_FAILURE' }]
          return handler.call(this, event)
        } : null
      }
      get onmessage() { return super.onmessage }
    }
    window.Worker = CheckedWorker
    window.showSaveFilePicker = async () => ({
      name: 'output.pdf', queryPermission: async () => 'granted', requestPermission: async () => 'granted',
      createWritable: async () => ({
        write: async (bytes: ArrayBuffer) => { if ((window as any).__failWrite) throw new Error('SYNTHETIC_WRITE_FAILURE'); (window as any).__writes.push([...new Uint8Array(bytes)]) },
        close: async () => undefined,
      }),
    }) as any
  }, { fail, injectError })
}

export function businessCases(url: string) {
  test('明示実行で図面文字をCSVに出し、配布形態にかかわらず再抽出と終了後のキャッシュを制限する', async ({ page }) => {
    await open(page, url)
    expect((await page.evaluate(() => window.__karu!.getWorkerStats())).extractedTextCacheBytes).toBe(0)
    await menu(page, 'ファイル', '図面内文字を抽出…')
    const dialog = page.getByRole('dialog', { name: '図面内文字を抽出' })
    await dialog.getByLabel('抽出するページ').selectOption('all')
    for (let attempt = 0; attempt < 2; attempt++) {
      await dialog.getByRole('button', { name: '文字を抽出', exact: true }).click()
      await expect(dialog.getByRole('link', { name: '抽出結果を保存' })).toBeVisible()
      const download = page.waitForEvent('download')
      await dialog.getByRole('link', { name: '抽出結果を保存' }).click()
      const csv = await fs.readFile(await (await download).path() as string, 'utf8')
      expect(csv.startsWith('\uFEFF')).toBe(true)
      expect(csv.match(/SECRET AAAA/g)).toHaveLength(3)
      expect(csv.match(/PUBLIC/g)).toHaveLength(3)
      const bytes = (await page.evaluate(() => window.__karu!.getWorkerStats())).extractedTextCacheBytes
      expect(bytes).toBeGreaterThan(0); expect(bytes).toBeLessThanOrEqual(4 * 1024 * 1024)
    }
    await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
    for (const docId of await page.evaluate(() => window.__karu!.listTabs().map(tab => tab.docId))) await page.evaluate(docId => window.__karu!.closeTab(docId), docId)
    await expect.poll(async () => (await page.evaluate(() => window.__karu!.getWorkerStats())).extractedTextCacheBytes).toBe(0)
  })
  test('矢印・吹き出しの先端サイズと5度刻みを保存後も保持する', async ({ page }) => {
    await open(page, url)
    for (const [name, kind, y] of [['矢印', 'arrow', 170], ['蛍光ペン', 'highlight', 220], ['手書き', 'ink', 290]] as const) {
      await page.getByRole('button', { name: '選択', exact: true }).click()
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: kind === 'arrow' ? '図形▼' : 'ペン▼', exact: true }).click()
      await page.getByRole('menuitemcheckbox', { name, exact: true }).click()
      if (kind === 'arrow') await page.getByLabel('矢印先端の大きさ').selectOption('24')
      const start = await point(page, 80, y), end = await point(page, 180, y + 27)
      await page.keyboard.down('Shift'); await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 4 }); await page.mouse.up(); await page.keyboard.up('Shift')
      const line = await page.evaluate(kind => { const a = window.__karu!.getEditableAnnotations(0).find(a => a.kind === kind)!; return a.line ?? a.inkList![0] }, kind)
      expect(line).toHaveLength(2)
      expect(Math.atan2(line[1][1] - line[0][1], line[1][0] - line[0][0]) * 180 / Math.PI).toBeCloseTo(15, 5)
    }
    await page.getByRole('button', { name: '選択', exact: true }).click(); await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '文字▼', exact: true }).click()
    await page.getByRole('menuitemcheckbox', { name: '吹き出し', exact: true }).click()
    await page.getByLabel('矢印先端の大きさ').selectOption('16')
    const tip = await point(page, 70, 340), box = await point(page, 160, 360)
    await page.mouse.move(tip.x, tip.y); await page.mouse.down(); await page.mouse.move(box.x, box.y, { steps: 4 }); await page.mouse.up()
    await page.getByTestId('text-editor').fill('納まり確認')
    await page.keyboard.press('Control+Enter')
    await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).find(a => a.kind === 'callout')?.arrowHeadSize)).toBe(16)
    await page.evaluate(async () => { const bytes = await window.__karu!.saveToBytes(); if (bytes) await window.__karu!.openBytes(bytes, '矢印保存.pdf') })
    await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).filter(a => a.kind === 'arrow' || a.kind === 'callout').map(a => a.arrowHeadSize))).toEqual([24, 16])
    await page.screenshot({ path: `test-results/business-${url.startsWith('file:') ? 'single' : 'fixed'}-arrows.png` })
  })
  test('ページ整理の通常・拡大プレビューを25～75％に縮小する', async ({ page }) => {
    await open(page, url); await page.evaluate(() => window.__karu!.openOrganize())
    await page.getByTestId('organize-card-0').click()
    const pane = page.getByTestId('organize-preview-pane'), preview = page.getByTestId('organize-preview-canvas')
    await expect(preview).toHaveAttribute('data-rendered', 'true')
    const original = await preview.evaluate(el => el.getBoundingClientRect().width)
    for (const percent of [75, 50, 25]) {
      await pane.getByRole('button', { name: 'プレビューを縮小', exact: true }).click()
      await expect(pane.getByRole('button', { name: `${percent}%`, exact: true })).toBeVisible()
      await expect.poll(() => preview.evaluate(el => el.getBoundingClientRect().width)).toBeCloseTo(original * percent / 100, 0)
    }
    await expect(pane.getByRole('button', { name: 'プレビューを縮小', exact: true })).toBeDisabled()
    await page.getByTestId('organize-card-0').dblclick()
    const dialog = page.getByRole('dialog', { name: '拡大プレビュー' })
    await dialog.getByRole('button', { name: '100%', exact: true }).click()
    await dialog.getByRole('menuitemcheckbox', { name: '50%', exact: true }).click()
    await expect(dialog.getByRole('button', { name: '50%', exact: true })).toBeVisible()
    await page.screenshot({ path: `test-results/business-${url.startsWith('file:') ? 'single' : 'fixed'}-preview.png` })
  })
  test('電子署名値のあるPDFは閲覧・ズームでき、編集と保存操作を無効にする', async ({ page }) => {
    await page.goto(url)
    const doc = new mupdf.PDFDocument(pdf()), root = doc.getTrailer().get('Root')
    let bytes: Buffer
    try {
      root.put('AcroForm', { Fields: [doc.addObject({ FT: 'Sig', V: doc.addObject({ Contents: 'SYNTHETIC SIGNATURE VALUE' }) })] })
      const buffer = doc.saveToBuffer('garbage=1'); try { bytes = Buffer.from(buffer.asUint8Array()) } finally { buffer.destroy() }
    } finally { root.destroy(); doc.destroy() }
    await page.getByTestId('file-input').setInputFiles({ name: '署名試験.pdf', mimeType: 'application/pdf', buffer: bytes! })
    await expect(page.getByText(/閲覧専用: 電子署名/)).toBeVisible()
    await expect(page.getByRole('button', { name: '図形▼', exact: true })).toBeDisabled()
    await page.keyboard.press('l')
    await expect(page.getByRole('button', { name: '選択', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'ファイル▼', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: /^共有・提出用に保存/ })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(page.locator('.page-view[data-page-index="0"]')).toHaveAttribute('data-sharp', 'true')
    await page.evaluate(() => window.__karu!.setZoom(1))
    await expect(page.locator('.viewer')).toHaveAttribute('data-zoom', '1')
  })
  test('詳細図・平面図の縮尺を一覧から選択し、距離の計測値と保存後の縮尺に反映する', async ({ page }) => {
    await open(page, url)
    for (const denominator of [5, 10, 20, 25, 30, 50, 100, 200]) {
      await menu(page, '計測', '縮尺の設定…')
      const dialog = page.getByRole('dialog', { name: '縮尺の設定（1 ページ）' })
      await dialog.getByLabel('よく使う縮尺').selectOption(String(denominator))
      await expect(dialog.getByLabel('縮尺の分母')).toHaveValue(String(denominator))
      await dialog.getByRole('button', { name: '決定', exact: true }).click()
      await expect(page.locator('.status-scale')).toHaveText(`縮尺 1/${denominator}`)
    }
    await menu(page, '計測', '縮尺の設定…')
    const dialog = page.getByRole('dialog', { name: '縮尺の設定（1 ページ）' })
    await dialog.getByLabel('よく使う縮尺').selectOption('50')
    await dialog.getByRole('button', { name: '決定', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await page.locator('.viewer').focus()
    await page.keyboard.press('k')
    await expect(page.getByRole('button', { name: '距離', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const start = await point(page, 80, 130), end = await point(page, 152, 130)
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 4 }); await page.mouse.up()
    await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).find(a => a.kind === 'distance')?.text)).toBe('1,270 mm')
    await page.evaluate(async () => { const bytes = await window.__karu!.saveToBytes(); if (bytes) await window.__karu!.openBytes(bytes, '縮尺保存.pdf') })
    await firstPage(page)
    await expect(page.locator('.status-scale')).toHaveText('縮尺 1/50')
  })
  test('図面比較で色だけの変更を検出し、感度を選択できる', async ({ page }) => {
    await page.goto(url)
    await page.waitForFunction(() => Boolean(window.__karu))
    for (const color of ['1 0 0', '0 0 1']) {
      const doc = new mupdf.PDFDocument()
      let bytes: number[]
      try {
        doc.insertPage(-1, doc.addPage([0, 0, 400, 400], 0, {}, `${color} rg 40 300 60 60 re f`))
        const buffer = doc.saveToBuffer('garbage=1'); try { bytes = [...buffer.asUint8Array()] } finally { buffer.destroy() }
      } finally { doc.destroy() }
      await page.evaluate(bytes => window.__karu!.openBytes(bytes, '比較.pdf'), bytes!)
    }
    await menu(page, '表示', '2つの PDF を比較…')
    await page.getByRole('button', { name: '比較', exact: true }).click()
    await expect(page.getByTestId('compare-view')).toHaveAttribute('data-detection-ms', /\d/)
    await expect(page.getByTestId('compare-difference')).toHaveCount(0)
    await page.getByLabel('比較の検出方法').selectOption('color')
    await expect(page.getByTestId('compare-difference')).toHaveCount(1)
    await page.getByLabel('比較の感度').selectOption('8')
    await expect(page.getByLabel('比較の感度')).toHaveValue('8')
    await expect(page.getByTestId('compare-difference')).toHaveCount(1)
  })
  test('同名同容量の改訂図を別タブで開き、用紙サイズと前後の表示を確認する', async ({ page }) => {
    expect(pdf('AAAA').length).toBe(pdf('BBBB').length)
    await open(page, url)
    await page.getByTestId('file-input').setInputFiles({ name: 'drawing.pdf', mimeType: 'application/pdf', buffer: pdf('BBBB') })
    await expect.poll(() => page.evaluate(() => window.__karu!.listTabs().length)).toBe(2)
    await menu(page, 'ページ', '用紙サイズ一覧…')
    const dialog = page.getByRole('dialog', { name: '用紙サイズ一覧' })
    await expect(dialog).toContainText('A1 横: 1ページ')
    await dialog.getByRole('button', { name: '3', exact: true }).click()
    await expect(page.locator('.page-view[data-page-index="2"]')).toBeInViewport()
    await menu(page, '表示', '前の表示に戻る')
    await expect(page.locator('.page-view[data-page-index="0"]')).toBeInViewport()
    await menu(page, '表示', '次の表示に進む')
    await expect(page.locator('.page-view[data-page-index="2"]')).toBeInViewport()
    await page.locator('.viewer').focus(); await page.keyboard.press('Alt+ArrowLeft')
    await expect(page.locator('.page-view[data-page-index="0"]')).toBeInViewport()
  })
  test('指摘への定型文挿入、未確認の件数・絞込・次の指摘を確認する', async ({ page }) => {
    await open(page, url)
    await page.locator('.viewer').focus()
    await page.keyboard.press('n')
    await expect(page.getByRole('button', { name: '指摘', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const location = await point(page, 80, 130); await page.mouse.click(location.x, location.y)
    const input = page.getByTestId('issue-editor'); await input.fill('先後')
    await input.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(1, 1))
    await page.getByLabel('挿入する定型文').selectOption('0')
    await page.getByRole('button', { name: '挿入', exact: true }).click()
    await expect(input).toHaveValue('先寸法を確認してください。後')
    await input.press('Control+Enter')
    await page.getByRole('button', { name: '選択', exact: true }).click()
    await menu(page, '表示', '書き込みの一覧')
    const panel = page.getByRole('region', { name: '書き込みの一覧' })
    await expect(panel).toContainText('未確認 1 / 指摘 1')
    await page.getByLabel('書き込みの種類').selectOption('issueOpen')
    await page.getByRole('button', { name: '次の未対応指摘（ページ範囲内）' }).click()
    await page.getByLabel('指摘 1 の状態').selectOption('done')
    await expect(panel).toContainText('未確認 1 / 指摘 1')
    await page.getByLabel('指摘 1 の状態').selectOption('confirmed')
    await expect(panel).toContainText('未確認 0 / 指摘 1')
    await expect(panel.locator('.annotation-rows li')).toHaveCount(0)
    await page.getByLabel('書き込みの種類').selectOption('issueDone')
    await expect(panel.locator('.annotation-rows li')).toHaveCount(1)
  })
  test('試用版の本文修正コピーと個数カウントを配布形態ごとに保存できる', async ({page}) => {
    await open(page,url)
    const doc=new mupdf.PDFDocument(pdf()), nativePage=doc.loadPage(0), list=nativePage.toDisplayList(false), text=list.toStructuredText('preserve-whitespace')
    let line: ReturnType<typeof extractTextLines>['lines'][number]
    try {line=extractTextLines(text,nativePage.getBounds(),0).lines.find(l=>l.text.includes('SECRET AAAA'))!}
    finally {text.destroy();list.destroy();nativePage.destroy();doc.destroy()}
    await page.evaluate(line=>document.dispatchEvent(new CustomEvent('karu-pdf:text-correction',{detail:{docId:window.__karu!.listTabs()[0].docId,pageIndex:0,rect:line.rect,originalText:line.text}})),line!)
    const dialog=page.getByRole('dialog',{name:'既存文字の修正'})
    await dialog.getByLabel('修正文',{exact:true}).fill('新図面注記');await dialog.getByLabel('修正文の文字サイズ').fill('8')
    await dialog.getByRole('button',{name:'修正したコピーを開く'}).click()
    await expect.poll(()=>page.evaluate(()=>window.__karu!.listTabs().length)).toBe(2)
    await expect(dialog).not.toBeVisible()
    await page.getByRole('button',{name:'計測▼',exact:true}).click();await page.getByRole('menuitemcheckbox',{name:'個数カウント',exact:true}).click()
    await expect(page.getByRole('button',{name:'個数カウント',exact:true})).toHaveAttribute('aria-pressed','true')
    const p=await point(page,80,130);await page.mouse.click(p.x,p.y)
    const saved=await page.evaluate(async()=>Array.from((await window.__karu!.saveToBytes())!))
    const result=new mupdf.PDFDocument(new Uint8Array(saved)), savedPage=result.loadPage(0), savedList=savedPage.toDisplayList(false), savedText=savedList.toStructuredText('')
    try {expect(savedText.asText()).toContain('新図面注記');expect(savedText.asText()).not.toContain('SECRET AAAA')}
    finally {savedText.destroy();savedList.destroy();savedPage.destroy();result.destroy()}
    await page.evaluate(b=>window.__karu!.openBytes(b,'試用機能保存.pdf'),saved)
    await expect.poll(()=>page.evaluate(()=>window.__karu!.getEditableAnnotations(0).filter(a=>a.count?.group==='照明器具').length)).toBe(1)
  })
  test('文字の定型文登録と挿入が入力カーソルを保ち、記憶は明示選択する', async ({ page }) => {
    await open(page, url); await page.keyboard.press('t')
    const location = await point(page, 80, 130); await page.mouse.click(location.x, location.y)
    const input = page.getByTestId('text-editor'); await input.fill('先後')
    await input.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(1, 1))
    await page.getByText('定型文を登録・整理', { exact: true }).click()
    await page.getByLabel('定型文の名前').fill('現地確認'); await page.getByLabel('定型文の本文').fill('現地確認済み')
    await page.getByRole('button', { name: '登録', exact: true }).click()
    expect(await page.evaluate(() => localStorage.getItem('karu-pdf:snippets'))).toBeNull()
    await page.getByLabel('挿入する定型文').selectOption('5')
    await page.getByRole('button', { name: '挿入', exact: true }).click()
    await expect(input).toHaveValue('先現地確認済み後')
    await page.getByLabel('このPCに登録した定型文を記憶する').check()
    expect(await page.evaluate(() => localStorage.getItem('karu-pdf:snippets'))).toContain('現地確認済み')
    await page.getByRole('button', { name: '登録と保存情報をすべて削除' }).click()
    expect(await page.evaluate(() => localStorage.getItem('karu-pdf:snippets'))).toBe('[]')
  })
  test('共有用墨消しは選んだ範囲の文字と文書情報を除去し、編集中の文書を保持する', async ({ page }) => {
    await mockWrites(page); await open(page, url); await square(page)
    await menu(page, 'ファイル', '共有・提出用に保存…')
    const dialog = page.getByRole('dialog', { name: '共有・提出用に保存' })
    await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: '墨消しを適用して別名保存' }).click()
    await expect(dialog).not.toBeVisible()
    const writes = await page.evaluate(() => (window as any).__writes as number[][])
    expect(writes).toHaveLength(1)
    const doc = new mupdf.PDFDocument(new Uint8Array(writes[0])), first = doc.loadPage(0), text = first.toStructuredText('')
    try {
      expect(text.asText()).not.toContain('SECRET'); expect(text.asText()).toContain('PUBLIC')
      expect(doc.getTrailer().get('Info').isNull()).toBe(true)
    } finally { text.destroy(); first.destroy(); doc.destroy() }
    expect((await page.evaluate(() => window.__karu!.listTabs()))[0].dirty).toBe(true)
    expect(await page.evaluate(() => window.__karu!.getEditableAnnotations(0).length)).toBe(1)
  })
  test('注釈反映エラーの応答では書き込みを行わず未保存状態を保持する', async ({ page }) => {
    await mockWrites(page, false, true); await open(page, url); await square(page)
    await page.keyboard.press('Control+Shift+s')
    await expect(page.getByRole('alert')).toContainText('SYNTHETIC_REFLECTION_FAILURE')
    expect(await page.evaluate(() => (window as any).__writes.length)).toBe(0)
    expect((await page.evaluate(() => window.__karu!.listTabs()))[0].dirty).toBe(true)
  })
  test('書込失敗後の再保存で注釈を複製せず未保存表示を解消する', async ({ page }) => {
    await mockWrites(page, true); await open(page, url); await square(page)
    await page.keyboard.press('Control+Shift+s')
    await expect(page.getByRole('alert')).toContainText('SYNTHETIC_WRITE_FAILURE')
    expect((await page.evaluate(() => window.__karu!.listTabs()))[0].dirty).toBe(true)
    await page.evaluate(() => { (window as any).__failWrite = false })
    await page.keyboard.press('Control+Shift+s')
    await expect.poll(() => page.evaluate(() => (window as any).__writes.length)).toBe(1)
    await expect.poll(() => page.evaluate(() => window.__karu!.listTabs()[0].dirty)).toBe(false)
    const bytes = await page.evaluate(() => (window as any).__writes[0] as number[]), doc = new mupdf.PDFDocument(new Uint8Array(bytes)), first = doc.loadPage(0)
    try { expect(first.getAnnotations()).toHaveLength(1) } finally { first.destroy(); doc.destroy() }
  })
  test('履歴の記憶停止でIndexedDBと表示情報を消し、再起動後も記憶しない', async ({ page }) => {
    await open(page, url)
    await page.evaluate(async () => {
      localStorage.setItem('karu-pdf:view', JSON.stringify({ 'private.pdf\n123': { page: 2, zoom: 1, updatedAt: 100 } }))
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('karu-pdf', 1)
        request.onsuccess = () => {
          const db = request.result, tx = db.transaction('handles', 'readwrite'), entry = { name: 'private.pdf', handle: { name: 'private.pdf' }, openedAt: 100 }
          tx.objectStore('handles').put(entry, 'lastOpened'); tx.objectStore('handles').put([entry], 'recent')
          tx.oncomplete = () => { db.close(); resolve() }; tx.onerror = () => reject(tx.error)
        }; request.onerror = () => reject(request.error)
      })
    })
    await menu(page, 'ヘルプ', '履歴の設定…')
    const dialog = page.getByRole('dialog', { name: '履歴の設定' })
    await dialog.getByRole('checkbox').uncheck()
    await expect(dialog.getByRole('button', { name: '閉じる' })).toBeEnabled()
    expect(await page.evaluate(() => localStorage.getItem('karu-pdf:view'))).toBeNull()
    const keys = await page.evaluate(() => new Promise<unknown[]>((resolve, reject) => {
      const request = indexedDB.open('karu-pdf', 1)
      request.onsuccess = () => { const db = request.result, query = db.transaction('handles').objectStore('handles').getAllKeys(); query.onsuccess = () => { db.close(); resolve(query.result) }; query.onerror = () => reject(query.error) }
    }))
    expect(keys).toEqual([])
    await dialog.getByRole('button', { name: '閉じる' }).click(); await page.reload()
    await menu(page, 'ヘルプ', '履歴の設定…')
    await expect(page.getByRole('dialog', { name: '履歴の設定' }).getByRole('checkbox')).not.toBeChecked()
  })
}
