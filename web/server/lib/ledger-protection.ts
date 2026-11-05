import { runtimePaths } from './runtime-paths.ts'
/** Full committed versions, outside the application checkout. No NAS I/O on save. */
import { mkdir, open, readFile, rename, readdir, stat, lstat, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomUUID } from 'node:crypto'

export const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
export const ledgerFile = () => runtimePaths().ledger
export const protectionRoot = () => runtimePaths().protection
export const validVersionId = (id: string) => /^r\d+-[a-f0-9]{64}$/.test(id)
export type Version = { id: string; revision: number; sha256: string; bytes: number; records: number; createdAt: string; reason: string; schema: number }
export type Receipt = { id: string; sha256: string; snapshotId: string; repositoryId: string; verifiedAt: string; restoredAt: string; invalidatedAt?: string }
export type NasConfig = { repository: string; repositoryId: string; mountPoint: string; mountSource: string; mountType: 'smbfs' | 'nfs'; marker: string; restic: string; keychainService: string; keychainAccount: string; recoveryKeyStoredElsewhere: boolean; dedicatedAccountConfirmed: boolean }
export type WorkerState = { at: string; phase: 'waiting' | 'uploading' | 'verified' | 'failed' | 'offline'; error?: string; lastDrill?: { at: string; versionId: string; sha256: string } }

export async function syncDirectory(dir: string) {
  const handle = await open(dir, 'r')
  try { await handle.sync() } finally { await handle.close() }
}
export async function atomicPrivateFile(file: string, bytes: string | Buffer) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = file + '.' + randomUUID() + '.tmp'
  const handle = await open(temp, 'wx', 0o600)
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
  await rename(temp, file)
  await syncDirectory(path.dirname(file))
}
export async function optionalJson<T>(file: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e }
}
export function describeVersion(raw: Buffer | string, reason = 'saved'): Version {
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw), db = JSON.parse(bytes.toString('utf8'))
  if (![2, 3].includes(db.version) || !Number.isSafeInteger(db.revision) || db.revision < 0 || !Array.isArray(db.records) || !Array.isArray(db.operations)) throw new Error('账本格式无法归档')
  const hash = sha256(bytes)
  return { id: `r${db.revision}-${hash}`, revision: db.revision, sha256: hash, bytes: bytes.length, records: db.records.length, createdAt: new Date().toISOString(), reason, schema: db.version }
}
export async function readVersion(id: string, root = protectionRoot()) {
  if (!validVersionId(id)) throw new Error('版本编号不正确')
  const dir = path.join(root, 'versions', id)
  if ((await lstat(dir)).isSymbolicLink() || (await lstat(path.join(dir, 'ledger.json'))).isSymbolicLink()) throw new Error('版本目录不能是链接')
  const meta = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')) as Version
  if ((await stat(path.join(dir, 'ledger.json'))).size > 64 * 1024 * 1024) throw new Error('版本过大')
  const raw = await readFile(path.join(dir, 'ledger.json')), actual = describeVersion(raw)
  if (meta.id !== id || actual.id !== id || meta.sha256 !== actual.sha256 || meta.bytes !== raw.length || meta.revision !== actual.revision) throw new Error('版本校验失败，未读取或恢复')
  return { meta, raw, data: JSON.parse(raw.toString('utf8')) }
}
export async function archiveVersion(raw: Buffer | string, reason = 'saved', root = protectionRoot()) {
  const meta = describeVersion(raw, reason), base = path.join(root, 'versions'), dir = path.join(base, meta.id)
  await mkdir(base, { recursive: true, mode: 0o700 })
  try { return (await readVersion(meta.id, root)).meta }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
  const temp = path.join(base, '.pending-' + randomUUID())
  await mkdir(temp, { mode: 0o700 })
  await atomicPrivateFile(path.join(temp, 'ledger.json'), raw)
  await atomicPrivateFile(path.join(temp, 'manifest.json'), JSON.stringify(meta, null, 2))
  try { await rename(temp, dir); await syncDirectory(base) }
  catch (e) {
    // A concurrent worker may already have archived these exact committed bytes.
    if (!['EEXIST', 'ENOTEMPTY'].includes((e as NodeJS.ErrnoException).code || '')) throw e
    await readVersion(meta.id, root)
    await rm(temp, { recursive: true })
  }
  return meta
}
export async function tryArchive(raw: Buffer | string, reason: string) {
  try { await archiveVersion(raw, reason); return true }
  catch {
    try {
      const meta = describeVersion(raw, reason)
      await atomicPrivateFile(path.join(protectionRoot(), 'errors', meta.id + '.json'), JSON.stringify({ at: new Date().toISOString(), id: meta.id, revision: meta.revision }))
    } catch { /* Current hash is still unprotected; status must never infer success. */ }
    console.error('Ledger saved-version archive unavailable; check Data Protection.')
    return false
  }
}
export async function listVersions(root = protectionRoot()) {
  let names: string[]
  try { names = await readdir(path.join(root, 'versions')) }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e }
  const versions: Version[] = []
  for (const id of names.filter(validVersionId)) {
    // Metadata listing is cheap; content is re-verified before backup or restore.
    const meta = await optionalJson<Version>(path.join(root, 'versions', id, 'manifest.json'))
    if (meta?.id === id) versions.push(meta)
  }
  return versions.sort((a, b) => b.revision - a.revision || b.createdAt.localeCompare(a.createdAt))
}
export async function pinVersion(id: string, root = protectionRoot()) {
  await readVersion(id, root)
  await atomicPrivateFile(path.join(root, 'pins', id + '.json'), JSON.stringify({ id, at: new Date().toISOString() }))
}
export async function protectionStatus() {
  const root = protectionRoot(), raw = await readFile(ledgerFile()), current = describeVersion(raw)
  const versions = await listVersions(root)
  let localCovered = false
  try { localCovered = (await readVersion(current.id, root)).meta.sha256 === current.sha256 } catch { /* report missing/corrupt */ }
  const config = await optionalJson<NasConfig>(path.join(root, 'nas.json'))
  const worker = await optionalJson<WorkerState>(path.join(root, 'worker.json'))
  const receipts: Receipt[] = []
  for (const v of versions) {
    const receipt = await optionalJson<Receipt>(path.join(root, 'receipts', v.id + '.json'))
    if (receipt?.sha256 === v.sha256 && receipt.repositoryId === config?.repositoryId && receipt.restoredAt && !receipt.invalidatedAt) receipts.push(receipt)
  }
  const remoteCovered = localCovered && receipts.some(r => r.id === current.id)
  const confirmed = new Set(receipts.map(r => r.id))
  let failures: string[] = []
  try { failures = await readdir(path.join(root, 'errors')) } catch { /* no errors yet */ }
  const unresolved = failures.filter(n => !versions.some(v => n === v.id + '.json')).length
  const workerFresh = worker && Date.now() - Date.parse(worker.at) < 120000
  const state = !localCovered ? 'archive-failed' : remoteCovered ? 'verified' : !config ? 'unconfigured' : !workerFresh ? 'worker-stopped' : worker.phase
  const labels: Record<string, string> = {
    'archive-failed': '本机已保存 · 版本备份失败', verified: '独立备份已备份 · 已覆盖当前版本',
    unconfigured: '本机版本已保存 · 请另存独立备份', 'worker-stopped': '本机已保存 · 备份服务待启动',
    waiting: '本机已保存 · 等待独立备份备份', uploading: '本机已保存 · 独立备份备份中',
    offline: '本机已保存 · 独立备份暂不可达', failed: '本机已保存 · 备份失败待处理'
  }
  return { state, label: labels[state] || labels.failed, currentRevision: current.revision, currentId: current.id, localCovered, remoteCovered,
    pending: versions.filter(v => !confirmed.has(v.id)).length, versions: versions.map(v => ({ ...v, verified: confirmed.has(v.id) })),
    lastBackupAt: receipts.map(r => r.verifiedAt).sort().at(-1) ?? null, lastDrill: worker?.lastDrill ?? null,
    unresolvedArchiveFailures: unresolved, error: workerFresh ? worker.error : undefined, dataDirectory: root,
    recoveryKeyStoredElsewhere: config?.recoveryKeyStoredElsewhere ?? false }
}

/** A reviewable policy only. No automatic deletion in the first release. */
export function retentionCandidates(versions: Version[], verified: Set<string>, pinned: Set<string>, now = Date.now()) {
  const kept = new Set<string>(), days = new Set<string>(), months = new Set<string>()
  for (const v of [...versions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const age = now - Date.parse(v.createdAt), day = v.createdAt.slice(0, 10), month = day.slice(0, 7)
    if (!verified.has(v.id) || pinned.has(v.id) || age <= 7 * 86400000 || age <= 30 * 86400000 && !days.has(day) || age <= 366 * 86400000 && !months.has(month) || !kept.size) kept.add(v.id)
    days.add(day); months.add(month)
  }
  return versions.filter(v => !kept.has(v.id)).map(v => v.id)
}
