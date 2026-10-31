import { describe, expect, it } from 'vitest'
import { validateSchema } from '../src/core/takeoff/jsonSchema'

const steelSchema = {
  type: 'object',
  properties: {
    records: {
      type: 'array',
      items: {
        type: 'object',
        required: ['mass_model'],
        allOf: [{
          if: {
            required: ['mass_model'],
            properties: { mass_model: { const: 'PLATE' } },
          },
          then: { required: ['density_kg_per_m3', 'density_evidence_id'] },
          else: { required: ['unit_mass_kg_per_m'] },
        }],
      },
    },
  },
}

describe('takeoff partial JSON Schema', () => {
  it('reports conditional PLATE requirements with full paths', () => {
    const result = validateSchema(steelSchema, { records: [{ mass_model: 'PLATE' }] })
    expect(result.valid).toBe(false)
    expect(result.errors.map(issue => issue.path)).toEqual([
      'records[0].density_kg_per_m3',
      'records[0].density_evidence_id',
    ])
  })

  it('does not apply then when if is false', () => {
    expect(validateSchema(steelSchema, {
      records: [{ mass_model: 'LINEAR', unit_mass_kg_per_m: 4 }],
    }).valid).toBe(true)
  })

  it('returns annotations without treating review conditions as validators', () => {
    const result = validateSchema({
      type: 'number',
      description: '参考数量',
      'x-review-conditions': ['採用基準を確認'],
    }, 1)
    expect(result.valid).toBe(true)
    expect(result.annotations).toEqual([
      { path: '', keyword: 'description', value: '参考数量' },
      { path: '', keyword: 'x-review-conditions', value: ['採用基準を確認'] },
    ])
  })

  it('does not silently accept unknown keywords, including inactive branches', () => {
    const result = validateSchema({
      if: { const: 'A' },
      then: { pattern: '^A$' },
    }, 'B')
    expect(result.valid).toBe(false)
    expect(result.unsupported.some(issue => issue.keyword === 'pattern')).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('checks deep uniqueness and exclusive minimum', () => {
    expect(validateSchema({
      type: 'array', uniqueItems: true,
    }, [{ a: 1, b: 2 }, { b: 2, a: 1 }]).valid).toBe(false)
    expect(validateSchema({ type: 'number', exclusiveMinimum: 0 }, 0).valid).toBe(false)
    expect(validateSchema({ type: 'number', exclusiveMinimum: 0 }, 0.1).valid).toBe(true)
  })

  it('uses JSON number types and supports type unions', () => {
    expect(validateSchema({ type: 'number' }, '1.2').valid).toBe(false)
    expect(validateSchema({ type: 'number' }, Infinity).valid).toBe(false)
    expect(validateSchema({ type: 'integer' }, 1.2).valid).toBe(false)
    expect(validateSchema({ type: ['null', 'string'] }, null).valid).toBe(true)
  })

  it('validates additional properties using a schema', () => {
    expect(validateSchema({
      type: 'object',
      properties: { known: { type: 'string' } },
      additionalProperties: { type: 'number' },
    }, { known: 'ok', extra: 'wrong' }).errors[0]?.path).toBe('extra')
    expect(validateSchema({
      type: 'object', additionalProperties: false,
    }, { extra: 1 }).valid).toBe(false)
  })

  it('stops recursion beyond depth 64', () => {
    let schema: unknown = { type: 'number' }
    let value: unknown = 1
    for (let index = 0; index < 66; index += 1) {
      schema = { type: 'object', properties: { nested: schema } }
      value = { nested: value }
    }
    expect(validateSchema(schema, value).errors.some(issue => issue.keyword === 'depth'))
      .toBe(true)
  })
})
