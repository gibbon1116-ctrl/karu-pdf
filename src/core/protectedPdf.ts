import mupdf from 'mupdf'
import { openDocument } from './mupdfDoc'
import { isValidPdfPassword } from './pdfPassword'

/** Encrypt a separate document so the editing baseline remains usable. */
export function protectPdf(bytes: Uint8Array, password: string, sourcePassword?: string): Uint8Array {
  if (!isValidPdfPassword(password)) throw new Error('パスワードは半角英数字・記号の1〜20文字で入力してください（空白不可）。')
  const document = openDocument(bytes, false, sourcePassword).document.asPDF()!
  try {
    const buffer = document.saveToBuffer({
      garbage: 1, compress: true, 'compress-images': true,
      encrypt: 'aes-256', 'user-password': password, 'owner-password': password,
    })
    try {
      const output = new Uint8Array(buffer.asUint8Array())
      const check = mupdf.Document.openDocument(output, 'application/pdf')
      try {
        if (!check.needsPassword() || !check.authenticatePassword(password) || check.countPages() !== document.countPages()) {
          throw new Error('パスワード付きPDFを検証できませんでした。')
        }
      } finally { check.destroy() }
      return output
    } finally { buffer.destroy() }
  } finally { document.destroy() }
}
