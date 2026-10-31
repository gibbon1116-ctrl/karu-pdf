import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { BreakdownPosition } from '../src/core/countFixtures'
import {
  breakdownEntries,
  summaryChoicesForFixture,
  summaryLabelsForFixture,
  type BreakdownEntry,
} from '../src/core/breakdownMaster'
import { GRILLE_SIZES, WASTE_KINDS } from '../src/core/breakdown/commonChoices'

function position(entry: BreakdownEntry): BreakdownPosition {
  return {
    book: entry.book,
    section: entry.section,
    subject: entry.subject,
    ...(entry.middle !== undefined ? { middle: entry.middle } : {}),
    item: entry.row.name,
  }
}

test('機械設備の換気設備・ダクト設備・吹出口の寸法はGRILLE_SIZES', () => {
  const entry = breakdownEntries('機械設備').find(candidate =>
    candidate.section === '庁舎'
    && candidate.subject === '換気設備'
    && candidate.middle === 'ダクト設備'
    && candidate.row.name === '吹出口',
  )
  assert.ok(entry)

  // 呼び寸法（GRILLE_SIZES）の後ろに、標準単価積算基準のガラリ面積の区分（U6）が続く。
  const choices = summaryChoicesForFixture(position(entry), '吹出口', '寸法')
  assert.deepEqual(choices.slice(0, GRILLE_SIZES.length), GRILLE_SIZES)
  assert.ok(choices.includes('面積 0.1㎡以下'))
  assert.ok(summaryLabelsForFixture(position(entry), '吹出口').includes('寸法'))
})

test('電灯設備・コンセント分岐・配線器具の明細コンセントの種類は明細の選択肢と同じ', () => {
  const entry = breakdownEntries('電気設備').find(candidate =>
    candidate.section === '庁舎'
    && candidate.subject === '電灯設備'
    && candidate.middle === 'コンセント分岐'
    && candidate.row.name === '配線器具',
  )
  assert.ok(entry)
  assert.equal(entry.row.separate, true)

  const expected = [...new Set(entry.details
    .filter(detail => detail.name === 'コンセント')
    .flatMap(detail => detail.summary ?? [])
    .filter(slot => slot.label === '種類')
    .flatMap(slot => slot.choices ?? []))]
  // 7件の種類の後ろに、標準単価積算基準のコンセントの区分（U6）が続く。
  assert.ok(expected.length > 7)
  assert.deepEqual(
    summaryChoicesForFixture(position(entry), 'コンセント', '種類'),
    expected,
  )
  assert.ok(summaryLabelsForFixture(position(entry), 'コンセント').includes('種類'))
  assert.deepEqual(
    summaryChoicesForFixture(position(entry), '存在しない明細', '種類'),
    [],
  )
  assert.deepEqual(summaryLabelsForFixture(position(entry), '存在しない明細'), [])
})

test('発生材処分の種類はWASTE_KINDS', () => {
  for (const book of ['電気設備', '機械設備'] as const) {
    const entries = breakdownEntries(book).filter(entry =>
      entry.row.name === '発生材処分' && !entry.row.separate,
    )
    assert.ok(entries.length > 0, `${book}に発生材処分がある`)
    for (const entry of entries) {
      assert.deepEqual(
        summaryChoicesForFixture(position(entry), entry.row.name, '種類'),
        WASTE_KINDS,
      )
    }
  }
})

test('位置がない場合と、位置の行が見つからない場合は空', () => {
  assert.deepEqual(summaryChoicesForFixture(undefined, '吹出口', '寸法'), [])
  assert.deepEqual(summaryLabelsForFixture(undefined, '吹出口'), [])

  const missing: BreakdownPosition = {
    book: '機械設備',
    section: '存在しない種目',
    subject: '換気設備',
    middle: 'ダクト設備',
    item: '吹出口',
  }
  assert.deepEqual(summaryChoicesForFixture(missing, '吹出口', '寸法'), [])
  assert.deepEqual(summaryLabelsForFixture(missing, '吹出口'), [])
})
