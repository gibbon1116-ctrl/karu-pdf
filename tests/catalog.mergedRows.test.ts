import { describe, expect, it } from 'vitest'
import {
  catalogItemPositions,
  catalogItems as catalogItemsIncludingStandard,
  catalogItemsForBreakdownRow,
  catalogPresets,
  representativeBreakdownPosition,
  type CatalogItem,
} from '../src/core/catalog'
import {
  breakdownEntries,
  type BreakdownEntry,
} from '../src/core/breakdownMaster'
import { LUMP_SUM_CATEGORY } from '../src/core/breakdown/mergedRows'
import { quantityUnit } from '../src/core/countFixtures'

// U2 の既存試験では、書式に行のない U8 の独立品目を比較対象から除く。
function catalogItems(): readonly CatalogItem[] {
  return catalogItemsIncludingStandard().filter(item => !item.key.startsWith('std:'))
}

const books = ['電気設備', '機械設備'] as const

function rowItems(field: string, name: string, unit?: string): CatalogItem[] {
  return catalogItems().filter(item =>
    item.field === field
    && item.key.startsWith('row:')
    && item.name === name
    && (unit === undefined || item.unit === unit),
  )
}

function onlyRowItem(field: string, name: string, unit?: string): CatalogItem {
  const items = rowItems(field, name, unit)
  expect(items).toHaveLength(1)
  if (items[0] === undefined) throw new Error(`品目がありません: ${field} ${name}`)
  return items[0]
}

function requiredRow(
  book: typeof books[number],
  predicate: (entry: BreakdownEntry) => boolean,
): BreakdownEntry {
  const entry = breakdownEntries(book).find(predicate)
  if (entry === undefined) throw new Error(`内訳書の行がありません: ${book}`)
  return entry
}

function positionFor(entry: BreakdownEntry) {
  return {
    book: entry.book,
    section: entry.section,
    subject: entry.subject,
    ...(entry.middle !== undefined ? { middle: entry.middle } : {}),
    item: entry.row.name,
  }
}

function sourceKey(key: string): string {
  return key.startsWith('master:') ? key.split('#')[0] : key
}

describe('同じ名称の行の統合と1式の項目', () => {
  it('開閉器箱を盤類の1品目にまとめ、4科目の行から同じ品目を引ける', () => {
    const item = onlyRowItem('電気設備', '開閉器箱')
    expect(item.category).toBe('盤類')

    const positions = catalogItemPositions(item)
    // 電灯設備は電灯幹線・電灯分岐の2行にあるので、行は5件・科目は4つ。
    expect(positions).toHaveLength(breakdownEntries('電気設備').filter(entry =>
      entry.row.name === '開閉器箱' && entry.row.unit === item.unit).length)
    expect([...new Set(positions.map(position => position.subject))].sort()).toEqual([
      '電灯設備',
      '動力設備',
      '電熱設備',
      '構内配電線路',
    ].sort())

    const entry = requiredRow('電気設備', entry =>
      entry.subject === '動力設備' && entry.row.name === '開閉器箱',
    )
    expect(catalogItemsForBreakdownRow(entry)).toEqual([item])

    const presets = catalogPresets(
      item,
      { options: [item.options[0].key] },
      positionFor(entry),
    )
    expect(presets).toHaveLength(1)
    expect(presets[0].name).toBe('開閉器箱')
    expect(presets[0].breakdown).toEqual(positionFor(entry))
  })

  it('電気設備の据付費を1式の1品目にまとめ、19行から引ける', () => {
    const item = onlyRowItem('電気設備', '据付費', '式')
    expect(item.category).toBe(LUMP_SUM_CATEGORY)
    expect(catalogItemPositions(item)).toHaveLength(19)
    expect(item.options).toEqual([{
      key: 'item',
      label: '',
      code: '',
      name: '据付費',
      kind: 'count',
      method: 'click',
    }])

    const entry = requiredRow('電気設備', entry =>
      entry.section === '庁舎'
      && entry.subject === '発電設備'
      && entry.middle === '自家発電（原動機）'
      && entry.row.name === '据付費',
    )
    expect(entry.row.separate).toBeTruthy()
    expect(catalogItemsForBreakdownRow(entry)).toEqual([item])
    expect(item.slots.map(slot => slot.label)).toEqual(entry.row.summary ?? [])

    const presets = catalogPresets(item, { options: ['item'] }, positionFor(entry))
    expect(presets).toHaveLength(1)
    expect(presets[0]).toMatchObject({
      name: '据付費（自家発電（原動機））',
      kind: 'count',
      method: 'click',
      aggregation: 'location',
      breakdown: positionFor(entry),
    })
    expect(presets[0].summary?.[0]).toEqual({
      label: '対象',
      value: '発電設備 自家発電（原動機）',
    })
    expect(quantityUnit(presets[0])).toBe('式')
  })

  it('中科目のない1式の項目は科目を名称と対象に使う', () => {
    const item = onlyRowItem('電気設備', '据付費', '式')
    const entry = requiredRow('電気設備', entry =>
      entry.subject === '電気自動車用充電設備'
      && entry.middle === undefined
      && entry.row.name === '据付費',
    )

    const presets = catalogPresets(item, { options: ['item'] }, positionFor(entry))
    expect(presets).toHaveLength(1)
    expect(presets[0].name).toBe('据付費（電気自動車用充電設備）')
    expect(presets[0].summary?.[0]).toEqual({
      label: '対象',
      value: '電気自動車用充電設備',
    })
  })

  it('位置を付けない1式の項目は名称を変えず、対象を足さない', () => {
    const item = onlyRowItem('電気設備', '据付費', '式')
    const presets = catalogPresets(item, { options: ['item'] })

    expect(presets).toHaveLength(1)
    expect(presets[0].name).toBe('据付費')
    expect(presets[0].summary?.some(field => field.label === '対象') ?? false).toBe(false)
    expect(presets[0].breakdown).toBeUndefined()
  })

  it('既存の対象を位置の値に置き換え、他の摘要を残して先頭に置く', () => {
    const item = onlyRowItem('電気設備', '据付費', '式')
    const entry = requiredRow('電気設備', entry =>
      entry.subject === '発電設備'
      && entry.middle === '自家発電（原動機）'
      && entry.row.name === '据付費',
    )
    const withSummary: CatalogItem = {
      ...item,
      options: item.options.map(option => ({
        ...option,
        summary: { 備考: '既存の摘要', 対象: '変更前の対象' },
      })),
    }

    const presets = catalogPresets(withSummary, { options: ['item'] }, positionFor(entry))
    expect(presets).toHaveLength(1)
    expect(presets[0].summary?.[0]).toEqual({
      label: '対象',
      value: '発電設備 自家発電（原動機）',
    })
    expect(presets[0].summary?.filter(field => field.label === '対象')).toHaveLength(1)
    expect(presets[0].summary).toContainEqual({ label: '備考', value: '既存の摘要' })
    expect(withSummary.options[0].summary?.対象).toBe('変更前の対象')
  })

  it('機械設備の1式の項目にも位置の対象を付ける', () => {
    const item = onlyRowItem('機械設備', '諸経費', '式')
    const presets = catalogPresets(item, { options: ['item'] }, {
      book: '機械設備',
      section: '庁舎',
      subject: 'ガス設備',
      item: '諸経費',
    })

    expect(presets).toHaveLength(1)
    expect(presets[0].name).toBe('諸経費（ガス設備）')
    expect(presets[0].summary?.[0]).toEqual({
      label: '対象',
      value: 'ガス設備',
    })
  })

  it('対象外の編やrow以外の鍵では1式でも名称と摘要を変えない', () => {
    const item = onlyRowItem('電気設備', '据付費', '式')
    const position = {
      book: '電気設備' as const,
      section: '庁舎',
      subject: '発電設備',
      middle: '自家発電（原動機）',
      item: '据付費',
    }

    for (const candidate of [
      { ...item, field: '建築' },
      { ...item, key: 'master:試験用' },
    ]) {
      const presets = catalogPresets(candidate, { options: ['item'] }, position)
      expect(presets).toHaveLength(1)
      expect(presets[0].name).toBe('据付費')
      expect(presets[0].summary?.some(field => field.label === '対象') ?? false).toBe(false)
    }
  })

  it.each(['架台類', '総合調整費'])('機械設備の%sを1式の1品目にする', name => {
    const item = onlyRowItem('機械設備', name, '式')
    expect(item.category).toBe(LUMP_SUM_CATEGORY)
    expect(catalogItemPositions(item).length).toBeGreaterThan(0)
    const preset = catalogPresets(item, { options: ['item'] })[0]
    expect(preset).toMatchObject({
      kind: 'count',
      method: 'click',
      aggregation: 'location',
    })
    expect(quantityUnit(preset)).toBe('式')
  })

  it('別紙明細でない機械設備の諸経費も1品目にまとめ、位置を行の数だけ返す', () => {
    const item = onlyRowItem('機械設備', '諸経費', '式')
    expect(item.category).toBe(LUMP_SUM_CATEGORY)
    // 1式・別紙明細の行（総合調整等の科目）も同じ名称・単位・区分なので含む。
    expect(catalogItemPositions(item)).toHaveLength(breakdownEntries('機械設備').filter(entry =>
      entry.row.name === '諸経費' && entry.row.unit === '式').length)

    const rows = breakdownEntries('機械設備').filter(entry =>
      entry.row.name === '諸経費' && entry.row.unit === '式',
    )
    expect(rows.some(entry => !entry.row.separate)).toBe(true)
    for (const entry of rows) {
      expect(catalogItemsForBreakdownRow(entry)).toEqual([item])
    }
  })

  it.each(books)('%sには品目0件の行がない', book => {
    const empty = breakdownEntries(book).filter(entry =>
      catalogItemsForBreakdownRow(entry).length === 0,
    )
    expect(empty.map(entry => ({
      key: entry.key,
      name: entry.row.name,
      unit: entry.row.unit,
    }))).toEqual([])
  })

  it('単位が違う流しをまとめない', () => {
    const pair = ['組', '台'].map(unit => {
      const entry = requiredRow('機械設備', entry =>
        !entry.row.separate && entry.row.name === '流し' && entry.row.unit === unit,
      )
      const items = catalogItemsForBreakdownRow(entry)
      expect(items).toHaveLength(1)
      expect(items[0].unit).toBe(unit)
      return items[0]
    })
    expect(pair[0].key).not.toBe(pair[1].key)
  })

  it('行品目の統合条件は編・名称・単位・摘要区分の並びである', () => {
    const keysBySignature = new Map<string, string>()
    const signaturesByKey = new Map<string, string>()

    for (const book of books) {
      for (const entry of breakdownEntries(book)) {
        for (const item of catalogItemsForBreakdownRow(entry)) {
          if (!item.key.startsWith('row:')) continue
          const signature = JSON.stringify([
            entry.book,
            entry.row.name,
            entry.row.unit,
            entry.row.summary ?? [],
          ])
          const previousKey = keysBySignature.get(signature)
          if (previousKey !== undefined) expect(item.key).toBe(previousKey)
          keysBySignature.set(signature, item.key)

          const previousSignature = signaturesByKey.get(item.key)
          if (previousSignature !== undefined) expect(signature).toBe(previousSignature)
          signaturesByKey.set(item.key, signature)
          expect(item.slots.map(slot => slot.label)).toEqual(entry.row.summary ?? [])
        }
      }
    }

    expect(keysBySignature.size).toBeGreaterThan(0)
  })

  it.each(books)('%sの規格タブと全行の品目の鍵の集合が一致する', book => {
    const catalogKeys = new Set(catalogItems()
      .filter(item => item.field === book)
      .map(item => item.key))
    const breakdownKeys = new Set(breakdownEntries(book)
      .flatMap(entry => catalogItemsForBreakdownRow(entry))
      .map(item => sourceKey(item.key)))

    expect([...breakdownKeys].sort()).toEqual([...catalogKeys].sort())
  })

  it('位置を庁舎優先の行順で返し、代表位置と一致する', () => {
    const item = onlyRowItem('電気設備', '開閉器箱')
    const rows = breakdownEntries().filter(entry =>
      catalogItemsForBreakdownRow(entry).some(candidate => candidate.key === item.key),
    )
    const ordered = [
      ...rows.filter(entry => entry.section === '庁舎'),
      ...rows.filter(entry => entry.section !== '庁舎'),
    ]
    const positions = catalogItemPositions(item)
    expect(positions).toEqual(ordered.map(positionFor))
    expect(representativeBreakdownPosition(item)).toEqual(positions[0])
  })

  it('重ね合わせの鍵も元の鍵で位置を引き、返却値の変更がキャッシュへ影響しない', () => {
    const item = onlyRowItem('電気設備', '開閉器箱')
    const expected = catalogItemPositions(item)
    const overlay = { ...item, key: `${item.key}#試験用の重ね合わせ` }
    expect(catalogItemPositions(overlay)).toEqual(expected)
    expect(representativeBreakdownPosition(overlay))
      .toEqual(representativeBreakdownPosition(item))

    const returned = catalogItemPositions(item)
    returned[0].subject = '変更'
    returned.pop()
    expect(catalogItemPositions(item)).toEqual(expected)
  })

  it('位置が1件の品目と位置のない品目を扱える', () => {
    const single = catalogItems().find(item => catalogItemPositions(item).length === 1)
    expect(single).toBeDefined()
    if (single === undefined) throw new Error('位置が1件の品目がありません')
    expect(catalogItemPositions(single)).toHaveLength(1)
    expect(catalogItemPositions({ ...single, key: '存在しない品目' })).toEqual([])
  })
})
