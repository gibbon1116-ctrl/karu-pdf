import type { DeviceRect } from '../worker/protocol'

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface DeviceSize {
  width: number
  height: number
}

export function visiblePartOfPage(pageBox: Box, viewport: Box): DeviceRect | null {
  const x0 = Math.max(pageBox.x, viewport.x)
  const y0 = Math.max(pageBox.y, viewport.y)
  const x1 = Math.min(pageBox.x + pageBox.width, viewport.x + viewport.width)
  const y1 = Math.min(pageBox.y + pageBox.height, viewport.y + viewport.height)
  if (x1 <= x0 || y1 <= y0) return null
  return [x0 - pageBox.x, y0 - pageBox.y, x1 - pageBox.x, y1 - pageBox.y]
}

export function computeVisibleRegion(
  visible: DeviceRect,
  pageDeviceSize: DeviceSize,
  grid = 128,
): DeviceRect {
  return [
    Math.max(0, Math.floor(visible[0] / grid) * grid),
    Math.max(0, Math.floor(visible[1] / grid) * grid),
    Math.min(pageDeviceSize.width, Math.ceil(visible[2] / grid) * grid),
    Math.min(pageDeviceSize.height, Math.ceil(visible[3] / grid) * grid),
  ]
}

export function computeDetailRegion(
  visible: DeviceRect,
  pageDeviceSize: DeviceSize,
  grid = 128,
): DeviceRect {
  const MAX_DETAIL_SIZE = 4096
  const axis = (visibleStart: number, visibleEnd: number, pageSize: number): [number, number] => {
    const margin = (visibleEnd - visibleStart) / 2
    let start = Math.max(0, Math.floor((visibleStart - margin) / grid) * grid)
    let end = Math.min(pageSize, Math.ceil((visibleEnd + margin) / grid) * grid)
    if (end - start <= MAX_DETAIL_SIZE) return [start, end]

    const size = Math.min(MAX_DETAIL_SIZE, pageSize)
    const center = (visibleStart + visibleEnd) / 2
    start = Math.max(0, Math.min(Math.floor((center - size / 2) / grid) * grid, pageSize - size))
    end = start + size
    if (start > visibleStart) {
      start = Math.max(0, Math.floor(visibleStart / grid) * grid)
      end = Math.min(pageSize, start + size)
    }
    if (end < visibleEnd) {
      end = Math.min(pageSize, Math.ceil(visibleEnd / grid) * grid)
      start = Math.max(0, end - size)
    }
    return [start, end]
  }

  const [x0, x1] = axis(visible[0], visible[2], pageDeviceSize.width)
  const [y0, y1] = axis(visible[1], visible[3], pageDeviceSize.height)
  return [x0, y0, x1, y1]
}

export function regionCovers(region: DeviceRect | null, visible: DeviceRect | null): boolean {
  if (!region || !visible) return false
  return region[0] <= visible[0] && region[1] <= visible[1] && region[2] >= visible[2] && region[3] >= visible[3]
}
