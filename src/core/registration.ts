import type { Point, Rect } from './annotations'
export interface Alignment { scale: number; rotation: number }
export interface PageCorrespondence {
  oldPage: number; newPage: number; offset: Point; alignment: Alignment; drawingNumber: string
}
export function readCorrespondences(raw: string, oldCount: number, newCount: number): { old: string; next: string; mappings: PageCorrespondence[] } {
  if (raw.length > 512*1024) throw new Error('ページ対応ファイルが大きすぎます。')
  const value = JSON.parse(raw) as { version: number; old: string; next: string; mappings: PageCorrespondence[] }
  if (value?.version !== 1 || typeof value.old !== 'string' || typeof value.next !== 'string' || !Array.isArray(value.mappings) || value.mappings.length > 2000) throw new Error('ページ対応ファイルの形式が不正です。')
  const seen = new Set<number>()
  for (const m of value.mappings) {
    if (!m || !Number.isInteger(m.oldPage) || m.oldPage < 0 || m.oldPage >= oldCount || !Number.isInteger(m.newPage) || m.newPage < 0 || m.newPage >= newCount
      || !Array.isArray(m.offset) || m.offset.length !== 2 || m.offset.some(n=>!Number.isFinite(n)||Math.abs(n)>1e7)
      || !m.alignment || !Number.isFinite(m.alignment.scale) || m.alignment.scale < .01 || m.alignment.scale > 100 || !Number.isFinite(m.alignment.rotation)
      || typeof m.drawingNumber !== 'string' || m.drawingNumber.length > 200 || seen.has(m.oldPage)) throw new Error('ページ対応・位置合わせの値が不正です。')
    seen.add(m.oldPage)
  }
  return value
}
export function alignTwoPoints(oldA: Point, newA: Point, oldB: Point, newB: Point): { offset: Point; alignment: Alignment } {
  if ([...oldA, ...newA, ...oldB, ...newB].some(n => !Number.isFinite(n))) throw new Error('基準点が不正です。')
  const oldDx = oldB[0]-oldA[0], oldDy = oldB[1]-oldA[1], newDx = newB[0]-newA[0], newDy = newB[1]-newA[1]
  const oldLength = Math.hypot(oldDx,oldDy), newLength = Math.hypot(newDx,newDy)
  if (oldLength < 1 || newLength < 1) throw new Error('基準点2点を離して指定してください。')
  const scale = oldLength/newLength, rotation = Math.atan2(oldDy,oldDx)-Math.atan2(newDy,newDx)
  if (scale < .01 || scale > 100) throw new Error('基準点の倍率が範囲外です。')
  const c = Math.cos(rotation)*scale, s = Math.sin(rotation)*scale
  return { alignment: { scale, rotation }, offset: [oldA[0]-c*newA[0]+s*newA[1], oldA[1]-s*newA[0]-c*newA[1]] }
}
/** Display comparison normalizes the new sheet to the old sheet width first. */
export function oldRectToNew(rect: Rect, mapping: PageCorrespondence, oldWidth: number, newWidth: number): Rect {
  const factor = mapping.alignment.scale*oldWidth/newWidth, angle = mapping.alignment.rotation
  if (![factor, angle, ...mapping.offset].every(Number.isFinite) || factor <= 0) throw new Error('位置合わせが不正です。')
  const c = Math.cos(angle), s = Math.sin(angle)
  const points = [[rect[0],rect[1]], [rect[2],rect[1]], [rect[0],rect[3]], [rect[2],rect[3]]].map(([x,y]) => {
    const dx = x-mapping.offset[0], dy = y-mapping.offset[1]
    return [(c*dx+s*dy)/factor, (-s*dx+c*dy)/factor]
  })
  return [Math.min(...points.map(p=>p[0])), Math.min(...points.map(p=>p[1])), Math.max(...points.map(p=>p[0])), Math.max(...points.map(p=>p[1]))]
}
