import { describe, expect, it, vi } from 'vitest'
import { toGray, verifyCandidates, type GrayImage, type VerifyTarget } from '../src/core/symbolSearch'
import { imageConfidence, imageConfidenceThreshold } from '../src/client/SymbolSearchClient'
import type { SymbolSearchMessage, SymbolSearchResponse } from '../src/worker/symbolSearchMessages'
import { vectorSearchSnapPdf } from './vectorSearchSnapFixtures'

const blank = (width: number, height: number): GrayImage => ({ width, height, data: new Uint8Array(width * height) })
const target = (x: number, y: number, width = 17, height = 13, angle = 0): VerifyTarget => ({ x, y, width, height, angle })
const ink = (x: number, y: number) => Math.round(220 * Math.exp(-((x + 3) ** 2 / 9 + y ** 2 / 5))
  + 170 * Math.exp(-((x - 3) ** 2 / 2 + (y - 2) ** 2 / 8)))
function sample(): GrayImage {
  const image = blank(17, 13)
  for (let y = 0; y < 13; y++) for (let x = 0; x < 17; x++) image.data[y * 17 + x] = ink(x - 8, y - 6)
  return image
}
function stamp(page: GrayImage, image: GrayImage, x: number, y: number) {
  for (let row = 0; row < image.height; row++) page.data.set(image.data.subarray(row * image.width, (row + 1) * image.width), (y + row) * page.width + x)
}

describe('candidate-only NCC verification', () => {
  it('scores the right symbol highly, rejects a different symbol, and tolerates only local offsets', () => {
    const page = blank(90, 65), template = sample(), other = blank(17, 13)
    for (let y = 0; y < 13; y++) for (let x = 0; x < 17; x++) other.data[y * 17 + x] = (x + y) % 2 ? 255 : 0
    stamp(page, template, 10, 12); stamp(page, other, 55, 12)
    const scores = verifyCandidates(page, template, [target(10, 12), target(55, 12), target(8, 14), target(40, 40)], {})
    expect(scores[0]).toBeGreaterThan(.99); expect(scores[1]).toBeLessThan(.3)
    expect(scores[2]).toBeGreaterThan(.99); expect(scores[3]).toBe(0)
    expect(verifyCandidates(page, template, [target(8, 14)], { searchRadius: 0 })[0]).toBeLessThan(.9)
  })
  it.each([90, 180, 270, 89.99999, -90])('rotates accurately near quarter turns: %s degrees', angle => {
    const page = blank(80, 70), template = sample()
    let rotated = template
    const turns = ((Math.round(angle / 90) % 4) + 4) % 4
    for (let n = 0; n < turns; n++) {
      const next = blank(rotated.height, rotated.width)
      for (let y = 0; y < rotated.height; y++) for (let x = 0; x < rotated.width; x++) next.data[x * next.width + next.width - y - 1] = rotated.data[y * rotated.width + x]
      rotated = next
    }
    stamp(page, rotated, 22, 18)
    expect(verifyCandidates(page, template, [target(22, 18, rotated.width, rotated.height, angle)], { searchRadius: 0 })[0]).toBeGreaterThan(.99)
  })
  it('matches an independently sampled 30 degree asymmetric image', () => {
    const page = blank(80, 70), template = sample(), c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6)
    const rotated = blank(Math.ceil(c * 17 + s * 13), Math.ceil(s * 17 + c * 13))
    for (let y = 0; y < rotated.height; y++) for (let x = 0; x < rotated.width; x++) {
      const dx = x - (rotated.width - 1) / 2, dy = y - (rotated.height - 1) / 2
      rotated.data[y * rotated.width + x] = ink(c * dx + s * dy, -s * dx + c * dy)
    }
    stamp(page, rotated, 20, 20)
    expect(verifyCandidates(page, template, [target(20, 20, rotated.width, rotated.height, 30)], {})[0]).toBeGreaterThan(.9)
  })
  it('stops without scoring remaining candidates and reports completed work', () => {
    const page = blank(80, 60), template = sample(), progress: number[] = []
    stamp(page, template, 10, 10)
    let stopped = false
    const scores = verifyCandidates(page, template, [target(10, 10), target(10, 10)], {
      shouldStop: () => stopped, onProgress: done => { progress.push(done); if (done === 1) stopped = true },
    })
    expect(scores[0]).toBeGreaterThan(.9); expect(scores[1]).toBe(0); expect(progress).toEqual([0, 1])
    expect([...verifyCandidates(page, template, [target(10, 10)], { shouldStop: () => true })]).toEqual([0])
  })
  it('returns zero for flat windows, flat templates, and out-of-page targets', () => {
    expect([...verifyCandidates(blank(30, 30), sample(), [target(0, 0), target(-30, -30)], {})]).toEqual([0, 0])
    expect([...verifyCandidates(sample(), blank(3, 3), [target(1, 1, 3, 3)], {})]).toEqual([0])
  })
  it('grades line matches against a lower image bar (0.35 at the default 0.85), including the exact boundary', () => {
    expect(imageConfidenceThreshold(.85)).toBeCloseTo(.35)
    for (const threshold of [.55, .85, .98]) {
      const minimum = Math.max(.2, Math.min(.6, threshold - .5))
      expect(imageConfidence(minimum, threshold)).toBe('high')
      expect(imageConfidence(minimum - 1e-6, threshold)).toBe('check')
    }
  })
  it('verifies all six positions in the rendered PDF fixture, preserving crossed symbols', async () => {
    const {default:mupdf}=await import('mupdf')
    const doc=mupdf.Document.openDocument(new Uint8Array(vectorSearchSnapPdf()),'application/pdf'), pdfPage=doc.loadPage(0)
    const pixmap=pdfPage.toPixmap(mupdf.Matrix.scale(2,2),mupdf.ColorSpace.DeviceRGB,false,false)
    try {
      const rgb=pixmap.getPixels(), rgba=new Uint8ClampedArray(pixmap.getWidth()*pixmap.getHeight()*4)
      for(let i=0;i<rgba.length/4;i++) { rgba[i*4]=rgb[i*3];rgba[i*4+1]=rgb[i*3+1];rgba[i*4+2]=rgb[i*3+2];rgba[i*4+3]=255 }
      const page=toGray(rgba,pixmap.getWidth(),pixmap.getHeight()), template=blank(24,24)
      for(let y=0;y<24;y++) template.data.set(page.data.subarray((98+y)*page.width+98,(98+y)*page.width+122),y*24)
      const scores=verifyCandidates(page,template,[[50,50],[150,50],[250,50],[50,150],[150,150],[250,150]]
        .map(([x,y])=>target((x-1)*2,(y-1)*2,24,24)),{})
      expect(scores).toHaveLength(6)
      for(const i of [0,1,2,5]) expect(scores[i]).toBeGreaterThan(.9)
      for(const i of [3,4]) { expect(scores[i]).toBeGreaterThan(0);expect(scores[i]).toBeLessThan(scores[0]) }
    } finally { pixmap.destroy();pdfPage.destroy();doc.destroy() }
  })
  it('dispatches verify in the Worker, emits progress and transfers one score per target without search results', async () => {
    const scope={ onmessage:null as ((event:{data:SymbolSearchMessage})=>void)|null,
      postMessage:vi.fn<(message:SymbolSearchResponse,transfer?:Transferable[])=>void>(),
      addEventListener:vi.fn(),fetch:globalThis.fetch,location:new URL('http://localhost/') }
    vi.stubGlobal('self',scope)
    try {
      const entry=await import('../src/worker/symbolSearch.worker')
      expect(Object.keys(entry)).toEqual([])
      const page=blank(80,60),template=sample();stamp(page,template,10,10)
      scope.onmessage!({data:{type:'verify',id:7,page:{width:page.width,height:page.height,gray:page.data},
        template:{width:template.width,height:template.height,gray:template.data},targets:[target(10,10),target(50,40)]}})
      const calls=scope.postMessage.mock.calls, result=calls.find(([m])=>m.type==='verify-result')!
      expect(result).toBeDefined();expect(result[0].id).toBe(7)
      if(result[0].type!=='verify-result') throw Error('missing verification')
      expect(result[0].scores[0]).toBeGreaterThan(.99);expect(result[0].scores[1]).toBe(0)
      expect(result[1]).toEqual([result[0].scores.buffer])
      expect(calls.some(([m])=>m.type==='result')).toBe(false)
      expect(calls.filter(([m])=>m.type==='progress').map(([m])=>m.type==='progress'?m.done:-1)).toEqual([0,1,2])
    } finally { vi.unstubAllGlobals() }
  })
})
