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
  decimalToString,
  divPow10,
  isNegative,
  mul,
  parseDecimal,
  sub,
  ZERO,
  type Decimal,
} from './decimal'
import { isMissingFact } from './conditions'
import { normalizeUnit } from './units'

export interface MethodVariable {
  key: string
  label: string
  unit: string
  kind: 'decimal' | 'positive' | 'nonNegative' | 'ids'
}

export interface MethodSpec {
  id: string
  unit: string
  variables: readonly MethodVariable[]
  selectable: boolean
}

export interface MethodInput {
  methodId: string
  inputs: Readonly<Record<string, unknown>>
  values: Readonly<Record<string, unknown>>
  requiredInputs: readonly string[]
}

function variable(
  key: string,
  kind: MethodVariable['kind'] = 'positive',
  unit = '',
  label = key,
): MethodVariable {
  return { key, kind, unit, label }
}

const ids = (key: string) => variable(key, 'ids')
const positive = (key: string, unit = '') => variable(key, 'positive', unit)
const nonNegative = (key: string, unit: string, label: string) =>
  variable(key, 'nonNegative', unit, label)

function spec(
  id: string,
  unit: string,
  variables: readonly MethodVariable[],
  selectable = true,
): MethodSpec {
  return { id: `U19:${id}`, unit, variables, selectable }
}

const SPECS: readonly MethodSpec[] = [
  spec('POWER_EQUIP', '台', [ids('equipment_ids')]),
  spec('POWER_PANEL', '面', [ids('panel_ids')]),
  spec('POWER_CABLE', 'm', [
    nonNegative('route_m', 'm', '平面長さ'),
    nonNegative('riser_m', 'm', '立上り長さ'),
    nonNegative('extra_m', 'm', '根拠付き余長'),
  ]),
  spec('POWER_HIRE', '台・日', [ids('equipment_ids'), positive('charge_days', '日')]),
  spec('POWER_ENERGY', 'kWh', [
    positive('load_kw', 'kW'), positive('hours', 'h'), positive('load_factor', '-'),
  ]),
  spec('SCAFF_FULL', '㎡', [positive('centerline_m', 'm'), positive('height_m', 'm')]),
  spec('SCAFF_SINGLE', '㎡', [positive('centerline_m', 'm'), positive('height_m', 'm')]),
  spec('SCAFF_MACHINE', '台', [ids('machine_ids')]),
  spec('SCAFF_LOCATION', 'か所', [ids('location_ids')]),
  spec('MOVE_MASS', 't', [
    positive('mass_kg', 'kg'), positive('mass_correction', '-'), positive('single_factor', '-'),
  ]),
  spec('MOVE_VOLUME', 't', [
    positive('mass_kg', 'kg'), positive('density_correction', '-'), positive('single_factor', '-'),
  ]),
  spec('CRANE_DAY', '台・日', [positive('machine_count', '台'), positive('days', '日')]),
  spec('LABOUR_DAY', '人・日', [positive('workers', '人'), positive('days', '日')]),
  spec('INSTALL_PANEL', '面', [ids('panel_ids')]),
  spec('INSTALL_CUBICLE', '基', [ids('equipment_assembly_ids')]),
  spec('STORE_AREA', '㎡・日', [positive('area_m2', 'm2'), positive('days', '日')]),
  spec('STORE_VOLUME', 'm³・日', [positive('volume_m3', 'm3'), positive('days', '日')]),
  spec('STORE_UNIT', '台・日', [ids('equipment_ids'), positive('days', '日')]),
  spec('RELOCATE_UNIT', '台', [ids('equipment_ids')]),
  spec('RELOCATE_PANEL', '面', [ids('panel_ids')]),
  spec('AHU_INSTALL', '台', [], false),
  spec('LIFT_UNIT', '台', [ids('equipment_ids')]),
  spec('BASE_CONCRETE', 'm³', [
    positive('length_m', 'm'), positive('width_m', 'm'),
    positive('thickness_m', 'm'), positive('count', '基'),
  ]),
  // MethodVariable.kind に行配列型がないため、faces は inputs から別途検査する。
  spec('BASE_FORM', '㎡', []),
  spec('BASE_REBAR_T', 't', [
    positive('length_m', 'm'), positive('unit_mass_kg_per_m', 'kg/m'),
  ]),
  spec('BASE_REBAR_KG', 'kg', [
    positive('length_m', 'm'), positive('unit_mass_kg_per_m', 'kg/m'),
  ]),
  spec('BASE_MORTAR', '㎡', [positive('length_m', 'm'), positive('width_m', 'm')]),
  spec('FENCE_LENGTH', 'm', [
    positive('plan_length_m', 'm'), variable('excluded_m', 'nonNegative', 'm'),
  ]),
  spec('FENCE_AREA', '㎡', [
    positive('plan_length_m', 'm'), variable('excluded_m', 'nonNegative', 'm'),
    positive('height_m', 'm'),
  ]),
  spec('BASE_PREFAB', '基', [ids('prefab_ids')]),
  spec('STEEL_TRANSPORT', 't', [positive('mass_t', 't')]),
  spec('STEEL_TRIP', '台・回', [
    positive('vehicles', '台'), positive('trips_per_vehicle', '回'),
  ]),
  spec('STEEL_ERECT', 't', [positive('mass_t', 't')]),
  spec('PACKAGE', '式', [positive('agreed_quantity', '式')]),
  spec('NO_SEPARATE', '—', []),
]

export const UNIT_METHOD_SPECS: Readonly<Record<string, MethodSpec>> =
  Object.freeze(Object.fromEntries(SPECS.map(entry => [entry.id, entry])))

const LATER_KEYS = new Set([
  'price_basis_id', 'inclusion_resolution', 'allocation_id', 'adoption_evidence_id',
])

function dateValue(input: unknown): number | null {
  if (typeof input !== 'string' && typeof input !== 'number') return null
  const value = typeof input === 'string' ? Date.parse(input) : new Date(input).getTime()
  return Number.isFinite(value) ? value : null
}

export function calculateUnitMethod(input: MethodInput): CalcResult {
  const method = Object.prototype.hasOwnProperty.call(UNIT_METHOD_SPECS, input.methodId)
    ? UNIT_METHOD_SPECS[input.methodId]
    : undefined

  if (!method) {
    return calcResult({
      status: 'UNSUPPORTED', unit: '',
      errors: [`未対応の方式 ${input.methodId} です。`],
    })
  }
  if (!method.selectable) {
    return calcResult({
      status: 'INVALID', unit: method.unit,
      errors: ['参照専用の方式で、採用方式として選べません'],
    })
  }

  const reader = createReader(method.unit)
  if (!isRecord(input.inputs) || !isRecord(input.values)) {
    reader.fail('inputs / values は入力項目のオブジェクトで指定してください。')
    return reader.finish(null)
  }

  for (const key of input.requiredInputs) {
    if (isMissingFact(own(input.inputs, key))) {
      if (LATER_KEYS.has(key)) {
        if (!reader.result.laterRequired.includes(key)) reader.result.laterRequired.push(key)
      } else {
        reader.missing(key)
      }
    }
  }

  const priceUnit = own(input.inputs, 'price_unit')
  if (priceUnit !== undefined) {
    if (typeof priceUnit !== 'string'
      || normalizeUnit(priceUnit) !== normalizeUnit(method.unit)) {
      reader.fail(
        `price_unit: 方式の単位（${method.unit}）と価格の単位（${String(priceUnit)}）が違います。暗黙に換算しません。`,
      )
    }
  }

  for (const [key, value] of Object.entries(input.inputs)) {
    if (key.endsWith('_start_end') && Array.isArray(value) && value.length === 2) {
      const start = dateValue(value[0])
      const end = dateValue(value[1])
      if (start !== null && end !== null && end < start) {
        reader.fail(`${key}: 終了が開始より前です。負の日数・絶対値で算定しません。`)
      }
    }
  }

  const volume = own(input.inputs, 'equipment_volume')
  const volumePrefix = typeof volume === 'string'
    ? /^[ \t]*([+-]?\d+(?:\.\d+)?)/.exec(volume)?.[1]
    : undefined
  if (typeof volume === 'number' || volumePrefix !== undefined) {
    const parsed = parseDecimal(typeof volume === 'number' ? volume : volumePrefix)
    if (parsed.ok && (isNegative(parsed.value) || parsed.value.digits === 0n)) {
      reader.fail('equipment_volume: 容積が0以下です。密度区分ができません。')
    }
  }

  if (input.methodId === 'U19:PACKAGE') {
    for (const key of ['quote_id', 'quantity_breakdown']) {
      if (isMissingFact(own(input.inputs, key))) {
        reader.missing(key)
        reader.error('方式を選んだだけで式1にしません。見積と数量内訳が必要です。')
      }
    }
  }

  if (input.methodId === 'U19:NO_SEPARATE') {
    for (const key of [
      'reason_code', 'counterpart_definition_or_trade', 'inclusion_or_allocation_evidence',
    ]) {
      if (isMissingFact(own(input.inputs, key))) reader.missing(key)
    }
    if (reader.result.missing.length > 0) {
      reader.error('別計上しない根拠が必要です。0 や不要に置き換えません。')
    }
    const checked = reader.finish(ZERO)
    return checked.status === 'CALCULATED'
      ? calcResult({
        ...checked, status: 'NO_QUANTITY',
        warnings: ['別計上しない記録です。数量は持ちません。'],
      })
      : checked
  }

  if (input.methodId === 'U19:STEEL_TRIP'
    && !isMissingFact(own(input.inputs, 'trip_ids'))) {
    reader.ids(own(input.inputs, 'trip_ids'), 'trip_ids')
  }

  if (input.methodId === 'U19:BASE_FORM') {
    const faces = reader.array(own(input.inputs, 'faces'), 'faces')
    let total = ZERO
    const seen = new Set<string>()

    faces?.forEach((face, index) => {
      const path = `faces[${index}]`
      if (!isRecord(face)) {
        reader.fail(`${path} は対象面のオブジェクトで指定してください。`)
        return
      }
      const id = reader.text(own(face, 'id'), `${path}.id`)
      const length = reader.number(own(face, 'length_m'), `${path}.length_m`, 'positive')
      const height = reader.number(own(face, 'height_m'), `${path}.height_m`, 'positive')

      if (id !== null) {
        if (seen.has(id)) reader.fail(`${path}.id: 同じ現物IDが2回あります（${id}）。`)
        seen.add(id)
      }
      if (id === null || length === null || height === null) return
      const area = mul(length, height)
      total = add(total, area)
      reader.result.steps.push(
        `${id}: ${decimalToString(length)} × ${decimalToString(height)} = ${decimalToString(area)} m2`,
      )
    })
    return reader.finish(faces ? total : null)
  }

  const values: Decimal[] = []
  let complete = true

  for (const variableSpec of method.variables) {
    if (variableSpec.kind === 'ids') {
      const objectIds = reader.ids(own(input.inputs, variableSpec.key), variableSpec.key)
      if (objectIds === null) complete = false
      else values.push(constant(String(objectIds.length)))
    } else {
      const value = reader.number(
        own(input.values, variableSpec.key),
        variableSpec.key,
        variableSpec.kind,
        variableSpec.label,
      )
      if (value === null) complete = false
      else values.push(value)
    }
  }

  if (!complete) return reader.finish(null)

  let quantity: Decimal
  if (input.methodId === 'U19:POWER_CABLE') {
    quantity = values.reduce(add, ZERO)
  } else if (input.methodId === 'U19:FENCE_LENGTH'
    || input.methodId === 'U19:FENCE_AREA') {
    const net = sub(values[0]!, values[1]!)
    if (isNegative(net)) {
      reader.fail('excluded_m: 控除が plan_length_m を超えています。負の数量・0 への丸めはしません。')
    }
    quantity = input.methodId === 'U19:FENCE_AREA' ? mul(net, values[2]!) : net
  } else {
    quantity = values.reduce(mul, constant('1'))
    if ([
      'U19:MOVE_MASS', 'U19:MOVE_VOLUME', 'U19:BASE_REBAR_T',
    ].includes(input.methodId)) {
      quantity = divPow10(quantity, 3)
    }
  }

  reader.result.steps.push(
    `${input.methodId}: ${method.variables.map((entry, index) =>
      `${entry.key}=${decimalToString(values[index]!)}`,
    ).join(', ')} → ${decimalToString(quantity)} ${method.unit}`,
  )
  return reader.finish(quantity)
}
