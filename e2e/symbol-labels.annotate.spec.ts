import { expect, test, type Page } from '@playwright/test'
import { symbolLabelsPdf } from '../tests/symbolLabelFixtures'

const panel=(page:Page)=>page.getByRole('dialog',{name:'同じ記号を探す',exact:true})
async function point(page:Page,x:number,y:number) {
  return page.getByTestId('fixture-sample-selection-0').evaluate((el,p)=>{
    const svg=el as SVGSVGElement,b=svg.getBoundingClientRect(),v=svg.viewBox.baseVal
    return{x:b.left+p.x*b.width/v.width,y:b.top+p.y*b.height/v.height}
  },{x,y})
}
test('添字・GC の表示中の候補だけ選択・数量追加し、二重丸には要確認を付ける',async({page})=>{
  await page.goto('/karu-pdf/?test=1&workers=3&warm=0')
  await page.waitForFunction(()=>!!window.__karu)
  await page.evaluate(bytes=>window.__karu!.openBytes(bytes,'symbol-labels.pdf'),symbolLabelsPdf())
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.evaluate(()=>window.__karu!.setZoom(1))
  await page.getByRole('tab',{name:'数量',exact:true}).click()
  const quantity=page.getByTestId('fixture-panel')
  await quantity.getByRole('button',{name:'項目を追加',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'項目を追加',exact:true})
  await dialog.getByLabel('名称',{exact:true}).fill('コンセント');await dialog.getByLabel('略号',{exact:true}).fill('C')
  await dialog.getByRole('radio',{name:'個数',exact:true}).check();await dialog.getByRole('button',{name:'追加する',exact:true}).click()
  await quantity.getByRole('button',{name:'C コンセント',exact:true}).click()
  await quantity.getByRole('button',{name:'同じ記号を探す',exact:true}).click()
  const a=await point(page,34,53),b=await point(page,64,67)
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y);await page.mouse.up()
  await expect(panel(page)).toBeVisible()
  // Isolate around/extra grading from image similarity for this fixture.
  await panel(page).getByRole('checkbox',{name:'画像でも確認する',exact:true}).uncheck()
  await panel(page).getByRole('checkbox',{name:'回転した記号も探す',exact:true}).check()
  await panel(page).getByRole('button',{name:'探す',exact:true}).click()
  await expect(panel(page)).toContainText('検索が終わりました',{timeout:60_000})
  for(const [label,count] of [['ET',5],['4H',1],['20A',2],['添字なし',2]] as const) {
    const checkbox=panel(page).getByRole('checkbox',{name:`${label} ${count}`,exact:true})
    if(label==='ET') await expect(checkbox).toBeChecked();else await expect(checkbox).not.toBeChecked()
  }
  const candidates=page.getByTestId('symbol-search-candidate')
  await expect(candidates).toHaveCount(5);await expect(panel(page)).toContainText('候補 5 件')
  await panel(page).getByLabel('GC回路（G）',{exact:true}).selectOption('with')
  await expect(candidates).toHaveCount(2)
  await panel(page).getByLabel('GC回路（G）',{exact:true}).selectOption('all')
  await panel(page).getByRole('checkbox',{name:'添字なし 2',exact:true}).check();await expect(candidates).toHaveCount(7)
  await panel(page).getByRole('checkbox',{name:'20A 2',exact:true}).check()
  await expect(candidates).toHaveCount(9)
  const doubles=page.locator('[data-testid="symbol-search-candidate"][data-confidence="check"]')
  await expect(doubles).toHaveCount(2)
  for(const c of await doubles.all()) await expect(c.locator('title')).toContainText('周りの線')
  await panel(page).getByRole('button',{name:'すべて選ぶ',exact:true}).click()
  await panel(page).getByRole('checkbox',{name:'20A 2',exact:true}).uncheck()
  // The two hidden, already chosen candidates must not enter quantity.
  await panel(page).getByRole('button',{name:'選んだ 7 件を数量へ追加',exact:true}).click()
  expect(await page.evaluate(()=>window.__karu!.getEditableAnnotations(0).filter(a=>a.count).length)).toBe(7)
  await panel(page).getByRole('checkbox',{name:'20A 2',exact:true}).check()
  await expect(page.locator('[data-testid="symbol-search-candidate"][data-state="chosen"]')).toHaveCount(2)
})
