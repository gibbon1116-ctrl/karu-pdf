import { expect, it } from 'vitest'
import { FIXTURE_PRESETS, QUANTITY_METHODS, fixtureCode, nextCountStyle, serializeCountFixtures, parseCountFixtures, type CountFixture } from '../src/core/countFixtures'
import { QUANTITY_MASTER, masterEntries, normalizeMasterText, searchQuantityMaster } from '../src/core/quantityMaster'

// Keep first expansion in this test; subsequent assertions reuse the cached array.
it('expands at least 500 unique entries once within 50ms and searches within 5ms', () => {
  const start = performance.now(), entries = masterEntries(), elapsed = performance.now() - start
  expect(elapsed).toBeLessThan(50)
  expect(entries.length).toBeGreaterThanOrEqual(500)
  expect(new Set(entries.map(f => f.key)).size).toBe(entries.length)
  expect(masterEntries()).toBe(entries)
  const samples: number[] = []
  for (let i = 0; i < 100; i++) {
    const before = performance.now()
    searchQuantityMaster('60')
    samples.push(performance.now() - before)
  }
  samples.sort((a, b) => a - b)
  expect((samples[49] + samples[50]) / 2).toBeLessThan(5)
})

it('provides valid preset fields, methods, aggregation and PDF-compatible items in master order', () => {
  const entries = masterEntries(), style = nextCountStyle([])
  for (const f of entries) {
    const kind = f.kind ?? 'count'
    expect(QUANTITY_METHODS[kind]).toContain(f.method)
    expect(f.aggregation).toBe(kind === 'count' ? 'location' : 'document')
    expect(f.search).toBe(normalizeMasterText(`${f.field} ${f.category} ${f.type} ${f.code} ${f.spec ?? ''} ${f.name}`))
    expect(f.category).not.toBe('')
    expect(f.name).not.toBe('')
  }
  const fixtures: CountFixture[] = entries.map((f, order) => {
    const { category, code, spec, name, kind, method, defaults, aggregation } = f
    return { category, code, spec, name, kind, method, defaults, aggregation, id: String(order), order, style }
  })
  expect(parseCountFixtures(serializeCountFixtures(fixtures))).toHaveLength(entries.length)
  expect(entries.map(f => f.key)).toEqual(QUANTITY_MASTER.flatMap(t => (t.specs.length ? t.specs : ['']).map(spec => JSON.stringify([t.field, t.category, t.type, spec]))))
})

it('keeps the natural thickness/core and conduit order, including CV boundary rules', () => {
  const entries = masterEntries(), em = entries.filter(f => f.type === 'EM-CE')
  expect(em.slice(0, 6).map(f => f.spec)).toEqual(['2sq-2C', '2sq-3C', '2sq-4C', '3.5sq-2C', '3.5sq-3C', '3.5sq-4C'])
  expect([...new Set(em.map(f => Number(f.spec!.split('sq')[0])))]).toEqual([2, 3.5, 5.5, 8, 14, 22, 38, 60, 100, 150, 200, 250, 325])
  expect(em.filter(f => f.spec!.startsWith('14sq')).map(f => f.spec)).toEqual(['14sq-1C', '14sq-2C', '14sq-3C', '14sq-4C'])
  expect(em.filter(f => f.spec!.startsWith('150sq')).map(f => f.spec)).toEqual(['150sq-1C', '150sq-2C', '150sq-3C'])
  expect(em.slice(-2).map(f => f.spec)).toEqual(['325sq-1C', '325sq-3C'])
  expect(entries.filter(f => f.type === 'PF').map(f => f.code)).toEqual(['PF14', 'PF16', 'PF22', 'PF28', 'PF36', 'PF42'])
  expect(entries.filter(f => f.type === 'CV').map(f => f.spec)).toEqual(em.map(f => f.spec))
  expect(entries.filter(f => f.type === 'CVV').slice(0, 14).map(f => f.spec)).toEqual([
    '1.25sq-2C', '1.25sq-3C', '1.25sq-4C', '1.25sq-5C', '1.25sq-6C', '1.25sq-7C', '1.25sq-8C', '1.25sq-10C', '1.25sq-12C', '1.25sq-15C', '1.25sq-20C', '1.25sq-24C', '1.25sq-30C', '2sq-2C',
  ])
})

it('puts concat and replace specs in the code without a spec property', () => {
  const pf = masterEntries().find(f => f.code === 'PF22')!, coax = masterEntries().find(f => f.code === 'S-5C-FB')!
  expect(pf).not.toHaveProperty('spec')
  expect(coax).not.toHaveProperty('spec')
  expect(coax.type).toBe('同軸')
  expect(fixtureCode(pf)).toBe('PF22')
})

it('normalizes full-width text, multiplication and diameter symbols', () => {
  expect(normalizeMasterText(' ＣＶ ６０ｓｑ-３Ｃ ')).toBe('cv60sq-3c')
  expect(normalizeMasterText('４００ × ２５０')).toBe('400x250')
  expect(normalizeMasterText('400*250')).toBe('400x250')
  expect(normalizeMasterText('Φ１００ ø100 φ100')).toBe('φ100φ100φ100')
})

it('matches every normalized query term, returning the master order and full total', () => {
  const codes = searchQuantityMaster('60').entries.map(fixtureCode)
  expect(codes).toContain('EM-CE 60sq-3C')
  expect(codes).toContain('CV 60sq-3C')
  const em = searchQuantityMaster('em-ce 60').entries
  expect(em.some(f => fixtureCode(f) === 'EM-CE 60sq-3C')).toBe(true)
  expect(em.every(f => f.search.includes('em-ce') && f.codeSearch.includes('60'))).toBe(true)
  // Size terms match the code and spec only: "600V" in the formal name is not a 60sq hit.
  expect(em.some(f => fixtureCode(f) === 'EM-CE 2sq-2C')).toBe(false)
  expect(searchQuantityMaster('60').entries.some(f => fixtureCode(f) === 'CV 2sq-2C')).toBe(false)
  // CV alone is excluded; the exact code EM-CE ranks before EM-CET / EM-CEE.
  expect(em.some(f => f.code === 'CV')).toBe(false)
  const firstOther = em.findIndex(f => f.code !== 'EM-CE')
  expect(firstOther === -1 || em.slice(firstOther).every(f => f.code !== 'EM-CE')).toBe(true)
  expect(em[0].code).toBe('EM-CE')
  expect(searchQuantityMaster('pf22').entries.map(fixtureCode)).toEqual(['PF22'])
  expect(searchQuantityMaster('400x250')).toEqual(searchQuantityMaster('400×250'))
  expect(searchQuantityMaster('400*250')).toEqual(searchQuantityMaster('400×250'))
  expect(searchQuantityMaster('400x250').entries.some(f => f.name === '角ダクト')).toBe(true)
  expect(searchQuantityMaster('６０ｓｑ').entries.map(fixtureCode)).toContain('EM-CE 60sq-3C')
  expect(searchQuantityMaster('　ＥＭ－ＣＥ　６０ｓｑ　')).toEqual(searchQuantityMaster('em-ce 60sq'))
  expect(searchQuantityMaster('')).toEqual({ entries: [], total: 0 })
  expect(searchQuantityMaster(' \t\n　')).toEqual({ entries: [], total: 0 })
  expect(searchQuantityMaster('存在しない規格')).toEqual({ entries: [], total: 0 })
  const all = searchQuantityMaster('設備', 10000), limited = searchQuantityMaster('設備')
  expect(all.total).toBeGreaterThan(200)
  expect(limited.entries).toEqual(all.entries.slice(0, 200))
  expect(limited.total).toBe(all.total)
  expect(searchQuantityMaster('設備', 2).entries).toEqual(all.entries.slice(0, 2))
  expect(searchQuantityMaster('設備', 0)).toEqual({ entries: [], total: all.total })
})

it('keeps all eight legacy temporary/earthwork identities, kinds, methods and defaults', () => {
  const entries = masterEntries().filter(f => f.field === '仮設・土工' && !f.spec)
  expect(FIXTURE_PRESETS['仮設・土工']).toHaveLength(8)
  for (const f of FIXTURE_PRESETS['仮設・土工']) {
    const matches = entries.filter(e => e.code === f.code && e.name === f.name && e.category === f.category)
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ kind: f.kind, method: f.method, aggregation: f.aggregation })
    expect(matches[0].defaults).toEqual(f.defaults)
  }
})
