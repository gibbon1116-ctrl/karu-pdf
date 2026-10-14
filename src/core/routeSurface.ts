import { quantityKind, type CountFixture } from './countFixtures'
import { validRoutePerM } from './quantity'

export function isRouteSurfaceFixture(f: CountFixture): boolean {
  return f.link === undefined && quantityKind(f) === 'area'
}

function roundedPerimeter(value: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined
  const rounded = Number(value.toFixed(3))
  return validRoutePerM(rounded) ? rounded : undefined
}

export function surfacePerimeterM(main: CountFixture): number | undefined {
  const convert = main.convert
  if (convert?.unit === '㎡'
    && Number.isFinite(convert.factor) && convert.factor > 0) {
    return roundedPerimeter(convert.factor)
  }

  const texts = [main.spec ?? '', main.name]
  for (const text of texts) {
    const size = text.match(/(\d+(?:\.\d+)?)\s*[×xX＊*]\s*(\d+(?:\.\d+)?)/)
    if (size) {
      return roundedPerimeter(2 * (Number(size[1]) + Number(size[2])) / 1000)
    }
  }
  for (const text of texts) {
    const diameter = text.match(/[φΦ]\s*(\d+(?:\.\d+)?)/)
    if (diameter) {
      return roundedPerimeter(Math.PI * Number(diameter[1]) / 1000)
    }
  }
  return undefined
}
