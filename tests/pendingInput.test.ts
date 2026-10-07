import { afterEach, describe, expect, it, vi } from 'vitest'
import { commitFocusedField } from '../src/app/pendingInput'

// Node unit tests: the browser's actual blur/React integration is covered by e2e.
class Field {
  blur = vi.fn()
  closest = vi.fn((): object | null => null)
}
class Input extends Field {}
class Select extends Field {}
class Textarea extends Field {}
function focus(field: object | null) {
  vi.stubGlobal('HTMLInputElement', Input)
  vi.stubGlobal('HTMLSelectElement', Select)
  vi.stubGlobal('HTMLTextAreaElement', Textarea)
  vi.stubGlobal('document', { activeElement: field })
}
afterEach(() => vi.unstubAllGlobals())

describe('commitFocusedField', () => {
  it.each([Input, Select, Textarea])('blurs a focused form field once', Type => {
    const field = new Type()
    focus(field)
    commitFocusedField()
    expect(field.blur).toHaveBeenCalledOnce()
  })
  it.each(['editor itself', 'editor descendant'])('leaves TextEditor to commitEditor (%s)', () => {
    const field = new Textarea()
    field.closest.mockReturnValue({})
    focus(field)
    commitFocusedField()
    expect(field.closest).toHaveBeenCalledWith('[data-testid="text-editor"]')
    expect(field.blur).not.toHaveBeenCalled()
  })
  it('ignores non-fields and a missing active element', () => {
    focus(null); expect(() => commitFocusedField()).not.toThrow()
    const element = { blur: vi.fn() }
    focus(element); commitFocusedField()
    expect(element.blur).not.toHaveBeenCalled()
  })
})
