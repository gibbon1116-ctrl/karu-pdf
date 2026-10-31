/** Offline evaluation only. Truth must be fixed by source inspection, independently
 * of the matcher. Candidate discovery and final classification are separate inputs. */
export function evaluateSymbolPredictions(truth, predictions) {
  if(truth.some(g=>!Number.isFinite(g.shortSide)||g.shortSide<=0||g.center.length!==2||!g.center.every(Number.isFinite))
    ||predictions.some(p=>p.center.length!==2||!p.center.every(Number.isFinite)))throw Error('invalid gold/predictions')
  const edges = predictions.map(p => truth.map((g, i) => ({i, distance:Math.hypot(p.center[0]-g.center[0],p.center[1]-g.center[1])}))
    .filter(({i,distance})=>distance<=Math.min(2,truth[i].shortSide/4))
    .sort((a,b)=>a.distance-b.distance).map(e=>e.i))
  // Maximum one-to-one matching: a greedy nearest match can lose a second symbol
  // when two nearby predictions both reach one truth object.
  const assign = (accept=()=>true) => {
    const owners = new Int32Array(truth.length).fill(-1)
    const visit = (p, seen) => {
      for(const g of edges[p]) {
        if(seen[g]||!accept(g,p))continue
        seen[g]=1
        if(owners[g]<0||visit(owners[g],seen)){owners[g]=p;return true}
      }
      return false
    }
    predictions.forEach((_,p)=>visit(p,new Uint8Array(truth.length)))
    return Array.from(owners,(p,g)=>({truth:g,prediction:p})).filter(e=>e.prediction>=0)
  }
  const pairs=assign()
  const unknown=predictions.filter(p=>p.requiredFeatures==='unknown'||p.coverage==='unprocessed').length
  // Inspect all high predictions, including duplicates not chosen by the
  // position assignment. Otherwise a correct duplicate can hide a wrong class.
  const wrongHigh=predictions.filter((p,i)=>p.confidence==='high'&&edges[i].length>0
    &&edges[i].every(g=>truth[g].classification!==undefined&&p.classification!==truth[g].classification)).length
  const unconfirmedHigh=predictions.filter(p=>p.confidence==='high'&&(p.requiredFeatures==='unknown'||p.coverage==='unprocessed')).length
  const tp=pairs.length,fp=predictions.length-tp,fn=truth.length-tp
  const finalTp=assign((g,p)=>predictions[p].requiredFeatures!=='unknown'
    &&predictions[p].coverage!=='unprocessed'
    &&(truth[g].classification===undefined||truth[g].classification===predictions[p].classification)).length
  return {tp,fp,fn,pairs,unknown,wrongHigh,unconfirmedHigh,finalTp,finalFp:predictions.length-finalTp,finalFn:truth.length-finalTp,
    precision:predictions.length?tp/predictions.length:null,recall:truth.length?tp/truth.length:null,
    finalPrecision:predictions.length?finalTp/predictions.length:null,finalRecall:truth.length?finalTp/truth.length:null}
}

export function summarizeTimes(values) {
  if(!values.length||values.some(v=>!Number.isFinite(v)||v<0))throw Error('invalid timing measurements')
  const ordered=[...values].sort((a,b)=>a-b)
  const at=q=>ordered[Math.max(0,Math.ceil(q*ordered.length)-1)]
  return {count:values.length,min:ordered[0],median:at(.5),p95:at(.95),max:ordered.at(-1)}
}
