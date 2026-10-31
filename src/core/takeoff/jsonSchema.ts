import { deepEqual } from './conditions'

export interface SchemaIssue {
  path: string
  keyword: string
  message: string
}

export interface SchemaOutcome {
  valid: boolean
  errors: SchemaIssue[]
  unsupported: SchemaIssue[]
  annotations: { path: string; keyword: string; value: unknown }[]
}

const KEYWORDS = new Set([
  '$schema', 'description', 'type', 'required', 'properties',
  'additionalProperties', 'const', 'enum', 'minLength', 'minimum',
  'exclusiveMinimum', 'items', 'minItems', 'uniqueItems',
  'allOf', 'if', 'then', 'else',
])

const TYPES = new Set([
  'string', 'number', 'integer', 'boolean', 'object', 'array', 'null',
])

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function has(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function propertyPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'null': return value === null
    case 'object': return record(value)
    case 'array': return Array.isArray(value)
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'integer': return typeof value === 'number'
      && Number.isFinite(value) && Number.isInteger(value)
    case 'string': return typeof value === 'string'
    case 'boolean': return typeof value === 'boolean'
    default: return false
  }
}

export function validateSchema(schema: unknown, value: unknown): SchemaOutcome {
  const errors: SchemaIssue[] = []
  const unsupported: SchemaIssue[] = []
  const annotations: SchemaOutcome['annotations'] = []

  function issue(
    target: SchemaIssue[],
    path: string,
    keyword: string,
    message: string,
  ): void {
    if (!target.some(entry =>
      entry.path === path && entry.keyword === keyword && entry.message === message,
    )) target.push({ path, keyword, message })
  }

  function malformed(path: string, keyword: string): void {
    issue(unsupported, path, keyword, `${keyword} のスキーマ指定に対応していません。`)
  }

  function walk(
    current: unknown,
    input: unknown,
    path: string,
    depth: number,
    check: boolean,
    target: SchemaIssue[],
  ): void {
    if (depth > 64) {
      issue(target, path, 'depth', '入れ子が深すぎます')
      return
    }

    if (typeof current === 'boolean') {
      if (check && !current) issue(target, path, 'false', '許可されない値です。')
      return
    }

    if (!record(current)) {
      malformed(path, 'schema')
      return
    }

    for (const [keyword, annotation] of Object.entries(current)) {
      if (keyword === 'description' || keyword.startsWith('x-')) {
        if (!annotations.some(entry =>
          entry.path === path && entry.keyword === keyword
          && deepEqual(entry.value, annotation),
        )) annotations.push({ path, keyword, value: annotation })
      } else if (!KEYWORDS.has(keyword)) {
        issue(unsupported, path, keyword, `未対応のキーワード ${keyword} です。`)
      }
    }

    if (has(current, 'type')) {
      const types = Array.isArray(current.type) ? current.type : [current.type]
      if (types.length === 0 || !types.every(type =>
        typeof type === 'string' && TYPES.has(type),
      )) {
        malformed(path, 'type')
      } else if (check && !types.some(type => matchesType(input, String(type)))) {
        issue(target, path, 'type', `${path || '値'} の型が ${types.join(' / ')} ではありません。`)
      }
    }

    if (check && has(current, 'const') && !deepEqual(input, current.const)) {
      issue(target, path, 'const', `${path || '値'} が指定値と一致しません。`)
    }

    if (has(current, 'enum')) {
      if (!Array.isArray(current.enum) || current.enum.length === 0) {
        malformed(path, 'enum')
      } else if (check && !current.enum.some(entry => deepEqual(input, entry))) {
        issue(target, path, 'enum', `${path || '値'} が選択肢にありません。`)
      }
    }

    for (const keyword of ['minLength', 'minItems'] as const) {
      if (!has(current, keyword)) continue
      const limit = current[keyword]
      if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 0) {
        malformed(path, keyword)
        continue
      }
      if (check && keyword === 'minLength'
        && typeof input === 'string' && [...input].length < limit) {
        issue(target, path, keyword, `${path || '値'} は${limit}文字以上で入力してください。`)
      }
      if (check && keyword === 'minItems'
        && Array.isArray(input) && input.length < limit) {
        issue(target, path, keyword, `${path || '値'} は${limit}件以上必要です。`)
      }
    }

    for (const keyword of ['minimum', 'exclusiveMinimum'] as const) {
      if (!has(current, keyword)) continue
      const limit = current[keyword]
      if (typeof limit !== 'number' || !Number.isFinite(limit)) {
        malformed(path, keyword)
        continue
      }
      if (check && typeof input === 'number' && Number.isFinite(input)
        && (keyword === 'minimum' ? input < limit : input <= limit)) {
        issue(
          target,
          path,
          keyword,
          `${path || '値'} は${limit}${keyword === 'minimum' ? '以上' : 'より大きい値'}が必要です。`,
        )
      }
    }

    if (has(current, 'uniqueItems')) {
      if (typeof current.uniqueItems !== 'boolean') {
        malformed(path, 'uniqueItems')
      } else if (check && current.uniqueItems && Array.isArray(input)) {
        input.forEach((entry, index) => {
          if (input.slice(0, index).some(previous => deepEqual(previous, entry))) {
            issue(target, `${path}[${index}]`, 'uniqueItems', '配列の要素が重複しています。')
          }
        })
      }
    }

    if (has(current, 'required')) {
      if (!Array.isArray(current.required)
        || !current.required.every(key => typeof key === 'string')) {
        malformed(path, 'required')
      } else if (check && record(input)) {
        for (const key of current.required as string[]) {
          if (!has(input, key)) {
            issue(
              target,
              propertyPath(path, key),
              'required',
              `${propertyPath(path, key)} が未入力です。`,
            )
          }
        }
      }
    }

    let properties: Readonly<Record<string, unknown>> = {}
    if (has(current, 'properties')) {
      if (!record(current.properties)) {
        malformed(path, 'properties')
      } else {
        properties = current.properties
        for (const [key, child] of Object.entries(properties)) {
          const present = record(input) && has(input, key)
          walk(
            child,
            present ? input[key] : undefined,
            propertyPath(path, key),
            depth + 1,
            check && present,
            target,
          )
        }
      }
    }

    if (has(current, 'additionalProperties')) {
      const additional = current.additionalProperties
      if (typeof additional !== 'boolean' && !record(additional)) {
        malformed(path, 'additionalProperties')
      } else {
        const extraKeys = record(input)
          ? Object.keys(input).filter(key => !has(properties, key))
          : []
        if (additional === false) {
          if (check) {
            for (const key of extraKeys) {
              issue(target, propertyPath(path, key), 'additionalProperties', '定義されていない項目です。')
            }
          }
        } else if (record(additional)) {
          if (extraKeys.length === 0) {
            walk(additional, undefined, path, depth + 1, false, target)
          } else {
            for (const key of extraKeys) {
              walk(
                additional,
                record(input) ? input[key] : undefined,
                propertyPath(path, key),
                depth + 1,
                check,
                target,
              )
            }
          }
        }
      }
    }

    if (has(current, 'items')) {
      const items = current.items
      if (!record(items) && typeof items !== 'boolean') {
        malformed(path, 'items')
      } else if (Array.isArray(input) && input.length > 0) {
        input.forEach((entry, index) =>
          walk(items, entry, `${path}[${index}]`, depth + 1, check, target),
        )
      } else {
        // 値がない場合も未対応キーワードを検出する。
        walk(items, undefined, `${path}[0]`, depth + 1, false, target)
      }
    }

    if (has(current, 'allOf')) {
      if (!Array.isArray(current.allOf) || current.allOf.length === 0) {
        malformed(path, 'allOf')
      } else {
        for (const child of current.allOf) {
          walk(child, input, path, depth + 1, check, target)
        }
      }
    }

    if (has(current, 'if')) {
      const conditionErrors: SchemaIssue[] = []
      const unsupportedBefore = unsupported.length
      walk(current.if, input, path, depth + 1, check, conditionErrors)
      const conditionKnown = unsupported.length === unsupportedBefore
      const conditionMatches = conditionErrors.length === 0

      if (has(current, 'then')) {
        walk(
          current.then,
          input,
          path,
          depth + 1,
          check && conditionKnown && conditionMatches,
          target,
        )
      }
      if (has(current, 'else')) {
        walk(
          current.else,
          input,
          path,
          depth + 1,
          check && conditionKnown && !conditionMatches,
          target,
        )
      }
      // if 自体の値の不一致は errors に加えない。
      for (const entry of conditionErrors) {
        if (entry.keyword === 'depth') {
          issue(target, entry.path, entry.keyword, entry.message)
        }
      }
    } else {
      // then / else 単独は適用しないが、その内部の能力不足は検出する。
      for (const keyword of ['then', 'else'] as const) {
        if (has(current, keyword)) {
          walk(current[keyword], input, path, depth + 1, false, target)
        }
      }
    }
  }

  walk(schema, value, '', 0, true, errors)
  return {
    valid: errors.length === 0 && unsupported.length === 0,
    errors,
    unsupported,
    annotations,
  }
}
