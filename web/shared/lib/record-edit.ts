import { sameSecondaries, type LedgerRecord } from './ledger-v2.ts'

// Losing a large portion of an existing interval deserves an explicit decision.
// A reclassified, shortened/moved activity may actually be a new parallel entry.
export function replacementNeedsConfirmation(before: LedgerRecord, after: LedgerRecord) {
  const base = (date: string) => Date.parse(date + 'T00:00:00Z') / 60000
  const a = base(before.date), b = base(after.date)
  const kept = Math.max(0, Math.min(a + before.end, b + after.end) - Math.max(a + before.start, b + after.start))
  const removed = before.end - before.start - kept
  const changedActivity = before.category !== after.category || !sameSecondaries(before, after) || before.activity !== after.activity || (before.stage ?? '') !== (after.stage ?? '')
  return removed > 0 && (changedActivity || (removed >= 30 && removed >= (before.end - before.start) / 2))
}

export function dragSpan(origin: number, last: number) {
  return { start: Math.min(origin, last), end: Math.max(origin, last) + 1 }
}
export function minuteInTrack(x: number, left: number, width: number, hour: number) {
  return hour * 60 + Math.min(59, Math.max(0, Math.floor((x - left) / width * 60)))
}
