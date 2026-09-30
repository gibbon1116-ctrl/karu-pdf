import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import type { SearchMatch } from '../core/search'
import type { EditableAnnotation } from '../editor/AnnotationStore'
import type { RenderScheduler } from '../client/RenderScheduler'
import type { DocumentSession, SidePanelTab } from './documentModel'
import { AnnotationListPanel } from './AnnotationListPanel'
import { OutlinePanel } from './OutlinePanel'
import { SearchPanel, type SearchHighlightState } from './SearchPanel'
import { ThumbnailPanel } from './ThumbnailPanel'

const WIDTH_KEY = 'karu-pdf:side-panel-width'
const MIN_WIDTH = 160
const MAX_WIDTH = 480

function initialWidth(): number {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(value) ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, value)) : MIN_WIDTH
  } catch { return MIN_WIDTH }
}

interface Props {
  session: DocumentSession
  pool: PdfWorkerPool
  scheduler: RenderScheduler
  activeTab: SidePanelTab
  focusSearchVersion: number
  onTabChange(tab: SidePanelTab): void
  onPageClick(index: number): void
  onNavigate(pageIndex: number, x: number | null, y: number | null): void
  onSearchNavigate(match: SearchMatch): void
  onSearchHighlights(value: SearchHighlightState): void
  onSelectAnnotation(annotation: EditableAnnotation): void
}

const tabs: Array<{ id: SidePanelTab; label: string }> = [
  { id: 'pages', label: 'ページ' }, { id: 'outline', label: 'しおり' },
  { id: 'search', label: '検索' }, { id: 'annotations', label: '書き込み' },
]

export function SidePanel(props: Props) {
  const [width, setWidth] = useState(initialWidth)
  const widthRef = useRef(width)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, drag.startWidth + event.clientX - drag.startX))
      widthRef.current = next
      setWidth(next)
    }
    const stop = () => {
      if (!dragRef.current) return
      dragRef.current = null
      try { localStorage.setItem(WIDTH_KEY, String(widthRef.current)) } catch { /* 表示は続ける。 */ }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
  }, [])

  let content: ReactNode
  if (props.activeTab === 'pages') content = <ThumbnailPanel
    docId={props.session.docId} pageSizes={props.session.pageSizes} currentPage={props.session.view.page}
    scheduler={props.scheduler} annotationStore={props.session.annotationStore} onPageClick={props.onPageClick}
  />
  else if (props.activeTab === 'outline') content = <OutlinePanel docId={props.session.docId} pool={props.pool} onNavigate={props.onNavigate} />
  else if (props.activeTab === 'search') content = <SearchPanel
    docId={props.session.docId} pool={props.pool} focusVersion={props.focusSearchVersion}
    onHighlightsChange={props.onSearchHighlights} onNavigate={props.onSearchNavigate}
  />
  else content = <AnnotationListPanel session={props.session} pool={props.pool} onSelect={props.onSelectAnnotation} />

  return <aside className="side-panel" style={{ width }} aria-label="左の欄" data-testid="side-panel">
    <div className="side-panel-tabs" role="tablist" aria-label="左の欄">
      {tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={props.activeTab === tab.id} onClick={() => props.onTabChange(tab.id)}>{tab.label}</button>)}
    </div>
    <div className="side-panel-content" role="tabpanel">{content}</div>
    <div className="side-panel-resizer" role="separator" aria-label="左の欄の幅" aria-orientation="vertical" aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH} aria-valuenow={Math.round(width)} onPointerDown={(event) => {
      event.preventDefault()
      dragRef.current = { startX: event.clientX, startWidth: width }
    }} />
  </aside>
}
