import path from 'node:path'
import mupdf from 'mupdf'
import { expect, test, type Page } from '@playwright/test'

async function open(page: Page) {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage
    ;(window as unknown as { __issueQueries: number }).__issueQueries = 0
    Worker.prototype.postMessage = function(message: unknown, ...args: unknown[]) {
      if ((message as { type?: string })?.type === 'maxIssueNumber') (window as unknown as { __issueQueries: number }).__issueQueries++
      return Reflect.apply(send, this, [message, ...args])
    }
  })
  await page.goto('/karu-pdf/?test=1&workers=3')
  await page.getByTestId('file-input').setInputFiles(path.resolve('test-data/sample-small.pdf'))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
}
async function point(page: Page, x: number, y: number) {
  return page.getByTestId('annotation-layer-0').evaluate((element, p) => {
    const svg=element as SVGSVGElement, box=svg.getBoundingClientRect(), view=svg.viewBox.baseVal
    return {x:box.left+p.x*box.width/view.width,y:box.top+p.y*box.height/view.height}
  },{x,y})
}
async function click(page: Page,x: number,y: number) { const p=await point(page,x,y);await page.mouse.click(p.x,p.y) }
async function choose(page: Page, group: '図形'|'文字', name: string) {
  await page.getByRole('button',{name:`${group}▼`}).click()
  await page.getByRole('menuitemcheckbox',{name,exact:false}).click()
}
async function place(page: Page,x:number,y:number,text:string) {
  await click(page,x,y);const input=page.getByTestId('issue-editor');await expect(input).toBeVisible();await input.fill(text);await input.press('Control+Enter');await expect(input).not.toBeVisible()
}
async function issues(page:Page) {return page.evaluate(()=>window.__karu!.getEditableAnnotations(0).filter(a=>a.issue).map(a=>({number:a.issue!.number,text:a.text,status:a.issue!.status,rect:a.rect}))) }
async function reopen(page:Page) {
  await page.evaluate(async()=>{const bytes=await window.__karu!.saveToBytes();if(!bytes)throw Error('保存失敗');await window.__karu!.openBytes(bytes,'雲と指摘.pdf')})
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
}

function savedIssueAppearances(bytes: number[]) {
  const doc = new mupdf.PDFDocument(new Uint8Array(bytes)), nativePage = doc.loadPage(0)
  const annotations = nativePage.getAnnotations()
  try {
    return annotations.flatMap(annotation => {
      const object = annotation.getObject(), raw = object.get('KaruIssue')
      try {
        if (!raw.isString()) return []
        const issue = JSON.parse(raw.asString()) as { number: number; status: string }
        const savedColor = object.get('C')
        let color: number[]
        try {
          color = Array.from({ length: savedColor.length }, (_, i) => {
            const component = savedColor.get(i)
            try { return component.asNumber() } finally { component.destroy() }
          })
        } finally { savedColor.destroy() }
        const appearance = object.get('AP', 'N'), stream = appearance.readStream()
        const pixmap = annotation.toPixmap(mupdf.Matrix.scale(3, 3), mupdf.ColorSpace.DeviceRGB, false)
        try {
          const pixels = pixmap.getPixels(), n = pixmap.getNumberOfComponents(), stride = pixmap.getStride()
          const counts = { red: 0, blue: 0, gray: 0 }
          for (let y = 0; y < pixmap.getHeight(); y++) for (let x = 0; x < pixmap.getWidth(); x++) {
            const i = y * stride + x * n, r = pixels[i], g = pixels[i + 1], b = pixels[i + 2]
            if (r > 180 && g < 100 && b < 100) counts.red++
            if (b > 180 && r < 100 && g < 140) counts.blue++
            if (r > 80 && r < 180 && Math.abs(r - g) < 3 && Math.abs(r - b) < 3) counts.gray++
          }
          return [{ ...issue, color, counts, lineOperators: (stream.asString().match(/(?:^|\s)l(?=\s|$)/g) ?? []).length }]
        } finally { pixmap.destroy(); stream.destroy(); appearance.destroy() }
      } finally { raw.destroy(); object.destroy() }
    })
  } finally { annotations.forEach(a => a.destroy()); nativePage.destroy(); doc.destroy() }
}

function legacyIssuePdf() {
  const doc = new mupdf.PDFDocument(), ref = doc.addPage([0, 0, 400, 400], 0, {}, '')
  try {
    doc.insertPage(-1, ref)
    const nativePage = doc.loadPage(0), resources = doc.newDictionary()
    try {
      for (const [index, status] of ['done', 'revised', 'confirmed'].entries()) {
        const annotation = nativePage.createAnnotation('Stamp'), object = annotation.getObject()
        const raw = doc.newString(JSON.stringify({ number: index + 1, status }))
        try {
          annotation.setRect([40 + index * 40, 100, 56 + index * 40, 116])
          annotation.setContents(`旧指摘${index + 1}`); object.put('KaruIssue', raw)
          annotation.setColor(status === 'revised' ? [1, 0, 0] : [.5, .5, .5])
          const color = status === 'revised' ? '1 0 0' : '.5 .5 .5'
          const check = status === 'done' ? '11 3 m 13 5 l 15 1 l S' : ''
          annotation.setAppearance('N', null, mupdf.Matrix.identity, [0, 0, 16, 16], resources, `${color} RG 1 w 1 1 14 14 re S ${check}`)
        } finally { raw.destroy(); object.destroy(); annotation.destroy() }
      }
    } finally { resources.destroy(); nativePage.destroy() }
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { ref.destroy(); doc.destroy() }
}

test('3状態の選択肢・色を一覧、書式、SVG、保存PDFの外観でそろえる', async ({ page }) => {
  await open(page); await page.keyboard.press('n'); await place(page, 160, 200, '状態の色')
  await page.keyboard.press('Escape'); await page.getByRole('tab', { name: '書き込み', exact: true }).click()
  await page.getByLabel('書き込みの種類').selectOption('issue')
  const statusSelect = page.getByLabel('指摘 1 の状態', { exact: true })
  const row = page.locator('.annotation-rows li').filter({ has: statusSelect })
  await row.locator('.annotation-row-main').click()
  const format = page.getByTestId('format-panel')
  await expect(format).toContainText('色は状態で決まります（未回答 赤・回答済み 青・修正確認 灰）')
  await expect(format.getByRole('group', { name: '色', exact: true })).toHaveCount(0)
  const choices = [{ value: 'open', text: '未回答' }, { value: 'answered', text: '回答済み' }, { value: 'confirmed', text: '修正確認' }]
  for (const select of [statusSelect, page.getByLabel('指摘の状態', { exact: true })]) {
    expect(await select.locator('option').evaluateAll(options => options.map(el => ({ value: (el as HTMLOptionElement).value, text: el.textContent })))).toEqual(choices)
  }
  await expect(page.getByLabel('状態で絞り込み').locator('option')).toHaveText(['すべて', '未回答', '回答済み', '修正確認'])
  for (const state of [
    { value: 'answered', css: 'rgb(0, 64, 255)', pixels: 'blue' },
    { value: 'confirmed', css: 'rgb(128, 128, 128)', pixels: 'gray' },
    { value: 'open', css: 'rgb(255, 0, 0)', pixels: 'red' },
  ] as const) {
    // Exercise both the row selector and the format selector.
    await (state.value === 'confirmed' ? page.getByLabel('指摘の状態', { exact: true }) : statusSelect).selectOption(state.value)
    await expect(statusSelect).toHaveValue(state.value)
    await expect(statusSelect).toHaveAttribute('data-status', state.value)
    await expect(statusSelect).toHaveCSS('color', state.css)
    await expect(statusSelect).toHaveCSS('border-left-color', state.css)
    await expect(page.getByLabel('指摘の状態', { exact: true })).toHaveCSS('color', state.css)
    await expect(row.locator('.annotation-color')).toHaveCSS('background-color', state.css)
    await expect(page.locator('.annotation-issue circle')).toHaveCSS('stroke', state.css)
    await expect(page.locator('.annotation-issue')).toHaveCSS('fill', state.css)
    await expect(page.locator('.annotation-issue path')).toHaveCount(0)
    const bytes = await page.evaluate(async () => {
      const saved = await window.__karu!.saveToBytes(); if (!saved) throw Error('保存失敗')
      return [...saved]
    })
    const appearance = savedIssueAppearances(bytes).find(a => a.number === 1)!
    expect(appearance.status).toBe(state.value); expect(appearance.counts[state.pixels]).toBeGreaterThan(20)
    expect(appearance.color).toEqual(state.value === 'open' ? [1, 0, 0] : state.value === 'answered' ? [0, .25, 1] : [.5, .5, .5])
    expect(appearance.lineOperators).toBe(0)
    for (const other of ['red', 'blue', 'gray'] as const) if (other !== state.pixels) expect(appearance.counts[other]).toBe(0)
    await page.evaluate(b => window.__karu!.openBytes(b, '状態保存.pdf'), bytes)
    await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
    await page.getByRole('tab', { name: '書き込み', exact: true }).click()
    await page.getByLabel('書き込みの種類').selectOption('issue')
    await expect(statusSelect).toHaveValue(state.value)
    await expect(page.locator('.annotation-issue circle')).toHaveCSS('stroke', state.css)
    await row.locator('.annotation-row-main').click()
  }
})

test('旧対応済・修正済は青の回答済みで開き、保存値と未保存表示を変えない', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1&workers=3'); await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '旧状態.pdf'), legacyIssuePdf())
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('tab', { name: '書き込み', exact: true }).click()
  await page.getByLabel('書き込みの種類').selectOption('issue')
  for (const number of [1, 2]) {
    const select = page.getByLabel(`指摘 ${number} の状態`, { exact: true })
    const row = page.locator('.annotation-rows li').filter({ has: select })
    await expect(select).toHaveValue('answered'); await expect(select).toHaveCSS('color', 'rgb(0, 64, 255)')
    await expect(row.locator('.annotation-color')).toHaveCSS('background-color', 'rgb(0, 64, 255)')
    await expect(page.locator('.annotation-issue').filter({ hasText: String(number) }).locator('circle')).toHaveCSS('stroke', 'rgb(0, 64, 255)')
    await row.getByRole('button', { name: `指摘 ${number} の詳細を編集`, exact: true }).click()
    await expect(page.locator('.issue-details')).toHaveCount(1)
    await expect(row.locator('.issue-details')).toContainText('旧版で「対応済」または「修正済」とした指摘です。修正を確認したら「修正確認」にしてください。')
  }
  await expect(page.getByRole('button', { name: '指摘 1 の詳細を編集', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('.annotation-issue path')).toHaveCount(0)
  expect((await issues(page)).map(a => a.status)).toEqual(['done', 'revised', 'confirmed'])
  expect(await page.evaluate(() => window.__karu!.listTabs().find(tab => tab.name === '旧状態.pdf')!.dirty)).toBe(false)
  expect(await page.evaluate(() => window.__karu!.getEditableAnnotations(0).filter(a => a.issue).every(a => !a.dirty))).toBe(true)
  await page.getByLabel('状態で絞り込み').selectOption('answered')
  await expect(page.locator('.annotation-type-icon')).toHaveText(['1', '2'])
  await page.getByLabel('状態で絞り込み').selectOption('confirmed')
  await expect(page.locator('.annotation-type-icon')).toHaveText(['3'])
  await page.getByLabel('状態で絞り込み').selectOption('')
  await page.getByLabel('書き込みの種類').selectOption('issueDone')
  await expect(page.locator('.annotation-type-icon')).toHaveText(['3'])
  await expect(page.getByLabel('書き込みの種類').locator('option[value="issueDone"]')).toHaveText('指摘（修正確認）')
  await page.getByLabel('書き込みの種類').selectOption('issueOpen')
  await expect(page.locator('.annotation-type-icon')).toHaveText(['1', '2'])
  await page.getByRole('button', { name: 'CSV に書き出す…', exact: true }).click()
  const csvDialog = page.getByRole('dialog', { name: 'CSV に書き出す', exact: true })
  await expect(csvDialog.getByLabel('CSVの指摘の状態').locator('option')).toHaveText(['すべて', '未確認だけ（未回答・回答済み）', '修正確認だけ'])
  await csvDialog.getByRole('button', { name: '閉じる', exact: true }).click()
  // Editing details also rebuilds the old AP in blue without changing its saved status.
  for (const number of [1, 2]) {
    await page.getByRole('button', { name: `指摘 ${number} の詳細を編集`, exact: true }).click()
    await page.getByLabel('指摘の回答', { exact: true }).fill(`回答${number}`)
    await page.getByRole('button', { name: '詳細を閉じる', exact: true }).click()
  }
  const bytes = await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!])
  const appearances = savedIssueAppearances(bytes)
  for (const [number, status] of [[1, 'done'], [2, 'revised']] as const) {
    const a = appearances.find(a => a.number === number)!
    expect(a.status).toBe(status); expect(a.counts.blue).toBeGreaterThan(20); expect(a.lineOperators).toBe(0)
  }
  await page.getByLabel('指摘 1 の状態', { exact: true }).selectOption('confirmed')
  await page.getByLabel('書き込みの種類').selectOption('issue')
  await page.getByLabel('指摘 1 の状態', { exact: true }).selectOption('answered')
  await reopen(page)
  expect((await issues(page)).map(a => a.status)).toEqual(['answered', 'revised', 'confirmed'])
})

test('旧指摘を開いただけでは未保存にせず、別の書き込みの保存で旧指摘の色と外観を直す', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1&workers=3'); await page.waitForFunction(() => !!window.__karu)
  const original = legacyIssuePdf()
  const before = savedIssueAppearances(original)
  expect(before.find(a => a.number === 1)!.color).toEqual([.5, .5, .5])
  expect(before.find(a => a.number === 1)!.counts.gray).toBeGreaterThan(20)
  expect(before.find(a => a.number === 2)!.color).toEqual([1, 0, 0])
  expect(before.find(a => a.number === 2)!.counts.red).toBeGreaterThan(20)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '旧状態.pdf'), original)
  await expect(page.locator('.annotation-issue circle')).toHaveCount(3)
  expect(await page.evaluate(() => window.__karu!.listTabs().find(tab => tab.name === '旧状態.pdf')!.dirty)).toBe(false)
  expect(await page.evaluate(() => window.__karu!.getEditableAnnotations(0).filter(a => a.issue).every(a => !a.dirty))).toBe(true)
  await page.evaluate(async () => {
    const tab = window.__karu!.listTabs().find(tab => tab.name === '旧状態.pdf')!
    await window.__karu!.closeTab(tab.docId)
  })
  await expect(page.getByTestId('start-screen')).toBeVisible()

  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '旧状態.pdf'), original)
  await expect(page.locator('.annotation-issue circle')).toHaveCount(3)
  await page.getByRole('button', { name: '図形▼' }).click(); await page.getByRole('menuitemcheckbox', { name: '四角', exact: true }).click()
  const start = await point(page, 180, 220), end = await point(page, 240, 260)
  await page.mouse.move(start.x, start.y); await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 8 }); await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).filter(a => a.kind === 'square').length)).toBe(1)
  expect(await page.evaluate(() => window.__karu!.getEditableAnnotations(0).filter(a => a.issue).every(a => !a.dirty))).toBe(true)
  const bytes = await page.evaluate(async () => {
    const saved = await window.__karu!.saveToBytes(); if (!saved) throw Error('保存失敗')
    return [...saved]
  })
  const appearances = savedIssueAppearances(bytes)
  for (const [number, status] of [[1, 'done'], [2, 'revised']] as const) {
    const a = appearances.find(a => a.number === number)!
    expect(a.status).toBe(status); expect(a.color).toEqual([0, .25, 1])
    expect(a.counts.blue).toBeGreaterThan(20); expect(a.counts.red).toBe(0); expect(a.counts.gray).toBe(0)
    expect(a.lineOperators).toBe(0)
  }
  expect(appearances.find(a => a.number === 3)!.color).toEqual([.5, .5, .5])
  expect(await page.evaluate(() => window.__karu!.getEditableAnnotations(0).every(a => !a.dirty))).toBe(true)
  await page.evaluate(b => window.__karu!.openBytes(b, '旧状態保存.pdf'), bytes)
  await expect(page.locator('.annotation-issue circle')).toHaveCount(3)
  for (const number of [1, 2]) await expect(page.locator('.annotation-issue').filter({ hasText: String(number) }).locator('circle')).toHaveCSS('stroke', 'rgb(0, 64, 255)')
  expect((await issues(page)).map(a => a.status)).toEqual(['done', 'revised', 'confirmed'])
  expect(await page.evaluate(() => window.__karu!.listTabs().find(tab => tab.name === '旧状態保存.pdf')!.dirty)).toBe(false)
})

test('指摘の詳細をその行で開閉し、フォーカスを保って入力・保存する', async ({ page }) => {
  await open(page); await page.keyboard.press('n'); await place(page, 160, 200, '回路確認')
  await page.keyboard.press('Escape'); await page.getByRole('tab', { name: '書き込み', exact: true }).click()
  const button = page.getByRole('button', { name: '指摘 1 の詳細を編集', exact: true })
  const row = page.locator('.annotation-rows li').filter({ has: button })
  await expect(button).toHaveText('✎ 詳細を編集 ▾')
  await expect(button).toHaveAttribute('aria-expanded', 'false')
  const layout = await button.evaluate(el => {
    const style = getComputedStyle(el), actions = el.parentElement!, select = actions.querySelector('select')!
    const rect = el.getBoundingClientRect(), selectRect = select.getBoundingClientRect()
    return { height: rect.height, fontSize: parseFloat(style.fontSize), whiteSpace: style.whiteSpace, topDifference: Math.abs(rect.top - selectRect.top) }
  })
  expect(layout.height).toBeLessThan(layout.fontSize * 2 + 12)
  expect(layout.whiteSpace).toBe('nowrap'); expect(layout.topDifference).toBeLessThan(8)
  await button.click()
  await expect(button).toHaveAttribute('aria-expanded', 'true')
  await expect(button).toHaveText('✎ 詳細を閉じる ▴')
  await expect(row.locator('.issue-row-details')).toHaveAttribute('id', (await button.getAttribute('aria-controls'))!)
  await expect(row.locator('.issue-details')).toBeVisible()
  await expect(page.locator('.annotation-list-panel > div > .issue-details')).toHaveCount(0)
  await expect(page.getByLabel('指摘の分野', { exact: true })).toHaveAttribute('list', 'issue-disciplines')
  expect(await page.locator('#issue-disciplines option').evaluateAll(options => options.map(option => option.getAttribute('value')))).toEqual(['建築','構造','電気','機械','外構','その他'])
  await expect(page.locator('.issue-details')).not.toContainText('指摘ID')
  const identity = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).find(a => a.issue)!.issue!.id!)
  await expect(page.locator('.issue-details')).not.toContainText(identity)
  const discipline = row.getByLabel('指摘の分野', { exact: true })
  await discipline.pressSequentially('電気')
  await expect(discipline).toBeFocused(); await expect(discipline).toHaveValue('電気')
  const answer = row.getByLabel('指摘の回答', { exact: true })
  await answer.pressSequentially('配線を修正')
  await expect(answer).toBeFocused(); await expect(answer).toHaveValue('配線を修正')
  await page.getByLabel('指摘の修正確認', { exact: true }).fill('新版で確認')
  await page.getByLabel('指摘 1 の状態', { exact: true }).selectOption('confirmed')
  await button.click(); await expect(button).toHaveAttribute('aria-expanded', 'false')
  await expect(row.locator('.issue-details')).toHaveCount(0)
  await button.click(); await expect(answer).toHaveValue('配線を修正')
  await row.getByRole('button', { name: '詳細を閉じる', exact: true }).click()
  await expect(button).toHaveAttribute('aria-expanded', 'false')
  await reopen(page)
  const a = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).find(a => a.issue)?.issue)
  expect(a).toMatchObject({ status: 'confirmed', discipline: '電気', answer: '配線を修正', verification: '新版で確認' })
  expect(a?.id).toMatch(/^[0-9a-f-]{36}$/)
})

test('器具を選んでクリックし、取消・保存再読込で個数を維持する', async ({ page }) => {
  await open(page)
  await page.getByRole('tab', { name: '器具', exact: true }).click()
  await page.getByRole('button', { name: '見本から追加', exact: true }).click()
  await page.getByRole('button', { name: '選んだ器具を追加', exact: true }).click()
  await page.getByRole('button', { name: 'DL ダウンライト', exact: true }).click()
  await page.getByRole('button', { name: '計測▼' }).click()
  await page.getByRole('menuitemcheckbox', { name: '個数カウント', exact: false }).click()
  await click(page, 100, 200); await click(page, 150, 200); await click(page, 200, 200)
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('fixture-panel')).toContainText('表示中の図面（p.1）: 2個 ／ 全図面: 2個')
  await reopen(page)
  expect(await page.evaluate(() => window.__karu!.getEditableAnnotations(0).filter(a => a.count).length)).toBe(2)
})

test('文字メニューには変更記録がなく、旧版変更を指摘から除外して削除・Undoできる', async ({ page }) => {
  const doc = new mupdf.PDFDocument(), ref = doc.addPage([0,0,400,400], 0, {}, '')
  let bytes: number[]
  try {
    doc.insertPage(-1, ref)
    const nativePage = doc.loadPage(0), resources = doc.newDictionary()
    try {
      for (const number of [1,2,3]) {
        const a = nativePage.createAnnotation('Stamp'), object = a.getObject()
        const data = doc.newString(JSON.stringify({ number, status: 'open', ...(number === 2 ? { recordKind: 'change' } : {}) }))
        try {
          a.setRect([40*number,100,40*number+16,116]); a.setContents(number === 2 ? '旧版の変更内容' : `指摘本文${number}`)
          object.put('KaruIssue', data)
          a.setAppearance('N', null, mupdf.Matrix.identity, [0,0,16,16], resources, '1 0 0 RG 1 w 1 1 14 14 re S')
        } finally { data.destroy(); object.destroy(); a.destroy() }
      }
    } finally { resources.destroy(); nativePage.destroy() }
    const buffer = doc.saveToBuffer('compress')
    try { bytes = [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { ref.destroy(); doc.destroy() }
  await page.goto('/karu-pdf/?test=1&workers=3'); await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(b => window.__karu!.openBytes(b, '旧版.pdf'), bytes)
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('button',{name:'文字▼'}).click()
  await expect(page.getByRole('menuitemcheckbox', { name: '変更記録', exact: false })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.getByRole('tab',{name:'書き込み',exact:true}).click()
  await page.getByLabel('書き込みの種類').selectOption('issue')
  await expect(page.locator('.annotation-type-icon')).toHaveText(['1','3'])
  await expect(page.getByRole('region',{name:'書き込みの一覧'})).toContainText('未確認 2 / 指摘 2')
  const legacy = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).find(a => a.legacyChange)!)
  expect(legacy.issue).toBeNull(); expect(legacy.dirty).toBe(false)
  expect(await page.evaluate(() => window.__karu!.listTabs().find(tab => tab.name === '旧版.pdf')!.dirty)).toBe(false)
  await page.getByLabel('書き込みの種類').selectOption('all')
  const row = page.locator('.annotation-rows li').filter({ hasText: '変更記録（旧版）' })
  await expect(row).toContainText('旧版の変更内容')
  await row.getByRole('button').click()
  await expect(page.getByLabel('指摘の状態', { exact: true })).toHaveCount(0)
  await page.getByTestId('viewer').focus(); await page.keyboard.press('Delete')
  await expect(row).toHaveCount(0)
  await page.keyboard.press('Control+z'); await expect(row).toHaveCount(1)
  expect(await page.evaluate(() => window.__karu!.getEditableAnnotations(0).find(a => a.legacyChange)?.dirty)).toBe(false)
  await page.keyboard.press('n'); await place(page,160,200,'次は4')
  expect((await issues(page)).map(a => a.number)).toEqual([1,3,4])
  expect(await page.evaluate(() => window.__karu!.exportAnnotationCsv())).not.toContain('旧版の変更内容')
  await page.keyboard.press('Escape'); await row.getByRole('button').click()
  await page.getByTestId('viewer').focus(); await page.keyboard.press('Delete')
  await reopen(page)
  expect(await page.evaluate(() => window.__karu!.getEditableAnnotations(0).some(a => a.legacyChange))).toBe(false)
})

test('CSV画面で指摘と文字を選び、対象列・行・ファイル名を確認する', async ({ page }) => {
  await open(page); await page.keyboard.press('n'); await place(page,100,200,'=確認')
  await page.keyboard.press('Escape'); await page.keyboard.press('t'); await click(page,200,300)
  const text = page.getByTestId('text-editor'); await expect(text).toBeVisible()
  await text.fill('文字の本文'); await text.press('Control+Enter'); await page.keyboard.press('Escape')
  await page.getByRole('tab',{name:'書き込み',exact:true}).click()
  await page.getByLabel('書き込みの種類').selectOption('issue')
  await page.evaluate(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async (options: { suggestedName: string }) => ({
      createWritable: async () => ({ write: async (blob: Blob) => {
        (window as unknown as { __csvExport: { csv: string; name: string } }).__csvExport = { csv: new TextDecoder('utf-8', { ignoreBOM: true }).decode(await blob.arrayBuffer()), name: options.suggestedName }
      }, close: async () => undefined }),
    }) })
  })
  await page.getByRole('button',{name:'CSV に書き出す…',exact:true}).click()
  const dialog = page.getByRole('dialog',{name:'CSV に書き出す',exact:true})
  await expect(dialog.getByRole('checkbox',{name:'指摘',exact:true})).toBeChecked()
  await expect(dialog.getByRole('checkbox',{name:'文字',exact:true})).not.toBeChecked()
  await dialog.getByRole('button',{name:'すべて外す'}).click()
  await expect(dialog.getByRole('button',{name:'書き出す',exact:true})).toBeDisabled()
  await expect(dialog).toContainText('書き出す種類を選んでください')
  await dialog.getByRole('checkbox',{name:'指摘',exact:true}).check()
  await dialog.getByRole('checkbox',{name:'文字',exact:true}).check()
  await dialog.getByRole('button',{name:'書き出す',exact:true}).click()
  await expect(dialog).not.toBeVisible()
  const result = await page.evaluate(() => (window as unknown as { __csvExport: { csv: string; name: string } }).__csvExport)
  expect(result.name).toBe('sample-small_書き込み一覧.csv')
  expect(result.csv.charCodeAt(0)).toBe(0xFEFF)
  const lines = result.csv.slice(1).split('\r\n')
  expect(lines[0]).toBe('種類,番号,ページ,図面番号,内容,色,"位置（x, y mm）","大きさ（幅, 高さ mm）",状態,分野,回答,修正確認,引継ぎ元番号,引継ぎ元文書')
  expect(lines[1]).toContain("指摘,1,1,,'=確認,")
  // sample-small.pdf already has the text annotation "Existing note" above the new one.
  expect(lines[2]).toContain('文字,,1,,Existing note,')
  expect(lines[3]).toContain('文字,,1,,文字の本文,')
  expect(lines).toHaveLength(5)
  expect(result.csv).toBe(await page.evaluate(() => window.__karu!.exportCsv(['issue','text'])))
})

test('雲四角をドラッグして8ハンドルで編集し、保存後にも雲の属性と座標が戻る',async({page})=>{
  await open(page);await choose(page,'図形','雲（四角）')
  const start=await point(page,100,220),end=await point(page,240,304)
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:8});await page.mouse.up()
  await expect(page.locator('.annotation-cloud')).toHaveCount(1)
  await expect(page.locator('.annotation-resize-handle')).toHaveCount(0)
  await page.getByRole('button',{name:'選択',exact:true}).click()
  await expect(page.locator('.annotation-resize-handle')).toHaveCount(8)
  await page.getByLabel('雲の大きさ',{exact:true}).selectOption('0')
  await reopen(page)
  await expect.poll(()=>page.evaluate(()=>window.__karu!.getEditableAnnotations(0).find(a=>a.kind==='cloudSquare')?.cloudIntensity)).toBe(0)
  const rect=await page.evaluate(()=>window.__karu!.getEditableAnnotations(0).find(a=>a.kind==='cloudSquare')!.rect)
  rect.forEach((n,i)=>expect(n).toBeCloseTo([100,220,240,304][i],3))
})
test('雲多角形は02iと同じ4点・Enter・Backspace・Shift・頂点編集とUndoで操作できる',async({page})=>{
  await open(page);await choose(page,'図形','雲（多角形）')
  for(const [x,y] of [[100,220],[240,220],[240,304],[100,304],[80,260]])await click(page,x,y)
  await page.keyboard.press('Backspace');await page.keyboard.press('Enter')
  const vertices=await page.evaluate(()=>window.__karu!.getEditableAnnotations(0).find(a=>a.kind==='cloudPolygon')!.vertices!)
  expect(vertices).toHaveLength(4);vertices.forEach((p,i)=>p.forEach((n,j)=>expect(n).toBeCloseTo([[100,220],[240,220],[240,304],[100,304]][i][j],3)))
  await expect(page.locator('[data-measure-vertex]')).toHaveCount(0)
  await page.getByRole('button',{name:'選択',exact:true}).click()
  await expect(page.locator('[data-measure-vertex]')).toHaveCount(4)
  const start=await point(page,100,220),end=await point(page,120,200)
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.keyboard.down('Shift');await page.mouse.move(end.x,end.y);await page.mouse.up();await page.keyboard.up('Shift')
  const moved=await page.evaluate(()=>window.__karu!.getEditableAnnotations(0).find(a=>a.kind==='cloudPolygon')!.vertices![0])
  expect(moved[0]).toBeCloseTo(100 + Math.cos(80 * Math.PI / 180) * Math.hypot(20, 104),3);expect(moved[1]).toBeLessThan(220)
  await page.keyboard.press('Control+z')
  await expect.poll(()=>page.evaluate(()=>window.__karu!.getEditableAnnotations(0).find(a=>a.kind==='cloudPolygon')!.vertices![0][1])).toBeCloseTo(220,3)
  await reopen(page);await expect.poll(()=>page.evaluate(()=>window.__karu!.getEditableAnnotations(0).filter(a=>a.kind==='cloudPolygon').length)).toBe(1)
})
test('指摘は1・2・3、削除後4となり、最大番号の問い合わせは文書ごとに1回',async({page})=>{
  await open(page);await page.keyboard.press('n')
  await place(page,100,220,'最初');await place(page,160,250,'二番目');await place(page,220,280,'三番目')
  expect((await issues(page)).map(a=>a.number)).toEqual([1,2,3])
  await page.keyboard.press('Escape');await click(page,160,250);await page.keyboard.press('Delete')
  await page.keyboard.press('n');await place(page,160,310,'四番目')
  expect((await issues(page)).map(a=>a.number)).toEqual([1,3,4])
  expect(await page.evaluate(()=>(window as unknown as {__issueQueries:number}).__issueQueries)).toBe(1)
  await page.keyboard.press('Escape');await click(page,160,310);await page.keyboard.press('Control+d')
  await expect.poll(async()=>(await issues(page)).map(a=>a.number)).toEqual([1,3,4,5])
  expect(await page.evaluate(()=>(window as unknown as {__issueQueries:number}).__issueQueries)).toBe(1)
})
test('指摘一覧の番号順・状態・CSV・振り直しとUndoを実結果で確認する',async({page})=>{
  await open(page);await page.keyboard.press('n')
  await place(page,200,300,'下の指摘');await place(page,100,220,'確認,"寸法"\n次の行');await place(page,200,250,'中の指摘')
  await page.keyboard.press('Escape');await page.getByRole('tab',{name:'書き込み',exact:true}).click()
  await page.getByLabel('書き込みの種類').selectOption('issue')
  await expect(page.locator('.annotation-type-icon')).toHaveText(['1','2','3'])
  await page.getByLabel('指摘 2 の状態',{exact:true}).selectOption('answered')
  const csv=await page.evaluate(()=>window.__karu!.exportIssueCsv())
  expect(csv).toBe('\uFEFF種類,番号,ページ,図面番号,内容,色,"位置（x, y mm）","大きさ（幅, 高さ mm）",状態,分野,回答,修正確認,引継ぎ元番号,引継ぎ元文書\r\n指摘,1,1,,下の指摘,#FF0000,"67.73, 103.01","5.64, 5.64",未回答,,,,,\r\n指摘,2,1,,"確認,""寸法""\r\n次の行",#0040FF,"32.46, 74.79","5.64, 5.64",回答済み,,,,,\r\n指摘,3,1,,中の指摘,#FF0000,"67.73, 85.37","5.64, 5.64",未回答,,,,,\r\n')
  expect(await page.evaluate(()=>window.__karu!.exportAnnotationCsv())).toContain('指摘,2,1,,"確認,""寸法""')
  page.once('dialog',dialog=>{ expect(dialog.message()).toContain('振り直すと、CSVや印刷で渡した番号と合わなくなります'); void dialog.accept() });await page.getByRole('button',{name:'番号を振り直す',exact:true}).click()
  expect((await issues(page)).map(a=>[a.number,a.text])).toEqual([[3,'下の指摘'],[1,'確認,"寸法"\n次の行'],[2,'中の指摘']])
  await page.keyboard.press('Control+z');expect((await issues(page)).map(a=>a.number)).toEqual([1,2,3])
})
test('指摘のEscで内容と印が残り、ダブルクリック・一覧から内容を直せて状態とサイズを保存できる',async({page})=>{
  await open(page);await choose(page,'文字','指摘');await click(page,150,240)
  const input=page.getByTestId('issue-editor');await input.fill('確定する内容');await input.press('Escape')
  await expect(input).not.toBeVisible()
  await expect(page.getByRole('button',{name:'選択',exact:true})).toHaveAttribute('aria-pressed','true')
  expect((await issues(page))[0].text).toBe('確定する内容')
  const p=await point(page,150,240);await page.mouse.dblclick(p.x,p.y)
  await expect(input).toBeVisible();await input.fill('内容を修正');await input.press('Control+Enter')
  await page.getByLabel('指摘の大きさ').selectOption('24');await page.getByLabel('指摘の状態',{exact:true}).selectOption('answered')
  await page.getByRole('tab',{name:'書き込み',exact:true}).click();await page.getByLabel('書き込みの種類').selectOption('issue')
  await page.locator('.annotation-rows button[data-annotation-id]').dblclick();await expect(input).toHaveValue('内容を修正');await input.fill('一覧から修正');await input.press('Control+Enter')
  await reopen(page);await expect.poll(async()=>(await issues(page))[0]?.text).toBe('一覧から修正')
  const a=(await issues(page))[0];expect(a.number).toBe(1);expect(a.status).toBe('answered');expect(a.rect[2]-a.rect[0]).toBeCloseTo(24,3)
})
