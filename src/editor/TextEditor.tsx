import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import { CSS_PX_PER_PT } from '../viewer/pageLayout'
import type { EditableAnnotation } from './AnnotationStore'
import { AnnotationStore } from './AnnotationStore'

export interface TimingSummary {
  samples: number
  p95: number
  max: number
}

export interface FrameStats {
  drag: TimingSummary
  ink: TimingSummary
  input: TimingSummary
}

const emptyTiming = (): TimingSummary => ({ samples: 0, p95: 0, max: 0 })
const frameStats: FrameStats = { drag: emptyTiming(), ink: emptyTiming(), input: emptyTiming() }
const inputSamples: number[] = []
let activeTextInserter: ((text: string) => void) | null = null
const activeTextEditorListeners = new Set<() => void>()

export const subscribeActiveTextEditor = (listener: () => void): (() => void) => {
  activeTextEditorListeners.add(listener)
  return () => activeTextEditorListeners.delete(listener)
}

export const getActiveTextEditorSnapshot = (): boolean => activeTextInserter !== null

export function insertIntoActiveTextEditor(text: string): boolean {
  if (!activeTextInserter) return false
  activeTextInserter(text)
  return true
}

function setActiveTextInserter(inserter: ((text: string) => void) | null): void {
  activeTextInserter = inserter
  for (const listener of activeTextEditorListeners) listener()
}

function summarize(samples: readonly number[]): TimingSummary {
  if (samples.length === 0) return emptyTiming()
  const sorted = [...samples].sort((a, b) => a - b)
  return {
    samples: sorted.length,
    p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
    max: sorted[sorted.length - 1],
  }
}

export function beginDragFrameMeasurement(channel: 'drag' | 'ink' = 'drag'): (publish?: boolean) => void {
  const samples: number[] = []
  let previous = performance.now()
  let frame = 0
  let stopped = false
  const tick = (now: number) => {
    if (stopped) return
    samples.push(now - previous)
    previous = now
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
  return (publish = true) => {
    if (stopped) return
    stopped = true
    cancelAnimationFrame(frame)
    if (publish) frameStats[channel] = summarize(samples)
  }
}

export function recordInputFrame(): void {
  const started = performance.now()
  requestAnimationFrame((now) => {
    inputSamples.push(now - started)
    if (inputSamples.length > 500) inputSamples.splice(0, inputSamples.length - 500)
    frameStats.input = summarize(inputSamples)
  })
}

export function getFrameStats(): FrameStats {
  return {
    drag: { ...frameStats.drag },
    ink: { ...frameStats.ink },
    input: { ...frameStats.input },
  }
}

interface Props {
  annotation: EditableAnnotation
  zoom: number
  pool: PdfWorkerPool
  store: AnnotationStore
  onClose(removed: boolean): void
  registerCommit(commit: (() => Promise<void>) | null): void
}

export function TextEditor({ annotation, zoom, pool, store, onClose, registerCommit }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composingRef = useRef(false)
  const valueRef = useRef(annotation.text)
  const commitPromiseRef = useRef<Promise<void> | null>(null)
  const [value, setValue] = useState(annotation.text)
  const scale = zoom * CSS_PX_PER_PT

  const insertText = useCallback((text: string) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart ?? valueRef.current.length
    const end = textarea.selectionEnd ?? start
    const next = `${valueRef.current.slice(0, start)}${text}${valueRef.current.slice(end)}`
    valueRef.current = next
    setValue(next)
    recordInputFrame()
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(start + text.length, start + text.length)
    })
  }, [])

  const commit = useCallback((): Promise<void> => {
    if (commitPromiseRef.current) return commitPromiseRef.current
    const promise = (async () => {
      const text = valueRef.current
      const removed = text.length === 0
      if (text.length === 0) {
        store.remove(annotation.id)
      } else {
        const width = annotation.rect[2] - annotation.rect[0]
        const layout = await pool.layoutText(text, annotation.fontSize, width, annotation.font)
        store.updateText(annotation.id, text, layout, [
          annotation.rect[0],
          annotation.rect[1],
          annotation.rect[2],
          annotation.rect[1] + layout.height,
        ])
      }
      onClose(removed)
    })().finally(() => {
      commitPromiseRef.current = null
    })
    commitPromiseRef.current = promise
    return promise
  }, [annotation, onClose, pool, store])

  useEffect(() => {
    inputSamples.length = 0
    frameStats.input = emptyTiming()
  }, [])

  useEffect(() => {
    registerCommit(commit)
    return () => registerCommit(null)
  }, [commit, registerCommit])

  useEffect(() => {
    setActiveTextInserter(insertText)
    return () => {
      if (activeTextInserter === insertText) setActiveTextInserter(null)
    }
  }, [insertText])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (textareaRef.current?.contains(event.target as Node)) return
      if ((event.target as Element | null)?.closest('[data-text-symbol]')) return
      void commit()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [commit])

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = '0px'
    textarea.style.height = `${Math.max(annotation.rect[3] - annotation.rect[1], textarea.scrollHeight / scale) * scale}px`
  }, [annotation.rect, scale, value])

  useEffect(() => {
    textareaRef.current?.focus()
    textareaRef.current?.setSelectionRange(value.length, value.length)
  }, [])

  return (
    <textarea
      ref={textareaRef}
      className="text-editor"
      data-testid="text-editor"
      value={value}
      style={{
        left: annotation.rect[0] * scale,
        top: annotation.rect[1] * scale,
        width: (annotation.rect[2] - annotation.rect[0]) * scale,
        minHeight: (annotation.rect[3] - annotation.rect[1]) * scale,
        padding: `${2 * scale}px`,
        fontSize: annotation.fontSize * scale,
        fontFamily: annotation.font === 'BIZUDMincho' ? 'KaruBIZUDMincho' : 'KaruBIZUDGothic',
        color: `rgb(${annotation.color.map((component) => Math.round(component * 255)).join(' ')})`,
        background: annotation.interiorColor
          ? `rgb(${annotation.interiorColor.map((component) => Math.round(component * 255)).join(' ')})`
          : 'transparent',
        border: annotation.borderColor
          ? `${annotation.borderWidth * scale}px solid rgb(${annotation.borderColor.map((component) => Math.round(component * 255)).join(' ')})`
          : '0',
      }}
      onChange={(event) => {
        valueRef.current = event.currentTarget.value
        setValue(event.currentTarget.value)
        recordInputFrame()
      }}
      onCompositionStart={() => { composingRef.current = true }}
      onCompositionEnd={() => { composingRef.current = false }}
      onKeyDown={(event) => {
        const composing = composingRef.current || event.nativeEvent.isComposing
        if (composing && (event.key === 'Escape' || event.key === 'Enter')) return
        if (event.key === 'Escape' || (event.key === 'Enter' && event.ctrlKey)) {
          event.preventDefault()
          event.stopPropagation()
          void commit()
        }
      }}
    />
  )
}
