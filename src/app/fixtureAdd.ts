import { fixtureIdentity, quantityKind, quantityMethod, type CountFixture, type FixturePreset } from '../core/countFixtures'
import { isRouteSurfaceFixture } from '../core/routeSurface'
import type { RelatedAddContext } from './documentModel'
import type { AnnotationStore } from '../editor/AnnotationStore'
import { appendFixtures, type FixtureAppendOptions } from './fixtureAppend'
import { relatedSessionMemory } from './relatedState'
import { scopePlanForContext } from './relatedLinkRules'

function selectAddedFixtures(
  store: AnnotationStore, added: readonly CountFixture[], keepSelection = false,
): void {
  const current = store.getCountFixtures()
  const resolved = added.flatMap(fixture => {
    const saved = current.find(value => value.id === fixture.id)
      ?? current.find(value => fixtureIdentity(value) === fixtureIdentity(fixture))
    return saved ? [saved] : []
  })
  if (!resolved.length) return
  relatedSessionMemory(store).update({
    originIds: resolved.map(fixture => fixture.id),
    closed: false,
  })
  // 線項目の経路から追加したときは、経路を選んだまま（線要素・頂点の個数を続けて直せる）。
  if (keepSelection) return
  store.selectFixture(resolved[0].id)
  if (resolved[0].link) store.setRouteTemplate(null)
}

function commitAddedFixtures(
  store: AnnotationStore,
  next: CountFixture[],
  added: readonly CountFixture[],
  context?: RelatedAddContext,
  report?: (message: string) => void,
): boolean {
  if (!context) {
    store.setCountFixtures(next)
    return false
  }
  const origin = store.getCountFixture(context.originFixtureId)
  if (!origin) throw new Error('起点の項目が見つかりません。')

  const result = store.applyRelatedAdditions(
    origin.id, added, context.routeId, scopePlanForContext(context),
  )
  if (result.error) throw new Error(result.error)
  report?.(relatedAdditionStatus(origin, result))
  return origin.link === undefined && quantityMethod(origin) === 'polyline'
}

/** 新規追加と既存項目の反映で、件数・見送り・Undoの案内を共通にする。 */
export function relatedRouteStatus(
  origin: CountFixture,
  added: readonly CountFixture[],
  routeId: string | undefined,
  result: ReturnType<AnnotationStore['addRelatedFixturesToRoute']>,
  verb: '追加しました' | '入れました' = '追加しました',
): string {
  const lines = added.filter(fixture => fixture.link === undefined
    && (quantityMethod(fixture) === 'polyline' || isRouteSurfaceFixture(fixture)))
  const counts = added.filter(fixture =>
    fixture.link === undefined && quantityMethod(fixture) === 'click')
  const messages: string[] = []
  if (lines.length) {
    messages.push(
      `${lines.map(fixture => fixture.name).join('、')} を ${origin.name} の経路 `
      + `${result.changed} 本とこれからの経路の線要素に${verb}`
      + (result.skipped
        ? `（件数・保存の上限により ${result.skipped} 本で一部または全部を見送り）` : ''),
    )
  }
  if (counts.length && routeId) {
    messages.push(
      `選んでいた経路の頂点の個数に ${result.pointRows} 行${verb}`
      + (result.pointSkipped
        ? `（頂点・件数・保存の上限により ${result.pointSkipped} 行を見送り）` : ''),
    )
  }
  if (!messages.length) {
    messages.push(`${added.map(fixture => fixture.name).join('、')} を${verb}`)
  }
  return messages.join('。') + '（Ctrl+Z で戻せます）'
}

/** 新規追加・選択済みの反映で、ストアが確定した結果を案内する。 */
export function relatedAdditionStatus(
  origin: CountFixture,
  result: ReturnType<AnnotationStore['applyRelatedAdditions']>,
): string {
  const messages: string[] = []
  const routes = result.effects.filter(effect => effect.kind === 'route')
  const points = result.effects.filter(effect => effect.kind === 'point')
  if (routes.length) {
    messages.push(
      `${routes.map(effect => effect.name).join('、')} を ${origin.name} の経路 `
      + `${result.changed} 本とこれからの経路の線要素に入れました`
      + (result.skipped
        ? `（件数・保存の上限により ${result.skipped} 本で一部または全部を見送り）` : ''),
    )
  }
  if (points.length) {
    messages.push(
      `${points.map(effect => effect.name).join('、')} を選んでいた経路の頂点の個数に `
      + `${result.pointRows} 行入れました`
      + (result.pointSkipped
        ? `（頂点・件数・保存の上限により ${result.pointSkipped} 行を見送り）` : ''),
    )
  }

  for (const effect of result.effects) {
    if (effect.kind === 'component') {
      messages.push(
        `${effect.name} を ${origin.name} の印 ${effect.changed ?? 0} 個`
        + (effect.futureApplied ? 'とこれからの印' : '')
        + 'の構成要素に入れました'
        + (effect.skipped ? `（10件の上限で ${effect.skipped} 個を見送り）` : '')
        + (!effect.futureApplied ? '（これからの印は10件の上限で見送り）' : ''),
      )
    } else if (effect.kind === 'factor') {
      const relation = quantityMethod(origin) === 'click'
        ? '1個あたり1'
        : quantityKind(origin) === 'area' ? '同じ面積' : '同じ体積'
      messages.push(`${effect.name} を ${origin.name} の連動（${relation}）にしました`)
    } else if (effect.kind === 'perimeter') {
      messages.push(`${effect.name} を ${origin.name} の連動（形・周長）にしました`)
    } else if (effect.kind === 'source') {
      messages.push(`${effect.name} の連動（係数）の元に ${origin.name} を追加しました`)
    } else if (effect.kind === 'unchanged') {
      messages.push(`${effect.name} の連動の元には ${origin.name} がすでに入っています`)
    } else if (effect.kind === 'scopeLink') {
      messages.push(
        `${effect.name} を ${origin.name} の連動にしました`
        + (effect.reason ? `（${effect.reason}）` : ''),
      )
    } else if (effect.kind === 'guidance') {
      messages.push(
        `${effect.name} は図面で拾ってください`
        + (effect.reason ? `（${effect.reason}）` : ''),
      )
    }
  }

  return messages.join('。') + '（Ctrl+Z で戻せます）'
}

/** 標準マスタの確定時だけ追加する。最新のストアを使い、重複を除く。 */
export function addFixtureItems(
  store: AnnotationStore,
  items: ReadonlyArray<FixturePreset | CountFixture>,
  options?: FixtureAppendOptions,
  context?: RelatedAddContext,
  report?: (message: string) => void,
): CountFixture[] {
  const current = store.getCountFixtures()
  const next = appendFixtures(current, items, options)
  const existingIds = new Set(current.map(fixture => fixture.id))
  const added = next.filter(fixture => !existingIds.has(fixture.id))
  const selected = context
    ? [...new Map(items.flatMap(item => {
      const fixture = next.find(value => fixtureIdentity(value) === fixtureIdentity(item))
      return fixture ? [[fixture.id, fixture] as const] : []
    })).values()]
    : added
  if (selected.length) {
    const keep = commitAddedFixtures(store, next, selected, context, report)
    selectAddedFixtures(store, selected, keep)
  }
  return selected
}

/** 新規ダイアログで利用者が保存した項目を、従来と同じ ID のまま追加する。 */
export function saveNewFixture(
  store: AnnotationStore,
  fixture: CountFixture,
  context?: RelatedAddContext,
  report?: (message: string) => void,
): void {
  const keep = commitAddedFixtures(
    store, [...store.getCountFixtures(), fixture], [fixture], context, report,
  )
  selectAddedFixtures(store, [fixture], keep)
}
