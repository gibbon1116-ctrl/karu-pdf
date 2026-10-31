import { describe, expect, it } from 'vitest'
import type { FormulaId } from '../src/core/takeoff/types'
import { calculateFormula } from '../src/core/takeoff/kernels'

interface Example {
  formula: FormulaId
  unit: string
  body: Record<string, unknown>
  expected: string
}

const si = (rows: unknown[]) => ({
  rows, dimensions_unit: 'SI', deductions: '0', additions: '0',
})

const examples: Example[] = [
  {
    formula: 'F_MANUAL', unit: 'm',
    body: { value: '5285', input_unit: 'mm', measurement_evidence_id: 'TEST-MEASURE' },
    expected: '5.285',
  },
  {
    formula: 'F_SAME', unit: 'm',
    body: { value: '2', source_unit: 'm', same_object_scope_basis: true },
    expected: '2',
  },
  {
    formula: 'F_SUBSET', unit: 'm',
    body: { rows: [{ id: 'a', value: '0.1' }, { id: 'b', value: '0.2' }], source_unit: 'm' },
    expected: '0.3',
  },
  {
    formula: 'F_UNIQUE', unit: 'm',
    body: { rows: [{ id: 'a', value: '2' }, { id: 'a', value: '2' }] },
    expected: '2',
  },
  {
    formula: 'F_COUNT', unit: '台',
    body: { object_ids: ['a', 'b', 'a'], survey_complete: true },
    expected: '2',
  },
  {
    formula: 'F_FACTOR', unit: '個',
    body: {
      rows: [{ id: 'a', source: '2', factor: '3' }],
      source_unit: '台', factor_unit: '個/台', coefficient_approved: true,
    },
    expected: '6',
  },
  { formula: 'F_RECT', unit: 'm2', body: si([{ id: 'a', w: 2, h: 1, L: 3 }]), expected: '18' },
  {
    formula: 'F_ROUND', unit: 'm2',
    body: si([{ id: 'a', D: 1, L: 1 }]),
    expected: '3.141592653589793238462643383279',
  },
  { formula: 'F_WALL', unit: 'm2', body: si([{ id: 'a', L: 3, h: 2 }]), expected: '6' },
  { formula: 'F_UP', unit: 'm2', body: si([{ id: 'a', L: 3, h: 0.2 }]), expected: '0.6' },
  { formula: 'F_THICK', unit: 'm3', body: si([{ id: 'a', A: 3, t: 0.2 }]), expected: '0.6' },
  { formula: 'F_SAND', unit: 'm3', body: si([{ id: 'a', A: 3, t: 0.2 }]), expected: '0.6' },
  { formula: 'F_TRENCH', unit: 'm3', body: si([{ id: 'a', L: 3, w: 2, d: 0.5 }]), expected: '3' },
  { formula: 'F_PIT', unit: 'm3', body: si([{ id: 'a', A: 3, d: 0.5 }]), expected: '1.5' },
  {
    formula: 'F_BACK', unit: 'm3',
    body: { excavation: '10', displacements: [{ id: 'a', volume: '3' }] },
    expected: '7',
  },
  {
    formula: 'F_DIFF', unit: 'm3',
    body: { A: '10', B: '3', same_dimension_scope_basis: true },
    expected: '7',
  },
  {
    formula: 'F_MASS', unit: 'kg',
    body: { value: '3', source_unit: 'm', unit_mass: '4', unit_mass_basis: 'kg/m' },
    expected: '12',
  },
  { formula: 'F_TON', unit: 't', body: { value: '1250', source_unit: 'kg' }, expected: '1.25' },
  {
    formula: 'F_EDGE', unit: 'm',
    body: { rows: [{ id: 'a', value: '2' }, { id: 'b', value: '3' }] },
    expected: '5',
  },
  { formula: 'F_SURFACE', unit: 'm2', body: si([{ id: 'a', A: 3 }]), expected: '3' },
]

describe('takeoff 24 formula kernels', () => {
  it.each(examples)('$formula calculates its contract', example => {
    const result = calculateFormula({
      formula: example.formula, targetUnit: example.unit, body: example.body,
    })
    expect(result.status).toBe('CALCULATED')
    expect(result.value).toBe(example.expected)
    expect(result.unit).toBe(example.unit)
  })

  it.each(examples)('$formula does not manufacture missing inputs', example => {
    const result = calculateFormula({
      formula: example.formula, targetUnit: example.unit, body: {},
    })
    expect(result.status).toBe('INPUT_REQUIRED')
    expect(result.value).toBeNull()
    expect(result.missing.length).toBeGreaterThan(0)
  })

  it.each(['F_UNION', 'F_DESIGN', 'F_DUCT_RECT_EST'] as const)(
    '%s remains unsupported without the required execution path',
    formula => {
      expect(calculateFormula({ formula, targetUnit: 'm2', body: {} }).status)
        .toBe('UNSUPPORTED')
    },
  )

  it('F_CHECK has no quantity', () => {
    const result = calculateFormula({ formula: 'F_CHECK', targetUnit: '', body: {} })
    expect(result.status).toBe('NO_QUANTITY')
    expect(result.value).toBeNull()
  })

  it('does not equate quantities solely because their units match', () => {
    const result = calculateFormula({
      formula: 'F_SAME', targetUnit: 'm',
      body: { value: 2, source_unit: 'm' },
    })
    expect(result.status).toBe('INPUT_REQUIRED')
    expect(result.missing).toContain('same_object_scope_basis')
  })

  it('rejects excess deductions before additions can hide them', () => {
    const result = calculateFormula({
      formula: 'F_WALL', targetUnit: 'm2',
      body: { ...si([{ id: 'a', L: 1, h: 1 }]), deductions: 2, additions: 10 },
    })
    expect(result.status).toBe('INVALID')
    expect(result.value).toBeNull()
    expect(result.errors.join(' ')).toContain('控除が対象を超えています')
  })

  it('collects multiple missing row inputs and explicit adjustments', () => {
    const result = calculateFormula({
      formula: 'F_WALL', targetUnit: 'm2',
      body: { rows: [{ id: 'a' }, { id: 'b', L: 2 }], dimensions_unit: 'SI' },
    })
    expect(result.missing).toEqual(expect.arrayContaining([
      'rows[0].L', 'rows[0].h', 'rows[1].h', 'deductions', 'additions',
    ]))
  })

  it('rejects conflicting unique lengths and repeated selected edges', () => {
    for (const formula of ['F_UNIQUE', 'F_EDGE', 'F_SUBSET'] as const) {
      expect(calculateFormula({
        formula, targetUnit: 'm',
        body: {
          source_unit: 'm',
          rows: [{ id: 'a', value: 1 }, { id: 'a', value: 2 }],
        },
      }).status).toBe('INVALID')
    }
  })

  it('requires survey completion and warns about repeated IDs', () => {
    expect(calculateFormula({
      formula: 'F_COUNT', targetUnit: '台',
      body: { object_ids: ['a'], survey_complete: false },
    }).status).toBe('INPUT_REQUIRED')
    expect(calculateFormula({
      formula: 'F_COUNT', targetUnit: '台',
      body: { object_ids: ['a', 'a'], survey_complete: true },
    }).warnings.join(' ')).toContain('a')
  })

  it('rejects nonpositive dimensions, negative quantities and wrong dimensions', () => {
    expect(calculateFormula({
      formula: 'F_WALL', targetUnit: 'm2',
      body: si([{ id: 'a', L: 0, h: 1 }]),
    }).status).toBe('INVALID')
    expect(calculateFormula({
      formula: 'F_WALL', targetUnit: 'm',
      body: si([{ id: 'a', L: 1, h: 1 }]),
    }).status).toBe('INVALID')
    expect(calculateFormula({
      formula: 'F_TON', targetUnit: 't', body: { value: -1, source_unit: 'kg' },
    }).status).toBe('INVALID')
  })

  it('accepts explicit zero quantities but not nonfinite values', () => {
    expect(calculateFormula({
      formula: 'F_TON', targetUnit: 't', body: { value: 0, source_unit: 'kg' },
    }).value).toBe('0')
    for (const value of [NaN, Infinity, '']) {
      expect(calculateFormula({
        formula: 'F_TON', targetUnit: 't', body: { value, source_unit: 'kg' },
      }).value).toBeNull()
    }
  })

  it('checks evidence and unit contracts', () => {
    expect(calculateFormula({
      formula: 'F_MANUAL', targetUnit: 'm', body: { value: 1, input_unit: 'm' },
    }).missing).toContain('measurement_evidence_id')
    expect(calculateFormula({
      formula: 'F_MANUAL', targetUnit: '個',
      body: { value: 1, input_unit: '台', measurement_evidence_id: 'TEST' },
    }).status).toBe('INVALID')
    expect(calculateFormula({
      formula: 'F_MASS', targetUnit: 'kg',
      body: { value: 1, source_unit: 'm', unit_mass: 1, unit_mass_basis: 'kg/m2' },
    }).status).toBe('INVALID')
    expect(calculateFormula({
      formula: 'F_TON', targetUnit: 'kg', body: { value: 1, source_unit: 'kg' },
    }).status).toBe('INVALID')
  })
})
