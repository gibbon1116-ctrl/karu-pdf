import { describe, expect, it } from 'vitest'
import {
  ENGINE_REVISION,
  FORMULA_CAPABILITIES,
  METHOD_CAPABILITIES,
  SCHEDULE_CAPABILITIES,
} from '../src/core/takeoff/capabilities'
import { calculateFormula } from '../src/core/takeoff/kernels'
import { calculateSchedule } from '../src/core/takeoff/schedules'
import { calculateUnitMethod, UNIT_METHOD_SPECS } from '../src/core/takeoff/unitMethods'
import type { DetailFormatId, FormulaId } from '../src/core/takeoff/types'

describe('takeoff capability contracts', () => {
  it('publishes the engine revision and per-method revisions', () => {
    expect(ENGINE_REVISION).toBe('takeoff-engine-1')
    for (const capability of [
      ...Object.values(FORMULA_CAPABILITIES),
      ...Object.values(SCHEDULE_CAPABILITIES),
      ...Object.values(METHOD_CAPABILITIES),
    ]) {
      expect(capability.revision).toBe('1')
    }
  })

  it('matches every formula execution path', () => {
    expect(Object.keys(FORMULA_CAPABILITIES)).toHaveLength(24)
    for (const [id, capability] of Object.entries(FORMULA_CAPABILITIES)) {
      const result = calculateFormula({
        formula: id as FormulaId,
        targetUnit: id === 'F_COUNT' ? '台' : 'm2',
        body: {},
      })
      if (capability.status === 'UNSUPPORTED') {
        expect(result.status).toBe('UNSUPPORTED')
      } else if (capability.status === 'NO_QUANTITY') {
        expect(result.status).toBe('NO_QUANTITY')
      } else {
        expect(result.status).not.toBe('UNSUPPORTED')
        expect(result.status).not.toBe('NO_QUANTITY')
      }
    }
  })

  it('matches all 22 detail formats and the two extra schedules', () => {
    expect(Object.keys(SCHEDULE_CAPABILITIES)).toHaveLength(24)
    for (const [format, capability] of Object.entries(SCHEDULE_CAPABILITIES)) {
      expect(capability.status).toBe('IMPLEMENTED')
      const result = calculateSchedule({
        format: format as DetailFormatId | 'DUCT' | 'HATSURI_VOL',
        targetUnit: 'm2',
        schedule: {},
      })
      expect(result.status).not.toBe('UNSUPPORTED')
      expect(result.status).not.toBe('NO_QUANTITY')
    }
  })

  it('matches all 35 method paths, including explicit reference-only rejection', () => {
    expect(Object.keys(METHOD_CAPABILITIES)).toHaveLength(35)
    expect(Object.keys(METHOD_CAPABILITIES).sort())
      .toEqual(Object.keys(UNIT_METHOD_SPECS).sort())

    for (const [methodId, capability] of Object.entries(METHOD_CAPABILITIES)) {
      const result = calculateUnitMethod({
        methodId,
        inputs: methodId === 'U19:NO_SEPARATE'
          ? {
            reason_code: 'INCLUDED',
            counterpart_definition_or_trade: 'TEST-COUNTERPART',
            inclusion_or_allocation_evidence: 'TEST-EVIDENCE',
          }
          : {},
        values: {},
        requiredInputs: [],
      })

      if (methodId === 'U19:AHU_INSTALL') {
        expect(capability.status).toBe('UNSUPPORTED')
        expect(capability.note).toBe('参照専用')
        expect(result.status).toBe('INVALID')
        expect(result.errors.join(' ')).toContain('参照専用')
      } else if (capability.status === 'NO_QUANTITY') {
        expect(result.status).toBe('NO_QUANTITY')
        expect(result.value).toBeNull()
      } else {
        expect(capability.status).toBe('IMPLEMENTED')
        expect(result.status).not.toBe('UNSUPPORTED')
        expect(result.status).not.toBe('NO_QUANTITY')
      }
    }
  })
})
