import { describe, expect, it } from 'vitest'
import type { EditableAnnotation } from '../src/editor/AnnotationStore'
import { createAnnotationCsv, createIssueCsv, createChangeCsv } from '../src/app/annotationCsv'

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
  it('指摘と変更のCSVを区別し、変更理由と関連IDを出力する', () => {
    const issue=annotation({kind:'issue',text:'電源を確認',issue:{number:1,status:'open',id:'issue-1'}})
    const change=annotation({kind:'issue',text:'位置を変更',issue:{number:2,status:'revised',id:'change-2',recordKind:'change',changeReason:'=設備干渉',relatedIssueId:'issue-1'}})
    expect(createIssueCsv([issue,change])).toContain('電源を確認')
    expect(createIssueCsv([issue,change])).not.toContain('位置を変更')
    expect(createChangeCsv([issue,change])).toContain("位置を変更,'=設備干渉,issue-1,修正済")
    expect(createChangeCsv([issue,change])).not.toContain('電源を確認')
  })
  it.each(['=1+1', '+SUM(1)', '-1+1', '@SUM(1)', '  =1+1', '\t=1+1', '\r=1+1', '\n=1+1', '＝1+1'])('文字列 %j を数式ではなく文字として出力する', text => {
    const item = annotation({ text })
    expect(createAnnotationCsv([item])).toContain("'" + text.replace(/\r?\n/g, '\r\n'))
    const issue = annotation({ text, kind: 'issue', issue: { number: 1, status: 'open' } })
    expect(createIssueCsv([issue])).toContain("'" + text.replace(/\r?\n/g, '\r\n'))
    expect(createIssueCsv([issue])).toContain('\r\n1,2,')
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

  it('ページ順、上から順に番号を付ける', () => {
    const csv = createAnnotationCsv([
      annotation({ id: 'later', pageIndex: 1, rect: [0, 200, 10, 210], text: '後' }),
      annotation({ id: 'first', pageIndex: 0, rect: [0, 100, 10, 110], text: '先' }),
    ])
    const lines = csv.slice(1).split('\r\n')
    expect(lines[1]).toContain('1,1,文字,先')
    expect(lines[2]).toContain('2,2,文字,後')
  })

  it('文字への印を区別できる種類名で出力する', () => {
    const csv = createAnnotationCsv([
      annotation({ kind: 'textHighlight', text: '黄色' }),
      annotation({ kind: 'underline', text: '下線' }),
      annotation({ kind: 'strikeout', text: '取消' }),
    ])
    expect(csv).toContain(',文字ハイライト,黄色,')
    expect(csv).toContain(',文字に下線,下線,')
    expect(csv).toContain(',文字に取り消し線,取消,')
  })
})
