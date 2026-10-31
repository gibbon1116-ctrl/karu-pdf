import { describe, expect, it, vi } from 'vitest'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import type { CountFixture } from '../src/core/countFixtures'
import type { RelatedReviews, RelatedReviewDecision } from '../src/core/related/reviews'
import { DocumentSession } from '../src/app/documentModel'

const empty = (): RelatedReviews => ({ version: 1, works: {}, decisions: {} })
const decision = (): RelatedReviewDecision => ({
  decision: '後で確認',
  ruleIds: ['E-001'],
  originFixtureIds: ['fixture-1'],
  rulesVersion: 'test-v1',
  decidedAt: '2026-10-13T09:00:00.000Z',
})
const fixture: CountFixture = {
  id: 'fixture-1', code: 'A', name: '試験項目', category: 'その他', order: 0,
  style: {
    shape: 'circle', fill: 'none', color: [1, 0, 0],
    size: 10, opacity: 1, showCode: true,
  },
}

async function setup(initial = empty()): Promise<AnnotationStore> {
  const store = new AnnotationStore()
  await store.ensureRelatedReviews(async () => initial)
  return store
}

describe('AnnotationStore related reviews', () => {
  it('requires loading before editing and does not overwrite unread metadata', async () => {
    const store = new AnnotationStore()
    store.setRelatedProjectMode('改修')
    store.setRelatedWork('fixture-1', '新設')
    store.setRelatedDecision('key', decision())
    expect(store.getRelatedReviews()).toEqual(empty())
    expect(store.isDirty()).toBe(false)
    expect(store.toEdits()).toEqual([])
    expect(store.canUndo()).toBe(false)
  })

  it('loads once, shares an in-flight loader and retries a failed load', async () => {
    const store = new AnnotationStore()
    let resolve!: (value: RelatedReviews) => void
    const loader = vi.fn(() => new Promise<RelatedReviews>(done => { resolve = done }))
    const first = store.ensureRelatedReviews(loader)
    const second = store.ensureRelatedReviews(loader)
    await Promise.resolve()
    expect(store.relatedReviewsLoading).toBe(true)
    expect(loader).toHaveBeenCalledTimes(1)
    resolve({ ...empty(), projectMode: '改修' })
    await Promise.all([first, second])
    expect(store.relatedReviewsReady).toBe(true)
    expect(store.relatedReviewsLoading).toBe(false)
    expect(store.isDirty()).toBe(false)
    await store.ensureRelatedReviews(loader)
    expect(loader).toHaveBeenCalledTimes(1)

    const retryStore = new AnnotationStore()
    await expect(retryStore.ensureRelatedReviews(async () => {
      throw new Error('read failed')
    })).rejects.toThrow('read failed')
    expect(retryStore.relatedReviewsReady).toBe(false)
    expect(retryStore.relatedReviewsLoading).toBe(false)
    await retryStore.ensureRelatedReviews(async () => empty())
    expect(retryStore.relatedReviewsReady).toBe(true)
  })

  it('records one history step per change and restores all three kinds with Undo/Redo', async () => {
    const store = await setup()
    const index = store.quantityIndex()
    store.dirtySummary()
    const revision = store.getContentRevision()

    store.setRelatedProjectMode('改修')
    store.setRelatedWork('fixture-1', '更新・交換')
    store.setRelatedDecision('key', decision())
    const edited = store.getRelatedReviews()
    expect(store.getContentRevision()).toBeGreaterThan(revision)
    expect(store.dirtySummary().relatedReviews).toBe(true)
    expect(store.isDirty()).toBe(true)
    expect(store.quantityIndex()).toBe(index)

    store.undo()
    expect(store.getRelatedReviews().decisions).toEqual({})
    store.undo()
    expect(store.getRelatedReviews().works).toEqual({})
    store.undo()
    expect(store.getRelatedReviews()).toEqual(empty())
    expect(store.dirtySummary().relatedReviews).toBeUndefined()
    expect(store.isDirty()).toBe(false)
    expect(store.canUndo()).toBe(false)

    store.redo(); store.redo(); store.redo()
    expect(store.getRelatedReviews()).toEqual(edited)
    expect(store.isDirty()).toBe(true)
    expect(store.quantityIndex()).toBe(index)
  })

  it('does not notify, invalidate content or add history when values are unchanged', async () => {
    const initial: RelatedReviews = {
      version: 1, projectMode: '改修',
      works: { 'fixture-1': '新設' }, decisions: { key: decision() },
    }
    const store = await setup(initial)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    const revision = store.getContentRevision()
    const summary = store.dirtySummary()
    try {
      store.setRelatedProjectMode('改修')
      store.setRelatedWork('fixture-1', '新設')
      store.setRelatedWork('absent', undefined)
      store.setRelatedDecision('key', decision())
      store.setRelatedDecision('absent', undefined)
      expect(listener).not.toHaveBeenCalled()
      expect(store.getContentRevision()).toBe(revision)
      expect(store.dirtySummary()).toBe(summary)
      expect(store.canUndo()).toBe(false)
    } finally { unsubscribe() }
  })

  it('returns detached values and keeps caller-owned decisions detached', async () => {
    const store = await setup()
    const value = decision()
    store.setRelatedDecision('key', value)
    value.ruleIds.push('E-999')
    const copy = store.getRelatedReviews()
    copy.decisions.key.originFixtureIds.push('other')
    copy.works.other = '仮設'
    expect(store.getRelatedReviews().decisions.key).toEqual(decision())
    expect(store.getRelatedReviews().works).toEqual({})
  })

  it('emits a metadata edit, updates its baseline on save and keeps Undo usable after saving', async () => {
    const store = await setup()
    store.setRelatedProjectMode('改修')
    const edits = store.toEdits()
    expect(edits).toEqual([{
      kind: 'setRelatedReviews', pageIndex: 0,
      reviews: { ...empty(), projectMode: '改修' },
    }])
    store.markApplied({ created: [], errors: [] })
    expect(store.isDirty()).toBe(false)
    expect(store.dirtySummary().relatedReviews).toBeUndefined()
    expect(store.toEdits()).toEqual([])
    store.undo()
    expect(store.getRelatedReviews()).toEqual(empty())
    expect(store.dirtySummary().relatedReviews).toBe(true)
    expect(store.toEdits()).toEqual([{
      kind: 'setRelatedReviews', pageIndex: 0, reviews: empty(),
    }])
    store.redo()
    expect(store.isDirty()).toBe(false)
  })

  it('keeps failed writes and changes made during saving dirty', async () => {
    const store = await setup()
    store.setRelatedProjectMode('改修')
    const edits = store.toEdits()
    const editIndex = edits.findIndex(edit => edit.kind === 'setRelatedReviews')
    store.markApplied({ created: [], errors: [{ editIndex }] })
    expect(store.dirtySummary().relatedReviews).toBe(true)

    store.toEdits()
    store.setRelatedWork('fixture-1', '新設')
    store.markApplied({ created: [], errors: [] })
    expect(store.dirtySummary().relatedReviews).toBe(true)
    store.undo()
    expect(store.isDirty()).toBe(false)
  })

  it('preserves review history through annotation ID remapping during saving', async () => {
    const store = await setup()
    store.create({ kind: 'square', pageIndex: 0, rect: [0, 0, 10, 10] })
    store.setRelatedDecision('key', decision())
    store.toEdits()
    store.markApplied({ created: [31], errors: [] })
    expect(store.isDirty()).toBe(false)
    store.undo()
    expect(store.getRelatedReviews().decisions).toEqual({})
    expect(store.get('obj-31')).toBeDefined()
    store.redo()
    expect(store.getRelatedReviews().decisions.key).toEqual(decision())
    expect(store.isDirty()).toBe(false)
  })

  it('cancels decisions and modes/works with undefined and restores cancellations', async () => {
    const initial: RelatedReviews = {
      version: 1, projectMode: '改修',
      works: { 'fixture-1': '新設' }, decisions: { key: decision() },
    }
    const store = await setup(initial)
    store.setRelatedDecision('key', undefined)
    store.setRelatedWork('fixture-1', undefined)
    store.setRelatedProjectMode(undefined)
    expect(store.getRelatedReviews()).toEqual(empty())
    expect(store.isDirty()).toBe(true)
    store.undo(); store.undo(); store.undo()
    expect(store.getRelatedReviews()).toEqual(initial)
    expect(store.isDirty()).toBe(false)
  })

  it('selection alone stays clean and fixture deletion retains the saved judgment', async () => {
    const store = await setup({
      ...empty(), decisions: { key: decision() },
    })
    await store.ensureCountFixtures(async () => [fixture], async () => {})
    const revision = store.getContentRevision()
    const summary = store.dirtySummary()
    store.selectFixture('fixture-1')
    store.selectFixture(null)
    expect(store.isDirty()).toBe(false)
    expect(store.getContentRevision()).toBe(revision)
    expect(store.dirtySummary()).toBe(summary)

    store.setCountFixtures([], ['fixture-1'])
    expect(store.getRelatedReviews().decisions.key).toEqual(decision())
    store.undo()
    expect(store.getCountFixture('fixture-1')).toBeDefined()
    expect(store.getRelatedReviews().decisions.key).toEqual(decision())
    expect(store.isDirty()).toBe(false)
  })

  it('rejects invalid edits before changing data or history', async () => {
    const store = await setup()
    expect(() => store.setRelatedDecision('key', {
      ...decision(), ruleIds: [],
    })).toThrow()
    expect(store.getRelatedReviews()).toEqual(empty())
    expect(store.canUndo()).toBe(false)
    expect(store.isDirty()).toBe(false)
  })

  it('resets values, readiness, baseline and history and ignores an obsolete load', async () => {
    const store = await setup()
    store.setRelatedProjectMode('改修')
    store.toEdits()
    store.reset()
    expect(store.getRelatedReviews()).toEqual(empty())
    expect(store.relatedReviewsReady).toBe(false)
    expect(store.relatedReviewsLoading).toBe(false)
    expect(store.isDirty()).toBe(false)
    expect(store.canUndo()).toBe(false)
    expect(store.toEdits()).toEqual([])

    let resolve!: (value: RelatedReviews) => void
    const obsolete = store.ensureRelatedReviews(() =>
      new Promise<RelatedReviews>(done => { resolve = done }))
    await Promise.resolve()
    store.reset()
    await store.ensureRelatedReviews(async () => ({ ...empty(), projectMode: '新築' }))
    resolve({ ...empty(), projectMode: '解体' })
    await obsolete
    expect(store.getRelatedReviews().projectMode).toBe('新築')
    expect(store.isDirty()).toBe(false)
  })

  it('keeps a detached, deeply frozen snapshot until the reviews revision changes', async () => {
    const store = new AnnotationStore()
    const initialSnapshot = store.getRelatedReviewsSnapshot()
    const initialRevision = store.getRelatedReviewsRevision()
    expect(initialSnapshot).toEqual(empty())
    expect(Object.isFrozen(initialSnapshot)).toBe(true)
    expect(Object.isFrozen(initialSnapshot.works)).toBe(true)
    expect(Object.isFrozen(initialSnapshot.decisions)).toBe(true)

    store.selectFixture('fixture-1')
    store.selectFixture(null)
    expect(store.getRelatedReviewsRevision()).toBe(initialRevision)
    expect(store.getRelatedReviewsSnapshot()).toBe(initialSnapshot)

    const loaded: RelatedReviews = {
      ...empty(), projectMode: '改修',
      works: { 'fixture-1': '新設' }, decisions: { key: decision() },
    }
    await store.ensureRelatedReviews(async () => loaded)
    const loadedSnapshot = store.getRelatedReviewsSnapshot()
    expect(store.getRelatedReviewsRevision()).toBe(initialRevision + 1)
    expect(loadedSnapshot).not.toBe(initialSnapshot)
    expect(loadedSnapshot).toEqual(store.getRelatedReviews())
    expect(store.getRelatedReviewsSnapshot()).toBe(loadedSnapshot)
    expect(Object.isFrozen(loadedSnapshot)).toBe(true)
    expect(Object.isFrozen(loadedSnapshot.works)).toBe(true)
    expect(Object.isFrozen(loadedSnapshot.decisions)).toBe(true)
    expect(Object.isFrozen(loadedSnapshot.decisions.key)).toBe(true)
    expect(Object.isFrozen(loadedSnapshot.decisions.key.ruleIds)).toBe(true)
    expect(Object.isFrozen(loadedSnapshot.decisions.key.originFixtureIds)).toBe(true)
    expect(loadedSnapshot.works).not.toBe(loaded.works)
    expect(loadedSnapshot.decisions.key).not.toBe(loaded.decisions.key)
    expect(loadedSnapshot.decisions.key.ruleIds).not.toBe(loaded.decisions.key.ruleIds)

    expect(Reflect.set(loadedSnapshot.works, 'fixture-1', '仮設')).toBe(false)
    expect(Reflect.set(loadedSnapshot.decisions.key.ruleIds, '0', 'E-999')).toBe(false)
    const copy = store.getRelatedReviews()
    copy.decisions.key.ruleIds.push('E-999')
    copy.works['fixture-1'] = '仮設'
    expect(store.getRelatedReviewsSnapshot()).toBe(loadedSnapshot)
    expect(store.getRelatedReviews()).toEqual(loaded)

    const changed = (change: () => void) => {
      const previous = store.getRelatedReviewsSnapshot()
      const revision = store.getRelatedReviewsRevision()
      change()
      const next = store.getRelatedReviewsSnapshot()
      expect(store.getRelatedReviewsRevision()).toBe(revision + 1)
      expect(next).not.toBe(previous)
      expect(next).toEqual(store.getRelatedReviews())
      expect(Object.isFrozen(next)).toBe(true)
      expect(Object.isFrozen(next.works)).toBe(true)
      expect(Object.isFrozen(next.decisions)).toBe(true)
      return next
    }

    changed(() => store.setRelatedProjectMode('新築'))
    changed(() => store.setRelatedWork('fixture-1', '仮設'))
    const edited = changed(() => store.setRelatedDecision('key', {
      ...decision(), decision: '不要',
    }))
    const undone = changed(() => store.undo())
    expect(undone.decisions.key.decision).toBe('後で確認')
    const redone = changed(() => store.redo())
    expect(redone).toEqual(edited)
    expect(loadedSnapshot).toEqual(loaded)

    const resetSnapshot = changed(() => store.reset())
    expect(resetSnapshot).toEqual(empty())
    const resetRevision = store.getRelatedReviewsRevision()
    await store.ensureRelatedReviews(async () => empty())
    expect(store.getRelatedReviewsRevision()).toBe(resetRevision + 1)
    expect(store.getRelatedReviewsSnapshot()).not.toBe(resetSnapshot)
    expect(store.getRelatedReviewsSnapshot()).toEqual(store.getRelatedReviews())
  })

  it('does not replace the snapshot for no-op edits, selection, saving or unrelated Undo/Redo', async () => {
    const store = await setup({
      ...empty(), projectMode: '改修',
      works: { 'fixture-1': '新設' }, decisions: { key: decision() },
    })
    await store.ensureCountFixtures(async () => [fixture], async () => {})
    const snapshot = store.getRelatedReviewsSnapshot()
    const revision = store.getRelatedReviewsRevision()

    store.setRelatedProjectMode('改修')
    store.setRelatedWork('fixture-1', '新設')
    store.setRelatedWork('absent', undefined)
    store.setRelatedDecision('key', decision())
    store.setRelatedDecision('absent', undefined)
    await store.ensureRelatedReviews(async () => empty())
    store.selectFixture('fixture-1')
    store.selectFixture(null)
    const annotation = store.create({
      kind: 'square', pageIndex: 0, rect: [0, 0, 10, 10],
    })
    store.selectOnly(annotation.id)
    store.setHighlightedRise({ annotationId: annotation.id, riseIndex: 0 })
    store.setHighlightedRise(null)
    store.undo()
    store.redo()
    store.toEdits()
    store.markApplied({ created: [31], errors: [] })

    expect(store.getRelatedReviewsRevision()).toBe(revision)
    expect(store.getRelatedReviewsSnapshot()).toBe(snapshot)
    expect(snapshot).toEqual(store.getRelatedReviews())
  })

  it('does not replace the current snapshot when an obsolete review load finishes', async () => {
    const store = new AnnotationStore()
    let resolve!: (value: RelatedReviews) => void
    const obsolete = store.ensureRelatedReviews(() =>
      new Promise<RelatedReviews>(done => { resolve = done }))
    await Promise.resolve()
    store.reset()
    await store.ensureRelatedReviews(async () => ({
      ...empty(), projectMode: '新築', decisions: { key: decision() },
    }))
    const snapshot = store.getRelatedReviewsSnapshot()
    const revision = store.getRelatedReviewsRevision()
    resolve({ ...empty(), projectMode: '解体' })
    await obsolete
    expect(store.getRelatedReviewsRevision()).toBe(revision)
    expect(store.getRelatedReviewsSnapshot()).toBe(snapshot)
    expect(snapshot).toEqual(store.getRelatedReviews())
  })

  it('describes dirty reviews and excludes them from saved-page rendering revisions', async () => {
    const session = new DocumentSession({
      docId: 'test', name: 'test.pdf', byteLength: 100,
      handle: null, pageSizes: [{ width: 300, height: 400 }],
    })
    await session.annotationStore.ensureRelatedReviews(async () => empty())
    session.annotationStore.setRelatedProjectMode('改修')
    expect(session.dirtyDescription()).toContain('関連候補の判断')
    session.recordSavedRendering(session.annotationStore.toEdits(), [])
    expect(session.savedPageRevisions.size).toBe(0)
  })
})
