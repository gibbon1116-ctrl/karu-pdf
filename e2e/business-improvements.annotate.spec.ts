import { businessCases } from './businessCases'

// The same behavioral checks run on the local Pages build and, when requested,
// the deployed app. Fixtures are generated locally; no workplace PDF is used.
businessCases(process.env.KARU_LIVE_URL ?? '/karu-pdf/?test=1')
