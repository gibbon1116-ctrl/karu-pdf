import { describe, expect, it, vi } from 'vitest'
import type { AnnotationInfo } from '../src/core/annotations'
import { AnnotationStore } from '../src/editor/AnnotationStore'

function info(pageIndex: number): AnnotationInfo {
  return { objNum: 100 + pageIndex, editable: true, kind: 'square',
    rect: [10, 20, 30, 40], contents: '', symbol: null, madeByKaru: false } as AnnotationInfo
}

describe('quantity page loading', () => {
  it('全ページを読み込み、通知と集計の無効化をまとめ、再読込しない', async () => {
    const store = new AnnotationStore(), listener = vi.fn()
    store.subscribe(listener)
    const loader = vi.fn(async (page: number) => [info(page)])
    const revision = store.getContentRevision()
    await store.ensurePagesLoaded([0, 1, 2], loader)
    expect(loader.mock.calls.map(([page]) => page)).toEqual([0, 1, 2])
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getContentRevision()).toBe(revision + 1)
    for (const page of [0, 1, 2]) expect(store.getPageAnnotationsSnapshot(page)).toHaveLength(1)
    expect(store.isDirty()).toBe(false)
    await store.ensurePagesLoaded([0, 1, 2], loader)
    expect(loader).toHaveBeenCalledTimes(3)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('途中で失敗しても読込済みページを通知し、未読込ページだけ再試行する', async () => {
    const store = new AnnotationStore(), listener = vi.fn()
    store.subscribe(listener)
    await expect(store.ensurePagesLoaded([0, 1, 2], async page => {
      if (page === 1) throw new Error('読込失敗')
      return [info(page)]
    })).rejects.toThrow('読込失敗')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getPageAnnotationsSnapshot(0)).toHaveLength(1)
    const retry = vi.fn(async (page: number) => [info(page)])
    await store.ensurePagesLoaded([0, 1, 2], retry)
    expect(retry.mock.calls.map(([page]) => page)).toEqual([1, 2])
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('読込中に文書をリセットしたら残りのページと古い通知を破棄する', async () => {
    const store = new AnnotationStore(), listener = vi.fn()
    store.subscribe(listener)
    const loader = vi.fn(async (page: number) => { store.reset(); return [info(page)] })
    await store.ensurePagesLoaded([0, 1, 2], loader)
    expect(loader).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledTimes(1) // reset only
    expect(store.getPageAnnotationsSnapshot(0)).toEqual([])
  })

  it('通常閲覧のページ読込は直ちに通知し、同時要求は共有する', async () => {
    const store = new AnnotationStore(), listener = vi.fn()
    store.subscribe(listener)
    const loader = vi.fn(async () => [info(0)])
    await Promise.all([store.ensurePageLoaded(0, loader), store.ensurePageLoaded(0, loader)])
    expect(loader).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
