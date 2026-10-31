import type {
  ConditionalRequired,
  MasterBillingStage,
  MasterConflict,
  MasterDefinition,
  MasterKeyLabel,
  MasterQuantityStage,
  TakeoffMaster,
  TakeoffRuleScopes,
  TextRef,
} from './types'

export interface MasterView {
  readonly master: TakeoffMaster
  text(ref: TextRef | undefined): string
  keys(index: number | undefined): readonly string[]
  condition<T = unknown>(index: number | undefined): T | undefined
  definition(id: string): MasterDefinition | undefined
  definitionsForRule(ruleId: string): readonly MasterDefinition[]
  requiredKeys(definition: MasterDefinition): readonly string[]
  conditionalRequired(definition: MasterDefinition): readonly ConditionalRequired[]
  quantityStage(definition: MasterDefinition): MasterQuantityStage | undefined
  billingStage(definition: MasterDefinition): MasterBillingStage | undefined
  inputSchema(definition: MasterDefinition): Record<string, unknown>
  scheduleSchema(definition: MasterDefinition): Record<string, unknown> | undefined
  conflicts(definitionId: string): readonly MasterConflict[]
  keyLabel(key: string): MasterKeyLabel | undefined
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resolveText(texts: readonly string[], ref: TextRef | undefined): string {
  if (typeof ref === 'string') return ref
  return ref === undefined ? '' : texts[ref] ?? ''
}

export function createMasterView(master: TakeoffMaster): MasterView {
  const definitions = new Map<string, MasterDefinition>()
  const byRule = new Map<string, MasterDefinition[]>()
  const byConflict = new Map<string, MasterConflict[]>()
  const emptyKeys: readonly string[] = []
  const emptyDefinitions: readonly MasterDefinition[] = []
  const emptyConflicts: readonly MasterConflict[] = []

  const keysets: readonly (readonly string[])[] = master.keysets.map(indices =>
    indices.map(index => {
      const key = master.keyNames[index]
      if (key === undefined) {
        throw new TypeError(`マスターのキー番号が不正です: ${index}`)
      }
      return key
    }),
  )

  for (const definition of master.definitions) {
    if (definitions.has(definition.id)) {
      throw new TypeError(`マスターの定義IDが重複しています: ${definition.id}`)
    }
    definitions.set(definition.id, definition)

    for (const ruleId of new Set(definition.rules)) {
      const entries = byRule.get(ruleId)
      if (entries) entries.push(definition)
      else byRule.set(ruleId, [definition])
    }
  }

  for (const conflict of master.conflicts) {
    const entries = byConflict.get(conflict.definitionId)
    if (entries) entries.push(conflict)
    else byConflict.set(conflict.definitionId, [conflict])
  }

  function keys(index: number | undefined): readonly string[] {
    return index === undefined ? emptyKeys : keysets[index] ?? emptyKeys
  }

  function condition<T = unknown>(index: number | undefined): T | undefined {
    return index === undefined
      ? undefined
      : master.conditions[index] as T | undefined
  }

  function requiredKeys(definition: MasterDefinition): readonly string[] {
    return keys(definition.requiredKeys)
  }

  function conditionalRequired(
    definition: MasterDefinition,
  ): readonly ConditionalRequired[] {
    return condition<readonly ConditionalRequired[]>(
      definition.conditionalRequired,
    ) ?? []
  }

  return {
    master,
    text: ref => resolveText(master.texts, ref),
    keys,
    condition,
    definition: id => definitions.get(id),
    definitionsForRule: ruleId => byRule.get(ruleId) ?? emptyDefinitions,
    requiredKeys,
    conditionalRequired,
    quantityStage: definition =>
      condition<MasterQuantityStage>(definition.stages.quantity),
    billingStage: definition =>
      condition<MasterBillingStage>(definition.stages.billing),

    inputSchema(definition) {
      const properties: Record<string, unknown> = Object.fromEntries(
        keys(definition.schemaKeys).map(key => [
          key,
          definition.schemaOverrides?.[key] ?? master.propertyTypes[key],
        ]),
      )

      const allOf = conditionalRequired(definition)
        .filter(clause => clause.if.op === 'eq')
        .map(clause => ({
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
        }))

      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        required: requiredKeys(definition),
        properties,
        allOf,
        additionalProperties: true,
      }
    },

    scheduleSchema(definition) {
      const detail = definition.detail
      if (!detail) return undefined

      const schema = master.detailTemplates[detail.format]?.schema
      if (!schema) return undefined

      return {
        ...schema,
        properties: {
          ...(record(schema.properties) ? schema.properties : {}),
          ...detail.scheduleOverrides,
        },
      }
    },

    conflicts: definitionId => byConflict.get(definitionId) ?? emptyConflicts,
    keyLabel: key => Object.prototype.hasOwnProperty.call(master.keyLabels, key)
      ? master.keyLabels[key]
      : undefined,
  }
}

export function ruleScopeText(
  scopes: TakeoffRuleScopes,
  ref: TextRef | undefined,
): string {
  return resolveText(scopes.texts, ref)
}
