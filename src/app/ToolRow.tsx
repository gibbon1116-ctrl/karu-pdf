import { useEffect, useState } from 'react'
import type { EditorTool } from '../editor/AnnotationLayer'
import { Dropdown, type DropdownItem } from '../ui/Dropdown'
import { ToolIcon } from '../ui/ToolIcon'

export type SplitToolGroup = 'text' | 'shape' | 'pen' | 'mark' | 'measure'
export type LastSplitTools = Record<SplitToolGroup, EditorTool>

export const LAST_TOOLS_STORAGE_KEY = 'karu-pdf:last-tools'
export const DEFAULT_LAST_TOOLS: LastSplitTools = { text: 'text', shape: 'line', pen: 'highlight', mark: 'textSelect', measure: 'distance' }

const groups: Record<SplitToolGroup, Array<{ tool: EditorTool; label: string; description: string; shortcut: string }>> = {
  text: [
    { tool: 'issue', label: '指摘', description: '番号を付けて、指摘の内容を書く', shortcut: 'N' },
    { tool: 'text', label: '文字', description: '文字を入力する', shortcut: 'T' },
    { tool: 'callout', label: '吹き出し', description: '指す位置から文字枠を引き出す', shortcut: 'C' },
  ],
  shape: [
    { tool: 'cloudSquare', label: '雲（四角）', description: '修正箇所を四角い雲形で囲む', shortcut: '' },
    { tool: 'cloudPolygon', label: '雲（多角形）', description: '修正箇所を自由な形の雲形で囲む', shortcut: '' },
    { tool: 'line', label: '線', description: 'まっすぐな線を引く', shortcut: 'L' },
    { tool: 'arrow', label: '矢印', description: '矢印を引く', shortcut: 'A' },
    { tool: 'square', label: '四角', description: '四角形を描く', shortcut: 'R' },
    { tool: 'circle', label: '丸', description: '円や楕円を描く', shortcut: 'O' },
  ],
  pen: [
    { tool: 'highlight', label: '蛍光ペン', description: 'なぞった所に半透明の太い線を引く（Shift で5°刻み、Ctrl で好きな角度の直線）', shortcut: 'H' },
    { tool: 'ink', label: '手書き', description: '細い線で自由に書く（Shift で5°刻み、Ctrl で好きな角度の直線）', shortcut: 'P' },
  ],
  measure: [
    { tool: 'distance', label: '距離', description: '2点の間の長さを測る', shortcut: 'K' },
    { tool: 'perimeter', label: '連続した長さ', description: '折れ線の長さの合計を測る', shortcut: '' },
    { tool: 'area', label: '面積', description: '囲んだ範囲の面積を測る', shortcut: '' },
  ],
  mark: [
    { tool: 'textSelect', label: '文字を選択', description: 'PDF の文字を選んでコピーする', shortcut: 'M' },
    { tool: 'textHighlight', label: '文字ハイライト', description: '選んだ文字だけに色を付ける', shortcut: '' },
    { tool: 'underline', label: '文字に下線', description: '選んだ文字の下に線を引く', shortcut: '' },
    { tool: 'strikeout', label: '文字に取り消し線', description: '選んだ文字の中央に線を引く', shortcut: '' },
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

function descriptionFor(tool: EditorTool): string {
  for (const entries of Object.values(groups)) {
    const match = entries.find((item) => item.tool === tool)
    if (match) return match.description
  }
  return tool === 'select' ? '書き込みを選ぶ' : '記号を置く'
}

interface Props {
  readOnly?: boolean
  tool: EditorTool
  hasDocument: boolean
  zoom: number
  canUndo: boolean
  canRedo: boolean
  onScale(): void
  snapEnabled?: boolean
  snapAvailable?: boolean
  onSnapToggle?(): void
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
      label: item.label, icon: <ToolIcon tool={item.tool} />, description: item.description,
      shortcut: item.shortcut, checked: item.tool === lastTools[group], onSelect: () => choose(item.tool),
    }))
    if (group === 'measure') items.push({ type: 'separator' }, { label: '縮尺の設定…', description: 'このページの縮尺を決める', onSelect: props.onScale })
    return <div key={group} className={`split-button${active ? ' active' : ''}`}>
      <button type="button" className="split-main" title={`${labelFor(lastTools[group])}: ${descriptionFor(lastTools[group])}（${label}: ${groups[group].map((item) => item.label).join('・')}）`}
        aria-pressed={active} disabled={!props.hasDocument || props.readOnly} onClick={() => props.onToolChange(lastTools[group])}>
        <ToolIcon tool={lastTools[group]} /><span className="split-label">{labelFor(lastTools[group])}</span>
      </button>
      <span className="split-arrow-wrap" title={`${label}の道具を選ぶ`}>
        <Dropdown label={`${label}▼`} items={items} disabled={!props.hasDocument || props.readOnly} buttonClassName="split-arrow">
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
    <button type="button" className={props.tool === 'select' ? 'active' : ''} title="選択: 書き込みを選ぶ" aria-pressed={props.tool === 'select'} disabled={!props.hasDocument} onClick={() => props.onToolChange('select')}><ToolIcon tool="select" />選択</button>
    {splitButton('text', '文字')}
    {splitButton('shape', '図形')}
    {splitButton('pen', 'ペン')}
    {splitButton('mark', '文字に印')}
    {splitButton('measure', '計測')}
    <button type="button" className={props.tool === 'count' ? 'active' : ''} title="数量拾い: 一覧で選んだ項目の個数・長さ・面積・体積を拾う（Q）" aria-pressed={props.tool === 'count'} disabled={!props.hasDocument || props.readOnly} onClick={() => props.onToolChange('count')}><ToolIcon tool="count" />数量拾い</button>
    <button type="button" className={props.tool === 'symbol' ? 'active' : ''} title="記号: 記号を置く" aria-pressed={props.tool === 'symbol'} disabled={!props.hasDocument || props.readOnly} onClick={() => props.onToolChange('symbol')}><ToolIcon tool="symbol" />記号</button>
    <span className="tool-row-separator" />
    <button type="button" className="icon-button" title="元に戻す" aria-label="元に戻す" disabled={!props.canUndo} onClick={props.onUndo}>↶ 戻す</button>
    <button type="button" className="icon-button" title="やり直し" aria-label="やり直し" disabled={!props.canRedo} onClick={props.onRedo}>↷ やり直し</button>
    <span className="tool-row-separator" />
    <div className="zoom-controls">
      <button type="button" data-testid="snap-toggle" title="既存の頂点にスナップ（Alt を押している間は解除）" disabled={!props.hasDocument || props.readOnly || !props.snapAvailable} aria-pressed={!!props.snapEnabled} className={props.snapEnabled ? 'active' : ''} onClick={props.onSnapToggle}>スナップ</button>
      <button type="button" title="縮小" aria-label="縮小" disabled={!props.hasDocument} onClick={props.onZoomOut}>−</button>
      <Dropdown label={`${Math.round(props.zoom * 100)}%`} items={zoomItems} disabled={!props.hasDocument} buttonClassName="zoom-value" />
      <button type="button" title="拡大" aria-label="拡大" disabled={!props.hasDocument} onClick={props.onZoomIn}>＋</button>
      <button type="button" className="fit-width" disabled={!props.hasDocument} onClick={props.onFitWidth}>幅に合わせる</button>
    </div>
  </header>
}
