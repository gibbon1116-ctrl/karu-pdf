import { COPYRIGHT_NOTICE } from './AboutLicenses'

export function PublicationStopped() {
  return <main style={{ padding: '2rem', lineHeight: 1.8 }}>
    <p>かるPDF（通常版）は公開を終了しました。</p>
    <p>保存済みのPDFは、ほかのPDFソフトで開けます。</p>
    <p>{COPYRIGHT_NOTICE}</p>
  </main>
}
