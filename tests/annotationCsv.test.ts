import { describe, expect, it } from 'vitest'
import type { EditableAnnotation } from '../src/editor/AnnotationStore'
import { createAnnotationCsv } from '../src/app/annotationCsv'

function annotation(values: Partial<EditableAnnotation> = {}): EditableAnnotation {
  return {
    id: 'new-1', objNum: null, pageIndex: 1, kind: 'freetext', rect: [72, 144, 216, 216],
    text: '引用 "A",\n二行目', fontSize: 10.5, font: 'BIZUDGothic', color: [1, 0, 0],
    borderWidth: 1, opacity: 1, textOpacity: 1, boxOpacity: 1, interiorColor: null,
    borderColor: null, line: null, inkList: null, calloutPoint: null, calloutLine: null,
    symbol: null, layout: null, dirty: true, madeByKaru: true, ...values,
  }
}

describe('書き込み一覧 CSV', () => {
  it('BOM、CRLF、クォート、mm座標と大きさを出力する', () => {
    const csv = createAnnotationCsv([annotation()])
    expect(csv.charCodeAt(0)).toBe(0xFEFF)
    expect(csv.replace(/\r\n/g, '')).not.toContain('\n')
    expect(csv).toContain('"引用 ""A"",\r\n二行目"')
    expect(csv).toContain('"25.40, 50.80"')
    expect(csv).toContain('"50.80, 25.40"')
    expect(csv).toContain('#FF0000')
  })

  it('ページ順、上から順に番号を付ける', () => {
    const csv = createAnnotationCsv([
      annotation({ id: 'later', pageIndex: 1, rect: [0, 200, 10, 210], text: '後' }),
      annotation({ id: 'first', pageIndex: 0, rect: [0, 100, 10, 110], text: '先' }),
    ])
    const lines = csv.slice(1).split('\r\n')
    expect(lines[1]).toContain('1,1,文字,先')
    expect(lines[2]).toContain('2,2,文字,後')
  })
})
