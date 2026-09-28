import { describe, expect, it } from 'vitest'
import { DEFAULT_FORMAT, FORMAT_STORAGE_KEY, loadFormatDefaults, saveFormatDefaults } from '../src/editor/formatDefaults'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

describe('formatDefaults', () => {
  it('保存して読み出す', () => {
    const storage = new MemoryStorage()
    const value = { color: [0, 0.25, 1] as [number, number, number], borderWidth: 3, fontSize: 14 }
    saveFormatDefaults(value, storage)
    expect(loadFormatDefaults(storage)).toEqual(value)
  })

  it('壊れた値では項目ごとに既定値へ戻す', () => {
    const storage = new MemoryStorage()
    storage.setItem(FORMAT_STORAGE_KEY, JSON.stringify({ color: 'red', borderWidth: 2, fontSize: null }))
    expect(loadFormatDefaults(storage)).toEqual({ color: DEFAULT_FORMAT.color, borderWidth: 2, fontSize: DEFAULT_FORMAT.fontSize })
  })

  it('Storageが例外を投げても落ちない', () => {
    const storage = {
      getItem: () => { throw new Error('read') },
      setItem: () => { throw new Error('write') },
    } as unknown as Storage
    expect(loadFormatDefaults(storage)).toEqual(DEFAULT_FORMAT)
    expect(() => saveFormatDefaults(DEFAULT_FORMAT, storage)).not.toThrow()
  })
})
