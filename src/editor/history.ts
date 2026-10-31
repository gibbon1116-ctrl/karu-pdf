export interface HistoryStep<T> {
  before: T
  after: T
}

export class History<T> {
  private undoStack: HistoryStep<T>[] = []
  private redoStack: HistoryStep<T>[] = []

  constructor(private readonly limit = 100) {}

  get canUndo(): boolean { return this.undoStack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }
  get undoCount(): number { return this.undoStack.length }
  get redoCount(): number { return this.redoStack.length }

  push(step: HistoryStep<T>): void {
    this.undoStack.push(step)
    if (this.undoStack.length > this.limit) this.undoStack.splice(0, this.undoStack.length - this.limit)
    this.redoStack = []
  }

  replaceLast(expected: HistoryStep<T>, step: HistoryStep<T>): boolean {
    if (this.undoStack.at(-1) !== expected) return false
    this.undoStack[this.undoStack.length - 1] = step
    this.redoStack = []
    return true
  }

  undo(): HistoryStep<T> | null {
    const step = this.undoStack.pop()
    if (!step) return null
    this.redoStack.push(step)
    return step
  }

  redo(): HistoryStep<T> | null {
    const step = this.redoStack.pop()
    if (!step) return null
    this.undoStack.push(step)
    return step
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }

  map(mapper: (step: HistoryStep<T>) => HistoryStep<T>): void {
    this.undoStack = this.undoStack.map(mapper)
    this.redoStack = this.redoStack.map(mapper)
  }
}
