export const MAX_PDF_PASSWORD_LENGTH = 20

export function isValidPdfPassword(password: string): boolean {
  return /^[\x21-\x7e]{1,20}$/.test(password)
}

/** Uniform sampling with Web Crypto; never use Math.random for passwords. */
function randomIndex(limit: number): number {
  const bytes = new Uint8Array(1)
  const ceiling = 256 - 256 % limit
  do { crypto.getRandomValues(bytes) } while (bytes[0] >= ceiling)
  return bytes[0] % limit
}

export function generatePdfPassword(): string {
  const groups = ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '0123456789', '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~']
  const alphabet = groups.join('')
  // Rejection sampling keeps every eligible 15-character password equally likely.
  for (;;) {
    const password = Array.from({ length: 15 }, () => alphabet[randomIndex(alphabet.length)]).join('')
    if (groups.every(group => [...password].some(char => group.includes(char)))) return password
  }
}
