export interface SymbolSearchDiagnostics {
  pageIndex: number
  method: 'vector' | 'vector+image' | 'image'
  pageKind?: 'vector' | 'raster' | 'mixed' | 'empty'
  extractedSegments?: number
  widthFilteredSegments?: number
  template?: { inRect: number; used: number; removedWiring: number; removedOther: number; removedThin: number; manual: boolean }
  anchors?: number
  ringAnchor?: boolean
  placements?: number
  geometrySites?: number
  structureExcluded?: number
  otherExcluded?: { region: number; rotation: number; limit: number; localImage: number }
  duplicates?: number
  final?: number
  supplement?: { exhaustive?: { found: number }; image?: { candidates: number; vectorConfirmed: number; duplicates: number; added: number } }
  ms: { total: number; vector?: number; supplement?: number }
}

export function zeroResultReason(d: SymbolSearchDiagnostics, counts: { total: number; visible: number; rejected: number }): string | null {
  if (counts.visible > 0) return null
  // Hidden structure-rejected candidates are explained by the next rule, not by the display filters.
  if (counts.total - counts.rejected > 0) return '候補はありますが、現在の表示条件では表示されていません（添字・GC回路・拾い済みなどの絞り込みを確かめてください）'
  if (counts.rejected > 0 || (d.structureExcluded ?? 0) > 0) return '候補はありましたが、描画構造（塗り・内部の線）の照合で除外されました。「描画構造で除外した候補も表示する」で確認できます'
  if (d.method === 'image') return '画像で探しましたが、見本と同じ形は見つかりませんでした（このページには線の情報がありません）'
  if (d.geometrySites === 0 && d.widthFilteredSegments === 0) return '見本の線の太さに合う線がこのページにありません（細い線は探しません）'
  return '見本と同じ幾何形状の候補が見つかりませんでした'
}

/** Distance alone decides whether an image candidate duplicates a vector match. */
export function mergeSupplementCandidates<T extends { center: readonly number[] }>(base: readonly { center: readonly number[] }[], extra: T[], distance: number): { added: T[]; duplicates: number } {
  const added = extra.filter(candidate => !base.some(match => Math.hypot(match.center[0] - candidate.center[0], match.center[1] - candidate.center[1]) <= distance))
  return { added, duplicates: extra.length - added.length }
}
