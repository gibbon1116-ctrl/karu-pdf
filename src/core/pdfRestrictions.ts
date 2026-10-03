import type { PDFDocument, PDFObject } from 'mupdf'

export function pdfEditRestriction(document: PDFDocument): string | null {
  if (!document.hasPermission('edit') || !document.hasPermission('annotate')) return 'PDFの編集権限がないため閲覧専用です。'
  const trailer = document.getTrailer(), root = trailer.get('Root'), permission = root.get('Perms', 'DocMDP'), fields = root.get('AcroForm', 'Fields')
  try {
    if (!permission.isNull()) return '電子署名を保護するため閲覧専用です。署名の有効性は専用のPDFビューアで確認してください。'
    const seen = new Set<number>()
    let count = 0
    const signed = (field: PDFObject, inheritedType = ''): boolean => {
      if (++count > 10000) throw new Error('フォームの構造が複雑です。')
      if (field.isIndirect()) { const number = field.asIndirect(); if (seen.has(number)) return false; seen.add(number) }
      const type = field.get('FT'), value = field.get('V'), kids = field.get('Kids')
      try {
        const name = type.isName() ? type.asName() : inheritedType
        if (name === 'Sig' && !value.isNull()) return true
        for (let index = 0; index < kids.length; index++) {
          const child = kids.get(index)
          try { if (signed(child, name)) return true } finally { child.destroy() }
        }
        return false
      } finally { type.destroy(); value.destroy(); kids.destroy() }
    }
    for (let index = 0; index < fields.length; index++) {
      const field = fields.get(index)
      try { if (signed(field)) return '電子署名を保護するため閲覧専用です。署名の有効性は専用のPDFビューアで確認してください。' } finally { field.destroy() }
    }
    return null
  } catch { return '署名と編集権限を確認できないため閲覧専用です。' }
  finally { fields.destroy(); permission.destroy(); root.destroy(); trailer.destroy() }
}

export function assertEditablePdf(document: PDFDocument): void {
  const restriction = pdfEditRestriction(document)
  if (restriction) throw new Error(restriction)
}
