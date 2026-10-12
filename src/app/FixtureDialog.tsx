import { useContext, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { fixtureCode, quantityAggregation, COUNT_COLORS, COUNT_FILLS, COUNT_SHAPES, COUNT_SIZES, COUNT_OPACITIES, COUNT_UNITS, BREAKDOWN_BOOKS, summaryText, countHex, countRgb, nextCountStyle, nextQuantityLineStyle, sameFixtureAppearance, quantityKind, quantityMethod, QUANTITY_METHODS, quantityLine, QUANTITY_LINE_WIDTHS, QUANTITY_DASHES, type BreakdownBook, type CountUnit, type QuantityKind, type QuantityLineAppearance, type QuantityLineStyle, serializeCountFixtures, fixtureConditionsError, setFixtureConditionRenames, type CountFixture, type CountStyle } from '../core/countFixtures'
import { CONVERT_UNITS, fixtureConvertError, fixtureBreakdownError, fixtureLabelCode, quantityUnit, quantityDecimals, QUANTITY_UNITS, type ConvertUnit, type FixtureAttributes } from '../core/countFixtures'
import { computeLinks, fixtureLinkError, fixtureLinkRoundsUp, fixtureLinkSourceUnit, fixtureLinkSourceShowsFactor, fixtureLinkBasisNumber, type FixtureLink, type FixtureLinkSource, type LinkBasisSource, type LinkResult } from '../core/fixtureLink'
import { WASTE_DENSITIES } from '../core/breakdown/linkData'
import { steelMemberError, type SteelMember } from '../core/steelMember'
import { H_SECTIONS, STEEL_REQUIRED_FACTOR } from '../core/breakdown/steelData'
import { fixtureLinkSources } from '../core/fixtureLink'
import { rcMemberError, type RcMember, type RcMemberKind, type RcBar, type RcResult } from '../core/rcMember'
import { REBAR_MASS_KG_PER_M, REBAR_REQUIRED_FACTOR, DEFAULT_ANCHORAGE_D, DEFAULT_LAP_D, ANCHORAGE_LAP_VERIFIED } from '../core/breakdown/rcData'
import { LINK_RULES, linkRuleAuto, linkRuleForDetail, type LinkAutoSources, type LinkRule } from '../core/breakdown/linkRules'
import { normalizeRouteConditions, type PartCondition, quantityDimensions, quantityLabel, QUANTITY_DIMENSIONS, type QuantityMark } from '../core/quantity'
import { FixtureSampleContext } from '../editor/AnnotationLayer'
import { CountMarker, QuantitySwatch } from '../editor/countMarkers'
import { groupFixtures } from './fixtureOrder'
import { setFixtureDimensionUpdate } from '../core/countFixtures'

// Shared across add/duplicate/edit mounts, and reset when the app reloads.
let fixtureDialogPosition = { x: 0, y: 0 }

const numericAttributeKeys = [
  'massKg', 'unitMassKg', 'widthMm', 'depthMm', 'heightMm', 'outerDiameterMm',
] as const

function linkNumber(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toFixed(6))) : '—'
}

const RC_KINDS: readonly RcMemberKind[] = [
  'slab', 'foundationSlab', 'wall', 'beam', 'foundationBeam', 'column', 'footing',
]
const RC_KIND_LABELS: Record<RcMemberKind, string> = {
  slab: '床板', foundationSlab: '基礎スラブ', wall: '壁',
  beam: '梁', foundationBeam: '基礎梁', column: '柱', footing: '独立基礎',
}
const RC_ROLES: Record<RcMemberKind, readonly RcBar['role'][]> = {
  slab: ['x', 'y'], foundationSlab: ['x', 'y'],
  wall: ['vertical', 'horizontal'],
  beam: ['top', 'bottom', 'stirrup'], foundationBeam: ['top', 'bottom', 'stirrup'],
  column: ['main', 'hoop'], footing: ['base'],
}
const RC_ROLE_LABELS: Record<RcBar['role'], string> = {
  x: 'x 方向', y: 'y 方向', vertical: '縦筋', horizontal: '横筋',
  top: '上端筋', bottom: '下端筋', stirrup: 'スタラップ',
  main: '主筋', hoop: 'フープ', base: 'ベース筋',
}
const REBAR_SIZES = Object.keys(REBAR_MASS_KG_PER_M)
type RcDimension = 'thicknessMm' | 'widthMm' | 'depthMm' | 'heightMm' | 'slabDeductMm'

function rcKindsFor(fixture: CountFixture): readonly RcMemberKind[] {
  switch (quantityMethod(fixture)) {
    case 'polygon': return ['slab', 'foundationSlab']
    case 'polygonDepth': return RC_KINDS
    case 'lengthHeight': return ['wall']
    case 'polyline': return ['beam', 'foundationBeam', 'column', 'wall']
    case 'click': return ['column', 'footing']
    default: return []
  }
}

function defaultRcKind(
  fixture: CountFixture,
  position: { item?: string; middle?: string } | undefined = fixture.breakdown,
): RcMemberKind | undefined {
  const allowed = rcKindsFor(fixture)
  const text = [fixture.name, position?.item, position?.middle].filter(Boolean).join(' ')
  if (quantityMethod(fixture) === 'polyline') {
    if (text.includes('柱')) return 'column'
    if (text.includes('壁')) return 'wall'
    if (text.includes('基礎')) return 'foundationBeam'
    return 'beam'
  }
  const preferred: RcMemberKind[] = []
  if (text.includes('基礎')) preferred.push('foundationSlab', 'foundationBeam', 'footing')
  if (text.includes('柱')) preferred.push('column')
  if (text.includes('梁')) preferred.push('beam')
  if (text.includes('壁')) preferred.push('wall')
  if (/床|スラブ|土間/u.test(text)) preferred.push('slab')
  return preferred.find(kind => allowed.includes(kind)) ?? allowed[0]
}

function isConcreteFixture(
  fixture: CountFixture,
  subject = fixture.breakdown?.subject,
): boolean {
  return !fixture.link && (fixture.category === 'コンクリート'
    || subject === 'コンクリート' || fixture.name.includes('コンクリート'))
}

function rcDimensions(
  kind: RcMemberKind,
  fromShape = false,
  fromLine = false,
): Array<{ key: RcDimension; label: string }> {
  if (fromShape && (kind === 'column' || kind === 'footing')) {
    return [{ key: 'heightMm', label: '高さ（mm）' }]
  }
  if ((fromShape || fromLine) && kind === 'wall') {
    return [
      { key: 'thicknessMm', label: '厚さ（mm）' },
      { key: 'heightMm', label: '高さ（mm）' },
    ]
  }
  if (kind === 'slab' || kind === 'foundationSlab' || kind === 'wall') {
    return [{ key: 'thicknessMm', label: '厚さ（mm）' }]
  }
  if (kind === 'footing') {
    return [
      { key: 'widthMm', label: '幅（mm）' },
      { key: 'depthMm', label: '長さ（mm）' },
      { key: 'heightMm', label: '高さ（mm）' },
    ]
  }
  return [
    { key: 'widthMm', label: '幅 b（mm）' },
    { key: 'depthMm', label: 'せい D（mm）' },
    ...(kind === 'column'
      ? fromLine ? [] : [{ key: 'heightMm' as const, label: '高さ（mm）' }]
      : [{ key: 'slabDeductMm' as const, label: '控除する床板の厚さ（mm）' }]),
  ]
}

function rcBarCounted(role: RcBar['role']): boolean {
  return role === 'top' || role === 'bottom' || role === 'main'
}

function rcBarDoubleAllowed(role: RcBar['role']): boolean {
  return role !== 'stirrup' && role !== 'hoop' && role !== 'base'
}

function changeRcKind(
  member: RcMember,
  kind: RcMemberKind,
  fromShape = false,
  fromLine = false,
): RcMember {
  const next: RcMember = {
    kind,
    bars: member.bars.filter(bar => RC_ROLES[kind].includes(bar.role)),
    ...(member.anchorageD !== undefined ? { anchorageD: member.anchorageD } : {}),
    ...(member.lapD !== undefined ? { lapD: member.lapD } : {}),
    ...(member.joint !== undefined ? { joint: member.joint } : {}),
  }
  for (const { key } of rcDimensions(kind, fromShape, fromLine)) {
    if (member[key] !== undefined) next[key] = member[key]
  }
  return next
}

function RcMemberFields({
  member, allowedKinds, usePickupDepth = false, usePickupLine = false, onChange,
}: {
  member: RcMember
  allowedKinds: readonly RcMemberKind[]
  usePickupDepth?: boolean
  usePickupLine?: boolean
  onChange(member: RcMember): void
}) {
  const pickupReading: Record<RcMemberKind, string> = {
    slab: '空なら拾いの深さを厚さにします',
    foundationSlab: '空なら拾いの深さを厚さにします',
    wall: '厚さが空なら平面の短い辺、長さは 面積 ÷ 厚さ、高さが空なら拾いの深さ',
    beam: '幅が空なら平面の短い辺、長さは 面積 ÷ 幅、せいが空なら拾いの深さ。床板控除が空なら0',
    foundationBeam: '幅が空なら平面の短い辺、長さは 面積 ÷ 幅、せいが空なら拾いの深さ。床板控除が空なら0',
    column: '断面積・外周は拾いの平面の形、高さが空なら拾いの深さ',
    footing: '面積・外周は拾いの平面の形、高さが空なら拾いの深さ。ベース筋はx・y両方向',
  }
  const numberInput = (
    key: RcDimension | 'anchorageD' | 'lapD',
    label: string,
    placeholder?: string,
  ) => <label>{label}
    <input type="number" step="any" aria-label={label} placeholder={placeholder}
      value={Number.isFinite(member[key]) ? member[key] : ''}
      onChange={event => {
        const text = event.currentTarget.value
        const next = { ...member }
        if (text.trim() === '') delete next[key]
        else next[key] = Number(text)
        onChange(next)
      }} />
  </label>
  const updateBar = (index: number, change: (bar: RcBar) => RcBar) => {
    onChange({
      ...member,
      bars: member.bars.map((bar, i) => i === index ? change(bar) : bar),
    })
  }
  return <>
    <label>部材の種類<select aria-label="部材の種類" value={member.kind}
      onChange={event => {
        const kind = RC_KINDS.find(entry => entry === event.currentTarget.value)
        if (kind && allowedKinds.includes(kind)) {
          onChange(changeRcKind(member, kind, usePickupDepth, usePickupLine))
        }
      }}>
      {RC_KINDS.map(kind => <option key={kind} value={kind}
        disabled={!allowedKinds.includes(kind)}>{RC_KIND_LABELS[kind]}</option>)}
    </select></label>
    <div className="fixture-rc-dimensions">
      {rcDimensions(member.kind, usePickupDepth, usePickupLine).map(({ key, label }) =>
        <div key={key}>
          {numberInput(key, label, usePickupDepth ? '空なら拾いの形から' : undefined)}
        </div>)}
    </div>
    {usePickupDepth && <p><small>{pickupReading[member.kind]}</small></p>}
    {usePickupLine && member.kind === 'column' &&
      <p><small>拾った線の長さを柱の高さにします。幅・せいは断面の寸法です。</small></p>}
    {usePickupLine && member.kind === 'wall' &&
      <p><small>拾った線を壁の長さにします。厚さと高さを入れてください。</small></p>}
    <fieldset><legend>鉄筋</legend>
      <div className="fixture-rc-table-scroll">
        <table className="fixture-rc-bars">
          <thead><tr>
            <th scope="col">役割</th><th scope="col">径</th>
            <th scope="col">間隔・本数</th><th scope="col">段</th><th scope="col">削除</th>
          </tr></thead>
          <tbody>{member.bars.map((bar, i) => {
            const prefix = `鉄筋${i + 1}`
            const counted = rcBarCounted(bar.role)
            return <tr key={i}>
              <td><select aria-label={`${prefix}の役割`} value={bar.role}
                onChange={event => {
                  const role = RC_ROLES[member.kind].find(entry => entry === event.currentTarget.value)
                  if (!role) return
                  updateBar(i, previous => {
                    const next: RcBar = { role, size: previous.size }
                    if (rcBarCounted(role)) next.count = previous.count ?? 1
                    else next.spacingMm = previous.spacingMm ?? 200
                    if (previous.layers !== undefined) {
                      next.layers = rcBarDoubleAllowed(role) ? previous.layers : 1
                    }
                    return next
                  })
                }}>
                {RC_ROLES[member.kind].map(role =>
                  <option key={role} value={role}>{RC_ROLE_LABELS[role]}</option>)}
              </select></td>
              <td><select aria-label={`${prefix}の径`} value={bar.size}
                onChange={event => {
                  const size = event.currentTarget.value
                  updateBar(i, previous => ({ ...previous, size }))
                }}>
                {REBAR_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
              </select></td>
              <td><input type="number" min={counted ? 1 : undefined}
                step={counted ? 1 : 'any'}
                aria-label={`${prefix}の${counted ? '本数' : '間隔（mm）'}`}
                value={counted
                  ? Number.isFinite(bar.count) ? bar.count : ''
                  : Number.isFinite(bar.spacingMm) ? bar.spacingMm : ''}
                onChange={event => {
                  const text = event.currentTarget.value
                  const number = text.trim() === '' ? NaN : Number(text)
                  updateBar(i, previous => counted
                    ? { ...previous, count: number }
                    : { ...previous, spacingMm: number })
                }} />
                <span>{counted ? '本' : 'mm'}</span>
              </td>
              <td>{bar.role !== 'main' && <select aria-label={`${prefix}の段`}
                value={bar.layers ?? 1}
                onChange={event => {
                  const layers = event.currentTarget.value === '2' ? 2 : 1
                  updateBar(i, previous => ({ ...previous, layers }))
                }}>
                <option value="1">シングル</option>
                <option value="2" disabled={!rcBarDoubleAllowed(bar.role)}>ダブル</option>
              </select>}</td>
              <td><button type="button" aria-label={`${prefix}を外す`}
                onClick={() => onChange({
                  ...member, bars: member.bars.filter((_, index) => index !== i),
                })}>×</button></td>
            </tr>
          })}</tbody>
        </table>
      </div>
      <button type="button" disabled={member.bars.length >= 20} onClick={() => {
        if (member.bars.length >= 20) return
        const candidates = RC_ROLES[member.kind]
        const role = candidates[member.bars.length % candidates.length]
        const bar: RcBar = {
          role, size: 'D13',
          ...(rcBarCounted(role) ? { count: 1 } : { spacingMm: 200 }),
          layers: 1,
        }
        onChange({ ...member, bars: [...member.bars, bar] })
      }}>＋ 鉄筋を足す</button>
      {member.bars.length >= 20 && <p>鉄筋の設定は20件までです。</p>}
      {member.bars.some(bar => !rcBarDoubleAllowed(bar.role)) &&
        <p>スタラップ・フープ・ベース筋はシングルで計算します。</p>}
    </fieldset>
    <div className="fixture-rc-dimensions">
      {numberInput('anchorageD', '定着（d の倍数）', String(DEFAULT_ANCHORAGE_D))}
      {numberInput('lapD', '重ね継手（d の倍数）', String(DEFAULT_LAP_D))}
    </div>
    <p>既定値 {DEFAULT_ANCHORAGE_D}d・{DEFAULT_LAP_D}d{!ANCHORAGE_LAP_VERIFIED && '（要確認）'}</p>
    <label>継手<select aria-label="継手" value={member.joint ?? ''}
      onChange={event => {
        const joint = event.currentTarget.value
        const next = { ...member }
        if (joint === 'lap' || joint === 'gas') next.joint = joint
        else delete next.joint
        onChange(next)
      }}>
      <option value="">自動（径 16 以上はガス圧接）</option>
      <option value="lap">すべて重ね継手</option>
      <option value="gas">すべてガス圧接</option>
    </select></label>
  </>
}

function RcMemberPreview({ result, error }: { result?: RcResult; error?: string }) {
  const bars = new Map<string, { lengthM: number; massKg: number }>()
  for (const bar of result?.bars ?? []) {
    const total = bars.get(bar.size) ?? { lengthM: 0, massKg: 0 }
    total.lengthM += bar.lengthM
    total.massKg += bar.massKg
    bars.set(bar.size, total)
  }
  return <section className="fixture-rc-preview" aria-label="RC 部材の見本">
    <h3>今の拾いで計算した見本</h3>
    {error ? <p role="alert">{error}</p> : result ? <>
      <p>コンクリート {result.concreteM3.toFixed(2)} ㎥</p>
      <p>型枠 {result.formworkM2.toFixed(2)} ㎡</p>
      {result.shapeDimensionText && <p>{result.shapeDimensionText}</p>}
      {bars.size > 0 && <table>
        <thead><tr><th scope="col">径</th><th scope="col">長さ（m）</th><th scope="col">質量（t）</th></tr></thead>
        <tbody>{REBAR_SIZES.filter(size => bars.has(size)).map(size => {
          const bar = bars.get(size)!
          return <tr key={size}><th scope="row">{size}</th>
            <td>{bar.lengthM.toFixed(2)}</td><td>{(bar.massKg / 1000).toFixed(3)}</td>
          </tr>
        })}</tbody>
      </table>}
      <p>ガス圧接 {linkNumber(result.gasJoints.reduce((sum, joint) => sum + joint.count, 0))} か所</p>
      {result.gasJoints.length > 0 && <ul>{result.gasJoints.map(joint =>
        <li key={joint.size}>{joint.size}: {linkNumber(joint.count)} か所</li>)}</ul>}
      <p>重ね継手 {linkNumber(result.lapJoints)} か所</p>
    </> : <p>拾うと計算します</p>}
  </section>
}

type SteelPreview = {
  lengthM: number
  massT: number
  requiredT: number
  contourM2: number
  boxM2: number
}

function SteelMemberFields({ member, custom, counted, onCustomChange, onChange }: {
  member: SteelMember
  custom: boolean
  counted: boolean
  onCustomChange(custom: boolean): void
  onChange(member: SteelMember): void
}) {
  const numberInput = (
    key: 'customMassKgPerM' | 'customSurfaceM2PerM' | 'lengthMm',
    label: string,
  ) => <label>{label}
    <input type="number" step="any" aria-label={label}
      value={Number.isFinite(member[key]) ? member[key] : ''}
      onChange={event => {
        const text = event.currentTarget.value
        const next = { ...member }
        if (text.trim() === '') delete next[key]
        else next[key] = Number(text)
        onChange(next)
      }} />
  </label>

  return <>
    <label>断面<select aria-label="断面" value={custom ? '' : member.section}
      onChange={event => {
        const section = event.currentTarget.value
        onCustomChange(section === '')
        onChange({
          section,
          ...(member.lengthMm !== undefined ? { lengthMm: member.lengthMm } : {}),
        })
      }}>
      {[...new Set(H_SECTIONS.map(section => section.series))].map(series =>
        <optgroup key={series} label={series}>
          {H_SECTIONS.filter(section => section.series === series).map(section =>
            <option key={section.name} value={section.name}>{section.name}</option>)}
        </optgroup>)}
      <option value="">自由な断面（単位質量を入れる）</option>
    </select></label>
    {custom && <>
      <label>断面の名前<input aria-label="断面の名前" maxLength={80}
        placeholder="□-200×200×9" value={member.section}
        onChange={event => onChange({ ...member, section: event.currentTarget.value })} />
      </label>
      <div className="fixture-steel-dimensions">
        {numberInput('customMassKgPerM', '単位質量（kg/m）')}
        {numberInput('customSurfaceM2PerM', '表面積（㎡/m）')}
      </div>
      <p>自由な断面は単位質量と表面積を入れてください。</p>
    </>}
    {counted && numberInput('lengthMm', '部材の長さ（mm）')}
  </>
}

function SteelMemberPreview({ result, error }: {
  result?: SteelPreview
  error?: string
}) {
  return <section className="fixture-steel-preview" aria-label="鉄骨の部材の見本">
    <h3>今の拾いで計算した見本</h3>
    {error ? <p role="alert">{error}</p> : result ? <>
      <p>長さ {result.lengthM.toFixed(2)} m</p>
      <p>質量 {result.massT.toFixed(3)} t（所要 {result.requiredT.toFixed(3)} t）</p>
      <p>表面積 {result.contourM2.toFixed(2)} ㎡（箱 {result.boxM2.toFixed(2)} ㎡）</p>
    </> : <p>拾うと計算します</p>}
  </section>
}

function autoKey(auto: LinkAutoSources): string {
  return JSON.stringify([
    auto.categories === undefined ? null : [...auto.categories].sort(),
    auto.nameIncludes === undefined ? null : [...auto.nameIncludes].sort(),
    auto.condition ?? null,
    auto.kinds === undefined ? null : [...auto.kinds].sort(),
    auto.minMassKg ?? null,
    auto.rcKinds === undefined ? null : [...auto.rcKinds].sort(),
  ])
}

function matchesLinkRule(link: FixtureLink | undefined, rule: LinkRule): boolean {
  return !!link?.auto && link.kind === rule.kind && autoKey(link.auto) === autoKey(rule.auto)
}

function initialLinkRule(link: FixtureLink | undefined, name: string): LinkRule | undefined {
  const candidates = LINK_RULES.filter(rule => matchesLinkRule(link, rule))
  return candidates.find(rule => rule.details.includes(name)) ?? candidates[0]
}

function defaultRcLink(
  name: string,
  rule = linkRuleForDetail(name),
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

function linkFromRule(
  rule: LinkRule,
  name: string,
  summary: readonly { label: string; value: string }[],
): FixtureLink {
  const kind = rule.waste ? 'mass' : rule.kind
  return {
    kind,
    sources: [],
    ...(linkRuleAuto(rule) !== undefined ? { auto: linkRuleAuto(rule) } : {}),
    ...(kind === 'factor' && rule.factor !== undefined ? { factor: rule.factor } : {}),
    ...(kind === 'rc' ? { rc: defaultRcLink(name, rule) } : {}),
    ...(kind === 'shape' ? {
      shape: { output: 'area' as const, ...structuredClone(rule.shape ?? {}) },
    } : {}),
    ...(kind === 'crossing' ? {
      crossing: structuredClone(rule.crossing ?? {}),
    } : {}),
    ...(kind === 'steel' ? {
      steel: { output: 'mass' as const, ...structuredClone(rule.steel ?? {}) },
    } : {}),
    ...(kind === 'carry' ? {
      carry: {
        class: summary.some(field =>
          field.label.trim() === '区分' && field.value.trim() === '容積品')
          ? 'bulky' as const : 'heavy' as const,
      },
    } : {}),
  }
}

function autoDescription(auto: LinkAutoSources): string {
  const parts: string[] = []
  if (auto.categories !== undefined) {
    parts.push(`分類${auto.categories.map(category => `「${category}」`).join('・')}`)
  }
  if (auto.nameIncludes !== undefined) {
    parts.push(`名称に${auto.nameIncludes.map(word => `「${word}」`).join('・')}を含む項目`)
  }
  if (auto.kinds !== undefined) {
    const labels = { count: '個数', length: '長さ', area: '面積', volume: '体積' } as const
    parts.push(`${auto.kinds.map(kind => labels[kind]).join('・')}の項目`)
  }
  if (auto.condition !== undefined) {
    parts.push(`施工条件「${auto.condition}」の候補がある項目`)
  }
  if (auto.minMassKg !== undefined) parts.push(`${auto.minMassKg}kg 以上`)
  if (auto.rcKinds !== undefined) {
    const labels = auto.rcKinds.map(value => {
      const kind = RC_KINDS.find(entry => entry === value)
      return kind ? RC_KIND_LABELS[kind] : value
    })
    parts.push(labels.length ? `RC 部材「${labels.join('・')}」` : 'すべての RC 部材')
  }
  return parts.join('・') || '連動以外のすべての項目'
}

function carrySourceText(link: FixtureLink, source: LinkBasisSource | undefined): string {
  if (!source) return '区分・補正率は見本で確認してください'
  const carryClass = source.note === '重量品' || source.note === '容積品'
    ? source.note
    : source.factor !== undefined
      ? link.carry?.class === 'bulky' ? '容積品' : '重量品'
      : '区分未判定'
  return `${carryClass}・補正率 ${source.factor === undefined ? '適用なし' : linkNumber(source.factor)}`
}

function ConvertHelpers({ kind, apply }: {
  kind: QuantityKind
  apply(factor: number, basis: string): void
}) {
  const [dimensions, setDimensions] = useState({
    pipeDiameter: '', rectWidth: '', rectHeight: '',
    boxWidth: '', boxHeight: '', boxDepth: '',
    poleDiameter: '', poleHeight: '',
  })
  const [face, setFace] = useState<'背面を除く5面' | '6面' | '前面のみ'>('背面を除く5面')
  const [error, setError] = useState('')
  type Dimension = keyof typeof dimensions
  const input = (key: Dimension, label: string) => <label>{label}
    <input aria-label={label} inputMode="decimal" value={dimensions[key]} onChange={event => {
      const text = event.currentTarget.value
      setDimensions(previous => ({ ...previous, [key]: text }))
      setError('')
    }} />
  </label>
  const calculate = (keys: Dimension[], build: (values: number[]) => { factor: number; basis: string }) => {
    const values = keys.map(key => Number(dimensions[key].trim()))
    if (values.some(value => !Number.isFinite(value) || value <= 0)) {
      setError('寸法は0より大きい数で入力してください。')
      return
    }
    const convert = { ...build(values), unit: '㎡' as const }
    const message = fixtureConvertError({ convert })
    if (message) { setError(message); return }
    setError('')
    apply(convert.factor, convert.basis)
  }
  if (kind !== 'length' && kind !== 'count') return null
  return <div className="fixture-convert-helpers">
    {kind === 'length' ? <>
      <fieldset><legend>管の外径から</legend>
        {input('pipeDiameter', '管の外径（mm）')}
        <button type="button" onClick={() => calculate(['pipeDiameter'], ([d]) => ({
          factor: Math.PI * d / 1000,
          basis: `外径 ${d}mm × π`,
        }))}>係数にする</button>
      </fieldset>
      <fieldset><legend>角の周長から</legend>
        {input('rectWidth', '角の幅（mm）')}
        {input('rectHeight', '角の高さ（mm）')}
        <button type="button" onClick={() => calculate(['rectWidth', 'rectHeight'], ([w, h]) => ({
          factor: 2 * (w + h) / 1000,
          basis: `周長 2×(${w}+${h})mm`,
        }))}>係数にする</button>
      </fieldset>
    </> : <>
      <fieldset><legend>箱の寸法から</legend>
        {input('boxWidth', '箱の幅（mm）')}
        {input('boxHeight', '箱の高さ（mm）')}
        {input('boxDepth', '箱の奥行（mm）')}
        <label>面<select aria-label="箱の塗る面" value={face} onChange={event => setFace(event.currentTarget.value as typeof face)}>
          {(['背面を除く5面', '6面', '前面のみ'] as const).map(value => <option key={value} value={value}>{value}</option>)}
        </select></label>
        <button type="button" onClick={() => calculate(['boxWidth', 'boxHeight', 'boxDepth'], ([w, h, d]) => ({
          factor: (face === '前面のみ' ? w * h
            : face === '6面' ? 2 * (w * h + w * d + h * d)
              : w * h + 2 * w * d + 2 * h * d) / 1000000,
          basis: `${w}×${h}×${d} ${face}`,
        }))}>係数にする</button>
      </fieldset>
      <fieldset><legend>ポールから</legend>
        {input('poleDiameter', 'ポールの外径（mm）')}
        {input('poleHeight', 'ポールの地上高（m）')}
        <button type="button" onClick={() => calculate(['poleDiameter', 'poleHeight'], ([d, h]) => ({
          factor: Math.PI * d / 1000 * h,
          basis: `外径 ${d}mm × π × 地上高 ${h}m`,
        }))}>係数にする</button>
      </fieldset>
    </>}
    {error && <p role="alert">{error}</p>}
  </div>
}

export default function FixtureDialog({
  initial, fixtures, editing, duplicate = false, hasMarks = false, initialSection,
  previewLink, previewRc, previewSteel, previewCrossingBarrierCount,
  dimensionMarkCounts, onOpenFixture, onSave, onClose,
}: {
  initial: CountFixture
  fixtures: readonly CountFixture[]
  editing: boolean
  duplicate?: boolean
  hasMarks?: boolean
  initialSection?: 'rc'
  previewLink?(draft: CountFixture): LinkResult | undefined
  previewRc?(draft: CountFixture): RcResult | undefined
  previewSteel?(draft: CountFixture): SteelPreview | undefined
  previewCrossingBarrierCount?(draft: CountFixture): number
  dimensionMarkCounts?(draft: CountFixture): { matched: number; customized: number }
  onOpenFixture?(id: string, section: 'rc'): void
  onSave(fixture: CountFixture): void
  onClose(): void
}) {
  const dialog = useRef<HTMLDialogElement>(null), [value, setValue] = useState(initial), [error, setError] = useState('')
  const [conditionInput, setConditionInput] = useState(''), [conditionError, setConditionError] = useState('')
  const currentValue = useRef(value)
  currentValue.current = value
  const standardConditionsLoading = useRef(false)
  const [openingWidth, setOpeningWidth] = useState(initial.opening ? String(initial.opening.widthM) : '')
  const [openingHeight, setOpeningHeight] = useState(initial.opening ? String(initial.opening.heightM) : '')
  const [breakdownOpen, setBreakdownOpen] = useState(() => !!(initial.unit || initial.breakdown || initial.summary?.length || initial.remark))
  const [breakdownDraft, setBreakdownDraft] = useState<{ book: BreakdownBook | ''; section: string; subject: string; middle: string; item: string }>(() => ({
    book: initial.breakdown?.book ?? '', section: initial.breakdown?.section ?? '',
    subject: initial.breakdown?.subject ?? '', middle: initial.breakdown?.middle ?? '', item: initial.breakdown?.item ?? '',
  }))
  const [summaryDrafts, setSummaryDrafts] = useState(() => (initial.summary ?? []).map(field => ({ ...field })))
  const [convertOpen, setConvertOpen] = useState(() => !!initial.convert)
  const [convertDraft, setConvertDraft] = useState(() => ({
    enabled: !!initial.convert,
    factor: initial.convert ? String(initial.convert.factor) : '',
    unit: initial.convert?.unit ?? '㎡' as ConvertUnit,
    basis: initial.convert?.basis ?? '',
  }))
  const [rcOpen, setRcOpen] = useState(() =>
    initialSection === 'rc' || !!initial.rc || isConcreteFixture(initial))
  const rcSection = useRef<HTMLDetailsElement>(null)
  const rcCheckbox = useRef<HTMLInputElement>(null)
  const [steelOpen, setSteelOpen] = useState(() => !!initial.steel)
  const [customSteel, setCustomSteel] = useState(() =>
    !!initial.steel && !H_SECTIONS.some(section => section.name === initial.steel!.section))
  const [barrierNameInput, setBarrierNameInput] = useState(() =>
    (initial.link?.crossing?.barrierNameIncludes ?? []).join('、'))
  const [linkOpen, setLinkOpen] = useState(() => !!initial.link)
  const [linkSearch, setLinkSearch] = useState('')
  const [linkNotice, setLinkNotice] = useState('')
  const [linkRuleId, setLinkRuleId] = useState(() => initialLinkRule(initial.link, initial.name)?.id ?? '')
  const [attributesOpen, setAttributesOpen] = useState(() => !!initial.attributes)
  const [attributeDraft, setAttributeDraft] = useState(() => ({
    massKg: initial.attributes?.massKg === undefined ? '' : String(initial.attributes.massKg),
    unitMassKg: initial.attributes?.unitMassKg === undefined ? '' : String(initial.attributes.unitMassKg),
    widthMm: initial.attributes?.widthMm === undefined ? '' : String(initial.attributes.widthMm),
    depthMm: initial.attributes?.depthMm === undefined ? '' : String(initial.attributes.depthMm),
    heightMm: initial.attributes?.heightMm === undefined ? '' : String(initial.attributes.heightMm),
    outerDiameterMm: initial.attributes?.outerDiameterMm === undefined ? '' : String(initial.attributes.outerDiameterMm),
    wasteType: initial.attributes?.wasteType ?? '',
  }))
  const [applyDimensions, setApplyDimensions] = useState(true)
  const [backfillEnabled, setBackfillEnabled] = useState(() =>
    !!initial.backfill || editing && quantityMethod(initial) === 'lengthWidthDepth'
      && initial.name.includes('埋戻し'))
  const [backfillConditions, setBackfillConditions] = useState(() =>
    (initial.backfill?.conditionIncludes ?? ['埋設']).join('、'))
  const draftFixture = useMemo<CountFixture>(() => {
    const attributes: FixtureAttributes = {}
    for (const key of numericAttributeKeys) {
      const text = attributeDraft[key].trim()
      if (text !== '') attributes[key] = Number(text)
    }
    const wasteType = attributeDraft.wasteType.trim()
    if (wasteType) attributes.wasteType = wasteType
    return {
      ...value,
      attributes: Object.keys(attributes).length ? attributes : undefined,
      backfill: quantityMethod(value) === 'lengthWidthDepth' && backfillEnabled ? {
        deductPipes: true,
        conditionIncludes: backfillConditions.split(/[、，,]/u)
          .map(word => word.trim()).filter(Boolean),
      } : undefined,
    }
  }, [value, attributeDraft, backfillEnabled, backfillConditions])
  const dimensionCounts = editing
    ? dimensionMarkCounts?.(draftFixture) ?? { matched: 0, customized: 0 }
    : { matched: 0, customized: 0 }
  const linkPreview = useMemo(() => draftFixture.link
    ? previewLink?.(draftFixture)
      ?? computeLinks([...fixtures.filter(f => f.id !== draftFixture.id), draftFixture], () => []).get(draftFixture.id)
    : undefined, [draftFixture, previewLink, fixtures])
  const selectedLinkRule = LINK_RULES.find(rule => rule.id === linkRuleId && matchesLinkRule(value.link, rule))
    ?? initialLinkRule(value.link, value.name)
  const automaticSources = [...new Map(
    (linkPreview?.sources.filter(source => source.auto) ?? []).map(source => [source.itemId, source]),
  ).values()]
  const allowedRcKinds = rcKindsFor(value)
  const concreteFixture = isConcreteFixture(
    value, breakdownDraft.book === '' ? '' : breakdownDraft.subject,
  )
  const rcLinkMissing = value.link?.kind === 'rc'
    && fixtureLinkSources(fixtures, value).length === 0
  const rcCandidates = useMemo(() => fixtures
    .filter(f => f.id !== value.id && !f.link && rcKindsFor(f).length > 0)
    .sort((a, b) => Number(isConcreteFixture(b)) - Number(isConcreteFixture(a)))
    .slice(0, 8), [fixtures, value.id])
  const rcKindMismatches = useMemo(() => {
    const link = value.link
    const kinds = link?.kind === 'rc' ? link.auto?.rcKinds : undefined
    if (!link || !kinds?.length) return []
    // 手で選んだ元とは別に、自動の元に当たる項目を調べる。
    const autoSources = fixtureLinkSources(fixtures, {
      ...value, link: { ...link, sources: [] },
    })
    if (autoSources.length > 0) return []
    return fixtures.filter(f => f.id !== value.id && !f.link && f.rc
      && !kinds.includes(f.rc.kind))
  }, [fixtures, value])
  const rcPreview = useMemo<{ result?: RcResult; error?: string }>(() => {
    if (!draftFixture.rc || draftFixture.link) return {}
    const message = rcMemberError(draftFixture.rc, {
      fromShape: quantityMethod(draftFixture) === 'polygonDepth',
      fromLine: quantityMethod(draftFixture) === 'polyline',
    })
    if (message) return { error: message }
    if (!rcKindsFor(draftFixture).includes(draftFixture.rc.kind)) {
      return { error: 'RC部材の種類と拾い方が一致していません。' }
    }
    try {
      return { result: previewRc?.(draftFixture) }
    } catch (reason) {
      return { error: reason instanceof Error ? reason.message : String(reason) }
    }
  }, [draftFixture, previewRc])
  const steelAllowed = quantityMethod(value) === 'polyline' || quantityMethod(value) === 'click'
  const steelPreview = useMemo<{ result?: SteelPreview; error?: string }>(() => {
    if (!draftFixture.steel || draftFixture.link || draftFixture.rc) return {}
    const message = steelMemberError(draftFixture.steel)
    if (message) return { error: message }
    const method = quantityMethod(draftFixture)
    if (method !== 'polyline' && method !== 'click') {
      return { error: '鉄骨部材は線・個数の拾い方で設定してください。' }
    }
    if (method === 'click' && draftFixture.steel.lengthMm === undefined) {
      return { error: '個数で拾う鉄骨部材には部材の長さ（mm）を入れてください。' }
    }
    try {
      return { result: previewSteel?.(draftFixture) }
    } catch (reason) {
      return { error: reason instanceof Error ? reason.message : String(reason) }
    }
  }, [draftFixture, previewSteel])
  const barrierCandidates = useMemo(() => {
    if (value.link?.kind !== 'crossing') return []
    const sourceIds = new Set(fixtureLinkSources(fixtures, value).map(source => source.itemId))
    return fixtures.filter(f => f.id !== value.id && !f.link && !sourceIds.has(f.id)
      && ['polyline', 'polygon', 'polygonDepth'].includes(quantityMethod(f)))
  }, [fixtures, value])
  const crossingBarrierCount = useMemo(() =>
    draftFixture.link?.kind === 'crossing'
      ? previewCrossingBarrierCount?.(draftFixture) ?? 0
      : 0, [draftFixture, previewCrossingBarrierCount])
  const sourceGroups = useMemo(() => {
    const query = linkSearch.trim().toLocaleLowerCase()
    return groupFixtures(fixtures.filter(f => f.id !== value.id
      && `${fixtureCode(f)} ${f.name} ${f.category}`.toLocaleLowerCase().includes(query)))
  }, [fixtures, value.id, linkSearch])
  const updateLink = (change: (link: FixtureLink) => FixtureLink) => {
    setValue(previous => previous.link ? { ...previous, link: change(previous.link) } : previous)
    setError('')
  }
  const updateSource = (itemId: string, change: (source: FixtureLinkSource) => FixtureLinkSource) => {
    updateLink(link => ({ ...link, sources: link.sources.map(source => source.itemId === itemId ? change(source) : source) }))
  }
  const shapeInput = (
    key: 'heightM' | 'clearanceM' | 'marginM' | 'depthM',
    label: string,
  ) => {
    const number = value.link?.shape?.[key]
    return <label>{label}
      <input type="number" step="any" aria-label={label}
        value={number === undefined
          ? key === 'clearanceM' ? 0.5 : ''
          : Number.isFinite(number) ? number : ''}
        onChange={event => {
          const text = event.currentTarget.value
          updateLink(link => {
            const shape: NonNullable<FixtureLink['shape']> = {
              ...link.shape, output: link.shape?.output ?? 'area',
            }
            if (text.trim() === '') delete shape[key]
            else shape[key] = Number(text)
            return { ...link, shape }
          })
        }} />
    </label>
  }
  const attributeInput = (key: typeof numericAttributeKeys[number], label: string) => <label>{label}
    <input aria-label={label} inputMode="decimal" value={attributeDraft[key]} onChange={event => {
      const text = event.currentTarget.value
      setAttributeDraft(previous => ({ ...previous, [key]: text }))
      setError('')
    }} />
  </label>
  const [conditionDrafts, setConditionDrafts] = useState(initial.conditions ?? [])
  const conditionRenames = useRef(new Map<string, string>())
  const conditionOrigins = useRef<Array<string | undefined>>([...(initial.conditions ?? [])])
  const changeCandidates = (conditions: string[], origins: Array<string | undefined>, renamed?: [string, string]) => {
    const message = fixtureConditionsError({ conditions })
    if (message) { setConditionError(message); return false }
    const replace = (v: PartCondition) => typeof v === 'string' ? renamed && v === renamed[0] ? renamed[1] : conditions.includes(v) ? v : undefined : v
    setValue(v => ({ ...v, conditions, defaultCondition: replace(v.defaultCondition) as string | undefined,
      link: v.link?.condition ? {
        ...v.link,
        condition: { mode: 'fixed', value: replace(v.link.condition.value) as string | undefined ?? '' },
      } : v.link,
      routeDefaults: v.routeDefaults === undefined ? undefined : normalizeRouteConditions({ plan: replace(v.routeDefaults.plan), rise: Array.isArray(v.routeDefaults.rise) ? v.routeDefaults.rise.map(replace) : replace(v.routeDefaults.rise), slack: replace(v.routeDefaults.slack) }) }))
    if (renamed) { const index = value.conditions?.indexOf(renamed[0]) ?? -1, origin = conditionOrigins.current[index]; if (origin !== undefined) { if (origin === renamed[1]) conditionRenames.current.delete(origin); else conditionRenames.current.set(origin, renamed[1]) } }
    conditionOrigins.current = origins; setConditionDrafts([...conditions]); setConditionError(''); return true
  }
  const specInput = useRef<HTMLInputElement>(null), aggregationTouched = useRef(editing)
  const categories = useMemo(() => {
    const result = groupFixtures(fixtures).map(g => g.category)
    if ((fixtures.length || editing) && !result.includes(initial.category)) result.push(initial.category)
    return result
  }, [fixtures, initial.category, editing])
  const [newCategory, setNewCategory] = useState(!fixtures.length && !editing)
  const heading = useRef<HTMLHeadingElement>(null)
  const position = useRef({ ...fixtureDialogPosition })
  const drag = useRef<{ pointerId: number; x: number; y: number; startX: number; startY: number } | null>(null)
  const move = (x: number, y: number) => {
    if (!dialog.current?.open || !heading.current) return
    const rect = heading.current.getBoundingClientRect()
    const left = rect.left - position.current.x, right = rect.right - position.current.x
    const top = rect.top - position.current.y, bottom = rect.bottom - position.current.y
    const visibleWidth = Math.min(80, rect.width, window.innerWidth)
    const minX = visibleWidth - right, maxX = window.innerWidth - visibleWidth - left
    const minY = -top, maxY = Math.max(minY, window.innerHeight - bottom)
    position.current = { x: Math.max(minX, Math.min(maxX, x)), y: Math.max(minY, Math.min(maxY, y)) }
    fixtureDialogPosition = { ...position.current }
    dialog.current.style.translate = `${position.current.x}px ${position.current.y}px`
  }
  const endDrag = (event: PointerEvent<HTMLHeadingElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const sampleInteraction = useContext(FixtureSampleContext)
  const alive = useRef(false), capturing = useRef(false), suggestions = useRef<CountStyle[]>([])
  const lineSuggestions = useRef<QuantityLineAppearance[]>([])
  const cancelCapture = useRef(sampleInteraction?.cancel)
  cancelCapture.current = sampleInteraction?.cancel
  useEffect(() => {
    alive.current = true; dialog.current?.showModal(); if (duplicate) { specInput.current?.focus(); specInput.current?.select() }
    const constrain = () => move(position.current.x, position.current.y)
    constrain()
    window.addEventListener('resize', constrain)
    // Recentered layout can change when a captured sample or an error appears.
    const observer = new ResizeObserver(constrain)
    if (dialog.current) observer.observe(dialog.current)
    return () => {
      alive.current = false; drag.current = null
      window.removeEventListener('resize', constrain); observer.disconnect()
      if (capturing.current) cancelCapture.current?.()
    }
  }, [])
  useEffect(() => {
    if (initialSection !== 'rc') return
    setRcOpen(true)
    const frame = window.requestAnimationFrame(() => {
      rcSection.current?.scrollIntoView({ block: 'start' })
      rcCheckbox.current?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [initialSection])
  const capture = async () => {
    if (!sampleInteraction || capturing.current) return
    capturing.current = true; setError(''); dialog.current?.close()
    try {
      const sample = await sampleInteraction.request()
      if (sample && alive.current) setValue(v => ({ ...v, sample }))
    } catch (reason) { if (alive.current) setError(String(reason)) }
    finally {
      capturing.current = false
      if (alive.current) { dialog.current?.showModal(); move(position.current.x, position.current.y) }
    }
  }
  const style = (changes: Partial<CountStyle>) => setValue(v => ({ ...v, style: { ...v.style, ...changes } }))
  const length = quantityKind(value) !== 'count'
  const line = (changes: Partial<QuantityLineStyle>) => setValue(v => ({ ...v, line: { ...quantityLine(v), ...changes } }))
  const changeKind = (kind: QuantityKind) => {
    try {
      const appearance = kind !== 'count' && !editing ? nextQuantityLineStyle(fixtures) : undefined
      setValue(v => {
        const next: CountFixture = { ...v, aggregation: aggregationTouched.current ? quantityAggregation(v) : kind === 'count' ? 'location' : 'document', kind: kind === 'count' ? undefined : kind, routeDefaults: kind === 'length' ? v.routeDefaults : undefined, defaultCondition: kind === 'length' ? undefined : v.defaultCondition, method: undefined, style: appearance ? { ...v.style, color: appearance.color } : v.style, line: kind !== 'count' ? appearance?.line ?? { width: 1.5, dash: 'solid' } : undefined, defaults: kind !== 'count' ? {} : undefined }
        if (kind !== 'count') delete next.unit
        if (kind !== 'count' && kind !== 'length') delete next.steel
        return next
      })
      setError('')
    } catch (reason) { setError(String(reason)) }
  }
  const draftState = JSON.stringify({
    value, openingWidth, openingHeight, breakdownDraft, summaryDrafts,
    convertDraft, attributeDraft, conditionDrafts, conditionInput,
    barrierNameInput, customSteel, backfillEnabled, backfillConditions, applyDimensions,
    conditionRenames: [...conditionRenames.current],
  })
  const initialDraftState = useRef(draftState)
  const openFixtureRc = (id: string) => {
    if (!onOpenFixture) return
    if (draftState !== initialDraftState.current
      && !window.confirm('変更を保存せずに移りますか？')) return
    onOpenFixture(id, 'rc')
  }
  const collisions = fixtures.filter(f => f.id !== value.id && sameFixtureAppearance(f, value))
  const shapeNames = ['丸', '二重丸', '四角', '角丸四角', '三角', '逆三角', 'ひし形', '五角形', '六角形', '八角形', '星', '十字', 'バツ', '砂時計']
  const fillNames = ['塗りなし', '塗りつぶし', '半分塗り', '中心に点', '斜線']
  return <dialog ref={dialog} className="fixture-dialog fixture-editor-dialog" style={{ translate: `${position.current.x}px ${position.current.y}px` }} aria-label={editing ? '項目を編集' : '項目を追加'} onCancel={onClose}>
    <form onSubmit={event => {
      event.preventDefault()
      try {
        if (conditionDrafts.some((text, i) => text !== value.conditions?.[i])) { setConditionError('候補の名前を編集したら「名前の変更」を押してください。'); return }
        const message = fixtureConditionsError(value)
        if (message) { setConditionError(message); return }
        let opening: CountFixture['opening']
        if (quantityKind(value) === 'count') {
          const width = openingWidth.trim(), height = openingHeight.trim()
          if (!!width !== !!height) { setError('開口寸法は幅と高さの両方を入力してください。'); return }
          if (width && height) {
            const widthM = Number(width), heightM = Number(height)
            if (!Number.isFinite(widthM) || widthM <= 0 || widthM > 100 || !Number.isFinite(heightM) || heightM <= 0 || heightM > 100) {
              setError('開口寸法は0より大きく100以下の数値で入力してください。'); return
            }
            opening = { widthM, heightM }
          }
        }
        const summary = summaryDrafts.map(field => ({ label: field.label.trim(), value: field.value.trim() }))
          .filter(field => field.label !== '' || field.value !== '')
        if (summary.some(field => field.label === '' || field.value === '')) {
          setError('摘要は区分名と値の両方を入れてください。'); return
        }
        const f: CountFixture = { ...draftFixture, opening, aggregation: quantityAggregation(value), spec: value.spec?.trim() || undefined, name: value.name.trim(), category: categories.find(c => c.trim() === value.category.trim()) ?? value.category.trim() }
        delete f.unit
        delete f.breakdown
        delete f.summary
        delete f.remark
        delete f.convert
        if (convertDraft.enabled && !f.link) {
          f.convert = {
            factor: Number(convertDraft.factor.trim()),
            unit: convertDraft.unit,
            basis: convertDraft.basis,
          }
          const convertError = fixtureConvertError(f)
          if (convertError) { setError(convertError); return }
        }
        if (quantityKind(value) === 'count' && value.unit !== undefined) f.unit = value.unit
        if (breakdownDraft.book !== '') {
          const middle = breakdownDraft.middle.trim()
          f.breakdown = {
            book: breakdownDraft.book, section: breakdownDraft.section.trim(), subject: breakdownDraft.subject.trim(),
            ...(middle ? { middle } : {}), item: breakdownDraft.item.trim(),
          }
        }
        if (summary.length) f.summary = summary
        const remark = value.remark?.trim()
        if (remark) f.remark = remark
        if (f.link) {
          delete f.rc
          delete f.steel
        }
        if (f.rc && f.steel) {
          setError('RC部材と鉄骨部材は同時に設定できません。'); return
        }
        if (f.steel) {
          const steelError = steelMemberError(f.steel)
          if (steelError) { setError(steelError); return }
          const method = quantityMethod(f)
          if (method !== 'polyline' && method !== 'click') {
            setError('鉄骨部材は線・個数の拾い方で設定してください。'); return
          }
          if (method === 'click' && f.steel.lengthMm === undefined) {
            setError('個数で拾う鉄骨部材には部材の長さ（mm）を入れてください。'); return
          }
        }
        if (f.rc) {
          const rcError = rcMemberError(f.rc, {
            fromShape: quantityMethod(f) === 'polygonDepth',
            fromLine: quantityMethod(f) === 'polyline',
          })
          if (rcError) { setError(rcError); return }
          if (!rcKindsFor(f).includes(f.rc.kind)) {
            setError('RC部材の種類と拾い方が一致していません。'); return
          }
          // 厚さを省略できるのは、拾いの深さを厚さに使える体積（囲む × 深さ）の項目だけ。
          if ((f.rc.kind === 'slab' || f.rc.kind === 'foundationSlab')
            && f.rc.thicknessMm === undefined && quantityMethod(f) !== 'polygonDepth') {
            setError('RC部材の厚さを入れてください。'); return
          }
        }
        const fieldsError = fixtureBreakdownError(f) ?? fixtureLinkError(f)
        if (fieldsError) { setError(fieldsError); return }
        if (f.link) {
          if (hasMarks) { setError('拾いがある項目は連動にできません'); return }
          if (f.link.sources.length === 0 && f.link.auto === undefined) {
            setError('元の項目を1つ以上選んでください'); return
          }
          if (f.link.condition && !(f.conditions ?? []).includes(f.link.condition.value)) {
            setError('連動の施工条件は、この項目の施工条件の候補から選んでください。'); return
          }
          if (previewLink?.(f)?.error === '連動の元が循環しています。') {
            setError('連動の元が循環しています。'); return
          }
        }
        serializeCountFixtures(editing ? fixtures.map(p => p.id === f.id ? f : p) : [...fixtures, f])
        setFixtureConditionRenames(f, conditionRenames.current)
        setFixtureDimensionUpdate(
          f, editing && applyDimensions && dimensionCounts.matched > 0,
        )
        onSave(f)
      } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    }}>
      <h2 ref={heading} className="fixture-drag-handle" title="ドラッグして移動できます" onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: position.current.x, startY: position.current.y }
      }} onPointerMove={event => {
        const active = drag.current
        if (active?.pointerId === event.pointerId) move(active.startX + event.clientX - active.x, active.startY + event.clientY - active.y)
      }} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={() => { drag.current = null }}>
        <span aria-hidden="true">⠿</span>{editing ? '項目を編集' : '項目を追加'}
      </h2>
      <div className="fixture-dialog-body">
      <div className="fixture-dialog-details">
      <fieldset><legend>種別</legend>{(['count', 'length', 'area', 'volume'] as const).map(kind => <label key={kind}><input type="radio" name="quantity-kind" value={kind} checked={quantityKind(value) === kind} disabled={hasMarks} onChange={() => changeKind(kind)} />{{ count: '個数', length: '長さ', area: '面積', volume: '体積' }[kind]}</label>)}</fieldset>
      {['area', 'volume'].includes(quantityKind(value)) && <fieldset><legend>拾い方（拾うときの初期値。拾いバーで切り替えられます）</legend>{QUANTITY_METHODS[quantityKind(value)].map(method => <label key={method}><input type="radio" name="quantity-method" checked={quantityMethod(value) === method} onChange={() => setValue(v => ({ ...v, method, defaults: {} }))} />{{ polygon: '囲む', lengthHeight: '長さ×高さ', polygonDepth: '囲む×深さ', lengthWidthDepth: '長さ×幅×深さ', click: '', polyline: '' }[method]}</label>)}</fieldset>}
      {hasMarks && <p>拾いがあるため種別は変えられません</p>}
      <label>名称<input required maxLength={80} value={value.name} onChange={e => setValue({ ...value, name: e.currentTarget.value })} /></label>
      <label>略号<input maxLength={16} value={value.code} onChange={e => setValue({ ...value, code: e.currentTarget.value })} /></label>
      <label>規格<input ref={specInput} maxLength={40} value={value.spec ?? ''} onChange={e => setValue({ ...value, spec: e.currentTarget.value })} /></label>
      <fieldset><legend>集計方式</legend>{(['location', 'document'] as const).map(aggregation => <label key={aggregation}><input type="radio" name="quantity-aggregation" checked={quantityAggregation(value) === aggregation} onChange={() => { aggregationTouched.current = true; setValue({ ...value, aggregation }) }} />{aggregation === 'location' ? '場所別（階・部屋ごと）' : '全図面の合計'}</label>)}</fieldset>
      <label>分類<select aria-label="分類" value={newCategory ? '' : value.category} onChange={e => { const category = e.currentTarget.value; setNewCategory(category === ''); setValue({ ...value, category }) }}>
        {categories.map(c => <option key={c} value={c}>{c}</option>)}
        <option value="">＋ 新しい分類…</option>
      </select></label>
      {newCategory && <label>新しい分類の名前<input aria-label="新しい分類の名前" required maxLength={40} value={value.category} onChange={e => setValue({ ...value, category: e.currentTarget.value })} /></label>}
      <div className="fixture-fields"><label>{length ? '文字の大きさ' : '大きさ'}<select value={value.style.size} onChange={e => style({ size: Number(e.currentTarget.value) })}>{COUNT_SIZES.map(n => <option key={n} value={n}>{n} pt</option>)}</select></label>
        <label>透明度<select value={value.style.opacity} onChange={e => style({ opacity: Number(e.currentTarget.value) })}>{COUNT_OPACITIES.map(n => <option key={n} value={n}>{Math.round(n * 100)}%</option>)}</select></label></div>
      <label><input type="checkbox" checked={value.style.showCode} onChange={e => style({ showCode: e.currentTarget.checked })} />略号を図面に表示</label>
      <label>メモ<textarea maxLength={200} value={value.memo ?? ''} onChange={e => setValue({ ...value, memo: e.currentTarget.value })} /></label>
      <details className="fixture-breakdown" open={breakdownOpen} onToggle={event => setBreakdownOpen(event.currentTarget.open)}>
        <summary>内訳書</summary>
        {quantityKind(value) === 'count' && <label>単位<select aria-label="単位" value={value.unit ?? ''} onChange={e => {
          const unit = e.currentTarget.value
          setValue(v => {
            const next = { ...v }
            if (unit === '') delete next.unit
            else next.unit = unit as CountUnit
            return next
          })
        }}>
          <option value="">個（既定）</option>
          {COUNT_UNITS.filter(unit => unit !== '個').map(unit => <option key={unit} value={unit}>{unit}</option>)}
        </select></label>}
        <fieldset><legend>内訳書の位置</legend>
          <label>編<select aria-label="編" value={breakdownDraft.book} onChange={e => {
            const book = e.currentTarget.value as BreakdownBook | ''
            setBreakdownDraft(previous => ({
              ...previous, book,
              section: previous.book === '' && book !== '' && !previous.section.trim() ? '庁舎' : previous.section,
            }))
          }}>
            <option value="">なし</option>
            {BREAKDOWN_BOOKS.map(book => <option key={book} value={book}>{book}</option>)}
          </select></label>
          <label>種目<input aria-label="種目" maxLength={20} disabled={breakdownDraft.book === ''} value={breakdownDraft.section} onChange={e => {
            const section = e.currentTarget.value
            setBreakdownDraft(previous => ({ ...previous, section }))
          }} /></label>
          <label>科目<input aria-label="科目" maxLength={30} disabled={breakdownDraft.book === ''} value={breakdownDraft.subject} onChange={e => {
            const subject = e.currentTarget.value
            setBreakdownDraft(previous => ({ ...previous, subject }))
          }} /></label>
          <label>中科目<input aria-label="中科目" maxLength={30} disabled={breakdownDraft.book === ''} value={breakdownDraft.middle} onChange={e => {
            const middle = e.currentTarget.value
            setBreakdownDraft(previous => ({ ...previous, middle }))
          }} /></label>
          <label>細目<input aria-label="細目" maxLength={40} disabled={breakdownDraft.book === ''} value={breakdownDraft.item} onChange={e => {
            const item = e.currentTarget.value
            setBreakdownDraft(previous => ({ ...previous, item }))
          }} /></label>
        </fieldset>
        <fieldset><legend>摘要</legend>
          <ol>{summaryDrafts.map((field, i) => <li key={i}>
            <label>区分名<input aria-label={'摘要の区分名' + (i + 1)} maxLength={20} value={field.label} onChange={e => {
              const label = e.currentTarget.value
              setSummaryDrafts(previous => previous.map((v, j) => j === i ? { ...v, label } : v))
            }} /></label>
            <label>値<input aria-label={'摘要の値' + (i + 1)} maxLength={60} value={field.value} onChange={e => {
              const text = e.currentTarget.value
              setSummaryDrafts(previous => previous.map((v, j) => j === i ? { ...v, value: text } : v))
            }} /></label>
            <button type="button" onClick={() => setSummaryDrafts(previous => previous.filter((_, j) => j !== i))}>削除</button>
          </li>)}</ol>
          <button type="button" disabled={summaryDrafts.length >= 8} onClick={() => setSummaryDrafts(previous => [...previous, { label: '', value: '' }])}>摘要の区分を追加</button>
          <p>{summaryText({ summary: summaryDrafts }) || '（なし）'}</p>
        </fieldset>
        <label>備考<input aria-label="備考" maxLength={40} value={value.remark ?? ''} onChange={e => setValue({ ...value, remark: e.currentTarget.value })} /></label>
      </details>
      <details className="fixture-attributes" open={attributesOpen} onToggle={event => setAttributesOpen(event.currentTarget.open)}>
        <summary>質量・寸法（搬入・発生材の計算に使う）</summary>
        {quantityKind(value) === 'count'
          ? attributeInput('massKg', '単体質量（kg）')
          : attributeInput('unitMassKg', `1${quantityUnit(value)}あたりの質量（kg）`)}
        <div className="fixture-attribute-fields">
          {attributeInput('widthMm', '幅（mm）')}
          {attributeInput('depthMm', '奥行（mm）')}
          {attributeInput('heightMm', '高さ（mm）')}
          {attributeInput('outerDiameterMm', '外径（mm）')}
        </div>
        {value.link?.kind !== 'mass' && <label>発生材の種類<input aria-label="発生材の種類" maxLength={20} value={attributeDraft.wasteType} onChange={event => {
          const wasteType = event.currentTarget.value
          setAttributeDraft(previous => ({ ...previous, wasteType }))
          setError('')
        }} /></label>}
        <p>空欄の値は保存しません。</p>
      </details>
      <details className="fixture-link" open={linkOpen} onToggle={event => setLinkOpen(event.currentTarget.open)}>
        <summary>連動（ほかの項目から数量を計算する）</summary>
        <label><input type="checkbox" aria-label="連動にする" checked={!!value.link} disabled={hasMarks} onChange={event => {
          const enabled = event.currentTarget.checked
          const removedConvert = enabled && (convertDraft.enabled || !!value.convert)
          const removedRc = enabled && !!value.rc
          const removedSteel = enabled && !!value.steel
          const rule = enabled && !initial.link
            ? linkRuleForDetail(value.name) : undefined
          const startingLink: FixtureLink | undefined = enabled
            ? initial.link ? structuredClone(initial.link)
              : rule ? linkFromRule(rule, value.name, summaryDrafts)
                : { kind: 'factor', sources: [] }
            : undefined
          setValue(previous => {
            const next = { ...previous }
            if (startingLink) {
              next.link = startingLink
              delete next.convert
              delete next.rc
              delete next.steel
            } else delete next.link
            return next
          })
          if (enabled) {
            setConvertDraft(previous => ({ ...previous, enabled: false }))
            setLinkRuleId(rule?.id
              ?? initialLinkRule(startingLink, value.name)?.id ?? '')
            setBarrierNameInput(
              (startingLink?.crossing?.barrierNameIncludes ?? []).join('、'),
            )
          } else setLinkRuleId('')
          setLinkNotice([
            rule ? `標準の規則「${rule.label}」で始めました` : '',
            removedConvert ? '連動にすると数量の換算は使えません（換算を外しました）' : '',
            removedRc ? '連動にするとRC部材の設定は使えません（RC部材を外しました）' : '',
            removedSteel ? '連動にすると鉄骨部材の設定は使えません（鉄骨部材を外しました）' : '',
          ].filter(Boolean).join('。'))
          setError('')
        }} />連動にする（図面には拾わず、ほかの項目の数量から計算する）</label>
        {hasMarks && <p>拾いがある項目は連動にできません</p>}
        {linkNotice && <p role="status">{linkNotice}</p>}
        {value.link && <>
          <label>標準の規則<select aria-label="標準の規則" value={selectedLinkRule?.id ?? ''}
            onChange={event => {
              const id = event.currentTarget.value
              const rule = LINK_RULES.find(entry => entry.id === id)
              setLinkRuleId(id)
              setBarrierNameInput((rule?.crossing?.barrierNameIncludes ?? []).join('、'))
              updateLink(link => {
                const next: FixtureLink = { ...link }
                if (!rule) {
                  delete next.auto
                  delete next.factor
                  return next
                }
                next.kind = rule.waste ? 'mass' : rule.kind
                if (next.kind === 'rc') next.rc = defaultRcLink(value.name, rule)
                else delete next.rc
                if (next.kind === 'shape') {
                  next.shape = { output: 'area', ...structuredClone(rule.shape ?? {}) }
                } else delete next.shape
                if (next.kind === 'crossing') {
                  next.crossing = {
                    ...rule.crossing,
                    ...(rule.crossing?.barrierItemIds !== undefined
                      ? { barrierItemIds: [...rule.crossing.barrierItemIds] } : {}),
                    ...(rule.crossing?.barrierNameIncludes !== undefined
                      ? { barrierNameIncludes: [...rule.crossing.barrierNameIncludes] } : {}),
                  }
                } else delete next.crossing
                if (next.kind === 'steel') {
                  next.steel = { output: 'mass', ...rule.steel }
                } else delete next.steel
                const ruleAuto = linkRuleAuto(rule)
                if (ruleAuto !== undefined) next.auto = ruleAuto
                else delete next.auto
                if (rule.kind === 'factor' && rule.factor !== undefined) next.factor = rule.factor
                else delete next.factor
                if (next.kind === 'carry') {
                  next.carry = {
                    class: summaryDrafts.some(field =>
                      field.label.trim() === '区分' && field.value.trim() === '容積品')
                      ? 'bulky' : 'heavy',
                  }
                } else delete next.carry
                if (next.kind !== 'mass') delete next.densityTPerM3
                return next
              })
            }}>
            <option value="">（規則を使わない）</option>
            {LINK_RULES.map(rule => <option key={rule.id} value={rule.id}>{rule.label}</option>)}
          </select></label>
          {selectedLinkRule && <p><small>{selectedLinkRule.note}</small></p>}
          <fieldset><legend>連動の種類</legend>
            {(['factor', 'mass', 'carry', 'rc', 'shape', 'crossing', 'steel'] as const).map(kind => <label key={kind}>
              <input type="radio" name="fixture-link-kind" checked={value.link?.kind === kind} onChange={() => updateLink(link => {
                const next: FixtureLink = { ...link, kind }
                if (kind === 'rc') next.rc = link.rc ?? defaultRcLink(value.name)
                else delete next.rc
                if (kind === 'shape') next.shape = link.shape ?? { output: 'area' }
                else delete next.shape
                if (kind === 'crossing') {
                  next.crossing = link.crossing ?? { planCrossings: true }
                  setBarrierNameInput((next.crossing.barrierNameIncludes ?? []).join('、'))
                } else delete next.crossing
                if (kind === 'steel') next.steel = link.steel ?? { output: 'mass' }
                else delete next.steel
                if (link.kind === 'steel' && kind !== 'steel'
                  && next.auto && Object.keys(next.auto).length === 0) {
                  delete next.auto
                }
                // RC に切り替えて元も自動の元も無いときは、名前の規則（異形鉄筋なら RC 部材すべて）の自動の元で始める。
                if (kind === 'rc' && next.auto === undefined && next.sources.length === 0) {
                  const rule = linkRuleForDetail(value.name)
                  const ruleAuto = rule?.kind === 'rc' ? linkRuleAuto(rule) : undefined
                  if (ruleAuto !== undefined) next.auto = ruleAuto
                }
                if (kind !== 'rc' && next.auto?.rcKinds !== undefined) {
                  const auto = { ...next.auto }
                  delete auto.rcKinds
                  if (Object.keys(auto).length) next.auto = auto
                  else delete next.auto
                }
                if (kind !== 'mass') delete next.densityTPerM3
                if (kind === 'carry') {
                  next.carry = link.carry ?? {
                    class: summaryDrafts.some(field =>
                      field.label.trim() === '区分' && field.value.trim() === '容積品')
                      ? 'bulky' : 'heavy',
                  }
                } else delete next.carry
                return next
              })} />
              {{ factor: '係数で計算する', mass: '質量に換算する（t・㎥）',
                carry: '機器搬入・搬出（重量品・容積品の補正）',
                rc: 'RC 部材から（コンクリート・型枠・鉄筋）',
                shape: '形から（面積・周長・根切り など）',
                crossing: '交差から（防火区画貫通・スリーブ など）',
                steel: '鉄骨の部材から（質量・塗装・耐火被覆）' }[kind]}
            </label>)}
          </fieldset>
          {value.link.kind === 'rc' && <fieldset className="fixture-link-rc">
            <legend>RC 部材からの計算</legend>
            <label>RC の出力<select aria-label="RC の出力"
              value={value.link.rc?.output ?? 'concrete'}
              onChange={event => {
                const output = event.currentTarget.value as NonNullable<FixtureLink['rc']>['output']
                updateLink(link => ({
                  ...link, rc: {
                    output,
                    ...(output === 'rebar' ? {
                      basis: /加工組立|運搬/u.test(value.name)
                        ? 'design' : linkRuleForDetail(value.name)?.rc?.basis ?? 'required',
                    } : {}),
                  },
                }))
              }}>
              <option value="concrete">コンクリート</option>
              <option value="formwork">型枠</option>
              <option value="rebar">鉄筋</option>
              <option value="gasJoint">ガス圧接</option>
              <option value="lapJoint">重ね継手</option>
            </select></label>
            {value.link.rc?.output === 'rebar' && <>
              <fieldset><legend>鉄筋の数量</legend>
                {(['design', 'required'] as const).map(basis => <label key={basis}>
                  <input type="radio" name="fixture-link-rebar-basis"
                    checked={(value.link?.rc?.basis ?? 'design') === basis}
                    onChange={() => updateLink(link => ({
                      ...link, rc: { ...link.rc, output: 'rebar', basis },
                    }))} />
                  {basis === 'design' ? '設計数量' : `所要数量（×${REBAR_REQUIRED_FACTOR}）`}
                </label>)}
              </fieldset>
              <fieldset className="fixture-link-choice-grid">
                <legend>径で絞る（どれも付けなければ全部）</legend>
                {REBAR_SIZES.map(size => <label key={size}>
                  <input type="checkbox" aria-label={`RC の径 ${size}`}
                    checked={value.link?.rc?.sizes?.includes(size) ?? false}
                    onChange={event => {
                      const checked = event.currentTarget.checked
                      updateLink(link => {
                        const sizes = checked
                          ? [...new Set([...(link.rc?.sizes ?? []), size])]
                          : (link.rc?.sizes ?? []).filter(entry => entry !== size)
                        const rc: NonNullable<FixtureLink['rc']> = {
                          ...link.rc, output: 'rebar',
                        }
                        if (sizes.length) rc.sizes = sizes
                        else delete rc.sizes
                        return { ...link, rc }
                      })
                    }} />{size}
                </label>)}
              </fieldset>
            </>}
            <label><input type="checkbox" aria-label="RC 部材を自動で元にする"
              checked={value.link.auto?.rcKinds !== undefined}
              onChange={event => {
                const enabled = event.currentTarget.checked
                setLinkRuleId('')
                updateLink(link => {
                  const next = { ...link }
                  if (enabled) next.auto = { rcKinds: [] }
                  else delete next.auto
                  return next
                })
              }} />RC 部材を自動で元にする</label>
            {value.link.auto?.rcKinds !== undefined && <fieldset className="fixture-link-choice-grid">
              <legend>部材の種類で絞る（どれも付けなければ全部）</legend>
              {RC_KINDS.map(kind => <label key={kind}>
                <input type="checkbox" aria-label={`${RC_KIND_LABELS[kind]}を自動で元にする`}
                  checked={value.link?.auto?.rcKinds?.includes(kind) ?? false}
                  onChange={event => {
                    const checked = event.currentTarget.checked
                    updateLink(link => ({
                      ...link,
                      auto: {
                        ...link.auto,
                        rcKinds: checked
                          ? [...new Set([...(link.auto?.rcKinds ?? []), kind])]
                          : (link.auto?.rcKinds ?? []).filter(entry => entry !== kind),
                      },
                    }))
                  }} />{RC_KIND_LABELS[kind]}
              </label>)}
            </fieldset>}
          </fieldset>}
          {value.link.kind === 'shape' && <fieldset className="fixture-link-shape">
            <legend>形からの計算</legend>
            <label>形の出力<select aria-label="形の出力"
              value={value.link.shape?.output ?? 'area'}
              onChange={event => {
                const output = event.currentTarget.value as NonNullable<FixtureLink['shape']>['output']
                updateLink(link => ({ ...link, shape: { ...link.shape, output } }))
              }}>
              <option value="area">面積</option>
              <option value="perimeter">周長</option>
              <option value="lengthTimesHeight">長さ×高さ</option>
              <option value="excavation">根切り</option>
            </select></label>
            {value.link.shape?.output === 'lengthTimesHeight' &&
              shapeInput('heightM', '高さ（m）')}
            {value.link.shape?.output === 'excavation' && <>
              {shapeInput('clearanceM', 'ゆとり幅（m）')}
              {shapeInput('marginM', '余幅を手で入れる（m）')}
              {shapeInput('depthM', '深さ（m）')}
              <p>ゆとり幅の既定は0.5mです。余幅は空欄なら基準どおりに計算します。</p>
              <p>元の拾いに深さがあれば、その深さを使います。</p>
            </>}
          </fieldset>}
          {value.link.kind === 'crossing' && <fieldset className="fixture-link-crossing">
            <legend>交差からの計算</legend>
            <fieldset className="fixture-link-choice-grid">
              <legend>区画の項目</legend>
              {barrierCandidates.map(f => <label key={f.id}>
                <input type="checkbox" aria-label={`${fixtureCode(f)}を区画にする`}
                  checked={value.link?.crossing?.barrierItemIds?.includes(f.id) ?? false}
                  onChange={event => {
                    const checked = event.currentTarget.checked
                    updateLink(link => {
                      const barrierItemIds = checked
                        ? [...new Set([...(link.crossing?.barrierItemIds ?? []), f.id])]
                        : (link.crossing?.barrierItemIds ?? []).filter(id => id !== f.id)
                      const crossing = { ...link.crossing }
                      if (barrierItemIds.length) crossing.barrierItemIds = barrierItemIds
                      else delete crossing.barrierItemIds
                      return { ...link, crossing }
                    })
                  }} />{fixtureCode(f)} {f.name}
              </label>)}
            </fieldset>
            <label>区画の名称に含む語<input aria-label="区画の名称に含む語"
              value={barrierNameInput} placeholder="防火区画、区画壁"
              onChange={event => {
                const text = event.currentTarget.value
                setBarrierNameInput(text)
                const words = [...new Set(text.split(/[、，,\s]+/u).filter(Boolean))]
                updateLink(link => {
                  const crossing = { ...link.crossing }
                  if (words.length) crossing.barrierNameIncludes = words
                  else delete crossing.barrierNameIncludes
                  return { ...link, crossing }
                })
              }} /></label>
            <p>読点・空白で区切って入れてください。</p>
            <label><input type="checkbox"
              aria-label="平面で区画の線との交差を数える"
              checked={value.link.crossing?.planCrossings !== false}
              onChange={event => {
                const planCrossings = event.currentTarget.checked
                updateLink(link => ({
                  ...link, crossing: { ...link.crossing, planCrossings },
                }))
              }} />平面で区画の線との交差を数える</label>
            <label><input type="checkbox"
              aria-label="立上り・立下りを床の貫通として数える"
              checked={value.link.crossing?.includeRises ?? false}
              onChange={event => {
                const includeRises = event.currentTarget.checked
                updateLink(link => ({
                  ...link, crossing: { ...link.crossing, includeRises },
                }))
              }} />立上り・立下りを床の貫通として数える</label>
            <p role="status">{crossingBarrierCount > 0
              ? `区画の拾い ${crossingBarrierCount} 本` : '区画の項目がありません'}</p>
          </fieldset>}
          {value.link.kind === 'steel' && <fieldset className="fixture-link-steel">
            <legend>鉄骨の部材からの計算</legend>
            <label>鉄骨の出力<select aria-label="鉄骨の出力"
              value={value.link.steel?.output ?? 'mass'}
              onChange={event => {
                const output = event.currentTarget.value as NonNullable<FixtureLink['steel']>['output']
                updateLink(link => ({
                  ...link, steel: { ...link.steel, output },
                }))
              }}>
              <option value="mass">質量</option>
              <option value="paint">塗装の面積</option>
              <option value="fireproof">耐火被覆の面積</option>
            </select></label>
            {(value.link.steel?.output ?? 'mass') === 'mass'
              ? <fieldset><legend>鉄骨の数量</legend>
                {(['design', 'required'] as const).map(basis => <label key={basis}>
                  <input type="radio" name="fixture-link-steel-basis"
                    checked={(value.link?.steel?.basis ?? 'design') === basis}
                    onChange={() => updateLink(link => ({
                      ...link, steel: { ...link.steel, output: 'mass', basis },
                    }))} />
                  {basis === 'design' ? '設計数量'
                    : `所要数量（×${STEEL_REQUIRED_FACTOR.section}）`}
                </label>)}
              </fieldset>
              : <label>表面の種類<select aria-label="表面の種類"
                value={value.link.steel?.surface ?? 'contour'}
                onChange={event => {
                  const surface = event.currentTarget.value as NonNullable<FixtureLink['steel']>['surface']
                  updateLink(link => ({
                    ...link,
                    steel: { ...link.steel, output: link.steel?.output ?? 'paint', surface },
                  }))
                }}>
                <option value="contour">外周（塗装・吹付け）</option>
                <option value="box">箱（柱の巻付け）</option>
                <option value="boxBeam">箱（梁の巻付け、上面なし）</option>
              </select></label>}
            <label><input type="checkbox" aria-label="鉄骨の部材を自動で元にする"
              checked={value.link.auto !== undefined}
              onChange={event => {
                const enabled = event.currentTarget.checked
                setLinkRuleId('')
                updateLink(link => {
                  const next = { ...link }
                  if (enabled) next.auto = {}
                  else delete next.auto
                  return next
                })
              }} />鉄骨の部材を自動で元にする</label>
          </fieldset>}
          {rcKindMismatches.length > 0 && <section aria-label="RC 部材の案内">
            <p role="status">{`部材の種類が合う RC 部材がありません。この連動は ${value.link.auto?.rcKinds?.map(value => {
              const kind = RC_KINDS.find(entry => entry === value)
              return kind ? RC_KIND_LABELS[kind] : value
            }).join('、')} を元にします。今ある RC 部材: ${rcKindMismatches.map(f =>
              `${f.name}（${RC_KIND_LABELS[f.rc!.kind]}）`).join('、')}`}</p>
            <div>
              {rcKindMismatches.map(f => <button type="button" key={f.id}
                disabled={!onOpenFixture}
                onClick={() => openFixtureRc(f.id)}>
                {fixtureCode(f)} {f.name}の部材の種類を直す
              </button>)}
            </div>
          </section>}
          {rcLinkMissing && rcKindMismatches.length === 0 &&
            <section aria-label="RC 部材の案内">
            <p role="status">元になる RC 部材の項目がありません。コンクリートなどの項目を開いて「RC 部材」で配筋を入れてください。</p>
            <div>
              {rcCandidates.map(f => <button type="button" key={f.id}
                disabled={!onOpenFixture}
                onClick={() => openFixtureRc(f.id)}>
                {fixtureCode(f)} {f.name}に配筋を入れる
              </button>)}
            </div>
          </section>}
          {value.link.auto && <section aria-label="自動で元にする項目">
            <h3>自動で元にする項目</h3>
            <p>{value.link.kind === 'steel' && Object.keys(value.link.auto).length === 0
              ? 'すべての鉄骨の部材' : autoDescription(value.link.auto)}</p>
            <p>今当たっている項目: {automaticSources.length}件</p>
            <ul>{automaticSources.slice(0, 5).map(source => {
              const original = fixtures.find(f => f.id === source.itemId)
              return <li key={source.itemId}>
                {original ? `${fixtureCode(original)} ${original.name}` : source.itemId}
                {value.link!.kind === 'carry' && `（${carrySourceText(value.link!, source)}）`}
              </li>
            })}</ul>
            {automaticSources.length > 5 && <p>ほか {automaticSources.length - 5} 件</p>}
            <button type="button" onClick={() => updateLink(link => {
              const next = { ...link }
              delete next.auto
              return next
            })}>自動の選択をやめる</button>
          </section>}
          {value.link.kind === 'carry' && <fieldset><legend>搬入・搬出</legend>
            {(['heavy', 'bulky'] as const).map(carryClass => <label key={carryClass}>
              <input type="radio" name="fixture-link-carry-class"
                checked={value.link?.carry?.class === carryClass}
                onChange={() => updateLink(link => ({
                  ...link, carry: { ...link.carry, class: carryClass },
                }))} />
              {carryClass === 'heavy' ? '重量品' : '容積品'}
            </label>)}
            <label><input type="checkbox" aria-label="単独搬入（補正率を30％増し）"
              checked={value.link.carry?.alone ?? false} onChange={event => {
                const alone = event.currentTarget.checked
                updateLink(link => ({
                  ...link,
                  carry: { class: link.carry?.class ?? 'heavy', ...(alone ? { alone: true } : {}) },
                }))
              }} />単独搬入（補正率を30％増し）</label>
          </fieldset>}
          <fieldset><legend>元の項目</legend>
            <label>元の項目を検索<input type="search" aria-label="元の項目を検索" value={linkSearch}
              onChange={event => setLinkSearch(event.currentTarget.value)} /></label>
            <div className="fixture-link-candidates">
              {sourceGroups.map(group => <fieldset key={group.category}>
                <legend>{group.category}</legend>
                {group.items.map(f => {
                  const checked = value.link!.sources.some(source => source.itemId === f.id)
                  return <label key={f.id}>
                    <input type="checkbox" aria-label={`${fixtureCode(f)} ${f.name}を元にする`} checked={checked}
                      disabled={!checked && value.link!.sources.length >= 50} onChange={event => {
                        const selected = event.currentTarget.checked
                        updateLink(link => ({
                          ...link,
                          sources: selected
                            ? link.sources.some(source => source.itemId === f.id) || link.sources.length >= 50
                              ? link.sources : [...link.sources, {
                                itemId: f.id, factor: link.kind === 'factor' ? link.factor ?? 1 : 1,
                              }]
                            : link.sources.filter(source => source.itemId !== f.id),
                        }))
                      }} />
                    {fixtureCode(f)} {f.name}{f.link ? '（連動）' : ''}
                  </label>
                })}
              </fieldset>)}
              {sourceGroups.length === 0 && <p>該当する項目はありません。</p>}
            </div>
            {value.link.sources.length >= 50 && <p>連動の元は50項目までです。</p>}
          </fieldset>
          <ol className="fixture-link-sources">
            {value.link.sources.map(source => {
              const original = fixtures.find(f => f.id === source.itemId)
              const code = original ? fixtureCode(original) || original.name : source.itemId
              const spacing = source.perM !== undefined
              const sourceBasis = linkPreview?.sources.find(entry => entry.itemId === source.itemId)
              const mass = sourceBasis?.unitMassKg ?? (original
                ? quantityKind(original) === 'count' ? original.attributes?.massKg : original.attributes?.unitMassKg
                : undefined)
              return <li key={source.itemId}>
                <div className="fixture-link-source-heading">
                  <strong>{code} {original?.name ?? '元の項目が見つかりません'}{original?.link ? '（連動）' : ''}</strong>
                  <button type="button" aria-label={`${code}を元から外す`}
                    onClick={() => updateLink(link => ({ ...link, sources: link.sources.filter(entry => entry.itemId !== source.itemId) }))}>×</button>
                </div>
                <div className="fixture-link-source-modifiers">
                  <label><input type="checkbox" aria-label={`${code}を引き算にする`}
                    checked={source.sign === -1}
                    onChange={event => {
                      const checked = event.currentTarget.checked
                      updateSource(source.itemId, previous => {
                        const next = { ...previous }
                        if (checked) next.sign = -1
                        else delete next.sign
                        return next
                      })
                    }} />引き算</label>
                  <label>係数の元<select aria-label={`${code}の係数の元`}
                    value={source.factorFrom ?? ''}
                    onChange={event => {
                      const selected = event.currentTarget.value
                      updateSource(source.itemId, previous => {
                        const next = { ...previous }
                        if (original?.opening && (selected === 'openingArea'
                          || selected === 'openingPerimeter' || selected === 'openingWidth')) {
                          next.factorFrom = selected
                        } else delete next.factorFrom
                        return next
                      })
                    }}>
                    <option value="">数値</option>
                    {original?.opening && <>
                      <option value="openingArea">開口の面積</option>
                      <option value="openingPerimeter">開口の周長</option>
                      <option value="openingWidth">開口の幅</option>
                    </>}
                  </select></label>
                </div>
                {source.factorFrom && !original?.opening &&
                  <p role="status">開口寸法がありません。係数の元を数値に戻すか、元の項目に開口寸法を入れてください。</p>}
                {value.link!.kind !== 'carry' && <div className="fixture-link-source-fields">
                  <label>計算<select aria-label={`${code}の計算`} value={spacing ? 'spacing' : 'factor'}
                    onChange={event => {
                      const method = event.currentTarget.value
                      updateSource(source.itemId, previous => {
                        const next = { ...previous }
                        delete next.factor
                        delete next.perM
                        if (method === 'spacing') next.perM = 1.5
                        else next.factor = value.link?.kind === 'factor' ? value.link.factor ?? 1 : 1
                        return next
                      })
                    }}>
                    <option value="factor">× 係数</option>
                    <option value="spacing">÷ 間隔（m）</option>
                  </select></label>
                  <label>{spacing ? '間隔（m）' : '係数'}<input type="number" step="any"
                    aria-label={`${code}の${spacing ? '間隔（m）' : '係数'}`}
                    value={spacing
                      ? Number.isFinite(source.perM) ? source.perM : ''
                      : source.factor === undefined ? 1 : Number.isFinite(source.factor) ? source.factor : ''}
                    onChange={event => {
                      const text = event.currentTarget.value
                      const number = text.trim() === '' ? NaN : Number(text)
                      updateSource(source.itemId, previous => spacing
                        ? { ...previous, perM: number } : { ...previous, factor: number })
                    }} /></label>
                </div>}
                {value.link!.kind === 'carry' && <p>{carrySourceText(value.link!, sourceBasis)}</p>}
                {!!original?.conditions?.length && <fieldset className="fixture-link-source-conditions">
                  <legend>施工条件で絞る（どれも付けなければ全部）</legend>
                  {['', ...original.conditions].map(condition => <label key={condition}>
                    <input type="checkbox" aria-label={`${code}を${condition || '未設定'}だけにする`}
                      checked={source.conditions?.includes(condition) ?? false} onChange={event => {
                        const checked = event.currentTarget.checked
                        updateSource(source.itemId, previous => {
                          const conditions = checked
                            ? [...new Set([...(previous.conditions ?? []), condition])]
                            : (previous.conditions ?? []).filter(entry => entry !== condition)
                          const next = { ...previous }
                          if (conditions.length) next.conditions = conditions
                          else delete next.conditions
                          return next
                        })
                      }} />
                    {condition || '未設定'}
                  </label>)}
                </fieldset>}
                {value.link!.kind === 'mass' && <p>{mass === undefined
                  ? '質量が未設定です（その項目の編集の「質量・寸法」で入れてください）'
                  : quantityKind(original!) === 'count'
                    ? `単体 ${linkNumber(mass)} kg`
                    : `1${quantityUnit(original!)}あたり ${linkNumber(mass)} kg`}</p>}
              </li>
            })}
          </ol>
          <fieldset><legend>連動の施工条件</legend>
            <label><input type="radio" name="fixture-link-condition" checked={!value.link.condition}
              onChange={() => updateLink(link => {
                const next = { ...link }
                delete next.condition
                return next
              })} />元の施工条件を引き継ぐ</label>
            <label><input type="radio" name="fixture-link-condition" checked={!!value.link.condition}
              onChange={() => updateLink(link => ({
                ...link, condition: { mode: 'fixed', value: value.conditions?.[0] ?? '' },
              }))} />固定する</label>
            {value.link.condition && (value.conditions?.length
              ? <label>施工条件<select aria-label="連動の施工条件" value={value.link.condition.value}
                onChange={event => {
                  const condition = event.currentTarget.value
                  updateLink(link => ({ ...link, condition: { mode: 'fixed', value: condition } }))
                }}>
                <option value="" disabled>選んでください</option>
                {value.conditions.map(condition => <option key={condition} value={condition}>{condition}</option>)}
              </select></label>
              : <p>施工条件の候補を先に入れてください</p>)}
          </fieldset>
          {value.link.kind === 'factor' && fixtureLinkRoundsUp(value) && <label>切り上げ
            <select aria-label="切り上げ" value={value.link.rounding ?? 'total'} onChange={event => {
              const rounding = event.currentTarget.value as NonNullable<FixtureLink['rounding']>
              updateLink(link => ({ ...link, rounding }))
            }}>
              <option value="total">合計で切り上げる</option>
              <option value="each">拾いごとに切り上げる</option>
              <option value="none">切り上げない</option>
            </select>
          </label>}
          {value.link.kind === 'mass' && <>
            <label>発生材の種類<select aria-label="発生材の種類" value={attributeDraft.wasteType}
              onChange={event => {
                const wasteType = event.currentTarget.value
                setAttributeDraft(previous => ({ ...previous, wasteType }))
                updateLink(link => {
                  const next = { ...link }
                  delete next.densityTPerM3
                  return next
                })
              }}>
              <option value="">（指定しない）</option>
              {attributeDraft.wasteType && !WASTE_DENSITIES.some(entry => entry.type === attributeDraft.wasteType)
                && <option value={attributeDraft.wasteType}>{attributeDraft.wasteType}（保存済み）</option>}
              {WASTE_DENSITIES.map(entry => <option key={entry.type} value={entry.type}>
                {entry.type}（{entry.tPerM3} t/㎥）
              </option>)}
            </select></label>
            <label>見かけ比重（t/㎥）<input type="number" step="any" aria-label="見かけ比重（t/㎥）"
              value={value.link.densityTPerM3 === undefined || !Number.isFinite(value.link.densityTPerM3) ? '' : value.link.densityTPerM3}
              onChange={event => {
                const text = event.currentTarget.value
                updateLink(link => {
                  const next = { ...link }
                  if (text.trim() === '') delete next.densityTPerM3
                  else next.densityTPerM3 = Number(text)
                  return next
                })
              }} /></label>
            <p>単位: {quantityUnit(draftFixture)}（入力した見かけ比重を優先し、空欄なら発生材の種類の値を使います。どちらもなければ t）</p>
          </>}
          <label><input type="checkbox" aria-label="数量を手で上書きする" checked={!!value.link.override}
            onChange={event => {
              const enabled = event.currentTarget.checked
              updateLink(link => {
                const next = { ...link }
                if (enabled) next.override = { value: linkPreview?.computed ?? 0 }
                else delete next.override
                return next
              })
            }} />数量を手で上書きする</label>
          {value.link.override && <>
            <label>上書きの数量<input type="number" step="any" aria-label="上書きの数量"
              value={Number.isFinite(value.link.override.value) ? value.link.override.value : ''}
              onChange={event => {
                const text = event.currentTarget.value
                updateLink(link => ({
                  ...link, override: { ...link.override, value: text.trim() === '' ? NaN : Number(text) },
                }))
              }} /></label>
            <label>上書きの理由<input aria-label="上書きの理由" maxLength={200} value={value.link.override.note ?? ''}
              onChange={event => {
                const note = event.currentTarget.value
                updateLink(link => ({ ...link, override: { value: link.override!.value, ...(note ? { note } : {}) } }))
              }} /></label>
          </>}
          {linkPreview && <section className="fixture-link-preview" aria-label="連動の見本">
            <h3>今の拾いで計算した見本</h3>
            <p>合計 {linkPreview.total.toFixed(quantityDecimals(draftFixture))} {quantityUnit(draftFixture)}</p>
            <ul>{linkPreview.sources.map((source, i) => {
              const original = fixtures.find(f => f.id === source.itemId)
              return <li key={`${source.itemId}-${i}`}>
                {original ? `${fixtureCode(original)} ${original.name}` : source.itemId}
                {source.auto && '（自動）'}{' '}
                {fixtureLinkBasisNumber(draftFixture, source.quantity)} {fixtureLinkSourceUnit(draftFixture, original)}
                {value.link!.kind === 'carry'
                  ? ` × 質量 ${source.unitMassKg === undefined ? '未設定' : linkNumber(source.unitMassKg)}kg × 補正率 ${source.factor === undefined ? '適用なし' : linkNumber(source.factor)} ÷ 1000（${carrySourceText(value.link!, source)}）`
                  : <>
                    {source.perM !== undefined ? ` ÷ ${linkNumber(source.perM)} m`
                      : fixtureLinkSourceShowsFactor(draftFixture, source)
                        ? ` × ${linkNumber(source.factor ?? 1)}` : ''}
                    {value.link!.kind === 'mass' && ` × ${source.unitMassKg === undefined ? '未設定' : linkNumber(source.unitMassKg)} kg ÷ 1000`}
                    {value.link!.kind === 'mass' && linkPreview.densityTPerM3 !== undefined && ` ÷ ${linkNumber(linkPreview.densityTPerM3)} t/㎥`}
                  </>}
                {' ＝ '}{fixtureLinkBasisNumber(draftFixture, source.subtotal)} {quantityUnit(draftFixture)}
                {source.note && `（${source.note}）`}
              </li>
            })}</ul>
            {value.link.kind === 'factor' && fixtureLinkRoundsUp(value) && <p>
              {{ total: '合計で切り上げ', each: '拾いごとに切り上げ', none: '切り上げない' }[value.link.rounding ?? 'total']}
            </p>}
            {value.link.kind === 'mass' && linkPreview.densityTPerM3 !== undefined && <p>
              質量の合計 ÷ {linkNumber(linkPreview.densityTPerM3)} t/㎥
              {value.link.densityTPerM3 === undefined && draftFixture.attributes?.wasteType
                && `（${draftFixture.attributes.wasteType}）`}
            </p>}
            {linkPreview.overridden && <p>計算値 {linkNumber(linkPreview.computed)}（手で上書きしています）</p>}
            {linkPreview.error && <p role="alert">{linkPreview.error}</p>}
            {linkPreview.warnings.map((warning, i) => <p role="status" key={i}>{warning}</p>)}
          </section>}
        </>}
      </details>
      <details className="fixture-convert" open={convertOpen} onToggle={event => setConvertOpen(event.currentTarget.open)}>
        <summary>数量の換算（塗装の㎡など）</summary>
        <fieldset className="fixture-convert-fields" disabled={!!value.link}>
        <label><input type="checkbox" aria-label="数量を換算する" checked={convertDraft.enabled}
          onChange={event => {
            const enabled = event.currentTarget.checked
            setConvertDraft(previous => ({ ...previous, enabled }))
            setError('')
          }} />数量を換算する</label>
        {convertDraft.enabled && <>
          <label>単位<select aria-label="換算後の単位" value={convertDraft.unit} onChange={event => {
            const unit = event.currentTarget.value as ConvertUnit
            setConvertDraft(previous => ({ ...previous, unit }))
            setError('')
          }}>
            {CONVERT_UNITS.map(unit => <option key={unit} value={unit}>{unit}</option>)}
          </select></label>
          <label>係数<input aria-label="換算の係数" inputMode="decimal" value={convertDraft.factor} onChange={event => {
            const factor = event.currentTarget.value
            setConvertDraft(previous => ({ ...previous, factor }))
            setError('')
          }} /></label>
          <label>根拠<input aria-label="換算の根拠" maxLength={60} value={convertDraft.basis} onChange={event => {
            const basis = event.currentTarget.value
            setConvertDraft(previous => ({ ...previous, basis }))
            setError('')
          }} /></label>
          <ConvertHelpers kind={quantityKind(value)} apply={(factor, basis) => {
            setConvertDraft(previous => ({ ...previous, factor: String(factor), basis, unit: '㎡' }))
            setError('')
          }} />
          <p>1 {quantityKind(value) === 'count' ? 'か所' : QUANTITY_UNITS[quantityKind(value)]} → {convertDraft.factor || '（係数）'} {convertDraft.unit}</p>
        </>}
        </fieldset>
      </details>
      {length ? <div className="quantity-preview"><QuantitySwatch fixture={value} preview /><span>{quantityLabel(quantityMethod(value) === 'polygon' || quantityMethod(value) === 'polygonDepth' ? [[0, 0], [8, 0], [8, 6], [0, 6]] : [[0, 0], [quantityMethod(value) === 'polyline' ? 9.35 : 24, 0]], 1000, { version: 1, id: 'preview', itemId: value.id, method: quantityMethod(value) as QuantityMark['method'], ...value.defaults, cond: value.routeDefaults, condition: value.defaultCondition }, fixtureLabelCode(value), value.style.showCode)}</span></div> : <svg className="fixture-preview" viewBox={`-18 -24 ${Math.max(80, 40 + value.style.size * (1 + .7 * fixtureCode(value).length))} 50`} aria-label="印の見本"><CountMarker style={value.style} code={fixtureCode(value)} /></svg>}
      {!length && <div className="fixture-sample-editor">
        {value.sample && <img className="fixture-sample-preview" src={`data:image/png;base64,${value.sample.png}`} width={value.sample.width} height={value.sample.height} alt="図面から切り取った見本" />}
        <div className="fixture-fields"><button type="button" disabled={!sampleInteraction} onClick={() => void capture()}>図面から見本を切り取る</button>
          <button type="button" disabled={!value.sample} onClick={() => setValue(v => ({ ...v, sample: undefined }))}>見本を外す</button></div>
      </div>
      }
      {!value.link && (!value.steel || concreteFixture || initialSection === 'rc') &&
        <details ref={rcSection} className="fixture-rc" open={rcOpen}
        onToggle={event => setRcOpen(event.currentTarget.open)}>
        <summary>RC 部材（コンクリート・型枠・鉄筋を計算する）</summary>
        {concreteFixture &&
          <p>配筋を入れると、異形鉄筋・型枠・ガス圧接などの連動の項目に数量が出ます。</p>}
        <label><input ref={rcCheckbox} type="checkbox" aria-label="RC 部材にする" checked={!!value.rc}
          disabled={allowedRcKinds.length === 0 && !value.rc}
          onChange={event => {
            const enabled = event.currentTarget.checked
            setValue(previous => {
              const next = { ...previous }
              const kind = defaultRcKind(previous, breakdownDraft.book === ''
                ? undefined
                : { item: breakdownDraft.item, middle: breakdownDraft.middle })
              if (enabled && kind) {
                next.rc = { kind, bars: [] }
                delete next.steel
              } else delete next.rc
              return next
            })
            setError('')
          }} />RC 部材にする</label>
        {allowedRcKinds.length === 0 &&
          <p>RC 部材は囲む・長さ×高さ・線・個数の拾い方で設定できます。</p>}
        {value.rc && <>
          {value.name.includes('基礎')
            && ['slab', 'beam', 'column', 'wall'].includes(value.rc.kind) &&
            <p role="status">名前が「基礎」です。部材の種類を基礎スラブ（基礎梁・独立基礎）にすると、型枠は側面（周長 × 厚さ）になり、型枠（基礎部）の連動の元になります。</p>}
          <RcMemberFields member={value.rc} allowedKinds={allowedRcKinds}
            usePickupDepth={quantityMethod(value) === 'polygonDepth'}
            usePickupLine={quantityMethod(value) === 'polyline'}
            onChange={rc => {
              setValue(previous => ({ ...previous, rc }))
              setError('')
            }} />
          <RcMemberPreview result={rcPreview.result} error={rcPreview.error} />
        </>}
      </details>}
      {!value.link && !value.rc && steelAllowed &&
        <details className="fixture-steel" open={steelOpen}
          onToggle={event => setSteelOpen(event.currentTarget.open)}>
          <summary>鉄骨の部材（質量・塗装・耐火被覆を計算する）</summary>
          <label><input type="checkbox" aria-label="鉄骨の部材にする"
            checked={!!value.steel} onChange={event => {
              const enabled = event.currentTarget.checked
              setValue(previous => {
                const next = { ...previous }
                if (enabled) {
                  next.steel = { section: H_SECTIONS[0].name }
                  delete next.rc
                } else delete next.steel
                return next
              })
              setCustomSteel(false)
              setError('')
            }} />鉄骨の部材にする</label>
          {value.steel && <>
            <SteelMemberFields member={value.steel} custom={customSteel}
              counted={quantityMethod(value) === 'click'}
              onCustomChange={setCustomSteel}
              onChange={steel => {
                setValue(previous => ({ ...previous, steel }))
                setError('')
              }} />
            <SteelMemberPreview result={steelPreview.result} error={steelPreview.error} />
          </>}
        </details>}
      {quantityKind(value) === 'count' && <fieldset>
        <legend>開口寸法（壁・塗装などの面積から差し引くとき）</legend>
        <div className="fixture-fields">
          <label>幅（m）<input aria-label="開口幅（m）" inputMode="decimal" value={openingWidth} onChange={e => { setOpeningWidth(e.currentTarget.value); setError('') }} /></label>
          <label>高さ（m）<input aria-label="開口高さ（m）" inputMode="decimal" value={openingHeight} onChange={e => { setOpeningHeight(e.currentTarget.value); setError('') }} /></label>
        </div>
        <p>どちらも空欄なら開口寸法なしです。</p>
      </fieldset>}
      {quantityMethod(value) === 'polyline' && <label>立上り・立下り（新しく拾うときの初期値）<input type="number" min="0" max="1000" step="0.01" value={value.defaults?.addM ?? 0} onChange={e => { const addM = Number(e.currentTarget.value); setValue(v => ({ ...v, defaults: { ...v.defaults, addM } })) }} /> m</label>}
      {quantityMethod(value) === 'polyline' && <>
        <label>その他の加算（初期値）<input title="図示されない付加長を、設計図書に指示がある場合だけ入れる。切り無駄・割増は入れない（単価に含まれる）" type="number" min="0" max="1000" step="0.01" value={value.defaults?.slackM ?? 0} onChange={e => { const slackM = Number(e.currentTarget.value); setValue(v => ({ ...v, defaults: { ...v.defaults, slackM: slackM || undefined } })) }} /> m</label>

      </>}
      <fieldset className="fixture-conditions"><legend>施工条件</legend>
        <div className="fixture-condition-add"><label>追加する施工条件<input aria-label="追加する施工条件" value={conditionInput} onChange={e => setConditionInput(e.currentTarget.value)} /></label><button type="button" onClick={() => { if (changeCandidates([...(value.conditions ?? []), conditionInput], [...conditionOrigins.current, undefined])) setConditionInput('') }}>追加</button></div>
        <ol>{(value.conditions ?? []).map((condition, i) => <li key={i}>
          <input aria-label={'施工条件の候補' + (i + 1)} value={conditionDrafts[i] ?? condition} onChange={e => { const text = e.currentTarget.value; setConditionDrafts(previous => previous.map((v, j) => j === i ? text : v)) }} />
          <button type="button" onClick={() => { const name = conditionDrafts[i]; changeCandidates(value.conditions!.map((v, j) => j === i ? name : v), [...conditionOrigins.current], [condition, name]) }}>名前の変更</button>
          <button type="button" onClick={() => changeCandidates(value.conditions!.filter((_, j) => j !== i), conditionOrigins.current.filter((_, j) => j !== i))}>削除</button>
          {([-1, 1] as const).map(delta => <button type="button" key={delta} disabled={i + delta < 0 || i + delta >= value.conditions!.length} onClick={() => { const next = [...value.conditions!], origins = [...conditionOrigins.current]; [next[i], next[i + delta]] = [next[i + delta], next[i]]; [origins[i], origins[i + delta]] = [origins[i + delta], origins[i]]; changeCandidates(next, origins) }}>{delta === -1 ? '上へ' : '下へ'}</button>)}
        </li>)}</ol>
        <button type="button" onClick={async () => {
          if (standardConditionsLoading.current) return
          standardConditionsLoading.current = true
          try {
            const [master, catalog] = await Promise.all([
              import('../core/quantityMaster'),
              import('../core/catalog'),
            ])
            if (!alive.current) return
            const current = currentValue.current
            const conditions = [...(current.conditions ?? [])]
            const additions = [...new Set([
              ...master.standardConditionsForFixture(current),
              ...catalog.catalogConditionsForFixture(current),
            ])].filter(condition => !conditions.includes(condition))
              .slice(0, Math.max(0, 30 - conditions.length))
            if (additions.length) {
              changeCandidates(
                [...conditions, ...additions],
                [...conditionOrigins.current, ...additions.map(() => undefined)],
              )
            } else setConditionError('')
          } catch {
            if (alive.current) setConditionError('標準の候補を読み込めませんでした。')
          } finally {
            standardConditionsLoading.current = false
          }
        }}>標準の候補を入れる</button>
        {quantityKind(value) === 'length' ? (['plan', 'rise', 'slack'] as const).map(part => <label key={part}>{{ plan: '平面', rise: '立上り・立下り', slack: 'その他の加算' }[part]}の既定<select aria-label={{ plan: '平面', rise: '立上り・立下り', slack: 'その他の加算' }[part] + 'の既定'} value={Array.isArray(value.routeDefaults?.[part]) ? 'per-rise' : value.routeDefaults?.[part] === null ? 'excluded' : typeof value.routeDefaults?.[part] === 'string' ? 'condition:' + value.routeDefaults[part] : 'unset'} onChange={e => { const selected = e.currentTarget.value; setValue(v => ({ ...v, routeDefaults: normalizeRouteConditions({ ...v.routeDefaults, [part]: selected === 'unset' ? undefined : selected === 'excluded' ? null : selected.slice(10) }) })) }}>
          <option value="unset">未設定</option>{Array.isArray(value.routeDefaults?.[part]) && <option value="per-rise" disabled>立上りごとの既定（保存済み）</option>}{(value.conditions ?? []).map(c => <option key={c} value={'condition:' + c}>{c}</option>)}<option value="excluded">数えない</option>
        </select></label>) : <label>既定の施工条件<select aria-label="既定の施工条件" value={value.defaultCondition ?? ''} onChange={e => { const selected = e.currentTarget.value; setValue(v => ({ ...v, defaultCondition: selected || undefined })) }}><option value="">未設定</option>{(value.conditions ?? []).map(c => <option key={c} value={c}>{c}</option>)}</select></label>}
        {conditionError && <p role="alert">{conditionError}</p>}
      </fieldset>
      {quantityDimensions(quantityMethod(value)).map(key => <label key={key}>{QUANTITY_DIMENSIONS[key]}（新しく拾うときの初期値）<span className="quantity-input-unit"><input aria-label={QUANTITY_DIMENSIONS[key] + '（新しく拾うときの初期値）'} type="number" min="0" max="1000" step="0.01" value={value.defaults?.[key] ?? ''} onChange={e => { const text = e.currentTarget.value; setValue(v => ({ ...v, defaults: { ...v.defaults, [key]: text === '' ? undefined : Number(text) } })) }} />m</span></label>)}
      {quantityDimensions(quantityMethod(value)).length > 0 && <p>空欄または0なら、拾うときに寸法を入力します。</p>}
      {quantityMethod(value) === 'lengthWidthDepth' && <fieldset>
        <legend>埋戻し</legend>
        <label><input type="checkbox"
          aria-label="埋戻し: 同じ経路の管の体積を引く"
          checked={backfillEnabled}
          onChange={event => {
            setBackfillEnabled(event.currentTarget.checked)
            setError('')
          }} />埋戻し: 同じ経路の管の体積を引く</label>
        {backfillEnabled && <>
          <label>引く管の施工条件（含む語）<input
            aria-label="引く管の施工条件（含む語）"
            value={backfillConditions} placeholder="埋設"
            onChange={event => {
              setBackfillConditions(event.currentTarget.value)
              setError('')
            }} /></label>
          <p>読点で区切って1〜5語、各20字以内で入れてください。経路の線要素として使うとき、平面の条件が合う管だけを引きます。</p>
        </>}
      </fieldset>}
      {!!collisions.length && <p role="status">同じ見た目の項目があります: {collisions.map(f => `${fixtureCode(f)} ${f.name}`.trim()).join('、')}</p>}
      {error && <p role="alert">{error}</p>}
      </div>
      <div className="fixture-dialog-appearance">
      <button type="button" title="線の色・線種・線幅の組合せを提案します（経路に載せる項目の組合せは「よく使う構成」）" onClick={() => {
        try {
          if (length) {
            const current = { color: value.style.color, line: quantityLine(value) }
            const proposed = nextQuantityLineStyle(fixtures.filter(f => f.id !== value.id), [...lineSuggestions.current, current, ...(editing && quantityKind(initial) !== 'count' ? [{ color: initial.style.color, line: quantityLine(initial) }] : [])])
            lineSuggestions.current.push(current, proposed)
            setValue(v => ({ ...v, style: { ...v.style, color: proposed.color }, line: proposed.line }))
          } else {
            const proposed = nextCountStyle(fixtures, [...suggestions.current, value.style, ...(editing ? [initial.style] : [])])
            suggestions.current.push(value.style, proposed)
            style({ shape: proposed.shape, fill: proposed.fill, color: proposed.color })
          }
          setError('')
        } catch (reason) { setError(String(reason)) }
      }}>別の組合せを提案</button>
      {!length && <>
      <fieldset><legend>形</legend><div className="fixture-shapes">{COUNT_SHAPES.map((shape, i) => <button type="button" key={shape} title={shapeNames[i]} aria-label={`形 ${shapeNames[i]}`} aria-pressed={value.style.shape === shape} onClick={() => style({ shape })}>
        <svg viewBox="-14 -14 28 28" aria-hidden="true"><CountMarker style={{ ...value.style, shape, fill: 'none', size: 20, opacity: 1, showCode: false }} /></svg>
      </button>)}</div></fieldset>
      <fieldset><legend>塗り</legend><div className="fixture-shapes fixture-fills">{COUNT_FILLS.map((fill, i) => <button type="button" key={fill} title={fillNames[i]} aria-label={`塗り ${fillNames[i]}`} aria-pressed={value.style.fill === fill} onClick={() => style({ fill })}>
        <svg viewBox="-14 -14 28 28" aria-hidden="true"><CountMarker style={{ ...value.style, fill, size: 20, opacity: 1, showCode: false }} /></svg>
      </button>)}</div></fieldset>
      </>}
      {length && <><fieldset><legend>線の種類</legend><div className="fixture-shapes">{QUANTITY_DASHES.map((dash, i) => <button key={dash} type="button" aria-label={['実線', '破線', '一点鎖線', '点線'][i]} aria-pressed={quantityLine(value).dash === dash} onClick={() => line({ dash })}><QuantitySwatch fixture={{ ...value, line: { ...quantityLine(value), dash } }} /></button>)}</div></fieldset>
      <label>線の太さ<select aria-label="線の太さ" value={quantityLine(value).width} onChange={e => line({ width: Number(e.currentTarget.value) as QuantityLineStyle['width'] })}>{QUANTITY_LINE_WIDTHS.map(n => <option key={n} value={n}>{n} pt</option>)}</select></label></>}
      <fieldset><legend>色</legend><div className="fixture-colors">{COUNT_COLORS.map(hex => <button type="button" key={hex} aria-label={`色 ${hex}`} title={hex} aria-pressed={countHex(value.style.color) === hex} style={{ backgroundColor: hex }} onClick={() => style({ color: countRgb(hex) })} />)}</div>
        <label>任意の色<input type="color" value={countHex(value.style.color)} onChange={e => style({ color: countRgb(e.currentTarget.value) })} /></label>
      </fieldset>
      </div>
      </div>
      {dimensionCounts.matched > 0 && <div className="fixture-dimension-update">
        <label><input type="checkbox"
          checked={applyDimensions}
          onChange={event => setApplyDimensions(event.currentTarget.checked)}
        />{`既存の拾い ${dimensionCounts.matched} 件の幅・深さ・高さも新しい値にする`}</label>
        {dimensionCounts.customized > 0 &&
          <p>{`個別に入れた ${dimensionCounts.customized} 件は変えません`}</p>}
      </div>}
      <div className="dialog-actions"><button type="button" onClick={onClose}>閉じる</button><button disabled={!value.category.trim()} type="submit">{editing ? '変更する' : '追加する'}</button></div>
    </form>
  </dialog>
}
