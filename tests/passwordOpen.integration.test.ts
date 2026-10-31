import { describe, expect, it } from 'vitest'
import mupdf, { type PDFPage } from 'mupdf'
import { openDocument } from '../src/core/mupdfDoc'
import { PdfPasswordError } from '../src/core/passwordAccess'
import { saveDocument } from '../src/core/save'
import { applyAndSaveAtomically } from '../src/core/editTransaction'
import { prepareDocumentOutput } from '../src/core/output'
import { protectPdf } from '../src/core/protectedPdf'

const password = 'Ab1,=\\"\'[]{}:!z'
function fixture(restricted = false, encryption = 'aes-256', userPassword = password): Uint8Array {
  const doc = new mupdf.PDFDocument()
  try {
    const page = doc.addPage([0, 0, 300, 400], 0, {}, '')
    try { doc.insertPage(-1, page) } finally { page.destroy() }
    const buffer = doc.saveToBuffer({ encrypt: encryption, 'user-password': userPassword,
      'owner-password': restricted ? 'separate-owner' : userPassword, ...(restricted ? { permissions: 4 } : {}) })
    try { return new Uint8Array(buffer.asUint8Array()) } finally { buffer.destroy() }
  } finally { doc.destroy() }
}

describe('password PDF access', () => {
  it('distinguishes a missing and incorrect password without exposing it', () => {
    const bytes = fixture()
    for (const [supplied, code] of [[undefined, 'password-required'], ['', 'incorrect-password'], ['wrong', 'incorrect-password']] as const) {
      try { openDocument(bytes, true, supplied); throw new Error('expected failure') }
      catch (error) {
        expect(error).toBeInstanceOf(PdfPasswordError)
        expect((error as PdfPasswordError).code).toBe(code)
        expect(String(error)).not.toContain(password)
      }
    }
  })

  it('authenticates, reads geometry, and preserves encryption in full and incremental saves', () => {
    const opened = openDocument(fixture(), true, password)
    try {
      expect(opened.pageSizes).toEqual([{ width: 300, height: 400 }])
      expect(opened.editRestriction).toBeNull()
      for (const mode of ['incremental', 'full'] as const) {
        const saved = saveDocument(opened.document.asPDF()!, mode)
        expect(() => openDocument(saved.bytes)).toThrow(PdfPasswordError)
        const reopened = openDocument(saved.bytes, true, password)
        try { expect(reopened.pageCount).toBe(1) } finally { reopened.document.destroy() }
      }
    } finally { opened.document.destroy() }
  })

  it.each(['rc4-40', 'rc4-128', 'aes-128', 'aes-256'])('opens existing %s PDFs', encryption => {
    const opened = openDocument(fixture(false, encryption), true, password)
    try { expect(opened.pageCount).toBe(1) } finally { opened.document.destroy() }
  })

  it('accepts existing Unicode passwords longer than the save dialog limit', () => {
    const existingPassword = '既存PDFのパスワード' + 'a'.repeat(25)
    const opened = openDocument(fixture(false, 'aes-256', existingPassword), true, existingPassword)
    try { expect(opened.pageCount).toBe(1) } finally { opened.document.destroy() }
  })

  it('keeps restricted PDFs read-only after user authentication', () => {
    const bytes = fixture(true)
    const opened = openDocument(bytes, true, password)
    try {
      expect(opened.editRestriction).toContain('編集権限')
      expect(() => applyAndSaveAtomically(opened.document.asPDF()!, [], {}, 'full')).toThrow('編集権限')
    } finally { opened.document.destroy() }
    expect(() => prepareDocumentOutput(bytes, [], {}, true, password)).toThrow('編集権限')
  })

  it('edits, reopens a saved baseline, prepares output, and changes the output password', () => {
    const opened = openDocument(fixture(), true, password)
    try {
      const result = applyAndSaveAtomically(opened.document.asPDF()!, [
        { kind: 'createSquare', pageIndex: 0, rect: [10, 10, 30, 30], color: [1, 0, 0], borderWidth: 1 },
      ], {}, 'full')
      try {
        const page = result.opened.document.asPDF()!.loadPage(0) as PDFPage
        const annotations = page.getAnnotations()
        try { expect(annotations).toHaveLength(1) } finally { annotations.forEach(a => a.destroy()); page.destroy() }
        const next = applyAndSaveAtomically(result.opened.document.asPDF()!, [], {}, 'incremental')
        next.opened.document.destroy()
        const output = prepareDocumentOutput(next.saved.bytes, [], {}, true, password)
        const changed = protectPdf(output.bytes, 'New-Password123', password)
        expect(() => openDocument(changed, true, password)).toThrow('パスワードが違います')
        const check = openDocument(changed, true, 'New-Password123')
        check.document.destroy()
      } finally { result.opened.document.destroy() }
    } finally { opened.document.destroy() }
  })
})
