import type { DocumentSession } from './documentModel'

interface Props {
  documents: readonly DocumentSession[]
  activeDocId: string | null
  onActivate(docId: string): void
  onClose(docId: string): void
  onOpen(): void
}

export function DocumentTabs({ documents, activeDocId, onActivate, onClose, onOpen }: Props) {
  return (
    <nav className="document-tabs" aria-label="開いているPDF">
      {documents.map((document) => (
        <div
          key={document.docId}
          className={`document-tab${document.docId === activeDocId ? ' active' : ''}`}
          data-testid={`document-tab-${document.docId}`}
        >
          <button
            type="button"
            className="document-tab-name"
            title={document.name}
            aria-current={document.docId === activeDocId ? 'page' : undefined}
            onClick={() => onActivate(document.docId)}
          >
            <span>{document.name}</span>{document.dirty && <span aria-label="未保存"> ●</span>}
          </button>
          <button
            type="button"
            className="document-tab-close"
            aria-label={`${document.name}を閉じる`}
            title="閉じる"
            onClick={() => onClose(document.docId)}
          >×</button>
        </div>
      ))}
      <button type="button" className="document-tab-add" aria-label="PDFを開く" title="PDFを開く" onClick={onOpen}>＋</button>
    </nav>
  )
}
