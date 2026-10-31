import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const KEY = 'karu-pdf:group-by-breakdown'
const TABLE_KEY = 'karu-pdf:quantity-table-group-by-breakdown-v2'
const PANEL_KEY = 'karu-pdf:fixture-panel-group-by-breakdown'

let values: Map<string, string>

function createStorage() {
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
  }
}

beforeEach(() => {
  vi.resetModules()
  values = new Map()
  vi.stubGlobal('localStorage', createStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('breakdown grouping preference', () => {
  it('defaults to true and persists the initial value once', async () => {
    const storage = createStorage()
    vi.stubGlobal('localStorage', storage)
    const preference = await import('../src/app/breakdownGroupingPreference')

    expect(preference.getGroupByBreakdown()).toBe(true)
    expect(values.get(KEY)).toBe('true')
    expect(preference.getGroupByBreakdown()).toBe(true)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    expect(storage.getItem).toHaveBeenCalledTimes(3)
  })

  it.each([
    ['false', undefined, false],
    [undefined, 'false', false],
    ['true', 'false', false],
    ['false', 'true', false],
    ['false', 'false', false],
    [undefined, undefined, true],
    ['true', 'true', true],
  ] as const)(
    'migrates table=%s and panel=%s to %s',
    async (table, panel, expected) => {
      if (table !== undefined) values.set(TABLE_KEY, table)
      if (panel !== undefined) values.set(PANEL_KEY, panel)
      const preference = await import('../src/app/breakdownGroupingPreference')

      expect(preference.getGroupByBreakdown()).toBe(expected)
      expect(values.get(KEY)).toBe(String(expected))
      expect(values.get(TABLE_KEY)).toBe(table)
      expect(values.get(PANEL_KEY)).toBe(panel)
    },
  )

  it.each([true, false])('prefers the new saved value %s over legacy values', async value => {
    values.set(KEY, String(value))
    values.set(TABLE_KEY, String(!value))
    values.set(PANEL_KEY, String(!value))
    const storage = createStorage()
    vi.stubGlobal('localStorage', storage)
    const preference = await import('../src/app/breakdownGroupingPreference')

    expect(preference.getGroupByBreakdown()).toBe(value)
    expect(storage.getItem).toHaveBeenCalledTimes(1)
    expect(storage.getItem).toHaveBeenCalledWith(KEY)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('ignores the obsolete table key without the v2 suffix', async () => {
    values.set('karu-pdf:quantity-table-group-by-breakdown', 'false')
    const preference = await import('../src/app/breakdownGroupingPreference')

    expect(preference.getGroupByBreakdown()).toBe(true)
    expect(values.get(KEY)).toBe('true')
  })

  it('notifies subscribers after updating the snapshot and supports unsubscribe', async () => {
    const preference = await import('../src/app/breakdownGroupingPreference')
    expect(preference.getGroupByBreakdown()).toBe(true)
    const snapshots: boolean[] = []
    const first = vi.fn(() => { snapshots.push(preference.getGroupByBreakdown()) })
    const second = vi.fn()
    const unsubscribeFirst = preference.subscribeGroupByBreakdown(first)
    const unsubscribeSecond = preference.subscribeGroupByBreakdown(second)

    preference.setGroupByBreakdown(false)
    expect(preference.getGroupByBreakdown()).toBe(false)
    expect(values.get(KEY)).toBe('false')
    expect(snapshots).toEqual([false])
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)

    preference.setGroupByBreakdown(false)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)

    unsubscribeFirst()
    unsubscribeFirst()
    preference.setGroupByBreakdown(true)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
    expect(values.get(KEY)).toBe('true')

    unsubscribeSecond()
    preference.setGroupByBreakdown(false)
    expect(second).toHaveBeenCalledTimes(2)
  })

  it('uses memory and notifies subscribers when storage reads and writes throw', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => { throw new Error('read denied') }),
      setItem: vi.fn(() => { throw new Error('write denied') }),
    })
    const preference = await import('../src/app/breakdownGroupingPreference')
    const listener = vi.fn()
    const unsubscribe = preference.subscribeGroupByBreakdown(listener)

    expect(preference.getGroupByBreakdown()).toBe(true)
    expect(() => preference.setGroupByBreakdown(false)).not.toThrow()
    expect(preference.getGroupByBreakdown()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(() => preference.setGroupByBreakdown(true)).not.toThrow()
    expect(preference.getGroupByBreakdown()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('retains the migrated false value when only storage writes throw', async () => {
    values.set(PANEL_KEY, 'false')
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn(() => { throw new Error('write denied') }),
    })
    const preference = await import('../src/app/breakdownGroupingPreference')

    expect(preference.getGroupByBreakdown()).toBe(false)
    expect(() => preference.setGroupByBreakdown(true)).not.toThrow()
    expect(preference.getGroupByBreakdown()).toBe(true)
  })

  it('works when localStorage is unavailable', async () => {
    vi.stubGlobal('localStorage', undefined)
    const preference = await import('../src/app/breakdownGroupingPreference')
    const listener = vi.fn()
    const unsubscribe = preference.subscribeGroupByBreakdown(listener)

    expect(preference.getGroupByBreakdown()).toBe(true)
    expect(() => preference.setGroupByBreakdown(false)).not.toThrow()
    expect(preference.getGroupByBreakdown()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })
})
