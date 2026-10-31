import { describe, expect, it } from 'vitest'
import {
  catalogItems,
  catalogPresets,
  searchCatalog,
  type CatalogItem,
  type CatalogOption,
} from '../src/core/catalog'
import { STANDARD_GROUPS } from '../src/core/breakdown/standardMasterGroups'
import type { StandardGroup } from '../src/core/breakdown/standardMasterTypes'
import { COUNT_UNITS } from '../src/core/countFixtures'

const waterPipeName =
  '水道用硬質塩化ビニルライニング鋼管(SGP-VA) (給水) ねじ接合 (管端防食継手)'
const airConditionerName = 'ルームエアコンディショナー (ウインド形)'

function independentKey(group: StandardGroup): string {
  return `std:${JSON.stringify([
    group.field, group.category, group.name, group.unit,
  ])}`
}

function requiredItem(predicate: (item: CatalogItem) => boolean): CatalogItem {
  const item = catalogItems().find(predicate)
  if (item === undefined) throw new Error('試験対象の品目がありません')
  return item
}

function requiredOption(
  item: CatalogItem,
  predicate: (option: CatalogOption) => boolean,
): CatalogOption {
  const option = item.options.find(predicate)
  if (option === undefined) throw new Error(`試験対象の規格がありません: ${item.name}`)
  return option
}

function waterPipeSelection() {
  const item = requiredItem(item =>
    item.field === '機械設備'
    && item.key.startsWith('row:')
    && item.name === '給水管'
    && item.options.some(option =>
      option.formerName === waterPipeName && option.spec === '20'),
  )
  const option = requiredOption(item, option =>
    option.formerName === waterPipeName && option.spec === '20',
  )
  return { item, option }
}

describe('標準単価積算基準の個別項目（U8）', () => {
  it('給水管に管種・接合方法・呼び径を持つ規格を追加する', () => {
    const { item, option } = waterPipeSelection()

    expect(option.name).toBe('給水管')
    expect(option.summary).toMatchObject({
      管種: '水道用硬質塩化ビニルライニング鋼管(SGP-VA)',
      接合方法: 'ねじ接合 (管端防食継手)',
      呼び径: '20A',
    })
    expect(item.formerNames).toContain(waterPipeName)

    const presets = catalogPresets(item, { options: [option.key] })
    expect(presets).toHaveLength(1)

    // 未提示の FixturePreset 内部構造に依存せず、生成結果への摘要の伝播を確認する。
    const serialized = JSON.stringify(presets[0])
    for (const [label, value] of Object.entries({
      管種: '水道用硬質塩化ビニルライニング鋼管(SGP-VA)',
      接合方法: 'ねじ接合 (管端防食継手)',
      呼び径: '20A',
    })) {
      expect(serialized).toContain(label)
      expect(serialized).toContain(value)
    }
  })

  it('給水管の規格に地中配管の施工条件候補を保持する', () => {
    const { option } = waterPipeSelection()
    expect(option.conditions).toContain('地中配管')
  })

  it('ウインド形ルームエアコンディショナーを規格4件の独立品目にする', () => {
    const items = catalogItems().filter(item =>
      item.field === '機械設備'
      && item.name === airConditionerName
      && item.unit === '台',
    )
    expect(items).toHaveLength(1)

    const item = items[0]
    if (item === undefined) throw new Error('ルームエアコンディショナーがありません')

    expect(item.key.startsWith('std:')).toBe(true)
    expect(item.type).toBe(airConditionerName)
    expect(item.options).toHaveLength(4)
    expect(item.slots).toEqual([])
    expect(item.breakdownItem).toBeUndefined()
    for (const option of item.options) {
      expect(option.name).toBe(airConditionerName)
      expect(option.formerName).toBeUndefined()
    }
  })

  it('㎡のプルボックスを個の明細に吸収せず独立品目にする', () => {
    const groups = STANDARD_GROUPS
      .map((group, i) => ({ group, i }))
      .filter(({ group }) =>
        group.field === '電気設備'
        && group.name === 'プルボックス'
        && group.unit === '㎡',
      )
    expect(groups.length).toBeGreaterThan(0)

    const details = catalogItems().filter(item =>
      item.field === '電気設備'
      && item.key.startsWith('detail:')
      && item.name === 'プルボックス'
      && item.unit === '個',
    )
    expect(details.length).toBeGreaterThan(0)

    for (const { group, i } of groups) {
      const independent = requiredItem(item => item.key === independentKey(group))
      expect(independent.unit).toBe('㎡')
      expect(independent.breakdownItem).toBeUndefined()

      for (const [j] of group.specs.entries()) {
        const key = `std:${i}:${j}`
        expect(independent.options.some(option => option.key === key)).toBe(true)
        expect(details.some(item =>
          item.options.some(option => option.key === key),
        )).toBe(false)
      }
    }
  })

  it('全群の全規格を保持し、吸収先ありの群も欠落させない', () => {
    const ownersByOption = new Map<string, CatalogItem[]>()
    for (const item of catalogItems()) {
      const keys = item.options
        .filter(option => option.key.startsWith('std:'))
        .map(option => option.key)
      expect(new Set(keys).size).toBe(keys.length)

      for (const key of keys) {
        const owners = ownersByOption.get(key) ?? []
        owners.push(item)
        ownersByOption.set(key, owners)
      }
    }

    const countUnits = new Set<string>(COUNT_UNITS)
    countUnits.delete('式')

    let skipped = 0
    for (const [i, group] of STANDARD_GROUPS.entries()) {
      const targets = catalogItems().filter(item =>
        item.field === group.field
        && (item.unit === group.unit
          || (countUnits.has(item.unit) && countUnits.has(group.unit)))
        && (group.targets ?? []).some(target =>
          'row' in target
            ? item.key.startsWith('row:')
              && item.name === target.row
              && (target.unit === undefined || item.unit === target.unit)
            : item.key.startsWith('detail:')
              && item.breakdownItem === target.detailRow
              && item.name === target.detail),
      )
      const destinations = targets.length
        ? targets
        : [requiredItem(item => item.key === independentKey(group))]

      for (const [j, [spec, code]] of group.specs.entries()) {
        const key = `std:${i}:${j}`
        const owners = ownersByOption.get(key) ?? []
        // 吸収先には品目そのものの規格があるので、記号・規格・摘要の無い規格は足さない。
        if (targets.length && spec === '' && code === '' && Object.keys(group.summary ?? {}).length === 0) {
          expect(owners).toEqual([])
          skipped += 1
          continue
        }
        expect(owners.map(item => item.key).sort())
          .toEqual(destinations.map(item => item.key).sort())

        for (const destination of destinations) {
          const option = requiredOption(destination, option => option.key === key)
          expect(option.code).toBe(code)
          expect(option.spec).toBe(spec || undefined)
          expect(option.name).toBe(destination.name)
          expect(option.kind).toBe(group.kind)
          expect(option.method).toBe(group.method)
          expect(option.label).toBe([code, spec].filter(Boolean).join(' '))
          expect(option.conditions ?? []).toEqual(group.conditions)
          expect(option.formerName).toBe(targets.length ? group.name : undefined)
        }
      }
    }

    expect(ownersByOption.size).toBe(
      STANDARD_GROUPS.reduce((total, group) => total + group.specs.length, 0) - skipped,
    )
  })

  it('独立品目の鍵を重複させず、同じ鍵の群の規格をまとめる', () => {
    const items = catalogItems().filter(item => item.key.startsWith('std:'))
    expect(new Set(items.map(item => item.key)).size).toBe(items.length)

    for (const item of items) {
      expect(item.type).toBe(item.name)
      expect(item.breakdownItem).toBeUndefined()
      expect(item.slots).toEqual([])
    }
  })

  it('ルームエアコンディショナーを検索できる', () => {
    const item = requiredItem(item =>
      item.field === '機械設備'
      && item.name === airConditionerName
      && item.unit === '台',
    )
    expect(searchCatalog('ルームエアコンディショナー').results.map(result => result.item))
      .toContainEqual(item)
  })
})
