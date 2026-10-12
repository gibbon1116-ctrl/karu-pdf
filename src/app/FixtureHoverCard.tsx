import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { quantityUnit, type CountFixture } from '../core/countFixtures'
import type { FixtureLink } from '../core/fixtureLink'
import { linkSourceLabel, type FixtureLinkRelations } from './linkRelations'

export type FixtureHoverAnchor = Pick<DOMRectReadOnly, 'right' | 'top'>

export interface FixtureHoverState {
  fixture: CountFixture
  anchorRect: FixtureHoverAnchor
}

export function useFixtureHover() {
  const [hover, setHover] = useState<FixtureHoverState | null>(null)
  const hide = useCallback(() => setHover(null), [])
  const show = useCallback((fixture: CountFixture, rect: FixtureHoverAnchor) => {
    setHover({
      fixture,
      anchorRect: { right: rect.right, top: rect.top },
    })
  }, [])
  const active = hover !== null

  useEffect(() => {
    if (!active) return
    // Capture scrolling from any ancestor, including picker result containers.
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    window.addEventListener('pointerdown', hide, true)
    window.addEventListener('keydown', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      window.removeEventListener('pointerdown', hide, true)
      window.removeEventListener('keydown', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [active, hide])

  return { hover, setHover, show, hide }
}

function linkDescription(link: FixtureLink): string {
  switch (link.kind) {
    case 'factor': return '係数で計算する'
    case 'mass': return '質量に換算する'
    case 'carry': return '機器搬入・搬出'
    case 'crossing': return '交差から'
    case 'rc': {
      if (!link.rc) return 'RC 部材から'
      const output = {
        concrete: 'コンクリート',
        formwork: '型枠',
        rebar: '鉄筋',
        gasJoint: 'ガス圧接',
        lapJoint: '重ね継手',
      }[link.rc.output]
      const basis = link.rc.output === 'rebar'
        ? `・${link.rc.basis === 'required' ? '所要数量' : '設計数量'}`
        : ''
      return `RC 部材から（${output}${basis}）`
    }
    case 'shape': {
      if (!link.shape) return '形から'
      const output = {
        area: '面積',
        perimeter: '周長',
        lengthTimesHeight: '長さ×高さ',
        excavation: '根切り',
      }[link.shape.output]
      return `形から（${output}）`
    }
    case 'steel': {
      if (!link.steel) return '鉄骨の部材から'
      const output = {
        mass: '質量',
        paint: '塗装面積',
        fireproof: '耐火被覆面積',
      }[link.steel.output]
      const basis = link.steel.output === 'mass'
        ? `・${link.steel.basis === 'required' ? '所要数量' : '設計数量'}`
        : ''
      return `鉄骨の部材から（${output}${basis}）`
    }
  }
}

export default function FixtureHoverCard({ fixture: f, fixtures, anchorRect, relations }: {
  fixture: CountFixture
  fixtures: readonly CountFixture[]
  anchorRect: FixtureHoverAnchor
  relations: FixtureLinkRelations
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState(() => ({
    left: Math.max(8, Math.min(window.innerWidth - 376, anchorRect.right + 8)),
    top: Math.max(8, anchorRect.top),
  }))
  const nameCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const fixture of fixtures) {
      counts.set(fixture.name, (counts.get(fixture.name) ?? 0) + 1)
    }
    return counts
  }, [fixtures])

  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card) return
    const rect = card.getBoundingClientRect()
    const left = Math.max(8, Math.min(anchorRect.right + 8, window.innerWidth - rect.width - 8))
    const top = Math.max(8, Math.min(anchorRect.top, window.innerHeight - rect.height - 8))
    setPosition(previous => previous.left === left && previous.top === top
      ? previous : { left, top })
  }, [anchorRect, f, fixtures, relations])

  const emphasized = (nameCounts.get(f.name) ?? 0) >= 2
  const spec = f.spec?.trim() ?? ''
  const summary = f.summary
    ?.filter(field => field.value.trim().length > 0)
    .map(field => [field.label.trim(), field.value.trim()].filter(Boolean).join(' '))
    .join('、') ?? ''
  const breakdown = f.breakdown
    ? [f.breakdown.section, f.breakdown.subject, f.breakdown.middle, f.breakdown.item]
      .filter(value => value?.trim()).join(' › ')
    : ''
  const remark = f.remark?.trim() ?? ''
  const name = [f.code, f.name].filter(value => value.trim()).join(' ')
  const sources = relations.sources.get(f.id) ?? []
  const dependents = relations.dependents.get(f.id) ?? []
  const missingSources = f.link !== undefined
    && ['rc', 'shape', 'steel', 'crossing'].includes(f.link.kind)
    && sources.length === 0

  // Keep fixed positioning outside scrolling/overflowing picker containers.
  return createPortal(
    <div ref={cardRef} className="fixture-hover-card" role="tooltip"
      style={position}>
      <div className="fixture-hover-line"><strong>{name}</strong></div>
      {spec && <div className="fixture-hover-line">
        {emphasized
          ? <strong className="fixture-hover-emphasis">規格: {spec}</strong>
          : `規格: ${spec}`}
      </div>}
      {summary && <div className="fixture-hover-line">
        {emphasized
          ? <strong className="fixture-hover-emphasis">摘要: {summary}</strong>
          : `摘要: ${summary}`}
      </div>}
      {breakdown && <div className="fixture-hover-line">内訳書: {breakdown}</div>}
      <div className="fixture-hover-line">単位: {quantityUnit(f)}、分類: {f.category}</div>
      {remark && <div className="fixture-hover-line">備考: {remark}</div>}
      {f.link && <div className="fixture-hover-line">
        連動: {linkDescription(f.link)}{missingSources && <span>　元なし</span>}
      </div>}
      {sources.slice(0, 8).map((source, index) =>
        <div key={`${source.id}-${index}`} className="fixture-hover-line">
          元: {linkSourceLabel(source)}
        </div>,
      )}
      {sources.length > 8 && <div className="fixture-hover-line">ほか {sources.length - 8} 件</div>}
      {dependents.slice(0, 8).map(dependent =>
        <div key={dependent.id} className="fixture-hover-line">
          連動先: {[dependent.code, dependent.name].filter(Boolean).join(' ')}
        </div>,
      )}
      {dependents.length > 8 && <div className="fixture-hover-line">ほか {dependents.length - 8} 件</div>}
      {f.sample && <img className="fixture-hover-sample"
        src={`data:image/png;base64,${f.sample.png}`} alt={`${f.name}の見本（拡大）`} />}
    </div>,
    document.body,
  )
}
