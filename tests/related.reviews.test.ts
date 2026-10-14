import { describe, expect, it } from 'vitest'
import mupdf, { type PDFDocument } from 'mupdf'
import {
  parseRelatedReviews,
  serializeRelatedReviews,
  readRelatedReviews,
  writeRelatedReviews,
  type RelatedReviews,
  type RelatedReviewDecision,
} from '../src/core/related/reviews'
import { readQuantityChecks, writeQuantityChecks } from '../src/core/quantityCheckBasics'

const empty = (): RelatedReviews => ({ version: 1, works: {}, decisions: {} })
const decision = (): RelatedReviewDecision => ({
  decision: '後で確認',
  ruleIds: ['E-001'],
  originFixtureIds: ['fixture-1'],
  rulesVersion: 'test-v1',
  decidedAt: '2026-10-13T09:00:00.000Z',
})

function rootString(doc: PDFDocument, key: string): string | null {
  const trailer = doc.getTrailer(), root = trailer.get('Root')
  try {
    const value = root.get(key)
    try { return value.isString() ? value.asString() : null }
    finally { value.destroy() }
  } finally { root.destroy(); trailer.destroy() }
}

function putRootString(doc: PDFDocument, key: string, text: string): void {
  const trailer = doc.getTrailer(), root = trailer.get('Root')
  const value = doc.newString(text)
  try { root.put(key, value) }
  finally { value.destroy(); root.destroy(); trailer.destroy() }
}

describe('RelatedReviews', () => {
  it('accepts objects and JSON, discards unknown keys and invalid values', () => {
    for (const raw of [undefined, null, [], 1, '{', { version: 2 }]) {
      expect(parseRelatedReviews(raw)).toEqual(empty())
    }
    const valid = decision()
    const raw = {
      version: 1,
      projectMode: '不明',
      unknown: true,
      works: { good: '新設', bad: '施工' },
      decisions: {
        good: { ...valid, unknown: 'discard' },
        badDecision: { ...valid, decision: '承認' },
        noRules: { ...valid, ruleIds: [] },
        noOrigins: { ...valid, originFixtureIds: null },
        noVersion: { ...valid, rulesVersion: '' },
        badDate: { ...valid, decidedAt: '2026-02-30T00:00:00Z' },
        badHour: { ...valid, decidedAt: '2026-10-13T25:00:00Z' },
        dateOnly: { ...valid, decidedAt: '2026-10-13' },
        badReason: { ...valid, reason: 'あ'.repeat(201) },
      },
    }
    const expected = {
      version: 1,
      works: { good: '新設' },
      decisions: { badReason: valid, good: valid },
    }
    expect(parseRelatedReviews(raw)).toEqual(expected)
    expect(parseRelatedReviews(JSON.stringify(raw))).toEqual(expected)
  })

  it('normalizes arrays, retains historical rule versions and supports context checks', () => {
    const value = parseRelatedReviews({
      version: 1,
      projectMode: '改修',
      works: {},
      decisions: {
        check: {
          ...decision(),
          ruleIds: ['E-002', 'E-001', 'E-002', '', 1, 'x'.repeat(33)],
          originFixtureIds: [],
          reason: 'あ'.repeat(200),
          rulesVersion: 'older-version',
          decidedAt: '2026-10-13T18:00:00+09:00',
        },
      },
    })
    expect(value.decisions.check.ruleIds).toEqual(['E-001', 'E-002'])
    expect(value.decisions.check.originFixtureIds).toEqual([])
    expect(value.decisions.check.reason).toHaveLength(200)
    expect(value.decisions.check.rulesVersion).toBe('older-version')
  })

  it('retains valid assignees only for other-work decisions', () => {
    const assignees = [
      '建築', '電気設備', '機械設備', '別途工事', 'その他',
    ] as const
    for (const assignee of assignees) {
      const saved: RelatedReviewDecision = {
        ...decision(), decision: '他工事', assignee,
      }
      const reviews: RelatedReviews = {
        ...empty(), decisions: { key: saved },
      }
      expect(parseRelatedReviews(reviews).decisions.key).toEqual(saved)
      expect(parseRelatedReviews(JSON.stringify(reviews)).decisions.key).toEqual(saved)
      expect(JSON.parse(serializeRelatedReviews(reviews)).decisions.key).toEqual(saved)
      expect(parseRelatedReviews(serializeRelatedReviews(reviews))).toEqual(reviews)
    }

    for (const value of [
      '必要', '不要', '単価包含', '後で確認', '構成要素で拾う',
    ] as const) {
      const saved: RelatedReviewDecision = {
        ...decision(), decision: value, assignee: '機械設備',
      }
      const reviews: RelatedReviews = {
        ...empty(), decisions: { key: saved },
      }
      const expected = { ...decision(), decision: value }
      expect(parseRelatedReviews(reviews).decisions.key).toEqual(expected)
      expect(JSON.parse(serializeRelatedReviews(reviews)).decisions.key).toEqual(expected)
    }
  })

  it('discards invalid assignees without discarding the decision', () => {
    const expected: RelatedReviewDecision = {
      ...decision(), decision: '他工事',
    }
    for (const assignee of [undefined, null, '', '土木', 1, {}, []]) {
      const raw = {
        ...empty(),
        decisions: { key: { ...expected, assignee } },
      }
      expect(parseRelatedReviews(raw).decisions.key).toEqual(expected)
      expect(parseRelatedReviews(JSON.stringify(raw)).decisions.key).toEqual(expected)
      expect(JSON.parse(serializeRelatedReviews(raw as RelatedReviews)).decisions.key)
        .toEqual(expected)
    }
  })

  it('caps works, decisions, rules and origins', () => {
    const works = Object.fromEntries(Array.from({ length: 1001 }, (_, i) =>
      [`f-${String(i).padStart(4, '0')}`, '新設']))
    const decisions = Object.fromEntries(Array.from({ length: 5001 }, (_, i) =>
      [`k-${String(i).padStart(4, '0')}`, decision()]))
    const parsed = parseRelatedReviews({ version: 1, works, decisions })
    expect(Object.keys(parsed.works)).toHaveLength(1000)
    expect(Object.keys(parsed.decisions)).toHaveLength(5000)
    expect(parsed.works['f-1000']).toBeUndefined()
    expect(parsed.decisions['k-5000']).toBeUndefined()

    const arrays = parseRelatedReviews({
      version: 1, works: {}, decisions: {
        key: {
          ...decision(),
          ruleIds: Array.from({ length: 21 }, (_, i) => `E-${i}`),
          originFixtureIds: Array.from({ length: 51 }, (_, i) => `f-${i}`),
        },
      },
    })
    expect(arrays.decisions.key.ruleIds).toHaveLength(20)
    expect(arrays.decisions.key.originFixtureIds).toHaveLength(50)
  })

  it('serializes normalized data deterministically and rejects invalid known fields', () => {
    const raw = {
      version: 1,
      projectMode: '改修',
      works: { z: '撤去処分', a: '新設' },
      decisions: {
        key: {
          ...decision(),
          ruleIds: ['E-002', 'E-001', 'E-001'],
          originFixtureIds: ['z', 'a', 'z'],
          unknown: true,
        },
      },
      unknown: true,
    }
    const json = serializeRelatedReviews(raw as RelatedReviews)
    expect(JSON.parse(json)).toEqual({
      version: 1,
      projectMode: '改修',
      works: { a: '新設', z: '撤去処分' },
      decisions: {
        key: {
          ...decision(),
          ruleIds: ['E-001', 'E-002'],
          originFixtureIds: ['a', 'z'],
        },
      },
    })
    expect(serializeRelatedReviews(parseRelatedReviews(json))).toBe(json)
    const invalidValues: unknown[] = [
      null,
      { version: 2, works: {}, decisions: {} },
      { ...empty(), projectMode: '不明' },
      { ...empty(), works: { f: '不明' } },
      { ...empty(), decisions: { key: { ...decision(), ruleIds: [] } } },
      { ...empty(), decisions: { key: { ...decision(), reason: 'x'.repeat(201) } } },
      { ...empty(), decisions: { key: { ...decision(), ruleIds: ['x'.repeat(33)] } } },
      { ...empty(), decisions: { key: { ...decision(), originFixtureIds: [1] } } },
      { ...empty(), decisions: { key: { ...decision(), decidedAt: 'invalid' } } },
      {
        ...empty(),
        works: Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`f-${i}`, '新設'])),
      },

      {
        ...empty(),
        decisions: { key: { ...decision(), ruleIds: Array.from({ length: 21 }, (_, i) => `R-${i}`) } },
      },
      {
        ...empty(),
        decisions: { key: { ...decision(), originFixtureIds: Array.from({ length: 51 }, (_, i) => `f-${i}`) } },
      },
    ]
    for (const invalid of invalidValues) {
      expect(() => serializeRelatedReviews(invalid as RelatedReviews)).toThrow()
    }
  })

  it('expands legacy item, check and note decisions into one decision per origin', () => {
    const keys = [
      'item:["電気設備",[["保護管",""]],""]',
      'check:E-016',
      'note:E-040',
    ]
    for (const key of keys) {
      const legacy = {
        ...decision(),
        decision: '他工事' as const,
        assignee: '電気設備' as const,
        reason: '既存の判断',
        originFixtureIds: ['b', 'a', 'a'],
      }
      const raw: RelatedReviews = {
        ...empty(), decisions: { [key]: legacy },
      }
      const before = JSON.stringify(raw)
      const expected: RelatedReviews = {
        ...empty(),
        decisions: {
          [`${key}@a`]: { ...legacy, originFixtureIds: ['a'] },
          [`${key}@b`]: { ...legacy, originFixtureIds: ['b'] },
        },
      }
      expect(parseRelatedReviews(raw)).toEqual(expected)
      expect(parseRelatedReviews(JSON.stringify(raw))).toEqual(expected)
      expect(JSON.stringify(raw)).toBe(before)
      expect(Object.hasOwn(parseRelatedReviews(raw).decisions, key)).toBe(false)

      const json = serializeRelatedReviews(raw)
      expect(JSON.parse(json)).toEqual(expected)
      expect(parseRelatedReviews(json)).toEqual(expected)
      expect(serializeRelatedReviews(parseRelatedReviews(json))).toBe(json)
    }
  })

  it('retains originless context decisions and keys outside legacy migration', () => {
    const context = { ...decision(), originFixtureIds: [] }
    const raw: RelatedReviews = {
      ...empty(),
      decisions: {
        'check:B-context': context,
        'note:B-context': context,
        'item:originless': context,
        'check:E-016@fixture-1': decision(),
        'hint:work': decision(),
        other: decision(),
      },
    }
    expect(parseRelatedReviews(raw)).toEqual(raw)
    expect(parseRelatedReviews(serializeRelatedReviews(raw))).toEqual(raw)
  })

  it('prefers an existing scoped decision even when the legacy decision is newer', () => {
    const key = 'item:["電気設備",[["保護管",""]],""]'
    const legacy = {
      ...decision(),
      originFixtureIds: ['a', 'b'],
      decidedAt: '2026-10-14T09:00:00Z',
    }
    const existing: RelatedReviewDecision = {
      ...decision(),
      decision: '不要',
      originFixtureIds: ['a'],
      reason: '起点 A の個別判断',
      decidedAt: '2026-10-12T09:00:00Z',
    }
    for (const entries of [
      [[key, legacy], [`${key}@a`, existing]],
      [[`${key}@a`, existing], [key, legacy]],
    ] as Array<Array<[string, RelatedReviewDecision]>>) {
      const raw: RelatedReviews = {
        ...empty(), decisions: Object.fromEntries(entries),
      }
      const parsed = parseRelatedReviews(raw)
      expect(Object.keys(parsed.decisions)).toHaveLength(2)
      expect(parsed.decisions[`${key}@a`]).toEqual(existing)
      expect(parsed.decisions[`${key}@b`])
        .toEqual({ ...legacy, originFixtureIds: ['b'] })
      expect(parseRelatedReviews(serializeRelatedReviews(raw))).toEqual(parsed)
    }
  })

  it('applies the decision limit after expansion and drops the oldest timestamps', () => {
    const origins = Array.from({ length: 50 }, (_, i) =>
      `f-${String(i).padStart(2, '0')}`)
    const entries: Array<[string, RelatedReviewDecision]> = Array.from(
      { length: 101 },
      (_, i) => [
        `check:R-${String(i).padStart(3, '0')}`,
        {
          ...decision(),
          originFixtureIds: [...origins],
          decidedAt: new Date(Date.UTC(2026, 9, 13, 0, 0, i)).toISOString(),
        },
      ],
    )
    const raw: RelatedReviews = {
      ...empty(), decisions: Object.fromEntries(entries),
    }
    const parsed = parseRelatedReviews(raw)
    expect(Object.keys(parsed.decisions)).toHaveLength(5000)
    for (const origin of origins) {
      expect(parsed.decisions[`check:R-000@${origin}`]).toBeUndefined()
      expect(parsed.decisions[`check:R-001@${origin}`]?.originFixtureIds)
        .toEqual([origin])
      expect(parsed.decisions[`check:R-100@${origin}`]?.originFixtureIds)
        .toEqual([origin])
    }
    expect(Object.keys(parsed.decisions).every(key => key.includes('@'))).toBe(true)
    expect(JSON.parse(serializeRelatedReviews(raw))).toEqual(parsed)
    expect(parseRelatedReviews(serializeRelatedReviews(parsed))).toEqual(parsed)
  })

  it('compares actual timestamps rather than date strings when limiting decisions', () => {
    const decisions = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [
      `check:R-${String(i).padStart(4, '0')}@fixture-1`,
      decision(),
    ]))
    const newestKey = 'check:ZZ-newest@fixture-1'
    decisions[newestKey] = {
      ...decision(),
      decidedAt: '2026-10-13T19:00:00+09:00',
    }
    const parsed = parseRelatedReviews({ ...empty(), decisions })
    expect(Object.keys(parsed.decisions)).toHaveLength(5000)
    expect(parsed.decisions[newestKey]).toEqual(decisions[newestKey])
    expect(parsed.decisions['check:R-4999@fixture-1']).toBeUndefined()
    expect(parsed.decisions['check:R-0000@fixture-1']).toBeDefined()
  })

  it('keeps special record keys as own data without changing prototypes', () => {
    const raw = JSON.parse(JSON.stringify({
      version: 1,
      works: Object.fromEntries([['__proto__', '新設'], ['constructor', '仮設']]),
      decisions: Object.fromEntries([['__proto__', decision()]]),
    }))
    const parsed = parseRelatedReviews(raw)
    expect(Object.hasOwn(parsed.works, '__proto__')).toBe(true)
    expect(Object.hasOwn(parsed.decisions, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(parsed.works)).toBe(Object.prototype)
    expect(parseRelatedReviews(serializeRelatedReviews(parsed))).toEqual(parsed)
  })

  it('reads and writes a Root string, deletes empty data and preserves other keys', () => {
    const doc = new mupdf.PDFDocument()
    try {
      expect(readRelatedReviews(doc)).toEqual(empty())
      writeQuantityChecks(doc, { values: { buildingArea: 123 } })
      putRootString(doc, 'KaruCountFixtures', 'fixture-sentinel')
      putRootString(doc, 'R2TestOther', 'other-sentinel')
      const reviews: RelatedReviews = {
        version: 1, projectMode: '改修',
        works: { 'fixture-1': '更新・交換' },
        decisions: { key: decision() },
      }
      writeRelatedReviews(doc, reviews)
      expect(rootString(doc, 'KaruRelatedReviews')).toBe(serializeRelatedReviews(reviews))
      expect(readRelatedReviews(doc)).toEqual(reviews)
      expect(readQuantityChecks(doc)).toEqual({ values: { buildingArea: 123 } })
      expect(rootString(doc, 'KaruCountFixtures')).toBe('fixture-sentinel')
      expect(rootString(doc, 'R2TestOther')).toBe('other-sentinel')

      writeRelatedReviews(doc, { ...empty(), projectMode: '混在' })
      expect(rootString(doc, 'KaruRelatedReviews')).not.toBeNull()
      writeRelatedReviews(doc, empty())
      expect(rootString(doc, 'KaruRelatedReviews')).toBeNull()
      expect(readRelatedReviews(doc)).toEqual(empty())
      expect(readQuantityChecks(doc)).toEqual({ values: { buildingArea: 123 } })
      expect(rootString(doc, 'KaruCountFixtures')).toBe('fixture-sentinel')
      expect(rootString(doc, 'R2TestOther')).toBe('other-sentinel')

      putRootString(doc, 'KaruRelatedReviews', '{')
      expect(readRelatedReviews(doc)).toEqual(empty())
    } finally { doc.destroy() }
  })

  it('reads legacy PDF data and writes only expanded keys without changing other Root data', () => {
    const doc = new mupdf.PDFDocument()
    try {
      const key = 'item:["電気設備",[["保護管",""]],""]'
      const legacy: RelatedReviews = {
        ...empty(),
        decisions: {
          [key]: { ...decision(), originFixtureIds: ['a', 'b'] },
        },
      }
      putRootString(doc, 'KaruRelatedReviews', JSON.stringify(legacy))
      putRootString(doc, 'R7aTestOther', 'sentinel')
      const parsed = readRelatedReviews(doc)
      expect(Object.keys(parsed.decisions)).toEqual([`${key}@a`, `${key}@b`])
      writeRelatedReviews(doc, parsed)
      const saved = JSON.parse(rootString(doc, 'KaruRelatedReviews')!)
      expect(saved).toEqual(parsed)
      expect(Object.hasOwn(saved.decisions, key)).toBe(false)
      expect(rootString(doc, 'R7aTestOther')).toBe('sentinel')
    } finally { doc.destroy() }
  })

  it('leaves a saved Root value intact if a write fails validation', () => {
    const doc = new mupdf.PDFDocument()
    try {
      const initial = { ...empty(), projectMode: '改修' as const }
      writeRelatedReviews(doc, initial)
      const before = rootString(doc, 'KaruRelatedReviews')
      expect(() => writeRelatedReviews(doc, {
        ...empty(), decisions: { key: { ...decision(), ruleIds: [] } },
      })).toThrow()
      expect(rootString(doc, 'KaruRelatedReviews')).toBe(before)
    } finally { doc.destroy() }
  })

  it('round-trips through actual PDF bytes', () => {
    const doc = new mupdf.PDFDocument()
    try {
      const resources = doc.newDictionary()
      try {
        const page = doc.addPage([0, 0, 300, 400], 0, resources, '')
        try { doc.insertPage(-1, page) }
        finally { page.destroy() }
      } finally { resources.destroy() }
      const reviews: RelatedReviews = {
        version: 1, projectMode: '改修',
        works: { f: '新設' },
        decisions: {
          key: decision(),
          other: { ...decision(), decision: '他工事', assignee: '機械設備' },
        },
      }
      writeRelatedReviews(doc, reviews)
      const buffer = doc.saveToBuffer('garbage=4')
      try {
        const reopened = mupdf.Document.openDocument(buffer.asUint8Array(), 'application/pdf')
        try {
          const pdf = reopened.asPDF()
          if (!pdf) throw new Error('PDF として再読込できませんでした。')
          expect(readRelatedReviews(pdf)).toEqual(reviews)
        } finally { reopened.destroy() }
      } finally { buffer.destroy() }
    } finally { doc.destroy() }
  })
})
