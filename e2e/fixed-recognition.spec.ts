import {test} from '@playwright/test'
import {recognitionWorkerChecks} from './helpers/recognition'
import {localGlyphWorkerChecks} from './helpers/localSymbols'
test('固定版の実Workerで内部線・塗り・白抜きの正解PDFを検索',async({page})=>{
  await recognitionWorkerChecks(page,'/karu-pdf/?test=1&workers=3&warm=0')
})
test('固定版で塗りと文字レイヤーなしの英数字傍記を独立に識別',async({page})=>{
  await localGlyphWorkerChecks(page,'/karu-pdf/?test=1&workers=3&warm=0')
})
