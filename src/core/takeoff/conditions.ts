export type Truth = 'true' | 'false' | 'unknown'

export interface ConditionOutcome {
  truth: Truth
  unsupported: string[]
  unknownFields: string[]
  falseFields: string[]
}

export function isMissingFact(value: unknown): boolean {
  return value === undefined
    || value === null
    || (typeof value === 'string' && value.trim() === '')
    || (Array.isArray(value) && value.length === 0)
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function has(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

/** オブジェクトの列挙順に依存せず、継承プロパティを比較しない。 */
export function deepEqual(left: unknown, right: unknown): boolean {
  const visited = new WeakMap<object, WeakSet<object>>()

  function equal(a: unknown, b: unknown): boolean {
    if (Object.is(a, b) || a === b) return true
    if (typeof a !== 'object' || a === null
      || typeof b !== 'object' || b === null) return false
    if (Array.isArray(a) !== Array.isArray(b)) return false
    if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false

    let partners = visited.get(a)
    if (partners?.has(b)) return true
    if (!partners) {
      partners = new WeakSet<object>()
      visited.set(a, partners)
    }
    partners.add(b)

    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((value, index) =>
        has(a, String(index)) === has(b, String(index))
        && equal(value, b[index]),
      )
    }

    const aRecord = a as Readonly<Record<string, unknown>>
    const bRecord = b as Readonly<Record<string, unknown>>
    const keys = Object.keys(aRecord)
    return keys.length === Object.keys(bRecord).length
      && keys.every(key => has(bRecord, key) && equal(aRecord[key], bRecord[key]))
  }

  return equal(left, right)
}

export function evaluateCondition(
  node: unknown,
  facts: Readonly<Record<string, unknown>>,
): ConditionOutcome {
  const unsupported: string[] = []
  const unknownFields: string[] = []
  const falseFields: string[] = []

  function append(list: string[], value: string): void {
    if (!list.includes(value)) list.push(value)
  }

  function unsupportedNode(message: string): Truth {
    append(unsupported, message)
    return 'unknown'
  }

  function visit(value: unknown, depth: number): Truth {
    if (depth > 64) return unsupportedNode('条件の入れ子が深すぎます')
    if (!record(value)) return unsupportedNode('未対応の条件ノードです')

    const hasAll = has(value, 'all')
    const hasAny = has(value, 'any')

    if (hasAll || hasAny) {
      if ((hasAll && hasAny) || has(value, 'field') || has(value, 'op')) {
        return unsupportedNode('条件ノードの all / any / field が競合しています')
      }
      const children = hasAll ? value.all : value.any
      if (!Array.isArray(children)) {
        return unsupportedNode('all / any は条件ノードの配列で指定してください')
      }
      const truths = children.map(child => visit(child, depth + 1))
      if (hasAll) {
        return truths.includes('false')
          ? 'false'
          : truths.every(truth => truth === 'true') ? 'true' : 'unknown'
      }
      return truths.includes('true')
        ? 'true'
        : truths.every(truth => truth === 'false') ? 'false' : 'unknown'
    }

    if (!has(value, 'field') || typeof value.field !== 'string'
      || value.field.trim() === '' || !has(value, 'op')) {
      return unsupportedNode('未対応の条件ノードです')
    }

    const field = value.field
    const op = value.op
    if (op !== 'eq' && op !== 'in' && op !== 'contains') {
      return unsupportedNode(`未対応の演算子 ${String(op)}（field=${field}）`)
    }

    let candidates: readonly unknown[] = []
    if (op === 'in') {
      const candidateValue = has(value, 'values') ? value.values : value.value
      if (!Array.isArray(candidateValue)) {
        return unsupportedNode(`in の比較対象が配列ではありません（field=${field}）`)
      }
      candidates = candidateValue
    } else if (!has(value, 'value')) {
      return unsupportedNode(`${op} の比較値がありません（field=${field}）`)
    }

    const fact = has(facts, field) ? facts[field] : undefined
    if (isMissingFact(fact)) {
      append(unknownFields, field)
      return 'unknown'
    }

    const matched = op === 'eq'
      ? deepEqual(fact, value.value)
      : op === 'in'
        ? candidates.some(candidate => deepEqual(fact, candidate))
        : Array.isArray(fact) && fact.some(entry => deepEqual(entry, value.value))

    if (!matched) append(falseFields, field)
    return matched ? 'true' : 'false'
  }

  return { truth: visit(node, 0), unsupported, unknownFields, falseFields }
}
