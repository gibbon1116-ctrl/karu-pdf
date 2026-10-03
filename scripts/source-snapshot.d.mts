export interface SourceSnapshot {
  sourceHash: string
  sourceDirty: boolean
  sourceFiles: { path: string; sha256: string }[]
}
export function sourceSnapshot(root?: string): SourceSnapshot
export function verifyBuildSource(build: { sourceHash?: string; sourceDirty?: boolean }, root?: string, allowDirty?: boolean): SourceSnapshot
