import { compareSymbolFills, type SymbolFeatureState, type SymbolInteriorProfile } from './symbolFeatureProfile'

export type SymbolShapeFeature = 'topArc' | 'annexFrame' | 'interiorLines' | 'interior'
export interface SymbolShapeDecision {
  decision:'same'|'different'|'unknown'; differences:SymbolShapeFeature[]; unknown:SymbolShapeFeature[]
}
export interface LocalShapeLike {
  features:{topArc:SymbolFeatureState;annexFrame:SymbolFeatureState;interiorLineCount?:number}
  interior:SymbolInteriorProfile
}
export function decideSymbolShape(sample:LocalShapeLike|undefined,target:LocalShapeLike|undefined):SymbolShapeDecision {
  const differences:SymbolShapeFeature[]=[],unknown:SymbolShapeFeature[]=[]
  if(!sample||!target)return {decision:'unknown',differences,unknown:['topArc','annexFrame','interiorLines','interior']}
  for(const key of ['topArc','annexFrame'] as const){
    const a=sample.features[key],b=target.features[key]
    if(a==='unknown'||b==='unknown')unknown.push(key)
    else if(a!==b)differences.push(key)
  }
  const a=sample.features.interiorLineCount,b=target.features.interiorLineCount
  if(a===undefined||b===undefined)unknown.push('interiorLines')
  else if(a!==b)differences.push('interiorLines')
  const interior=compareSymbolFills(sample.interior,target.interior)
  if(interior==='different')differences.push('interior')
  else if(interior==='unknown')unknown.push('interior')
  return {decision:differences.length?'different':unknown.length?'unknown':'same',differences,unknown}
}
