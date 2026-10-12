import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { fixtureCode, quantityAggregation, quantityDecimals, quantityKind, quantityUnit, type CountFixture } from '../core/countFixtures'
import type { DrawingInfo } from '../core/drawingInfo'
import type { Rect } from '../core/annotations'
import { countFixtureId } from '../core/counts'
import { compareFloors, quantityPartSummary, type QuantityEntry, type QuantityIndex } from '../core/quantityIndex'
import type { DocumentSession } from './documentModel'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import { nextReview, refreshReview, reviewOrder, type ReviewCursor } from './reviewCursor'
import { fixtureLinkRoundsUp, fixtureLinkSourceUnit, fixtureLinkSourceShowsFactor, fixtureLinkBasisNumber } from '../core/fixtureLink'
import { backfillDetail, backfillSummary } from '../core/backfill'

function basisNumber(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toFixed(6))) : '—'
}

export const QuantityNavigationContext = createContext<{
  navigate(pageIndex: number, rect?: Rect): void
  drawingInfo(pageIndex: number): DrawingInfo | null
} | null>(null)

// UI requests only; none of these are document data.
export const QuantityTableContext = createContext<{
  open(): void
  showBreakdown(id: string): void
  showCsv(): void
  bindPanel(actions: { breakdown(id: string): void; csv(): void }): () => void
} | null>(null)

export async function revealPickup(session: DocumentSession, pool: PdfWorkerPool, itemId: string,
  annotationId: string, pageIndex: number, navigate: (page: number, rect?: Rect) => void,
  current: () => boolean = () => true): Promise<boolean> {
  const revision = session.pageRevision, store = session.annotationStore
  await store.ensurePageLoaded(pageIndex, () => pool.listAnnotations(session.docId, pageIndex))
  if (!current() || revision !== session.pageRevision) return false
  const mark = store.get(annotationId)
  if (!mark || mark.pageIndex !== pageIndex) return false
  const pickupItemId = store.getCountFixture(itemId)?.link
    ? mark.quantity?.itemId ?? (mark.count ? countFixtureId(mark.count) : undefined) : itemId
  if (!pickupItemId || store.getCountFixture(pickupItemId)?.link) return false
  store.selectFixture(pickupItemId); store.setFixtureVisible([pickupItemId], true)
  store.selectOnly(mark.id)
  navigate(pageIndex, mark.rect)
  store.flashPickup(mark.id)
  return true
}

export default function QuantityBreakdown({ fixture, index, session, pool, onClose }: {
  fixture: CountFixture; index: QuantityIndex; session: DocumentSession; pool: PdfWorkerPool; onClose(): void
}) {
  const navigation = useContext(QuantityNavigationContext)
  const [mode, setMode] = useState<'page' | 'location' | 'condition'>(quantityAggregation(fixture) === 'location' ? 'location' : 'page')
  const [location, setLocation] = useState<{ floor: string; room?: string } | null>(null)
  const [condition, setCondition] = useState<string | null>(null)
  const [cursor, setCursor] = useState<(ReviewCursor & { page: number }) | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const close = useRef<HTMLButtonElement>(null), alive = useRef(true)
  useEffect(() => {
    alive.current = true; close.current?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || document.querySelector('dialog[open], [role="dialog"], [role="menu"]')) return
      e.preventDefault(); e.stopImmediatePropagation(); onClose()
    }
    window.addEventListener('keydown', key, true)
    return () => { alive.current = false; window.removeEventListener('keydown', key, true) }
  }, [onClose])
  const entries = useMemo(() => index.entries(fixture.id), [index, fixture.id])
  const filtered = useMemo(() => condition !== null ? entries.filter(e => (e.condition ?? '') === condition)
    : location ? entries.filter(e => (e.floor ?? '') === location.floor && (location.room === undefined || (e.room ?? '') === location.room)) : entries, [entries, location, condition])
  const pages = useMemo(() => {
    const result = new Map<number, QuantityEntry[]>()
    for (const e of filtered) { const list = result.get(e.pageIndex) ?? []; list.push(e); result.set(e.pageIndex, list) }
    return [...result].sort((a, b) => a[0] - b[0])
  }, [filtered])
  useEffect(() => {
    setCursor(previous => {
      if (!previous) return previous
      const list = pages.find(([page]) => page === previous.page)?.[1] ?? []
      return { ...refreshReview(reviewOrder(list, id => session.annotationStore.get(id)), previous), page: previous.page }
    })
  }, [pages, session])
  const floors = useMemo(() => [...index.byFloorRoom(fixture.id)].sort((a, b) => compareFloors(a[0], b[0])), [index, fixture.id])
  const conditions = useMemo(() => [...index.byCondition(fixture.id)], [index, fixture.id])
  const format = (n: number) => `${quantityDecimals(fixture) === 0 ? n : n.toFixed(2)} ${quantityUnit(fixture)}`
  const linkResult = fixture.link ? index.linkResult(fixture.id) : undefined
  const go = async (pageIndex: number, list: readonly QuantityEntry[]) => {
    setBusy(true); setError('')
    try {
      const revision = session.pageRevision
      await session.annotationStore.ensurePageLoaded(pageIndex, () => pool.listAnnotations(session.docId, pageIndex))
      if (!alive.current || revision !== session.pageRevision) return
      const store = session.annotationStore
      const next = nextReview(reviewOrder(list, id => store.get(id)), cursor?.page === pageIndex ? cursor : null)
      if (!next) return
      const mark = store.get(next.id)
      if (mark && await revealPickup(session, pool, fixture.id, mark.id, pageIndex,
        (page, rect) => navigation?.navigate(page, rect), () => alive.current)) setCursor({ ...next, page: pageIndex })
    } catch (e) { if (alive.current) setError(String(e)) }
    finally { if (alive.current) setBusy(false) }
  }
  const filterLocation = (floor: string, room?: string) => { setCondition(null); setLocation({ floor, ...(room === undefined ? {} : { room }) }); setMode('page'); setCursor(null) }
  const changeMode = (value: typeof mode) => { setMode(value); setLocation(null); setCondition(null); setCursor(null) }
  return <section className="quantity-breakdown" aria-label={`${fixtureCode(fixture)} ${fixture.name}の内訳`} data-testid="quantity-breakdown">
    <div className="quantity-breakdown-heading"><strong>{fixtureCode(fixture)} {fixture.name}</strong><button ref={close} onClick={onClose}>閉じる</button></div>
    <p>全図面 {format(index.total(fixture.id))}</p>
    {filtered.some(entry => entry.backfill !== undefined) &&
      <section className="quantity-link-basis" aria-label="埋戻しの計算の根拠">
        <h3>埋戻しの計算の根拠</h3>
        <ul>{filtered.filter(entry => entry.backfill !== undefined).map(entry =>
          <li key={`${entry.annotationId}:${entry.part ?? ''}`}>
            p.{entry.pageIndex + 1}: {backfillDetail(entry.backfill!)}
            <small>（{backfillSummary(entry.backfill!)}）</small>
            {fixture.convert &&
              <small>（換算後 {format(entry.value)}）</small>}
            {entry.backfill!.warnings.map((warning, i) =>
              <p role="status" key={i}>{warning}</p>)}
          </li>)}</ul>
      </section>}
    {fixture.link && linkResult && <section className="quantity-link-basis" aria-label="計算の根拠">
      <h3>計算の根拠</h3>
      <ul>{linkResult.sources.map((source, i) => {
        const original = session.annotationStore.getCountFixture(source.itemId)
        return <li key={`${source.itemId}-${i}`}>
          {original ? `${fixtureCode(original)} ${original.name}` : source.itemId}
          {source.auto && '（自動）'}{'　'}
          {fixtureLinkBasisNumber(fixture, source.quantity)}{fixtureLinkSourceUnit(fixture, original)}
          {fixture.link!.kind === 'carry' ? <>
            {' × 質量 '}{source.unitMassKg === undefined ? '未設定' : basisNumber(source.unitMassKg)}kg
            {' × 補正率 '}{source.factor === undefined ? '適用なし' : basisNumber(source.factor)}
            {' ÷ 1000'}
            {source.factor !== undefined && `（${fixture.link!.carry?.class === 'bulky' ? '容積品' : '重量品'}）`}
          </> : fixture.link!.kind === 'mass' ? <>
            {source.perM !== undefined
              ? ` ÷ ${basisNumber(source.perM)} m`
              : source.factor !== undefined && source.factor !== 1 ? ` × ${basisNumber(source.factor)}` : ''}
            {' × '}{source.unitMassKg === undefined ? '未設定' : basisNumber(source.unitMassKg)} kg ÷ 1000
            {linkResult.densityTPerM3 !== undefined && ` ÷ ${basisNumber(linkResult.densityTPerM3)} t/㎥`}
          </> : source.perM !== undefined
            ? ` ÷ ${basisNumber(source.perM)} m`
            : fixtureLinkSourceShowsFactor(fixture, source)
              ? ` × ${basisNumber(source.factor ?? 1)}` : ''}
          {' ＝ '}{fixtureLinkBasisNumber(fixture, source.subtotal)} {quantityUnit(fixture)}
          {source.note && `（${source.note}）`}
        </li>
      })}</ul>
      <p className="quantity-link-basis-total">合計 {format(linkResult.computed)}
        {fixture.link.kind === 'mass' && linkResult.densityTPerM3 !== undefined
          && `、質量の合計 ÷ ${basisNumber(linkResult.densityTPerM3)} t/㎥${
            fixture.link.densityTPerM3 === undefined && fixture.attributes?.wasteType
              ? `（${fixture.attributes.wasteType}）` : ''
          }`}
        {fixtureLinkRoundsUp(fixture) && `（${{
          total: '合計で切り上げ', each: '拾いごとに切り上げ', none: '切り上げない',
        }[fixture.link.rounding ?? 'total']}）`}
      </p>
      {linkResult.overridden && <>
        <p>上書き {format(linkResult.total)}（計算値 {basisNumber(linkResult.computed)}、差 {linkResult.total - linkResult.computed >= 0 ? '+' : ''}{basisNumber(linkResult.total - linkResult.computed)}）</p>
        {fixture.link.override?.note && <p>理由: {fixture.link.override.note}</p>}
      </>}
      {linkResult.error && <p role="alert">{linkResult.error}</p>}
      {linkResult.warnings.map((warning, i) => <p role="status" key={i}>{warning}</p>)}
    </section>}
    <div className="quantity-breakdown-tabs">
      <button aria-pressed={mode === 'page'} onClick={() => changeMode('page')}>ページ別</button>
      <button aria-pressed={mode === 'location'} onClick={() => changeMode('location')}>階・部屋別</button>
      <button aria-pressed={mode === 'condition'} onClick={() => changeMode('condition')}>施工条件別</button>
    </div>
    {mode === 'page' ? <>
      {location && <p>{location.floor || '（階なし）'}{location.room !== undefined && ` ／ ${location.room || '（部屋なし）'}`}<button onClick={() => { setLocation(null); setCursor(null) }}>絞り込みを解除</button></p>}
      {condition !== null && <p>施工条件: {condition || '未設定'}<button onClick={() => { setCondition(null); setCursor(null) }}>絞り込みを解除</button></p>}
      <div className="quantity-breakdown-list">{pages.map(([page, list]) => {
        const info = session.annotationStore.getDrawingInfo(page)
        return <button key={page} className="quantity-breakdown-page" disabled={busy} data-page-index={page} onClick={() => void go(page, list)}>
          <span>{info?.number || `p.${page + 1}`}</span><span>{info?.number ? info.name ?? '' : ''}</span>
          <span>{format(list.reduce((n, e) => n + e.value, 0))}</span><small>{cursor?.page === page ? `${cursor.position} / ${cursor.count}` : ''}</small>
        </button>
      })}</div>
      <p className="quantity-breakdown-total">合計 {format(filtered.reduce((n, e) => n + e.value, 0))}</p>
    </> : mode === 'condition' ? <div className="quantity-breakdown-list">{conditions.map(([key, total]) => <button key={key}
      className="quantity-breakdown-condition quantity-breakdown-floor" data-condition={key} style={{ color: key === '' && fixture.conditions?.length ? '#a34b00' : undefined }}
      onClick={() => { setCondition(key); setLocation(null); setMode('page'); setCursor(null) }}>
      <span>{key || '未設定'} {format(total.total)}</span>
      {quantityKind(fixture) === 'length' && <small style={{ display: 'block', fontWeight: 'normal' }}>{quantityPartSummary(total, true, fixture.convert ? quantityDecimals(fixture) : 1)}</small>}
    </button>)}</div> : <div className="quantity-breakdown-list">{floors.map(([floor, rooms]) => <div key={floor}>
      <button className="quantity-breakdown-floor" onClick={() => filterLocation(floor)}>{floor || '（階なし）'} {format([...rooms.values()].reduce((a, b) => a + b, 0))}</button>
      {[...rooms].sort((a, b) => a[0].localeCompare(b[0], 'ja')).map(([room, value]) => <button className="quantity-breakdown-room" key={room} onClick={() => filterLocation(floor, room)}>{room || '（部屋なし）'} {format(value)}</button>)}
    </div>)}</div>}
    {error && <p role="alert">{error}</p>}
  </section>
}
