import { describe, expect, it, vi } from 'vitest'
import mupdf from 'mupdf'
import {
  CHECK_BASICS,
  CHECK_QUANTITY_GROUPS,
  type CheckQuantityGroup,
} from '../src/core/breakdown/checkSheets'
import {
  computeQuantityChecks,
  matchesQuantityCheckGroup,
  normalizeCheckUnit,
  parseQuantityCheckBasics,
  serializeQuantityCheckBasics,
  suggestCheckBasics,
  type QuantityCheckBasics,
} from '../src/core/quantityChecks'
import {
  readQuantityChecks,
  writeQuantityChecks,
} from '../src/core/quantityCheckBasics'
import { applyEdits } from '../src/core/annotations'
import type { CountFixture } from '../src/core/countFixtures'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { DocumentSession } from '../src/app/documentModel'
import {
  buildQuantityTableData,
  projectQuantityTable,
} from '../src/app/QuantityTable'
import {
  quantityWorkbookSheets,
  type QuantityWorkbookOptions,
} from '../src/app/quantityXlsx'

function fixture(
  id: string,
  name: string,
  subject: string,
  kind: CountFixture['kind'] = 'volume',
  extra: Partial<CountFixture> = {},
): CountFixture {
  return {
    id, name, code: id.toUpperCase(), category: subject, order: 0, kind,
    style: {
      shape: 'circle', fill: 'none', color: [1, 0, 0],
      size: 10, opacity: 1, showCode: true,
    },
    breakdown: {
      book: '建築', section: '庁舎', subject, middle: '躯体', item: name,
    },
    ...extra,
  }
}

const concreteFixtures = () => [
  fixture('body', '普通コンクリート（軸部）', 'コンクリート'),
  fixture('foundation', '普通コンクリート（基礎部）', 'コンクリート'),
  fixture('rebar', '鉄筋加工組立', '鉄筋', 'volume', {
    convert: { factor: 1, unit: 't', basis: '試験用の換算' },
  }),
]

function resultsFor(
  fixtures: CountFixture[],
  quantities: Record<string, number>,
  basics: QuantityCheckBasics = { values: {} },
) {
  const results = computeQuantityChecks(
    fixtures, id => quantities[id] ?? 0, basics,
  )
  return (id: string) => {
    const result = results.find(value => value.row.id === id)
    if (!result) throw new Error(`試験対象の行がありません：${id}`)
    return result
  }
}

describe('quantityChecks', () => {
  it('コンクリート総量・基礎部・軸部と鉄筋の両方の基準を判定する', () => {
    const result = resultsFor(
      concreteFixtures(),
      { body: 650, foundation: 300, rebar: 130 },
      { values: { totalFloorArea: 1000 } },
    )
    expect(result('concrete')).toMatchObject({
      quantity: 950, basis: 1000,
      expected: { min: 800, max: 1000 }, verdict: 'ok',
    })
    expect(result('concreteFoundation')).toMatchObject({
      quantity: 300, expected: { min: 200, max: 500 }, verdict: 'ok',
    })
    expect(result('concreteBody')).toMatchObject({
      quantity: 650, expected: { min: 500, max: 800 }, verdict: 'ok',
    })
    expect(result('rebarByArea')).toMatchObject({
      quantity: 130, expected: { min: 100, max: 140 }, verdict: 'ok',
    })
    expect(result('rebarByConcrete')).toMatchObject({
      quantity: 130, basis: 950,
      expected: { min: 123.5, max: 152 }, verdict: 'ok',
    })
    expect(result('concrete').items).toEqual([
      {
        id: 'body', code: 'BODY',
        name: '普通コンクリート（軸部）', total: 650,
      },
      {
        id: 'foundation', code: 'FOUNDATION',
        name: '普通コンクリート（基礎部）', total: 300,
      },
    ])
  })

  it('延べ面積がなくても数量を基準にする行は判定できる', () => {
    const result = resultsFor(
      concreteFixtures(), { body: 650, foundation: 300, rebar: 130 },
    )
    expect(result('concrete')).toMatchObject({
      quantity: 950, basis: undefined, expected: undefined, verdict: 'noBasis',
    })
    expect(result('rebarByArea').verdict).toBe('noBasis')
    expect(result('rebarByConcrete').verdict).toBe('ok')
  })

  it('範囲の上下端を含み、外側を範囲外にする', () => {
    const fixtures = [concreteFixtures()[0]]
    const basics = { values: { totalFloorArea: 1000 } }
    expect(resultsFor(fixtures, { body: 800 }, basics)('concrete').verdict).toBe('ok')
    expect(resultsFor(fixtures, { body: 1000 }, basics)('concrete').verdict).toBe('ok')
    expect(resultsFor(fixtures, { body: 799 }, basics)('concrete').verdict).toBe('out')
    expect(resultsFor(fixtures, { body: 1001 }, basics)('concrete').verdict).toBe('out')
  })

  it('一致する項目がない場合と、数量0の項目を区別する', () => {
    const missing = resultsFor([], {}, { values: { totalFloorArea: 0 } })
    expect(missing('concrete')).toMatchObject({
      quantity: undefined, items: [], verdict: 'noQuantity',
    })
    const zero = resultsFor(
      [concreteFixtures()[0]], { body: 0 }, { values: { totalFloorArea: 0 } },
    )
    expect(zero('concrete')).toMatchObject({
      quantity: 0, expected: { min: 0, max: 0 }, verdict: 'ok',
    })
    expect(resultsFor([], {})('concrete').verdict).toBe('noQuantity')
  })

  it('根切りと埋戻し・建設発生土処分の収支を±1%で判定する', () => {
    const fixtures = [
      fixture('excavation', '根切り', '土工'),
      fixture('backfill', '埋戻し', '土工'),
      fixture('surplus', '建設発生土処分', '土工'),
    ]
    const result = (excavation: number) => resultsFor(fixtures, {
      excavation, backfill: 40, surplus: 60,
    })('soilBalance')
    expect(result(100)).toMatchObject({
      basis: 100, expected: { min: 99, max: 101 }, verdict: 'ok',
    })
    expect(result(99).verdict).toBe('ok')
    expect(result(101).verdict).toBe('ok')
    expect(result(98.99).verdict).toBe('out')
    expect(result(101.01).verdict).toBe('out')
    expect(resultsFor(fixtures.slice(0, 2), {
      excavation: 100, backfill: 40,
    })('soilBalance').verdict).toBe('noBasis')
  })

  it('近似は±10%、以上は下限を含む', () => {
    const fixtures = [
      fixture('scaffold', '枠組本足場', '直接仮設', 'area'),
      fixture('marking', '墨出し', '直接仮設', 'area'),
    ]
    const basics = {
      values: { perimeter: 12, parapetHeight: 5, totalFloorArea: 100 },
    }
    const check = (scaffold: number, marking: number) =>
      resultsFor(fixtures, { scaffold, marking }, basics)
    expect(check(90, 100)('outerScaffold')).toMatchObject({
      basis: 100, verdict: 'ok',
    })
    expect(check(110, 100)('outerScaffold').verdict).toBe('ok')
    expect(check(89, 99)('outerScaffold').verdict).toBe('out')
    expect(check(100, 99)('marking').verdict).toBe('out')
    expect(check(100, 100)('marking').verdict).toBe('ok')
  })

  it('単位違いを根拠から除き、名前をskippedUnitsへ記録する', () => {
    const fixtures = [
      concreteFixtures()[0],
      fixture('wrong-unit', '普通コンクリート（軸部）面積', 'コンクリート', 'area'),
      fixture('electrical', '普通コンクリート（軸部）', 'コンクリート', 'volume', {
        breakdown: {
          book: '電気設備', section: '庁舎',
          subject: 'コンクリート', middle: '躯体', item: '対象外',
        },
      }),
      fixture('outside', '普通コンクリート（軸部）', 'コンクリート', 'volume', {
        breakdown: {
          book: '建築', section: '屋外', subject: 'コンクリート',
          middle: '躯体', item: '対象外',
        },
      }),
      fixture('transport', 'コンクリート運搬', 'コンクリート'),
    ]
    const total = vi.fn((id: string) => id === 'body' ? 650 : 10000)
    const result = computeQuantityChecks(
      fixtures, total, { values: { totalFloorArea: 1000 } },
    ).find(row => row.row.id === 'concrete')!
    expect(result.quantity).toBe(650)
    expect(result.items.map(item => item.id)).toEqual(['body'])
    expect(result.skippedUnits).toEqual(['普通コンクリート（軸部）面積'])
    expect(total.mock.calls.map(([id]) => id)).toEqual(['body'])
  })

  it('名前条件のORとAND、種目・科目・中科目・除外を組み合わせる', () => {
    const group: CheckQuantityGroup = {
      id: 'test', label: '試験', unit: '㎡',
      sections: ['庁舎'], subjects: ['内外装'], middles: ['内部'],
      names: ['壁主仕上'], nameIncludes: ['塗装'],
      nameStartsWith: ['壁'], nameExcludes: ['下地'],
    }
    const make = (name: string) => fixture(name, name, '内外装', 'area', {
      breakdown: {
        book: '建築', section: '庁舎', subject: '内外装',
        middle: '内部', item: name,
      },
    })
    expect(matchesQuantityCheckGroup(make('壁主仕上'), group)).toBe(true)
    expect(matchesQuantityCheckGroup(make('壁塗装'), group)).toBe(true)
    expect(matchesQuantityCheckGroup(make('床塗装'), group)).toBe(false)
    expect(matchesQuantityCheckGroup(make('壁塗装下地'), group)).toBe(false)
    expect(matchesQuantityCheckGroup(make('壁その他'), group)).toBe(false)
    const wrong = make('壁主仕上')
    wrong.breakdown!.middle = '外部'
    expect(matchesQuantityCheckGroup(wrong, group)).toBe(false)
    wrong.breakdown!.middle = '内部'
    wrong.breakdown!.subject = '塗装'
    expect(matchesQuantityCheckGroup(wrong, group)).toBe(false)
    expect(matchesQuantityCheckGroup(make('壁主仕上'), { ...group, sections: ['屋外'] })).toBe(false)
  })

  it.each([
    ['m²', '㎡'], ['㎡', '㎡'], ['m^2', '㎡'],
    ['m³', '㎥'], ['㎥', '㎥'], ['m^3', '㎥'],
    ['ｍ', 'm'], ['ｔ', 't'], ['箇所', 'か所'], ['ヶ所', 'か所'],
  ])('単位%sを%sにそろえる', (input, expected) => {
    expect(normalizeCheckUnit(input)).toBe(expected)
  })

  it('拾いからの候補は指定された内訳数量の最大値で、欠損は出さない', () => {
    const fixtures = [
      fixture('marking', '墨出し', '直接仮設', 'area'),
      fixture('curing', '養生', '直接仮設', 'area'),
      fixture('setout', '遣方', '直接仮設', 'area'),
      fixture('ground', '地足場', '直接仮設', 'area'),
    ]
    const quantities: Record<string, number> = {
      marking: 1000, curing: 1200, setout: 300, ground: 350,
    }
    expect(suggestCheckBasics(fixtures, id => quantities[id])).toEqual({
      totalFloorArea: 1200, buildingArea: 350,
    })
    expect(suggestCheckBasics([], () => 0)).toEqual({})
    expect(suggestCheckBasics([fixtures[0]], () => 0)).toEqual({
      totalFloorArea: 0,
    })
  })

  it('保存対象の鍵がCHECK_BASICSと一致し、不正値・未知の鍵を捨てる', () => {
    const all = Object.fromEntries(CHECK_BASICS.map(basis => [basis.key, 1]))
    expect(parseQuantityCheckBasics({ version: 1, basics: all }).values).toEqual(all)
    expect(parseQuantityCheckBasics({
      values: {
        buildingArea: 0, totalFloorArea: 1000, perimeter: -1,
        parapetHeight: '20', floorsAbove: NaN, firstFloorArea: Infinity,
        steelFloorArea: null, unknown: 10,
      },
    })).toEqual({ values: { buildingArea: 0, totalFloorArea: 1000 } })
    expect(parseQuantityCheckBasics('{"version":1,"basics":{"perimeter":-2,"buildingArea":3}}'))
      .toEqual({ values: { buildingArea: 3 } })
    for (const raw of [
      null, [], 'broken', { version: 2, basics: all }, { basics: all },
    ]) {
      expect(parseQuantityCheckBasics(raw)).toEqual({ values: {} })
    }
    const basics = { values: { totalFloorArea: 1000, buildingArea: 0 } }
    const serialized = serializeQuantityCheckBasics(basics)
    expect(JSON.parse(serialized)).toEqual({
      version: 1, basics: { buildingArea: 0, totalFloorArea: 1000 },
    })
    expect(parseQuantityCheckBasics(serialized)).toEqual(basics)
  })

  it('基準にする数量の項目がない場合に0として判定しない', () => {
    const fixtures = [concreteFixtures()[2]]
    const result = resultsFor(fixtures, { rebar: 130 })('rebarByConcrete')
    expect(result).toMatchObject({
      quantity: 130, basis: undefined, verdict: 'noBasis',
    })
    expect(CHECK_QUANTITY_GROUPS.some(group => group.id === 'concrete')).toBe(true)
  })
})

describe('QuantityCheckBasicsの保存と履歴', () => {
  it('必要になるまで読み込まず、未読込なら編集を作らない', async () => {
    const store = new AnnotationStore()
    const loader = vi.fn(async () => ({ values: { totalFloorArea: 1000 } }))
    store.setQuantityCheckBasic('totalFloorArea', 2000)
    expect(store.toEdits()).toEqual([])
    expect(store.isDirty()).toBe(false)
    expect(loader).not.toHaveBeenCalled()
    await Promise.all([
      store.ensureQuantityChecks(loader),
      store.ensureQuantityChecks(loader),
    ])
    await store.ensureQuantityChecks(loader)
    expect(loader).toHaveBeenCalledTimes(1)
    expect(store.getQuantityChecks()).toEqual({ values: { totalFloorArea: 1000 } })
    expect(store.toEdits()).toEqual([])
    expect(store.canUndo()).toBe(false)
  })

  it('変更・削除は各1回で取り消せ、数量の索引を作り直さない', async () => {
    const store = new AnnotationStore()
    await store.ensureQuantityChecks(async () => ({ values: {} }))
    const index = store.quantityIndex()
    store.setQuantityCheckBasic('totalFloorArea', 1000)
    expect(store.quantityIndex()).toBe(index)
    expect(store.toEdits()).toEqual([{
      kind: 'setQuantityChecks', pageIndex: 0,
      basics: { values: { totalFloorArea: 1000 } },
    }])
    expect(store.dirtySummary().quantityChecks).toBe(true)
    store.undo()
    expect(store.getQuantityChecks()).toEqual({ values: {} })
    expect(store.isDirty()).toBe(false)
    expect(store.quantityIndex()).toBe(index)
    store.redo()
    expect(store.getQuantityChecks().values.totalFloorArea).toBe(1000)
    store.setQuantityCheckBasic('totalFloorArea', undefined)
    expect(store.getQuantityChecks()).toEqual({ values: {} })
    store.undo()
    expect(store.getQuantityChecks().values.totalFloorArea).toBe(1000)
    const before = store.getQuantityChecks()
    store.setQuantityCheckBasic('totalFloorArea', -1)
    store.setQuantityCheckBasic('totalFloorArea', NaN)
    expect(store.getQuantityChecks()).toEqual(before)
  })

  it('保存中の後続編集と保存失敗を基準値に取り込まない', async () => {
    const store = new AnnotationStore()
    await store.ensureQuantityChecks(async () => ({ values: {} }))
    store.setQuantityCheckBasic('totalFloorArea', 1000)
    store.toEdits()
    store.setQuantityCheckBasic('totalFloorArea', 2000)
    store.markApplied({ created: [] })
    expect(store.isDirty()).toBe(true)
    store.undo()
    expect(store.getQuantityChecks().values.totalFloorArea).toBe(1000)
    expect(store.isDirty()).toBe(false)
    store.redo()
    store.toEdits()
    store.markApplied({ created: [], errors: [{ editIndex: 0 }] })
    expect(store.isDirty()).toBe(true)
    store.toEdits()
    store.markApplied({ created: [] })
    expect(store.isDirty()).toBe(false)
  })

  it('注釈IDの保存時の置換後も基本の値の履歴を保つ', async () => {
    const store = new AnnotationStore()
    await store.ensureQuantityChecks(async () => ({ values: {} }))
    store.create({ pageIndex: 0, kind: 'square', rect: [0, 0, 10, 10] })
    store.setQuantityCheckBasic('totalFloorArea', 1000)
    const edits = store.toEdits()
    expect(edits.map(edit => edit.kind)).toEqual(['createSquare', 'setQuantityChecks'])
    store.markApplied({ created: [20] })
    store.undo()
    expect(store.getQuantityChecks()).toEqual({ values: {} })
    expect(store.get('obj-20')).toBeDefined()
    store.redo()
    expect(store.getQuantityChecks().values.totalFloorArea).toBe(1000)
  })

  it('読込失敗は再試行でき、リセット前の遅い読込を捨てる', async () => {
    const store = new AnnotationStore()
    await expect(store.ensureQuantityChecks(async () => {
      throw new Error('読込失敗')
    })).rejects.toThrow('読込失敗')
    expect(store.quantityChecksReady).toBe(false)

    let resolve!: (value: QuantityCheckBasics) => void
    const loading = store.ensureQuantityChecks(() =>
      new Promise<QuantityCheckBasics>(done => { resolve = done }),
    )
    await Promise.resolve()
    store.reset()
    await store.ensureQuantityChecks(async () => ({ values: { buildingArea: 300 } }))
    resolve({ values: { totalFloorArea: 9999 } })
    await loading
    expect(store.getQuantityChecks()).toEqual({ values: { buildingArea: 300 } })
    expect(store.isDirty()).toBe(false)
  })

  it('PDFのRootへ保存し、ページがなくても編集でき、空なら鍵を消す', () => {
    const doc = new mupdf.PDFDocument()
    try {
      expect(readQuantityChecks(doc)).toEqual({ values: {} })
      const result = applyEdits(doc, [{
        kind: 'setQuantityChecks', pageIndex: 0,
        basics: { values: { totalFloorArea: 1000 } },
      }], {})
      expect(result.errors).toEqual([])
      expect(result.created).toEqual([])
      expect(readQuantityChecks(doc)).toEqual({ values: { totalFloorArea: 1000 } })
      writeQuantityChecks(doc, { values: {} })
      const trailer = doc.getTrailer(), root = trailer.get('Root')
      const raw = root.get('KaruQuantityChecks')
      try { expect(raw.isNull()).toBe(true) }
      finally { raw.destroy(); root.destroy(); trailer.destroy() }
    } finally { doc.destroy() }
  })

  it('PDFを保存して開き直すと基本の値が残る', () => {
    const doc = new mupdf.PDFDocument()
    try {
      const page = doc.addPage([0, 0, 100, 100], 0, {}, '')
      try { doc.insertPage(-1, page) }
      finally { page.destroy() }
      writeQuantityChecks(doc, {
        values: { totalFloorArea: 1000, buildingArea: 300 },
      })
      const buffer = doc.saveToBuffer('compress')
      let bytes: Uint8Array
      try { bytes = new Uint8Array(buffer.asUint8Array()) }
      finally { buffer.destroy() }
      const reopened = new mupdf.PDFDocument(bytes)
      try {
        expect(readQuantityChecks(reopened)).toEqual({
          values: { buildingArea: 300, totalFloorArea: 1000 },
        })
      } finally { reopened.destroy() }
    } finally { doc.destroy() }
  })

  it('基本の値の保存でページの描画・ベクトルを無効にしない', () => {
    const session = new DocumentSession({
      docId: 'checks', name: '試験.pdf', byteLength: 100,
      handle: null, pageSizes: [],
    })
    const clear = vi.spyOn(session.vectorCache, 'clear')
    session.recordSavedRendering([{
      kind: 'setQuantityChecks', pageIndex: 0,
      basics: { values: { totalFloorArea: 1000 } },
    }], [])
    expect(session.savedPageRevisions.size).toBe(0)
    expect(clear).not.toHaveBeenCalled()
  })
})

describe('チェックシートのExcel', () => {
  async function optionsFor(fixtures: CountFixture[]): Promise<QuantityWorkbookOptions> {
    const store = new AnnotationStore()
    await store.ensureCountFixtures(async () => fixtures, async () => {})
    const index = store.quantityIndex()
    return {
      data: buildQuantityTableData(index, fixtures),
      mode: 'page', filters: {}, display: {},
      drawingInfo: () => null, pdfName: '試験.pdf', index, fixtures,
      quantityChecks: { values: { totalFloorArea: 1000 } },
    }
  }

  it('最後にチェックシートを追加し、基本の値と上下限を数値で出す', async () => {
    const options = await optionsFor([concreteFixtures()[0]])
    const sheets = quantityWorkbookSheets(options)
    const checks = sheets[sheets.length - 1]
    expect(checks.name).toBe('チェックシート')
    const basics = checks.cells.find(row => row[0]?.value === '延べ面積')!
    expect(basics[1].value).toBe(1000)
    expect(basics[2].value).toBe('㎡')
    const row = checks.cells.find(row => row[1]?.value === 'コンクリート総量')!
    expect(row.map(value => value.value)).toEqual([
      '躯体', 'コンクリート総量', 0, '㎥', '∈',
      '延べ面積 ×（0.8）〜（1.0）', 800, 1000, '範囲外', '',
    ])
    expect(row[2].style).toBe('borderedDecimal')
    expect(typeof row[6].value).toBe('number')
    expect(typeof row[7].value).toBe('number')
  })

  it('建築の項目がなければシートも既存の集計も変えない', async () => {
    const electrical = fixture('electrical', '盤', '配電', 'count', {
      breakdown: {
        book: '電気設備', section: '庁舎', subject: '配電', item: '盤',
      },
    })
    const options = await optionsFor([electrical])
    const withBasics = quantityWorkbookSheets(options)
    const withoutBasics = quantityWorkbookSheets({
      ...options, quantityChecks: undefined,
    })
    expect(withBasics.some(sheet => sheet.name === 'チェックシート')).toBe(false)
    expect(withBasics).toEqual(withoutBasics)
    const projected = projectQuantityTable(
      options.data, 'page', {}, () => null,
    )
    expect(projected.rows.filter(row => row.item).length).toBe(1)
  })
})
