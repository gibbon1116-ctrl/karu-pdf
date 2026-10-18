import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import scopes from '../src/core/takeoff/ruleScopes.data'

let masterLoads = 0
let scopeLoads = 0

beforeEach(() => {
  vi.resetModules()
  masterLoads = 0
  scopeLoads = 0

  vi.doMock('../src/core/takeoff/master.data', () => {
    masterLoads += 1
    throw new Error('数量定義本体を読み込んではいけません。')
  })

  vi.doMock('../src/core/takeoff/ruleScopes.data', () => {
    scopeLoads += 1
    return { default: scopes }
  })
})

afterEach(() => {
  vi.doUnmock('../src/core/takeoff/master.data')
  vi.doUnmock('../src/core/takeoff/ruleScopes.data')
  vi.resetModules()
})

describe('takeoff lazy loading', () => {
  it('入口のimportだけでは生成データを読み込まない', async () => {
    const model = await import('../src/app/takeoffModel')

    expect(masterLoads).toBe(0)
    expect(scopeLoads).toBe(0)
    expect('loadTakeoffMaster' in model).toBe(false)
  })

  it('ルール範囲のPromiseと結果を共有し、数量定義本体は読み込まない', async () => {
    const model = await import('../src/app/takeoffModel')

    const first = model.loadRuleScopes()
    const second = model.loadRuleScopes()

    expect(first).toBe(second)

    const [firstScopes, secondScopes] = await Promise.all([first, second])

    expect(firstScopes).toBe(secondScopes)
    expect(firstScopes).toBe(scopes)
    expect(model.loadRuleScopes()).toBe(first)
    expect(scopeLoads).toBe(1)
    expect(masterLoads).toBe(0)
  })

  it('読込失敗中もPromiseを共有し、失敗後は再試行できる', async () => {
    const failure = new Error('scope import failed')

    vi.doMock('../src/core/takeoff/ruleScopes.data', () => {
      scopeLoads += 1
      throw failure
    })

    const model = await import('../src/app/takeoffModel')
    const failed = model.loadRuleScopes()

    expect(model.loadRuleScopes()).toBe(failed)
    await expect(failed).rejects.toBeInstanceOf(Error)
    expect(scopeLoads).toBe(1)

    vi.doMock('../src/core/takeoff/ruleScopes.data', () => {
      scopeLoads += 1
      return { default: scopes }
    })

    const retried = model.loadRuleScopes()

    expect(retried).not.toBe(failed)
    expect(model.loadRuleScopes()).toBe(retried)
    expect(await retried).toBe(scopes)
    expect(scopeLoads).toBe(2)
    expect(masterLoads).toBe(0)
  })
})
