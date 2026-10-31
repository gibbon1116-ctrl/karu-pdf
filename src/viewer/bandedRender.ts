import type { DeviceRect } from '../worker/protocol'

export const BANDED_RENDER_PIXEL_THRESHOLD = 1_000_000
export const MAX_RENDER_BAND_HEIGHT = 256

export interface RenderBand {
  key: string
  rect: DeviceRect
}

function area(rect: DeviceRect): number {
  return Math.max(0, rect[2] - rect[0]) * Math.max(0, rect[3] - rect[1])
}

export function makeRenderBands(baseKey: string, region: DeviceRect): RenderBand[] {
  if (area(region) <= BANDED_RENDER_PIXEL_THRESHOLD) {
    return [{ key: baseKey, rect: [...region] as DeviceRect }]
  }

  const width = Math.max(1, region[2] - region[0])
  const heightForPixelLimit = Math.max(1, Math.floor(BANDED_RENDER_PIXEL_THRESHOLD / width))
  const bandHeight = Math.min(MAX_RENDER_BAND_HEIGHT, heightForPixelLimit)
  const bands: RenderBand[] = []
  for (let y = region[1]; y < region[3]; y += bandHeight) {
    const rect: DeviceRect = [region[0], y, region[2], Math.min(region[3], y + bandHeight)]
    bands.push({ key: `${baseKey}:band=${rect.join(',')}`, rect })
  }
  return bands
}

export function isBandedRender(bands: readonly RenderBand[]): boolean {
  return bands.length > 1
}

export function completedBandsCover(
  region: DeviceRect,
  bands: readonly RenderBand[],
  completed: readonly boolean[],
  visible: DeviceRect | null,
): boolean {
  if (!visible
    || region[0] > visible[0]
    || region[1] > visible[1]
    || region[2] < visible[2]
    || region[3] < visible[3]) return false

  let intersects = false
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index].rect
    const overlaps = band[0] < visible[2] && band[2] > visible[0]
      && band[1] < visible[3] && band[3] > visible[1]
    if (!overlaps) continue
    intersects = true
    if (!completed[index]) return false
  }
  return intersects
}
