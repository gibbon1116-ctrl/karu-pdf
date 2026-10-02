import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'

it('監査 CLI の終了コード、文字列、行、許可の範囲を実ファイルで検査する', () => {
  const dir = fs.mkdtempSync('scripts/.audit-test-'), file = `${dir}/payload.js`, allow = `${dir}/allow.json`
  try {
    const run = () => spawnSync(process.execPath, ['scripts/audit-network.mjs', `--file=${file}`, `--allowlist=${allow}`], { encoding: 'utf8' })
    fs.writeFileSync(allow, '[]')
    for (const payload of ["fetch('https://external.example/private')", "navigator.sendBeacon('/karu-pdf/', 'secret')", "new WebSocket('//external.example/socket')"]) {
      fs.writeFileSync(file, '\n' + payload)
      const result = run(); expect(result.status).toBe(1); expect(result.stderr).toContain(`${file}:2`)
    }
    const namespace = 'http://www.w3.org/2000/svg'
    fs.writeFileSync(allow, JSON.stringify([{ file, string: namespace, reason: 'SVG namespace', maxOccurrences: 1 }]))
    fs.writeFileSync(file, `const ns = '${namespace}'`); expect(run().status).toBe(0)
    fs.appendFileSync(file, '\nnavigator.sendBeacon("/", "secret")'); expect(run().status).toBe(1)
    fs.writeFileSync(file, `const a='${namespace}', b='${namespace}'`); expect(run().status).toBe(1)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
