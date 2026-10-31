import { describe, expect, it } from 'vitest'
import {
  evaluateCondition,
  isMissingFact,
} from '../src/core/takeoff/conditions'

const eq = (field: string, value: unknown) => ({ field, op: 'eq', value })

describe('takeoff conditions', () => {
  it('evaluates all and any with three-valued logic', () => {
    const facts = { yes: true, no: false }
    expect(evaluateCondition({ all: [eq('yes', true), eq('missing', true)] }, facts).truth)
      .toBe('unknown')
    expect(evaluateCondition({ all: [eq('no', true), eq('missing', true)] }, facts).truth)
      .toBe('false')
    expect(evaluateCondition({ any: [eq('yes', true), eq('missing', true)] }, facts).truth)
      .toBe('true')
    expect(evaluateCondition({ any: [eq('no', true), eq('missing', true)] }, facts).truth)
      .toBe('unknown')
    expect(evaluateCondition({ all: [] }, facts).truth).toBe('true')
    expect(evaluateCondition({ any: [] }, facts).truth).toBe('false')
  })

  it('preserves missing facts and collects fields in encounter order', () => {
    const result = evaluateCondition({
      all: [eq('a', 1), eq('a', 2), eq('b', 1), eq('c', true)],
    }, { b: 0, c: false })
    expect(result.truth).toBe('false')
    expect(result.unknownFields).toEqual(['a'])
    expect(result.falseFields).toEqual(['b', 'c'])
    expect(evaluateCondition(eq('x', null), { x: null }).truth).toBe('unknown')
  })

  it('supports contains, both in shapes and deep equality', () => {
    expect(evaluateCondition(
      { field: 'x', op: 'contains', value: { a: 1 } },
      { x: [{ a: 1 }] },
    ).truth).toBe('true')
    expect(evaluateCondition(
      { field: 'x', op: 'contains', value: 'a' }, { x: 'abc' },
    ).truth).toBe('false')
    for (const key of ['value', 'values']) {
      expect(evaluateCondition(
        { field: 'x', op: 'in', [key]: [{ a: 1, b: 2 }] },
        { x: { b: 2, a: 1 } },
      ).truth).toBe('true')
    }
  })

  it('returns unsupported and unknown for unimplemented nodes', () => {
    const result = evaluateCondition({ field: 'x', op: 'gt', value: 0 }, { x: 2 })
    expect(result.truth).toBe('unknown')
    expect(result.unsupported[0]).toContain('gt')
    expect(result.unsupported[0]).toContain('field=x')
    expect(evaluateCondition({ predicate: eq('x', 1) }, { x: 1 }).truth).toBe('unknown')
  })

  it('does not follow inherited facts, including __proto__', () => {
    const inherited = Object.create({ inherited: true }) as Record<string, unknown>
    expect(evaluateCondition(eq('inherited', true), inherited).truth).toBe('unknown')
    expect(evaluateCondition(eq('__proto__', {}), {}).truth).toBe('unknown')
    expect(evaluateCondition(eq('constructor', Object), {}).truth).toBe('unknown')
  })

  it.each([undefined, null, '', '  ', []])('recognizes missing facts %s', value => {
    expect(isMissingFact(value)).toBe(true)
  })

  it('does not treat zero and false as missing', () => {
    expect(isMissingFact(0)).toBe(false)
    expect(isMissingFact(false)).toBe(false)
  })
})
