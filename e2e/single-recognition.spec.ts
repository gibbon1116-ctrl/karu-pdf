import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {test} from '@playwright/test'
import {recognitionWorkerChecks} from './helpers/recognition'
import {localGlyphWorkerChecks} from './helpers/localSymbols'
test('単一HTMLの埋込Workerで内部線・塗り・白抜きの正解PDFを検索',async({page})=>{
  const file=fs.readdirSync('dist-single').find(name=>name.endsWith('.html'))!
  await recognitionWorkerChecks(page,pathToFileURL(path.resolve('dist-single',file)).href+'?test=1&workers=3&warm=0')
})
test('単一HTMLの埋込Workerで塗りとパス傍記を独立に識別',async({page})=>{
  const file=fs.readdirSync('dist-single').find(name=>name.endsWith('.html'))!
  await localGlyphWorkerChecks(page,pathToFileURL(path.resolve('dist-single',file)).href+'?test=1&workers=3&warm=0')
})
