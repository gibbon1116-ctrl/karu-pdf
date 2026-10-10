import {expect,it} from 'vitest'
// @ts-expect-error Offline JS measurement companion has no app/runtime types.
import {evaluateSymbolPredictions,summarizeTimes} from '../scripts/symbol-recognition-evaluate.mjs'

it('counts duplicates as FP and uses the small-symbol quarter-side tolerance',()=>{
  const truth=[{center:[10,10],shortSide:4},{center:[20,10],shortSide:2}]
  const result=evaluateSymbolPredictions(truth,[{center:[10.5,10]},{center:[10,10]},{center:[20.6,10]}])
  expect([result.tp,result.fp,result.fn]).toEqual([1,2,1])
})
it('finds a one-to-one assignment where greedy nearest matching loses recall',()=>{
  const result=evaluateSymbolPredictions([{center:[0,0],shortSide:8},{center:[3,0],shortSide:8}],
    [{center:[1.4,0]},{center:[0,0]}])
  expect([result.tp,result.fp,result.fn]).toEqual([2,0,0])
})
it('records unknown mandatory features and wrong high-confidence classes independently of positions',()=>{
  const result=evaluateSymbolPredictions([{center:[10,10],shortSide:4,classification:'arc'}],
    [{center:[10,10],classification:'plain',confidence:'high',requiredFeatures:'unknown'}])
  expect(result.tp).toBe(1)
  expect(result.unknown).toBe(1)
  expect(result.wrongHigh).toBe(1)
  expect(result.unconfirmedHigh).toBe(1)
  expect([result.finalTp,result.finalFp,result.finalFn]).toEqual([0,1,1])
})
it('uses nearest-rank p95 and keeps the measurement count and spread',()=>{
  expect(summarizeTimes(Array.from({length:20},(_,i)=>i+1))).toEqual({count:20,min:1,median:10,p95:19,max:20})
  expect(()=>summarizeTimes([NaN])).toThrow()
})
it('does not hide a wrong high class behind a correctly classified duplicate',()=>{
  const result=evaluateSymbolPredictions([{center:[10,10],shortSide:4,classification:'arc'}],
    [{center:[10,10],classification:'arc',confidence:'high'},{center:[10,10],classification:'plain',confidence:'high'}])
  expect([result.tp,result.fp,result.finalTp,result.wrongHigh]).toEqual([1,1,1,1])
})
