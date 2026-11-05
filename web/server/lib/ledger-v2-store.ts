import { runtimePaths } from './runtime-paths'
import { batchIntentError } from '../../shared/lib/parallel-entry'
import { applyCollaboration, inverseCollaboration, contextReferencesExist, emptyCollaboration, validCollaboration } from '../../shared/lib/collaboration'
import { mkdir, readFile, rename, open, copyFile, appendFile } from 'node:fs/promises'
import { tryArchive, archiveVersion, atomicPrivateFile, pinVersion, readVersion, listVersions, sha256, syncDirectory } from './ledger-protection'
import { restoredLedger, recoveryDiff, validateRecovery } from '../../shared/lib/ledger-recovery'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { replacementNeedsConfirmation } from '../../shared/lib/record-edit'
import { CATEGORIES, activityTitle, categoryOf, secondaryNames, secondaryIdsOf, withSecondaries, validRecord, validCategories, migrateLegacyRecords, applyCategoryAction, maxConcurrentActivities, MAX_CONCURRENT_ACTIVITIES, type Change, type Snapshot } from '../../shared/lib/ledger-v2'

type Database = Snapshot & { version: 3; operations: string[] }
const runtime = globalThis as typeof globalThis & { ledgerV2Queue?: Promise<unknown> }
const filename = () => runtimePaths().ledger
export class LedgerError extends Error { constructor(public status: number, message: string) { super(message) } }
const snapshotOf = (db: Database): Snapshot => ({ revision: db.revision, records: db.records, categories: db.categories, collaboration: db.collaboration ?? emptyCollaboration() })

async function readDatabase(): Promise<Database> {
  try {
    const db = JSON.parse(await readFile(filename(), 'utf8'))
    if (![2, 3].includes(db.version) || !Number.isInteger(db.revision) || db.revision < 0 || !Array.isArray(db.records) || !Array.isArray(db.operations)) throw new Error('Invalid stored ledger')
    if (db.version === 2) {
      if (!db.records.every((r: unknown) => validRecord(r))) throw new Error('Invalid legacy records')
      return { ...db, version: 3, categories: structuredClone(CATEGORIES), records: migrateLegacyRecords(db.records) }
    }
    if (!validCategories(db.categories) || !db.records.every((r: unknown) => validRecord(r, db.categories))) throw new Error('Invalid stored categories or records')
    if (db.collaboration !== undefined && !validCollaboration(db.collaboration)) throw new Error('Invalid collaboration data')
    return db
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if ((await listVersions()).length) throw new Error('主账本缺失，但存在历史版本；请恢复，不能当作新空账本。')
      return { version: 3, revision: 0, records: [], categories: structuredClone(CATEGORIES), operations: [] }
    }
    throw error
  }
}
export async function readLedger(): Promise<Snapshot> { return snapshotOf(await readDatabase()) }
export async function changeLedger(revision: number, operationId: string, change: Change): Promise<Snapshot> {
  const operation = async () => {
    const db = await readDatabase()
    if (db.operations.includes(operationId)) return snapshotOf(db)
    if (db.revision !== revision) throw new LedgerError(409, '账本或分类已在其他页面更新，请刷新后再保存。输入内容仍保留。')
    if (change.clearContextIds !== undefined && (!Array.isArray(change.clearContextIds) || change.clearContextIds.length > 100 || change.clearContextIds.some(id => !change.upserts.some(r => r.id === id)))) throw new LedgerError(400, '清除关联的目标不正确。')
    if (change.categoryAction && (change.upserts.length || change.deleteIds.length)) throw new LedgerError(400, '分类调整与记录修改请分别保存。')
    const batchError = batchIntentError(change, db.records)
    if (batchError) throw new LedgerError(batchError.status, batchError.message)
    if (change.createIds !== undefined) {
      const ids = change.createIds
      if (!ids.length || ids.length > 3 || new Set(ids).size !== ids.length || change.recordIntent || change.categoryAction || change.deleteIds.length || change.confirmedReplacementIds?.length || change.upserts.length !== ids.length || change.upserts.some(r => !ids.includes(r.id))) throw new LedgerError(400, '成组新增目标不一致，未写入。')
      if (db.records.some(r => ids.includes(r.id))) throw new LedgerError(409, '成组新增不能覆盖已有活动，输入仍保留。')
    }
    if (change.recordIntent) {
      const { kind, id } = change.recordIntent
      if (change.upserts.length !== 1 || change.upserts[0].id !== id || change.deleteIds.length || change.categoryAction) throw new LedgerError(400, '保存目标与记录不一致，未写入。')
      const exists = db.records.some(r => r.id === id)
      if (kind === 'create' && exists) throw new LedgerError(409, '新增活动不能覆盖已有记录，请重新新增。')
      if (kind === 'update' && !exists) throw new LedgerError(409, '原记录已不存在，请刷新核对；输入仍保留。')
    }
    let collaboration = db.collaboration ?? emptyCollaboration()
    if (change.collaborationChange) {
      try { collaboration = applyCollaboration(collaboration, change.collaborationChange) }
      catch (e) { throw new LedgerError(400, e instanceof Error ? e.message : '协作修改格式不正确。') }
    }
    let categories = db.categories, records = db.records
    if (change.categoryAction) {
      try { ({ categories, records } = applyCategoryAction(categories, records, change.categoryAction)) }
      catch (e) { throw new LedgerError(400, e instanceof Error ? e.message : '分类操作不正确。') }
    }
    // Older tabs omit classification/name metadata. Preserve an established auto mode
    // for unchanged/generated text; a different user description becomes custom.
    const upserts = change.upserts.map(r => {
      const previous = records.find(old => old.id === r.id)
      let normalized = { ...r, secondaryId: r.secondaryId !== undefined ? r.secondaryId : previous?.category === r.category ? previous.secondaryId ?? null : null }
      if (r.secondaryIds !== undefined) normalized = withSecondaries(r, r.secondaryIds) as typeof normalized
      else if (previous?.secondaryIds !== undefined) {
        const unchanged = previous.category === r.category && (r.secondaryId === undefined || r.secondaryId === previous.secondaryId)
        if (secondaryIdsOf(previous).length > 1 && !unchanged) throw new LedgerError(409, '这条记录有多个动作，请刷新到新版页面后调整分类；原记录未改动。')
        normalized = withSecondaries({ ...normalized, secondaryIds: [] }, unchanged ? previous.secondaryIds : secondaryIdsOf(normalized)) as typeof normalized
      }
      if (r.activitySource === undefined && previous?.activitySource === 'category') {
        const generatedNames = [previous.activity, activityTitle(previous, categories), categoryOf(r.category, categories).name, secondaryNames(normalized, categories)]
        normalized.activitySource = generatedNames.includes(r.activity) ? 'category' : 'custom'
      }
      if (r.stage === undefined && previous?.stage !== undefined) normalized.stage = previous.stage
      if (r.context === undefined && previous?.context !== undefined) normalized.context = previous.context
      if (change.clearContextIds?.includes(r.id)) delete normalized.context
      return normalized
    })
    if (upserts.some(r => !validRecord(r, categories))) throw new LedgerError(400, '请检查时间、分类和文字长度；结束须晚于开始，时长不超过 24 小时。')
    if (new Set(upserts.map(r => r.id)).size !== upserts.length) throw new LedgerError(400, '重复的记录编号。')
    const ids = new Set([...change.deleteIds, ...upserts.map(r => r.id)])
    records = [...records.filter(r => !ids.has(r.id)), ...upserts]
    if (upserts.length && maxConcurrentActivities(records) > MAX_CONCURRENT_ACTIVITIES) throw new LedgerError(400, '同一分钟最多记录 3 件事。这个时段会出现第 4 件同时进行的事，请调整起止时间。')
    for (const updated of upserts) {
      const previous = db.records.find(r => r.id === updated.id)
      if (previous && replacementNeedsConfirmation(previous, updated) && !change.confirmedReplacementIds?.includes(updated.id)) throw new LedgerError(409, '这次修改会替换原活动或明显缩短原时段，尚未保存。请在新版页面核对原记录，选择另存新活动或确认修改。')
    }
    if (!records.every(r => contextReferencesExist(r.context, collaboration))) throw new LedgerError(400, '项目或对象仍有关联记录，请先解除关联或归档。')
    if (change.collaborationChange?.importing && !change.collaborationChange.acknowledgeOverlap) {
      const overlap = change.collaborationChange.runs?.some(run => run.startedAt && run.endedAt && records.some(r => r.context?.executor !== 'human' && Date.parse(r.date + 'T00:00:00+08:00') + r.start * 60000 < Date.parse(run.endedAt!) && Date.parse(r.date + 'T00:00:00+08:00') + r.end * 60000 > Date.parse(run.startedAt!)))
      if (overlap) throw new LedgerError(400, '导入时段与未区分执行者的历史记录重叠，请先核对并确认。')
    }
    if (records.length > 10000) throw new LedgerError(400, '原型最多保存 10000 条，请先导出备份。')
    const next: Database = { version: 3, revision: db.revision + 1, records, categories, ...(db.collaboration || change.collaborationChange ? { collaboration } : {}), operations: [...db.operations, operationId].slice(-200) }
    const file = filename()
    await mkdir(path.dirname(file), { recursive: true })
    const tmp = file + '.' + randomUUID() + '.tmp'
    const nextBytes = JSON.stringify(next, null, 2)
    const handle = await open(tmp, 'wx', 0o600)
    try { await handle.writeFile(nextBytes); await handle.sync() } finally { await handle.close() }
    try {
      // Keep a permanent pre-migration copy in addition to the rolling last-write backup.
      const originalBytes = await readFile(file)
      await tryArchive(originalBytes, 'before-save')
      const original = JSON.parse(originalBytes.toString('utf8'))
      if (original.version === 2) {
        try { await copyFile(file, file + '.before-v3', 1) }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e }
      }
      if ((change.collaborationChange || upserts.some(r => r.context)) && original.collaboration === undefined) {
        try { await copyFile(file, file + '.before-collaboration', 1) }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e }
      }
      await copyFile(file, file + '.bak')
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
    const audited = !!change.collaborationChange || upserts.some(r => r.context) || db.records.some(r => change.deleteIds.includes(r.id) && r.context)
    if (audited) {
      const inverse = { records: db.records.filter(r => ids.has(r.id)), clearContextIds: db.records.filter(r => ids.has(r.id) && !r.context).map(r => r.id), deleteIds: upserts.filter(r => !db.records.some(o => o.id === r.id)).map(r => r.id), ...(change.collaborationChange ? { collaborationChange: inverseCollaboration(db.collaboration ?? emptyCollaboration(), change.collaborationChange) } : {}) }
      await appendFile(file + '.collaboration-audit.jsonl', JSON.stringify({ event: 'prepared', operationId, revision: next.revision, at: new Date().toISOString(), change, inverse }) + '\n', { mode: 0o600 })
    }
    await rename(tmp, file)
    await syncDirectory(path.dirname(file))
    await tryArchive(nextBytes, 'saved')
    if (audited) {
      try { await appendFile(file + '.collaboration-audit.jsonl', JSON.stringify({ event: 'committed', operationId, revision: next.revision }) + '\n', { mode: 0o600 }) }
      catch { console.error('Collaboration audit completion marker unavailable; ledger commit succeeded.') }
    }
    return snapshotOf(next)
  }
  const result = (runtime.ledgerV2Queue ?? Promise.resolve()).then(operation, operation)
  runtime.ledgerV2Queue = result.catch(() => undefined)
  return result
}

export async function previewRecovery(versionId: string, recordId?: string) {
  const raw = await readFile(filename()), current = JSON.parse(raw.toString('utf8'))
  const { data: archive, meta } = await readVersion(versionId)
  validateRecovery(current); validateRecovery(archive)
  const diff = recoveryDiff(current, archive, recordId)
  let conflict: string | null = null
  try { restoredLedger(current, archive, 'preview-only', recordId) }
  catch (e) { conflict = e instanceof Error ? e.message : '恢复冲突' }
  return { revision: current.revision, currentHash: sha256(raw), versionId, recordId: recordId ?? null, meta, ...diff, conflict }
}

export async function restoreLedgerVersion(versionId: string, recordId: string | undefined, revision: number, currentHash: string, operationId: string) {
  const operation = async () => {
    const raw = await readFile(filename()), current = JSON.parse(raw.toString('utf8'))
    validateRecovery(current)
    if (current.operations.includes(operationId)) return snapshotOf(current)
    if (current.revision !== revision || sha256(raw) !== currentHash) throw new LedgerError(409, '账本在预览后有新修改，请重新预览；未恢复。')
    const { data: archive } = await readVersion(versionId)
    validateRecovery(archive)
    const next = restoredLedger(current, archive, operationId, recordId)
    // Recovery requires a verified permanent safety copy; ordinary save failures are separate.
    const before = await archiveVersion(raw, 'before-restore')
    await pinVersion(before.id)
    await pinVersion(versionId)
    await atomicPrivateFile(filename(), JSON.stringify(next, null, 2))
    await tryArchive(JSON.stringify(next, null, 2), 'restored')
    return snapshotOf(next)
  }
  const result = (runtime.ledgerV2Queue ?? Promise.resolve()).then(operation, operation)
  runtime.ledgerV2Queue = result.catch(() => undefined)
  return result
}
