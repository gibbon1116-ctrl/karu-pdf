export function sha256(bytes: Uint8Array): string
export function createZip(entries: Map<string, Buffer>): Buffer
export function extractZip(zip: Buffer, destination: string): Set<string>
export function verifySums(directory: string, names: Set<string>): number
