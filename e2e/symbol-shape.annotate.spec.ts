import { expect, test, type Page } from '@playwright/test'
import { symbolShapePdf, symbolShapeSampleRect } from '../tests/symbolShapeFixtures'

const panel=(page:Page)=>page.getByRole('dialog',{name:'同じ記号を探す',exact:true})
async function point(page:Page,x:number,y:number) {
  return page.getByTestId('fixture-sample-selection-0').evaluate((el,p)=>{
    const svg=el as SVGSVGElement,b=svg.getBoundingClientRect(),v=svg.viewBox.baseVal
    return{x:b.left+p.x*b.width/v.width,y:b.top+p.y*b.height/v.height}
  },{x,y})
}

test('形の細部が違う候補は初めは隠し、表示中の候補だけ数量へ追加する',async({page})=>{
  test.setTimeout(180_000)
  await page.addInitScript(()=>localStorage.removeItem('karu-pdf:symbol-search-shape'))
  await page.goto('/karu-pdf/?test=1&workers=3&warm=0')
  await page.waitForFunction(()=>!!window.__karu)
  await page.evaluate(bytes=>window.__karu!.openBytes(bytes,'symbol-shape.pdf'),symbolShapePdf())
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.evaluate(()=>window.__karu!.setZoom(1))
  await page.getByRole('tab',{name:'数量',exact:true}).click()
  const quantity=page.getByTestId('fixture-panel')
  await quantity.getByRole('button',{name:'項目を追加',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'項目を追加',exact:true})
  await dialog.getByLabel('名称',{exact:true}).fill('感知器');await dialog.getByLabel('略号',{exact:true}).fill('D')
  await dialog.getByRole('radio',{name:'個数',exact:true}).check();await dialog.getByRole('button',{name:'追加する',exact:true}).click()
  await quantity.getByRole('button',{name:'D 感知器',exact:true}).click()
  await quantity.getByRole('button',{name:'同じ記号を探す',exact:true}).click()
  const a=await point(page,symbolShapeSampleRect[0],symbolShapeSampleRect[1])
  const b=await point(page,symbolShapeSampleRect[2],symbolShapeSampleRect[3])
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y);await page.mouse.up()
  await expect(panel(page)).toBeVisible()
  const shapeCheck=panel(page).getByRole('checkbox',{name:'形の細部（円弧・枠・斜線・塗り）も見本と比べる',exact:true})
  await expect(shapeCheck).not.toBeChecked()
  await shapeCheck.check()
  await panel(page).getByRole('checkbox',{name:'画像でも確認する',exact:true}).uncheck()
  await panel(page).getByRole('button',{name:'探す',exact:true}).click()
  await expect(panel(page)).toContainText('検索が終わりました',{timeout:60_000})

  const candidates=page.getByTestId('symbol-search-candidate')
  await expect(candidates).toHaveCount(4)
  await expect(page.locator('[data-testid="symbol-search-candidate"][data-shape="same"]')).toHaveCount(4)
  await expect(panel(page)).toContainText('候補 4 件')
  const showDifferent=panel(page).getByRole('checkbox',{name:/^形の細部が見本と違う 4 件も表示する/})
  await expect(showDifferent).not.toBeChecked()
  await expect(panel(page)).toContainText('形の細部が見本と違う 4 件も表示する（円弧 4）')
  expect(await page.evaluate(()=>window.__karu!.getEditableAnnotations(0).filter(a=>a.count).length)).toBe(0)

  await showDifferent.check()
  await expect(candidates).toHaveCount(8)
  await expect(panel(page)).toContainText('候補 8 件')
  const different=page.locator('[data-testid="symbol-search-candidate"][data-shape="different"]')
  await expect(different).toHaveCount(4)
  for(const c of await different.all()) {
    await expect(c).toHaveClass(/shape-different/)
    await expect(c.locator('title')).toContainText('形の細部が違う（円弧）')
  }
  expect(await page.evaluate(()=>window.__karu!.getEditableAnnotations(0).filter(a=>a.count).length)).toBe(0)

  await showDifferent.uncheck()
  await expect(candidates).toHaveCount(4)
  await expect(different).toHaveCount(0)
  await panel(page).getByRole('button',{name:'すべて選ぶ',exact:true}).click()
  await expect(page.locator('[data-testid="symbol-search-candidate"][data-state="chosen"]')).toHaveCount(4)
  await panel(page).getByRole('button',{name:'選んだ 4 件を数量へ追加',exact:true}).click()
  expect(await page.evaluate(()=>window.__karu!.getEditableAnnotations(0).filter(a=>a.count).length)).toBe(4)

  await shapeCheck.uncheck()
  await expect(candidates).toHaveCount(0)
  expect(await page.evaluate(()=>localStorage.getItem('karu-pdf:symbol-search-shape'))).toBe('false')
  await panel(page).getByRole('button',{name:'探す',exact:true}).click()
  await expect(panel(page)).toContainText('検索が終わりました',{timeout:60_000})
  await expect(candidates).toHaveCount(8)
  await expect(page.locator('[data-testid="symbol-search-candidate"][data-shape="none"]')).toHaveCount(8)
  await expect(panel(page)).toContainText('候補 8 件')
  await expect(showDifferent).toHaveCount(0)
  expect(await page.evaluate(()=>window.__karu!.getEditableAnnotations(0).filter(a=>a.count).length)).toBe(4)
})
