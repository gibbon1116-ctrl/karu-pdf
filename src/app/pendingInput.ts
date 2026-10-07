// Blur-committed fields must reach the store before saving or checking dirty state.
// TextEditor is committed separately by the viewer's commitEditor().
export function commitFocusedField(): void {
  const field = document.activeElement
  if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) return
  if (field.closest('[data-testid="text-editor"]')) return
  field.blur()
}
