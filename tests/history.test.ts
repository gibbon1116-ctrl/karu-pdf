import { describe, expect, it } from 'vitest'
import { History } from '../src/editor/history'

describe('History', () => {
  it('戻す・やり直しと分岐を管理する', () => {
    const history = new History<number>(3)
    history.push({ before: 0, after: 1 })
    history.push({ before: 1, after: 2 })
    expect(history.undo()).toEqual({ before: 1, after: 2 })
    expect(history.redo()).toEqual({ before: 1, after: 2 })
    history.undo()
    history.push({ before: 1, after: 3 })
    expect(history.canRedo).toBe(false)
  })

  it('指定した上限より古い手を捨てる', () => {
    const history = new History<number>(2)
    history.push({ before: 0, after: 1 })
    history.push({ before: 1, after: 2 })
    history.push({ before: 2, after: 3 })
    expect(history.undoCount).toBe(2)
    expect(history.undo()?.before).toBe(2)
    expect(history.undo()?.before).toBe(1)
    expect(history.undo()).toBeNull()
  })
})
