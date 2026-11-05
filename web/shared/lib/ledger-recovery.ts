import { validCategories, validRecord, maxConcurrentActivities, type LedgerRecord, type Snapshot } from './ledger-v2.ts'
import { validCollaboration, emptyCollaboration, contextReferencesExist } from './collaboration.ts'

export type RecoverableLedger = Snapshot & { version: 3; operations: string[] }
export function validateRecovery(value: unknown): asserts value is RecoverableLedger {
  const db = value as RecoverableLedger
  if (!db || db.version !== 3 || !Number.isSafeInteger(db.revision) || db.revision < 0 || !Array.isArray(db.operations) || !validCategories(db.categories) || !Array.isArray(db.records) || db.records.length > 10000 || !db.records.every(r => validRecord(r, db.categories)) || new Set(db.records.map(r => r.id)).size !== db.records.length || db.collaboration !== undefined && !validCollaboration(db.collaboration)) throw new Error('备份格式或分类不兼容，未恢复。')
  if (!db.records.every(r => contextReferencesExist(r.context, db.collaboration ?? emptyCollaboration()))) throw new Error('记录关联的项目、书籍或人物缺失，未恢复。')
  if (maxConcurrentActivities(db.records) > 3) throw new Error('恢复后会出现超过三件同时进行的活动，未恢复。')
}
export function recoveryDiff(current: RecoverableLedger, archive: RecoverableLedger, recordId?: string) {
  validateRecovery(current); validateRecovery(archive)
  const desired = recordId ? archive.records.filter(r => r.id === recordId) : archive.records
  if (recordId && desired.length !== 1) throw new Error('该版本没有这条记录。')
  const currentMap = new Map(current.records.map(r => [r.id, r])), desiredMap = new Map(desired.map(r => [r.id, r]))
  const changes: { id: string; type: 'add' | 'change' | 'remove'; before: LedgerRecord | null; after: LedgerRecord | null; fields: string[] }[] = []
  for (const after of desired) {
    const before = currentMap.get(after.id)
    const fields = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after)])].filter(k => JSON.stringify((before as unknown as Record<string, unknown> | undefined)?.[k]) !== JSON.stringify((after as unknown as Record<string, unknown>)[k]))
    if (fields.length) changes.push({ id: after.id, type: before ? 'change' : 'add', before: before ?? null, after, fields })
  }
  if (!recordId) for (const before of current.records) if (!desiredMap.has(before.id)) changes.push({ id: before.id, type: 'remove', before, after: null, fields: [] })
  return { changes, categoriesChanged: !recordId && JSON.stringify(current.categories) !== JSON.stringify(archive.categories), collaborationChanged: !recordId && JSON.stringify(current.collaboration) !== JSON.stringify(archive.collaboration) }
}
export function restoredLedger(current: RecoverableLedger, archive: RecoverableLedger, operationId: string, recordId?: string) {
  recoveryDiff(current, archive, recordId)
  const base = recordId ? { ...current, records: [...current.records.filter(r => r.id !== recordId), structuredClone(archive.records.find(r => r.id === recordId)!)] } : structuredClone(archive)
  const next = { ...base, revision: Math.max(current.revision, archive.revision) + 1, operations: [...current.operations, operationId].slice(-200) }
  validateRecovery(next)
  return next
}
