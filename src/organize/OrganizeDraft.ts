import type { PageSize } from '../core/mupdfDoc'
import type { PageLayoutCard, PageLayoutSource } from '../core/pageOps'

export type CardSource = PageLayoutSource
export type PageCard = PageLayoutCard

const HISTORY_LIMIT = 100

function cloneCard(card: PageCard): PageCard {
  return {
    ...card,
    source: card.source.kind === 'page' ? { ...card.source } : { ...card.source },
  }
}

function sameCards(left: readonly PageCard[], right: readonly PageCard[]): boolean {
  if (left.length !== right.length) return false
  return left.every((card, index) => {
    const other = right[index]
    return card.id === other.id
      && card.rotation === other.rotation
      && JSON.stringify(card.source) === JSON.stringify(other.source)
  })
}

export class OrganizeDraft {
  private cards: PageCard[]
  private readonly original: PageCard[]
  private undoStack: PageCard[][] = []
  private redoStack: PageCard[][] = []
  private readonly listeners = new Set<() => void>()
  private version = 0
  private nextId = 1

  constructor(docId: string, pageSizes: readonly PageSize[]) {
    this.cards = pageSizes.map((_, pageIndex) => ({
      id: `page-${pageIndex + 1}`,
      source: { kind: 'page', docId, pageIndex },
      rotation: 0,
    }))
    this.original = this.cards.map(cloneCard)
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): number => this.version

  getCards(): readonly PageCard[] {
    return this.cards
  }

  isChanged(): boolean {
    return !sameCards(this.cards, this.original)
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  move(cardIds: readonly string[], beforeIndex: number): void {
    const wanted = new Set(cardIds)
    const moving = this.cards.filter((card) => wanted.has(card.id))
    if (moving.length === 0) return
    const bounded = Math.max(0, Math.min(this.cards.length, Math.trunc(beforeIndex)))
    const removedBefore = this.cards.slice(0, bounded).filter((card) => wanted.has(card.id)).length
    const remaining = this.cards.filter((card) => !wanted.has(card.id))
    const insertion = Math.max(0, Math.min(remaining.length, bounded - removedBefore))
    const next = [...remaining.slice(0, insertion), ...moving, ...remaining.slice(insertion)]
    this.commit(next)
  }

  moveBefore(cardIds: readonly string[], beforeCardId: string | null): void {
    const index = beforeCardId === null
      ? this.cards.length
      : this.cards.findIndex((card) => card.id === beforeCardId)
    this.move(cardIds, index < 0 ? this.cards.length : index)
  }

  rotate(cardIds: readonly string[], degrees: 90 | -90): void {
    const wanted = new Set(cardIds)
    if (!this.cards.some((card) => wanted.has(card.id))) return
    const delta = degrees === 90 ? 90 : 270
    this.commit(this.cards.map((card) => wanted.has(card.id)
      ? { ...cloneCard(card), rotation: ((card.rotation + delta) % 360) as PageCard['rotation'] }
      : cloneCard(card)))
  }

  delete(cardIds: readonly string[]): void {
    const wanted = new Set(cardIds)
    if (!this.cards.some((card) => wanted.has(card.id))) return
    this.commit(this.cards.filter((card) => !wanted.has(card.id)).map(cloneCard))
  }

  insertBlank(beforeIndex: number, width: number, height: number): PageCard {
    const card: PageCard = {
      id: this.newId('blank'),
      source: { kind: 'blank', width, height },
      rotation: 0,
    }
    this.insertCards(beforeIndex, [card])
    return cloneCard(card)
  }

  insertPages(beforeIndex: number, docId: string, pageSizes: readonly PageSize[]): PageCard[] {
    const cards = pageSizes.map((_, pageIndex): PageCard => ({
      id: this.newId('source'),
      source: { kind: 'page', docId, pageIndex },
      rotation: 0,
    }))
    this.insertCards(beforeIndex, cards)
    return cards.map(cloneCard)
  }

  undo(): void {
    const previous = this.undoStack.pop()
    if (!previous) return
    this.redoStack.push(this.cards.map(cloneCard))
    this.cards = previous.map(cloneCard)
    this.notify()
  }

  redo(): void {
    const next = this.redoStack.pop()
    if (!next) return
    this.undoStack.push(this.cards.map(cloneCard))
    this.cards = next.map(cloneCard)
    this.notify()
  }

  private insertCards(beforeIndex: number, cards: readonly PageCard[]): void {
    if (cards.length === 0) return
    const index = Math.max(0, Math.min(this.cards.length, Math.trunc(beforeIndex)))
    this.commit([
      ...this.cards.slice(0, index).map(cloneCard),
      ...cards.map(cloneCard),
      ...this.cards.slice(index).map(cloneCard),
    ])
  }

  private commit(next: PageCard[]): void {
    if (sameCards(this.cards, next)) return
    this.undoStack.push(this.cards.map(cloneCard))
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift()
    this.redoStack = []
    this.cards = next.map(cloneCard)
    this.notify()
  }

  private newId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${this.nextId++}`
  }

  private notify(): void {
    this.version += 1
    for (const listener of this.listeners) listener()
  }
}
