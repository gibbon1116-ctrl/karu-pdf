import { describe, expect, it, vi } from 'vitest'
import { PdfOpeningStore, type PdfOpening } from '../src/app/PdfOpeningFeedback'

describe('PDF読込表示の更新', () => {
  const reading: PdfOpening = { id: 1, name: '図面.pdf', stage: 'reading', docId: null }

  it('内部段階の変化で同期画面更新を要求せず、表示用snapshotも変えない', () => {
    const store = new PdfOpeningStore(), listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    store.set(reading)
    const visible = store.snapshot()
    store.set({ ...reading, stage: 'opening', docId: 'document-1' })
    store.set({ ...reading, stage: 'displaying', docId: 'document-1' })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.snapshot()).toBe(visible)
    store.set(null)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(store.snapshot()).toBeNull()
    store.set(null)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('取得後のファイル名と次の読込要求は即時更新する', () => {
    const store = new PdfOpeningStore(), listener = vi.fn()
    store.subscribe(listener)
    store.set(reading)
    store.set({ ...reading, name: '新版.pdf' })
    expect(store.snapshot()).toEqual({ id: 1, name: '新版.pdf' })
    store.set({ ...reading, id: 2, name: '新版.pdf' })
    expect(store.snapshot()).toEqual({ id: 2, name: '新版.pdf' })
    expect(listener).toHaveBeenCalledTimes(3)
  })
})
