import { maxConcurrentActivities, parseTimeInput, sameSecondaries, type LedgerRecord } from './ledger-v2.ts'

type DraftTime = { start: string; end: string; nextDay: boolean }
type Span = Pick<LedgerRecord, 'date' | 'start' | 'end'>

/** Same activity classification and absolute span, even with different people or descriptions.
 * Returns evidence for a review, never merges or changes any record. */
export function duplicateActivities(records: LedgerRecord[], pending: LedgerRecord[]) {
  const replacing = new Set(pending.map(r => r.id))
  const seen = records.filter(r => !replacing.has(r.id))
  const matches: { record: LedgerRecord; existing: LedgerRecord }[] = []
  const absolute = (r: Span, edge: 'start' | 'end') => Date.parse(r.date + 'T00:00:00Z') / 60000 + r[edge]
  for (const record of pending) {
    const existing = seen.find(old => old.category === record.category && sameSecondaries(old, record) && absolute(old, 'start') === absolute(record, 'start') && absolute(old, 'end') === absolute(record, 'end'))
    if (existing) matches.push({ record, existing })
    seen.push(record)
  }
  return matches
}

/** Infer midnight only while editing time. Non-time edits preserve the original date flag. */
export function inferDayPatch(draft: DraftTime, patch: Partial<DraftTime>) {
  if (patch.start === undefined && patch.end === undefined) return patch
  const start = parseTimeInput(patch.start ?? draft.start), end = parseTimeInput(patch.end ?? draft.end)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return patch
  return { ...patch, nextDay: end < start || (end === start && (patch.nextDay ?? draft.nextDay)) }
}

export function entryOverlap(records: LedgerRecord[], drafts: Span[], editingId?: string | null) {
  const pending = drafts.filter(r => Number.isFinite(r.start) && Number.isFinite(r.end) && r.start >= 0 && r.start < 1440 && r.end > r.start && r.end - r.start <= 1440)
  const existing = records.filter(r => r.id !== editingId)
  const absolute = (r: Span, edge: 'start' | 'end') => Date.parse(r.date + 'T00:00:00Z') / 60000 + r[edge]
  return {
    peak: Math.max(0, ...pending.map(window => maxConcurrentActivities([...existing, ...pending], window))),
    related: existing.filter(r => pending.some(d => absolute(r, 'start') < absolute(d, 'end') && absolute(r, 'end') > absolute(d, 'start'))),
  }
}
