import {
  H_SECTIONS, sectionSurfaceM2PerM,
} from './breakdown/steelData'

export interface SteelMember {
  section: string
  customMassKgPerM?: number
  customSurfaceM2PerM?: number
  lengthMm?: number
}

export type SteelSurfaceKind = 'contour' | 'box' | 'boxBeam'

export interface SteelSectionMetrics {
  massKgPerM: number
  surfaceM2PerM: (kind?: SteelSurfaceKind) => number
}

const sections = new Map(H_SECTIONS.map(section => [section.name, section]))

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function steelMemberError(member: unknown): string | undefined {
  if (member === null || typeof member !== 'object' || Array.isArray(member)) {
    return '鉄骨部材の設定が正しくありません。'
  }
  const value = member as Record<string, unknown>
  if (typeof value.section !== 'string'
    || !value.section.length || value.section.length > 80
    || value.section !== value.section.trim()
    || /[\r\n\t\u2028\u2029]/.test(value.section)) {
    return '鉄骨部材の断面名は1〜80文字で設定してください。'
  }
  for (const key of [
    'customMassKgPerM', 'customSurfaceM2PerM', 'lengthMm',
  ] as const) {
    if (value[key] !== undefined && !positive(value[key])) {
      return '鉄骨部材の単位質量・単位表面積・長さは0より大きい有限の数で設定してください。'
    }
  }
  if (!sections.has(value.section)
    && (!positive(value.customMassKgPerM)
      || !positive(value.customSurfaceM2PerM))) {
    return '表にない鉄骨断面には単位質量と単位表面積を設定してください。'
  }
}

export function readSteelMember(value: unknown): SteelMember | undefined {
  if (steelMemberError(value)) return undefined
  const member = value as SteelMember
  return {
    section: member.section,
    ...(member.customMassKgPerM !== undefined
      ? { customMassKgPerM: member.customMassKgPerM } : {}),
    ...(member.customSurfaceM2PerM !== undefined
      ? { customSurfaceM2PerM: member.customSurfaceM2PerM } : {}),
    ...(member.lengthMm !== undefined ? { lengthMm: member.lengthMm } : {}),
  }
}

export function steelSection(member: SteelMember): SteelSectionMetrics | undefined {
  if (steelMemberError(member)) return undefined
  const section = sections.get(member.section)
  if (section) {
    return {
      massKgPerM: section.massKgPerM,
      surfaceM2PerM: (kind = 'contour') => sectionSurfaceM2PerM(section, kind),
    }
  }
  return {
    massKgPerM: member.customMassKgPerM!,
    surfaceM2PerM: () => member.customSurfaceM2PerM!,
  }
}
