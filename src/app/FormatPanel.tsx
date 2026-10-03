import { useSyncExternalStore } from 'react'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import { SYMBOL_OPTIONS, type RGB, type SymbolName } from '../core/annotations'
import { ISSUE_STATUSES, issueStatusLabel } from '../core/issues'
import type { CloudIntensity } from '../core/cloud'
import type { FontName } from '../core/fontMetrics'
import type { EditorTool } from '../editor/AnnotationLayer'
import type { AnnotationStore, EditableAnnotation, Kind } from '../editor/AnnotationStore'
import { updateToolFormat, type FormatDefaults, type FormatTool, type ToolFormat } from '../editor/formatDefaults'
import { getActiveTextEditorSnapshot, insertIntoActiveTextEditor, subscribeActiveTextEditor } from '../editor/TextEditor'
import { SnippetPanel } from './SnippetPanel'

const COLORS: Array<{ name: string; value: RGB; css: string }> = [
  { name: '赤', value: [1, 0, 0], css: '#e00000' },
  { name: '青', value: [0, 0.25, 1], css: '#064fe6' },
  { name: '黒', value: [0, 0, 0], css: '#111' },
  { name: '緑', value: [0, 0.55, 0.1], css: '#008c1a' },
  { name: '橙', value: [1, 0.45, 0], css: '#ff7300' },
  { name: '紫', value: [0.55, 0.1, 0.7], css: '#8c1ab3' },
  { name: '黄', value: [1, 0.9, 0], css: '#ffe600' },
  { name: '白', value: [1, 1, 1], css: '#fff' },
]
const HIGHLIGHT_COLORS = [
  { name: '黄', value: [1, 0.9, 0] as RGB, css: '#ffe600' },
  { name: '緑', value: [0.35, 0.9, 0.3] as RGB, css: '#59e64d' },
  { name: '水色', value: [0.25, 0.8, 1] as RGB, css: '#40ccff' },
  { name: '桃', value: [1, 0.45, 0.65] as RGB, css: '#ff73a6' },
]
const WIDTHS = [0.5, 1, 1.5, 2, 3, 5]
const TEXT_BORDER_WIDTHS = [0.5, 1, 1.5, 2]
const HIGHLIGHT_WIDTHS = [6, 9, 12, 18]
const FONT_SIZES = [8, 9, 10.5, 12, 14, 18, 24, 36]
const SYMBOL_SIZES = [8, 12, 16, 24, 32, 48, 72]
const TEXT_INSERT_SYMBOLS = [...'✓✔○◎×△□☆★※→←↑↓⇒①②③〒℃±']

function sameColor(left: readonly number[] | null, right: readonly number[] | null): boolean {
  if (left === null || right === null) return left === right
  return left.every((value, index) => Math.abs(value - right[index]) < 0.001)
}

function ColorField({ label, value, allowNone, choices = COLORS, onChange }: {
  label: string
  value: RGB | null
  allowNone?: boolean
  choices?: typeof COLORS
  onChange(value: RGB | null): void
}) {
  return <fieldset>
    <legend>{label}</legend>
    <div className="color-grid">
      {allowNone && <button type="button" title="なし" aria-label={`${label} なし`} aria-pressed={value === null} className={`color-none${value === null ? ' selected' : ''}`} onClick={() => onChange(null)}>なし</button>}
      {choices.map((item) => <button key={item.name} type="button" title={item.name} aria-label={`${label} ${item.name}`} aria-pressed={sameColor(value, item.value)} className={sameColor(value, item.value) ? 'selected' : ''} onClick={() => onChange(item.value)}><span style={{ background: item.css }} /></button>)}
    </div>
  </fieldset>
}

interface Props {
  selected: EditableAnnotation | null
  tool: EditorTool
  store: AnnotationStore
  pool: PdfWorkerPool
  defaults: FormatDefaults
  onDefaultsChange(value: FormatDefaults): void
}

function formatTool(kind: Kind | EditorTool): FormatTool | null {
  if (kind === 'select' || kind === 'textSelect') return null
  return kind === 'freetext' ? 'text' : kind
}

function formatToolLabel(tool: FormatTool): string {
  const labels: Record<FormatTool, string> = {
    count: '個数カウント', cloudSquare: '雲（四角）', cloudPolygon: '雲（多角形）', issue: '指摘', distance: '距離', perimeter: '連続した長さ', area: '面積', text: '文字', callout: '吹き出し', line: '線', arrow: '矢印', square: '四角', circle: '丸',
    highlight: '蛍光ペン', ink: '手書き', symbol: '記号', textHighlight: '文字ハイライト',
    underline: '文字に下線', strikeout: '文字に取り消し線',
  }
  return labels[tool]
}

export function FormatPanel({ selected, tool, store, pool, defaults, onDefaultsChange }: Props) {
  const textEditorOpen = useSyncExternalStore(
    subscribeActiveTextEditor,
    getActiveTextEditorSnapshot,
    getActiveTextEditorSnapshot,
  )
  const activeSelection = selected
  const target = activeSelection?.count ? 'count' : formatTool(activeSelection?.kind ?? (tool === 'select' ? 'text' : tool))
  const values: EditableAnnotation | ToolFormat | null = activeSelection ?? (target ? defaults[target] : null)
  const textTarget = target === 'text' || target === 'callout'
  const cloudTarget = target === 'cloudSquare' || target === 'cloudPolygon'
  const shapeTarget = target === 'square' || target === 'circle' || cloudTarget
  const measureTarget = target === 'distance' || target === 'perimeter' || target === 'area'
  const simpleColorTarget = cloudTarget || target === 'count' || target === 'issue' || measureTarget || target === 'line' || target === 'arrow' || target === 'highlight' || target === 'ink' || target === 'textHighlight' || target === 'underline' || target === 'strikeout' || target === 'symbol'
  const opacityTarget = !cloudTarget && target !== 'issue' && simpleColorTarget && target !== 'underline' && target !== 'strikeout'

  const changeDefault = (changes: Partial<ToolFormat>) => {
    if (target) onDefaultsChange(updateToolFormat(defaults, target, changes))
  }
  const fillColor = activeSelection ? activeSelection.interiorColor : target ? defaults[target].fillColor : null
  const borderColor = activeSelection ? activeSelection.borderColor : target ? defaults[target].borderColor : null

  const changeColor = (next: RGB) => {
    if (activeSelection) store.update(activeSelection.id, { color: next })
    else changeDefault({ color: next })
  }
  const changeFill = (next: RGB | null) => {
    if (activeSelection) store.update(activeSelection.id, { interiorColor: next })
    else changeDefault({ fillColor: next })
  }
  const changeBorder = (next: RGB | null) => {
    if (activeSelection) store.update(activeSelection.id, { borderColor: next })
    else changeDefault({ borderColor: next })
  }
  const changeBorderWidth = (next: number) => {
    if (activeSelection) store.update(activeSelection.id, { borderWidth: next })
    else changeDefault({ borderWidth: next })
  }
  const changeOpacity = (next: number) => {
    if (activeSelection) store.update(activeSelection.id, { opacity: next })
    else changeDefault({ opacity: next })
  }
  const changeTextOpacity = (next: number) => {
    if (activeSelection) store.update(activeSelection.id, { textOpacity: next })
    else changeDefault({ textOpacity: next })
  }
  const changeBoxOpacity = (next: number) => {
    if (activeSelection) store.update(activeSelection.id, { boxOpacity: next })
    else changeDefault({ boxOpacity: next })
  }
  const changeSymbolSize = (next: number) => {
    if (activeSelection?.kind === 'symbol' || activeSelection?.kind === 'issue') {
      const centerX = (activeSelection.rect[0] + activeSelection.rect[2]) / 2
      const centerY = (activeSelection.rect[1] + activeSelection.rect[3]) / 2
      store.resize(activeSelection.id, [centerX - next / 2, centerY - next / 2, centerX + next / 2, centerY + next / 2])
    } else changeDefault({ symbolSize: next })
  }
  const changeSymbol = (next: SymbolName) => {
    if (activeSelection?.kind === 'symbol') store.update(activeSelection.id, { symbol: next })
    else changeDefault({ symbol: next })
  }
  const makeWhiteout = () => {
    if (activeSelection) store.update(activeSelection.id, { interiorColor: [1, 1, 1], borderColor: null, opacity: 1 })
    else changeDefault({ fillColor: [1, 1, 1], borderColor: null, opacity: 1 })
  }

  const changeText = async (changes: { fontSize?: number; font?: FontName }) => {
    if (activeSelection?.measure) { store.update(activeSelection.id, changes); return }
    if (!activeSelection || (activeSelection.kind !== 'freetext' && activeSelection.kind !== 'callout')) {
      changeDefault(changes)
      return
    }
    const fontSize = changes.fontSize ?? activeSelection.fontSize
    const font = changes.font ?? activeSelection.font
    const width = activeSelection.rect[2] - activeSelection.rect[0]
    const layout = await pool.layoutText(activeSelection.text, fontSize, width, font)
    store.update(activeSelection.id, {
      ...changes,
      layout,
      rect: [activeSelection.rect[0], activeSelection.rect[1], activeSelection.rect[2], activeSelection.rect[1] + layout.height],
    })
  }

  return <aside className="format-panel" aria-label="書式" data-testid="format-panel">
    <h2>{target ? `${formatToolLabel(target)}の書式` : '書式'}</h2>
    {!target && <p>道具または書き込みを選んでください。</p>}
    {simpleColorTarget && values && <ColorField label="色" value={values.color} choices={target === 'highlight' || target === 'textHighlight' ? HIGHLIGHT_COLORS : COLORS} onChange={(next) => next && changeColor(next)} />}
    {target === 'symbol' && values && <fieldset>
      <legend>記号の種類</legend>
      <div className="symbol-grid">
        {SYMBOL_OPTIONS.map((item) => <button
          key={item.name}
          type="button"
          title={item.label}
          aria-label={`記号 ${item.glyph}（${item.label}）`}
          aria-pressed={values.symbol === item.name}
          className={values.symbol === item.name ? 'selected' : ''}
          onClick={() => changeSymbol(item.name)}
        >{item.glyph}</button>)}
      </div>
    </fieldset>}
    {(target === 'symbol' || target === 'count') && values && <label>
      大きさ
      <select aria-label="記号の大きさ" value={activeSelection?.kind === 'symbol' ? Math.round(activeSelection.rect[2] - activeSelection.rect[0]) : (values as ToolFormat).symbolSize} onChange={(event) => changeSymbolSize(Number(event.currentTarget.value))}>
        {SYMBOL_SIZES.map((value) => <option key={value} value={value}>{value} pt</option>)}
      </select>
    </label>}
    {target === 'count' && <label>種類<input aria-label="カウントの種類" maxLength={80} key={activeSelection?.id ?? 'count-default'} defaultValue={activeSelection?.count?.group ?? defaults.count.countGroup ?? '照明器具'} onBlur={event => {
      const group = event.currentTarget.value.trim()
      if (!group) return
      if (activeSelection) store.update(activeSelection.id, { countGroup: group })
      else changeDefault({ countGroup: group })
    }} /></label>}
    {target === 'issue' && values && <>
      <label>大きさ<select aria-label="指摘の大きさ" value={activeSelection ? Math.round(activeSelection.rect[2] - activeSelection.rect[0]) : (values as ToolFormat).symbolSize} onChange={event => changeSymbolSize(Number(event.currentTarget.value))}>
        <option value="12">小（12 pt）</option><option value="16">中（16 pt）</option><option value="24">大（24 pt）</option>
      </select></label>
      {activeSelection?.issue && <label>状態<select aria-label="指摘の状態" value={activeSelection.issue.status} onChange={event => store.update(activeSelection.id, { issueStatus: event.currentTarget.value as 'open' | 'done' })}>
        {ISSUE_STATUSES.map(status => <option key={status} value={status}>{issueStatusLabel(status)}</option>)}
      </select></label>}
    </>}
    {cloudTarget && values && <label>雲の大きさ<select aria-label="雲の大きさ" value={values.cloudIntensity ?? 1} onChange={event => {
      const cloudIntensity = Number(event.currentTarget.value) as CloudIntensity
      if (activeSelection) store.update(activeSelection.id, { cloudIntensity }); else changeDefault({ cloudIntensity })
    }}><option value="0">小</option><option value="1">中</option><option value="2">大</option></select></label>}
    {textTarget && values && <ColorField label="文字の色" value={values.color} onChange={(next) => next && changeColor(next)} />}
    {(shapeTarget || textTarget) && <ColorField label={textTarget ? '背景色' : '塗り'} value={fillColor} allowNone onChange={changeFill} />}
    {((shapeTarget && !cloudTarget) || textTarget) && <ColorField label="枠線の色" value={borderColor} allowNone onChange={changeBorder} />}
    {target && values && ((simpleColorTarget && target !== 'issue' && target !== 'symbol' && target !== 'textHighlight' && target !== 'underline' && target !== 'strikeout') || shapeTarget || textTarget) && <label>
      {textTarget ? '枠線の太さ' : '線の太さ'}
      <select aria-label={textTarget ? '枠線の太さ' : '線の太さ'} value={values.borderWidth} onChange={(event) => changeBorderWidth(Number(event.currentTarget.value))}>
        {(target === 'highlight' ? HIGHLIGHT_WIDTHS : textTarget ? TEXT_BORDER_WIDTHS : WIDTHS).map((value) => <option key={value} value={value}>{value} pt</option>)}
      </select>
    </label>}
    {(target === 'arrow' || target === 'callout') && values && <label>
      矢印先端の大きさ
      <select aria-label="矢印先端の大きさ" value={values.arrowHeadSize ?? 'auto'} onChange={event => {
        const next = event.target.value === 'auto' ? null : Number(event.target.value)
        if (activeSelection) store.update(activeSelection.id, { arrowHeadSize: next })
        else changeDefault({ arrowHeadSize: next })
      }}>
        <option value="auto">線幅に合わせる（既定）</option>
        {[...new Set([4, 6, 8, 12, 16, 24, 32, ...(values.arrowHeadSize ? [values.arrowHeadSize] : [])])].sort((a, b) => a - b).map(size => <option key={size} value={size}>{size} pt</option>)}
      </select>
    </label>}
    {shapeTarget && values && <label>
      透明度
      <select aria-label="透明度" value={values.opacity} onChange={(event) => changeOpacity(Number(event.currentTarget.value))}>
        <option value="1">100%</option><option value="0.5">50%</option><option value="0.25">25%</option>
      </select>
    </label>}
    {opacityTarget && values && <label>
      透明度
      <select aria-label="透明度" value={values.opacity} onChange={(event) => changeOpacity(Number(event.currentTarget.value))}>
        <option value="1">100%</option><option value="0.75">75%</option><option value="0.5">50%</option>{target === 'highlight' && <option value="0.35">35%（既定）</option>}{target === 'textHighlight' && <option value="0.4">40%（既定）</option>}<option value="0.25">25%</option>
      </select>
    </label>}
    {target === 'square' && <button type="button" className="whiteout-button" title="上に白い四角を重ねて見えなくします。下の文字やデータはファイルに残ります" onClick={makeWhiteout}>白塗りにする</button>}
    {measureTarget && values && <label>文字の大きさ<select aria-label="文字の大きさ" value={values.fontSize} onChange={event => void changeText({ fontSize: Number(event.currentTarget.value) })}>{FONT_SIZES.map(v => <option key={v} value={v}>{v} pt</option>)}</select></label>}
    {textTarget && values && <>
      <label>
        文字の透明度
        <select aria-label="文字の透明度" value={values.textOpacity} onChange={(event) => changeTextOpacity(Number(event.currentTarget.value))}>
          <option value="1">100%</option><option value="0.75">75%</option><option value="0.5">50%</option><option value="0.25">25%</option>
        </select>
      </label>
      <label>
        背景と枠の透明度
        <select aria-label="背景と枠の透明度" value={values.boxOpacity} onChange={(event) => changeBoxOpacity(Number(event.currentTarget.value))}>
          <option value="1">100%</option><option value="0.75">75%</option><option value="0.5">50%</option><option value="0.25">25%</option>
        </select>
      </label>
      <label>
        文字の大きさ
        <select aria-label="文字の大きさ" value={values.fontSize} onChange={(event) => void changeText({ fontSize: Number(event.currentTarget.value) })}>
          {FONT_SIZES.map((value) => <option key={value} value={value}>{value} pt</option>)}
        </select>
      </label>
      <label>
        書体
        <select aria-label="書体" value={values.font} onChange={(event) => void changeText({ font: event.currentTarget.value as FontName })}>
          <option value="BIZUDGothic">ゴシック</option>
          <option value="BIZUDMincho">明朝</option>
        </select>
      </label>
    </>}
    {textEditorOpen && <SnippetPanel />}
    {textEditorOpen && <fieldset>
      <legend>記号を挿入</legend>
      <div className="text-symbol-grid">
        {TEXT_INSERT_SYMBOLS.map((item) => <button
          key={item}
          type="button"
          data-text-symbol={item}
          aria-label={`記号を挿入 ${item}`}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => insertIntoActiveTextEditor(item)}
        >{item}</button>)}
      </div>
    </fieldset>}
    {target && <p className="format-target">{activeSelection ? '選択中の書き込み' : '次に作る書き込み'}</p>}
  </aside>
}
