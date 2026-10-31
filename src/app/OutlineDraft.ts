import { buildOutlineApplyPlan, findOutlineItem, flattenOutline, indentOutlineItem, insertOutlineItem, moveOutlineItem, moveOutlineItemDown, moveOutlineItemUp, NEW_OUTLINE_TITLE, normalizeOutlineTitle, outdentOutlineItem, outlineEqual, outlineTargetLocked, remapOutlineIds, removeOutlineItem, updateOutlineItem, type OutlineApplyPlan, type OutlineInsertPosition, type OutlineItem, type OutlineSnapshot, type OutlineTarget } from '../core/outlineModel'

export class OutlineDraft {
  private baseline: OutlineSnapshot
  private items: OutlineItem[]
  private undoStack: OutlineItem[][] = []
  private redoStack: OutlineItem[][] = []
  private listeners = new Set<() => void>()
  private version = 0
  private serial = 0
  constructor(base: OutlineSnapshot) { this.baseline = structuredClone(base); this.items = structuredClone(base.items) }
  get base(): OutlineSnapshot { return this.baseline }
  getItems(): readonly OutlineItem[] { return this.items }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSnapshot = (): number => this.version
  private notify(): void { this.version++; this.listeners.forEach(listener => listener()) }
  private commit(items: OutlineItem[]): void {
    if (outlineEqual(this.items, items)) return
    const next = structuredClone(items)
    this.undoStack.push(this.items)
    if (this.undoStack.length > 100) this.undoStack.shift()
    this.redoStack = []; this.items = next; this.notify()
  }
  isChanged(): boolean { return !outlineEqual(this.items, this.base.items) }
  canUndo(): boolean { return this.undoStack.length > 0 }
  canRedo(): boolean { return this.redoStack.length > 0 }
  undo(): void { if (this.canUndo()) { this.redoStack.push(this.items); this.items = this.undoStack.pop()!; this.notify() } }
  redo(): void { if (this.canRedo()) { this.undoStack.push(this.items); this.items = this.redoStack.pop()!; this.notify() } }
  add(position: OutlineInsertPosition, init: { title?: string; target: OutlineTarget }): string {
    const title = normalizeOutlineTitle(init.title ?? NEW_OUTLINE_TITLE)
    const used = new Set(flattenOutline(this.items).map(({ item }) => item.id))
    let serial = this.serial + 1
    while (used.has(`new:${serial}`)) serial++
    const id = `new:${serial}`
    this.commit(insertOutlineItem(this.items, position, { id, title, target: init.target, open: false, style: { bold: false, italic: false, color: null }, children: [] }))
    this.serial = serial
    return id
  }
  rename(id: string, title: string): void { this.commit(updateOutlineItem(this.items, id, { title: normalizeOutlineTitle(title) })) }
  remove(id: string, mode: 'withChildren' | 'keepChildren'): void { this.commit(removeOutlineItem(this.items, id, mode)) }
  move(id: string, to: { parentId: string | null; index: number }): void { this.commit(moveOutlineItem(this.items, id, to)) }
  moveUp(id: string): void { this.commit(moveOutlineItemUp(this.items, id)) }
  moveDown(id: string): void { this.commit(moveOutlineItemDown(this.items, id)) }
  indent(id: string): void { this.commit(indentOutlineItem(this.items, id)) }
  outdent(id: string): void { this.commit(outdentOutlineItem(this.items, id)) }
  setTarget(id: string, target: OutlineTarget, options?: { replaceLocked?: boolean }): void {
    const item = findOutlineItem(this.items, id)?.item
    if (item && outlineTargetLocked(item.target) && !options?.replaceLocked) throw new Error('外部リンクや特殊な移動先を持つ目次は、移動先を変更できません。')
    this.commit(updateOutlineItem(this.items, id, { target }))
  }
  setOpen(id: string, open: boolean): void { this.commit(updateOutlineItem(this.items, id, { open })) }
  append(items: OutlineItem[]): void { this.commit([...this.items, ...items]) }
  replaceAll(items: OutlineItem[]): void { this.commit(items) }
  discard(): void { this.commit(this.base.items) }
  rebase(snapshot: OutlineSnapshot, idMap: Record<string, string>): void {
    this.items = remapOutlineIds(this.items, idMap)
    this.undoStack = this.undoStack.map(items => remapOutlineIds(items, idMap))
    this.redoStack = this.redoStack.map(items => remapOutlineIds(items, idMap))
    // Reading back canonicalizes destinations and leaf open flags as well as ids.
    this.items = structuredClone(snapshot.items)
    this.baseline = structuredClone(snapshot)
    this.notify()
  }
  toPlan(): OutlineApplyPlan { return buildOutlineApplyPlan(this.base, this.items) }
}
