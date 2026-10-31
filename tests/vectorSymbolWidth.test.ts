import { describe, expect, it } from 'vitest'
import { prepareVectorTemplate, vectorSymbolSearch } from '../src/core/vectorSymbolSearch'

import { circleLines, outletLines } from './symbolLabelFixtures'
describe('stroke width and surrounding lines', () => {
  it('keeps zero fill outlines and inclusive .5W / 2W boundaries, using the cleaned weighted median', () => {
    const body=outletLines(20,20), widths=new Float32Array(body.length/4).fill(.424)
    const segments=new Float32Array([...body,18,18,19,18,19,18,19,19,18,19,19,19])
    const prepared=prepareVectorTemplate(segments,new Float32Array([...widths,0,.212,.848]),[14,14,26,26])
    expect(prepared.strokeWidth).toBeCloseTo(.424,6)
    const boundary=new Float32Array([...body,18,18,19,18,19,18,19,19])
    const standard=new Float32Array([...Array(body.length/4).fill(.42),.21,.84])
    expect(prepareVectorTemplate(boundary,standard,[14,14,26,26]).removed.thin).toBe(0)
    expect(prepareVectorTemplate(new Float32Array(body),new Float32Array(body.length/4),[14,14,26,26]).removed.thin).toBe(0)
  })
  it('removes the overlapping .06pt background before cleanup and keeps .42pt bodies', () => {
    const body=outletLines(20,20), background=[19,19,21,19,21,19,21,21,21,21,19,21,19,21,19,19]
    const prepared=prepareVectorTemplate(new Float32Array([...body,...background]),new Float32Array([...Array(body.length/4).fill(.42),...Array(4).fill(.06)]),[14,14,26,26])
    expect(prepared.strokeWidth).toBeCloseTo(.42,6);expect(prepared.removed.thin).toBe(4)
    expect(prepared.segments).toEqual(new Float32Array(body))
  })
  it('keeps all-zero width information and falls back if filtering leaves fewer than two lines', () => {
    const segments=new Float32Array([0,0,10,0,10,0,10,2])
    expect(prepareVectorTemplate(segments,new Float32Array(2),[-1,-1,11,3])).toMatchObject({strokeWidth:0,removed:{thin:0},segments})
    expect(prepareVectorTemplate(segments,new Float32Array([.42,.06]),[-1,-1,11,3])).toMatchObject({strokeWidth:0,removed:{thin:0},segments})
  })
  it('gives identical scores and extra values with or without thin overlapping background', () => {
    const lines=new Float32Array([...outletLines(20,20),...outletLines(60,20),55,17,65,17,55,23,65,23])
    const widths=new Float32Array([...Array(68).fill(.42),.06,.06])
    const result=vectorSymbolSearch(lines,[14,14,26,26],{},lines,widths,widths)
    expect(result.matches).toHaveLength(2)
    expect(result.matches[0].score).toBe(result.matches[1].score)
    expect(result.matches.map(m=>m.extra)).toEqual([0,0])
  })
  it('flags double circles, excludes long wiring, and measures the sample surround by the same rule', () => {
    const lines=new Float32Array([...outletLines(20,20),...outletLines(60,20),...circleLines(60,20,7),...outletLines(100,20),80,20,120,20])
    const widths=new Float32Array(lines.length/4).fill(.42)
    const result=vectorSymbolSearch(lines,[14,14,26,26],{rotations:true},lines,widths,widths)
    expect(result.matches).toHaveLength(3)
    const double=result.matches.find(m=>Math.abs(m.center[0]-60)<1)!
    expect(double.around-result.template.sampleAround).toBeGreaterThan(.3)
    expect(result.matches.find(m=>Math.abs(m.center[0]-100)<1)!.around).toBe(0)
    const same=vectorSymbolSearch(lines,[54,14,66,26],{},lines,widths,widths)
    expect(same.template.sampleAround).toBeCloseTo(double.around)
  })
})
