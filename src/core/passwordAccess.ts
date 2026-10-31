export type PasswordErrorCode = 'password-required' | 'incorrect-password'

export class PdfPasswordError extends Error {
  constructor(readonly code: PasswordErrorCode) {
    super(code === 'password-required' ? 'このPDFを開くにはパスワードが必要です。' : 'パスワードが違います。もう一度入力してください。')
    this.name = 'PdfPasswordError'
  }
}

export type RequestPdfPassword = (incorrect: boolean) => Promise<string | null>
