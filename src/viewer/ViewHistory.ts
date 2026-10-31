import type { ViewPosition } from './viewSync'

export class ViewHistory {
  private back: ViewPosition[] = []
  private forward: ViewPosition[] = []
  get canBack(): boolean { return this.back.length > 0 }
  get canForward(): boolean { return this.forward.length > 0 }
  remember(position: ViewPosition): void {
    const last = this.back.at(-1)
    if (!last || last.pageIndex !== position.pageIndex || Math.abs(last.x - position.x) > .001 || Math.abs(last.y - position.y) > .001 || Math.abs(last.widthRatio - position.widthRatio) > .001) {
      this.back.push({ ...position, scrolling: false })
      if (this.back.length > 30) this.back.shift()
    }
    this.forward = []
  }
  move(direction: 'back' | 'forward', current: ViewPosition): ViewPosition | null {
    const source = direction === 'back' ? this.back : this.forward
    const destination = direction === 'back' ? this.forward : this.back
    const position = source.pop()
    if (!position) return null
    destination.push({ ...current, scrolling: false })
    return position
  }
  clear(): void { this.back = []; this.forward = [] }
}
