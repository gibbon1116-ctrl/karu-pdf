import { describe, expect, it } from 'vitest'
import { DEFAULT_FORMAT, FORMAT_STORAGE_KEY, loadFormatDefaults, saveFormatDefaults, updateToolFormat } from '../src/editor/formatDefaults'

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
  it('ツールごとの値を独立して保存して読み出す', () => {
    const storage = new MemoryStorage()
    const value = updateToolFormat(updateToolFormat(DEFAULT_FORMAT, 'line', { borderWidth: 3 }), 'text', { font: 'BIZUDMincho', fontSize: 14 })
    saveFormatDefaults(value, storage)
    expect(loadFormatDefaults(storage)).toEqual(value)
    expect(value.highlight.borderWidth).toBe(12)
  })

  it('旧版の値を全ツールへ引き継ぐ', () => {
    const storage = new MemoryStorage()
    storage.setItem(FORMAT_STORAGE_KEY, JSON.stringify({ color: [0, 0.25, 1], borderWidth: 2, fontSize: 12 }))
    const loaded = loadFormatDefaults(storage)
    expect(loaded.text).toMatchObject({ color: [0, 0.25, 1], fontSize: 12 })
    expect(loaded.line).toMatchObject({ color: [0, 0.25, 1], borderWidth: 2 })
  })

  it('壊れた値では項目ごとに既定値へ戻す', () => {
    const storage = new MemoryStorage()
    storage.setItem(FORMAT_STORAGE_KEY, JSON.stringify({ text: { color: 'red', fontSize: null }, line: { borderWidth: 2 } }))
    const loaded = loadFormatDefaults(storage)
    expect(loaded.text.color).toEqual(DEFAULT_FORMAT.text.color)
    expect(loaded.text.fontSize).toBe(DEFAULT_FORMAT.text.fontSize)
    expect(loaded.line.borderWidth).toBe(2)
  })

  it('Storageが例外を投げても落ちない', () => {
    const storage = { getItem: () => { throw new Error('read') }, setItem: () => { throw new Error('write') } } as unknown as Storage
    expect(loadFormatDefaults(storage)).toEqual(DEFAULT_FORMAT)
    expect(() => saveFormatDefaults(DEFAULT_FORMAT, storage)).not.toThrow()
  })
})
