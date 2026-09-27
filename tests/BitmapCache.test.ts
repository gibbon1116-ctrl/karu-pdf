import { describe, expect, it, vi } from 'vitest'
import { BitmapCache } from '../src/viewer/BitmapCache'

function bitmap(width: number, height: number) {
  return { width, height, close: vi.fn() }
}

describe('BitmapCache', () => {
  it('容量超過時にLRU順でcloseして追い出す', () => {
    const cache = new BitmapCache<ReturnType<typeof bitmap>>(32)
    const a = bitmap(2, 2)
    const b = bitmap(2, 2)
    const c = bitmap(2, 2)
    cache.set('a', a)
    cache.set('b', b)
    expect(cache.get('a')).toBe(a)
    cache.set('c', c)
    expect(b.close).toHaveBeenCalledOnce()
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe(a)
  })

  it('clearで全ビットマップをcloseする', () => {
    const cache = new BitmapCache<ReturnType<typeof bitmap>>(100)
    const a = bitmap(2, 2)
    cache.set('a', a)
    cache.clear()
    expect(a.close).toHaveBeenCalledOnce()
    expect(cache.usedBytes).toBe(0)
  })
})
