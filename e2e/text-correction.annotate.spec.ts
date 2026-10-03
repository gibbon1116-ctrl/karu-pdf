import mupdf from 'mupdf'
import { expect, test } from '@playwright/test'

function fixture() {
  const doc=new mupdf.PDFDocument(), face=new mupdf.Font('Helvetica'), font=doc.addSimpleFont(face,'Latin')
  try {
    const p=doc.addPage([0,0,400,400],0,{Font:{F1:font}},'BT /F1 16 Tf 60 300 Td (Existing text) Tj 0 -120 Td (Other text) Tj ET 0 0 1 RG 2 w 60 280 m 150 280 l S')
    try {doc.insertPage(-1,p)}finally{p.destroy()}
    const b=doc.saveToBuffer('compress');try{return [...b.asUint8Array()]}finally{b.destroy()}
  }finally{font.destroy();face.destroy();doc.destroy()}
}
function nativeText(bytes: Uint8Array) {
  const doc=new mupdf.PDFDocument(bytes),p=doc.loadPage(0),list=p.toDisplayList(false),s=list.toStructuredText('')
  try{return s.asText()}finally{s.destroy();list.destroy();p.destroy();doc.destroy()}
}
test('既存の1行を選択して修正したコピーを開き、原文のタブを保持する', async ({page}) => {
  test.setTimeout(60000)
  await page.goto('/karu-pdf/?test=1&workers=3')
  await page.waitForFunction(()=>!!window.__karu)
  await page.evaluate(b=>window.__karu!.openBytes(b,'source.pdf'),fixture())
  const sourceId=await page.evaluate(()=>window.__karu!.listTabs()[0].docId)
  await page.keyboard.press('Control+f');await page.getByLabel('検索する文字').fill('Existing text');await page.getByLabel('検索する文字').press('Enter')
  const polygon=page.locator('.search-highlight-layer polygon.active');await expect(polygon).toBeVisible();const box=(await polygon.boundingBox())!
  await page.getByRole('button',{name:'文字に印▼'}).click();await page.getByRole('menuitemcheckbox',{name:/^文字を選択/}).click()
  await page.mouse.move(box.x+2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width-2,box.y+box.height/2,{steps:8});await page.mouse.up()
  await page.getByRole('button',{name:'文字を修正…',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'既存文字の修正'})
  await dialog.getByLabel('修正文',{exact:true}).fill('修正しました');await dialog.getByLabel('修正文の文字サイズ').fill('8')
  await dialog.getByRole('button',{name:'修正したコピーを開く'}).click()
  await expect(page.locator('.document-tab-name[aria-current="page"]')).toContainText('source_文字修正.pdf')
  const corrected=await page.evaluate(async()=>Array.from(await window.__karu!.exportDocumentBytes()))
  const after=nativeText(new Uint8Array(corrected));expect(after).toContain('修正しました');expect(after).not.toContain('Existing text');expect(after).toContain('Other text')
  await page.evaluate(id=>window.__karu!.activateTab(id),sourceId)
  expect(nativeText(new Uint8Array(await page.evaluate(async()=>Array.from(await window.__karu!.exportDocumentBytes()))))).toContain('Existing text')
  await expect(dialog).not.toBeVisible()
})
test('本文修正できない選択は原文を変えず訂正注釈を作成できる', async ({page}) => {
  test.setTimeout(60000)
  await page.goto('/karu-pdf/?test=1&workers=3');await page.waitForFunction(()=>!!window.__karu)
  await page.evaluate(b=>window.__karu!.openBytes(b,'source.pdf'),fixture())
  await page.getByTestId('annotation-layer-0').waitFor()
  await page.evaluate(async()=>{
    const rect=(await window.__karu!.pageTextLines(0))[0],docId=window.__karu!.listTabs()[0].docId
    document.dispatchEvent(new CustomEvent('karu-pdf:text-correction',{detail:{docId,pageIndex:0,rect,originalText:'Existing'}}))
  })
  const dialog=page.getByRole('dialog',{name:'既存文字の修正'})
  await dialog.getByLabel('修正文',{exact:true}).fill('Revised');await dialog.getByLabel('修正文の文字サイズ').fill('8')
  await dialog.getByRole('button',{name:'修正したコピーを開く'}).click()
  await expect(dialog.getByRole('alert')).toContainText('横書き1行全体')
  await dialog.getByRole('button',{name:'訂正注釈で記録'}).click()
  const saved=await page.evaluate(async()=>Array.from((await window.__karu!.saveToBytes())!))
  expect(nativeText(new Uint8Array(saved!))).toContain('Existing text')
  await expect.poll(()=>page.evaluate(()=>window.__karu!.getEditableAnnotations(0).filter(a=>a.kind==='callout').map(a=>a.text))).toEqual(['訂正: Revised'])
})
