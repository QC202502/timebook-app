import './fixtures/profile.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir, stat, rm } from 'node:fs/promises'
import path from 'node:path'
import { archiveVersion, readVersion, listVersions, retentionCandidates, sha256, protectionStatus, type Version } from '../server/lib/ledger-protection.ts'
import { restoredLedger, recoveryDiff, type RecoverableLedger } from '../shared/lib/ledger-recovery.ts'
import { CATEGORIES, summarize, type LedgerRecord } from '../shared/lib/ledger-v2.ts'
import { emptyCollaboration } from '../shared/lib/collaboration.ts'

const record = (id: string, start: number, end: number): LedgerRecord => ({ id, date: '2026-10-29', start, end, category: 'work', activity: '合成测试', project: '完整项目', note: '保留备注', approximate: false })
const database = (revision = 1, records = [record('a', 540, 570)]): RecoverableLedger => ({ version: 3, revision, records, categories: structuredClone(CATEGORIES), collaboration: emptyCollaboration(), operations: ['op-' + revision] })
test('immutable full-byte versions survive repeated edits, duplicate archives, and include all optional fields', async () => {
  const root = await mkdtemp('/tmp/time-ledger-protection-unit-')
  try {
    const db = database(); db.records[0].stage = '录制'; db.records[0].context = { executor: 'human', books: [], people: [] }
    const original = Buffer.from(JSON.stringify({ ...db, futureMetadata: { keep: true } }, null, 2))
    const a = await archiveVersion(original, 'baseline', root)
    const concurrent = await Promise.all(Array.from({ length: 6 }, () => archiveVersion(original, 'saved', root)))
    assert.ok(concurrent.every(v => v.id === a.id)); assert.equal((await listVersions(root)).length, 1)
    const next = database(2, []); await archiveVersion(JSON.stringify(next), 'saved', root)
    assert.ok((await readVersion(a.id, root)).raw.equals(original))
    assert.equal((await stat(path.join(root, 'versions', a.id, 'ledger.json'))).mode & 0o777, 0o600)
    assert.equal((await stat(path.join(root, 'versions'))).mode & 0o777, 0o700)
    assert.equal((await listVersions(root)).length, 2)
  } finally { await rm(root, { recursive: true }) }
})
test('tampered, oversized identifiers and incomplete packages never restore', async () => {
  const root = await mkdtemp('/tmp/time-ledger-protection-corrupt-')
  try {
    const meta = await archiveVersion(JSON.stringify(database()), 'saved', root)
    await writeFile(path.join(root, 'versions', meta.id, 'ledger.json'), JSON.stringify(database(1, [])))
    await assert.rejects(readVersion(meta.id, root), /校验失败/)
    await assert.rejects(archiveVersion(JSON.stringify(database()), 'saved', root), /校验失败/)
    await assert.rejects(readVersion('../../outside', root), /编号/)
    await mkdir(path.join(root, 'versions', '.pending-interrupted'))
    assert.equal((await listVersions(root)).length, 1)
  } finally { await rm(root, { recursive: true }) }
})
test('single-record recovery preserves subsequent new records and exact absent/present metadata', () => {
  const old = database(1), current = database(3, [{ ...record('a', 540, 560), stage: '剪辑', context: { executor: 'human', books: [], people: [] } }, record('later', 600, 620)])
  const next = restoredLedger(current, old, 'recover-a', 'a')
  assert.deepEqual(next.records.find(r => r.id === 'a'), old.records[0])
  assert.deepEqual(next.records.find(r => r.id === 'later'), current.records[1])
  assert.equal(next.revision, 4); assert.equal(next.operations.at(-1), 'recover-a')
  assert.equal(recoveryDiff(current, old, 'a').changes.length, 1)
  assert.equal(current.records[0].stage, '剪辑')
})
test('full recovery previews newer removals, preserves all saved data and uses a new revision', () => {
  const old = database(1), current = database(5, [record('new', 600, 615)])
  const diff = recoveryDiff(current, old)
  assert.equal(diff.changes.filter(r => r.type === 'remove').length, 1)
  const next = restoredLedger(current, old, 'recover-all')
  assert.deepEqual(next.records, old.records); assert.deepEqual(next.categories, old.categories)
  assert.deepEqual(summarize(next.records, '2026-10-29', 1440, next.categories), summarize(old.records, '2026-10-29', 1440, old.categories))
  assert.equal(next.revision, 6)
})
test('single recovery refuses missing categories, missing people, and a fourth concurrent activity', () => {
  const old = database(), current = database(3, [record('b', 540, 570), record('c', 540, 570), record('d', 540, 570)])
  assert.throws(() => restoredLedger(current, old, 'fourth', 'a'), /三件/)
  const noWork = database(3, []); noWork.categories = noWork.categories.filter(c => c.id !== 'work')
  assert.throws(() => restoredLedger(noWork, old, 'missing-category', 'a'), /分类/)
  const linked = database(); linked.collaboration!.entities.push({ id: 'person', kind: 'person', name: '合成人物', status: 'active' })
  linked.records[0].context = { executor: 'human', books: [], people: [{ id: 'person', role: 'together' }] }
  assert.throws(() => restoredLedger(database(3, []), linked, 'missing-person', 'a'), /缺失/)
})
test('retention keeps pending/pinned, every recent version, daily and monthly representatives', () => {
  const now = Date.parse('2026-10-29T00:00:00Z')
  const version = (id: string, age: number): Version => ({ id, createdAt: new Date(now - age * 86400000).toISOString(), revision: 1, sha256: '', bytes: 1, records: 0, schema: 3, reason: 'saved' })
  const vs = [version('recent-a', 1), version('recent-b', 1.1), version('daily-a', 9), version('daily-b', 9.1), version('monthly', 60), version('older', 400), version('pending', 401), version('pin', 402)]
  const candidates = retentionCandidates(vs, new Set(vs.filter(v => v.id !== 'pending').map(v => v.id)), new Set(['pin']), now)
  assert.ok(candidates.includes('older')); assert.ok(!candidates.includes('pending')); assert.ok(!candidates.includes('pin')); assert.ok(!candidates.includes('monthly'))
  assert.ok(!candidates.includes('recent-a')); assert.ok(!candidates.includes('recent-b'))
})
test('status follows exact current hash, never an old receipt or task timestamp', async () => {
  const root = await mkdtemp('/tmp/time-ledger-protection-status-')
  const oldFile = process.env.TIME_LEDGER_DATA_FILE, oldRoot = process.env.TIME_LEDGER_PROTECTION_DIR
  process.env.TIME_LEDGER_DATA_FILE = path.join(root, 'main.json'); process.env.TIME_LEDGER_PROTECTION_DIR = root
  try {
    const raw = JSON.stringify(database()); await writeFile(process.env.TIME_LEDGER_DATA_FILE, raw)
    assert.equal((await protectionStatus()).state, 'archive-failed')
    const meta = await archiveVersion(raw, 'saved', root)
    assert.equal((await protectionStatus()).state, 'unconfigured')
    await writeFile(path.join(root, 'nas.json'), JSON.stringify({ repositoryId: 'repo1' }))
    await mkdir(path.join(root, 'receipts'))
    await writeFile(path.join(root, 'receipts', meta.id + '.json'), JSON.stringify({ id: meta.id, sha256: sha256(raw), repositoryId: 'repo1', verifiedAt: new Date().toISOString(), restoredAt: new Date().toISOString() }))
    assert.equal((await protectionStatus()).remoteCovered, true)
    await writeFile(process.env.TIME_LEDGER_DATA_FILE, JSON.stringify(database(2)))
    assert.equal((await protectionStatus()).remoteCovered, false)
    assert.equal((await protectionStatus()).localCovered, false)
  } finally {
    if (oldFile === undefined) delete process.env.TIME_LEDGER_DATA_FILE; else process.env.TIME_LEDGER_DATA_FILE = oldFile
    if (oldRoot === undefined) delete process.env.TIME_LEDGER_PROTECTION_DIR; else process.env.TIME_LEDGER_PROTECTION_DIR = oldRoot
    await rm(root, { recursive: true })
  }
})
