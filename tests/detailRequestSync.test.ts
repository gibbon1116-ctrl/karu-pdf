import { describe, expect, it, vi } from 'vitest'
import { DetailRequestSync, type DetailRequest, type DetailRequestPlan } from '../src/viewer/detailRequestSync'

const request = (key: string, delayMs = 0): DetailRequestPlan => ({
  key,
  stage: 'visible',
  region: [0, 0, 128, 128],
  delayMs,
})

describe('DetailRequestSync', () => {
  it('倍率変更でviewportが一度無効になっても、新しい第1段を即時に出す', () => {
    const changes: Array<DetailRequest | null> = []
    const sync = new DetailRequestSync((next) => changes.push(next))

    sync.sync(request('scale-1'))
    sync.sync(null)
    sync.sync(request('scale-4'))

    expect(changes.map((next) => next?.key ?? null)).toEqual(['scale-1', null, 'scale-4'])
  })

  it('viewport更新後の同じkeyの再同期では60msタイマーを失わない', () => {
    vi.useFakeTimers()
    try {
      const changes: Array<DetailRequest | null> = []
      const sync = new DetailRequestSync((next) => changes.push(next))
      const next = request('scrolled-region', 60)

      sync.sync(next)
      vi.advanceTimersByTime(30)
      // React の再描画と effect cleanup に相当する同一状態の再評価。
      sync.sync({ ...next })
      vi.advanceTimersByTime(30)

      expect(changes.map((item) => item?.key ?? null)).toEqual(['scrolled-region'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('待機中に望ましい領域が変わると古い要求を捨て、新しい領域だけを出す', () => {
    vi.useFakeTimers()
    try {
      const changes: Array<DetailRequest | null> = []
      const sync = new DetailRequestSync((next) => changes.push(next))

      sync.sync(request('viewport-a', 60))
      vi.advanceTimersByTime(30)
      sync.sync(request('viewport-b', 60))
      vi.advanceTimersByTime(60)

      expect(changes.map((next) => next?.key ?? null)).toEqual(['viewport-b'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('500ms安全網は同じkeyを世代更新して出し直せる', () => {
    vi.useFakeTimers()
    try {
      const changes: Array<DetailRequest | null> = []
      const sync = new DetailRequestSync((next) => changes.push(next))

      sync.sync(request('missing', 60))
      expect(sync.recover()).toBe(true)
      expect(changes).toHaveLength(1)
      expect(changes[0]?.key).toBe('missing')
      expect(changes[0]?.generation).toBe(1)
      expect(sync.recover()).toBe(true)
      expect(changes[1]?.generation).toBe(2)
      vi.runAllTimers()
      expect(changes).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
