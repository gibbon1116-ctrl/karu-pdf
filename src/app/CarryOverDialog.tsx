import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import type { Point } from '../core/annotations'
import {
  carryOverTransform, fillCarryOverByOrder, hasCarryOverPageContents, isPagePickup, matchCarryOverPages,
  pickupUsesLinkedFixture, planCarryOverPages, transformCarryOverPoint,
  type CarryOverInclude, type CarryOverMatch, type CarryOverPageInfo, type CarryOverSourcePage,
} from '../core/carryOver'
import type { CountFixture } from '../core/countFixtures'
import { pickupPoint, translateRoomRegion, type RoomRegion, type RoomSet } from '../core/rooms'
import type { CarryOverResult, EditableAnnotation } from '../editor/AnnotationStore'
import type { DocumentSession } from './documentModel'

const categories = [
  ['fixtures', '項目（数量拾いの一覧）'],
  ['pickups', '拾った印・長さ・面積・体積'],
  ['rooms', '部屋の範囲と部屋の組'],
  ['scales', '縮尺'],
] as const
const reasons = { name: '図面名称', number: '図面番号', order: 'ページ順', manual: '手で選択' }
const subscribeNone = () => () => {}
const emptyScan = () => ''
const noMatches: CarryOverMatch[] = []

interface LoadedSource {
  old: DocumentSession
  oldRevision: number
  newRevision: number
  fixtures: CountFixture[]
  oldPages: Map<number, CarryOverSourcePage<EditableAnnotation>>
  newPages: CarryOverPageInfo[]
  roomSets: RoomSet[]
}

function pageInfos(session: DocumentSession): CarryOverPageInfo[] {
  return session.pageSizes.map(({ width, height }, pageIndex) => {
    const info = session.annotationStore.getDrawingInfo(pageIndex)
    return { pageIndex, width, height, number: info?.number, name: info?.name }
  })
}

function pageLabel(page: CarryOverPageInfo): string {
  return [`p.${page.pageIndex + 1}`, page.number, page.name].filter(Boolean).join(' ')
}

function loadAnnotations(session: DocumentSession, pool: PdfWorkerPool, active: () => boolean) {
  const loads: Promise<void>[] = []
  let streaming = true
  const task = pool.listAllAnnotations(session.docId, response => {
    if (active() && response.pageIndex >= 0) {
      const load = session.annotationStore.ensurePageLoaded(response.pageIndex, () => Promise.resolve(response.annotations))
      loads.push(load)
      void load.catch(() => {})
    }
  })
  return {
    cancel: () => {
      if (!streaming) return
      streaming = false
      task.cancel()
    },
    promise: task.promise.finally(() => { streaming = false }).then(async summary => {
      if (!active()) return
      if (summary.cancelled || summary.processedPages !== summary.totalPages) throw new Error('書き込みの読み込みが中断されました。')
      await Promise.all(loads)
    }),
  }
}

function PagePreview({ session, page, pool, label, rooms, points, factor }: {
  session: DocumentSession
  page: CarryOverPageInfo
  pool: PdfWorkerPool
  label: string
  rooms: RoomRegion[]
  points: Point[]
  factor: number
}) {
  const image = useRef<HTMLDivElement>(null)
  const id = useId()
  const [pending, setPending] = useState('図面画像を読み込んでいます…')
  const { pageIndex, width, height } = page
  useEffect(() => {
    const surface = image.current
    if (!surface) return
    let active = true
    setPending('図面画像を読み込んでいます…')
    // The pool converts its ImageBitmap to a canvas and closes the bitmap.
    const task = pool.renderRegionImage(session.docId, pageIndex, [0, 0, width, height], 480)
    void task.promise.then(canvas => {
      if (!active) return
      surface.replaceChildren(canvas)
      setPending('')
    }).catch(() => { if (active) setPending('図面画像を表示できませんでした。') })
    return () => { active = false; task.cancel(); surface.replaceChildren() }
  }, [session, session.pageRevision, pageIndex, width, height, pool])

  const transform = { factor }
  const project = (point: Point) => transformCarryOverPoint(point, transform)
  const outline = (polygon: Point[]) => `M${polygon.map(point => project(point).join(',')).join(' ')}Z`
  const radius = Math.max(width, height) / 150

  return <figure className="carry-over-preview">
    <figcaption><strong>{label}</strong> {pageLabel(page)}</figcaption>
    <div className="carry-over-preview-sheet" style={{ aspectRatio: `${width} / ${height}` }}>
      <div className="carry-over-preview-image" ref={image} />
      {pending ? <small role="status">{pending}</small> : <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        {rooms.map((room, index) => {
          const path = outline(room.points), holes = (room.holes ?? []).map(outline)
          const mask = `${id}-${index}`
          return <g key={room.id} className="carry-over-preview-room">
            {holes.length > 0 && <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width={width} height={height}>
              <path d={path} fill="white" fillRule="evenodd" />
              {holes.map((hole, i) => <path key={i} d={hole} fill="black" fillRule="evenodd" />)}
            </mask>}
            <path d={path} fill="#007cbb" fillOpacity=".22" fillRule="evenodd"
              mask={holes.length ? `url(#${mask})` : undefined} />
            <path d={[path, ...holes].join(' ')} fill="none" stroke="#005580" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          </g>
        })}
        {points.map((point, i) => {
          const [x, y] = project(point)
          return <circle key={i} cx={x} cy={y} r={radius} fill="#df5a19" stroke="white" strokeWidth=".7" vectorEffect="non-scaling-stroke" />
        })}
      </svg>}
    </div>
  </figure>
}

function sourceRooms(page: CarryOverSourcePage<EditableAnnotation>, sets: readonly RoomSet[]): RoomRegion[] {
  const link = page.roomSetLink
  const set = link && sets.find(item => item.id === link.id)
  return [...page.roomRegions, ...(set?.regions.map(region => translateRoomRegion(region, link?.dx, link?.dy)) ?? [])]
}

export default function CarryOverDialog({ session, documents, pool, onClose }: {
  session: DocumentSession
  documents: readonly DocumentSession[]
  pool: PdfWorkerPool
  onClose(): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useId(), store = session.annotationStore
  const [oldId, setOldId] = useState(() => documents.length === 1 ? documents[0].docId : '')
  const old = documents.find(document => document.docId === oldId && document !== session)
  const [data, setData] = useState<LoadedSource | null>(null)
  const [include, setInclude] = useState<CarryOverInclude>({ fixtures: true, pickups: true, rooms: true, scales: true })
  const [overrides, setOverrides] = useState(new Map<number, CarryOverMatch>())
  const [view, setView] = useState<{ oldPage: number; candidate?: number } | null>(null)
  const [result, setResult] = useState<CarryOverResult | null>(null)
  const [error, setError] = useState('')
  const oldScan = useSyncExternalStore(old?.subscribeDrawingScan ?? subscribeNone, old?.getDrawingScanSnapshot ?? emptyScan)
  const newScan = useSyncExternalStore(session.subscribeDrawingScan, session.getDrawingScanSnapshot)
  const version = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const oldRevision = old?.pageRevision, newRevision = session.pageRevision
  const ready = data && data.old === old && data.oldRevision === oldRevision && data.newRevision === newRevision ? data : null

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  useEffect(() => {
    setData(null)
    setView(null)
    setOverrides(new Map())
    setError('')
    if (!old || oldRevision === undefined) return
    let active = true
    const sourceStore = old.annotationStore
    const source = loadAnnotations(old, pool, () => active)
    const target = loadAnnotations(session, pool, () => active)
    const readFixtures = sourceStore.fixturesReady
      ? Promise.resolve(sourceStore.getCountFixtures()) : pool.getCountFixtures(old.docId)
    void Promise.all([readFixtures, source.promise, target.promise, old.scanDrawingInfos(pool), session.scanDrawingInfos(pool)])
      .then(([fixtures]) => {
        if (!active) return
        const fixtureById = new Map(fixtures.map(fixture => [fixture.id, fixture]))
        const oldPages = new Map(pageInfos(old).map(page => {
          const pageIndex = page.pageIndex
          const pickups = sourceStore.getPageAnnotationsSnapshot(pageIndex).filter(annotation =>
            isPagePickup(annotation) && !pickupUsesLinkedFixture(annotation, id => fixtureById.get(id)))
          return [pageIndex, {
            ...page, pickups, roomRegions: sourceStore.getRoomRegions(pageIndex),
            roomSetLink: sourceStore.getPageRoomSetLink(pageIndex), scale: sourceStore.getScale(pageIndex),
            scaleRegions: sourceStore.getScaleRegions(pageIndex),
          }] as const
        }))
        setData({ old, oldRevision, newRevision, fixtures, oldPages, newPages: pageInfos(session), roomSets: sourceStore.getRoomSets() })
      })
      .catch(reason => {
        if (!active) return
        active = false
        source.cancel()
        target.cancel()
        setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => { active = false; source.cancel(); target.cancel() }
  }, [old, oldRevision, newRevision, pool, session])

  const automatic = useMemo(() => ready ? matchCarryOverPages(
    [...ready.oldPages.values()].filter(page => hasCarryOverPageContents(page, include)), ready.newPages,
  ) : noMatches, [ready, include])
  const matches = automatic.map(match => overrides.get(match.oldPage) ?? match)
  const pickedTargets = new Map<number, number>()
  for (const { newPage } of matches) {
    if (newPage !== null) pickedTargets.set(newPage, (pickedTargets.get(newPage) ?? 0) + 1)
  }
  const matched = matches.filter(match => match.newPage !== null).length
  const duplicate = [...pickedTargets.values()].some(count => count > 1)
  const fixturesOnly = !matches.length && include.fixtures && !!ready?.fixtures.length
  const canApply = !!ready && (matched > 0 || fixturesOnly) && !duplicate && !session.editRestriction && !result
  const counts = useMemo(() => ready?.newPages.map(({ pageIndex }) =>
    store.getPageAnnotationsSnapshot(pageIndex).filter(isPagePickup).length) ?? [], [ready, store, version])

  const selected = view && matches.find(match => match.oldPage === view.oldPage)
  const oldPage = selected ? ready?.oldPages.get(selected.oldPage) : undefined
  const candidate = oldPage && ready?.newPages.length
    ? view?.candidate ?? selected?.newPage ?? Math.min(oldPage.pageIndex, ready.newPages.length - 1) : undefined
  const newPage = candidate === undefined ? undefined : ready?.newPages[candidate]
  const previewRooms = oldPage && ready && include.rooms ? sourceRooms(oldPage, ready.roomSets) : []
  const previewPoints = oldPage && include.pickups
    ? oldPage.pickups.flatMap(annotation => { const point = pickupPoint(annotation); return point ? [point] : [] }) : []

  const setMatch = (oldPage: number, newPage: number | null) => {
    setOverrides(previous => new Map(previous).set(oldPage, { oldPage, newPage, reason: newPage === null ? null : 'manual' }))
    setView({ oldPage })
  }

  const apply = () => {
    if (!ready || !canApply) return
    try {
      const pages = planCarryOverPages(ready.oldPages, ready.newPages, matches)
      const linkedSets = new Set(pages.map(page => page.roomSetLink?.id))
      const message = pages.length
        ? `${pages.length}ページ分を新版へ写します。Ctrl+Z で一度に戻せます。`
        : '項目を新版へ写します。Ctrl+Z で一度に戻せます。'
      if (!window.confirm(message)) return
      setResult(store.applyCarryOver({
        fixtures: ready.fixtures, pages, include,
        roomSets: include.rooms ? ready.roomSets.filter(set => linkedSets.has(set.id)) : [],
      }))
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return <dialog ref={dialog} className="carry-over-dialog" aria-label="旧版のPDFから写す"
    onCancel={event => { event.preventDefault(); onClose() }} onKeyDown={event => event.stopPropagation()}>
    <h2 id={title}>旧版のPDFから写す</h2>
    <p>旧版のPDF（別のタブで開いているもの）から、数量拾い・部屋の範囲・縮尺を、いま開いているPDF（新版）へ写します。図面名称→図面番号の順でページを対応づけます。</p>
    <label className="carry-over-source">旧版のPDF
      <select aria-label="旧版のPDF" value={old ? oldId : ''} disabled={!!result} onChange={event => setOldId(event.currentTarget.value)}>
        <option value="">旧版のPDFを選ぶ</option>
        {documents.map(document => <option key={document.docId} value={document.docId}>{document.name}</option>)}
      </select>
    </label>
    <fieldset className="carry-over-include" disabled={!!result}>
      <legend>写すもの</legend>
      {categories.map(([key, label]) => <label key={key}>
        <input type="checkbox" checked={include[key]} onChange={event => {
          const checked = event.currentTarget.checked
          setInclude(previous => ({ ...previous, [key]: checked }))
        }} /> {label}
      </label>)}
    </fieldset>
    {!include.fixtures && include.pickups && <p className="carry-over-warning">新版に無い項目の拾いは写しません</p>}
    {old && !ready && !error && <div role="status">
      <div>旧版の拾いを読み込んでいます…</div>
      {[oldScan, newScan].map((scan, index) => {
        const progress = scan.includes('読み取っています') && scan.match(/\d+ \/ \d+/)?.[0]
        return progress && <div key={index}>{index ? '新版' : '旧版'}の図面名称を読み取っています（{progress}）</div>
      })}
    </div>}
    {ready && <>
      <div className="carry-over-mapping-actions">
        <span>対応済み {matched} / 未対応 {matches.length - matched}</span>
        <button type="button" disabled={!!result || matched === matches.length} onClick={() => {
          const filled = fillCarryOverByOrder(matches, ready.newPages.length)
          setOverrides(previous => {
            const next = new Map(previous)
            filled.forEach((match, i) => { if (match.reason === 'order' && matches[i].newPage === null) next.set(match.oldPage, match) })
            return next
          })
        }}>未対応をページ順で補う</button>
        <button type="button" disabled={!!result || !overrides.size} onClick={() => {
          setOverrides(new Map())
          setView(current => current && { oldPage: current.oldPage })
        }}>自動の対応に戻す</button>
      </div>
      {!matches.length && <p>{fixturesOnly ? '項目は文書全体に写します。' : '選んだ種類のうち、写すものが旧版にありません。'}</p>}
      {matches.length > 0 && <div className="carry-over-layout">
        <div className="carry-over-table-scroll" tabIndex={0} aria-label="ページの対応表">
          <table className="carry-over-table">
            <thead><tr><th scope="col">旧版</th><th scope="col">写すもの</th><th scope="col">新版</th><th scope="col">根拠</th><th scope="col">注意</th></tr></thead>
            <tbody>{matches.map(match => {
              const source = ready.oldPages.get(match.oldPage)!
              const target = match.newPage === null ? undefined : ready.newPages[match.newPage]
              const hasScale = include.scales && (!!source.scale || !!source.scaleRegions?.length)
              const content = [
                include.pickups && source.pickups.length > 0 && `拾い ${source.pickups.length}`,
                include.rooms && source.roomRegions.length > 0 && `部屋 ${source.roomRegions.length}`,
                include.rooms && source.roomSetLink && '組',
                hasScale && '縮尺',
              ].filter(Boolean).join('・')
              const warning: string[] = []
              if (target) {
                const i = target.pageIndex, transform = carryOverTransform(source, target)
                if (transform.warning === 'aspect') warning.push('用紙の縦横比が違うため同じ座標に写します')
                else if (transform.factor !== 1) warning.push(`用紙の大きさが違うため ${Math.round(transform.factor * 100)}% で写します`)
                if (counts[i]) warning.push(`新版のこのページに拾いが ${counts[i]}件あります`)
                if (include.rooms && source.roomSetLink && store.pageRoomSets.has(i)) {
                  warning.push('新版のこのページは別の部屋の組を使っています（組は写しません）')
                }
                if (hasScale && ((source.scale && store.getScale(i))
                  || (source.scaleRegions?.length && store.scaleRegions.get(i)?.length))) {
                  warning.push('新版のこのページに縮尺があります（縮尺は写しません）')
                }
                if ((pickedTargets.get(i) ?? 0) > 1) warning.push('同じ新版のページを複数の旧版ページが選んでいます')
              }
              const choose = () => setView({ oldPage: source.pageIndex })
              return <tr key={source.pageIndex} className={selected?.oldPage === source.pageIndex ? 'carry-over-selected' : undefined}
                onClick={choose}>
                <th scope="row"><button type="button" aria-pressed={selected?.oldPage === source.pageIndex} onClick={event => {
                  event.stopPropagation()
                  choose()
                }}>{pageLabel(source)}</button></th>
                <td>{content}</td>
                <td><select aria-label={`旧版 p.${source.pageIndex + 1} の対応先`} value={match.newPage ?? ''} disabled={!!result}
                  onClick={event => event.stopPropagation()} onChange={event => {
                    const value = event.currentTarget.value
                    setMatch(source.pageIndex, value === '' ? null : Number(value))
                  }}>
                  <option value="">写さない</option>
                  {ready.newPages.map(page => <option key={page.pageIndex} value={page.pageIndex}>{pageLabel(page)}</option>)}
                </select></td>
                <td className={match.reason ? undefined : 'carry-over-warning'}>{match.reason ? reasons[match.reason] : '未対応'}</td>
                <td className="carry-over-row-warnings">{warning.map(text => <div key={text}>{text}</div>)}</td>
              </tr>
            })}</tbody>
          </table>
        </div>
        <section className="carry-over-comparison" aria-label="図面の見比べ">
          {old && oldPage && newPage ? <>
            <div className="carry-over-preview-grid">
              <PagePreview session={old} page={oldPage} pool={pool} label="旧版" rooms={previewRooms} points={previewPoints} factor={1} />
              <PagePreview session={session} page={newPage} pool={pool} label="新版" rooms={previewRooms} points={previewPoints}
                factor={carryOverTransform(oldPage, newPage).factor} />
            </div>
            <div className="carry-over-preview-actions">
              <button type="button" disabled={newPage.pageIndex === 0}
                onClick={() => setView({ oldPage: oldPage.pageIndex, candidate: newPage.pageIndex - 1 })}>‹ 前のページ</button>
              <button type="button" disabled={newPage.pageIndex + 1 === ready.newPages.length}
                onClick={() => setView({ oldPage: oldPage.pageIndex, candidate: newPage.pageIndex + 1 })}>次のページ ›</button>
              <button type="button" disabled={!!result} onClick={() => setMatch(oldPage.pageIndex, newPage.pageIndex)}>この新版ページに決める</button>
            </div>
          </> : <p>旧版の行を選ぶと、図面を見比べられます。</p>}
        </section>
      </div>}
    </>}
    {error && <p className="carry-over-warning" role="alert">{error}</p>}
    {result && <div className="carry-over-result" role="status">
      <ul>
        <li>項目 {result.fixturesAdded}件を追加（{result.fixturesExisting}件は新版の項目を使用）</li>
        <li>拾い {result.pickupsAdded}件（写せなかった拾い {result.pickupsSkipped}件）</li>
        <li>部屋の範囲 {result.roomRegionsAdded}・部屋の組 {result.roomSetsAdded}（組を結び付けなかったページ {result.roomLinksSkipped}）</li>
        <li>縮尺 {result.scalesCopied}ページ（既にあり写さなかった {result.scalesSkipped}ページ）</li>
      </ul>
      {result.pagesOutside.length > 0 && <p className="carry-over-warning">用紙の外にはみ出したページ: {result.pagesOutside.map(i => `p.${i + 1}`).join('、')}</p>}
      <p>位置がずれているページは、数量拾いの「このページの拾いと部屋をずらす」で合わせてください。</p>
    </div>}
    <div className="dialog-actions">
      <button type="button" onClick={onClose}>閉じる</button>
      <button type="button" disabled={!canApply} onClick={apply}>写す</button>
    </div>
  </dialog>
}
