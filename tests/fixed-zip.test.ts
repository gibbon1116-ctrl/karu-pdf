import fs from 'node:fs'
import { expect, it } from 'vitest'
import { createZip, extractZip, sha256, verifySums } from '../scripts/fixed-zip.mjs'

it('ZIP を展開して実バイトとハッシュを確認し、改ざんとパス逸脱を拒否する', () => {
  const dir = fs.mkdtempSync('scripts/.zip-test-')
  try {
    const payload = Buffer.from('fixed release\n'), entries = new Map([['assets/a.txt', payload], ['SHA256SUMS.txt', Buffer.from(`${sha256(payload)}  assets/a.txt\n`)]])
    const zip = createZip(entries), names = extractZip(zip, dir)
    expect(fs.readFileSync(`${dir}/assets/a.txt`)).toEqual(payload)
    expect(verifySums(dir, names)).toBe(1)
    fs.writeFileSync(`${dir}/assets/a.txt`, 'tampered'); expect(() => verifySums(dir, names)).toThrow('SHA-256 mismatch')
    const bad = Buffer.from(zip); bad[bad.length - 6] ^= 1
    expect(() => extractZip(bad, dir)).toThrow()
    expect(() => extractZip(createZip(new Map([['../escape.txt', payload]])), dir)).toThrow('Unsafe ZIP entry')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
