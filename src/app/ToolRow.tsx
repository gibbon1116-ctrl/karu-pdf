import { useEffect, useState } from 'react'
import type { EditorTool } from '../editor/AnnotationLayer'
import { Dropdown, type DropdownItem } from '../ui/Dropdown'

export type SplitToolGroup = 'text' | 'shape' | 'pen' | 'mark'
export type LastSplitTools = Record<SplitToolGroup, EditorTool>

export const LAST_TOOLS_STORAGE_KEY = 'karu-pdf:last-tools'
export const DEFAULT_LAST_TOOLS: LastSplitTools = { text: 'text', shape: 'line', pen: 'highlight', mark: 'textSelect' }

const groups: Record<SplitToolGroup, Array<{ tool: EditorTool; label: string; shortcut: string }>> = {
  text: [{ tool: 'text', label: '文字', shortcut: 'T' }, { tool: 'callout', label: '吹き出し', shortcut: 'C' }],
  shape: [
    { tool: 'line', label: '線', shortcut: 'L' },
    { tool: 'arrow', label: '矢印', shortcut: 'A' },
    { tool: 'square', label: '四角', shortcut: 'R' },
    { tool: 'circle', label: '丸', shortcut: 'O' },
  ],
  pen: [{ tool: 'highlight', label: '蛍光ペン', shortcut: 'H' }, { tool: 'ink', label: '手書き', shortcut: 'P' }],
  mark: [
    { tool: 'textSelect', label: '文字を選択', shortcut: 'M' },
    { tool: 'textHighlight', label: 'ハイライト', shortcut: '' },
    { tool: 'underline', label: '下線', shortcut: '' },
    { tool: 'strikeout', label: '取り消し線', shortcut: '' },
  ],
}

function storageOrNull(): Storage | null {
  try { return globalThis.localStorage ?? null } catch { return null }
}

export function loadLastTools(storage: Storage | null = storageOrNull()): LastSplitTools {
  try {
    const value = JSON.parse(storage?.getItem(LAST_TOOLS_STORAGE_KEY) ?? '{}') as Partial<LastSplitTools>
    return Object.fromEntries((Object.keys(groups) as SplitToolGroup[]).map((group) => [
      group,
      groups[group].some((item) => item.tool === value[group]) ? value[group] : DEFAULT_LAST_TOOLS[group],
    ])) as LastSplitTools
  } catch {
    return { ...DEFAULT_LAST_TOOLS }
  }
}

export function saveLastTool(group: SplitToolGroup, tool: EditorTool, storage: Storage | null = storageOrNull()): LastSplitTools {
  const current = loadLastTools(storage)
  if (!groups[group].some((item) => item.tool === tool)) return current
  const next = { ...current, [group]: tool }
  try { storage?.setItem(LAST_TOOLS_STORAGE_KEY, JSON.stringify(next)) } catch { /* 道具の操作は続ける。 */ }
  return next
}

function labelFor(tool: EditorTool): string {
  for (const entries of Object.values(groups)) {
    const match = entries.find((item) => item.tool === tool)
    if (match) return match.label
  }
  return tool === 'select' ? '選択' : '記号'
}

interface Props {
  tool: EditorTool
  hasDocument: boolean
  zoom: number
  canUndo: boolean
  canRedo: boolean
  onToolChange(tool: EditorTool): void
  onUndo(): void
  onRedo(): void
  onZoomIn(): void
  onZoomOut(): void
  onSetZoom(zoom: number): void
  onFitWidth(): void
}

export function ToolRow(props: Props) {
  const [lastTools, setLastTools] = useState(loadLastTools)

  useEffect(() => {
    const group = (Object.keys(groups) as SplitToolGroup[]).find((name) => groups[name].some((item) => item.tool === props.tool))
    if (group) setLastTools(saveLastTool(group, props.tool))
  }, [props.tool])

  const splitButton = (group: SplitToolGroup, label: string) => {
    const active = groups[group].some((item) => item.tool === props.tool)
    const choose = (tool: EditorTool) => {
      setLastTools(saveLastTool(group, tool))
      props.onToolChange(tool)
    }
    const items: DropdownItem[] = groups[group].map((item) => ({
      label: item.label, shortcut: item.shortcut, checked: item.tool === lastTools[group], onSelect: () => choose(item.tool),
    }))
    return <div key={group} className={`split-button${active ? ' active' : ''}`}>
      <button type="button" className="split-main" title={`${labelFor(lastTools[group])}（${label}: ${groups[group].map((item) => item.label).join('・')}）`}
        aria-pressed={active} disabled={!props.hasDocument} onClick={() => props.onToolChange(lastTools[group])}>
        {labelFor(lastTools[group])}
      </button>
      <span className="split-arrow-wrap" title={`${label}の道具を選ぶ`}>
        <Dropdown label={`${label}▼`} items={items} disabled={!props.hasDocument} buttonClassName="split-arrow">
          <span aria-hidden="true">▼</span><span className="visually-hidden">{label}▼</span>
        </Dropdown>
      </span>
    </div>
  }

  const zoomItems: DropdownItem[] = [50, 75, 100, 150, 200, 400].map((value) => ({
    label: `${value}%`, checked: Math.round(props.zoom * 100) === value, onSelect: () => props.onSetZoom(value / 100),
  }))
  zoomItems.push({ type: 'separator' }, { label: '幅に合わせる', onSelect: props.onFitWidth })

  return <header className="tool-row" aria-label="書き込みの道具">
    <button type="button" className={props.tool === 'select' ? 'active' : ''} aria-pressed={props.tool === 'select'} disabled={!props.hasDocument} onClick={() => props.onToolChange('select')}>選択</button>
    {splitButton('text', '文字')}
    {splitButton('shape', '図形')}
    {splitButton('pen', 'ペン')}
    {splitButton('mark', '文字に印')}
    <button type="button" className={props.tool === 'symbol' ? 'active' : ''} aria-pressed={props.tool === 'symbol'} disabled={!props.hasDocument} onClick={() => props.onToolChange('symbol')}>記号</button>
    <span className="tool-row-separator" />
    <button type="button" className="icon-button" title="元に戻す" aria-label="元に戻す" disabled={!props.canUndo} onClick={props.onUndo}>↶ 戻す</button>
    <button type="button" className="icon-button" title="やり直し" aria-label="やり直し" disabled={!props.canRedo} onClick={props.onRedo}>↷ やり直し</button>
    <span className="tool-row-separator" />
    <div className="zoom-controls">
      <button type="button" title="縮小" aria-label="縮小" disabled={!props.hasDocument} onClick={props.onZoomOut}>−</button>
      <Dropdown label={`${Math.round(props.zoom * 100)}%`} items={zoomItems} disabled={!props.hasDocument} buttonClassName="zoom-value" />
      <button type="button" title="拡大" aria-label="拡大" disabled={!props.hasDocument} onClick={props.onZoomIn}>＋</button>
      <button type="button" className="fit-width" disabled={!props.hasDocument} onClick={props.onFitWidth}>幅に合わせる</button>
    </div>
  </header>
}
