import type { DetailFormatId } from './types'
import {
  calcResult,
  constant,
  createReader,
  isRecord,
  own,
  type CalcResult,
} from './calcTypes'
import {
  add,
  compare,
  decimalToString,
  divPow10,
  isNegative,
  mul,
  mulPi,
  parseDecimal,
  sub,
  ZERO,
  type Decimal,
} from './decimal'
import { isMissingFact } from './conditions'
import { validateSchema, type SchemaOutcome } from './jsonSchema'
import { normalizeUnit, sameUnit } from './units'

export interface ScheduleInput {
  format: DetailFormatId | 'DUCT' | 'HATSURI_VOL'
  targetUnit: string
  schedule: unknown
  schema?: unknown
}

type Format = ScheduleInput['format']
type NumericKind = 'positive' | 'nonNegative' | 'integer'

interface Definition {
  id: string
  units: readonly string[]
  texts: readonly string[]
  numbers: Readonly<Record<string, NumericKind>>
  arrays?: Readonly<Record<string, readonly string[] | null>>
}

const DEFINITIONS: Readonly<Record<Format, Definition>> = {
  REBAR: {
    id: 'bar_id', units: ['kg', 't'],
    texts: ['diameter_spec', 'length_basis_id', 'unit_mass_evidence_id'],
    numbers: { count: 'integer', length_m: 'positive', unit_mass_kg_per_m: 'positive' },
  },
  STEEL: {
    id: 'member_id', units: ['kg'],
    texts: ['mass_model', 'material', 'section_id', 'mass_evidence_id'],
    numbers: { count: 'integer' },
  },
  CONCRETE: {
    id: 'solid_id', units: ['m3'],
    texts: ['geometry_basis_id', 'deduction_schedule_id', 'concrete_spec'],
    numbers: { count: 'integer', plan_area_m2: 'positive', height_m: 'positive' },
  },
  ANCHOR: {
    id: 'anchor_id', units: ['個'],
    texts: ['support_id', 'diameter_spec', 'anchor_method', 'installation_detail_id'],
    numbers: {},
  },
  SWITCH: {
    id: 'equipment_id', units: ['台'],
    texts: ['network_system_id', 'port_schedule_id', 'poe_budget_evidence_id', 'equipment_schedule_id'],
    numbers: {},
  },
  VENT: {
    id: 'device_id', units: ['個'],
    texts: ['roof_zone_id', 'waterproof_method', 'layout_evidence_id'],
    numbers: {},
  },
  GLASS: {
    id: 'glass_id', units: ['m2'],
    texts: ['glass_spec', 'dimension_basis_id'],
    numbers: { count: 'integer', design_width_m: 'positive', design_height_m: 'positive' },
  },
  FORM: {
    id: 'face_id', units: ['m2'],
    texts: ['member_id', 'formwork_spec', 'contact_basis_id', 'deduction_schedule_id'],
    numbers: { face_area_m2: 'positive' },
  },
  STEEL_PAINT: {
    id: 'member_id', units: ['m2'],
    texts: ['paint_spec', 'surface_basis_id'],
    numbers: { developed_perimeter_m: 'positive', length_m: 'positive' },
    arrays: { selected_surface_ids: null },
  },
  FIRE: {
    id: 'member_id', units: ['m2'],
    texts: ['covering_method', 'fire_rating', 'measurement_dimension_basis_id', 'surface_schedule_id'],
    numbers: { thickness_m: 'positive', measured_area_m2: 'positive' },
  },
  JOINT: {
    id: 'joint_id', units: ['個'],
    texts: ['bar_diameter', 'joint_method', 'connection_detail_id'],
    numbers: {},
  },
  BOLT: {
    id: 'bolt_id', units: ['個'],
    texts: ['diameter_spec', 'joint_id', 'bolt_grade', 'bolt_detail_id'],
    numbers: {},
  },
  WASTE_MASS: {
    id: 'waste_object_id', units: ['kg'],
    texts: ['material', 'mass_evidence_id', 'disposal_scope_id'],
    numbers: { count: 'integer', component_mass_kg: 'positive' },
  },
  OIL_BUND: {
    id: 'bund_solid_id', units: ['m3'],
    texts: ['wall_floor_scope_id', 'detail_id'],
    numbers: {
      outer_plan_area_m2: 'positive',
      inner_plan_area_m2: 'positive',
      height_m: 'positive',
    },
  },
  EARTH_HAUL: {
    id: 'earthwork_id', units: ['m3'],
    texts: ['volume_state', 'soil_class', 'haul_destination', 'haul_distance_basis_id'],
    numbers: { excavation_volume_m3: 'positive', reuse_volume_m3: 'nonNegative' },
  },
  EARTH_DISPOSE: {
    id: 'earthwork_id', units: ['m3'],
    texts: ['volume_state', 'soil_class', 'acceptance_destination', 'disposal_evidence_id'],
    numbers: { disposal_volume_m3: 'positive' },
  },
  BEDDING: {
    id: 'bedding_face_id', units: ['m3'],
    texts: ['material', 'compaction_state', 'dimension_basis_id'],
    numbers: { plan_area_m2: 'positive', thickness_m: 'positive' },
  },
  LABOR: {
    id: 'work_scope_id', units: ['工数'],
    texts: ['adopted_labor_table_id', 'correction_evidence_id', 'area_schedule_id'],
    numbers: { base_work_value: 'positive', correction_value: 'positive' },
  },
  DEMO: {
    id: 'existing_solid_id', units: ['m3'],
    texts: ['removal_boundary_id', 'deduction_basis_id'],
    numbers: {
      plan_area_m2: 'positive', thickness_m: 'positive', void_volume_m3: 'nonNegative',
    },
  },
  GROUT: {
    id: 'grout_zone_id', units: ['m3'],
    texts: ['material', 'detail_basis_id'],
    numbers: {
      fill_area_m2: 'positive', gap_m: 'positive', deduction_volume_m3: 'nonNegative',
    },
  },
  STRIP: {
    id: 'strip_face_id', units: ['m3'],
    texts: ['ground_datum_id', 'soil_state', 'scope_evidence_id'],
    numbers: { area_m2: 'positive', depth_m: 'positive' },
  },
  COEFF: {
    id: 'object_id', units: ['m2'],
    texts: ['base_unit', 'coefficient_unit', 'coefficient_basis_id', 'applicability_evidence_id'],
    numbers: { base_quantity: 'positive', coefficient_value: 'positive' },
  },
  DUCT: {
    id: 'segment_id', units: ['m2'],
    texts: ['spec_group', 'segment_evidence_id'],
    numbers: { perimeter_basis_m: 'positive', length_basis_m: 'positive' },
    arrays: {
      rule_ids: Array.from({ length: 18 }, (_, index) => `D${String(index + 1).padStart(2, '0')}`),
    },
  },
  HATSURI_VOL: {
    id: 'opening_id', units: ['m3'],
    texts: ['host_id', 'shape'],
    numbers: { thickness_m: 'positive', existing_void_m3: 'nonNegative' },
  },
}

const HEADER = [
  'quantity_definition_id', 'target_unit', 'basis_id', 'drawing_revision', 'schedule_id',
] as const

const STEEL_FIELDS: Readonly<Record<string, readonly string[]>> = {
  LINEAR: ['length_m', 'unit_mass_kg_per_m'],
  PLATE: [
    'width_m', 'length_m', 'thickness_m', 'density_kg_per_m3', 'density_evidence_id',
  ],
  DIRECT: ['member_mass_kg'],
}

function numericSchema(kind: NumericKind): Readonly<Record<string, unknown>> {
  if (kind === 'integer') return { type: 'integer', minimum: 1 }
  return kind === 'positive'
    ? { type: 'number', exclusiveMinimum: 0 }
    : { type: 'number', minimum: 0 }
}

function extraRequired(format: Format, record: unknown): readonly string[] {
  if (format === 'STEEL') {
    const model = own(record, 'mass_model')
    return typeof model === 'string'
      && Object.prototype.hasOwnProperty.call(STEEL_FIELDS, model)
      ? STEEL_FIELDS[model]!
      : []
  }
  if (format === 'HATSURI_VOL') {
    if (own(record, 'shape') === 'rect') return ['width_m', 'height_m']
    if (own(record, 'shape') === 'round') return ['diameter_m']
  }
  return []
}

function builtinSchema(format: Format, definition: Definition): unknown {
  const properties: Record<string, unknown> = {}
  const required = [
    definition.id,
    ...definition.texts,
    ...Object.keys(definition.numbers),
    ...Object.keys(definition.arrays ?? {}),
  ]

  for (const key of [definition.id, ...definition.texts]) {
    properties[key] = { type: 'string', minLength: 1 }
  }
  for (const [key, kind] of Object.entries(definition.numbers)) {
    properties[key] = numericSchema(kind)
  }
  for (const [key, choices] of Object.entries(definition.arrays ?? {})) {
    properties[key] = {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: choices
        ? { type: 'string', enum: choices }
        : { type: 'string', minLength: 1 },
    }
  }

  const allOf: unknown[] = []
  if (format === 'STEEL') {
    properties.mass_model = { enum: ['LINEAR', 'PLATE', 'DIRECT'] }
    for (const fields of Object.values(STEEL_FIELDS)) {
      for (const key of fields) {
        properties[key] = key === 'density_evidence_id'
          ? { type: 'string', minLength: 1 }
          : numericSchema('positive')
      }
    }
    for (const [model, fields] of Object.entries(STEEL_FIELDS)) {
      allOf.push({
        if: { required: ['mass_model'], properties: { mass_model: { const: model } } },
        then: { required: fields },
      })
    }
  }

  if (format === 'CONCRETE') {
    properties.deduction_volume_m3 = numericSchema('nonNegative')
  }

  if (format === 'HATSURI_VOL') {
    properties.shape = { enum: ['rect', 'round'] }
    for (const key of ['width_m', 'height_m', 'diameter_m']) {
      properties[key] = numericSchema('positive')
    }
    for (const [shape, fields] of [
      ['rect', ['width_m', 'height_m']],
      ['round', ['diameter_m']],
    ] as const) {
      allOf.push({
        if: { required: ['shape'], properties: { shape: { const: shape } } },
        then: { required: fields },
      })
    }
  }

  const recordSchema: Record<string, unknown> = {
    type: 'object',
    required,
    properties,
    additionalProperties: true,
  }
  if (allOf.length > 0) recordSchema.allOf = allOf

  const headerProperties: Record<string, unknown> = {}
  for (const key of HEADER) headerProperties[key] = { type: 'string', minLength: 1 }

  const headerRequired: string[] = [...HEADER, 'records']
  if (format === 'DUCT') {
    headerRequired.push('adopted_basis_id')
    headerProperties.adopted_basis_id = { type: 'string', minLength: 1 }
  }
  if (format === 'HATSURI_VOL') {
    headerRequired.push('quote_line_id')
    headerProperties.quote_line_id = { type: 'string', minLength: 1 }
  }

  return {
    type: 'object',
    required: headerRequired,
    properties: {
      ...headerProperties,
      records: { type: 'array', minItems: 1, items: recordSchema },
    },
    additionalProperties: true,
  }
}

export function calculateSchedule(input: ScheduleInput): CalcResult {
  const { format, targetUnit, schedule } = input

  if (!Object.prototype.hasOwnProperty.call(DEFINITIONS, format)) {
    return calcResult({
      status: 'UNSUPPORTED', unit: targetUnit,
      errors: [`未対応の明細形式 ${String(format)} です。`],
    })
  }

  const definition = DEFINITIONS[format]
  const reader = createReader(targetUnit)
  const actualUnit = own(schedule, 'target_unit')

  if (typeof actualUnit === 'string' && !isMissingFact(actualUnit)
    && !sameUnit(actualUnit, targetUnit)) {
    reader.fail(`target_unit: ${actualUnit} と ${targetUnit} が一致しません。`)
  }
  if (!definition.units.some(unit => sameUnit(unit, targetUnit))) {
    reader.fail(`${format} は ${definition.units.join(' / ')} で算定します。${targetUnit} では合算しません。`)
  }

  const outcomes: SchemaOutcome[] = [
    validateSchema(builtinSchema(format, definition), schedule),
  ]
  if (input.schema !== undefined) outcomes.push(validateSchema(input.schema, schedule))

  for (const outcome of outcomes) {
    for (const annotation of outcome.annotations) {
      if (annotation.keyword === 'x-review-conditions'
        && Array.isArray(annotation.value)) {
        for (const condition of annotation.value) {
          if (typeof condition === 'string'
            && !reader.result.reviewConditions.includes(condition)) {
            reader.result.reviewConditions.push(condition)
          }
        }
      }
    }
  }

  const unsupported = outcomes.flatMap(outcome => outcome.unsupported)
  if (unsupported.length > 0) {
    return calcResult({
      ...reader.result,
      status: 'UNSUPPORTED',
      errors: unsupported.map(issue => `${issue.path}: ${issue.message}`),
    })
  }

  const entries = own(schedule, 'records')
  const records = Array.isArray(entries) ? entries : []

  const headerKeys: string[] = [...HEADER]
  if (format === 'DUCT') headerKeys.push('adopted_basis_id')
  if (format === 'HATSURI_VOL') headerKeys.push('quote_line_id')

  for (const key of headerKeys) {
    if (isMissingFact(own(schedule, key))) reader.missing(key)
  }
  if (records.length === 0) reader.missing('records')

  records.forEach((record, index) => {
    const required = [
      definition.id,
      ...definition.texts,
      ...Object.keys(definition.numbers),
      ...Object.keys(definition.arrays ?? {}),
      ...extraRequired(format, record),
    ]
    for (const key of required) {
      if (isMissingFact(own(record, key))) reader.missing(`records[${index}].${key}`)
    }
    for (const key of Object.keys(definition.arrays ?? {})) {
      const values = own(record, key)
      if (Array.isArray(values)) {
        values.forEach((value, itemIndex) => {
          if (isMissingFact(value)) {
            reader.missing(`records[${index}].${key}[${itemIndex}]`)
          }
        })
      }
    }
  })

  if (format === 'DUCT' && isMissingFact(own(schedule, 'adopted_basis_id'))) {
    reader.error('採用した積算基準（国 R7 等）を案件で確認してください。')
  }

  const schemaErrors = outcomes.flatMap(outcome => outcome.errors)
  for (const issue of schemaErrors) {
    if (issue.keyword === 'required') {
      reader.missing(issue.path)
    } else {
      reader.error(`${issue.path}: ${issue.message}`)
    }
  }

  // 単位不一致は入力不足と区別する。
  const preliminary = reader.finish(null)
  if (preliminary.status === 'INVALID'
    && (typeof actualUnit === 'string' && !isMissingFact(actualUnit)
      && !sameUnit(actualUnit, targetUnit)
      || !definition.units.some(unit => sameUnit(unit, targetUnit)))) {
    return preliminary
  }

  if (schemaErrors.length > 0 || reader.result.missing.length > 0) {
    return calcResult({ ...reader.result, status: 'INPUT_REQUIRED' })
  }

  const seen = new Set<string>()
  const volumeStates = new Set<string>()
  const specGroups = new Set<string>()
  let total = ZERO

  records.forEach((record, index) => {
    const path = `records[${index}]`
    const id = String(own(record, definition.id))
    if (seen.has(id)) {
      reader.fail(
        `${path}.${definition.id}: 同じ部材IDが2回あります。二重に加算しません。別工程なら別の明細にしてください（${id}）。`,
      )
      return
    }
    seen.add(id)

    // 組込みschema通過後なので、ここでは検査済みJSON数値だけを読む。
    const number = (key: string): Decimal => {
      const parsed = parseDecimal(own(record, key))
      if (!parsed.ok) throw new TypeError(`${path}.${key}: ${parsed.reason}`)
      return parsed.value
    }

    let expression = ''
    const product = (...keys: string[]): Decimal => {
      const values = keys.map(number)
      expression = values.map(decimalToString).join(' × ')
      return values.reduce((value, factor) => mul(value, factor), constant('1'))
    }
    const direct = (key: string): Decimal => {
      const value = number(key)
      expression = decimalToString(value)
      return value
    }
    const subtract = (left: Decimal, right: Decimal): Decimal => {
      expression = `(${expression}) − ${decimalToString(right)}`
      return sub(left, right)
    }

    let value: Decimal
    switch (format) {
      case 'REBAR':
        value = product('count', 'length_m', 'unit_mass_kg_per_m')
        if (sameUnit(targetUnit, 't')) {
          value = divPow10(value, 3)
          expression = `(${expression}) ÷ 1000`
        }
        break

      case 'STEEL':
        if (own(record, 'mass_model') === 'LINEAR') {
          value = product('count', 'length_m', 'unit_mass_kg_per_m')
        } else if (own(record, 'mass_model') === 'PLATE') {
          value = product('count', 'width_m', 'length_m', 'thickness_m', 'density_kg_per_m3')
        } else {
          value = product('count', 'member_mass_kg')
        }
        break

      case 'CONCRETE':
        value = product('count', 'plan_area_m2', 'height_m')
        if (own(record, 'deduction_volume_m3') === undefined) {
          reader.result.warnings.push(`${path}: 控除量の入力なし（控除なしで算定）`)
        } else {
          value = subtract(value, number('deduction_volume_m3'))
        }
        break

      case 'ANCHOR':
      case 'SWITCH':
      case 'VENT':
      case 'JOINT':
      case 'BOLT':
        value = constant('1')
        expression = '現物ID 1件'
        break

      case 'GLASS':
        value = product('count', 'design_width_m', 'design_height_m')
        break
      case 'FORM':
        value = direct('face_area_m2')
        break
      case 'STEEL_PAINT':
        value = product('developed_perimeter_m', 'length_m')
        break
      case 'FIRE':
        value = direct('measured_area_m2')
        break
      case 'WASTE_MASS':
        value = product('count', 'component_mass_kg')
        break

      case 'OIL_BUND': {
        const outer = number('outer_plan_area_m2')
        const inner = number('inner_plan_area_m2')
        if (compare(inner, outer) >= 0) {
          reader.fail(`${path}.inner_plan_area_m2 は outer_plan_area_m2 より小さい値が必要です。`)
        }
        value = mul(sub(outer, inner), number('height_m'))
        expression = `(${decimalToString(outer)} − ${decimalToString(inner)}) × ${decimalToString(number('height_m'))}`
        break
      }

      case 'EARTH_HAUL':
        volumeStates.add(String(own(record, 'volume_state')))
        value = subtract(direct('excavation_volume_m3'), number('reuse_volume_m3'))
        break
      case 'EARTH_DISPOSE':
        volumeStates.add(String(own(record, 'volume_state')))
        value = direct('disposal_volume_m3')
        break
      case 'BEDDING':
        value = product('plan_area_m2', 'thickness_m')
        break
      case 'LABOR':
        value = product('base_work_value', 'correction_value')
        break
      case 'DEMO':
        value = subtract(product('plan_area_m2', 'thickness_m'), number('void_volume_m3'))
        break
      case 'GROUT':
        value = subtract(product('fill_area_m2', 'gap_m'), number('deduction_volume_m3'))
        break
      case 'STRIP':
        value = product('area_m2', 'depth_m')
        break

      case 'COEFF': {
        const baseUnit = normalizeUnit(String(own(record, 'base_unit')))
        const coefficientUnit = String(own(record, 'coefficient_unit')).trim()
        const normalizedCoefficient = coefficientUnit.split('/').map(normalizeUnit).join('/')
        if (normalizedCoefficient !== `m2/${baseUnit}`
          && !(baseUnit === 'm2'
            && ['-', '無次元', 'dimensionless'].includes(coefficientUnit))) {
          reader.fail(`${path}.coefficient_unit: m2/${baseUnit} の係数が必要です。暗黙に換算しません。`)
        }
        value = product('base_quantity', 'coefficient_value')
        break
      }

      case 'DUCT':
        specGroups.add(String(own(record, 'spec_group')))
        value = product('perimeter_basis_m', 'length_basis_m')
        break

      case 'HATSURI_VOL':
        if (own(record, 'shape') === 'rect') {
          value = product('width_m', 'height_m', 'thickness_m')
        } else {
          const diameter = number('diameter_m')
          const thickness = number('thickness_m')
          value = mulPi(mul(mul(mul(diameter, diameter), constant('0.25')), thickness))
          expression = `π × ${decimalToString(diameter)}² ÷ 4 × ${decimalToString(thickness)}`
          if (!reader.result.warnings.includes('π は 30 桁で打ち切り')) {
            reader.result.warnings.push('π は 30 桁で打ち切り')
          }
        }
        value = subtract(value, number('existing_void_m3'))
        break
    }

    if (isNegative(value)) {
      reader.fail(`${path}: 控除が対象を超えています。負の数量・0 への丸めはしません。`)
    }
    total = add(total, value)
    reader.result.steps.push(`${id}: ${expression} = ${decimalToString(value)} ${targetUnit}`)
  })

  if (volumeStates.size > 1) {
    reader.fail('records.volume_state: 体積の状態（地山/ほぐし等）が混ざっています。')
  }
  if (specGroups.size > 1) {
    reader.result.warnings.push('仕様群ごとに分けて集計してください')
  }

  return reader.finish(total)
}
