import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import type { RGB } from '../core/annotations'
import type { FontName } from '../core/fontMetrics'
import type { EditorTool } from '../editor/AnnotationLayer'
import type { AnnotationStore, EditableAnnotation, Kind } from '../editor/AnnotationStore'
import { updateToolFormat, type FormatDefaults, type FormatTool, type ToolFormat } from '../editor/formatDefaults'

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
  if (kind === 'select') return null
  return kind === 'freetext' ? 'text' : kind
}

export function FormatPanel({ selected, tool, store, pool, defaults, onDefaultsChange }: Props) {
  const activeSelection = tool === 'select' ? selected : null
  const target = formatTool(activeSelection?.kind ?? (tool === 'select' ? 'text' : tool))
  const values: EditableAnnotation | ToolFormat | null = activeSelection ?? (target ? defaults[target] : null)
  const textTarget = target === 'text' || target === 'callout'
  const shapeTarget = target === 'square' || target === 'circle'
  const simpleColorTarget = target === 'line' || target === 'arrow' || target === 'highlight' || target === 'ink'

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
  const makeWhiteout = () => {
    if (activeSelection) store.update(activeSelection.id, { interiorColor: [1, 1, 1], borderColor: null, opacity: 1 })
    else changeDefault({ fillColor: [1, 1, 1], borderColor: null, opacity: 1 })
  }

  const changeText = async (changes: { fontSize?: number; font?: FontName }) => {
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
    <h2>書式</h2>
    {!target && <p>道具または書き込みを選んでください。</p>}
    {simpleColorTarget && values && <ColorField label="色" value={values.color} choices={target === 'highlight' ? HIGHLIGHT_COLORS : COLORS} onChange={(next) => next && changeColor(next)} />}
    {textTarget && values && <ColorField label="文字の色" value={values.color} onChange={(next) => next && changeColor(next)} />}
    {(shapeTarget || textTarget) && <ColorField label={textTarget ? '背景色' : '塗り'} value={fillColor} allowNone onChange={changeFill} />}
    {(shapeTarget || textTarget) && <ColorField label="枠線の色" value={borderColor} allowNone onChange={changeBorder} />}
    {target && values && (simpleColorTarget || shapeTarget || textTarget) && <label>
      {textTarget ? '枠線の太さ' : '線の太さ'}
      <select aria-label={textTarget ? '枠線の太さ' : '線の太さ'} value={values.borderWidth} onChange={(event) => changeBorderWidth(Number(event.currentTarget.value))}>
        {(target === 'highlight' ? HIGHLIGHT_WIDTHS : textTarget ? TEXT_BORDER_WIDTHS : WIDTHS).map((value) => <option key={value} value={value}>{value} pt</option>)}
      </select>
    </label>}
    {shapeTarget && values && <label>
      透明度
      <select aria-label="透明度" value={values.opacity} onChange={(event) => changeOpacity(Number(event.currentTarget.value))}>
        <option value="1">100%</option><option value="0.5">50%</option><option value="0.25">25%</option>
      </select>
    </label>}
    {target === 'square' && <button type="button" className="whiteout-button" title="上に白い四角を重ねて見えなくします。下の文字やデータはファイルに残ります" onClick={makeWhiteout}>白塗りにする</button>}
    {textTarget && values && <>
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
    {target && <p className="format-target">{activeSelection ? '選択中の書き込み' : '次に作る書き込み'}</p>}
  </aside>
}
