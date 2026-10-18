import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import master from '../src/core/takeoff/master.data'
import {
  buildCoverageLedger,
  ledgerSummary,
  ledgerToCsv,
  type CoverageClass,
  type LedgerRow,
} from '../src/core/takeoff/ledger'
import { createMasterView } from '../src/core/takeoff/master'
import type { ImplementationRole } from '../src/core/takeoff/types'

const view = createMasterView(master)
const rows = buildCoverageLedger(view)
const summary = ledgerSummary(rows)

const coverageClasses: readonly CoverageClass[] = [
  'EXECUTABLE',
  'DETAIL_SCHEDULE',
  'METHOD_SELECTION',
  'HATSURI_METHOD',
  'NEEDS_ADOPTED_BASIS',
  'AUXILIARY_ONLY',
  'PARENT_ONLY',
  'RECORD_ONLY',
  'LABOR',
  'IMPLEMENTATION_PENDING',
  'MASTER_CONFLICT',
]

function rowFor(id: string): LedgerRow {
  const found = rows.find(row => row.definitionId === id)
  if (!found) throw new Error(`台帳行がありません: ${id}`)
  return found
}

describe('takeoff coverage ledger', () => {
  it('949定義を重複なく各1分類へ対応付ける', () => {
    expect(rows).toHaveLength(949)
    expect(new Set(rows.map(row => row.definitionId)).size).toBe(949)
    expect(rows.map(row => row.definitionId)).toEqual(
      master.definitions.map(entry => entry.id),
    )
    expect(Object.values(summary).reduce((total, count) => total + count, 0))
      .toBe(949)

    for (const row of rows) {
      expect(coverageClasses).toContain(row.coverage)
      expect(row.resumeCondition.trim()).not.toBe('')
      expect(row.sourceCells).toContain('数量算定949対応!')
      expect(row.sourceCells).toContain('定義949行_必須入力!')
      expect(row.sourceCells).toContain('949定義の再検証!')
      expect(row.sourceCells).toContain('単価分担949照合!')
    }
  })

  it('役割の件数が生成データと一致する', () => {
    const expected: Readonly<Record<ImplementationRole, number>> = {
      数量候補: 842,
      '親/確認記録': 41,
      未確定方式: 19,
      '補助量/照査': 46,
      工数: 1,
    }

    for (const [role, count] of Object.entries(expected)) {
      expect(rows.filter(row => row.role === role)).toHaveLength(count)
      expect(master.counts.implementationRoles[role]).toBe(count)
    }
  })

  it('親31・記録10・補助46・未確定19・工数1を分類する', () => {
    expect(summary.PARENT_ONLY).toBe(31)
    expect(summary.RECORD_ONLY).toBe(10)
    expect(summary.AUXILIARY_ONLY).toBe(46)
    expect(summary.METHOD_SELECTION).toBe(19)
    expect(summary.LABOR).toBe(1)
    expect(summary.NEEDS_ADOPTED_BASIS).toBe(13)
    expect(summary.HATSURI_METHOD).toBe(1)
    expect(summary.MASTER_CONFLICT).toBe(0)

    for (const entry of master.definitions) {
      const row = rowFor(entry.id)

      if (entry.quantityRole === 'ROUTER') {
        expect(row.coverage).toBe('PARENT_ONLY')
        expect(row.runtimePath).toBe('router')
      } else if (entry.quantityRole === 'RECORD_ONLY') {
        expect(row.coverage).toBe('RECORD_ONLY')
        expect(row.runtimePath).toBe('record')
      } else if (entry.role === '補助量/照査') {
        expect(row.coverage).toBe('AUXILIARY_ONLY')
      } else if (entry.role === '未確定方式') {
        expect(row.coverage).toBe('METHOD_SELECTION')
        expect(row.runtimePath).toBe('method')
      } else if (entry.role === '工数') {
        expect(row.coverage).toBe('LABOR')
      } else if (entry.duct) {
        expect(row.coverage).toBe('NEEDS_ADOPTED_BASIS')
        expect(row.runtimePath).toBe('duct')
      }
    }
  })

  it('数量候補の分類合計が842に一致する', () => {
    const quantityClasses: readonly CoverageClass[] = [
      'EXECUTABLE',
      'DETAIL_SCHEDULE',
      'HATSURI_METHOD',
      'NEEDS_ADOPTED_BASIS',
      'IMPLEMENTATION_PENDING',
      'MASTER_CONFLICT',
    ]

    expect(quantityClasses.reduce(
      (total, coverage) => total + summary[coverage],
      0,
    )).toBe(842)

    expect(rows.filter(row => row.role === '数量候補').every(row =>
      quantityClasses.includes(row.coverage),
    )).toBe(true)
  })

  it('計算可能な補助量も正式数量の分類に変更しない', () => {
    const implemented = rows.filter(row =>
      row.role === '補助量/照査' && row.capability === 'IMPLEMENTED',
    )
    expect(implemented.length).toBeGreaterThan(0)
    expect(implemented.every(row => row.coverage === 'AUXILIARY_ONLY')).toBe(true)

    const union = rows.find(row =>
      row.role === '補助量/照査' && row.formula === 'F_UNION',
    )
    if (!union) throw new Error('F_UNIONの補助量がありません。')

    expect(union.coverage).toBe('AUXILIARY_ONLY')
    expect(union.capability).toBe('UNSUPPORTED')
    expect(union.implementationGaps.join('')).toContain('対象面の和集合の幾何')
  })

  it('全行に文章の施工条件の確認方法を残す', () => {
    for (const row of rows) {
      expect(row.implementationGaps).toContain(
        '施工条件は文章のまま。利用者の回答（true/false/不明）と根拠で確認する',
      )
    }
  })

  it('案件資料を参照文字列から解決する', () => {
    for (const entry of master.definitions) {
      const row = rowFor(entry.id)
      const expected = [
        view.text(entry.review.project),
        view.text(entry.detail?.missing),
        view.text(entry.duct?.remaining),
        view.text(entry.unresolved?.check),
        view.text(entry.auxiliary?.missing),
      ].filter(text => text.trim() !== '')

      expect(row.projectMaterials).toEqual([...new Set(expected)])
    }
  })

  it('競合を他の分類より優先する', () => {
    const entry = master.definitions.find(value => value.quantityRole === 'ROUTER')
    if (!entry) throw new Error('親定義がありません。')

    const custom = createMasterView({
      ...master,
      conflicts: [{
        definitionId: entry.id,
        property: 'unit',
        reason: '照合待ち',
        cells: ['数量算定949対応!1'],
      }],
    })
    const row = buildCoverageLedger(custom).find(value =>
      value.definitionId === entry.id,
    )

    expect(row?.coverage).toBe('MASTER_CONFLICT')
    expect(row?.runtimePath).toBe('none')
    expect(row?.capability).toBe('N/A')
    expect(row?.implementationGaps.join('')).toContain('MASTER_CONFLICT')
  })

  it('CSVにBOM・見出し・CRLFとRFC 4180の引用を付ける', () => {
    const csv = ledgerToCsv(rows)

    expect(csv.charCodeAt(0)).toBe(0xFEFF)
    expect(csv.slice(1).split('\r\n')[0]).toBe([
      'definitionId',
      'trade',
      'label',
      'unit',
      'role',
      'sourceState',
      'formula',
      'coverage',
      'runtimePath',
      'capability',
      'implementationGaps',
      'projectMaterials',
      'resumeCondition',
      'rules',
      'sourceCells',
    ].map(value => `"${value}"`).join(','))
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(csv.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)

    const first = rows[0]
    if (!first) throw new Error('台帳が空です。')

    const quoted = ledgerToCsv([{
      ...first,
      label: 'A,"B"\nC',
    }])
    expect(quoted).toContain('"A,""B""\r\nC"')
  })

  it('TAKEOFF_LEDGER_OUTが指定された場合だけCSVを書き出す', () => {
    const outputPath = process.env.TAKEOFF_LEDGER_OUT
    if (outputPath) {
      writeFileSync(outputPath, ledgerToCsv(rows), { encoding: 'utf8' })
    }
    expect(rows).toHaveLength(949)
  })
})
