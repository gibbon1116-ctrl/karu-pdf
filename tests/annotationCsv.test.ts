import { createCountCsv } from '../src/app/annotationCsv'
import { nextCountStyle, type CountFixture } from '../src/core/countFixtures'
import { describe, expect, it } from 'vitest'
import type { EditableAnnotation } from '../src/editor/AnnotationStore'
import type { Issue } from '../src/core/issues'
import { createAnnotationCsv, createIssueCsv, createCsv, csvAnnotations, csvKind, CSV_KINDS, ANNOTATION_CSV_HEADER, quote } from '../src/app/annotationCsv'

function annotation(values: Partial<EditableAnnotation> = {}): EditableAnnotation {
  return {
    id: 'new-1', objNum: null, pageIndex: 1, kind: 'freetext', rect: [72, 144, 216, 216],
    text: '引用 "A",\n二行目', fontSize: 10.5, font: 'BIZUDGothic', color: [1, 0, 0],
    borderWidth: 1, opacity: 1, textOpacity: 1, boxOpacity: 1, interiorColor: null,
    borderColor: null, line: null, inkList: null, quads: null, calloutPoint: null, calloutLine: null,
    symbol: null, layout: null, dirty: true, madeByKaru: true, ...values,
  }
}

describe('書き込み一覧 CSV', () => {
  it.each<[Issue['status'], string, string]>([
    ['open', '未回答', '#FF0000'], ['answered', '回答済み', '#0040FF'],
    ['revised', '回答済み', '#0040FF'], ['done', '回答済み', '#0040FF'], ['confirmed', '修正確認', '#808080'],
  ])('%s の状態・色の列を共通の読み替えで出力する', (status, label, color) => {
    const item = annotation({ kind: 'issue', text: '確認', color: [0, 1, 0], issue: { number: 1, status } })
    for (const csv of [createIssueCsv([item]), createCsv([item], ['issue', 'text'])]) {
      const row = csv.split('\r\n')[1]
      expect(row).toContain(`,確認,${color},`)
      expect(row).toMatch(new RegExp(`,${label},,,,,$`))
    }
    expect(item.issue!.status).toBe(status)
  })
  it('旧対応済・修正済は未確認に含め、修正確認だけのCSVから除く', () => {
    const items = (['open', 'answered', 'revised', 'done', 'confirmed'] as const).map((status, index) =>
      annotation({ kind: 'issue', issue: { number: index + 1, status } }))
    expect(csvAnnotations(items, ['issue'], { issueStatus: 'open' }).map(a => a.issue!.status)).toEqual(['open', 'answered', 'revised', 'done'])
    expect(csvAnnotations(items, ['issue'], { issueStatus: 'confirmed' }).map(a => a.issue!.status)).toEqual(['confirmed'])
  })
  it('旧版の変更記録を指摘・全種類のCSVから除外する', () => {
    const issue=annotation({kind:'issue',text:'電源を確認',issue:{number:1,status:'open',id:'issue-1'}})
    const change=annotation({kind:'issue',text:'位置を変更',issue:{number:2,status:'revised',id:'change-2',recordKind:'change',changeReason:'=設備干渉',relatedIssueId:'issue-1'}})
    expect(createIssueCsv([issue,change])).toContain('電源を確認')
    expect(createIssueCsv([issue,change])).not.toContain('位置を変更')
    expect(createAnnotationCsv([issue,change])).not.toContain('位置を変更')
    expect(createAnnotationCsv([annotation({ legacyChange: true, kind: 'issue', text: '旧変更' })])).not.toContain('旧変更')
  })
  it.each(['=1+1', '+SUM(1)', '-1+1', '@SUM(1)', '  =1+1', '\t=1+1', '\r=1+1', '\n=1+1', '＝1+1'])('文字列 %j を数式ではなく文字として出力する', text => {
    const item = annotation({ text })
    expect(createAnnotationCsv([item])).toContain("'" + text.replace(/\r?\n/g, '\r\n'))
    const issue = annotation({ text, kind: 'issue', issue: { number: 1, status: 'open' } })
    expect(createIssueCsv([issue])).toContain("'" + text.replace(/\r?\n/g, '\r\n'))
    expect(createIssueCsv([issue])).toContain('\r\n指摘,1,2,')
  })
  it('BOM、CRLF、クォート、mm座標と大きさを出力する', () => {
    const csv = createAnnotationCsv([annotation()])
    expect(csv.charCodeAt(0)).toBe(0xFEFF)
    expect(csv.replace(/\r\n/g, '')).not.toContain('\n')
    expect(csv).toContain('"引用 ""A"",\r\n二行目"')
    expect(csv).toContain('"25.40, 50.80"')
    expect(csv).toContain('"50.80, 25.40"')
    expect(csv).toContain('#FF0000')
  })

  it('指摘以外の番号欄は空欄で、ページ・上・左の順に出力する', () => {
    const csv = createAnnotationCsv([
      annotation({ id: 'later', pageIndex: 1, rect: [0, 200, 10, 210], text: '後' }),
      annotation({ id: 'first', pageIndex: 0, rect: [0, 100, 10, 110], text: '先' }),
    ])
    const lines = csv.slice(1).split('\r\n')
    expect(lines[1]).toContain('文字,,1,,先')
    expect(lines[2]).toContain('文字,,2,,後')
  })

  it('文字への印を区別できる種類名で出力する', () => {
    const csv = createAnnotationCsv([
      annotation({ kind: 'textHighlight', text: '黄色' }),
      annotation({ kind: 'underline', text: '下線' }),
      annotation({ kind: 'strikeout', text: '取消' }),
    ])
    expect(csv).toContain('文字ハイライト,,2,,黄色,')
    expect(csv).toContain('文字に下線,,2,,下線,')
    expect(csv).toContain('文字に取り消し線,,2,,取消,')
  })

  it('選択した種類だけの列と行を、種類順・指摘番号順で出す', () => {
    const items = [annotation({ text: '文字' }), annotation({ kind: 'issue', text: '十二', issue: { number: 12, status: 'open', sourceNumber: 8, sourceDocument: '=旧.pdf', drawingNumber: 'E-01', discipline: '電気' } }),
      annotation({ kind: 'issue', text: '二', issue: { number: 2, status: 'confirmed' } }), annotation({ kind: 'symbol', count: { version: 1, id: 'count', group: '照明' }, text: '' })]
    const text = createCsv(items, ['text'])
    expect(text.split('\r\n')[0]).toBe('\uFEFF' + ANNOTATION_CSV_HEADER.map(quote).join(','))
    const mixed = createCsv(items, ['text', 'issue'])
    expect(mixed.split('\r\n')[0]).toContain('状態,分野,回答,修正確認,引継ぎ元番号,引継ぎ元文書')
    expect(mixed.split('\r\n')[0]).not.toContain('縮尺')
    expect(mixed.split('\r\n')[0]).not.toContain('個数の種類')
    expect(mixed).toContain("8,'=旧.pdf")
    expect(mixed).not.toContain('№')
    expect(mixed.indexOf('指摘,2,')).toBeLessThan(mixed.indexOf('指摘,12,'))
    expect(mixed.indexOf('指摘,12,')).toBeLessThan(mixed.indexOf('文字,,2,'))
    const count = createCsv(items, ['count'])
    expect(count.split('\r\n')[0]).toContain('名称,略号,分類')
    expect(count.split('\r\n')[0]).not.toContain('状態')
    expect(count).toContain('数量拾い,,2,,')
    expect(count).toContain(',照明,,その他,,\r\n')
    const measure = createCsv(items, ['measure'])
    expect(measure.split('\r\n')[0]).toContain('縮尺')
    expect(measure.split('\r\n')[0]).not.toContain('個数の種類')
    expect(csvAnnotations(items, CSV_KINDS, { firstPage: 2, lastPage: 2, issueStatus: 'confirmed' }).filter(a => a.issue).map(a => a.issue!.number)).toEqual([2])
    expect(csvAnnotations(items, ['issue'], { issueStatus: 'open' }).map(a => a.issue!.number)).toEqual([12])
    expect(csvAnnotations(items, CSV_KINDS, { firstPage: 3 })).toEqual([])
    expect(csvAnnotations(items, [])).toEqual([])
  })

  it('全種類を指定順にまとめ、各種類の非該当列は空欄にする', () => {
    const items = [
      annotation({ kind: 'underline', text: '印' }), annotation({ kind: 'ink', text: '' }), annotation({ kind: 'symbol', text: '' }),
      annotation({ kind: 'square', text: '' }), annotation({ kind: 'distance', text: '100 mm', measure: { kind: 'distance', unit: 'mm', decimals: 0, mmPerPoint: 100*25.4/72 } }),
      annotation({ kind: 'callout', text: '吹き出し' }), annotation({ kind: 'freetext', text: '文字' }),
      annotation({ kind: 'symbol', text: '', count: { version: 1, id: 'count', group: '照明' } }),
      annotation({ kind: 'issue', text: '指摘本文', issue: { number: 12, status: 'open', discipline: '電気', drawingNumber: 'E-01' } }),
    ]
    expect(csvAnnotations(items, CSV_KINDS).map(csvKind)).toEqual([...CSV_KINDS])
    const csv = createCsv(items, CSV_KINDS), rows = csv.split('\r\n')
    expect(rows[0]).toContain('引継ぎ元文書,縮尺,名称,略号,分類')
    expect(rows[1]).toContain('指摘,12,2,E-01,指摘本文')
    expect(rows[1]).toMatch(/未回答,電気,,,,,,,,,,\r?$/)
    expect(rows[2]).toMatch(/,,,,,,,照明,,その他,,$/)
    expect(rows[5]).toContain('距離,,2,,100 mm,')
    expect(rows[5]).toMatch(/,,,,,,,約 1\/100,,,,,$/)
    expect(rows[8]).toMatch(/,,,,,,,,,,,,$/)
    const left = annotation({ id: 'left', text: '左', pageIndex: 0, rect: [10,100,20,110] })
    const right = annotation({ id: 'right', text: '右', pageIndex: 0, rect: [30,100,40,110] })
    expect(csvAnnotations([right,left], ['text']).map(a => a.id)).toEqual(['left','right'])
  })
})

it('exports mixed counts and length quantities with units, fixed decimals and scale', () => {
 const fixtures: CountFixture[] = [{ id: 'dl', code: 'DL', name: '照明', category: '電気', order: 0, style: nextCountStyle([]) }, { id: 'cv', code: 'CV', name: 'ケーブル（CV）', category: '電線・ケーブル', order: 1, style: nextCountStyle([]), kind: 'length' }]
 const q = annotation({ kind: 'perimeter', pageIndex: 0, text: 'CV 2.54+3.00=5.54 m', quantity: { version: 1, id: 'q', itemId: 'cv', method: 'polyline', addM: 3 }, vertices: [[0,0],[72,0]], measure: { kind: 'perimeter', mmPerPoint: 25.4/72*100, unit: 'mm', decimals: null } })
 const c = annotation({ kind: 'symbol', pageIndex: 0, count: { version: 2, id: 'c', fixtureId: 'dl' } })
 const csv = createCountCsv([c,q], fixtures, 0)
 expect(csv).toContain('分類,略号,名称,規格,施工条件,集計区分,種別,単位,集計方式,平面,立上り・立下り,その他の加算,全図面の合計,表示中の図面（p.1）,p.1')
 expect(csv).toContain('電気,DL,照明,,,施工条件別,個数,個,場所別,,,,1,1,1')
 expect(csv).toContain('電線・ケーブル,CV,ケーブル（CV）,,,施工条件別,長さ,m,全図面,2.54,3.00,0.00,5.54,5.54,5.54')
 expect(csvAnnotations([q], ['measure'])).toHaveLength(0)
 expect(createCsv([q], ['count'], { fixtures })).toContain('数量拾い（長さ）,,1,,CV 2.54+3.00=5.54 m')
 expect(createCsv([q], ['count'], { fixtures })).toContain('約 1/100,ケーブル（CV）,CV,電線・ケーブル')
})

it('exports area and volume quantities per page and overall with the correct kind and unit', () => {
 const fixtures: CountFixture[] = [
  { id: 'area', code: '内部足場', name: '内部足場（囲む）', category: '仮設', kind: 'area', method: 'polygon', order: 0, style: nextCountStyle([]) },
  { id: 'volume', code: '根切り', name: '根切り（囲む×深さ）', category: '土工', kind: 'volume', method: 'polygonDepth', order: 1, style: nextCountStyle([]) },
 ]
 const vertices: [number, number][] = [[0,0],[72,0],[72,72],[0,72]]
 const area = annotation({ pageIndex: 0, kind: 'area', vertices, measure: { kind: 'area', mmPerPoint: 25.4/72*100, unit: 'mm', decimals: null }, quantity: { version: 1, id: 'a', itemId: 'area', method: 'polygon' } })
 const volume = annotation({ ...area, pageIndex: 1, quantity: { version: 1, id: 'v', itemId: 'volume', method: 'polygonDepth', depthM: 1.2 } })
 const csv = createCountCsv([area, { ...area, pageIndex: 1 }, volume], fixtures, 0)
 expect(csv).toContain('仮設,内部足場,内部足場（囲む）,,,施工条件別,面積,m²,全図面,,,,12.90,6.45,6.45,6.45')
 expect(csv).toContain('土工,根切り,根切り（囲む×深さ）,,,施工条件別,体積,m³,全図面,,,,7.74,0.00,0.00,7.74')
 expect(createCsv([area,volume], ['count'], { fixtures })).toContain('数量拾い（面積）')
 expect(createCsv([area,volume], ['count'], { fixtures })).toContain('数量拾い（体積）')
})
