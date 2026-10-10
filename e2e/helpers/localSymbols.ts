import {expect,type Page} from '@playwright/test'
import {localSymbolsFixture} from '../../tests/symbolLocalFixtures'
import type {SymbolSearchTestHooks} from '../../src/client/SymbolSearchClient'

export async function localGlyphWorkerChecks(page:Page,url:string){
 const {bytes,truth}=localSymbolsFixture()
 await page.goto(url);await page.waitForFunction(()=>!!window.__karu)
 await page.getByTestId('file-input').setInputFiles({name:'stroke-letter-oracle.pdf',mimeType:'application/pdf',buffer:Buffer.from(bytes)})
 await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
 expect(await page.evaluate(()=>window.__karu!.vectorCacheProbe().requests)).toBe(0)
 const docId=await page.evaluate(()=>window.__karu!.listTabs()[0].docId)
 // PDF coordinates have a bottom origin; displayed coordinates invert y.
 for(const sample of [...truth.slice(0,3),truth[7],truth[8]]){
  const rect:[number,number,number,number]=[sample.rect[0],130-sample.rect[3],sample.rect[2],130-sample.rect[1]]
  const result=await page.evaluate(({docId,rect})=>(window.__karu as typeof window.__karu & SymbolSearchTestHooks).symbolSearch({docId,pageIndex:0,samplePageIndex:0,sampleRect:rect,verify:false}),{docId,rect})
  expect(result.sampleLabel).toBe(sample.label)
  const same=result.candidates.filter(c=>c.label===sample.label)
  expect(same).toHaveLength(truth.filter(t=>t.label===sample.label&&t.black===sample.black).length)
  for(const c of same)expect(truth.some(t=>t.label===sample.label&&t.black===sample.black&&Math.hypot(c.center[0]-(t.x+2.5),c.center[1]-70)<2)).toBe(true)
  if(sample===truth[0]||sample===truth[7]){
   const rotated=await page.evaluate(({docId,rect})=>(window.__karu as typeof window.__karu & SymbolSearchTestHooks).symbolSearch({docId,pageIndex:0,samplePageIndex:0,sampleRect:rect,verify:false,options:{rotations:true}}),{docId,rect})
   expect(rotated.sampleLabel).toBe(sample.label)
   expect(rotated.candidates.filter(c=>c.label===sample.label)).toHaveLength(same.length)
  }
 }
 expect(await page.evaluate(()=>window.__karu!.listTabs()[0].dirty)).toBe(false)
 // Exercise the same label filter through quantity UI, with a black C (not A).
 await page.evaluate(()=>window.__karu!.setZoom(1))
 const quantity=page.getByTestId('fixture-panel')
 await page.getByRole('tab',{name:'数量',exact:true}).click()
 await quantity.getByRole('button',{name:'項目を追加',exact:true}).click()
 const item=page.getByRole('dialog',{name:'項目を追加',exact:true})
 await item.getByLabel('名称',{exact:true}).fill('黒塗りC');await item.getByLabel('略号',{exact:true}).fill('C')
 await item.getByRole('radio',{name:'個数',exact:true}).check();await item.getByRole('button',{name:'追加する',exact:true}).click()
 await quantity.getByRole('button',{name:'C 黒塗りC',exact:true}).click()
 await quantity.getByRole('button',{name:'同じ記号を探す',exact:true}).click()
 const points=await page.getByTestId('fixture-sample-selection-0').evaluate(el=>{
  const svg=el as SVGSVGElement,b=svg.getBoundingClientRect(),v=svg.viewBox.baseVal
  return [[344,59],[351,81]].map(([x,y])=>({x:b.left+x*b.width/v.width,y:b.top+y*b.height/v.height}))
 })
 await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();await page.mouse.move(points[1].x,points[1].y);await page.mouse.up()
 const search=page.getByRole('dialog',{name:'同じ記号を探す',exact:true})
 await search.getByRole('checkbox',{name:'画像でも確認する',exact:true}).uncheck()
 await search.getByRole('button',{name:'探す',exact:true}).click();await expect(search).toContainText('検索が終わりました',{timeout:60000})
 await expect(search).toContainText('候補 1 件')
 await expect(search.getByRole('checkbox',{name:'C 1',exact:true})).toBeChecked()
 await expect(search.getByRole('checkbox',{name:'A 2',exact:true})).not.toBeChecked()
 await search.getByRole('button',{name:'すべて選ぶ',exact:true}).click()
 await search.getByRole('button',{name:'選んだ 1 件を数量へ追加',exact:true}).click()
 await search.getByRole('button',{name:'閉じる',exact:true}).click()
 const counts=()=>page.evaluate(()=>window.__karu!.getEditableAnnotations(0).filter(a=>a.count))
 expect(await counts()).toHaveLength(1)
 await page.keyboard.press('Control+z');expect(await counts()).toHaveLength(0)
 await page.keyboard.press('Control+y');expect(await counts()).toHaveLength(1)
 const before=await counts(),saved=await page.evaluate(async()=>Array.from((await window.__karu!.saveToBytes())!))
 await page.evaluate(bytes=>window.__karu!.openBytes(bytes,'saved-local-glyph.pdf'),saved)
 await expect.poll(()=>page.evaluate(()=>window.__karu!.listTabs().length)).toBe(2)
 const after=await counts();expect(after).toHaveLength(1)
 const oldCount=before[0].count,newCount=after[0].count
 if(oldCount?.version!==2||newCount?.version!==2)throw Error('Expected fixture-linked count marks')
 expect(newCount.fixtureId).toBe(oldCount.fixtureId)
 expect(newCount.id).toBe(oldCount.id)
 expect(after[0].rect).toEqual(before[0].rect)
 expect(after[0].symbol).toEqual(before[0].symbol)
 const reopened=await page.evaluate(()=>window.__karu!.listTabs().at(-1)!.docId)
 await page.evaluate(id=>window.__karu!.closeTab(id),reopened)
 await page.evaluate(id=>window.__karu!.closeTab(id),docId)
 await expect.poll(()=>page.evaluate(()=>window.__karu!.vectorCacheProbe().bytes)).toBe(0)
}
