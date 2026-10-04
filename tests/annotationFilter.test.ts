import { describe, expect, it, vi } from 'vitest'
import type { AnnotationInfo } from '../src/core/annotations'
import { countFixtureId } from '../src/core/counts'
import type { Issue } from '../src/core/issues'
import { AnnotationStore, type EditableAnnotation, type Kind } from '../src/editor/AnnotationStore'
import { ANNOTATION_FILTER_LABELS, DEFAULT_ANNOTATION_FILTER, annotationFilterLabel, matchesAnnotationFilter, type AnnotationFilter, type AnnotationFilterKind } from '../src/editor/annotationFilter'

const filter = (kind: AnnotationFilterKind = 'all', extra: Partial<AnnotationFilter> = {}): AnnotationFilter => ({ ...DEFAULT_ANNOTATION_FILTER, kind, ...extra })
const create = (store: AnnotationStore, kind: Kind = 'freetext', extra: Partial<Parameters<AnnotationStore['create']>[0]> = {}) => store.create({ pageIndex: 0, kind, rect: [20, 20, 80, 60], ...extra })
const count = (store: AnnotationStore, fixtureId = 'A') => create(store, 'symbol', { count: { version: 2, id: crypto.randomUUID(), fixtureId } })
const issue = (store: AnnotationStore, status: Issue['status'] = 'open') => create(store, 'issue', { issue: { number: 1, status, discipline: '電気設備' } })
function info(objNum: number, kind: AnnotationInfo['kind'], extra: Partial<AnnotationInfo> = {}): AnnotationInfo {
  return {
    objNum, pageIndex: 0, kind, type: kind === 'freetext' ? 'FreeText' : 'Stamp', editable: true,
    rect: [20, 20, 80, 60], contents: '', fontName: null, fontSize: null,
    textColor: null, strokeColor: null, interiorColor: null, borderWidth: null, opacity: null,
    line: null, lineEnding: null, inkList: null, quads: null, markedText: null,
    calloutPoint: null, calloutLine: null, symbol: null, madeByKaru: false, ...extra,
  }
}

describe('matchesAnnotationFilter', () => {
  it('全種類を今までの一覧と同じに判定する（器具の印は「個数カウント」と「記号」の両方に入る）', () => {
    const store = new AnnotationStore()
    const entries: Array<[EditableAnnotation, AnnotationFilterKind[]]> = [
      [create(store), ['text']], [create(store, 'callout'), ['callout']],
      [issue(store), ['issue', 'issueOpen']], [issue(store, 'answered'), ['issue', 'issueOpen']],
      [issue(store, 'confirmed'), ['issue', 'issueDone']],
      [create(store, 'distance', { measure: { kind: 'distance', mmPerPoint: 1, unit: 'mm', decimals: 0 } }), ['measure']],
      ...(['cloudSquare', 'cloudPolygon', 'line', 'arrow', 'square', 'circle'] as const).map(kind => [create(store, kind), ['shape']] as [EditableAnnotation, AnnotationFilterKind[]]),
      [create(store, 'symbol'), ['symbol']],
      [count(store), ['count', 'symbol']],
      [create(store, 'highlight'), ['pen']], [create(store, 'ink'), ['pen']],
      ...(['textHighlight', 'underline', 'strikeout'] as const).map(kind => [create(store, kind), ['markup']] as [EditableAnnotation, AnnotationFilterKind[]]),
    ]
    for (const [annotation, kinds] of entries) for (const kind of Object.keys(ANNOTATION_FILTER_LABELS) as AnnotationFilterKind[]) {
      expect(matchesAnnotationFilter(annotation, filter(kind)), `${annotation.kind}: ${kind}`).toBe(kind === 'all' || kinds.includes(kind))
    }
  })

  it('分野の部分一致と旧形式の状態を扱い、ページ範囲は見ない', () => {
    const store = new AnnotationStore(), a = issue(store, 'revised')
    expect(matchesAnnotationFilter(a, filter('issue', { discipline: '電気', status: 'answered' }))).toBe(true)
    const otherPage = { ...a, pageIndex: 500 }
    expect(matchesAnnotationFilter(otherPage, filter('issue', { discipline: '電気', status: 'answered' }))).toBe(true)
    expect(matchesAnnotationFilter(issue(store, 'done'), filter('issue', { status: 'answered' }))).toBe(true)
    expect(matchesAnnotationFilter(a, filter('issue', { status: 'confirmed' }))).toBe(false)
    expect(matchesAnnotationFilter(a, filter('issue', { discipline: '建築' }))).toBe(false)
    expect(matchesAnnotationFilter(create(store), filter('all', { status: 'open' }))).toBe(false)
    expect(matchesAnnotationFilter(count(store), filter('all', { discipline: '電気' }))).toBe(false)
  })

  it('旧版の変更記録は「すべて」だけに出し、分野と状態は無視する', () => {
    const a = { ...create(new AnnotationStore(), 'issue'), legacyChange: true }
    for (const kind of Object.keys(ANNOTATION_FILTER_LABELS) as AnnotationFilterKind[]) {
      expect(matchesAnnotationFilter(a, filter(kind, { discipline: '電気', status: 'confirmed' }))).toBe(kind === 'all')
    }
  })

  it('種類と分野と状態の表示名を共有する', () => {
    expect(annotationFilterLabel(filter('count'))).toBe('個数カウント（器具の印）')
    expect(annotationFilterLabel(filter('issueOpen', { status: 'open' }))).toBe('指摘（未確認）・未回答')
    expect(annotationFilterLabel(filter('issue', { discipline: '電気' }))).toBe('指摘・分野「電気」')
  })
})

describe('図面への反映', () => {
  it('反映・目のボタン・選択中の器具だけ表示を組み合わせる', () => {
    const store = new AnnotationStore(), a = count(store, 'A'), b = count(store, 'B'), text = create(store)
    store.selectFixture('A')
    for (const follows of [false, true]) for (const hidden of [false, true]) for (const only of [false, true]) {
      store.setFixtureVisible(['A'], !hidden)
      store.setOnlySelectedFixture(only)
      store.setAnnotationFilter(filter('count'))
      store.setDrawingFollowsFilter(follows)
      expect(store.isShownOnDrawing(a)).toBe(!hidden)
      expect(store.isShownOnDrawing(b)).toBe(!only)
      expect(store.isShownOnDrawing(text)).toBe(!follows)
      expect(store.visibleCountTotal(0)).toBe(Number(!hidden) + Number(!only))
      expect(store.countTotals().get('A')?.get(0)).toBe(1)
      expect(store.countTotals().get('B')?.get(0)).toBe(1)
    }
  })

  it('「すべて」と反映オフは非稼働、分野・状態は器具の印を隠す', () => {
    const store = new AnnotationStore()
    for (const kind of Object.keys(ANNOTATION_FILTER_LABELS) as AnnotationFilterKind[]) for (const discipline of ['', '電気']) for (const status of ['', 'open'] as const) for (const follows of [false, true]) {
      store.setAnnotationFilter(filter(kind, { discipline, status })); store.setDrawingFollowsFilter(follows)
      const active = follows && (kind !== 'all' || !!discipline || !!status)
      expect(store.drawingFilterActive()).toBe(active)
      expect(store.drawingHidesCounts()).toBe(active && (!['all', 'count', 'symbol'].includes(kind) || !!discipline || !!status))
    }
  })

  it('絞り込みで隠す保存済みの番号だけをページごとに返す', async () => {
    const store = new AnnotationStore()
    await store.ensurePageLoaded(0, async () => [info(11, 'freetext'), info(12, 'issue', { issue: { number: 1, status: 'open' } }), info(13, 'symbol', { count: { version: 1, id: 'c', group: '器具' } })])
    await store.ensurePageLoaded(1, async () => [info(21, 'square', { pageIndex: 1 })])
    create(store); store.remove('obj-13')
    store.setAnnotationFilter(filter('issue'))
    expect(store.drawingHiddenObjNums(0)).toEqual([])
    store.setDrawingFollowsFilter(true)
    expect(store.drawingHiddenObjNums(0)).toEqual([11])
    expect(store.drawingHiddenObjNums(1)).toEqual([21])
    expect(store.drawingHiddenObjNums(2)).toEqual([])
    store.setAnnotationFilter(filter())
    expect(store.drawingHiddenObjNums(0)).toEqual([])
    store.setFixtureVisible(['A'], false)
    expect(store.drawingHiddenObjNums(0)).toEqual([])
  })

  it('隠れたものはクリック・切替・囲みで選べず、反映変更で選択を外す', () => {
    const store = new AnnotationStore(), text = create(store), a = issue(store), c = count(store)
    store.selectOnly(text.id); store.toggleSelection(a.id)
    store.setAnnotationFilter(filter('issue')); store.setDrawingFollowsFilter(true)
    expect(store.selectedIds()).toEqual([a.id]); expect(store.isSelected(text.id)).toBe(false)
    store.toggleSelection(c.id); expect(store.selectedIds()).toEqual([a.id])
    store.selectOnly(text.id); expect(store.selectedIds()).toEqual([])
    expect(store.selectInRect(0, [0, 0, 100, 100])).toEqual([a.id])
    store.setAnnotationFilter(filter('issue', { status: 'answered' }))
    expect(store.selectedIds()).toEqual([])
    store.setDrawingFollowsFilter(false); store.selectOnly(c.id); store.setFixtureVisible(['A'], false)
    expect(store.selectedIds()).toEqual([])
  })

  it('作成で隠れると解除を一度通知し、通常の作成・購読解除では通知しない', () => {
    const store = new AnnotationStore(), released = vi.fn(), unsubscribe = store.subscribeDrawingFilterRelease(released)
    store.setAnnotationFilter(filter('issue')); store.setDrawingFollowsFilter(true)
    issue(store); expect(released).not.toHaveBeenCalled()
    const text = create(store)
    expect(store.drawingFollowsFilter).toBe(false); expect(store.isShownOnDrawing(text)).toBe(true)
    create(store); expect(released).toHaveBeenCalledTimes(1)
    expect(released).toHaveBeenCalledWith('隠れている種類の書き込みを作ったため')
    unsubscribe(); store.setDrawingFollowsFilter(true); create(store)
    expect(released).toHaveBeenCalledTimes(1)
  })

  it('隠した器具の新しい印を見えるようにし、別器具なら限定表示も解除する', () => {
    const store = new AnnotationStore()
    store.selectFixture('A'); store.setOnlySelectedFixture(true); store.setFixtureVisible(['B'], false)
    const b = count(store, 'B')
    expect(store.onlySelectedFixture).toBe(false); expect(store.isShownOnDrawing(b)).toBe(true)
    store.selectOnly(b.id); expect(store.selectedIds()).toEqual([b.id])
    const legacy = { version: 1, id: 'legacy', group: '旧器具' } as const
    store.setFixtureVisible([countFixtureId(legacy)], false)
    expect(store.isShownOnDrawing(create(store, 'symbol', { count: legacy }))).toBe(true)
  })

  it('貼り付けと指摘引継ぎも作成の解除を通り、やり直しでは解除しない', () => {
    const source = new AnnotationStore(), text = create(source), a = issue(source)
    for (const [annotation, kind, keepIssueNumbers] of [[text, 'issue', false], [a, 'count', true]] as const) {
      const store = new AnnotationStore(), released = vi.fn()
      store.subscribeDrawingFilterRelease(released)
      store.setAnnotationFilter(filter(kind)); store.setDrawingFollowsFilter(true)
      const ids = store.pasteAnnotations([annotation], 0, { width: 400, height: 400 }, 10, { keepIssueNumbers })
      expect(store.drawingFollowsFilter).toBe(false); expect(store.selectedIds()).toEqual(ids)
      expect(released).toHaveBeenCalledTimes(1)
      expect(released).toHaveBeenCalledWith('隠れている種類の書き込みを作ったため')
      store.undo(); store.setDrawingFollowsFilter(true); store.redo()
      expect(store.drawingFollowsFilter).toBe(true); expect(store.isShownOnDrawing(store.get(ids[0])!)).toBe(false)
      expect(released).toHaveBeenCalledTimes(1)
    }
  })

  it('カウント道具は絞り込みを解除して選択中の隠した器具だけ戻す', () => {
    const store = new AnnotationStore(), a = count(store, 'A'), b = count(store, 'B'), released = vi.fn()
    store.subscribeDrawingFilterRelease(released)
    store.selectFixture('A'); store.setFixtureVisible(['A', 'B'], false)
    store.setAnnotationFilter(filter('issue')); store.setDrawingFollowsFilter(true); store.prepareCountTool()
    expect(store.drawingFollowsFilter).toBe(false)
    expect(store.isShownOnDrawing(a)).toBe(true); expect(store.isShownOnDrawing(b)).toBe(false)
    expect(released).toHaveBeenCalledTimes(1)
    expect(released).toHaveBeenCalledWith('器具の印を数えるため')
    store.setAnnotationFilter(filter('count')); store.setDrawingFollowsFilter(true); store.prepareCountTool()
    expect(store.drawingFollowsFilter).toBe(true)
  })

  it('表示の操作は解除し、隠す方向は解除しない', () => {
    for (const action of [(s: AnnotationStore) => s.setFixtureVisible(['A'], true), (s: AnnotationStore) => s.showAllFixtures(), (s: AnnotationStore) => s.setOnlySelectedFixture(true)]) {
      const store = new AnnotationStore(), released = vi.fn()
      store.subscribeDrawingFilterRelease(released); store.setAnnotationFilter(filter('issue')); store.setDrawingFollowsFilter(true)
      store.setFixtureVisible(['A'], false); store.setOnlySelectedFixture(false)
      expect(store.drawingFollowsFilter).toBe(true); expect(released).not.toHaveBeenCalled()
      action(store)
      expect(store.drawingFollowsFilter).toBe(false)
      expect(released).toHaveBeenCalledTimes(1)
      expect(released).toHaveBeenCalledWith('器具の印を表示するため')
    }
  })

  it('器具の印が隠れていないときは、表示の操作で反映を解除しない', () => {
    for (const kind of ['all', 'count', 'symbol'] as const) {
      for (const action of [(s: AnnotationStore) => s.setFixtureVisible(['A'], true), (s: AnnotationStore) => s.showAllFixtures(), (s: AnnotationStore) => s.setOnlySelectedFixture(true)]) {
        const store = new AnnotationStore(), released = vi.fn()
        store.subscribeDrawingFilterRelease(released); store.setAnnotationFilter(filter(kind)); store.setDrawingFollowsFilter(true)
        store.setFixtureVisible(['A'], false)
        action(store)
        expect(store.drawingFollowsFilter).toBe(true); expect(released).not.toHaveBeenCalled()
      }
    }
  })

  it('状態変更・元に戻す・やり直しでは反映を解除しない', () => {
    const store = new AnnotationStore(), a = issue(store), released = vi.fn()
    store.subscribeDrawingFilterRelease(released)
    store.setAnnotationFilter(filter('issue', { status: 'open' })); store.setDrawingFollowsFilter(true); store.selectOnly(a.id)
    store.updateIssueDetails(a.id, { status: 'answered' })
    expect(store.isShownOnDrawing(store.get(a.id)!)).toBe(false); expect(store.selectedIds()).toEqual([]); expect(store.isSelected(a.id)).toBe(false)
    store.undo(); expect(store.isShownOnDrawing(store.get(a.id)!)).toBe(true)
    store.redo(); expect(store.isShownOnDrawing(store.get(a.id)!)).toBe(false)
    expect(store.drawingFollowsFilter).toBe(true); expect(released).not.toHaveBeenCalled()
  })

  it('解除は一覧を残し、reset(true) は表示設定を保ち、reset() は既定に戻す', () => {
    const store = new AnnotationStore(), selected = filter('issue', { discipline: '電気', status: 'open' })
    store.setAnnotationFilter(selected); store.setDrawingFollowsFilter(true)
    expect(store.isDirty()).toBe(false); expect(store.toEdits()).toEqual([])
    store.reset(true)
    expect(store.annotationFilter).toEqual(selected); expect(store.drawingFollowsFilter).toBe(true)
    store.setDrawingFollowsFilter(false); expect(store.annotationFilter).toEqual(selected)
    store.setDrawingFollowsFilter(true); store.reset()
    expect(store.annotationFilter).toEqual(DEFAULT_ANNOTATION_FILTER); expect(store.drawingFollowsFilter).toBe(false)
  })
})
