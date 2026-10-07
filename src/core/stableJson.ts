// Comparison only: leave the JSON written into the PDF in its existing format.
// Object properties follow JSON's rules; array positions (including nulls) stay intact.
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return item
    const record = item as Record<string, unknown>
    return Object.fromEntries(Object.keys(record).sort().filter(key => record[key] !== undefined).map(key => [key, record[key]]))
  }) ?? 'null'
}
