import { describe, expect, it, vi } from 'vitest'
import { AnnotationStore } from '../src/editor/AnnotationStore'

/**
 * Exercise the actual methods with access restricted to display-only fields.
 * Access to saved edits, history, annotations or quantity state fails the test.
 * This avoids inventing constructor/serialization APIs absent from the supplied
 * source excerpts.
 */
function displayOnlyStore() {
  const notifyUi = vi.fn()
  const target = Object.assign(Object.create(AnnotationStore.prototype), {
    symbolCandidateFocus: null,
    symbolCandidates: null,
    symbolSearchArea: null,
    symbolCandidateFixture: null,
    symbolCandidateRadius: 0,
    symbolLabelFilter: null,
    symbolGcFilter: 'all',
    symbolShapeFilter: 'same',
    symbolOtherFilter: 'hide',
    notifyUi,
  })
  const permitted = new Set([
    ...Object.keys(target),
    'focusedSymbolCandidateId',
    'setFocusedSymbolCandidate',
    'clearSymbolCandidates',
    'beginSymbolCandidates',
  ])
  const writes: string[] = []
  const store = new Proxy(target, {
    get(object, key, receiver) {
      if (typeof key !== 'string' || !permitted.has(key)) {
        throw new Error(`表示状態以外へのアクセス: ${String(key)}`)
      }
      return Reflect.get(object, key, receiver)
    },
    set(object, key, value, receiver) {
      if (typeof key !== 'string' || !permitted.has(key)) {
        throw new Error(`表示状態以外への書き込み: ${String(key)}`)
      }
      writes.push(key)
      return Reflect.set(object, key, value, receiver)
    },
  }) as AnnotationStore
  return { store, notifyUi, writes }
}

describe('symbol candidate display focus', () => {
  it('保存・履歴・数量の状態に触れず、焦点だけを変更して UI を通知する', () => {
    const { store, notifyUi, writes } = displayOnlyStore()
    expect(store.focusedSymbolCandidateId).toBeNull()

    store.setFocusedSymbolCandidate('candidate-1')
    expect(store.focusedSymbolCandidateId).toBe('candidate-1')
    expect(notifyUi).toHaveBeenCalledTimes(1)
    expect(writes).toEqual(['symbolCandidateFocus'])

    store.setFocusedSymbolCandidate('candidate-1')
    expect(notifyUi).toHaveBeenCalledTimes(1)
    expect(writes).toEqual(['symbolCandidateFocus'])

    store.setFocusedSymbolCandidate('candidate-2')
    store.setFocusedSymbolCandidate(null)
    expect(store.focusedSymbolCandidateId).toBeNull()
    expect(notifyUi).toHaveBeenCalledTimes(3)
    expect(writes).toEqual([
      'symbolCandidateFocus', 'symbolCandidateFocus', 'symbolCandidateFocus',
    ])
  })

  it('候補が既に null でも clearSymbolCandidates で焦点を消す', () => {
    const { store, notifyUi } = displayOnlyStore()
    store.setFocusedSymbolCandidate('candidate-1')
    notifyUi.mockClear()

    store.clearSymbolCandidates()
    expect(store.symbolCandidates).toBeNull()
    expect(store.focusedSymbolCandidateId).toBeNull()
    expect(notifyUi).toHaveBeenCalledTimes(1)

    store.clearSymbolCandidates()
    expect(notifyUi).toHaveBeenCalledTimes(1)
  })

  it('検索のやり直しで焦点を消す', () => {
    const { store, notifyUi } = displayOnlyStore()
    store.setFocusedSymbolCandidate('candidate-1')
    notifyUi.mockClear()

    store.beginSymbolCandidates('fixture-1', [10, 20, 30, 40])
    expect(store.focusedSymbolCandidateId).toBeNull()
    expect(store.symbolCandidates).toEqual([])
    expect(notifyUi).toHaveBeenCalledTimes(1)
  })
})
