import { useLayoutEffect, useRef } from 'react'

export interface PdfOpening {
  id: number
  name: string
  stage: 'reading' | 'opening' | 'displaying'
  docId: string | null
}

// This transient indicator owns its visibility and filename tooltip. Notifications must
// not flush React's pending workspace updates while a PDF opens or first paints.
// It has no timers, PDF dependencies, or work while a file is not opening.
export class PdfOpeningStore {
  private value: Pick<PdfOpening, 'id' | 'name'> | null = null
  private readonly listeners = new Set<() => void>()
  readonly snapshot = () => this.value
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  set(value: PdfOpening | null): void {
    // Internal stage/document guards live in App. Updating those fields must
    // not schedule a synchronous React commit while the workspace mounts.
    if (this.value?.id === value?.id && this.value?.name === value?.name) return
    this.value = value ? { id: value.id, name: value.name } : null
    for (const listener of this.listeners) listener()
  }
}

export function PdfOpeningFeedback({ store }: { store: PdfOpeningStore }) {
  const container = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const update = () => {
      const opening = store.snapshot()
      if (container.current) {
        container.current.title = opening?.name ?? ''
        container.current.hidden = !opening
      }
    }
    update()
    return store.subscribe(update)
  }, [store])
  return <div ref={container} hidden className="pdf-opening" data-testid="pdf-opening" role="status" aria-live="polite" aria-atomic="true">
    <span className="pdf-opening-spinner" aria-hidden="true" />
    <span>PDFを開いています</span>
  </div>
}
