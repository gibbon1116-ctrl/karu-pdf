import { expect, it } from 'vitest'
import { normalizeFloor, floorFromDrawingName } from '../src/core/location'
it.each([
  ['１Ｆ', '1階'], ['1F', '1階'], ['1階', '1階'], ['１階', '1階'], [' 1F ', '1階'],
  ['B1F', 'B1階'], ['地下1階', 'B1階'], ['B1階', 'B1階'], ['RF', 'RF'], ['R階', 'RF'],
  ['屋上', 'RF'], ['屋階', 'RF'], ['屋上階', 'RF'], ['PH1', 'PH1階'], ['PH1階', 'PH1階'],
  ['M2F', 'M2階'], ['中2階', 'M2階'], [' 中庭 ', '中庭'], ['', ''], ['全館', '全館'],
])('normalizes %s to %s', (input, expected) => expect(normalizeFloor(input)).toBe(expected))
it.each([
  ['1階 電灯設備平面図', '1階'], ['B1階平面図', 'B1階'], ['屋上階平面図', 'RF'], ['PH1階平面図', 'PH1階'],
  ['M2F 平面図', 'M2階'], ['ＲＦ 配管図', 'RF'], ['１階平面図', '1階'],
  ['1・2階平面図', undefined], ['1～3階', undefined], ['1〜3階', undefined], ['1階・2階', undefined],
  ['B1・1階', undefined], ['配置図', undefined], ['1,2,3階', undefined], ['A1F機器', undefined],
])('reads a single floor from %s', (input, expected) => expect(floorFromDrawingName(input)).toBe(expected))
