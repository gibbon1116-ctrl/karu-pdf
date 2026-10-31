import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { CountFixture } from '../src/core/countFixtures'
import { normalizeItemName } from '../src/core/related/suggest'
import { documentSummaryValues } from '../src/core/summaryValues'

type Source = Pick<CountFixture, 'name' | 'summary'>

function fixture(name: string, values: readonly string[], label = '記号'): Source {
  return { name, summary: values.map(value => ({ label, value })) }
}

test('名称を正規化して比較し、同じ名称の値を先に返す', () => {
  const name = 'パッケージ形空気調和機'
  const spacedName = ` ${name} `
  assert.equal(normalizeItemName(spacedName), normalizeItemName(name))

  const fixtures = [
    fixture('ほかの機器', ['OTHER-1']),
    fixture(spacedName, ['PAC-1']),
    fixture(name, ['PAC-2']),
    fixture('ほかの機器', ['OTHER-2']),
  ]

  assert.deepEqual(documentSummaryValues(fixtures, '記号', name), [
    'PAC-1', 'PAC-2', 'OTHER-1', 'OTHER-2',
  ])
})

test('値をtrimし、空と重複を除き、指定した区分だけを集める', () => {
  const fixtures: Source[] = [
    fixture('機器', [' PAC-1 ', '', '   ', 'PAC-1', 'PAC-2']),
    fixture('ほかの機器', ['PAC-2', ' PAC-3 ']),
    fixture('機器', ['対象外'], '名称'),
    { name: '摘要なし' },
  ]

  assert.deepEqual(documentSummaryValues(fixtures, '記号', '機器'), [
    'PAC-1', 'PAC-2', 'PAC-3',
  ])
})

test('名称を指定しない場合は文書の順で返す', () => {
  assert.deepEqual(documentSummaryValues([
    fixture('A', ['A-1']),
    fixture('B', ['B-1']),
    fixture('A', ['A-2']),
  ], '記号'), ['A-1', 'B-1', 'A-2'])
  assert.deepEqual(documentSummaryValues([], '記号'), [])
})

test('同じ名称を優先し、重複を数えず最大30件にする', () => {
  const sameValues = Array.from({ length: 35 }, (_, index) => `PAC-${index + 1}`)
  const fixtures = [
    fixture('ほかの機器', ['OTHER-1']),
    fixture('機器', ['', ...sameValues.flatMap(value => [value, ` ${value} `])]),
  ]

  assert.deepEqual(
    documentSummaryValues(fixtures, '記号', '機器'),
    sameValues.slice(0, 30),
  )
})

test('同じ名称の値が30件未満なら、残りをほかの項目から補う', () => {
  const otherValues = Array.from({ length: 40 }, (_, index) => `OTHER-${index + 1}`)
  assert.deepEqual(documentSummaryValues([
    fixture('ほかの機器', ['PAC-1', ...otherValues]),
    fixture('機器', ['PAC-1', 'PAC-2']),
  ], '記号', '機器'), ['PAC-1', 'PAC-2', ...otherValues.slice(0, 28)])
})
