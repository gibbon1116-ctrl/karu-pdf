import path from 'node:path'
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

test('雲四角をドラッグして8ハンドルで編集し、保存後にも雲の属性と座標が戻る',async({page})=>{
  await open(page);await choose(page,'図形','雲（四角）')
  const start=await point(page,100,220),end=await point(page,240,304)
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:8});await page.mouse.up()
  await expect(page.locator('.annotation-cloud')).toHaveCount(1)
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
  await expect(page.locator('[data-measure-vertex]')).toHaveCount(4)
  const start=await point(page,100,220),end=await point(page,120,200)
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.keyboard.down('Shift');await page.mouse.move(end.x,end.y);await page.mouse.up();await page.keyboard.up('Shift')
  const moved=await page.evaluate(()=>window.__karu!.getEditableAnnotations(0).find(a=>a.kind==='cloudPolygon')!.vertices![0])
  expect(moved[0]).toBeCloseTo(100,3);expect(moved[1]).toBeLessThan(220)
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
  expect(csv).toBe('\uFEFF番号,ページ,指摘の内容,状態,対応,"位置（x, y mm）"\r\n1,1,下の指摘,未対応,,"67.73, 103.01"\r\n2,1,"確認,""寸法""\r\n次の行",対応済,,"32.46, 74.79"\r\n3,1,中の指摘,未対応,,"67.73, 85.37"\r\n')
  expect(await page.evaluate(()=>window.__karu!.exportAnnotationCsv())).toContain('指摘,"№ 2 確認,""寸法""')
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'番号を振り直す',exact:true}).click()
  expect((await issues(page)).map(a=>[a.number,a.text])).toEqual([[3,'下の指摘'],[1,'確認,"寸法"\n次の行'],[2,'中の指摘']])
  await page.keyboard.press('Control+z');expect((await issues(page)).map(a=>a.number)).toEqual([1,2,3])
})
test('指摘のEscで空の印が残り、ダブルクリック・一覧から内容を直せて状態とサイズを保存できる',async({page})=>{
  await open(page);await choose(page,'文字','指摘');await click(page,150,240)
  const input=page.getByTestId('issue-editor');await input.fill('取り消し');await input.press('Escape')
  expect((await issues(page))[0].text).toBe('')
  await page.keyboard.press('Escape');const p=await point(page,150,240);await page.mouse.dblclick(p.x,p.y)
  await expect(input).toBeVisible();await input.fill('内容を修正');await input.press('Control+Enter')
  await page.getByLabel('指摘の大きさ').selectOption('24');await page.getByLabel('指摘の状態',{exact:true}).selectOption('done')
  await page.getByRole('tab',{name:'書き込み',exact:true}).click();await page.getByLabel('書き込みの種類').selectOption('issue')
  await page.locator('.annotation-rows button[data-annotation-id]').dblclick();await expect(input).toHaveValue('内容を修正');await input.fill('一覧から修正');await input.press('Control+Enter')
  await reopen(page);await expect.poll(async()=>(await issues(page))[0]?.text).toBe('一覧から修正')
  const a=(await issues(page))[0];expect(a.number).toBe(1);expect(a.status).toBe('done');expect(a.rect[2]-a.rect[0]).toBeCloseTo(24,3)
})
