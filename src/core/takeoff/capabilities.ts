import type { DetailFormatId, FormulaId } from './types'
import { UNIT_METHOD_SPECS } from './unitMethods'

export type CapabilityStatus = 'IMPLEMENTED' | 'UNSUPPORTED' | 'NO_QUANTITY'

export interface Capability {
  status: CapabilityStatus
  revision: string
  note: string
}

export const ENGINE_REVISION = 'takeoff-engine-1'

function capability(status: CapabilityStatus, note = ''): Capability {
  return Object.freeze({ status, revision: '1', note })
}

export const FORMULA_CAPABILITIES: Readonly<Record<FormulaId, Capability>> = {
  F_MANUAL: capability('IMPLEMENTED'),
  F_SAME: capability('IMPLEMENTED'),
  F_SUBSET: capability('IMPLEMENTED'),
  F_UNIQUE: capability('IMPLEMENTED'),
  F_COUNT: capability('IMPLEMENTED'),
  F_FACTOR: capability('IMPLEMENTED'),
  F_RECT: capability('IMPLEMENTED'),
  F_ROUND: capability('IMPLEMENTED', 'π は 30 桁で打ち切り'),
  F_WALL: capability('IMPLEMENTED'),
  F_UP: capability('IMPLEMENTED'),
  F_THICK: capability('IMPLEMENTED'),
  F_TRENCH: capability('IMPLEMENTED'),
  F_PIT: capability('IMPLEMENTED'),
  F_BACK: capability('IMPLEMENTED'),
  F_DIFF: capability('IMPLEMENTED'),
  F_MASS: capability('IMPLEMENTED'),
  F_TON: capability('IMPLEMENTED'),
  F_UNION: capability('UNSUPPORTED', '対象面の和集合の検証は未実装'),
  F_EDGE: capability('IMPLEMENTED'),
  F_SURFACE: capability('IMPLEMENTED'),
  F_DESIGN: capability('UNSUPPORTED', '明細を schedules へ渡す'),
  F_CHECK: capability('NO_QUANTITY', '確認記録のみ'),
  F_SAND: capability('IMPLEMENTED'),
  F_DUCT_RECT_EST: capability('UNSUPPORTED', 'DUCT 明細を schedules へ渡す'),
}

const SCHEDULE_FORMATS: readonly (DetailFormatId | 'DUCT' | 'HATSURI_VOL')[] = [
  'REBAR', 'STEEL', 'CONCRETE', 'ANCHOR', 'SWITCH', 'VENT', 'GLASS', 'FORM',
  'STEEL_PAINT', 'FIRE', 'JOINT', 'BOLT', 'WASTE_MASS', 'OIL_BUND',
  'EARTH_HAUL', 'EARTH_DISPOSE', 'BEDDING', 'LABOR', 'DEMO', 'GROUT',
  'STRIP', 'COEFF', 'DUCT', 'HATSURI_VOL',
]

export const SCHEDULE_CAPABILITIES:
Readonly<Record<DetailFormatId | 'DUCT' | 'HATSURI_VOL', Capability>> =
  Object.freeze(Object.fromEntries(
    SCHEDULE_FORMATS.map(format => [format, capability('IMPLEMENTED')]),
  )) as Readonly<Record<DetailFormatId | 'DUCT' | 'HATSURI_VOL', Capability>>

export const METHOD_CAPABILITIES: Readonly<Record<string, Capability>> =
  Object.freeze(Object.fromEntries(Object.values(UNIT_METHOD_SPECS).map(method => [
    method.id,
    method.id === 'U19:AHU_INSTALL'
      ? capability('UNSUPPORTED', '参照専用')
      : method.id === 'U19:NO_SEPARATE'
        ? capability('NO_QUANTITY', '別計上しない記録')
        : capability('IMPLEMENTED'),
  ])))
