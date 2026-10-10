import { expect, test, type Page } from '@playwright/test'
import { symbolShapePdf, symbolShapeSampleRect } from '../tests/symbolShapeFixtures'

const panel=(page:Page)=>page.getByRole('dialog',{name:'同じ記号を探す',exact:true})
async function point(page:Page,x:number,y:number) {
  return page.getByTestId('fixture-sample-selection-0').evaluate((el,p)=>{
    const svg=el as SVGSVGElement,b=svg.getBoundingClientRect(),v=svg.viewBox.baseVal
    return{x:b.left+p.x*b.width/v.width,y:b.top+p.y*b.height/v.height}
  },{x,y})
}
async function addFixture(page:Page,name:string,code:string) {
  const quantity=page.getByTestId('fixture-panel')
  await quantity.getByRole('button',{name:'項目を追加',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'項目を追加',exact:true})
  await dialog.getByLabel('名称',{exact:true}).fill(name)
  await dialog.getByLabel('略号',{exact:true}).fill(code)
  await dialog.getByRole('radio',{name:'個数',exact:true}).check()
  await dialog.getByRole('button',{name:'追加する',exact:true}).click()
  await quantity.getByRole('button',{name:`${code} ${name}`,exact:true}).click()
}
async function search(page:Page) {
  await page.getByTestId('fixture-panel').getByRole('button',{name:'同じ記号を探す',exact:true}).click()
  const a=await point(page,symbolShapeSampleRect[0],symbolShapeSampleRect[1])
  const b=await point(page,symbolShapeSampleRect[2],symbolShapeSampleRect[3])
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y);await page.mouse.up()
  await expect(panel(page)).toBeVisible()
  await panel(page).getByRole('checkbox',{name:'形の細部（円弧・枠・斜線・塗り）も見本と比べる',exact:true}).uncheck()
  await panel(page).getByRole('checkbox',{name:'画像でも確認する',exact:true}).uncheck()
  await panel(page).getByRole('button',{name:'探す',exact:true}).click()
  await expect(panel(page)).toContainText('検索が終わりました',{timeout:60_000})
}

test('他の項目で拾い済みの候補は初めは隠し、表示しても選択や数量追加に入れない',async({page})=>{
  test.setTimeout(180_000)
  await page.addInitScript(()=>{
    localStorage.removeItem('karu-pdf:symbol-search-shape')
    localStorage.removeItem('karu-pdf:symbol-search-verify')
  })
  await page.goto('/karu-pdf/?test=1&workers=3&warm=0')
  await page.waitForFunction(()=>!!window.__karu)
  await page.evaluate(bytes=>window.__karu!.openBytes(bytes,'symbol-other-fixture.pdf'),symbolShapePdf())
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.evaluate(()=>window.__karu!.setZoom(1))
  await page.getByRole('tab',{name:'数量',exact:true}).click()

  await addFixture(page,'感知器A','D')
  await search(page)
  const candidates=page.getByTestId('symbol-search-candidate')
  await expect(candidates).toHaveCount(8)
  await expect(page.locator('[data-testid="symbol-search-candidate"][data-shape="none"]')).toHaveCount(8)
  await expect(page.locator('[data-testid="symbol-search-candidate"][data-other="true"]')).toHaveCount(0)

  const positions=await candidates.evaluateAll(elements=>elements.map(el=>({
    id:el.getAttribute('data-candidate-id')!,
    y:Number(el.querySelector('rect')!.getAttribute('y')),
  })).sort((a,b)=>a.y-b.y))
  expect(positions.slice(0,4).every(p=>p.y<100)).toBe(true)
  expect(positions.slice(4).every(p=>p.y>100)).toBe(true)
  // The first four bodies in symbolShapeFixtures have upper arcs.
  for(const {id} of positions.slice(0,4)) {
    await page.locator(`[data-testid="symbol-search-candidate"][data-candidate-id="${id}"]`).click()
  }
  await expect(page.locator('[data-testid="symbol-search-candidate"][data-state="chosen"]')).toHaveCount(4)
  await panel(page).getByRole('button',{name:'選んだ 4 件を数量へ追加',exact:true}).click()
  const marksA=await page.evaluate(()=>window.__karu!.getEditableAnnotations(0).filter(a=>a.count))
  expect(marksA).toHaveLength(4)
  expect(marksA.every(a=>(a.rect[1]+a.rect[3])/2<100)).toBe(true)
  const fixtureA=(marksA[0].count as {fixtureId:string}).fixtureId
  expect(typeof fixtureA).toBe('string')
  expect(marksA.every(a=>(a.count as {fixtureId:string}).fixtureId===fixtureA)).toBe(true)
  await panel(page).getByRole('button',{name:'閉じる',exact:true}).click()
  await expect(panel(page)).toHaveCount(0)

  await addFixture(page,'感知器B','DB')
  await search(page)
  await expect(candidates).toHaveCount(4)
  await expect(panel(page)).toContainText('候補 4 件')
  await expect(panel(page)).toContainText('（拾い済み 0 件）（他の項目で拾い済み 4 件）')
  const showOther=panel(page).getByRole('checkbox',{name:'他の項目で拾い済みの 4 件も表示する（D 感知器A 4）',exact:true})
  await expect(showOther).not.toBeChecked()
  await expect(page.locator('[data-testid="symbol-search-candidate"][data-other="true"]')).toHaveCount(0)
  expect(await page.evaluate(()=>window.__karu!.getEditableAnnotations(0).filter(a=>a.count))).toEqual(marksA)

  await showOther.check()
  await expect(candidates).toHaveCount(8)
  await expect(panel(page)).toContainText('候補 8 件')
  const other=page.locator('[data-testid="symbol-search-candidate"][data-other="true"]')
  await expect(other).toHaveCount(4)
  for(const c of await other.all()) {
    await expect(c).toHaveClass(/other-fixture/)
    await expect(c).toHaveAttribute('aria-label','記号の候補（他の項目で拾い済み）')
    await expect(c).toHaveAttribute('aria-disabled','true')
    await expect(c).toHaveAttribute('tabindex','-1')
    await expect(c.locator('title')).toContainText('・他の項目（D 感知器A）で拾い済み')
    // aria-disabled blocks a normal click; force it to prove the store also refuses.
    await c.click({force:true})
    await expect(c).toHaveAttribute('data-state','pending')
    await expect(c).toHaveAttribute('aria-pressed','false')
    expect(await c.locator('rect').evaluate(el=>getComputedStyle(el).stroke)).toBe('rgb(119, 119, 119)')
    expect(await c.evaluate(el=>getComputedStyle(el).cursor)).toBe('default')
  }
  await expect(page.locator('[data-testid="symbol-search-candidate"][data-state="chosen"]')).toHaveCount(0)
  expect(await page.evaluate(()=>window.__karu!.getEditableAnnotations(0).filter(a=>a.count))).toEqual(marksA)

  await showOther.uncheck()
  await expect(candidates).toHaveCount(4)
  await expect(other).toHaveCount(0)
  await showOther.check()
  await expect(candidates).toHaveCount(8)
  await expect(other).toHaveCount(4)
  await panel(page).getByRole('button',{name:'すべて選ぶ',exact:true}).click()
  await expect(page.locator('[data-testid="symbol-search-candidate"][data-state="chosen"]')).toHaveCount(4)
  await expect(page.locator('[data-testid="symbol-search-candidate"][data-other="true"][data-state="chosen"]')).toHaveCount(0)
  await panel(page).getByRole('button',{name:'選んだ 4 件を数量へ追加',exact:true}).click()

  const marks=await page.evaluate(()=>window.__karu!.getEditableAnnotations(0).filter(a=>a.count))
  expect(marks).toHaveLength(8)
  const idsA=marksA.map(a=>a.id)
  expect(marks.filter(a=>idsA.includes(a.id))).toEqual(marksA)
  const marksB=marks.filter(a=>!idsA.includes(a.id))
  expect(marksB).toHaveLength(4)
  expect(marksB.every(a=>(a.rect[1]+a.rect[3])/2>100)).toBe(true)
  const fixtureB=(marksB[0].count as {fixtureId:string}).fixtureId
  expect(typeof fixtureB).toBe('string')
  expect(fixtureB).not.toBe(fixtureA)
  expect(marksB.every(a=>(a.count as {fixtureId:string}).fixtureId===fixtureB)).toBe(true)
  await expect(page.locator('[data-testid="symbol-search-candidate"][data-state="counted"]')).toHaveCount(4)
  await expect(other).toHaveCount(4)
  await expect(page.locator('[data-testid="symbol-search-candidate"][data-other="true"][data-state="chosen"]')).toHaveCount(0)
})
