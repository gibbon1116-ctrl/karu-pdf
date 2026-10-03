import { useEffect, useRef } from 'react'
import type { EditableAnnotation, AnnotationStore } from './AnnotationStore'
import { CSS_PX_PER_PT } from '../viewer/pageLayout'
import { setActiveTextInserter, setTextEditorComposing } from './TextEditor'

export function IssueEditor({ annotation, store, zoom, onClose, registerCommit }: {
  annotation: EditableAnnotation; store: AnnotationStore; zoom: number; onClose(): void;
  registerCommit(commit: (() => Promise<void>) | null): void
}) {
  const input = useRef<HTMLTextAreaElement>(null)
  const finished = useRef(false)
  const close = () => {
    if (finished.current) return
    finished.current = true
    store.updateIssueText(annotation.id, input.current?.value ?? annotation.text)
    onClose()
  }
  useEffect(() => {
    input.current?.focus()
    setTextEditorComposing(false)
    setActiveTextInserter(text => {
      const textarea = input.current
      if (!textarea) return
      textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, 'end')
      textarea.focus()
    })
    registerCommit(async () => close())
    const outside = (event: PointerEvent) => { if (!(event.target as Element | null)?.closest('[data-text-symbol]') && !input.current?.contains(event.target as Node)) close() }
    document.addEventListener('pointerdown', outside, true)
    return () => { setActiveTextInserter(null); setTextEditorComposing(false); registerCommit(null); document.removeEventListener('pointerdown', outside, true) }
  }, [])
  const scale = zoom * CSS_PX_PER_PT
  return <textarea ref={input} className="issue-editor" data-testid="issue-editor" aria-label="指摘の内容" defaultValue={annotation.text}
    onCompositionStart={() => setTextEditorComposing(true)} onCompositionEnd={() => setTextEditorComposing(false)}
    style={{ left: annotation.rect[0] * scale, top: annotation.rect[3] * scale + 6 }}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing) return
      if (event.key === 'Enter' && event.ctrlKey) {
        event.preventDefault(); event.stopPropagation(); close()
      }
    }} />
}
