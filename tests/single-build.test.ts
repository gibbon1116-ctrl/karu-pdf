import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'

it('単一 HTML の監査は正確な base64 領域だけを除外し、ほかの通信を検出する', () => {
  const dir = fs.mkdtempSync('scripts/.single-audit-'), file = `${dir}/payload.html`, allow = `${dir}/allow.json`
  try {
    fs.writeFileSync(allow, '[]')
    const run = () => spawnSync(process.execPath, ['scripts/audit-network.mjs', '--single', `--file=${file}`, `--allowlist=${allow}`], { encoding: 'utf8' })
    const data = 'googleapis////=='
    fs.writeFileSync(file, `<script type="text/plain" id="single-wasm" data-encoding="base64">${data}</script><script>const value=1</script>`)
    expect(run().status).toBe(0)
    fs.appendFileSync(file, `<script>fetch('https://example.com/private')</script>`)
    expect(run().status).toBe(1); expect(run().stderr).toContain('https://example.com/private')
    for (const content of [
      `<script type="text/plain" id="other" data-encoding="base64">${data}</script>`,
      `<script type="text/plain" id="single-wasm" data-encoding="base64">${data};fetch('/secret')</script>`,
    ]) { fs.writeFileSync(file, content); expect(run().status).toBe(1) }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

it('配布領域は入れ子でも版ごとに除去し、通常版・固定版には single のコードを残さない', () => {
  const source = `import {selectRegions} from './scripts/single-worker.mjs';
    const code='/* @server:start */SERVER/* @fixed:start */FIXED/* @fixed:end *//* @server:end *//* @single:start */SINGLE/* @single:end *//* @pages:start */PAGES/* @pages:end */';
    console.log(JSON.stringify(['pages','fixed','single'].map(mode=>selectRegions(code,mode))));`
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8' })
  expect(result.status).toBe(0); expect(JSON.parse(result.stdout)).toEqual(['SERVERPAGES', 'SERVERFIXED', 'SINGLE'])
})
