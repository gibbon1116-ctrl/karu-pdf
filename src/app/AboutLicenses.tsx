import type { ReactNode } from 'react'
/* @single:start */import { useRef, useState } from 'react'
/* @single:end */

export const COPYRIGHT_NOTICE = 'Copyright (C) 2026 gibbon1116-ctrl'

export function AboutLicenses() {
  let build: { sourceRepository: string; gitCommit: string }
  let legalLinks: ReactNode
  /* @pages:start */
  build = __PAGES_BUILD__
  legalLinks = <>
    <a href={import.meta.env.BASE_URL + 'licenses/LICENSE.txt'} target="_blank" rel="noopener">ライセンス</a>{' '}
    <a href={import.meta.env.BASE_URL + 'licenses/THIRD_PARTY_LICENSES.txt'} target="_blank" rel="noopener">第三者ライセンス</a>{' '}
    <a href={import.meta.env.BASE_URL + 'licenses/DATA_SOURCES.txt'} target="_blank" rel="noopener">データ出典</a>
  </>
  /* @pages:end */
  /* @fixed:start */
  build = __FIXED_BUILD__
  legalLinks = <>
    <a href={import.meta.env.BASE_URL + 'licenses/LICENSE.txt'} target="_blank" rel="noopener">ライセンス</a>{' '}
    <a href={import.meta.env.BASE_URL + 'licenses/THIRD_PARTY_LICENSES.txt'} target="_blank" rel="noopener">第三者ライセンス</a>{' '}
    <a href={import.meta.env.BASE_URL + 'licenses/DATA_SOURCES.txt'} target="_blank" rel="noopener">データ出典</a>
  </>
  /* @fixed:end */
  /* @single:start */
  build = __SINGLE_BUILD__
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [licenseText, setLicenseText] = useState({ title: '', text: '' })
  const showLicense = (id: string, title: string) => {
    setLicenseText({ title, text: document.getElementById(id)?.textContent ?? '' })
    dialogRef.current?.showModal()
  }
  legalLinks = <>
    <button type="button" onClick={() => showLicense('single-license', 'ライセンス')}>ライセンス</button>{' '}
    <button type="button" onClick={() => showLicense('single-third-party-licenses', '第三者ライセンス')}>第三者ライセンス</button>{' '}
    <button type="button" onClick={() => showLicense('single-data-sources', 'データ出典')}>データ出典</button>
  </>
  /* @single:end */
  const { sourceRepository, gitCommit } = build
  const sourceURL = gitCommit === 'unknown' ? sourceRepository : sourceRepository + '/tree/' + gitCommit

  return <>
    <p>{COPYRIGHT_NOTICE}</p>
    <p><span>AGPL-3.0-or-later・無保証</span>{' '}{legalLinks}</p>
    <p style={{ overflowWrap: 'anywhere' }}>ソースコード:{' '}
      {/* @pages:start */}<a href={sourceURL} target="_blank" rel="noopener noreferrer">{sourceURL}</a>{/* @pages:end */}
      {/* @fixed:start */}<span style={{ userSelect: 'text' }}>{sourceURL}</span>{/* @fixed:end */}
      {/* @single:start */}<span style={{ userSelect: 'text' }}>{sourceURL}</span>{/* @single:end */}
    </p>
    <p>基準データは国土交通省等の公開資料を作成者が加工したものです。</p>
    {/* @single:start */}
    <dialog ref={dialogRef} aria-label={licenseText.title} onCancel={event => event.stopPropagation()} onClose={event => event.stopPropagation()} style={{ maxWidth: 'min(90vw, 60rem)' }}>
      <pre style={{ maxHeight: '60vh', overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '0.9em' }}>{licenseText.text}</pre>
      <button type="button" onClick={() => dialogRef.current?.close()}>閉じる</button>
    </dialog>
    {/* @single:end */}
  </>
}
