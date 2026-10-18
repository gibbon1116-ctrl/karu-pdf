import { describe, expect, it } from 'vitest'
import master from '../src/core/takeoff/master.data'
import scopes from '../src/core/takeoff/ruleScopes.data'
import {
  createMasterView,
  ruleScopeText,
} from '../src/core/takeoff/master'
import type { MasterDefinition } from '../src/core/takeoff/types'

const view = createMasterView(master)

function definition(id: string): MasterDefinition {
  const found = view.definition(id)
  if (!found) throw new Error(`定義がありません: ${id}`)
  return found
}

describe('takeoff master', () => {
  it('949定義・916ルールでIDが一意である', () => {
    expect(master.counts.definitions).toBe(949)
    expect(master.counts.rules).toBe(916)
    expect(master.definitions).toHaveLength(949)
    expect(new Set(master.definitions.map(value => value.id)).size).toBe(949)
    expect(Object.keys(scopes.rules)).toHaveLength(916)
  })

  it('全定義の入力スキーマを元データから再構成する', () => {
    for (const entry of master.definitions) {
      const schema = view.inputSchema(entry)
      const required = master.keysets[entry.requiredKeys]!.map(index =>
        master.keyNames[index],
      )
      const schemaKeys = master.keysets[entry.schemaKeys]!.map(index =>
        master.keyNames[index]!,
      )
      const clauses = view.conditionalRequired(entry)

      expect(schema.required, entry.id).toEqual(required)
      expect(schema.$schema).toBe(
        'https://json-schema.org/draft/2020-12/schema',
      )
      expect(schema.type).toBe('object')
      expect(schema.additionalProperties).toBe(true)
      expect(schema.properties).toEqual(Object.fromEntries(
        schemaKeys.map(key => [
          key,
          entry.schemaOverrides?.[key] ?? master.propertyTypes[key],
        ]),
      ))

      expect(clauses.every(clause => clause.if.op === 'eq')).toBe(true)
      expect(schema.allOf).toHaveLength(clauses.length)
      expect(schema.allOf).toEqual(clauses.map(clause => ({
        if: {
          required: [clause.if.field],
          properties: {
            [clause.if.field]: { const: clause.if.value },
          },
        },
        then: {
          required: clause.required,
          properties: Object.fromEntries(
            Object.entries(clause.require_values ?? {}).map(([key, value]) => [
              key,
              { const: value },
            ]),
          ),
        },
      })))
    }
  })

  it('eq以外の条件付き必須はスキーマへ入れず保持する', () => {
    const original = definition('REL-001')
    const clause = {
      if: { field: 'mode', op: 'contains', value: 'geometry' },
      required: ['geometry_id'],
    }
    const modified = {
      ...original,
      conditionalRequired: master.conditions.length,
    }
    const custom = createMasterView({
      ...master,
      conditions: [...master.conditions, [clause]],
      definitions: [modified],
    })

    expect(custom.conditionalRequired(modified)).toEqual([clause])
    expect(custom.inputSchema(modified).allOf).toEqual([])
  })

  it('ルールから元の順序で定義を引ける', () => {
    const expected = master.definitions.filter(entry =>
      entry.rules.includes('E-001'),
    )
    expect(view.definitionsForRule('E-001')).toEqual(expected)
    expect(expected.some(entry => entry.id === 'REL-001')).toBe(true)
    expect(view.definitionsForRule('__missing_rule__')).toEqual([])
    expect(view.definition('__missing_definition__')).toBeUndefined()
  })

  it('文字列・番号・undefinedを解決する', () => {
    expect(master.texts.length).toBeGreaterThan(0)
    expect(view.text(0)).toBe(master.texts[0])
    expect(view.text('そのまま')).toBe('そのまま')
    expect(view.text(undefined)).toBe('')
    expect(view.text(master.texts.length)).toBe('')
    expect(view.keys(undefined)).toEqual([])
    expect(view.condition(undefined)).toBeUndefined()

    expect(ruleScopeText(scopes, '対象')).toBe('対象')
    expect(ruleScopeText(scopes, undefined)).toBe('')
    if (scopes.texts.length > 0) {
      expect(ruleScopeText(scopes, 0)).toBe(scopes.texts[0])
    }
  })

  it('REL-028の明細スキーマへ定義別のconstを上書きする', () => {
    const entry = definition('REL-028')
    const detail = entry.detail
    if (!detail) throw new Error('REL-028の明細がありません。')

    const template = master.detailTemplates[detail.format]?.schema
    if (!template) throw new Error('ANCHORのスキーマがありません。')

    const schema = view.scheduleSchema(entry)
    expect(schema).toEqual({
      ...template,
      properties: {
        ...(template.properties as Readonly<Record<string, unknown>>),
        ...detail.scheduleOverrides,
      },
    })
    expect(schema?.properties).toMatchObject({
      quantity_definition_id: { const: 'REL-028' },
    })
    expect(view.scheduleSchema(definition('REL-001'))).toBeUndefined()
  })

  it('競合がなく、キー説明を参照できる', () => {
    expect(master.conflicts).toHaveLength(0)
    for (const entry of master.definitions) {
      expect(view.conflicts(entry.id)).toEqual([])
    }
    expect(view.keyLabel('origin_match')).toEqual(master.keyLabels.origin_match)
    expect(view.keyLabel('__missing_key__')).toBeUndefined()
  })
})

describe('takeoff master identifiers', () => {
  it('keeps detail format ids as strings that exist in the 22 templates', () => {
    const details = master.definitions.filter(definition => definition.detail)
    expect(details).toHaveLength(103)
    for (const definition of details) {
      expect(typeof definition.detail?.format).toBe('string')
      expect(master.detailTemplates[definition.detail!.format]).toBeDefined()
    }
  })
})
