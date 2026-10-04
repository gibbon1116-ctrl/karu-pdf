// main.tsx imports this first, so the page is guarded before App's modules run.
// Kept apart from externalSend.ts so that the Worker bundles, which import only the
// Worker guard from there, do not carry the page guard.
import { installExternalSendGuard } from './externalSend'

installExternalSendGuard(window)
