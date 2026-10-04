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

test('指摘の回答・分野・修正確認を入力し、4段階の状態とともに保存する', async ({ page }) => {
  await open(page); await page.keyboard.press('n'); await place(page, 160, 200, '回路確認')
  await page.keyboard.press('Escape'); await page.getByRole('tab', { name: '書き込み', exact: true }).click()
  await page.getByRole('button', { name: '指摘 1 の詳細', exact: true }).click()
  await expect(page.getByLabel('指摘の分野', { exact: true })).toHaveAttribute('list', 'issue-disciplines')
  expect(await page.locator('#issue-disciplines option').evaluateAll(options => options.map(option => option.getAttribute('value')))).toEqual(['建築','構造','電気','機械','外構','その他'])
  await expect(page.locator('.issue-details')).not.toContainText('指摘ID')
  const identity = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).find(a => a.issue)!.issue!.id!)
  await expect(page.locator('.issue-details')).not.toContainText(identity)
  await page.getByLabel('指摘の分野', { exact: true }).fill('電気')
  await page.getByLabel('指摘の回答', { exact: true }).fill('配線を修正')
  await page.getByLabel('指摘の修正確認', { exact: true }).fill('新版で確認')
  await page.getByLabel('指摘 1 の状態', { exact: true }).selectOption('confirmed')
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
  await page.getByLabel('指摘 2 の状態',{exact:true}).selectOption('done')
  const csv=await page.evaluate(()=>window.__karu!.exportIssueCsv())
  expect(csv).toBe('\uFEFF種類,番号,ページ,図面番号,内容,色,"位置（x, y mm）","大きさ（幅, 高さ mm）",状態,分野,回答,修正確認,引継ぎ元番号,引継ぎ元文書\r\n指摘,1,1,,下の指摘,#FF0000,"67.73, 103.01","5.64, 5.64",未回答,,,,,\r\n指摘,2,1,,"確認,""寸法""\r\n次の行",#808080,"32.46, 74.79","5.64, 5.64",対応済（旧版）,,,,,\r\n指摘,3,1,,中の指摘,#FF0000,"67.73, 85.37","5.64, 5.64",未回答,,,,,\r\n')
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
  await page.getByLabel('指摘の大きさ').selectOption('24');await page.getByLabel('指摘の状態',{exact:true}).selectOption('done')
  await page.getByRole('tab',{name:'書き込み',exact:true}).click();await page.getByLabel('書き込みの種類').selectOption('issue')
  await page.locator('.annotation-rows button[data-annotation-id]').dblclick();await expect(input).toHaveValue('内容を修正');await input.fill('一覧から修正');await input.press('Control+Enter')
  await reopen(page);await expect.poll(async()=>(await issues(page))[0]?.text).toBe('一覧から修正')
  const a=(await issues(page))[0];expect(a.number).toBe(1);expect(a.status).toBe('done');expect(a.rect[2]-a.rect[0]).toBeCloseTo(24,3)
})
