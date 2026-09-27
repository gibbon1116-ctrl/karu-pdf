import { describe, expect, it } from 'vitest'
import type { AnnotationInfo } from '../src/core/annotations'
import { AnnotationStore } from '../src/editor/AnnotationStore'

const existingFreeText: AnnotationInfo = {
  objNum: 12,
  pageIndex: 0,
  type: 'FreeText',
  editable: true,
  rect: [10, 20, 110, 40],
  contents: 'Existing note',
  fontSize: 9,
  textColor: [0, 0, 1],
  strokeColor: null,
  borderWidth: null,
  madeByKaru: false,
}

describe('AnnotationStore', () => {
  it('既存注釈を読み、触れる、動かす、文字を更新する', async () => {
    const store = new AnnotationStore()
    await store.ensurePageLoaded(0, async () => [existingFreeText])
    expect(store.getPageAnnotations(0)).toHaveLength(1)
    expect(store.isDirty()).toBe(false)

    store.touch('obj-12')
    expect(store.touchedObjNums(0)).toEqual([12])
    expect(store.isDirty()).toBe(false)

    store.move('obj-12', 5, -2)
    expect(store.get('obj-12')?.rect).toEqual([15, 18, 115, 38])
    expect(store.toEdits()[0]).toMatchObject({ kind: 'updateFreeText', objNum: 12, rect: [15, 18, 115, 38] })

    const layout = { lines: [{ text: '書換', x: 2, baseline: 10 }], height: 18 }
    store.updateText('obj-12', '書換', layout)
    expect(store.toEdits()[0]).toMatchObject({ kind: 'updateFreeText', text: '書換' })
    expect(store.isDirty()).toBe(true)
  })

  it('新規作成、削除、反映後のobjNum割当とdirtyを管理する', () => {
    const store = new AnnotationStore()
    const removed = store.create({ pageIndex: 0, kind: 'square', rect: [1, 2, 20, 30] })
    store.remove(removed.id)
    expect(store.toEdits()).toEqual([])
    expect(store.isDirty()).toBe(false)

    const text = store.create({
      pageIndex: 0,
      kind: 'freetext',
      rect: [10, 20, 210, 40],
      text: '日本語',
      layout: { lines: [{ text: '日本語', x: 2, baseline: 11 }], height: 18 },
    })
    const square = store.create({ pageIndex: 1, kind: 'square', rect: [5, 6, 25, 36] })
    expect(store.toEdits()).toEqual([
      expect.objectContaining({ kind: 'createFreeText', pageIndex: 0, text: '日本語' }),
      expect.objectContaining({ kind: 'createSquare', pageIndex: 1, borderWidth: 1 }),
    ])

    store.markApplied({ created: [31, 32], errors: [] })
    expect(store.get('obj-31')).toMatchObject({ objNum: 31, dirty: false, madeByKaru: true })
    expect(store.get('obj-32')).toMatchObject({ objNum: 32, dirty: false })
    expect(store.touchedObjNums(0)).toEqual([31])
    expect(store.touchedObjNums(1)).toEqual([32])
    expect(store.isDirty()).toBe(false)
    expect(store.toEdits()).toEqual([])

    store.remove('obj-32')
    expect(store.toEdits()).toEqual([{ kind: 'delete', objNum: 32, pageIndex: 1 }])
    expect(store.isDirty()).toBe(true)
    expect(square.id).toMatch(/^new-/)
    expect(text.id).toMatch(/^new-/)
  })

  it('反映に失敗した編集だけdirtyを残す', () => {
    const store = new AnnotationStore()
    store.create({ pageIndex: 0, kind: 'square', rect: [0, 0, 10, 10] })
    store.create({ pageIndex: 0, kind: 'square', rect: [20, 20, 30, 30] })
    const edits = store.toEdits()
    expect(edits).toHaveLength(2)
    store.markApplied({ created: [51], errors: [{ editIndex: 1 }] })
    expect(store.get('obj-51')?.dirty).toBe(false)
    expect(store.toEdits()).toHaveLength(1)
    expect(store.isDirty()).toBe(true)
  })

  it('markApplied後は同じcreateを返さない', () => {
    const store = new AnnotationStore()
    store.create({ pageIndex: 0, kind: 'freetext', rect: [10, 20, 210, 40], text: '一度だけ' })
    expect(store.toEdits()).toEqual([expect.objectContaining({ kind: 'createFreeText', text: '一度だけ' })])
    store.markApplied({ created: [61], errors: [] })
    expect(store.toEdits()).toEqual([])
    expect(store.get('obj-61')).toMatchObject({ objNum: 61, dirty: false })
  })

  it('新規と既存の大きさを変更し、既存は下地から除外する', async () => {
    const store = new AnnotationStore()
    const created = store.create({ pageIndex: 0, kind: 'square', rect: [10, 20, 30, 40] })
    store.resize(created.id, [10, 20, 60, 80])
    expect(store.get(created.id)?.rect).toEqual([10, 20, 60, 80])
    expect(store.toEdits()).toEqual([
      expect.objectContaining({ kind: 'createSquare', rect: [10, 20, 60, 80] }),
    ])

    const existingSquare = { ...existingFreeText, objNum: 18, type: 'Square', contents: '', strokeColor: [1, 0, 0] as [number, number, number] }
    await store.ensurePageLoaded(1, async () => [{ ...existingSquare, pageIndex: 1 }])
    store.resize('obj-18', [5, 6, 45, 56])
    expect(store.touchedObjNums(1)).toEqual([18])
    expect(store.get('obj-18')).toMatchObject({ rect: [5, 6, 45, 56], dirty: true })
    expect(store.toEdits()).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'updateSquare', objNum: 18, pageIndex: 1, rect: [5, 6, 45, 56] }),
    ]))
  })
})
