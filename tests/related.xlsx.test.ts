import { describe, expect, it } from 'vitest'
import type { CountFixture } from '../src/core/countFixtures'
import type { QuantityIndex } from '../src/core/quantityIndex'
import type { RelatedReviews } from '../src/core/related/reviews'
import type { RelatedSuggestion } from '../src/core/related/suggest'
import type { XlsxCell, XlsxSheet } from '../src/core/xlsxWriter'
import { QUANTITY_DETAIL_HEADER } from '../src/app/annotationCsv'
import type { RelatedModel } from '../src/app/relatedModel'
import { buildRelatedReviewRows } from '../src/app/relatedReviewRows'
import {
  quantityWorkbookSheets,
  type QuantityWorkbookOptions,
} from '../src/app/quantityXlsx'
import {
  relatedReviewSheet,
  type RelatedReviewRow,
} from '../src/app/relatedXlsx'

function row(
  status: RelatedReviewRow['status'],
  target: string = status,
): RelatedReviewRow {
  return {
    status,
    origins: 'AC-1 空調機',
    target,
    kind: '拾い候補',
    question: '接続先を確認してください',
    assignee: status === '他工事' ? '機械設備' : '',
    reason: '試験用の理由',
    ruleIds: 'E-001、E-002',
    refs: 'A：試験資料',
    decidedAt: status === '未判断' ? '' : '2026-10-14T00:00:00.000Z',
  }
}

const emptyIndex = {
  entries: () => [],
  byPage: () => new Map<number, number>(),
  total: () => 0,
  linkResult: () => undefined,
} as unknown as QuantityIndex

function options(
  mode: QuantityWorkbookOptions['mode'] = 'page',
): QuantityWorkbookOptions {
  return {
    data: [],
    mode,
    filters: {},
    display: {},
    drawingInfo: () => null,
    pdfName: '関連試験.pdf',
    index: emptyIndex,
    fixtures: [],
  }
}

function cell(
  value: XlsxCell['value'],
  style: XlsxCell['style'] = 'text',
): XlsxCell {
  return { value, style }
}

/** 提示された改修前 quantityWorkbookSheets の空文書出力を固定する。 */

function suggestion(
  key: string,
  patch: Partial<RelatedSuggestion> = {},
): RelatedSuggestion {
  return {
    key,
    kind: 'item',
    ruleIds: ['E-001'],
    originFixtureIds: [],
    book: '建築',
    priority: '中',
    targets: [],
    targetTexts: ['提案品目'],
    questions: ['確認事項'],
    notes: [],
    refs: [],
    registeredCount: 0,
    flags: {},
    ...patch,
  }
}

describe('relatedReviewSheet', () => {
  it('writes the title, note, ordered columns and check-sheet style layout', () => {
    const source = row('他工事')
    const sheet = relatedReviewSheet([source])
    expect(sheet.name).toBe('関連候補の確認')
    expect(sheet.cells[0]).toEqual([cell('関連候補の確認', 'title')])
    expect(sheet.cells[1]).toEqual([
      cell('提案は拾い漏れの確認用で、別途計上の根拠ではありません'),
    ])
    expect(sheet.cells[2]).toEqual([])
    expect(sheet.cells[3]).toEqual([
      '状態',
      '起点の項目（略号・名称）',
      '提案品目',
      '種類',
      '確認事項',
      '担当',
      '理由',
      'ルールID',
      '根拠資料（記号：資料名）',
      '判断日時',
    ].map(value => cell(value, 'header')))
    expect(sheet.cells[4]).toEqual([
      '他工事',
      'AC-1 空調機',
      '他工事',
      '拾い候補',
      '接続先を確認してください',
      '機械設備',
      '試験用の理由',
      'E-001、E-002',
      'A：試験資料',
      '2026-10-14T00:00:00.000Z',
    ].map(value => cell(value, 'borderedText')))
    expect(sheet.columnWidths).toEqual([14, 38, 38, 14, 66, 16, 40, 24, 66, 26])
    expect(sheet.rowHeights).toEqual({ 0: 24, 1: 30, 2: 10, 3: 30 })
    expect(sheet.freeze).toEqual({ rows: 4, columns: 2 })
    expect(sheet.merges).toEqual([
      { firstRow: 0, firstColumn: 0, lastRow: 0, lastColumn: 9 },
      { firstRow: 1, firstColumn: 0, lastRow: 1, lastColumn: 9 },
    ])
  })

  it('orders pending, later and decided rows stably without changing the input', () => {
    const statuses: RelatedReviewRow['status'][] = [
      '不要', '後で確認', '未判断', '他工事', '未判断',
      '必要', '後で確認', '単価包含', '構成要素で拾う', '確認した',
      '注意', '選択済み', '注意', '選択済み',
    ]
    const rows = statuses.map((status, index) => row(status, `品目${index}`))
    const before = rows.map(value => ({ ...value }))
    const sheet = relatedReviewSheet(rows)
    expect(sheet.cells.slice(4).map(value => value[2].value)).toEqual([
      '品目2', '品目4',
      '品目1', '品目6',
      '品目0', '品目3', '品目5', '品目7', '品目8', '品目9',
      '品目11', '品目13',
      '品目10', '品目12',
    ])
    expect(rows).toEqual(before)
  })

  it('retains a header-only sheet when an empty array is explicitly supplied', () => {
    expect(relatedReviewSheet([]).cells).toHaveLength(4)
  })
})

describe('quantityWorkbookSheets related reviews', () => {
  it.each([
    ['page', '図面別'],
    ['floor', '階別'],
    ['room', '階・部屋別'],
  ] as const)('keeps the original sheet array when omitted in %s mode', (mode, _label) => {
    // 省略時は関連のシートを足さず、明示の undefined と同じ（既存のシートの配列のまま）
    const sheets = quantityWorkbookSheets(options(mode))
    expect(sheets).toEqual(quantityWorkbookSheets({ ...options(mode), relatedReviews: undefined }))
    expect(sheets.map(sheet => sheet.name)).not.toContain('関連候補の確認')
  })

  it('adds exactly one final sheet and leaves every existing sheet equal', () => {
    const baseOptions = options()
    const before = quantityWorkbookSheets(baseOptions)
    const relatedReviews = [row('他工事'), row('未判断')]
    const after = quantityWorkbookSheets({ ...baseOptions, relatedReviews })
    expect(after).toHaveLength(before.length + 1)
    expect(after.slice(0, -1)).toEqual(before)
    expect(after[after.length - 1]).toEqual(relatedReviewSheet(relatedReviews))
  })

  it('distinguishes an omitted option from an explicitly supplied empty array', () => {
    const before = quantityWorkbookSheets(options())
    const after = quantityWorkbookSheets({ ...options(), relatedReviews: [] })
    expect(after.slice(0, -1)).toEqual(before)
    expect(after[after.length - 1]).toEqual(relatedReviewSheet([]))
  })
})

describe('buildRelatedReviewRows', () => {
  const model: RelatedModel = {
    index: {} as RelatedModel['index'],
    resolveTarget: () => [],
    refDocuments: { 建築: { A: '試験資料' } },
  }

  it('maps origins, references, assignees and confirmed checks without quantity rows', () => {
    const fixtures = [{
      id: 'origin', code: 'AC-1', name: '空調機',
    }] as unknown as CountFixture[]
    const reviews: RelatedReviews = {
      version: 1,
      works: {},
      decisions: {
        other: {
          decision: '他工事',
          assignee: '機械設備',
          ruleIds: ['E-002'],
          originFixtureIds: ['missing'],
          reason: '機械設備で確認',
          rulesVersion: 'older-version',
          decidedAt: '2026-10-14T00:00:00.000Z',
        },
        check: {
          decision: '必要',
          ruleIds: ['E-003'],
          originFixtureIds: [],
          rulesVersion: 'test-version',
          decidedAt: '2026-10-14T01:00:00.000Z',
        },
      },
    }
    const rows = buildRelatedReviewRows([
      suggestion('other', {
        originFixtureIds: ['origin'],
        refs: ['A'],
        questions: ['確認1', '確認2'],
      }),
      suggestion('pending'),
      suggestion('hint', { kind: 'hint' }),
    ], [
      suggestion('check', { kind: 'check', ruleIds: ['E-003'] }),
    ], reviews, fixtures, model)
    expect(rows).toHaveLength(3)
    expect(rows.find(value => value.status === '他工事')).toEqual({
      status: '他工事',
      origins: 'AC-1 空調機、起点なし',
      target: '提案品目',
      kind: '拾い候補',
      question: '確認1\n確認2',
      assignee: '機械設備',
      reason: '機械設備で確認',
      ruleIds: 'E-001、E-002',
      refs: 'A：試験資料',
      decidedAt: '2026-10-14T00:00:00.000Z',
    })
    expect(rows.find(value => value.status === '未判断')).toMatchObject({
      origins: '起点なし',
      assignee: '',
      decidedAt: '',
    })
    expect(rows.find(value => value.status === '確認した')).toMatchObject({
      kind: '確認事項',
      origins: '起点なし',
      assignee: '',
    })
  })

  it('exports registered candidates and deduplicated notes after review rows', () => {
    const reviews: RelatedReviews = {
      version: 1, works: {}, decisions: {
        'check:later': {
          decision: '後で確認', ruleIds: ['E-002'], originFixtureIds: [],
          rulesVersion: 'test', decidedAt: '2026-10-14T00:00:00.000Z',
        },
        'check:decided': {
          decision: '不要', ruleIds: ['E-003'], originFixtureIds: [],
          rulesVersion: 'test', decidedAt: '2026-10-14T00:00:00.000Z',
        },
      },
    }
    const note = suggestion('note:notice', {
      kind: 'note', ruleIds: ['N-001'], targetTexts: ['注意品目'],
      originFixtureIds: ['f1'], questions: ['単価包含を確認'], refs: ['A'],
    })
    const rows = buildRelatedReviewRows([
      note,
      suggestion('check:registered', {
        kind: 'check', registeredCount: 1, flags: { registered: true },
      }),
      suggestion('check:decided', { kind: 'check' }),
      suggestion('check:later', { kind: 'check' }),
      suggestion('item:pending'),
    ], [
      { ...note, originFixtureIds: ['f2'] },
    ], reviews, [
      { id: 'f1', code: 'A', name: '起点1' },
      { id: 'f2', code: 'B', name: '起点2' },
    ] as CountFixture[], model)
    expect(rows.map(value => value.status)).toEqual([
      '未判断', '後で確認', '不要', '選択済み', '注意',
    ])
    expect(rows.filter(value => value.status === '注意')).toEqual([{
      status: '注意', kind: '注意', target: '注意品目',
      origins: 'A 起点1、B 起点2', question: '単価包含を確認',
      assignee: '', reason: '', ruleIds: 'N-001',
      refs: 'A：試験資料', decidedAt: '',
    }])
    expect(rows.find(value => value.status === '選択済み')).toMatchObject({
      kind: '確認事項', decidedAt: '', assignee: '',
    })
  })

  it('keeps historical decisions whose origins and current candidates are absent', () => {
    const reviews: RelatedReviews = {
      version: 1,
      works: {},
      decisions: {
        'item:historical': {
          decision: '他工事',
          assignee: '建築',
          ruleIds: ['E-001'],
          originFixtureIds: ['deleted'],
          rulesVersion: 'older-version',
          decidedAt: '2026-10-14T00:00:00.000Z',
        },
      },
    }
    expect(buildRelatedReviewRows([], [], reviews, [], model)).toEqual([{
      status: '他工事',
      origins: '起点なし',
      target: '保存済みの判断（E-001）',
      kind: '拾い候補',
      question: '現在の表示条件では候補に出ていません。保存済みの判断を変更・取消できます。',
      assignee: '建築',
      reason: '',
      ruleIds: 'E-001',
      refs: '',
      decidedAt: '2026-10-14T00:00:00.000Z',
    }])
  })
})
