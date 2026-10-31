import { describe, expect, it } from 'vitest'
import mupdf, { type PDFPage } from 'mupdf'
import { generatePdfPassword, isValidPdfPassword } from '../src/core/pdfPassword'
import { protectPdf } from '../src/core/protectedPdf'
import { prepareDocumentOutput } from '../src/core/output'

function fixture(): Uint8Array {
  const doc = new mupdf.PDFDocument()
  try {
    const page = doc.addPage([0, 0, 300, 400], 0, {}, '')
    try { doc.insertPage(-1, page) } finally { page.destroy() }
    const buffer = doc.saveToBuffer('compress')
    try { return new Uint8Array(buffer.asUint8Array()) } finally { buffer.destroy() }
  } finally { doc.destroy() }
}

describe('PDF password protection', () => {
  it('generates 15 characters using all four character classes', () => {
    const passwords = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const password = generatePdfPassword()
      expect(password).toHaveLength(15)
      expect(isValidPdfPassword(password)).toBe(true)
      expect(password).toMatch(/[A-Z]/)
      expect(password).toMatch(/[a-z]/)
      expect(password).toMatch(/[0-9]/)
      expect(password).toMatch(/[^A-Za-z0-9]/)
      passwords.add(password)
    }
    expect(passwords.size).toBe(200)
  })

  it.each(['', 'a'.repeat(21), '日本語', 'ａｂｃ', 'abc def', 'abc\n', '\t', 'é'])('rejects unsupported input %j', password => {
    expect(isValidPdfPassword(password)).toBe(false)
    expect(() => protectPdf(new Uint8Array(), password)).toThrow('1〜20文字')
  })

  const symbols = Array.from({ length: 94 }, (_, i) => String.fromCharCode(i + 33)).filter(c => !/[a-z0-9]/i.test(c))
  it.each(['a', 'a'.repeat(20), 'Ab1,=\\"\'[]{}:!z', ...symbols])('opens only with the exact password %j', password => {
    const source = fixture()
    const output = protectPdf(source, password)
    const doc = mupdf.Document.openDocument(output, 'application/pdf')
    try {
      expect(doc.needsPassword()).toBe(true)
      expect(doc.authenticatePassword('wrong')).toBe(0)
      expect(doc.authenticatePassword(password)).not.toBe(0)
      expect(doc.countPages()).toBe(1)
      const page = doc.loadPage(0)
      try { expect(page.getBounds()).toEqual([0, 0, 300, 400]) } finally { page.destroy() }
      expect(doc.getMetaData('encryption')).toMatch(/AES|256/i)
    } finally { doc.destroy() }
    const original = mupdf.Document.openDocument(source, 'application/pdf')
    try { expect(original.needsPassword()).toBe(false) } finally { original.destroy() }
  })

  it('includes pending annotations without changing the source and keeps subsequent normal saves readable', () => {
    const source = fixture()
    const output = prepareDocumentOutput(source, [{ kind: 'createSquare', pageIndex: 0, rect: [10, 10, 30, 30], color: [1, 0, 0], borderWidth: 1 }], {}, false)
    const protectedBytes = protectPdf(output.bytes, 'Test,Password=123!')
    const doc = mupdf.Document.openDocument(protectedBytes, 'application/pdf')
    try {
      doc.authenticatePassword('Test,Password=123!')
      const page = doc.asPDF()!.loadPage(0) as PDFPage
      const annotations = page.getAnnotations()
      try { expect(annotations).toHaveLength(1) } finally { annotations.forEach(annotation => annotation.destroy()); page.destroy() }
    } finally { doc.destroy() }
    const normal = prepareDocumentOutput(source, [], {}, false)
    const reopened = mupdf.Document.openDocument(normal.bytes, 'application/pdf')
    try { expect(reopened.needsPassword()).toBe(false) } finally { reopened.destroy() }
  })
})
