import type { TakeoffRuleScopes } from '../core/takeoff/types'

let scopesPending: Promise<TakeoffRuleScopes> | undefined

export function loadRuleScopes(): Promise<TakeoffRuleScopes> {
  if (!scopesPending) {
    scopesPending = import('../core/takeoff/ruleScopes.data')
      .then(module => module.default)
      .catch(reason => {
        scopesPending = undefined
        throw reason
      })
  }

  return scopesPending
}
