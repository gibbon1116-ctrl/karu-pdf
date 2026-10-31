import { describe, expect, it } from 'vitest'
import data from '../tests/fixtures/takeoff/acceptance.json'
import { calculateSchedule, type ScheduleInput } from '../src/core/takeoff/schedules'
import {
  decimalToString,
  mul,
  parseDecimal,
} from '../src/core/takeoff/decimal'

type Example = (typeof data.detailExamples)[number]
type Format = ScheduleInput['format']

const TEXT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  REBAR: ['bar_id', 'diameter_spec', 'length_basis_id', 'unit_mass_evidence_id'],
  STEEL: ['member_id', 'material', 'section_id', 'mass_evidence_id'],
  CONCRETE: ['solid_id', 'geometry_basis_id', 'deduction_schedule_id', 'concrete_spec'],
  ANCHOR: ['anchor_id', 'support_id', 'diameter_spec', 'anchor_method', 'installation_detail_id'],
  SWITCH: ['equipment_id', 'network_system_id', 'port_schedule_id', 'poe_budget_evidence_id', 'equipment_schedule_id'],
  VENT: ['device_id', 'roof_zone_id', 'waterproof_method', 'layout_evidence_id'],
  GLASS: ['glass_id', 'glass_spec', 'dimension_basis_id'],
  FORM: ['face_id', 'member_id', 'formwork_spec', 'contact_basis_id', 'deduction_schedule_id'],
  STEEL_PAINT: ['member_id', 'paint_spec', 'surface_basis_id'],
  FIRE: ['member_id', 'covering_method', 'fire_rating', 'measurement_dimension_basis_id', 'surface_schedule_id'],
  JOINT: ['joint_id', 'bar_diameter', 'joint_method', 'connection_detail_id'],
  BOLT: ['bolt_id', 'diameter_spec', 'joint_id', 'bolt_grade', 'bolt_detail_id'],
  WASTE_MASS: ['waste_object_id', 'material', 'mass_evidence_id', 'disposal_scope_id'],
  OIL_BUND: ['bund_solid_id', 'wall_floor_scope_id', 'detail_id'],
  EARTH_HAUL: ['earthwork_id', 'volume_state', 'soil_class', 'haul_destination', 'haul_distance_basis_id'],
  EARTH_DISPOSE: ['earthwork_id', 'volume_state', 'soil_class', 'acceptance_destination', 'disposal_evidence_id'],
  BEDDING: ['bedding_face_id', 'material', 'compaction_state', 'dimension_basis_id'],
  LABOR: ['work_scope_id', 'adopted_labor_table_id', 'correction_evidence_id', 'area_schedule_id'],
  DEMO: ['existing_solid_id', 'removal_boundary_id', 'deduction_basis_id'],
  GROUT: ['grout_zone_id', 'material', 'detail_basis_id'],
  STRIP: ['strip_face_id', 'ground_datum_id', 'soil_state', 'scope_evidence_id'],
  COEFF: ['object_id', 'base_unit', 'coefficient_unit', 'coefficient_basis_id', 'applicability_evidence_id'],
}

function exactProduct(left: number | string, right: number | string): number {
  const a = parseDecimal(left)
  const b = parseDecimal(right)
  if (!a.ok || !b.ok) throw new Error('試験変数が不正です')
  // JSON数値へ戻すのは試験入力の構築時だけ。乗算自体は10進で行う。
  return Number(decimalToString(mul(a.value, b.value)))
}

function schedule(
  unit: string,
  records: Record<string, unknown>[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    quantity_definition_id: 'TEST-DEFINITION',
    target_unit: unit,
    basis_id: 'TEST-BASIS',
    drawing_revision: 'TEST-REV',
    schedule_id: 'TEST-SCHEDULE',
    records,
    ...extra,
  }
}

function recordsFor(example: Example): Record<string, unknown>[] {
  const variables = example.variables as Readonly<Record<string, number | string>>
  const record: Record<string, unknown> = { ...variables }
  for (const key of TEXT_FIELDS[example.format] ?? []) record[key] = `TEST-${key}`

  let count = 1
  if (example.format === 'STEEL') record.mass_model = 'LINEAR'
  if (example.format === 'ANCHOR') count = Number(variables.unique_anchor_count)
  if (example.format === 'SWITCH') count = Number(variables.specified_equipment_count)
  if (example.format === 'VENT') count = Number(variables.specified_device_count)
  if (example.format === 'JOINT') count = Number(variables.unique_joint_count)
  if (example.format === 'BOLT') count = Number(variables.unique_bolt_count)

  if (example.format === 'FORM') {
    count = Number(variables.count_of_selected_faces)
    record.face_area_m2 = exactProduct(variables.face_width_m!, variables.face_height_m!)
  }
  if (example.format === 'STEEL_PAINT') {
    record.developed_perimeter_m = variables.selected_developed_perimeter_m
    record.selected_surface_ids = ['TEST-SURFACE']
  }
  if (example.format === 'FIRE') {
    count = Number(variables.member_count)
    record.measured_area_m2 = variables.area_per_member_m2
    record.thickness_m = 0.02
  }
  if (example.format === 'LABOR') {
    record.correction_value = variables.correction_value_dimensionless
  }
  if (example.format === 'COEFF') {
    record.base_quantity = variables.base_quantity_m2
    record.coefficient_value = variables.coefficient_dimensionless
    record.base_unit = 'm2'
    record.coefficient_unit = 'dimensionless'
  }

  if (!Number.isSafeInteger(count) || count < 1) throw new Error('試験件数が不正です')
  const idKey = TEXT_FIELDS[example.format]?.[0]
  if (!idKey) throw new Error(`未対応の試験形式 ${example.format}`)

  return Array.from({ length: count }, (_, index) => ({
    ...record, [idKey]: `TEST-${example.format}-${index}`,
  }))
}

function normalExample(format: string, unit: string): Example {
  const example = data.detailExamples.find(entry =>
    entry.format === format && entry.unit === unit && entry.kind === '正常',
  )
  if (!example) throw new Error(`正常ケースがありません: ${format}/${unit}`)
  return example
}

function runExample(example: Example) {
  const normal = example.kind === '正常'
    ? example
    : normalExample(example.format, example.unit)
  const records = recordsFor(normal)
  if (example.kind === '入力不足' && example.missing) {
    delete records[0]![example.missing]
  }
  return calculateSchedule({
    format: example.format as Format,
    targetUnit: example.unit,
    schedule: schedule(example.unit, records),
  })
}

describe('takeoff detail schedules', () => {
  it('contains all 46 source examples', () => {
    expect(data.detailExamples).toHaveLength(46)
    expect(data.detailExamples.filter(entry => entry.kind === '正常')).toHaveLength(23)
    expect(data.detailExamples.filter(entry => entry.kind === '入力不足')).toHaveLength(23)
  })

  it.each(data.detailExamples)('$caseId executes without rewriting sourceStatus', example => {
    const result = runExample(example)
    if (example.kind === '正常') {
      expect(result.status).toBe('CALCULATED')
      const expected = parseDecimal(example.expectedQuantity)
      if (!expected.ok) throw new Error(expected.reason)
      expect(result.value).toBe(decimalToString(expected.value))
    } else {
      expect(result.status).toBe('INPUT_REQUIRED')
      expect(result.value).toBeNull()
      expect(result.missing).toContain(`records[0].${example.missing}`)
    }
    expect(example.sourceStatus).toBe('NOT_RUN')
  })

  it('rejects duplicate physical IDs', () => {
    const example = normalExample('REBAR', 'kg')
    const record = recordsFor(example)[0]!
    const result = calculateSchedule({
      format: 'REBAR', targetUnit: 'kg',
      schedule: schedule('kg', [record, { ...record }]),
    })
    expect(result.status).toBe('INVALID')
    expect(result.errors.join(' ')).toContain('同じ部材IDが2回')
  })

  it('calculates STEEL LINEAR and REBAR count factors exactly', () => {
    expect(runExample(normalExample('STEEL', 'kg')).value).toBe('24')
    expect(runExample(normalExample('REBAR', 'kg')).value).toBe('20')
    expect(runExample(normalExample('REBAR', 't')).value).toBe('0.02')
  })

  it('does not replace PLATE density with linear unit mass', () => {
    const record = {
      ...recordsFor(normalExample('STEEL', 'kg'))[0],
      mass_model: 'PLATE',
      width_m: 1,
      length_m: 2,
      thickness_m: 0.01,
      unit_mass_kg_per_m: 4,
    }
    const result = calculateSchedule({
      format: 'STEEL', targetUnit: 'kg', schedule: schedule('kg', [record]),
    })
    expect(result.status).toBe('INPUT_REQUIRED')
    expect(result.missing).toEqual(expect.arrayContaining([
      'records[0].density_kg_per_m3', 'records[0].density_evidence_id',
    ]))
  })

  it('calculates PLATE and DIRECT only from their explicit mass models', () => {
    const base = recordsFor(normalExample('STEEL', 'kg'))[0]!
    expect(calculateSchedule({
      format: 'STEEL', targetUnit: 'kg',
      schedule: schedule('kg', [{
        ...base, mass_model: 'PLATE', count: 2,
        width_m: 1, length_m: 2, thickness_m: 0.01,
        density_kg_per_m3: 7800, density_evidence_id: 'TEST-DENSITY',
      }]),
    }).value).toBe('312')
    expect(calculateSchedule({
      format: 'STEEL', targetUnit: 'kg',
      schedule: schedule('kg', [{
        ...base, mass_model: 'DIRECT', count: 2, member_mass_kg: 12,
      }]),
    }).value).toBe('24')
  })

  it('validates metadata and JSON numeric types without an external schema', () => {
    const record = recordsFor(normalExample('REBAR', 'kg'))[0]!
    const result = calculateSchedule({
      format: 'REBAR', targetUnit: 'kg',
      schedule: schedule('kg', [{ ...record, length_m: '2' }], { basis_id: '' }),
    })
    expect(result.status).toBe('INPUT_REQUIRED')
    expect(result.missing).toContain('basis_id')
    expect(result.errors.join(' ')).toContain('length_m')
  })

  it('preserves review annotations and stops on unsupported schema keywords', () => {
    const example = normalExample('REBAR', 'kg')
    const base = {
      format: 'REBAR' as const, targetUnit: 'kg',
      schedule: schedule('kg', recordsFor(example)),
    }
    expect(calculateSchedule({
      ...base, schema: { 'x-review-conditions': ['採用基準を確認'] },
    }).reviewConditions).toEqual(['採用基準を確認'])
    expect(calculateSchedule({
      ...base, schema: { pattern: 'unsupported' },
    }).status).toBe('UNSUPPORTED')
  })

  it('does not allow a supplied schema to weaken mandatory field checks', () => {
    const record = recordsFor(normalExample('REBAR', 'kg'))[0]!
    delete record.unit_mass_evidence_id
    expect(calculateSchedule({
      format: 'REBAR', targetUnit: 'kg',
      schedule: schedule('kg', [record]), schema: {},
    }).missing).toContain('records[0].unit_mass_evidence_id')
  })

  it('calculates DUCT only with adopted measurement basis', () => {
    const record = {
      segment_id: 's1', spec_group: 'TEST-SPEC',
      perimeter_basis_m: 2, length_basis_m: 3,
      rule_ids: ['D01', 'D18'], segment_evidence_id: 'TEST-DUCT',
    }
    const missing = calculateSchedule({
      format: 'DUCT', targetUnit: 'm2', schedule: schedule('m2', [record]),
    })
    expect(missing.status).toBe('INPUT_REQUIRED')
    expect(missing.missing).toContain('adopted_basis_id')

    expect(calculateSchedule({
      format: 'DUCT', targetUnit: 'm2',
      schedule: schedule('m2', [record], { adopted_basis_id: 'TEST-ADOPTED' }),
    }).value).toBe('6')

    expect(calculateSchedule({
      format: 'DUCT', targetUnit: 'm2',
      schedule: schedule('m2', [
        record, { ...record, segment_id: 's2', spec_group: 'TEST-OTHER' },
      ], { adopted_basis_id: 'TEST-ADOPTED' }),
    }).warnings).toContain('仕様群ごとに分けて集計してください')
  })

  it('calculates rectangular and circular HATSURI_VOL with explicit voids', () => {
    const base = { opening_id: 'o1', host_id: 'TEST-HOST', thickness_m: 1, existing_void_m3: 0 }
    expect(calculateSchedule({
      format: 'HATSURI_VOL', targetUnit: 'm3',
      schedule: schedule('m3', [{
        ...base, shape: 'rect', width_m: 2, height_m: 3, existing_void_m3: 1,
      }], { quote_line_id: 'TEST-QUOTE' }),
    }).value).toBe('5')

    const round = calculateSchedule({
      format: 'HATSURI_VOL', targetUnit: 'm3',
      schedule: schedule('m3', [{
        ...base, shape: 'round', diameter_m: 2,
      }], { quote_line_id: 'TEST-QUOTE' }),
    })
    expect(round.value).toBe('3.141592653589793238462643383279')
    expect(round.warnings).toContain('π は 30 桁で打ち切り')

    const missingVoid = { ...base, shape: 'rect', width_m: 2, height_m: 3 } as Record<string, unknown>
    delete missingVoid.existing_void_m3
    expect(calculateSchedule({
      format: 'HATSURI_VOL', targetUnit: 'm3',
      schedule: schedule('m3', [missingVoid]),
    }).missing).toEqual(expect.arrayContaining([
      'quote_line_id', 'records[0].existing_void_m3',
    ]))
  })

  it('rejects negative net volumes and mixed volume states', () => {
    const concrete = recordsFor(normalExample('CONCRETE', 'm3'))[0]!
    expect(calculateSchedule({
      format: 'CONCRETE', targetUnit: 'm3',
      schedule: schedule('m3', [{ ...concrete, deduction_volume_m3: 100 }]),
    }).status).toBe('INVALID')

    const earth = recordsFor(normalExample('EARTH_HAUL', 'm3'))[0]!
    expect(calculateSchedule({
      format: 'EARTH_HAUL', targetUnit: 'm3',
      schedule: schedule('m3', [
        { ...earth, earthwork_id: 'e1', volume_state: '地山' },
        { ...earth, earthwork_id: 'e2', volume_state: 'ほぐし' },
      ]),
    }).status).toBe('INVALID')
  })

  it('rejects target-unit mismatches and does not multiply ID counts by count', () => {
    const record = recordsFor(normalExample('ANCHOR', '個'))[0]!
    expect(calculateSchedule({
      format: 'ANCHOR', targetUnit: '個',
      schedule: schedule('個', [{ ...record, count: 999 }]),
    }).value).toBe('1')
    expect(calculateSchedule({
      format: 'ANCHOR', targetUnit: '個',
      schedule: schedule('台', [record]),
    }).status).toBe('INVALID')
  })
})
