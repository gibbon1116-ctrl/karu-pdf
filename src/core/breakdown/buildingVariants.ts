// 建築の t の細目（鋼材類）の規格。拾った長さ・面積・本数に単位質量を掛けて t にする（SPEC-B16）。Claude が作成。
// 所要数量の細目は公共建築数量積算基準の割増（形鋼・鋼管・平鋼・棒鋼 5%、鋼板 3%、ボルト類 4%）を掛ける。
import { REBAR_MASS_KG_PER_M } from './rcData'
import { H_SECTIONS } from './steelData'

export interface BuildingRowVariant {
  /** 図面の印・札に出す略号（16字まで） */
  code: string
  /** 規格の欄に入れる値 */
  spec: string
  /** 拾った数量（長さ m・面積 ㎡・本数）に掛けて t にする */
  convert: { factor: number; unit: 't'; basis: string }
  /** この規格を選んだときに摘要の区分へ入れる既定値（例: 形状 H形鋼、寸法 H-400×200×8×13）。利用者が入れた値があればそちらを使う */
  summary?: Readonly<Record<string, string>>
}

export interface BuildingRowVariants {
  pick: 'length' | 'area' | 'count'
  variants: readonly BuildingRowVariant[]
}

const STEEL_DENSITY_T_PER_M3 = 7.85
const SECTION = 1.05
const PLATE = 1.03
const BOLT = 1.04

const round = (value: number, digits = 6) => Number(value.toFixed(digits))

/** 鋼板（面積 ㎡ × 厚さ × 7.85 t/㎥）。 */
function plates(prefix: string, required: number): BuildingRowVariant[] {
  return [3.2, 4.5, 6, 9, 12, 16, 19, 22, 25, 28, 32].map(t => {
    const perM2 = t / 1000 * STEEL_DENSITY_T_PER_M3
    return {
      code: `${prefix}${t}`,
      spec: `t=${t}`,
      summary: { 板厚: `${t}mm`, 寸法: `t=${t}` },
      convert: { factor: round(perM2 * required), unit: 't', basis: `厚さ ${t}mm × 7.85 t/㎥ ＝ ${round(perM2, 5)} t/㎡ × ${required}（所要）` },
    }
  })
}

/** 角形鋼管 JIS G 3466: 単位質量 W = 0.0157 t (A ＋ B − 3.287 t) kg/m。 */
const SQUARE_TUBES: ReadonlyArray<[number, number]> = [
  [100, 3.2], [100, 4.5], [100, 6], [125, 4.5], [125, 6], [150, 4.5], [150, 6], [150, 9],
  [200, 6], [200, 9], [200, 12], [250, 9], [250, 12], [300, 9], [300, 12], [350, 12], [400, 12], [400, 16],
]

/** 平鋼 JIS G 3194: W = 0.00785 × 厚さ × 幅 kg/m。 */
const FLAT_BARS: ReadonlyArray<[number, number]> = [
  [6, 50], [6, 65], [6, 75], [9, 50], [9, 65], [9, 75], [9, 100], [12, 75], [12, 100], [16, 100],
]

/** 丸鋼 JIS G 3191: W = 0.006165 × 径² kg/m。 */
const ROUND_BARS = [9, 13, 16, 19, 22, 25] as const

/**
 * 軽量形鋼（リップ溝形鋼）JIS G 3350: 断面積を 厚さ ×（H ＋ 2B ＋ 2C − 4t）で略算（角の丸みは無視）。
 * 表の値よりやや大きい（C-100×50×20×2.3 で略算 4.17 kg/m、表 4.06 kg/m）。
 */
const LIGHT_CHANNELS: ReadonlyArray<[number, number, number, number]> = [
  [75, 45, 15, 2.3], [100, 50, 20, 2.3], [100, 50, 20, 3.2], [125, 50, 20, 2.3], [125, 50, 20, 3.2],
  [150, 50, 20, 3.2], [150, 65, 20, 3.2], [150, 75, 20, 3.2], [150, 75, 20, 4.5],
]

/**
 * 高力ボルト（トルシア形・六角）1 組（ボルト・ナット・座金 2 枚）の質量の略算（kg）。
 * JIS B 1186 の寸法（二面幅 s、頭部の高さ k、ナットの高さ m、座金 外径 D・内径 d1・厚さ h）から体積 × 7.85。
 */
const BOLT_DIMENSIONS: Readonly<Record<string, { d: number; s: number; k: number; m: number; D: number; d1: number; h: number; lengths: readonly number[] }>> = {
  M16: { d: 16, s: 27, k: 10, m: 16, D: 32, d1: 17, h: 4.5, lengths: [40, 45, 50, 55, 60] },
  M20: { d: 20, s: 32, k: 13, m: 20, D: 40, d1: 21, h: 4.5, lengths: [50, 55, 60, 65, 70, 75, 80] },
  M22: { d: 22, s: 36, k: 14, m: 22, D: 44, d1: 23, h: 6, lengths: [55, 60, 65, 70, 75, 80, 85, 90] },
  M24: { d: 24, s: 41, k: 15, m: 24, D: 48, d1: 25, h: 6, lengths: [60, 70, 80, 90, 100] },
}

function boltSetKg(size: keyof typeof BOLT_DIMENSIONS, lengthMm: number): number {
  const b = BOLT_DIMENSIONS[size]
  const hexArea = Math.sqrt(3) / 2 * b.s ** 2
  const hole = Math.PI / 4 * b.d ** 2
  const shank = hole * lengthMm
  const head = hexArea * b.k
  const nut = (hexArea - hole) * b.m
  const washers = 2 * Math.PI / 4 * (b.D ** 2 - b.d1 ** 2) * b.h
  // mm³ × 7.85 g/cm³ → kg
  return (shank + head + nut + washers) * STEEL_DENSITY_T_PER_M3 / 1e6
}

/**
 * 形鋼（SPEC-B24）。単位質量は JIS G 3192:2014 の表 8（等辺山形鋼）・表 11（I形鋼）・表 12（溝形鋼）・表 13（H形鋼）の値。
 * 2026-10-12 に利用者の指定した資料（kikakurui.com の JIS G 3192:2014）の表の画像と 48 寸法すべてを照合して一致を確認した。
 */
const ANGLES: ReadonlyArray<[string, number]> = [
  ['L-40×40×3', 1.83], ['L-40×40×5', 2.95], ['L-50×50×4', 3.06], ['L-50×50×6', 4.43],
  ['L-65×65×6', 5.91], ['L-65×65×8', 7.66], ['L-75×75×6', 6.85], ['L-75×75×9', 9.96],
  ['L-90×90×7', 9.59], ['L-90×90×10', 13.3], ['L-100×100×7', 10.7], ['L-100×100×10', 14.9],
  ['L-130×130×9', 17.9], ['L-150×150×12', 27.3],
]
const CHANNELS: ReadonlyArray<[string, number]> = [
  ['[-75×40×5×7', 6.92], ['[-100×50×5×7.5', 9.36], ['[-125×65×6×8', 13.4], ['[-150×75×6.5×10', 18.6],
  ['[-200×80×7.5×11', 24.6], ['[-250×90×9×13', 34.6], ['[-300×90×9×13', 38.1],
]
const I_BEAMS: ReadonlyArray<[string, number]> = [
  ['I-100×75×5×8', 12.9], ['I-125×75×5.5×9.5', 16.1], ['I-150×75×5.5×9.5', 17.1],
  ['I-200×100×7×10', 26.0], ['I-250×125×7.5×12.5', 38.3], ['I-300×150×8×13', 48.3],
]

function sectionVariant(shape: string, name: string, kgPerM: number, source: string): BuildingRowVariant {
  const code = name.replace(/^([A-Z\[]+)-/, '$1').replace(/×/g, 'x').slice(0, 16)
  return {
    code, spec: name, summary: { 形状: shape, 寸法: name },
    convert: { factor: round(kgPerM / 1000 * SECTION), unit: 't', basis: `${source} ${kgPerM} kg/m × ${SECTION}（所要）` },
  }
}

const SHAPED_STEEL: readonly BuildingRowVariant[] = [
  ...H_SECTIONS.map(section => sectionVariant('H形鋼', section.name, section.massKgPerM, 'JIS G 3192')),
  ...ANGLES.map(([name, kg]) => sectionVariant('山形鋼', name, kg, 'JIS G 3192')),
  ...CHANNELS.map(([name, kg]) => sectionVariant('溝形鋼', name, kg, 'JIS G 3192')),
  ...I_BEAMS.map(([name, kg]) => sectionVariant('I形鋼', name, kg, 'JIS G 3192')),
]

export const BUILDING_ROW_VARIANTS: Readonly<Record<string, BuildingRowVariants>> = {
  形鋼: { pick: 'length', variants: SHAPED_STEEL },
  鋼板: { pick: 'area', variants: plates('PL', PLATE) },
  切板鋼板: { pick: 'area', variants: plates('PL', PLATE) },
  角形鋼管: {
    pick: 'length',
    variants: SQUARE_TUBES.map(([a, t]) => {
      const kg = 0.0157 * t * (2 * a - 3.287 * t)
      return { code: `□${a}×${t}`, spec: `□-${a}×${a}×${t}`, summary: { 形状: '正方形', 寸法: `□-${a}×${a}×${t}` }, convert: { factor: round(kg / 1000 * SECTION), unit: 't', basis: `JIS G 3466 式 ${round(kg, 2)} kg/m × ${SECTION}（所要）` } }
    }),
  },
  平鋼: {
    pick: 'length',
    variants: FLAT_BARS.map(([t, b]) => {
      const kg = 0.00785 * t * b
      return { code: `FB${t}×${b}`, spec: `FB-${t}×${b}`, summary: { 寸法: `FB-${t}×${b}` }, convert: { factor: round(kg / 1000 * SECTION), unit: 't', basis: `0.00785×${t}×${b} ＝ ${round(kg, 2)} kg/m × ${SECTION}（所要）` } }
    }),
  },
  丸鋼: {
    pick: 'length',
    variants: ROUND_BARS.map(d => {
      const kg = 0.006165 * d * d
      return { code: `φ${d}`, spec: `φ${d}`, summary: { 径: `φ${d}` }, convert: { factor: round(kg / 1000 * SECTION), unit: 't', basis: `0.006165×${d}² ＝ ${round(kg, 3)} kg/m × ${SECTION}（所要）` } }
    }),
  },
  スパイラル筋: {
    pick: 'length',
    variants: (['D10', 'D13'] as const).map(size => ({
      code: `SP${size}`, spec: size, summary: { 径: size },
      convert: { factor: round(REBAR_MASS_KG_PER_M[size] / 1000), unit: 't', basis: `JIS G 3112 ${REBAR_MASS_KG_PER_M[size]} kg/m（設計数量）` },
    })),
  },
  軽量形鋼構造: {
    pick: 'length',
    variants: LIGHT_CHANNELS.map(([h, b, c, t]) => {
      const kg = t * (h + 2 * b + 2 * c - 4 * t) * STEEL_DENSITY_T_PER_M3 / 1000
      return { code: `C${h}×${b}×${t}`, spec: `C-${h}×${b}×${c}×${t}`, convert: { factor: round(kg / 1000), unit: 't', basis: `略算 ${round(kg, 2)} kg/m（角の丸みを無視、表よりやや大）` } }
    }),
  },
  高力ボルト類: {
    pick: 'count',
    variants: (Object.keys(BOLT_DIMENSIONS) as Array<keyof typeof BOLT_DIMENSIONS>).flatMap(size =>
      BOLT_DIMENSIONS[size].lengths.map(length => {
        const kg = boltSetKg(size, length)
        return { code: `${size}×${length}`, spec: `${size}×${length}`, summary: { 寸法: `${size}×${length}` }, convert: { factor: round(kg / 1000 * BOLT), unit: 't' as const, basis: `1組（ボルト・ナット・座金2枚）の略算 ${round(kg, 3)} kg × ${BOLT}（所要）` } }
      })),
  },
}
