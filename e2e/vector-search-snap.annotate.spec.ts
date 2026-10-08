import { expect, test, type Page } from '@playwright/test'
import { vectorSearchSnapPdf } from '../tests/vectorSearchSnapFixtures'

const panel=(page:Page)=>page.getByRole('dialog',{name:'同じ記号を探す',exact:true})
async function open(page:Page,raster=false) {
  await page.goto('/karu-pdf/?test=1&workers=3&warm=0')
  await page.waitForFunction(()=>!!window.__karu)
  await page.evaluate(bytes=>window.__karu!.openBytes(bytes,'vector-search-snap.pdf'),vectorSearchSnapPdf(raster))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.evaluate(()=>window.__karu!.setZoom(1))
}
async function point(page:Page,x:number,y:number,testId='annotation-layer-0') {
  return page.getByTestId(testId).evaluate((el,p)=>{
    const svg=el as SVGSVGElement,b=svg.getBoundingClientRect(),v=svg.viewBox.baseVal
    return {x:b.left+p.x*b.width/v.width,y:b.top+p.y*b.height/v.height}
  },{x,y})
}
async function setting(page:Page,name:string,enabled:boolean) {
  await page.getByRole('button',{name:'計測▼',exact:true}).click()
  const item=page.getByRole('menuitemcheckbox',{name,exact:true})
  if (await item.getAttribute('aria-checked')!==String(enabled)) await item.click()
  else await page.keyboard.press('Escape')
}
async function measurement(page:Page) {
  await page.getByRole('button',{name:'計測▼',exact:true}).click()
  await page.getByRole('menuitem',{name:'縮尺の設定…',exact:false}).click()
  await page.getByLabel('縮尺の分母').fill('100');await page.getByRole('button',{name:'決定',exact:true}).click()
  await page.keyboard.press('k')
}
async function search(page:Page, verify=true) {
  const quantity=page.getByTestId('fixture-panel')
  await page.getByRole('tab',{name:'数量',exact:true}).click()
  await quantity.getByRole('button',{name:'項目を追加',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'項目を追加',exact:true})
  await dialog.getByLabel('名称',{exact:true}).fill('X記号');await dialog.getByLabel('略号',{exact:true}).fill('X')
  await dialog.getByRole('radio',{name:'個数',exact:true}).check()
  await dialog.getByRole('button',{name:'追加する',exact:true}).click()
  await quantity.getByRole('button',{name:'X X記号',exact:true}).click()
  await quantity.getByRole('button',{name:'同じ記号を探す',exact:true}).click()
  const a=await point(page,49,49,'fixture-sample-selection-0'),b=await point(page,61,61,'fixture-sample-selection-0')
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y);await page.mouse.up()
  await expect(panel(page)).toBeVisible()
  await expect(panel(page).getByRole('slider',{name:'似ている度合い'})).toHaveValue('0.85')
  await expect(panel(page).getByRole('slider',{name:'似ている度合い'})).toHaveAttribute('max','0.98')
  await panel(page).getByRole('checkbox',{name:'画像でも確認する',exact:true}).setChecked(verify)
  await panel(page).getByRole('button',{name:'探す',exact:true}).click()
  await expect(panel(page)).toContainText('検索が終わりました',{timeout:60_000})
}
test('線で6個を探し、横切る線を許容し、対角線の無い四角は除く',async({page})=>{
  await open(page);await search(page)
  await expect(panel(page)).toContainText('線の情報で探しました')
  await expect(panel(page)).toContainText('候補 6 件')
  const candidates=page.getByTestId('symbol-search-candidate');await expect(candidates).toHaveCount(6)
  for (const candidate of await candidates.all()) await expect(candidate).toHaveAttribute('data-confidence',/^(high|check)$/)
  await expect(panel(page)).toContainText(/確度高 \d+ 件・要確認 \d+ 件/)
  const centers=await candidates.locator('rect').evaluateAll(elements=>elements.map(el=>{
    const r=el as SVGRectElement;return [r.x.baseVal.value+r.width.baseVal.value/2,r.y.baseVal.value+r.height.baseVal.value/2]
  }))
  for (const [x,y] of [[55,55],[155,55],[255,55],[55,155],[155,155],[255,155]]) expect(centers.some(p=>Math.hypot(p[0]-x,p[1]-y)<1)).toBe(true)
  expect(await page.evaluate(()=>window.__karu!.getEditableAnnotations(0).filter(a=>a.count).length)).toBe(0)
  const highCandidates=page.locator('[data-testid="symbol-search-candidate"][data-confidence="high"]')
  const highCount=await highCandidates.count()
  expect(highCount).toBeGreaterThan(0)
  await panel(page).getByRole('button',{name:'確度の高い候補を選ぶ',exact:true}).click()
  await expect(page.locator('[data-testid="symbol-search-candidate"][data-state="chosen"]')).toHaveCount(highCount)
  for(const candidate of await highCandidates.all()) await expect(candidate).toHaveAttribute('data-state','chosen')
  for(const candidate of await page.locator('[data-testid="symbol-search-candidate"][data-confidence="check"]').all()) {
    await expect(candidate).toHaveAttribute('data-state','pending');await expect(candidate.locator('.symbol-search-question')).toHaveText('?')
  }
  expect(await page.evaluate(()=>window.__karu!.getEditableAnnotations(0).filter(a=>a.count).length)).toBe(0)
})

test('画像の確認をオフにしても線の候補に確度を付け、設定を保持する',async({page})=>{
  await open(page);await search(page,false)
  const candidates=page.getByTestId('symbol-search-candidate');await expect(candidates).toHaveCount(6)
  for(const candidate of await candidates.all()) await expect(candidate).toHaveAttribute('data-confidence',/^(high|check)$/)
  expect(await page.evaluate(()=>localStorage.getItem('karu-pdf:symbol-search-verify'))).toBe('false')
})
test('画像だけのページでは画像で探す',async({page})=>{
  await open(page,true);await search(page)
  await expect(panel(page)).toContainText('画像で探しました（線の情報が無いページ）')
  const candidates=page.getByTestId('symbol-search-candidate');expect(await candidates.count()).toBeGreaterThan(0)
  for(const candidate of await candidates.all()) await expect(candidate).not.toHaveAttribute('data-confidence',/./)
})
for (const mode of ['on','off','Alt'] as const) test(`図面の端点の距離計測: ${mode}`,async({page})=>{
  await open(page);await measurement(page)
  await setting(page,'スナップ（既存の頂点に合わせる）',true)
  await setting(page,'図面の線の端点にも合わせる',mode!=='off')
  if(mode!=='off') await expect.poll(()=>page.getByTestId('snap-marker-0').getAttribute('data-drawing-ready')).toBe('true')
  const a=await point(page,100.6,400.4),b=await point(page,240,410)
  await page.mouse.move(a.x,a.y)
  if(mode==='on') await expect(page.getByTestId('snap-marker-0')).toHaveAttribute('data-kind','drawing-endpoint')
  if(mode==='Alt') await page.keyboard.down('Alt')
  await page.mouse.click(a.x,a.y);await page.mouse.click(b.x,b.y)
  if(mode==='Alt') await page.keyboard.up('Alt')
  const vertices=await page.evaluate(()=>window.__karu!.getEditableAnnotations(0).at(-1)!.vertices!)
  expect(vertices[0][0]).toBeCloseTo(mode==='on'?100:100.6,3)
  expect(vertices[0][1]).toBeCloseTo(mode==='on'?400:400.4,3)
})
test('通常閲覧・スナップオフ・選択だけの操作では線を取り出さない',async({page})=>{
  await open(page)
  const requests=()=>page.evaluate(()=>window.__karu!.vectorCacheProbe().requests)
  expect(await requests()).toBe(0)
  await measurement(page)
  const p=await point(page,100.6,400.4);await page.mouse.move(p.x,p.y)
  await expect.poll(requests).toBe(0)
  await page.keyboard.press('Escape')
  await setting(page,'スナップ（既存の頂点に合わせる）',true)
  await page.mouse.move(p.x+10,p.y+10);await page.mouse.click(p.x,p.y)
  await expect(page.getByTestId('snap-marker-0')).toHaveAttribute('data-drawing-ready','false')
  expect(await requests()).toBe(0)
})
