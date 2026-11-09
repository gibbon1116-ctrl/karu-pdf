import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'

const centers = [[80,140],[160,140],[80,240],[160,240],[80,340],[160,340]] as const
type Probe = { images: number; vectors: number; hold: boolean; held: boolean }
type ProbeWindow = Window & { __recallProbe: Probe }

function outlet(x: number, y: number, divided = false): string {
  const r = 6, k = r * .5522847498
  const ring = divided
    ? `${x+r} ${y} m ${Array.from({length:36},(_,i)=>{
      const angle = -(i+1)*2*Math.PI/36
      return `${x+r*Math.cos(angle)} ${y+r*Math.sin(angle)} l`
    }).join(' ')} h S`
    : `${x+r} ${y} m ${x+r} ${y+k} ${x+k} ${y+r} ${x} ${y+r} c
      ${x-k} ${y+r} ${x-r} ${y+k} ${x-r} ${y} c
      ${x-r} ${y-k} ${x-k} ${y-r} ${x} ${y-r} c
      ${x+k} ${y-r} ${x+r} ${y-k} ${x+r} ${y} c S`
  const slots = [-2,2].map(dx=>divided
    ? `${x+dx} ${y+4} m ${x+dx} ${y} l S ${x+dx} ${y} m ${x+dx} ${y-4} l S`
    : `${x+dx} ${y-4} m ${x+dx} ${y+4} l S`).join('\n')
  return `${ring}\n${slots}`
}

/** Self-generated PDF content. The second page can contain small embedded images plus unrelated lines. */
function recallPdf(second?: 'empty' | 'embedded'): number[] {
  const doc = new mupdf.PDFDocument()
  const insert = (content: string, resources: object = {}) => {
    const ref = doc.addPage([0,0,500,500],0,resources,content)
    try { doc.insertPage(-1,ref) } finally { ref.destroy() }
  }
  try {
    insert(`q 1 0 0 -1 0 500 cm 0 G .8 w ${centers.map(([x,y],i)=>outlet(x,y,i>=3)).join('\n')} Q`)
    if (second === 'empty') insert('q 0 G .8 w 350 40 m 440 40 l S 440 40 m 440 43 l S Q')
    if (second === 'embedded') {
      const source = new mupdf.PDFDocument()
      try {
        const ref = source.addPage([0,0,20,20],0,{},`q 1 0 0 -1 0 20 cm 0 G .8 w ${outlet(10,10)} Q`)
        try { source.insertPage(-1,ref) } finally { ref.destroy() }
        const page = source.loadPage(0), pixels = page.toPixmap(mupdf.Matrix.scale(4,4),mupdf.ColorSpace.DeviceRGB,false)
        try {
          const image = new mupdf.Image(pixels)
          try {
            const imageRef = doc.addImage(image)
            try {
              const pictures = centers.map(([x,y])=>`q 20 0 0 -20 ${x-10} ${y+10} cm /Symbol Do Q`).join('\n')
              // Pictures cover under 1% of the page, so this remains a page with vector information.
              insert(`q 1 0 0 -1 0 500 cm ${pictures} 0 G .8 w 350 440 m 440 440 l S 440 440 m 440 443 l S Q`,{XObject:{Symbol:imageRef}})
            } finally { imageRef.destroy() }
          } finally { image.destroy() }
        } finally { pixels.destroy(); page.destroy() }
      } finally { source.destroy() }
    }
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { doc.destroy() }
}

const panel = (page: Page) => page.getByRole('dialog',{name:'同じ記号を探す',exact:true})
async function open(page: Page, second?: 'empty'|'embedded') {
  await page.addInitScript(()=>{
    const scope = window as unknown as ProbeWindow
    scope.__recallProbe = {images:0,vectors:0,hold:false,held:false}
    const NativeWorker = window.Worker
    window.Worker = new Proxy(NativeWorker,{
      construct(Target,args) {
        const worker = Reflect.construct(Target,args) as Worker
        if (!/symbolSearch[.-]worker/.test(String(args[0]))) return worker
        const send = worker.postMessage.bind(worker)
        worker.postMessage = ((message:{type?:string},transfer:Transferable[])=>{
          const probe = scope.__recallProbe
          if(message.type==='search') probe.images++
          if(message.type==='vector-search') probe.vectors++
          if(probe.hold && (message.type==='search'||message.type==='vector-search')) {probe.held=true;return}
          send(message,transfer)
        }) as Worker['postMessage']
        return worker
      },
    })
  })
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(()=>!!window.__karu)
  await page.evaluate(bytes=>window.__karu!.openBytes(bytes,'検索補完の試験.pdf'),recallPdf(second))
  await page.evaluate(()=>window.__karu!.setZoom(1))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('tab',{name:'数量',exact:true}).click()
  const quantity = page.getByTestId('fixture-panel')
  await quantity.getByRole('button',{name:'項目を追加',exact:true}).click()
  const dialog = page.getByRole('dialog',{name:'項目を追加',exact:true})
  await dialog.getByLabel('名称',{exact:true}).fill('コンセント')
  await dialog.getByLabel('略号',{exact:true}).fill('C')
  await dialog.getByRole('radio',{name:'個数',exact:true}).check()
  await dialog.getByRole('button',{name:'追加する',exact:true}).click()
  await quantity.getByRole('button',{name:'C コンセント',exact:true}).click()
  await quantity.getByRole('button',{name:'同じ記号を探す',exact:true}).click()
  await expect(page.locator('.fixture-sample-instruction').or(panel(page))).toBeVisible()
  if(await panel(page).isVisible()) await panel(page).getByRole('button',{name:'見本を囲み直す'}).click()
  const svg = page.getByTestId('fixture-sample-selection-0')
  const points = await svg.evaluate(el=>{
    const svg = el as SVGSVGElement, box = svg.getBoundingClientRect()
    return [[71,131],[89,149]].map(([x,y])=>({x:box.left+x*box.width/svg.viewBox.baseVal.width,y:box.top+y*box.height/svg.viewBox.baseVal.height}))
  })
  await page.mouse.move(points[0].x,points[0].y); await page.mouse.down()
  await page.mouse.move(points[1].x,points[1].y,{steps:4}); await page.mouse.up()
  await expect(panel(page)).toBeVisible()
}
async function search(page: Page) {
  await panel(page).getByRole('button',{name:'探す',exact:true}).click()
  await expect(panel(page).getByText('検索が終わりました。候補を確認して選んでください')).toBeVisible({timeout:60_000})
}
async function specify(page: Page, pages: string) {
  await panel(page).getByRole('radio',{name:'ページを指定',exact:true}).check()
  await panel(page).getByRole('textbox',{name:'探すページ'}).fill(pages)
}

test('分割スロット・36角形・逆向きでも6件すべてが候補になる',async({page})=>{
  await open(page); await search(page)
  await expect(page.getByTestId('symbol-search-candidate')).toHaveCount(6)
  await expect(panel(page)).toContainText('候補 6 件')
})

test('検索の詳細は折りたたまれページと診断の行を表示する',async({page})=>{
  await open(page); await search(page)
  const details = panel(page).locator('.symbol-search-diagnostics')
  await expect(details).not.toHaveAttribute('open','')
  await details.getByText('検索の詳細',{exact:true}).click()
  for(const text of ['p.1','検索方式','抽出された線分数','候補生成数','幾何形状の照合後の候補数','描画構造の照合で除外した候補数','最終候補数','表示条件を適用した後の候補数','処理時間（ms）']) {
    await expect(details.getByText(text,{exact:true})).toBeVisible()
  }
  await expect(details.getByRole('checkbox',{name:'描画構造で除外した候補も表示する（要確認）'})).toBeDisabled()
})

test('見本と同じ形がないページは0件の原因を表示する',async({page})=>{
  await open(page,'empty'); await specify(page,'2'); await search(page)
  await expect(panel(page).getByRole('status').filter({hasText:'見本と同じ幾何形状の候補が見つかりませんでした'})).toBeVisible()
})

test('添字のチェックをすべて外すと表示条件の案内になる',async({page})=>{
  await open(page); await search(page)
  await panel(page).getByRole('button',{name:'すべてのチェックを外す',exact:true}).click()
  await expect(panel(page).getByRole('status').filter({hasText:'現在の表示条件では表示されていません'})).toBeVisible()
  await expect(page.getByTestId('symbol-search-candidate')).toHaveCount(0)
})

test('ベクター線と埋め込み画像のページを画像で補完し要確認にする',async({page})=>{
  await open(page,'embedded'); await specify(page,'2'); await search(page)
  await expect(panel(page)).toContainText('線の情報で探し、見つからない分を画像で補いました（要確認）')
  await expect(panel(page)).toContainText('要確認 6 件')
  // Candidate overlays are only mounted for visible pages.
  await page.evaluate(()=>window.__karu!.scrollToPage(1))
  const found = page.getByTestId('symbol-search-candidates-1').getByTestId('symbol-search-candidate')
  await expect(found).toHaveCount(6)
  for(const candidate of await found.all()) {
    await expect(candidate).toHaveAttribute('data-confidence','check')
    await expect(candidate.locator('title')).toContainText('画像で補完')
  }
})

test('中止のあと再検索できる',async({page})=>{
  await open(page)
  await page.evaluate(()=>{(window as unknown as ProbeWindow).__recallProbe.hold=true})
  await panel(page).getByRole('button',{name:'探す',exact:true}).click()
  await page.waitForFunction(()=>(window as unknown as ProbeWindow).__recallProbe.held,undefined,{timeout:60_000})
  await panel(page).getByRole('button',{name:'中止',exact:true}).click()
  await page.evaluate(()=>{(window as unknown as ProbeWindow).__recallProbe.hold=false})
  await search(page)
  await expect(page.getByTestId('symbol-search-candidate')).toHaveCount(6)
})

test('全ページでは画像補完を自動実行せず明示したページだけ補完できる',async({page})=>{
  await open(page,'embedded')
  await panel(page).getByRole('radio',{name:'すべてのページ',exact:true}).check()
  await search(page)
  expect(await page.evaluate(()=>(window as unknown as ProbeWindow).__recallProbe.images)).toBe(0)
  const retry = panel(page).getByRole('button',{name:'p.2 を画像でも探す（時間がかかります）',exact:true})
  await expect(retry).toBeVisible()
  await retry.click()
  await expect(panel(page).getByText('検索が終わりました。候補を確認して選んでください')).toBeVisible({timeout:60_000})
  expect(await page.evaluate(()=>(window as unknown as ProbeWindow).__recallProbe.images)).toBe(1)
  await expect(panel(page)).toContainText('要確認 6 件')
  await panel(page).getByRole('button',{name:/^p\.2 線の情報で探し、見つからない分を画像で補いました/}).click()
  const found = page.getByTestId('symbol-search-candidates-1').getByTestId('symbol-search-candidate')
  await expect(found).toHaveCount(6)
  for(const candidate of await found.all()) await expect(candidate).toHaveAttribute('data-confidence','check')
  await expect(retry).toHaveCount(0)
})
