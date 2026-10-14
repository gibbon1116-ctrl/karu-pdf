import { describe, expect, it, vi } from 'vitest'
import type { CountFixture } from '../src/core/countFixtures'
import type { QuantityMark, RouteExtra } from '../src/core/quantity'
import { AnnotationStore } from '../src/editor/AnnotationStore'

const style: CountFixture['style'] = {
  shape: 'circle', fill: 'none', color: [0, 0, 1],
  size: 10, opacity: 1, showCode: true,
}
const duct: CountFixture = {
  id: 'duct', name: 'ダクト', code: 'SD', category: 'ダクト', order: 0,
  kind: 'length', method: 'polyline', spec: '500×300', style,
}
const insulation: CountFixture = {
  id: 'insulation', name: '保温', code: 'GW', category: '保温', order: 1,
  kind: 'area', method: 'lengthHeight', style,
}

// 実際のsetRouteMembersと、その委譲先の検査・正規化を通す。
// 正規化後のrememberRouteで止め、未提示の描画・履歴初期化には依存しない。
// 実際の反映・保存・再読込はe2eで検査する。
function validationProbe(fixtures: CountFixture[] = [duct, insulation]) {
  const quantity: QuantityMark = {
    version: 1, id: 'route', itemId: 'duct', method: 'polyline',
    rises: [{ m: 2 }], slackM: 1,
  }
  const accepted = new Error('検査・正規化を通過')
  const rememberRoute = vi.fn((_quantity: QuantityMark) => {
    throw accepted
  })
  // private の欄を持つ型と交わると never になるので、作った後に AnnotationStore として扱う。
  const store = Object.assign(Object.create(AnnotationStore.prototype) as object, {
    annotations: new Map([['route', { id: 'route', quantity }]]),
    hasLinkedPickup: () => false,
    getCountFixtures: () => fixtures,
    pickupMemory: () => undefined,
    rememberRoute,
  }) as unknown as AnnotationStore
  return { store, quantity, accepted, rememberRoute }
}

const main: RouteExtra = { itemId: 'duct', count: 1 }

describe('AnnotationStore の面積の線要素の検査', () => {
  it.each(['polygon', 'lengthHeight'] as const)(
    '%sの面積項目を追加として許し、周長と施工条件を保持する',
    method => {
      const probe = validationProbe([duct, { ...insulation, method }])
      const cond = { plan: '屋内', rise: null, slack: '屋内' }
      expect(() => probe.store.setRouteMembers('route', [
        main, { itemId: 'insulation', count: 2, perM: 1.6, cond },
      ])).toThrow(probe.accepted)
      expect(probe.rememberRoute).toHaveBeenCalledWith(expect.objectContaining({
        itemId: 'duct',
        extra: [expect.objectContaining({
          itemId: 'insulation', count: 2, perM: 1.6, cond,
        })],
      }))
    },
  )

  it('周長未設定でも追加でき、1を補わない', () => {
    const probe = validationProbe()
    expect(() => probe.store.setRouteMembers('route', [
      main, { itemId: 'insulation', count: 1 },
    ])).toThrow(probe.accepted)
    const normalized = probe.rememberRoute.mock.calls[0][0]
    expect(normalized.extra?.[0]).not.toHaveProperty('perM')
  })

  it('面積の項目は周長1でも主にできない', () => {
    const probe = validationProbe()
    probe.store.setRouteMembers('route', [
      { itemId: 'insulation', count: 1, perM: 1 }, main,
    ])
    expect(probe.rememberRoute).not.toHaveBeenCalled()
    expect(probe.quantity.itemId).toBe('duct')
  })

  it('methodがpolylineでもkindがareaなら主にできない', () => {
    const probe = validationProbe([
      duct, { ...insulation, method: 'polyline' },
    ])
    probe.store.setRouteMembers('route', [
      { itemId: 'insulation', count: 1 }, main,
    ])
    expect(probe.rememberRoute).not.toHaveBeenCalled()
  })

  it('連動の面積項目は追加できない', () => {
    const linked: CountFixture = {
      ...insulation,
      link: {} as NonNullable<CountFixture['link']>,
    }
    const probe = validationProbe([duct, linked])
    probe.store.setRouteMembers('route', [
      main, { itemId: 'insulation', count: 1, perM: 1.6 },
    ])
    expect(probe.rememberRoute).not.toHaveBeenCalled()
  })

  it.each([0, -1, 10000.001, 1.6001, NaN, Infinity])(
    '不正な周長 %s を拒否する',
    perM => {
      const probe = validationProbe()
      probe.store.setRouteMembers('route', [
        main, { itemId: 'insulation', count: 1, perM },
      ])
      expect(probe.rememberRoute).not.toHaveBeenCalled()
    },
  )
})
