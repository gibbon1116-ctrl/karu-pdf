import { describe, expect, it } from 'vitest'
import * as o from '../src/core/outlineModel'

function item(id: string, children: o.OutlineItem[] = []): o.OutlineItem {
  return { id, title: `名称${id}`, open: false, target: { kind: 'none' }, style: { bold: false, italic: false, color: null }, children }
}
const tree = () => [item('a', [item('b', [item('c')]), item('d')]), item('e'), item('f')]
const ids = (items: o.OutlineItem[]) => o.flattenOutline(items).map(({ item }) => item.id)
const snapshot = (items: o.OutlineItem[]): o.OutlineSnapshot => ({ items, revision: 'base', editable: true, problems: [], itemCount: o.countOutlineItems(items) })

describe('outlineModel', () => {
  it('finds parents, sibling indices and depths; flattens all or expanded rows', () => {
    const items = tree(), found = o.findOutlineItem(items, 'd')!
    expect(found.parent).toBe(items[0]); expect(found.siblings).toBe(items[0].children)
    expect(found.index).toBe(1); expect(found.depth).toBe(1)
    expect(o.findOutlineItem(items, 'missing')).toBeNull()
    expect(o.flattenOutline(items).map(r => [r.item.id, r.depth, r.parentId, r.hasChildren])).toEqual([
      ['a', 0, null, true], ['b', 1, 'a', true], ['c', 2, 'b', false], ['d', 1, 'a', false], ['e', 0, null, false], ['f', 0, null, false],
    ])
    expect(ids(items)).toHaveLength(6); expect(o.countOutlineItems(items)).toBe(6)
    expect(o.flattenOutline(items, i => i.id === 'a').map(r => r.item.id)).toEqual(['a', 'b', 'd', 'e', 'f'])
    expect(o.isOutlineDescendant(items, 'a', 'a')).toBe(true)
    expect(o.isOutlineDescendant(items, 'a', 'c')).toBe(true)
    expect(o.isOutlineDescendant(items, 'b', 'd')).toBe(false)
  })
  it.each([
    [{ kind: 'before', id: 'e' }, ['a', 'b', 'c', 'd', 'x', 'e', 'f']],
    [{ kind: 'after', id: 'b' }, ['a', 'b', 'c', 'x', 'd', 'e', 'f']],
    [{ kind: 'child', id: 'b' }, ['a', 'b', 'c', 'x', 'd', 'e', 'f']],
    [{ kind: 'end' }, ['a', 'b', 'c', 'd', 'e', 'f', 'x']],
  ] as [o.OutlineInsertPosition, string[]][])('inserts at %j without mutating input', (position, expected) => {
    const items = tree(), before = structuredClone(items)
    expect(ids(o.insertOutlineItem(items, position, item('x')))).toEqual(expected)
    expect(items).toEqual(before)
  })
  it('removes a subtree or promotes children in order', () => {
    expect(ids(o.removeOutlineItem(tree(), 'b', 'withChildren'))).toEqual(['a', 'd', 'e', 'f'])
    expect(ids(o.removeOutlineItem(tree(), 'a', 'keepChildren'))).toEqual(['b', 'c', 'd', 'e', 'f'])
  })
  it('moves using the index after removal and clamps indices', () => {
    expect(o.moveOutlineItem(tree(), 'a', { parentId: null, index: 1 }).map(i => i.id)).toEqual(['e', 'a', 'f'])
    expect(o.moveOutlineItem(tree(), 'a', { parentId: null, index: 999 }).map(i => i.id)).toEqual(['e', 'f', 'a'])
    expect(o.moveOutlineItem(tree(), 'f', { parentId: null, index: -5 }).map(i => i.id)).toEqual(['f', 'a', 'e'])
  })
  it.each(['a', 'b', 'c'])('rejects moving a below %s', parentId => {
    expect(() => o.moveOutlineItem(tree(), 'a', { parentId, index: 0 })).toThrow('目次を自分自身や子項目の下へは移動できません。')
  })
  it('moves up/down within siblings and returns the input at boundaries', () => {
    const items = tree()
    expect(o.moveOutlineItemUp(items, 'a')).toBe(items); expect(o.moveOutlineItemDown(items, 'f')).toBe(items)
    expect(o.moveOutlineItemUp(items, 'e').map(i => i.id)).toEqual(['e', 'a', 'f'])
    expect(o.moveOutlineItemDown(items, 'e').map(i => i.id)).toEqual(['a', 'f', 'e'])
  })
  it('indents below the previous sibling and outdents with the complete subtree', () => {
    const items = tree(), indented = o.indentOutlineItem(items, 'e')
    expect(indented[0].children.map(i => i.id)).toEqual(['b', 'd', 'e'])
    expect(o.indentOutlineItem(items, 'a')).toBe(items)
    expect(o.outdentOutlineItem(items, 'a')).toBe(items)
    const outdented = o.outdentOutlineItem(items, 'b')
    expect(outdented.map(i => i.id)).toEqual(['a', 'b', 'e', 'f']); expect(outdented[1].children[0].id).toBe('c')
  })
  it('normalizes Japanese titles and symbols and updates immutably', () => {
    expect(o.normalizeOutlineTitle('  第一章\n\t設備・照明 ①  ')).toBe('第一章 設備・照明 ①')
    const items = tree(), next = o.updateOutlineItem(items, 'c', { title: '変更', open: true })
    expect(o.findOutlineItem(next, 'c')!.item.title).toBe('変更'); expect(o.findOutlineItem(items, 'c')!.item.title).toBe('名称c')
    expect(() => o.normalizeOutlineTitle(' \n\t ')).toThrow('目次の名称を入力してください。')
    expect(() => o.normalizeOutlineTitle('あ'.repeat(1001))).toThrow()
  })
  it('formats labels and locks only external and special targets', () => {
    const targets: o.OutlineTarget[] = [{ kind: 'page', pageIndex: 2, view: null, source: 'dest' }, { kind: 'external', uri: 'https://example.test' }, { kind: 'special', action: 'Launch' }, { kind: 'broken', reason: '不明' }, { kind: 'none' }]
    expect(targets.map(o.outlinePageLabel)).toEqual(['3', '外部', '特殊', '不明', '—'])
    expect(targets.map(o.outlineTargetLocked)).toEqual([false, true, true, false, false])
  })
  it('builds keep edits using deep target equality, including special and broken targets', () => {
    const items = tree()
    items[0].target = { kind: 'page', pageIndex: 1, view: { type: 'XYZ', params: [null, 50, 2] }, source: 'named', name: '架空' }
    items[1].target = { kind: 'external', uri: 'https://example.test' }
    items[2].target = { kind: 'broken', reason: '未解決' }
    const base = snapshot(items), changed = structuredClone(items)
    changed[0].title = '変更'
    expect(o.buildOutlineApplyPlan(base, changed).items.map(i => i.target)).toEqual([{ kind: 'keep' }, { kind: 'keep' }, { kind: 'keep' }])
    changed[0].target = { kind: 'page', pageIndex: 0, view: null, source: 'dest' }
    expect(o.buildOutlineApplyPlan(base, changed).items[0].target).toEqual({ kind: 'page', pageIndex: 0, view: null })
    for (const target of [{ kind: 'external', uri: 'x' }, { kind: 'special', action: 'Named' }, { kind: 'broken', reason: 'x' }] as o.OutlineTarget[]) {
      expect(() => o.buildOutlineApplyPlan(base, [{ ...item('new:1'), target }])).toThrow()
    }
  })
  it('validates ids, titles, limits and page indices', () => {
    expect(o.validateOutlineItems(tree(), 3)).toEqual([])
    expect(o.validateOutlineItems([item('a'), item('a')], 3).join()).toContain('重複')
    expect(o.validateOutlineItems([{ ...item('a'), title: ' ' }], 3)).toHaveLength(1)
    expect(o.validateOutlineItems([{ ...item('a'), title: 'a'.repeat(1001) }], 3)).toHaveLength(1)
    for (const pageIndex of [-1, 3, 1.5, NaN]) expect(o.validateOutlineItems([{ ...item('a'), target: { kind: 'page', pageIndex, view: null, source: 'dest' } }], 3)).toHaveLength(1)
    let deep = [item('bottom')]
    for (let i = 0; i < 64; i++) deep = [item(`depth${i}`, deep)]
    expect(o.validateOutlineItems(deep, 3).join()).toContain('階層')
    expect(o.validateOutlineItems(Array.from({ length: 10001 }, (_, i) => item(`${i}`)), 3).join()).toContain('多すぎ')
  })
  it('remaps only new ids recursively and hashes deterministically', () => {
    expect(ids(o.remapOutlineIds([item('new:1', [item('new:2')]), item('obj:3')], { 'new:1': 'obj:4', 'new:2': 'obj:5', 'obj:3': 'wrong' }))).toEqual(['obj:4', 'obj:5', 'obj:3'])
    expect(o.outlineRevision('日本語')).toMatch(/^[0-9a-f]{16}$/)
    expect(o.outlineRevision('日本語')).toBe(o.outlineRevision('日本語'))
    expect(o.outlineRevision('日本語')).not.toBe(o.outlineRevision('別'))
  })
})
