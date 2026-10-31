// 鉄骨の連動のデータ（SPEC-B13）。Claude が一次資料から作成。

/**
 * H形鋼の標準寸法と単位質量。出典: 日鉄スチール「建築用材ハンドブック H形鋼」の「H形鋼の標準寸法」（JIS G 3192 の寸法）。
 * 値は表のとおり（H・B・t1・t2・r は mm、断面積 cm²、単位質量 kg/m）。断面積 × 0.785 = 単位質量 で確認した。
 */
export interface SteelSection { name: string; series: string; H: number; B: number; t1: number; t2: number; r: number; areaCm2: number; massKgPerM: number }
export const H_SECTIONS: readonly SteelSection[] = [
  { name: 'H-100×100×6×8', series: '広幅', H: 100, B: 100, t1: 6, t2: 8, r: 8, areaCm2: 21.59, massKgPerM: 16.9 },
  { name: 'H-125×125×6.5×9', series: '広幅', H: 125, B: 125, t1: 6.5, t2: 9, r: 8, areaCm2: 30, massKgPerM: 23.6 },
  { name: 'H-150×150×7×10', series: '広幅', H: 150, B: 150, t1: 7, t2: 10, r: 8, areaCm2: 39.65, massKgPerM: 31.1 },
  { name: 'H-175×175×7.5×11', series: '広幅', H: 175, B: 175, t1: 7.5, t2: 11, r: 13, areaCm2: 51.43, massKgPerM: 40.4 },
  { name: 'H-200×200×8×12', series: '広幅', H: 200, B: 200, t1: 8, t2: 12, r: 13, areaCm2: 63.53, massKgPerM: 49.9 },
  { name: 'H-250×250×9×14', series: '広幅', H: 250, B: 250, t1: 9, t2: 14, r: 13, areaCm2: 91.43, massKgPerM: 71.8 },
  { name: 'H-300×300×10×15', series: '広幅', H: 300, B: 300, t1: 10, t2: 15, r: 13, areaCm2: 118.5, massKgPerM: 93 },
  { name: 'H-148×100×6×9', series: '中幅', H: 148, B: 100, t1: 6, t2: 9, r: 8, areaCm2: 26.35, massKgPerM: 20.7 },
  { name: 'H-194×150×6×9', series: '中幅', H: 194, B: 150, t1: 6, t2: 9, r: 8, areaCm2: 38.11, massKgPerM: 29.9 },
  { name: 'H-244×175×7×11', series: '中幅', H: 244, B: 175, t1: 7, t2: 11, r: 13, areaCm2: 55.49, massKgPerM: 43.6 },
  { name: 'H-294×200×8×12', series: '中幅', H: 294, B: 200, t1: 8, t2: 12, r: 13, areaCm2: 71.05, massKgPerM: 55.8 },
  { name: 'H-340×250×9×14', series: '中幅', H: 340, B: 250, t1: 9, t2: 14, r: 13, areaCm2: 99.53, massKgPerM: 78.1 },
  { name: 'H-150×75×5×7', series: '細幅', H: 150, B: 75, t1: 5, t2: 7, r: 8, areaCm2: 17.85, massKgPerM: 14 },
  { name: 'H-175×90×5×8', series: '細幅', H: 175, B: 90, t1: 5, t2: 8, r: 8, areaCm2: 22.9, massKgPerM: 18 },
  { name: 'H-200×100×5.5×8', series: '細幅', H: 200, B: 100, t1: 5.5, t2: 8, r: 8, areaCm2: 26.67, massKgPerM: 20.9 },
  { name: 'H-250×125×6×9', series: '細幅', H: 250, B: 125, t1: 6, t2: 9, r: 8, areaCm2: 36.97, massKgPerM: 29 },
  { name: 'H-300×150×6.5×9', series: '細幅', H: 300, B: 150, t1: 6.5, t2: 9, r: 13, areaCm2: 46.78, massKgPerM: 36.7 },
  { name: 'H-350×175×7×11', series: '細幅', H: 350, B: 175, t1: 7, t2: 11, r: 13, areaCm2: 62.91, massKgPerM: 49.4 },
  { name: 'H-400×200×8×13', series: '細幅', H: 400, B: 200, t1: 8, t2: 13, r: 13, areaCm2: 83.37, massKgPerM: 65.4 },
  { name: 'H-450×200×9×14', series: '細幅', H: 450, B: 200, t1: 9, t2: 14, r: 13, areaCm2: 95.43, massKgPerM: 74.9 },
  { name: 'H-500×200×10×16', series: '細幅', H: 500, B: 200, t1: 10, t2: 16, r: 13, areaCm2: 112.3, massKgPerM: 88.2 },
]

/**
 * 表面積（m²/m）。錆止め塗装（公共建築数量積算基準: 原則として鉄骨部材表面の面積）・耐火被覆の略算に使う。
 * 外周（2H ＋ 4B − 2t1）は、フィレット（r）の丸みと板の小口を無視した近似。耐火被覆の箱張り（巻付け）は 2(H＋B)、
 * 床スラブの付く梁の箱張りは 2H ＋ B（上面を除く）。耐火被覆は本来「耐火被覆材の厚さの中心の寸法」による（項目で係数を直せる）。
 */
export function sectionSurfaceM2PerM(s: Pick<SteelSection, 'H' | 'B' | 't1'>, kind: 'contour' | 'box' | 'boxBeam' = 'contour'): number {
  switch (kind) {
    case 'box': return 2 * (s.H + s.B) / 1000
    case 'boxBeam': return (2 * s.H + s.B) / 1000
    default: return (2 * s.H + 4 * s.B - 2 * s.t1) / 1000
  }
}

/** 鉄骨材料の所要数量の割増（公共建築数量積算基準 第4編第4章 第2節 1 通則 8）: 形鋼・鋼管・平鋼 5%、広幅平鋼・鋼板（切板）3%、ボルト類 4%。 */
export const STEEL_REQUIRED_FACTOR = { section: 1.05, plate: 1.03, bolt: 1.04 } as const
