import {test} from '@playwright/test'
import {recognitionWorkerChecks} from './helpers/recognition'
test('独自正解PDFを実Workerで検索し、キャンセル・PDFを閉じた後の解放を確認',async({page})=>{
  await recognitionWorkerChecks(page,'/karu-pdf/?test=1&workers=3&warm=0')
})
