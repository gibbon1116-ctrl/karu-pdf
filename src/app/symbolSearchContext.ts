import { createContext } from 'react'
import type { Rect } from '../core/annotations'
import type { CountFixtureSample } from '../core/countFixtures'
import type { DocumentSession } from './documentModel'

// Kept apart from SymbolSearchPanel so the start buttons do not pull the panel
// (and its search client) into the startup bundle; the panel loads on first use.
export const SymbolSearchContext = createContext<{ start(session: DocumentSession, fixtureId: string): void } | null>(null)
export interface SymbolSearchSelection { session: DocumentSession; fixtureId: string; sample: CountFixtureSample; rect: Rect }
