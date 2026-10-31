import { useEffect, useState } from 'react'
import { ruleScopeText } from '../core/takeoff/master'
import type { RuleScope, TakeoffRuleScopes } from '../core/takeoff/types'
import { loadRuleScopes } from './takeoffModel'

interface Props {
  ruleIds: readonly string[]
}

export default function RuleScopeBlock({ ruleIds }: Props) {
  const [scopes, setScopes] = useState<TakeoffRuleScopes>()
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setError(false)

    void loadRuleScopes().then(value => {
      if (alive) setScopes(value)
    }).catch(() => {
      if (alive) setError(true)
    })

    return () => { alive = false }
  }, [attempt])

  if (error) return <small className="takeoff-error" role="alert">
    拾う対象の情報を読めませんでした
    <button type="button" onClick={() => setAttempt(value => value + 1)}>
      再試行
    </button>
  </small>

  if (!scopes) return null

  const entries = [...new Set(ruleIds)].flatMap(ruleId => {
    const scope = scopes.rules[ruleId]
    return scope ? [{ ruleId, scope }] : []
  })
  const [first, ...rest] = entries
  if (!first) return null

  const renderScope = ({ ruleId, scope }: {
    ruleId: string
    scope: RuleScope
  }) => {
    const text = (ref: Parameters<typeof ruleScopeText>[1]) =>
      ruleScopeText(scopes, ref)

    return <div key={ruleId}
      className="takeoff-rule-scope"
      data-takeoff-rule={ruleId}>
      <p><strong>拾う対象：</strong>{text(scope.target)}</p>
      <p><strong>関連元との違い：</strong>{text(scope.difference)}</p>
      <details>
        <summary>範囲の詳しい説明</summary>
        <p>面・線・位置：{text(scope.kind)}</p>
        <p>分け方：{text(scope.split)}</p>
        <p>含めない：{text(scope.exclude)}</p>
        <p>単位・扱い：{text(scope.unit)}</p>
        <p>関連元の範囲：{text(scope.originScope)}</p>
      </details>
    </div>
  }

  return <div className="takeoff-rule-scopes">
    {renderScope(first)}
    {rest.length > 0 && <details>
      <summary>ほか {rest.length}件</summary>
      {rest.map(renderScope)}
    </details>}
  </div>
}
