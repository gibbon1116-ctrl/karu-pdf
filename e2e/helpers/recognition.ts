import {expect,type Page} from '@playwright/test'
import {recognitionFixture,recognitionAccuracy} from '../../tests/symbolRecognitionFixtures'
import type {SymbolSearchTestHooks} from '../../src/client/SymbolSearchClient'

/** The same independent oracle exercises the real PDF and search Workers in all builds. */
export async function recognitionWorkerChecks(page:Page,url:string){
  const fixture=recognitionFixture()
  await page.goto(url)
  await page.waitForFunction(()=>!!window.__karu)
  await page.getByTestId('file-input').setInputFiles({name:'recognition-oracle.pdf',mimeType:'application/pdf',buffer:Buffer.from(fixture.bytes)})
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  expect(await page.evaluate(()=>window.__karu!.vectorCacheProbe().requests)).toBe(0)
  const docId=await page.evaluate(()=>window.__karu!.listTabs()[0].docId)
  for(const sample of fixture.truth.filter(t=>t.id.endsWith('-0'))){
    const result=await page.evaluate(({docId,sample})=>(window.__karu as typeof window.__karu & SymbolSearchTestHooks).symbolSearch({docId,pageIndex:sample.pageIndex,samplePageIndex:sample.pageIndex,
      sampleRect:sample.rect,verify:false,options:{threshold:.85,rotations:false}}),{docId,sample})
    expect(result.method).toBe('vector')
    const accuracy=recognitionAccuracy(fixture.truth,sample,result.candidates.map(c=>c.center))
    expect(accuracy.fn,sample.id).toBe(0)
    expect(accuracy.fp,sample.id).toBe(sample.id==='connected-wrong-0'?2:0)
    for(const p of accuracy.unexpected)expect(result.candidates.find(c=>Math.hypot(c.center[0]-p[0],c.center[1]-p[1])<.01)!.confidence).toBe('check')
    const cache=await page.evaluate(()=>window.__karu!.vectorCacheProbe())
    expect(cache.pages).toBeLessThanOrEqual(3);expect(cache.bytes).toBeLessThanOrEqual(16*1024*1024)
  }
  expect(await page.evaluate(()=>window.__karu!.listTabs()[0].dirty)).toBe(false)
  // Explicit cancellation must settle and a following search must still work.
  const sample=fixture.truth[0]
  const request={docId,pageIndex:0,samplePageIndex:0,sampleRect:sample.rect,verify:false}
  const cancelled=await page.evaluate(r=>(window.__karu as typeof window.__karu & SymbolSearchTestHooks).symbolSearchCancelTest(r,0),request)
  expect(cancelled.cancelled).toBe(true);expect(cancelled.settledMs).toBeLessThan(1000)
  expect((await page.evaluate(r=>(window.__karu as typeof window.__karu & SymbolSearchTestHooks).symbolSearch(r),request)).candidates).toHaveLength(2)
  await page.evaluate(id=>window.__karu!.closeTab(id),docId)
  await expect.poll(()=>page.evaluate(()=>window.__karu!.listTabs().length)).toBe(0)
  expect(await page.evaluate(()=>window.__karu!.vectorCacheProbe())).toMatchObject({pages:0,bytes:0})
}
