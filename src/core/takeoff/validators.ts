import type { CalcResult } from './calcTypes'
import { isMissingFact } from './conditions'
import type { Facts, ValidatorResult } from './readiness'
import type { MasterDefinition } from './types'
import { UNIT_METHOD_SPECS } from './unitMethods'
import { normalizeUnit, sameUnit } from './units'

export interface ValidatorContext {
  definition: MasterDefinition
  facts: Facts
  checkAnswers: Readonly<Record<string, {
    answer: 'true' | 'false' | 'unknown'
    evidence?: string
  }>>
  calc?: CalcResult
  targetUnit?: string
  dependencies?: {
    cycle: boolean
    staleIds: readonly string[]
    orphanIds: readonly string[]
  }
  coexistence?: {
    conflicts: readonly string[]
  }
  geometry?: {
    source: 'none' | 'fixture' | 'manual' | 'rows' | 'schedule' | 'method'
    supported: boolean
    note?: string
  }
}

function ownFact(facts: Facts, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(facts, key)
    ? facts[key]
    : undefined
}

function result(
  name: string,
  status: ValidatorResult['status'],
  message: string,
): ValidatorResult {
  return { name, status, message }
}

function calculationReason(calc: CalcResult): string {
  const messages = [
    ...calc.errors,
    ...calc.missing.map(key => `未入力: ${key}`),
  ]
  return messages.length > 0 ? messages.join(' / ') : calc.status
}

function runOne(name: string, context: ValidatorContext): ValidatorResult {
  const { definition, facts } = context

  switch (name) {
    case 'condition_checks_complete': {
      const problems: string[] = []

      for (const check of definition.checks) {
        const answer = Object.prototype.hasOwnProperty.call(
          context.checkAnswers,
          check.id,
        )
          ? context.checkAnswers[check.id]
          : undefined

        if (!answer) {
          problems.push(`${check.id}: 回答がありません。`)
          continue
        }

        if (check.effect === 'PHYSICAL_APPLICABILITY') {
          if (answer.answer !== 'true') {
            problems.push(
              `${check.id}: 施工の適用条件が true ではありません（${answer.answer}）。`,
            )
          }
          if (isMissingFact(answer.evidence)) {
            problems.push(`${check.id}: 適用判断の根拠がありません。`)
          }
        }
      }

      return problems.length > 0
        ? result(name, 'FAILED', problems.join(' / '))
        : result(name, 'OK', '施工条件への回答と適用根拠を確認しました。')
    }

    case 'scope_contract': {
      const problems = ['scope_id', 'physical_object_id'].filter(key =>
        isMissingFact(ownFact(facts, key)),
      )
      if (ownFact(facts, 'scope_verified') !== true) {
        problems.push('scope_verified')
      }
      return problems.length > 0
        ? result(name, 'FAILED', `範囲契約の不足・未確認: ${problems.join('、')}`)
        : result(name, 'OK', '対象範囲と現物IDを確認しました。')
    }

    case 'method_profile': {
      const calc = context.calc
      if (!calc) {
        return result(name, 'UNSUPPORTED', '計算結果がありません。')
      }
      if (calc.status === 'UNSUPPORTED') {
        return result(name, 'UNSUPPORTED', calculationReason(calc))
      }
      if (calc.status !== 'CALCULATED') {
        return result(name, 'FAILED', calculationReason(calc))
      }
      return result(name, 'OK', '最新の計算結果が成立しています。')
    }

    case 'dependency_graph': {
      const dependencies = context.dependencies
      if (!dependencies) {
        return result(name, 'UNSUPPORTED', '依存関係の検証材料がありません。')
      }

      const problems: string[] = []
      if (dependencies.cycle) problems.push('依存関係に循環があります。')
      if (dependencies.staleIds.length > 0) {
        problems.push(`古い依存: ${dependencies.staleIds.join('、')}`)
      }
      if (dependencies.orphanIds.length > 0) {
        problems.push(`失効・参照先なし: ${dependencies.orphanIds.join('、')}`)
      }

      return problems.length > 0
        ? result(name, 'FAILED', problems.join(' / '))
        : result(name, 'OK', '依存関係に循環・古い版・失効参照はありません。')
    }

    case 'selection_coexistence': {
      const coexistence = context.coexistence
      if (!coexistence) {
        return result(name, 'UNSUPPORTED', '選択の両立性の検証材料がありません。')
      }
      return coexistence.conflicts.length > 0
        ? result(
            name,
            'FAILED',
            `同じ範囲で両立しない選択: ${coexistence.conflicts.join('、')}`,
          )
        : result(name, 'OK', '選択の両立性を確認しました。')
    }

    case 'units_and_dimensions': {
      const targetUnit = context.targetUnit
      if (targetUnit === undefined || targetUnit.trim() === '') {
        return result(name, 'UNSUPPORTED', 'targetUnit がありません。')
      }
      if (!context.calc) {
        return result(name, 'UNSUPPORTED', '単位を照合する計算結果がありません。')
      }

      const originalUnit = normalizeUnit(definition.unit)
      let expectedUnit = definition.unit

      if (originalUnit === ''
        || originalUnit === '—'
        || originalUnit === '未確定') {
        const methodId = ownFact(facts, 'selected_method_id')
        if (typeof methodId !== 'string' || methodId.trim() === '') {
          return result(name, 'UNSUPPORTED', '選択方式の単位を確認できません。')
        }

        const method = Object.prototype.hasOwnProperty.call(
          UNIT_METHOD_SPECS,
          methodId,
        )
          ? UNIT_METHOD_SPECS[methodId]
          : undefined

        if (!method) {
          return result(name, 'UNSUPPORTED', `方式 ${methodId} は未対応です。`)
        }
        if (!method.selectable
          || (definition.unresolved
            && !definition.unresolved.methods.includes(methodId))) {
          return result(name, 'FAILED', `方式 ${methodId} はこの定義で選べません。`)
        }

        expectedUnit = method.unit
      }

      const problems: string[] = []
      if (!sameUnit(targetUnit, context.calc.unit)) {
        problems.push(
          `targetUnit=${targetUnit} と計算単位=${context.calc.unit} が一致しません。`,
        )
      }
      if (!sameUnit(targetUnit, expectedUnit)) {
        problems.push(
          `targetUnit=${targetUnit} と採用対象の単位=${expectedUnit} が一致しません。`,
        )
      }

      return problems.length > 0
        ? result(name, 'FAILED', problems.join(' / '))
        : result(name, 'OK', '採用単位・計算単位・定義または選択方式の単位が一致します。')
    }

    case 'formula_geometry_support': {
      const geometry = context.geometry
      if (!geometry) {
        return result(name, 'UNSUPPORTED', '形状・入力経路の検証材料がありません。')
      }
      return geometry.supported
        ? result(
            name,
            'OK',
            geometry.note || `入力経路 ${geometry.source} に対応しています。`,
          )
        : result(
            name,
            'FAILED',
            geometry.note || `入力経路 ${geometry.source} に対応していません。`,
          )
    }

    default:
      return result(name, 'UNSUPPORTED', `外部検証器 ${name} は未対応です。`)
  }
}

export function runExternalValidators(
  names: readonly string[],
  context: ValidatorContext,
): ValidatorResult[] {
  return names.map(name => runOne(name, context))
}
