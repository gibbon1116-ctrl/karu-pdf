export interface Snippet { label: string; text: string }
export const SNIPPET_KEY = 'karu-pdf:snippets'
export const BUILTIN_SNIPPETS: readonly Snippet[] = [
  { label: '寸法確認', text: '寸法を確認してください。' },
  { label: '納まり確認', text: '納まりを確認してください。' },
  { label: '図面整合', text: '関連図面との整合を確認してください。' },
  { label: '施工前確認', text: '施工前に現地を確認してください。' },
  { label: '再提出', text: '修正後、再提出してください。' },
]
export function validSnippets(value: unknown): Snippet[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Snippet => item && typeof item.label === 'string' && item.label.trim().length > 0 && item.label.length <= 80 && typeof item.text === 'string' && item.text.trim().length > 0 && item.text.length <= 500).slice(0, 20 - BUILTIN_SNIPPETS.length).map(item => ({ label: item.label, text: item.text }))
}
export function loadSnippets(): Snippet[] {
  try { return validSnippets(JSON.parse(localStorage.getItem(SNIPPET_KEY) ?? '[]')) } catch { return [] }
}
export function saveSnippets(items: readonly Snippet[], remember: boolean): void {
  if (remember) localStorage.setItem(SNIPPET_KEY, JSON.stringify(validSnippets(items)))
  else localStorage.removeItem(SNIPPET_KEY)
}
