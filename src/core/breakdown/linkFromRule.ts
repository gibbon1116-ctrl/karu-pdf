import type { BreakdownBook } from '../countFixtures'
import type { FixtureLink } from '../fixtureLink'
import {
  carryAutoFor,
  linkRuleAuto,
  linkRuleForDetail,
  type LinkRule,
} from './linkRules'

export function defaultRcLink(
  name: string,
  rule: LinkRule | undefined = linkRuleForDetail(name),
): NonNullable<FixtureLink['rc']> {
  const output = rule?.rc?.output
    ?? (name.includes('鉄筋') ? 'rebar'
      : name.includes('型枠') ? 'formwork'
        : name.includes('圧接') ? 'gasJoint'
          : name.includes('重ね継手') ? 'lapJoint' : 'concrete')

  return {
    ...structuredClone(rule?.rc ?? {}),
    output,
    ...(output === 'rebar' ? {
      basis: /加工組立|運搬/u.test(name)
        ? 'design' : rule?.rc?.basis ?? 'required',
    } : {}),
  }
}

function carryFromSummary(
  summary: readonly { label: string; value: string }[],
): NonNullable<FixtureLink['carry']> {
  const value = summary.find(field => field.label.trim() === '区分')
    ?.value.trim()

  if (value === '重量品') return { class: 'heavy' }
  if (value === '容積品') return { class: 'bulky' }
  return {}
}

export function linkFromRule(
  rule: LinkRule,
  name: string,
  summary: readonly { label: string; value: string }[],
  book?: BreakdownBook,
): FixtureLink {
  const kind = rule.waste ? 'mass' : rule.kind
  const baseAuto = linkRuleAuto(rule)
  const auto = kind === 'carry' && baseAuto !== undefined
    ? carryAutoFor(book, baseAuto)
    : baseAuto

  return {
    kind,
    sources: [],
    ...(auto !== undefined ? { auto } : {}),
    ...(kind === 'factor' && rule.factor !== undefined
      ? { factor: rule.factor } : {}),
    ...(kind === 'rc' ? { rc: defaultRcLink(name, rule) } : {}),
    ...(kind === 'shape' ? {
      shape: {
        output: 'area' as const,
        ...structuredClone(rule.shape ?? {}),
      },
    } : {}),
    ...(kind === 'crossing' ? {
      crossing: structuredClone(rule.crossing ?? {}),
    } : {}),
    ...(kind === 'steel' ? {
      steel: {
        output: 'mass' as const,
        ...structuredClone(rule.steel ?? {}),
      },
    } : {}),
    ...(kind === 'carry' ? { carry: carryFromSummary(summary) } : {}),
  }
}
