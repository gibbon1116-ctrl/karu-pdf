import { describe, expect, it } from 'vitest'
import { stableJson } from '../src/core/stableJson'

describe('stableJson', () => {
  it('sorts object keys at every depth without changing the input', () => {
    const left = { z: 1, a: { y: 2, b: 3 } }
    expect(stableJson(left)).toBe(stableJson({ a: { b: 3, y: 2 }, z: 1 }))
    expect(Object.keys(left)).toEqual(['z', 'a'])
  })

  it('omits undefined properties and retains JSON array positions', () => {
    expect(stableJson({ a: undefined, nested: { b: undefined, c: null } })).toBe('{"nested":{"c":null}}')
    expect(stableJson([undefined, { a: undefined, b: 1 }])).toBe('[null,{"b":1}]')
  })

  it('preserves array order', () => {
    expect(stableJson([{ b: 2, a: 1 }, 3])).toBe('[{"a":1,"b":2},3]')
    expect(stableJson([1, 2])).not.toBe(stableJson([2, 1]))
  })
})
