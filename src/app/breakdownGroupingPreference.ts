const GROUP_BY_BREAKDOWN_KEY = 'karu-pdf:group-by-breakdown'
const LEGACY_TABLE_KEY = 'karu-pdf:quantity-table-group-by-breakdown-v2'
const LEGACY_PANEL_KEY = 'karu-pdf:fixture-panel-group-by-breakdown'

let currentValue: boolean | undefined
const listeners = new Set<() => void>()

export function getGroupByBreakdown(): boolean {
  if (currentValue !== undefined) return currentValue

  currentValue = true
  try {
    const storage = localStorage
    const saved = storage.getItem(GROUP_BY_BREAKDOWN_KEY)
    if (saved !== null) {
      currentValue = saved !== 'false'
    } else {
      currentValue = storage.getItem(LEGACY_TABLE_KEY) !== 'false'
        && storage.getItem(LEGACY_PANEL_KEY) !== 'false'
      storage.setItem(GROUP_BY_BREAKDOWN_KEY, String(currentValue))
    }
  } catch {
    // Keep the memory value, including a migrated value if only writing failed.
  }
  return currentValue
}

export function setGroupByBreakdown(value: boolean): void {
  const previous = getGroupByBreakdown()
  currentValue = value
  try {
    localStorage.setItem(GROUP_BY_BREAKDOWN_KEY, String(value))
  } catch {
    // The shared preference remains usable without persistent storage.
  }
  if (previous !== value) {
    for (const listener of [...listeners]) listener()
  }
}

export function subscribeGroupByBreakdown(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
