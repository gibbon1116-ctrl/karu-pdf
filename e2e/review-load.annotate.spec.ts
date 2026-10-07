import mupdf from 'mupdf'
import { expect, test } from '@playwright/test'

function fixture(kind: 'count'|'issue', total: number) {
  const doc=new mupdf.PDFDocument(), ref=doc.addPage([0,0,400,400],0,{},'')
  try {
    doc.insertPage(-1,ref);const page=doc.loadPage(0), resources=doc.newDictionary()
    try {
      for(let i=0;i<total;i++) {
        const a=page.createAnnotation('Stamp'),obj=a.getObject(),x=15+(i%100)*3.5,y=20+Math.floor(i/100)*5
        const data=doc.newString(JSON.stringify(kind==='count'?{version:1,id:`count-${i}`,group:`項目${i % 100}`}:{version:1,id:`issue-${i}`,number:i+1,status:'open'}))
        const name=doc.newName('circle')
        try {
          a.setRect([x,y,x+8,y+8]);a.setColor([0,0,1])
          obj.put(kind==='count'?'KaruCount':'KaruIssue',data)
          if(kind==='count')obj.put('KaruSymbol',name)
          a.setAppearance('N',null,mupdf.Matrix.identity,[0,0,8,8],resources,'0 0 1 RG .6 w 1 1 6 6 re S')
        }finally{name.destroy();data.destroy();obj.destroy();a.destroy()}
      }
    }finally{resources.destroy();page.destroy()}
    const b=doc.saveToBuffer('compress');try{return [...b.asUint8Array()]}finally{b.destroy()}
  }finally{ref.destroy();doc.destroy()}
}
test('100種類・5000個の印は描画をまとめ、集計・選択・スクロール・保存を維持する', async ({page}) => {
  // 2 minutes on a development PC; the 2-core CI runner is slower.
  test.setTimeout(process.env.CI ? 360_000 : 120_000)
  await page.goto('/karu-pdf/?test=1&workers=3&warm=0');await page.waitForFunction(()=>!!window.__karu)
  const bytes=fixture('count',5000), started=Date.now();await page.evaluate(b=>window.__karu!.openBytes(b,'5000個.pdf'),bytes)
  await expect.poll(()=>page.evaluate(()=>window.__karu!.getEditableAnnotations(0).filter(a=>a.count).length)).toBe(5000)
  await page.getByRole('tab',{name:'数量',exact:true}).click(); await page.getByTestId('fixture-panel').getByRole('button', { name: '管理', exact: true }).click()
  await page.getByRole('button',{name:'項目0',exact:true}).click()
  await expect(page.getByTestId('fixture-panel')).toContainText('全図面: 50個')
  await expect(page.getByTestId('fixture-panel')).toContainText('印が多いため略号の表示を省略しています')
  await page.getByRole('button',{name:'選択',exact:true}).click()
  await page.evaluate(()=>window.__karu!.setZoom(1));await page.waitForFunction(()=>window.__karu!.isSharp())
  const box=await page.getByTestId('annotation-layer-0').boundingBox();expect(box).not.toBeNull()
  await page.mouse.move(box!.x+5,box!.y+5);await page.mouse.down();await page.mouse.move(box!.x+390,box!.y+300,{steps:8});await page.mouse.up()
  expect(await page.getByTestId('count-batch').count()).toBeLessThanOrEqual(200)
  expect(await page.getByTestId('count-batch').count()).toBeGreaterThan(0)
  expect(await page.locator('g.annotation-item').count()).toBeLessThan(10)
  await page.getByRole('tab',{name:'書き込み',exact:true}).click();await page.getByLabel('書き込みの種類').selectOption('count')
  await expect(page.getByLabel('個数の集計')).toHaveCount(0)
  await expect(page.locator('.annotation-rows > li')).toHaveCount(100)
  await page.getByTestId('viewer').evaluate(el=>{el.scrollTop+=100})
  // A legacy fixture exercises migration and rebuilding all 5,000 appearances.
  await page.getByRole('tab',{name:'数量',exact:true}).click(); await page.getByTestId('fixture-panel').getByRole('button', { name: '管理', exact: true }).click()
  await page.getByRole('button',{name:'項目0',exact:true}).click()
  await page.getByRole('button',{name:'編集',exact:true}).click()
  await page.getByRole('button',{name:'形 星',exact:true}).click()
  await page.getByRole('button',{name:'変更する',exact:true}).click()
  // Reopen inside the page: copying the multi-megabyte PDF to Node and back as number
  // arrays took longer than the save itself.
  const saveStart=Date.now();const saved=await page.evaluate(async()=>{const t=performance.now();const b=await window.__karu!.saveToBytes();const saveMs=performance.now()-t;if(b)await window.__karu!.openBytes(b,'5000個保存後.pdf');return {size:b?.byteLength ?? 0,saveMs:Math.round(saveMs)}})
  expect(saved.size).toBeGreaterThan(0)
  console.log(JSON.stringify({scenario:'5000 counts',openAndInteractionMs:saveStart-started,saveMs:saved.saveMs,saveAndReopenObservedMs:Date.now()-saveStart,bytes:saved.size}))
  await page.getByRole('tab', { name: '数量', exact: true }).click(); await page.getByTestId('fixture-panel').getByRole('button', { name: '管理', exact: true }).click()
  await page.getByRole('button', { name: '項目0', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).filter(a => a.count?.version === 2).length)).toBe(5000)
  await expect(page.getByTestId('fixture-panel')).toContainText('全図面: 50個')
})
test('1000指摘の一覧は100行に制限し、次のページと状態更新を操作できる', async ({page}) => {
  test.setTimeout(120000)
  await page.goto('/karu-pdf/?test=1&workers=3&warm=0');await page.waitForFunction(()=>!!window.__karu)
  await page.evaluate(b=>window.__karu!.openBytes(b,'1000指摘.pdf'),fixture('issue',1000))
  await page.getByRole('tab',{name:'書き込み',exact:true}).click();await page.getByLabel('書き込みの種類').selectOption('issue')
  await expect(page.locator('.annotation-rows > li')).toHaveCount(100)
  await page.getByRole('button',{name:'次の100件',exact:true}).click()
  await expect(page.getByLabel('指摘 101 の状態',{exact:true})).toBeVisible()
  await page.getByLabel('指摘 101 の状態',{exact:true}).selectOption('answered')
  expect(await page.evaluate(()=>window.__karu!.getEditableAnnotations(0).find(a=>a.issue?.number===101)?.issue?.status)).toBe('answered')
})
