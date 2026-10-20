// Run against npm run preview (port 4173); synthetic PDF only.
import { chromium } from '@playwright/test'
import mupdf from 'mupdf'
import fs from 'node:fs/promises'
import path from 'node:path'
const doc = new mupdf.PDFDocument()
for (let i = 0; i < 100; i++) {
  const ref = doc.addPage([0, 0, 500, 600], 0, {}, '')
  doc.insertPage(-1, ref); ref.destroy()
  const page = doc.loadPage(i)
  for (let j = 0; j < 100; j++) {
    const a = page.createAnnotation('Circle')
    const x = 20 + (j % 10) * 40, y = 20 + Math.floor(j / 10) * 40
    a.setRect([x, y, x + 10, y + 10]); a.setContents('確認'); a.update(); a.destroy()
  }
  page.destroy()
}
const buffer = doc.saveToBuffer('compress')
const bytes = [...buffer.asUint8Array()]; buffer.destroy(); doc.destroy()
const browser = await chromium.launch({ ...(process.env.KARU_BROWSER_PATH ? { executablePath: process.env.KARU_BROWSER_PATH } : {}) })
const results = []
for (let i = 0; i < 5; i++) {
  const context = await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'})
  const page = await context.newPage()
  await page.goto('http://127.0.0.1:4173/karu-pdf/?test=1&perf=1&workers=2&warm=0')
  await page.waitForFunction(()=>!!window.__karu)
  await page.evaluate(b=>window.__karu.openBytes(b,'100ページ・10000注釈.pdf'),bytes)
  await page.getByTestId('annotation-layer-0').waitFor({state:'visible'})
  const result = await page.evaluate(()=>new Promise(resolve=>{
    const start = performance.now()
    let panelMs = null
    const sample = () => {
      const panel = document.querySelector('[data-testid="fixture-panel"]')
      if(panel && panelMs===null) panelMs=performance.now()-start
      const button=panel && [...panel.querySelectorAll('button')].find(b=>b.textContent==='項目を追加')
      if(button && !button.disabled){
        observer.disconnect()
        requestAnimationFrame(()=>resolve({panelMs,readyMs:performance.now()-start,counters:window.__karuPerf?.get()}))
      }
    }
    const observer=new MutationObserver(sample)
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']})
    ;[...document.querySelectorAll('button')].find(b=>b.textContent==='数量拾い').click()
    sample()
  }))
  results.push(result); console.log(JSON.stringify({run:i+1,panelMs:result.panelMs,readyMs:result.readyMs}))
  await context.close()
}
await browser.close()
const output = process.argv[2] ?? 'test-results/quantity-opening.json'
await fs.mkdir(path.dirname(output), { recursive: true })
await fs.writeFile(output,JSON.stringify(results,null,2))
