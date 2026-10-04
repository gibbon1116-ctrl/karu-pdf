import { describe, expect, it } from 'vitest'
import type { AnnotationInfo, RGB } from '../src/core/annotations'
import type { Issue } from '../src/core/issues'
import { AnnotationStore } from '../src/editor/AnnotationStore'

function savedIssue(objNum: number, status: Issue['status'], color: RGB): AnnotationInfo {
  return {
    objNum, pageIndex: 0, type: 'Stamp', kind: 'issue', editable: true,
    rect: [10, 20, 26, 36], contents: '保存済みの指摘',
    issue: { number: objNum, status },
    fontName: null, fontSize: null, textColor: null, strokeColor: color,
    interiorColor: null, borderWidth: null, opacity: null,
    line: null, lineEnding: null, inkList: null, quads: null, markedText: null,
    calloutPoint: null, calloutLine: null, symbol: null, madeByKaru: true,
  }
}

const colors: Array<[Issue['status'], RGB, RGB]> = [
  ['done', [.5, .5, .5], [0, .25, 1]],
  ['revised', [1, 0, 0], [0, .25, 1]],
  ['answered', [1, 0, 0], [0, .25, 1]],
  ['confirmed', [1, 0, 0], [.5, .5, .5]],
  ['open', [0, .25, 1], [1, 0, 0]],
]

describe('指摘の重ね描きと保存時の色補正', () => {
  it.each(colors)('%s の古い色は開いただけでは変更せず、別の変更の保存時に補正する', async (status, oldColor, color) => {
    const store = new AnnotationStore()
    await store.ensurePageLoaded(0, async () => [savedIssue(12, status, oldColor)])
    store.touch('obj-12')
    expect(store.isDirty()).toBe(false)
    expect(store.toEdits()).toEqual([])
    expect(store.get('obj-12')).toMatchObject({ color: oldColor, dirty: false, issue: { status } })

    store.create({ pageIndex: 0, kind: 'square', rect: [50, 50, 70, 70] })
    expect(store.toEdits()).toEqual([
      expect.objectContaining({ kind: 'updateIssue', objNum: 12, color, issue: { number: 12, status } }),
      expect.objectContaining({ kind: 'createSquare' }),
    ])
    store.markApplied({ created: [90] })
    expect(store.get('obj-12')).toMatchObject({ color, dirty: false, issue: { status } })
    expect(store.isDirty()).toBe(false)
    expect(store.toEdits()).toEqual([])
  })

  it('色が合う指摘と変更記録は別の変更を保存しても更新しない', async () => {
    const store = new AnnotationStore()
    await store.ensurePageLoaded(0, async () => [
      savedIssue(12, 'answered', [0, .25, 1]),
      { ...savedIssue(13, 'done', [.5, .5, .5]), legacyChange: true },
      { ...savedIssue(14, 'done', [.5, .5, .5]), issue: { number: 14, status: 'done', recordKind: 'change' } },
    ])
    store.create({ pageIndex: 0, kind: 'square', rect: [50, 50, 70, 70] })
    expect(store.toEdits()).toEqual([expect.objectContaining({ kind: 'createSquare' })])
  })

  it('新しい指摘と状態を変更した指摘も状態の色で保存し、保存後は変更なしに戻る', async () => {
    const store = new AnnotationStore()
    await store.ensurePageLoaded(0, async () => [savedIssue(12, 'open', [1, 0, 0])])
    store.updateIssueDetails('obj-12', { status: 'confirmed' })
    store.create({ pageIndex: 0, kind: 'issue', rect: [50, 50, 66, 66], issue: { number: 13, status: 'answered' }, color: [0, 1, 0] })
    expect(store.toEdits()).toEqual([
      expect.objectContaining({ kind: 'updateIssue', objNum: 12, color: [.5, .5, .5], issue: expect.objectContaining({ status: 'confirmed' }) }),
      expect.objectContaining({ kind: 'createIssue', color: [0, .25, 1] }),
    ])
    store.markApplied({ created: [90] })
    expect(store.isDirty()).toBe(false)
    expect(store.toEdits()).toEqual([])
    expect(store.issueOverlayObjNums(0)).toEqual([12, 90])
  })

  it('重ね描きの番号は対象ページの保存済み指摘だけにし、変更記録・削除済み・新規を除く', async () => {
    const store = new AnnotationStore()
    await store.ensurePageLoaded(0, async () => [
      savedIssue(12, 'done', [.5, .5, .5]),
      { ...savedIssue(13, 'done', [.5, .5, .5]), legacyChange: true },
      savedIssue(14, 'open', [1, 0, 0]),
      { ...savedIssue(15, 'open', [1, 0, 0]), issue: null, kind: 'square', type: 'Square' },
      { ...savedIssue(16, 'done', [.5, .5, .5]), issue: { number: 16, status: 'done', recordKind: 'change' } },
    ])
    await store.ensurePageLoaded(1, async () => [{ ...savedIssue(20, 'answered', [0, .25, 1]), pageIndex: 1 }])
    store.remove('obj-14')
    store.create({ pageIndex: 0, kind: 'issue', rect: [50, 50, 66, 66], issue: { number: 21, status: 'open' } })
    expect(store.issueOverlayObjNums(0)).toEqual([12])
    expect(store.issueOverlayObjNums(1)).toEqual([20])
    expect(store.issueOverlayObjNums(2)).toEqual([])
  })
})
