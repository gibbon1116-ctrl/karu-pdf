import {test} from '@playwright/test'
import {localGlyphWorkerChecks} from './helpers/localSymbols'
test('文字レイヤーのない傍記A/B/Cを本体の塗りと独立して分類',async({page})=>{
 await localGlyphWorkerChecks(page,'/karu-pdf/?test=1&workers=3&warm=0')
})
