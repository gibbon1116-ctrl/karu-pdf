import { describe, expect, it } from 'vitest'
import { OrganizeDraft } from '../src/organize/OrganizeDraft'

const sizes = Array.from({ length: 5 }, () => ({ width: 300, height: 400 }))

describe('OrganizeDraft', () => {
  it('複数ページをまとめて移動し、回転・削除・白紙・追加PDFを管理する', () => {
    const draft = new OrganizeDraft('main', sizes)
    const original = draft.getCards()
    draft.move([original[1].id, original[2].id], 5)
    expect(draft.getCards().map((card) => card.source.kind === 'page' ? card.source.pageIndex : -1))
      .toEqual([0, 3, 4, 1, 2])

    const moved = draft.getCards()
    draft.rotate([moved[0].id], 90)
    draft.rotate([moved[0].id], -90)
    expect(draft.getCards()[0].rotation).toBe(0)
    draft.delete([draft.getCards()[1].id])
    draft.insertBlank(1, 300, 400)
    draft.insertPages(2, 'source', [{ width: 100, height: 200 }, { width: 200, height: 100 }])

    expect(draft.getCards()).toHaveLength(7)
    expect(draft.getCards()[1].source).toEqual({ kind: 'blank', width: 300, height: 400 })
    expect(draft.getCards()[2].source).toEqual({ kind: 'page', docId: 'source', pageIndex: 0 })
    expect(draft.isChanged()).toBe(true)
  })

  it('100手まで元に戻しとやり直しができ、新しい操作でやり直しを捨てる', () => {
    const draft = new OrganizeDraft('main', sizes)
    for (let index = 0; index < 105; index += 1) draft.rotate([draft.getCards()[0].id], 90)
    let undoCount = 0
    while (draft.canUndo()) {
      draft.undo()
      undoCount += 1
    }
    expect(undoCount).toBe(100)
    expect(draft.canRedo()).toBe(true)
    draft.redo()
    draft.delete([draft.getCards()[1].id])
    expect(draft.canRedo()).toBe(false)
  })

  it('元の並びと回転へ戻ると変更なしになる', () => {
    const draft = new OrganizeDraft('main', sizes)
    const first = draft.getCards()[0]
    draft.rotate([first.id], 90)
    expect(draft.isChanged()).toBe(true)
    draft.undo()
    expect(draft.isChanged()).toBe(false)
    draft.redo()
    expect(draft.isChanged()).toBe(true)
  })
})
