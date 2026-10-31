import { describe, expect, it } from 'vitest'
import { DocumentSession } from '../src/app/documentModel'
import { ratioScale, type ScaleRegion } from '../src/core/measure'
const size = { width: 500, height: 500 }
const region: ScaleRegion = { id: 'detail', rect: [250, 250, 450, 450], scale: ratioScale(20, 'PDF', size) }
describe('page layout scale regions', () => {
  it('reloads mapped regions as saved metadata and clears old page mappings', () => {
    const session = new DocumentSession({ docId: 'scale-layout', name: 'scale.pdf', byteLength: 100, handle: null, pageSizes: [size, size] })
    session.annotationStore.loadScaleRegions([[0, [region]]])
    session.updateAfterPageLayout([size, size], true, [null, null], undefined, [[1, [region]]])
    expect(session.annotationStore.getScaleRegions(0)).toEqual([])
    expect(session.annotationStore.scaleAt(1, [300, 300])?.scale.denominator).toBe(20)
    expect(session.annotationStore.isDirty()).toBe(false)
    session.updateAfterPageLayout([size], false, [null], undefined, [])
    expect(session.annotationStore.getScaleRegions(1)).toEqual([])
    expect(session.annotationStore.isDirty()).toBe(false)
  })
})
