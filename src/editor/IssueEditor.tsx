import { useEffect, useRef } from 'react'
import type { EditableAnnotation, AnnotationStore } from './AnnotationStore'
import { CSS_PX_PER_PT } from '../viewer/pageLayout'

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
    registerCommit(async () => close())
    const outside = (event: PointerEvent) => { if (!input.current?.contains(event.target as Node)) close() }
    document.addEventListener('pointerdown', outside, true)
    return () => { registerCommit(null); document.removeEventListener('pointerdown', outside, true) }
  }, [])
  const scale = zoom * CSS_PX_PER_PT
  return <textarea ref={input} className="issue-editor" data-testid="issue-editor" aria-label="指摘の内容" defaultValue={annotation.text}
    style={{ left: annotation.rect[0] * scale, top: annotation.rect[3] * scale + 6 }}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing) return
      if (event.key === 'Enter' && event.ctrlKey) {
        event.preventDefault(); event.stopPropagation(); close()
      }
    }} />
}
