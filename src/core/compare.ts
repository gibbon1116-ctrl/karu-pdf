/** Worker-only callers; this module intentionally has no PDF or browser dependencies. */
export type CompareRect = [number, number, number, number]
export interface ComparePixels { width: number; height: number; rgba: Uint8ClampedArray<ArrayBuffer> }
export const COMPARE_THRESHOLD = 200

export function differenceMask(old: ComparePixels, next: ComparePixels, threshold = COMPARE_THRESHOLD): Uint8Array {
  checkSizes(old, next)
  const mask = new Uint8Array(old.width * old.height)
  for (let p = 0; p < mask.length; p++) mask[p] = Number(dark(old.rgba, p * 4, threshold) !== dark(next.rgba, p * 4, threshold))
  return mask
}
function dark(data: Uint8ClampedArray, i: number, threshold: number) {
  const alpha = data[i + 3] / 255
  return (data[i] * .299 + data[i + 1] * .587 + data[i + 2] * .114) * alpha + 255 * (1 - alpha) < threshold
}
function checkSizes(a: ComparePixels, b: ComparePixels) {
  if (a.width !== b.width || a.height !== b.height || a.rgba.length !== a.width * a.height * 4 || b.rgba.length !== a.rgba.length) throw new Error('比較画像の大きさが一致しません。')
}
export function compositeCompare(old: ComparePixels, next: ComparePixels, threshold = COMPARE_THRESHOLD): ComparePixels {
  checkSizes(old, next)
  const rgba = new Uint8ClampedArray(old.rgba.length)
  for (let i = 0; i < rgba.length; i += 4) {
    const a = dark(old.rgba, i, threshold), b = old === next ? a : dark(next.rgba, i, threshold)
    rgba[i] = a && b ? 128 : a || !b ? 255 : 0
    rgba[i + 1] = a && b ? 128 : a || b ? 0 : 255
    rgba[i + 2] = a && b ? 128 : b || !a ? 255 : 0
    rgba[i + 3] = 255
  }
  return { width: old.width, height: old.height, rgba }
}

/** Remove isolated dots, dilate by 2px, then find 8-connected components.
 * Boxes enclose the ORIGINAL differing pixels, not the expanded mask. */
export function detectDifferences(input: Uint8Array, width: number, height: number, scale = 1): CompareRect[] {
  if (input.length !== width * height || !(scale > 0)) throw new Error('違いの画像の大きさが不正です。')
  if (!input.includes(1)) return []
  const clean = new Uint8Array(input.length)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x
    if (!input[p]) continue
    let neighbour = false
    for (let dy = -1; dy <= 1 && !neighbour; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dy) && x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height && input[p + dy * width + dx]) { neighbour = true; break }
    }
    if (neighbour) clean[p] = 1
  }
  // Separable dilation keeps the cost linear even on a completely changed page.
  const horizontal = new Uint8Array(input.length), expanded = new Uint8Array(input.length)
  for (let y = 0; y < height; y++) {
    let sum = 0
    for (let x = -2; x < width; x++) {
      if (x + 2 < width) sum += clean[y * width + x + 2]
      if (x - 3 >= 0) sum -= clean[y * width + x - 3]
      if (x >= 0) horizontal[y * width + x] = Number(sum > 0)
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let y = -2; y < height; y++) {
      if (y + 2 < height) sum += horizontal[(y + 2) * width + x]
      if (y - 3 >= 0) sum -= horizontal[(y - 3) * width + x]
      if (y >= 0) expanded[y * width + x] = Number(sum > 0)
    }
  }
  const stack = new Int32Array(input.length), boxes: CompareRect[] = []
  for (let p = 0; p < expanded.length; p++) {
    if (!expanded[p]) continue
    let length = 1, count = 0, x0 = width, y0 = height, x1 = 0, y1 = 0
    stack[0] = p; expanded[p] = 0
    while (length) {
      const q = stack[--length], x = q % width, y = Math.floor(q / width)
      if (clean[q]) { count++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1) }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue
        const n = q + dy * width + dx
        if (expanded[n]) { expanded[n] = 0; stack[length++] = n }
      }
    }
    // Keep meaningful thin lines, while rejecting sub-4px specks.
    if (count >= 4 && (x1 - x0 >= 4 || y1 - y0 >= 4)) boxes.push([x0, y0, x1, y1])
  }
  let merged = boxes
  for (let cell = 8; merged.length > 200; cell *= 2) {
    const buckets = new Map<string, CompareRect>()
    for (const box of merged) {
      const key = `${Math.floor((box[0] + box[2]) / 2 / cell)},${Math.floor((box[1] + box[3]) / 2 / cell)}`
      const previous = buckets.get(key)
      if (previous) { previous[0] = Math.min(previous[0], box[0]); previous[1] = Math.min(previous[1], box[1]); previous[2] = Math.max(previous[2], box[2]); previous[3] = Math.max(previous[3], box[3]) }
      else buckets.set(key, [...box])
    }
    merged = [...buckets.values()]
  }
  return merged.sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(box => box.map(value => value / scale) as CompareRect)
}

export function differenceLocation(rect: CompareRect, width: number, height: number): string {
  const x = (rect[0] + rect[2]) / 2 / width, y = (rect[1] + rect[3]) / 2 / height
  const row = y < 1 / 3 ? '上' : y > 2 / 3 ? '下' : '', col = x < 1 / 3 ? '左' : x > 2 / 3 ? '右' : ''
  return col + row || '中央'
}
