import type { EditableAnnotation } from '../editor/AnnotationStore'
import type { PageCorrespondence } from '../core/registration'
import { oldRectToNew } from '../core/registration'
import { unresolvedIssue } from '../core/issues'

export function transferCandidates(source: readonly EditableAnnotation[], target: readonly EditableAnnotation[], mapping: PageCorrespondence,
  oldSize: { width: number; height: number }, newSize: { width: number; height: number }, sourceDocument: string) {
  const imported = new Set(target.filter(a => a.issue?.sourceDocument === sourceDocument).map(a => a.issue!.sourceId))
  return source.filter(a => a.pageIndex === mapping.oldPage && a.issue && a.issue.recordKind !== 'change' && unresolvedIssue(a.issue)).map(a => {
    const sourceId = a.issue!.id ?? `legacy:${sourceDocument}:${a.objNum ?? a.id}`
    const rect = oldRectToNew(a.rect, mapping, oldSize.width, newSize.width)
    const outside = rect[0] < 0 || rect[1] < 0 || rect[2] > newSize.width || rect[3] > newSize.height
    const reason = imported.has(sourceId) ? '引継ぎ済' : outside ? '補正後の位置が用紙外' : ''
    const annotation: EditableAnnotation = { ...a, rect, pageIndex: mapping.newPage,
      issue: { ...a.issue!, sourceId, sourceDocument, drawingNumber: mapping.drawingNumber || a.issue!.drawingNumber } }
    return { source: a, annotation, reason }
  })
}
