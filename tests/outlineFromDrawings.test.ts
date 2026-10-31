import { describe, expect, it } from 'vitest'
import { buildDrawingOutline, drawingNumberPrefix, drawingOutlineCandidates, drawingOutlineGroups } from '../src/app/outlineFromDrawings'
import { OutlineDraft } from '../src/app/OutlineDraft'
import { flattenOutline, validateOutlineItems } from '../src/core/outlineModel'

describe('drawingOutlineCandidates', () => {
  it('keeps page order, includes number-only/name-only/both, and skips empty pages', () => {
    const infos = [{ number: ' E-001 ' }, { name: ' 配置図 ' }, null, {}, { number: ' M101 ', name: ' 平面\n 図 ' }, { number: '  ', name: '\t' }]
    const before = structuredClone(infos)
    expect(drawingOutlineCandidates(infos)).toEqual([
      { pageIndex: 0, number: 'E-001', name: '', title: 'E-001', include: true, group: 'E' },
      { pageIndex: 1, number: '', name: '配置図', title: '配置図', include: true, group: null },
      { pageIndex: 4, number: 'M101', name: '平面 図', title: 'M101 平面 図', include: true, group: 'M' },
    ])
    expect(infos).toEqual(before)
  })
})
describe('drawingNumberPrefix', () => {
  it.each([['E-001', 'E'], ['M101', 'M'], ['EL-12', 'EL'], [' el-12 ', 'EL'], ['A 01', 'A'], ['1E-1', null], ['電E-1', null], ['E-図', null], ['EL', null], ['', null]])('%s => %s', (number, prefix) => {
    expect(drawingNumberPrefix(number)).toBe(prefix)
  })
})
describe('drawingOutlineGroups', () => {
  it('requires all included candidates to have prefixes, with at least two distinct prefixes', () => {
    expect(drawingOutlineGroups([])).toMatchObject({ groups: [], reason: expect.any(String) })
    expect(drawingOutlineGroups(drawingOutlineCandidates([{ number: 'E1' }, { number: 'E2' }]))).toMatchObject({ groups: [], reason: expect.stringContaining('1種類') })
    const candidates = drawingOutlineCandidates([{ number: 'E1' }, { name: '配置図' }, { number: 'M1' }])
    expect(drawingOutlineGroups(candidates)).toMatchObject({ groups: [], reason: expect.stringContaining('英字') })
    candidates[1].include = false
    expect(drawingOutlineGroups(candidates)).toMatchObject({ groups: [{ key: 'E' }, { key: 'M' }], reason: null })
  })
  it('marks only known names as guessed and preserves first prefix appearance', () => {
    const candidates = drawingOutlineCandidates(['EL1', 'M1', 'E1', 'A1', 'S1', 'P1', 'M2'].map(number => ({ number })))
    expect(drawingOutlineGroups(candidates)).toEqual({ groups: [
      { key: 'EL', title: 'EL', guessed: false }, { key: 'M', title: '機械設備図', guessed: true },
      { key: 'E', title: '電気設備図', guessed: true }, { key: 'A', title: '意匠図', guessed: true },
      { key: 'S', title: '構造図', guessed: true }, { key: 'P', title: '衛生設備図', guessed: true },
    ], reason: null })
  })
})
describe('buildDrawingOutline', () => {
  const candidates = () => drawingOutlineCandidates([{ number: 'E1', name: '配置図' }, { number: 'M1' }, { number: 'E2' }, { number: 'A1' }])
  it('builds a flat outline with edited titles/order, included pages, page destinations and default styles', () => {
    const list = candidates(); list[0].include = false; list[2].title = ' 修正済み\n名称 '
    const reordered = [list[2], list[1], list[0], list[3]]
    const items = buildDrawingOutline(reordered, null)
    expect(items.map(item => item.title)).toEqual(['修正済み 名称', 'M1', 'A1'])
    expect(items.map(item => item.target)).toEqual([2, 1, 3].map(pageIndex => ({ kind: 'page', pageIndex, view: null, source: 'dest' })))
    expect(items.every(item => !item.open && !item.children.length && !item.style.bold && !item.style.italic && item.style.color === null)).toBe(true)
    expect(buildDrawingOutline(reordered, [])).toEqual(items)
    expect(list[2].title).toBe(' 修正済み\n名称 ')
  })
  it('uses first included appearance for group order and destinations, with edited group names', () => {
    const list = candidates(), reordered = [list[2], list[1], list[0], list[3]]
    const groups = drawingOutlineGroups(reordered).groups.reverse().map(group => ({ ...group, title: `確認済み${group.key}` }))
    const items = buildDrawingOutline(reordered, groups)
    expect(items.map(item => item.title)).toEqual(['確認済みE', '確認済みM', '確認済みA'])
    expect(items.map(item => item.target)).toEqual([2, 1, 3].map(pageIndex => ({ kind: 'page', pageIndex, view: null, source: 'dest' })))
    expect(items[0].children.map(item => item.title)).toEqual(['E2', 'E1 配置図'])
    expect(items.every(item => item.open && item.children.every(child => !child.open))).toBe(true)
    const ids = flattenOutline(items).map(({ item }) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every(id => /^new:drawing-\d+$/.test(id))).toBe(true)
    expect(validateOutlineItems(items, 4)).toEqual([])
  })
  it('does not create empty groups and rejects mismatched groups instead of dropping pages', () => {
    const list = candidates(), groups = drawingOutlineGroups(list).groups
    list[3].include = false
    expect(buildDrawingOutline(list, groups).map(item => item.title)).toEqual(['電気設備図', '機械設備図'])
    expect(() => buildDrawingOutline(list, [groups[0]])).toThrow('一致しません')
  })
  it('appends or replaces all generated items in a single undo operation', () => {
    const baseline = { revision: 'empty', items: [], editable: true, problems: [], itemCount: 0 }
    const draft = new OutlineDraft(baseline)
    draft.add({ kind: 'end' }, { title: '既存項目', target: { kind: 'none' } })
    const original = structuredClone(draft.getItems()), items = buildDrawingOutline(candidates(), null)
    draft.append(items); draft.undo(); expect(draft.getItems()).toEqual(original)
    draft.replaceAll(items); expect(draft.getItems()).toEqual(items)
    draft.undo(); expect(draft.getItems()).toEqual(original)
  })
})
