export interface RelatedSessionState {
  originIds: readonly string[]
  closed: boolean
}

export interface RelatedSessionMemory {
  subscribe(listener: () => void): () => void
  getSnapshot(): RelatedSessionState
  update(patch: Partial<RelatedSessionState>): void
}

const sessions = new WeakMap<object, RelatedSessionMemory>()

/** PDF データ・保存形式・Undo には入れない。パネルの再マウントでも保持する。 */
export function relatedSessionMemory(session: object): RelatedSessionMemory {
  let memory = sessions.get(session)
  if (memory) return memory

  let state: RelatedSessionState = {
    originIds: [],
    closed: false,
  }
  const listeners = new Set<() => void>()
  memory = {
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot: () => state,
    update(patch) {
      state = { ...state, ...patch }
      listeners.forEach(listener => listener())
    },
  }
  sessions.set(session, memory)
  return memory
}
