import { expect, it } from 'vitest'
import { alignTwoPoints, oldRectToNew, readCorrespondences } from '../src/core/registration'
import { blendCompare } from '../src/core/compare'
import { transferCandidates } from '../src/app/issueTransfer'
import { AnnotationStore } from '../src/editor/AnnotationStore'

it('two anchors determine translation, rotation and uniform scale; inverse maps source rect to new raw coordinates', () => {
  const result = alignTwoPoints([50,100],[10,20],[50,300],[110,20])
  expect(result.alignment.scale).toBeCloseTo(2)
  expect(result.alignment.rotation).toBeCloseTo(Math.PI/2)
  const rect = oldRectToNew([30,100,50,120], { oldPage: 0, newPage: 1, drawingNumber: 'E-01', ...result }, 400, 800)
  rect.forEach((n,i) => expect(n).toBeCloseTo([20,40,40,60][i]))
  expect(() => alignTwoPoints([0,0],[0,0],[0,0],[1,1])).toThrow()
})
it('saved correspondence validates document pages, duplicate source pages and finite transforms', () => {
  const mapping = { oldPage: 0, newPage: 2, offset: [20,0], alignment: { scale: 1, rotation: 0 }, drawingNumber: 'E-01' }
  const raw = JSON.stringify({ version: 1, old: '旧.pdf', next: '新.pdf', mappings: [mapping] })
  expect(readCorrespondences(raw,2,3).mappings).toEqual([mapping])
  expect(()=>readCorrespondences(raw,2,2)).toThrow()
  expect(()=>readCorrespondences(JSON.stringify({version:1,old:'旧.pdf',next:'新.pdf',mappings:[mapping,mapping]}),2,3)).toThrow()
})
it('blend endpoints reproduce each page and alpha is composited on white', () => {
  const old = { width: 1, height: 1, rgba: new Uint8ClampedArray([0,0,0,255]) }, next = { width: 1, height: 1, rgba: new Uint8ClampedArray([255,255,255,255]) }
  expect([...blendCompare(old,next,0).rgba]).toEqual([0,0,0,255])
  expect([...blendCompare(old,next,1).rgba]).toEqual([255,255,255,255])
  expect([...blendCompare(old,next,.5).rgba]).toEqual([128,128,128,255])
  expect(() => blendCompare(old,next,2)).toThrow()
})
it('carryover excludes confirmed issues, flags outside sheets and duplicates, preserves origin and undoes the batch', () => {
  const source = new AnnotationStore(), target = new AnnotationStore()
  source.create({ kind: 'issue', pageIndex: 0, rect: [40,50,56,66], text: '回路', issue: { number: 1, status: 'answered', id: 'one', answer: '変更します' } })
  source.create({ kind: 'issue', pageIndex: 0, rect: [80,80,96,96], issue: { number: 2, status: 'confirmed' } })
  source.create({ kind: 'issue', pageIndex: 0, rect: [300,50,316,66] })
  const mapping = { oldPage: 0, newPage: 1, offset: [20,0] as [number,number], alignment: { scale: 1, rotation: 0 }, drawingNumber: 'E-01' }
  const size = { width: 200, height: 200 }
  const candidates = transferCandidates(source.getPageAnnotations(0), [], mapping, size, size, '旧.pdf')
  expect(candidates).toHaveLength(2); expect(candidates[1].reason).toBe('補正後の位置が用紙外')
  target.pasteAnnotations([candidates[0].annotation], 1, size, 0)
  expect(target.getPageAnnotations(1)[0]).toMatchObject({ rect: [20,50,36,66], issue: { sourceId: 'one', sourceDocument: '旧.pdf', status: 'answered', answer: '変更します' } })
  expect(transferCandidates(source.getPageAnnotations(0), target.getPageAnnotations(1), mapping, size, size, '旧.pdf')[0].reason).toBe('引継ぎ済')
  target.undo(); expect(target.getPageAnnotations(1)).toEqual([])
})
