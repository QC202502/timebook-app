/** Explicit 2026-11-03 field correction. Plans changes without mutating storage. */
import { isVideoDiary, type Change, type LedgerRecord, type Snapshot } from './ledger-v2.ts'

export function planWritingStageMigration(snapshot: Snapshot, replaceStageIds: readonly string[] = []) {
  const upserts: LedgerRecord[] = [], conflicts: LedgerRecord[] = []
  for (const record of snapshot.records) {
    if (record.project.trim() !== '写稿' || !isVideoDiary(record, snapshot.categories)) continue
    const conflicting = [record.stage, record.context?.stage].some(stage => stage?.trim() && stage.trim() !== '写稿')
    if (conflicting && !replaceStageIds.includes(record.id)) { conflicts.push(record); continue }
    upserts.push({
      ...record, project: '', stage: '写稿',
      // Saved context stages have precedence in project statistics. Only replace
      // a conflicting context stage with the user's explicit record-level choice.
      ...(conflicting && record.context?.stage?.trim() ? { context: { ...record.context, stage: '写稿' } } : {})
    })
  }
  const change: Change = { upserts, deleteIds: [] }
  return { change, conflicts }
}
