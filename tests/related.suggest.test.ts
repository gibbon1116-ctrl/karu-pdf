import { describe, expect, it } from 'vitest'
import {
  catalogItems,
  catalogPresets,
  representativeBreakdownPosition,
} from '../src/core/catalog'
import type { CountFixture } from '../src/core/countFixtures'
import { fixtureFromPreset } from '../src/core/quantityMaster'
import { RELATED_RULES } from '../src/core/related/rules'
import {
  buildRelatedIndex,
  contextChecks,
  normalizeItemName,
  suggestRelated,
  type RelatedDecision,
  type RelatedSuggestion,
} from '../src/core/related/suggest'
import type { ProjectMode, RelatedBook, RelatedRule, WorkType } from '../src/core/related/types'
import { loadRelated } from '../src/app/relatedModel'
import { relatedSessionMemory } from '../src/app/relatedState'

const index = buildRelatedIndex(RELATED_RULES)
const items = catalogItems()

const resolveTarget = (
  target: { category: string; name?: string },
  book: RelatedBook,
) => items.filter(item =>
  (item.field === book || (book === '建築' && item.field === '仮設・土工'))
  && item.category === target.category
  && (target.name === undefined
    || normalizeItemName(item.name) === normalizeItemName(target.name)))

describe('SPEC-R7d building assemblies', () => {
  const ceiling = () => fixtureFor({
    book: '建築',
    category: '内外装',
    name: '軽量鉄骨天井下地',
  })
  const findTarget = (suggestions: readonly RelatedSuggestion[], name: string) =>
    suggestions.find(suggestion => suggestion.targets.some(target =>
      target.name !== undefined
      && normalizeItemName(target.name) === normalizeItemName(name)))

  it('offers removal, temporary work, finishes, accessories and disposal for replacement', () => {
    const suggestions = evaluate(ceiling(), '改修', '更新・交換')
    for (const name of [
      '天井合板ボード撤去',
      '天井廻り縁撤去',
      '天井点検口撤去',
    ]) {
      expect(findTarget(suggestions, name)).toMatchObject({
        kind: 'item', role: '撤去', assembly: '天井',
      })
    }
    for (const name of ['養生', '墨出し', '内部仕上足場']) {
      expect(findTarget(suggestions, name)).toMatchObject({
        kind: 'item', role: '仮設', assembly: '天井',
      })
    }
    for (const name of [
      '天井せっこうボード張り',
      '天井化粧せっこうボード張り',
    ]) {
      expect(findTarget(suggestions, name)).toMatchObject({
        kind: 'item',
        role: '主仕上げ',
        assembly: '天井',
        oneOf: 'ceiling-board',
      })
    }
    for (const name of ['天井廻り縁', '天井点検口']) {
      expect(findTarget(suggestions, name)).toMatchObject({
        kind: 'item', role: '附属', assembly: '天井',
      })
    }
    for (const name of ['ＥＰ合成樹脂エマルションペイント塗り', '壁紙張り']) {
      expect(findTarget(suggestions, name)).toMatchObject({
        kind: 'item',
        role: '表面処理',
        assembly: '天井',
        oneOf: 'ceiling-surface',
      })
    }
    for (const name of ['発生材積込み', '発生材運搬', '発生材処分']) {
      expect(findTarget(suggestions, name)).toMatchObject({
        kind: 'item', role: '処理', assembly: '天井',
      })
    }
  })

  it('offers removal checks instead of removal items when work is unset', () => {
    const suggestions = evaluate(ceiling(), '改修')
    for (const name of [
      '天井合板ボード撤去',
      '天井廻り縁撤去',
      '天井点検口撤去',
    ]) {
      expect(suggestions.find(suggestion =>
        suggestion.create?.name === name)).toMatchObject({
        kind: 'check', role: '撤去', assembly: '天井',
      })
    }
    expect(suggestions.filter(suggestion =>
      suggestion.assembly === '天井'
      && suggestion.role === '撤去'
      && suggestion.kind === 'item')).toHaveLength(0)
  })

  it('does not offer removal or disposal for new construction', () => {
    const suggestions = evaluate(ceiling(), '新築', '新設')
    expect(suggestions.filter(suggestion =>
      suggestion.role === '撤去' || suggestion.role === '処理')).toHaveLength(0)
    expect(findTarget(suggestions, '天井せっこうボード張り')).toBeDefined()
  })

  it.each(['-', '－', '‐', '−'])('normalizes the katakana long mark %s', mark => {
    expect(normalizeItemName(`　天井 せっこうボ${mark}ド張り `))
      .toBe('天井せっこうボード張り')
  })

  it('normalizes compatibility characters while retaining non-katakana hyphens', () => {
    expect(normalizeItemName(' ＥＰ　塗り ')).toBe('EP塗り')
    expect(normalizeItemName('配管-1')).toBe('配管-1')
  })

  it('matches an origin whose old name contains a full-width minus', () => {
    const fixture = {
      ...ceiling(),
      name: '天井せっこうボ－ド張り',
    }
    const suggestions = evaluate(fixture, '改修', '更新・交換')
    expect(findTarget(suggestions, '軽量鉄骨天井下地')).toMatchObject({
      role: '下地', assembly: '天井',
    })
    expect(findTarget(suggestions, '養生')).toMatchObject({
      role: '仮設', assembly: '天井',
    })
  })

  it('normalizes both index names and origin conditions', () => {
    const fixture = ceiling()
    const rule: RelatedRule = {
      id: 'test-normalized-origin',
      book: '建築',
      group: '試験',
      originText: '試験',
      targetText: '試験',
      modes: ['改修'],
      question: '',
      kindText: '確認',
      kind: 'check',
      priority: '中',
      origin: { any: [{ names: [' 天井せっこうボ－ド張り　'] }] },
      targets: [],
      note: '',
      refs: [],
    }
    expect(suggestRelated({
      index: buildRelatedIndex([rule]),
      fixtures: [{ ...fixture, name: '天井せっこうボード張り' }],
      originIds: [fixture.id],
      projectMode: '改修',
      works: {},
      decisions: {},
      resolveTarget,
      // 改修で品目作業が未設定のときの案内（hint）は数えない。
    }).filter(suggestion => suggestion.kind !== 'hint')).toHaveLength(1)
  })

  it('does not repair the invalid leading parenthesis in an old name', () => {
    const fixture = { ...ceiling(), name: '（軽量鉄骨天井下地' }
    expect(evaluate(fixture, '改修', '更新・交換').filter(suggestion =>
      suggestion.ruleIds.some(id => id.startsWith('A-ceiling-'))))
      .toHaveLength(0)
  })

  it('recognizes a registered target with an old spelling without changing keys', () => {
    const fixture = ceiling()
    const before = evaluate(fixture, '改修', '更新・交換')
    const target = {
      ...fixture,
      id: `${fixture.id}-board`,
      name: ' 天井せっこうボ－ド張り　',
    }
    const after = evaluate(
      fixture, '改修', '更新・交換', [fixture, target],
    )
    const original = findTarget(before, '天井せっこうボード張り')
    expect(original).toBeDefined()
    expect(findTarget(after, '天井せっこうボード張り')).toMatchObject({
      key: original!.key,
      registeredCount: 1,
      flags: { registered: true },
    })
  })

  it('normalizes registered check names', () => {
    const fixture = ceiling()
    const target = {
      ...fixture,
      id: `${fixture.id}-removal`,
      category: '撤去',
      name: ' 天井合板ボ－ド撤去　',
    }
    const suggestions = evaluate(fixture, '改修', undefined, [fixture, target])
    expect(suggestions.find(suggestion =>
      suggestion.create?.name === '天井合板ボード撤去')).toMatchObject({
      kind: 'check',
      registeredCount: 1,
      flags: { registered: true },
    })
  })

  it('keeps the first defined assembly metadata when rules are merged', () => {
    const fixture = ceiling()
    const base: RelatedRule = {
      id: 'test-merge-1',
      book: '建築',
      group: '試験',
      originText: fixture.name,
      targetText: '壁紙張り',
      modes: ['改修'],
      question: '',
      kindText: '拾い候補',
      kind: 'item',
      priority: '中',
      origin: { any: [{ names: [fixture.name] }] },
      targets: [{ category: '内外装', name: '壁紙張り' }],
      note: '',
      refs: [],
    }
    const suggestions = suggestRelated({
      index: buildRelatedIndex([
        base,
        {
          ...base,
          id: 'test-merge-2',
          role: '表面処理',
          assembly: '天井',
          oneOf: 'first',
        },
        {
          ...base,
          id: 'test-merge-3',
          role: '主仕上げ',
          assembly: '壁',
          oneOf: 'second',
        },
      ]),
      fixtures: [fixture],
      originIds: [fixture.id],
      projectMode: '改修',
      works: { [fixture.id]: '更新・交換' },
      decisions: {},
      resolveTarget,
    })
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]).toMatchObject({
      role: '表面処理', assembly: '天井', oneOf: 'first',
      ruleIds: ['test-merge-1', 'test-merge-2', 'test-merge-3'],
    })
  })

  it('resolves old target spellings through the application model', async () => {
    const model = await loadRelated()
    const candidates = model.resolveTarget({
      category: '内外装',
      name: ' 天井せっこうボ－ド張り　',
    }, '建築')
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates.every(candidate =>
      normalizeItemName(candidate.name) === '天井せっこうボード張り')).toBe(true)
  })

  it('includes added removal rows in the catalog with breakdown positions', async () => {
    const model = await loadRelated()
    for (const name of [
      '天井合板ボード撤去',
      '天井廻り縁撤去',
      '天井点検口撤去',
    ]) {
      const candidates = model.resolveTarget({ category: '撤去', name }, '建築')
      expect(candidates.length).toBeGreaterThan(0)
      const presets = items.filter(item =>
        candidates.some(candidate => candidate.key === item.key))
        .flatMap(item => item.options.flatMap(option =>
          catalogPresets(
            item,
            { options: [option.key] },
            representativeBreakdownPosition(item),
          )))
      expect(presets.some(preset =>
        preset.breakdown?.book === '建築'
        && normalizeItemName(preset.name) === normalizeItemName(name))).toBe(true)
    }
  })
})

function fixtureFor({
  book,
  category,
  name,
  subject,
}: {
  book: RelatedBook
  category?: string
  name?: string
  subject?: string
}): CountFixture {
  for (const item of items) {
    if (item.field !== book && !(book === '建築' && item.field === '仮設・土工')) continue
    if (category !== undefined && item.category !== category) continue
    for (const option of item.options) {
      const presets = catalogPresets(
        item,
        { options: [option.key] },
        representativeBreakdownPosition(item),
      )
      for (const preset of presets) {
        if (name !== undefined && preset.name !== name) continue
        if (subject !== undefined && preset.breakdown?.subject !== subject) continue
        if (preset.breakdown?.book !== book) continue
        return fixtureFromPreset(preset, [])
      }
    }
  }
  throw new Error(`実マスタに試験起点がありません：${JSON.stringify({
    book, category, name, subject,
  })}`)
}

function evaluate(
  fixture: CountFixture,
  projectMode?: ProjectMode,
  work?: WorkType,
  fixtures: readonly CountFixture[] = [fixture],
  decisions: Readonly<Record<string, RelatedDecision>> = {},
): RelatedSuggestion[] {
  return suggestRelated({
    index,
    fixtures,
    originIds: [fixture.id],
    projectMode,
    works: work ? { [fixture.id]: work } : {},
    decisions,
    resolveTarget,
  })
}

function byRule(suggestions: readonly RelatedSuggestion[], id: string) {
  const suggestion = suggestions.find(item => item.ruleIds.includes(id))
  expect(suggestion, `${id} が出ること`).toBeDefined()
  return suggestion!
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child)
    Object.freeze(value)
  }
  return value
}

describe('関連品目の実ルール・実マスタ照合', () => {
  it('電気・新築の配線器具を照合し、凍結入力を変更しない', () => {
    const fixture = fixtureFor({ book: '電気設備', category: '配線器具' })
    const fixtures = freezeDeep([fixture])
    const before = JSON.stringify(fixtures)
    const suggestions = evaluate(fixture, '新築', undefined, fixtures)
    const targets = suggestions.filter(item => item.kind === 'item')
      .flatMap(item => item.targets)

    expect(targets.some(target => target.category.includes('ボックス'))).toBe(true)
    expect(targets.some(target => target.category === '電線管')).toBe(true)
    expect(targets.some(target => target.category.includes('ケーブル'))).toBe(true)
    // プレートの単価包含（E-040）は注意で、項目や判断の対象にしない
    expect(byRule(suggestions, 'E-040').kind).toBe('note')
    expect(byRule(suggestions, 'E-040').targets).toEqual([])
    expect(JSON.stringify(fixtures)).toBe(before)
  })

  it('電気・改修の分電盤では作業条件と工事区分を守る', () => {
    const fixture = fixtureFor({ book: '電気設備', name: '分電盤' })
    const suggestions = evaluate(fixture, '改修', '更新・交換')
    expect(byRule(suggestions, 'E-094').kind).toBe('item')
    expect(['check', 'note']).toContain(byRule(suggestions, 'E-095').kind)

    const unset = evaluate(fixture, '改修')
    expect(unset.some(item => item.ruleIds.includes('E-094'))).toBe(false)
    expect(unset.filter(item => item.kind === 'hint')).toHaveLength(1)
    expect(unset.find(item => item.kind === 'hint')?.targetTexts)
      .toEqual(['品目作業を選ぶと関連の候補が増えます'])

    const modeUnknown = evaluate(fixture, undefined, '更新・交換')
    expect(byRule(modeUnknown, 'E-094').flags.modeUnknown).toBe(true)
    expect(modeUnknown.filter(item => item.kind !== 'hint')
      .every(item => item.flags.modeUnknown)).toBe(true)
  })

  it('機械・新築の給水管では保温を集約し、管継手を提案しない', () => {
    const fixture = fixtureFor({
      book: '機械設備',
      category: '配管（給水・給湯）',
    })
    const suggestions = evaluate(fixture, '新築')
    const insulation = byRule(suggestions, 'M-010')
    expect(insulation.kind).toBe('item')
    expect(insulation.ruleIds).toContain('M-090')
    expect(suggestions.filter(item => item.ruleIds.includes('M-010')
      || item.ruleIds.includes('M-090'))).toHaveLength(1)
    expect(suggestions.some(item => item.targets.some(target =>
      target.category.includes('弁')))).toBe(true)
    expect(suggestions.some(item => item.kind === 'check'
      && [...item.targetTexts, ...item.questions].join(' ').includes('試験'))).toBe(true)
    // 一般の管継手（エルボ・チーズ等）は提案しない。伸縮管継手・防振継手は M-004・M-005 の条件付候補で別物
    expect(suggestions.filter(item => item.kind !== 'note').some(item => item.targets.some(target =>
      target.category === '管継手' || target.name === '管継手'
      || item.targetTexts.some(text => /^(?:管継手|継手類)$/.test(text))))).toBe(false)
  })

  it('機械・改修の空調機では撤去・閉塞と確認事項を分ける', () => {
    const fixture = fixtureFor({
      book: '機械設備',
      name: 'パッケージ形空気調和機',
    })
    const suggestions = evaluate(fixture, '改修', '更新・交換')
    expect(byRule(suggestions, 'M-155').kind).toBe('item')
    expect(byRule(suggestions, 'M-157').kind).toBe('item')
    expect(['check', 'note']).toContain(byRule(suggestions, 'M-158').kind)
    expect(['check', 'note']).toContain(byRule(suggestions, 'M-160').kind)
  })

  it('建築・改修の防水改修科目を照合する', () => {
    const fixture = fixtureFor({ book: '建築', subject: '防水改修' })
    const suggestions = evaluate(fixture, '改修')
    for (const id of ['B-140', 'B-141', 'B-142', 'B-143', 'B-144', 'B-145', 'B-X01']) {
      expect(byRule(suggestions, id).kind).toBe('item')
    }
    expect(['check', 'note']).toContain(byRule(suggestions, 'B-148').kind)
  })

  it('文脈ルールは案件確認だけに出す', () => {
    const checks = contextChecks({ index, projectMode: '解体', decisions: {} })
    expect(['check', 'note']).toContain(byRule(checks, 'B-252').kind)
    expect(['check', 'note']).toContain(byRule(checks, 'B-254').kind)
    expect(contextChecks({ index, decisions: {} })).toEqual([])

    const fixture = fixtureFor({ book: '建築' })
    const suggestions = evaluate(fixture, '混在', '解体')
    const contextIds = new Set(index.context.map(rule => rule.id))
    expect(suggestions.every(item =>
      item.ruleIds.every(id => !contextIds.has(id)))).toBe(true)
  })

  it('登録済みの名称・分類と件数を記録する', () => {
    const fixture = fixtureFor({ book: '電気設備', category: '配線器具' })
    const initial = evaluate(fixture, '新築')
    const suggestion = initial.find(item => item.kind === 'item' && item.targets.length)!
    expect(suggestion).toBeDefined()
    const target = suggestion.targets[0]
    const registered = fixtureFor({
      book: suggestion.book,
      category: target.category,
      name: target.name,
    })
    const registered2 = { ...registered, id: `${registered.id}-second`, order: 2 }
    const suggestions = evaluate(
      fixture, '新築', undefined, [fixture, registered, registered2],
    )
    const found = suggestions.find(item => item.key === suggestion.key)!
    expect(found.flags.registered).toBe(true)
    expect(found.targets[0].registeredCount).toBeGreaterThanOrEqual(2)
    expect(found.registeredCount).toBeGreaterThanOrEqual(2)
  })

  it('新築では改修だけのルールを除き、混在では出す', () => {
    const fixture = fixtureFor({ book: '電気設備', name: '分電盤' })
    expect(evaluate(fixture, '新築', '更新・交換')
      .some(item => item.ruleIds.includes('E-094'))).toBe(false)
    expect(byRule(evaluate(fixture, '混在', '更新・交換'), 'E-094').kind).toBe('item')
  })

  it('名称は完全一致し、似た名称を起点にしない', () => {
    // E-094 は名称「分電盤」＋品目作業「更新・交換」で起点になる。名称が違えば分類が同じ（盤類）でも起点にしない
    const panel = fixtureFor({ book: '電気設備', name: '分電盤' })
    const similar = { ...panel, id: `${panel.id}-similar`, name: '分電盤A' }
    const run = (fixture: CountFixture) => suggestRelated({
      index,
      fixtures: [fixture],
      originIds: [fixture.id],
      projectMode: '改修',
      works: { [fixture.id]: '更新・交換' },
      decisions: {},
      resolveTarget,
    })
    expect(run(panel).some(item => item.ruleIds.includes('E-094'))).toBe(true)
    expect(run(similar).some(item => item.ruleIds.includes('E-094'))).toBe(false)
  })

  it('複数起点の候補と判断を分離できる', () => {
    const fixture = fixtureFor({ book: '電気設備', category: '配線器具' })
    const second = { ...fixture, id: `${fixture.id}-second`, order: 1 }
    const input = {
      index,
      fixtures: [fixture, second],
      originIds: [fixture.id, second.id],
      projectMode: '新築' as const,
      works: {},
      decisions: {},
      resolveTarget,
    }
    const initial = suggestRelated(input)
    const item = initial.find(suggestion => suggestion.kind === 'item')!
    expect(item.originFixtureIds).toEqual([fixture.id])
    expect(item.key.endsWith(`@${fixture.id}`)).toBe(true)
    const secondKey = `${item.key.slice(0, -fixture.id.length)}${second.id}`
    const secondItem = initial.find(suggestion => suggestion.key === secondKey)
    expect(secondItem?.originFixtureIds).toEqual([second.id])
    expect(secondItem?.ruleIds).toEqual(item.ruleIds)
    const decided = suggestRelated({
      ...input,
      decisions: { [item.key]: '不要' },
    })
    expect(decided.find(suggestion => suggestion.key === item.key)?.decision).toBe('不要')
    expect(decided.find(suggestion => suggestion.key === secondKey)?.decision)
      .toBeUndefined()
    expect(decided.filter(suggestion => suggestion.decision === undefined))
      .toHaveLength(initial.length - 1)
    expect(decided[decided.length - 1].key).toBe(item.key)
  })

  it('全ルール（Excel 由来 642 ＋ 部位の組 274）の全提案先を実マスタで解決できる', async () => {
    expect(RELATED_RULES).toHaveLength(916)
    expect(RELATED_RULES.filter(rule => rule.id.startsWith('A-'))).toHaveLength(274)
    const model = await loadRelated()
    const unresolved = RELATED_RULES.flatMap(rule => rule.targets
      .filter(target => model.resolveTarget(target, rule.book).length === 0)
      .map(target => ({ id: rule.id, book: rule.book, ...target })))
    expect(unresolved).toEqual([])
    expect(await loadRelated()).toBe(model)
  })

  it('解決できない提案先を明示する', () => {
    const fixture = fixtureFor({ book: '電気設備', category: '配線器具' })
    const suggestions = suggestRelated({
      index,
      fixtures: [fixture],
      originIds: [fixture.id],
      projectMode: '新築',
      works: {},
      decisions: {},
      resolveTarget: () => [],
    })
    expect(suggestions.filter(item => item.targets.length > 0)
      .every(item => item.flags.unresolved)).toBe(true)
  })
})

describe('R5a の種類・新規項目・選択済み', () => {
  const origin: CountFixture = {
    id: 'r5-origin', name: '起点', code: '', category: '試験分類', order: 0,
    style: {
      shape: 'circle', fill: 'none', color: [1, 0, 0],
      size: 10, opacity: 1, showCode: true,
    },
  }
  const rule = (id: string, patch: Partial<RelatedRule> = {}): RelatedRule => ({
    id, book: '建築', group: '試験', originText: '起点', targetText: id,
    modes: ['新築', '改修'], question: '確認', kindText: '試験',
    kind: 'check', priority: '中', origin: { any: [{ categories: ['試験分類'] }] },
    targets: [], note: '', refs: [],
    create: { name: '作成する項目', unit: '式' },
    ...patch,
  })
  const run = (
    rules: RelatedRule[],
    fixtures: readonly CountFixture[] = [origin],
    projectMode: ProjectMode = '新築',
  ) => suggestRelated({
    index: buildRelatedIndex(rules), fixtures, originIds: [origin.id],
    projectMode, works: {}, decisions: {}, resolveTarget: () => [],
  })

  it('note は note: キーになり、登録判定やマスタ解決を行わない', () => {
    const note = rule('N-001', {
      kind: 'note', create: undefined,
      targets: [{ category: '試験分類', name: '起点' }],
    })
    let resolutions = 0
    const [result] = suggestRelated({
      index: buildRelatedIndex([note]), fixtures: [origin], originIds: [origin.id],
      works: {}, decisions: {},
      resolveTarget: () => { resolutions++; return [] },
    })
    expect(result).toMatchObject({
      key: 'note:N-001@r5-origin', kind: 'note', targets: [], registeredCount: 0,
    })
    expect(result.flags.registered).toBeUndefined()
    expect(result.flags.unresolved).toBeUndefined()
    expect(result.create).toBeUndefined()
    expect(resolutions).toBe(0)
  })

  it('check は create を写し、分類を問わず完全一致の名称を数える', () => {
    const check = rule('C-001')
    const registered = { ...origin, id: 'registered', category: '別分類', name: '作成する項目' }
    const second = { ...registered, id: 'registered2' }
    const similar = { ...registered, id: 'similar', name: '作成する項目A' }
    const [result] = run([check], [origin, registered, second, similar])
    expect(result.key).toBe('check:C-001@r5-origin')
    expect(result.create).toEqual(check.create)
    expect(result.create).not.toBe(check.create)
    expect(result.registeredCount).toBe(2)
    expect(result.flags.registered).toBe(true)
    expect(result.flags.unresolved).toBeUndefined()
  })

  it('同じ優先度・判断状態では item、check、note、hint の順にする', () => {
    const results = run([
      rule('A-note', { kind: 'note', create: undefined }),
      rule('B-check'),
      rule('Z-item', {
        kind: 'item', create: undefined,
        targets: [{ category: '提案先', name: '提案品目' }],
      }),
    ], [origin], '改修')
    expect(results.map(result => result.kind)).toEqual(['item', 'check', 'note', 'hint'])
  })

  it('案件の確認事項でもルールの kind、キー、create、選択済みを保持する', () => {
    const check = rule('C-context', { origin: { context: ['改修'] } })
    const note = rule('N-context', {
      kind: 'note', create: undefined, origin: { context: ['改修'] },
    })
    const registered = { ...origin, id: 'registered', name: '作成する項目' }
    const results = contextChecks({
      index: buildRelatedIndex([note, check]), projectMode: '改修',
      decisions: {}, fixtures: [origin, registered],
    })
    expect(results[0]).toMatchObject({
      key: 'check:C-context', kind: 'check',
      create: check.create, registeredCount: 1, flags: { registered: true },
    })
    expect(results[1]).toMatchObject({
      key: 'note:N-context', kind: 'note', registeredCount: 0,
    })
    expect(results[1].flags.registered).toBeUndefined()
  })
})

describe('R7a の起点ごとの候補', () => {
  const first: CountFixture = {
    id: 'cable-a', name: 'ケーブル A', code: 'A', category: 'ケーブル', order: 0,
    style: {
      shape: 'circle', fill: 'none', color: [1, 0, 0],
      size: 10, opacity: 1, showCode: true,
    },
  }
  const second: CountFixture = {
    ...first, id: 'cable-b', name: 'ケーブル B', code: 'B', order: 1,
  }
  const rule = (id: string, patch: Partial<RelatedRule> = {}): RelatedRule => ({
    id, book: '電気設備', group: '試験', originText: 'ケーブル',
    targetText: '保護管', modes: ['新築'], question: '確認',
    kindText: '拾い候補', kind: 'item', priority: '中',
    origin: { any: [{ categories: ['ケーブル'] }] },
    targets: [{ category: '保護管' }], note: '', refs: [],
    ...patch,
  })
  const rules = [
    rule('R7-I1'),
    rule('R7-I2', { priority: '高', refs: ['REF-2'] }),
    rule('R7-C1', { kind: 'check', targets: [], targetText: '確認事項' }),
    rule('R7-N1', { kind: 'note', targets: [], targetText: '注意' }),
  ]
  const run = (decisions: Readonly<Record<string, RelatedDecision>> = {}) =>
    suggestRelated({
      index: buildRelatedIndex(rules),
      fixtures: freezeDeep([first, second]),
      originIds: [first.id, second.id, first.id],
      projectMode: '新築',
      works: {},
      decisions,
      resolveTarget: () => [],
    })

  it('ケーブル A・B の同じ提案先を別の鍵にし、A の判断を B に付けない', () => {
    const initial = run()
    const items = initial.filter(item => item.kind === 'item')
    expect(items).toHaveLength(2)
    const baseKey = 'item:["電気設備",[["保護管",""]],""]'
    expect(items.map(item => item.key)).toEqual([
      `${baseKey}@cable-a`, `${baseKey}@cable-b`,
    ])
    expect(items.map(item => item.originFixtureIds)).toEqual([
      ['cable-a'], ['cable-b'],
    ])

    const decided = run({ [`${baseKey}@cable-a`]: '必要' })
    expect(decided.find(item => item.key === `${baseKey}@cable-a`)?.decision)
      .toBe('必要')
    expect(decided.find(item => item.key === `${baseKey}@cable-b`)?.decision)
      .toBeUndefined()
  })

  it('同じ起点の同じ提案先に当たるルールだけを集約する', () => {
    const items = run().filter(item => item.kind === 'item')
    expect(items).toHaveLength(2)
    for (const item of items) {
      expect(item.ruleIds).toEqual(['R7-I1', 'R7-I2'])
      expect(item.originFixtureIds).toHaveLength(1)
      expect(item.targetTexts).toEqual(['保護管'])
      expect(item.priority).toBe('高')
      expect(item.refs).toEqual(['REF-2'])
    }
  })

  it('確認事項と注意も起点別にし、提案先の解決は起点間で再利用する', () => {
    let resolutions = 0
    const results = suggestRelated({
      index: buildRelatedIndex(rules),
      fixtures: [first, second],
      originIds: [first.id, second.id],
      projectMode: '新築',
      works: {},
      decisions: { 'check:R7-C1@cable-a': '不要' },
      resolveTarget: () => {
        resolutions++
        return []
      },
    })
    expect(results.filter(item => item.kind === 'check')
      .map(item => item.key).sort()).toEqual([
      'check:R7-C1@cable-a', 'check:R7-C1@cable-b',
    ])
    expect(results.filter(item => item.kind === 'note')
      .map(item => item.key).sort()).toEqual([
      'note:R7-N1@cable-a', 'note:R7-N1@cable-b',
    ])
    expect(results.find(item => item.key === 'check:R7-C1@cable-b')?.decision)
      .toBeUndefined()
    expect(results.every(item => item.originFixtureIds.length === 1)).toBe(true)
    expect(resolutions).toBe(1)
  })
})

describe('文書ごとのメモリ', () => {
  it('文書間で起点・閉じた状態が混ざらない（判断等は SPEC-R2 で文書のストアに保存）', () => {
    const firstSession = {}, secondSession = {}
    const first = relatedSessionMemory(firstSession)
    const second = relatedSessionMemory(secondSession)
    first.update({ originIds: ['fixture'], closed: true })
    expect(relatedSessionMemory(firstSession)).toBe(first)
    expect(second.getSnapshot()).toEqual({ originIds: [], closed: false })
    expect(first.getSnapshot()).toEqual({ originIds: ['fixture'], closed: true })
  })
})
