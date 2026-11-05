import './fixtures/profile.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, stat, rm, readdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appendUsage, usageFilename } from '../server/lib/quick-usage-store.ts'

const session = '00000000-0000-4000-8000-000000000001'
const task = '00000000-0000-4000-8000-000000000002'
const event = (seq: number, at = Date.now()) => ({ schema: 1 as const, rules: 1 as const, session, task, seq, at, elapsedMs: seq, event: 'task_start' as const })
test('usage file is separate from ledger, isolated automatically for test ledgers', () => {
  assert.equal(usageFilename({ TIME_LEDGER_DATA_FILE: '/tmp/time-ledger-test.json' }), '/tmp/time-ledger-test.json.quick-input-events.json')
  assert.ok(usageFilename({}).endsWith('/ledger-v2.json.quick-input-events.json'))
  assert.throws(() => usageFilename({ TIME_LEDGER_DATA_FILE: '/tmp/same.json', TIME_LEDGER_USAGE_FILE: '/tmp/same.json' }))
})
test('serialized local storage retains unreviewed history, deduplicates retries and enforces private permissions', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'time-ledger-usage-')); const file = path.join(dir, 'events.json')
  try {
    await writeFile(file, JSON.stringify({ version: 1, events: [event(1, Date.now() - 8 * 86400000)] }))
    await Promise.all([appendUsage([event(2)], file), appendUsage([event(3)], file), appendUsage([event(2)], file)])
    const stored = JSON.parse(await readFile(file, 'utf8'))
    assert.deepEqual(stored.events.map((e: { seq: number }) => e.seq), [1, 2, 3])
    assert.equal(stored.version, 2)
    assert.equal(stored.retention, 'until_reviewed_and_user_approved')
    assert.equal(stored.retentionDays, undefined)
    assert.equal((await stat(file)).mode & 0o777, 0o600)
    await assert.rejects(appendUsage([{ ...event(4), note: 'PRIVATE_SENTINEL' }] as never, file))
    assert.equal((await readFile(file, 'utf8')).includes('PRIVATE_SENTINEL'), false)
    await writeFile(file, 'corrupt-existing-file')
    await assert.rejects(appendUsage([event(5)], file))
    assert.equal(await readFile(file, 'utf8'), 'corrupt-existing-file')
    await assert.rejects(appendUsage([event(6)], '/dev/null/unwritable.json'))
  } finally { await rm(dir, { recursive: true, force: true }) }
})
test('a full volume is preserved before new events are saved; retries across rotation remain deduplicated', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'time-ledger-usage-')); const file = path.join(dir, 'events.json')
  try {
    const original = Array.from({ length: 5000 }, (_, i) => event(i + 1, Date.now() - 20 * 86400000))
    const old = JSON.stringify({ version: 1, retentionDays: 7, maxEvents: 5000, events: original })
    await writeFile(file, old)
    await Promise.all([appendUsage([event(5001)], file), appendUsage([event(5002)], file)])
    const active = JSON.parse(await readFile(file, 'utf8')), archiveDir = file + '.archives'
    const names = await readdir(archiveDir); assert.equal(names.length, 1)
    const archive = JSON.parse(await readFile(path.join(archiveDir, names[0]), 'utf8'))
    assert.deepEqual(archive.events, original)
    assert.deepEqual(active.events.map((e: { seq: number }) => e.seq), [5001, 5002])
    assert.equal(active.recentEventKeys.length, 5000)
    assert.equal((await stat(archiveDir)).mode & 0o777, 0o700)
    assert.equal((await stat(path.join(archiveDir, names[0]))).mode & 0o777, 0o600)
    assert.deepEqual(await appendUsage([original[4999]], file), { stored: 0 })
    // An interrupted active replacement can retry without duplicating the sealed volume.
    await writeFile(file, old)
    await appendUsage([event(5001)], file)
    assert.equal((await readdir(archiveDir)).length, 1)
    await appendUsage([event(6000, Date.now() - 100 * 86400000)], file)
    assert.ok(JSON.parse(await readFile(file, 'utf8')).events.some((e: { seq: number }) => e.seq === 6000))
  } finally { await rm(dir, { recursive: true, force: true }) }
})
test('byte capacity seals the previous volume without truncating any events', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'time-ledger-usage-')); const file = path.join(dir, 'events.json')
  try {
    const verbose = (seq: number) => ({ ...event(seq), mode: 'create' as const, entry: 'existing' as const, group: 'secondary' as const, field: 'project' as const, source: 'shortcut' as const, result: 'review_required' as const, reason: 'record_changed' as const, visibility: 'focused' as const, slot: 2, position: 10000, total: 10000, visible: 10000, count: 10000, attempt: 10000, automatic: false, cleared: false, selected: false, durationMs: 604800000 })
    const n = Math.floor(1_900_000 / (JSON.stringify(verbose(9999)).length + 1))
    assert.ok(n < 5000)
    const original = Array.from({ length: n }, (_, i) => verbose(i + 1))
    await writeFile(file, JSON.stringify({ version: 1, events: original }))
    assert.ok((await stat(file)).size < 2_000_000)
    await appendUsage([verbose(n + 1)], file)
    const names = await readdir(file + '.archives'); assert.equal(names.length, 1)
    const archived = JSON.parse(await readFile(path.join(file + '.archives', names[0]), 'utf8'))
    assert.deepEqual(archived.events, original)
    assert.equal(JSON.parse(await readFile(file, 'utf8')).events.length, 1)
    assert.ok((await stat(file)).size <= 2_000_000)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
test('archive failures, symlinks and invalid retry metadata preserve the existing file', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'time-ledger-usage-')); const file = path.join(dir, 'events.json')
  try {
    const original = JSON.stringify({ version: 1, events: Array.from({ length: 5000 }, (_, i) => event(i + 1)) })
    await writeFile(file, original); await writeFile(file + '.archives', 'not-a-directory')
    await assert.rejects(appendUsage([event(5001)], file))
    assert.equal(await readFile(file, 'utf8'), original)
    await rm(file + '.archives'); await symlink(dir, file + '.archives')
    await assert.rejects(appendUsage([event(5001)], file))
    assert.equal(await readFile(file, 'utf8'), original)
    await writeFile(file, JSON.stringify({ version: 2, retention: 'until_reviewed_and_user_approved', events: [], recentEventKeys: ['PRIVATE_SENTINEL'] }))
    const invalid = await readFile(file, 'utf8')
    await assert.rejects(appendUsage([event(5001)], file))
    assert.equal(await readFile(file, 'utf8'), invalid)
    const pointer = path.join(dir, 'pointer.json'); await symlink(file, pointer)
    await assert.rejects(appendUsage([event(5001)], pointer))
  } finally { await rm(dir, { recursive: true, force: true }) }
})
