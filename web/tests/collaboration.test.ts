import './fixtures/profile.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { CATEGORIES, type LedgerRecord, validRecordShape } from '../shared/lib/ledger-v2.ts'
import { applyCollaboration, emptyCollaboration, emptyContext, inverseCollaboration, validCollaboration, validRun, type AgentRun, type Collaboration } from '../shared/lib/collaboration.ts'
import { agentSummary, contextSummary, dayComposition, projectSummary, timeText } from '../shared/lib/collaboration-stats.ts'
import { periodRange } from '../shared/lib/ledger-stats.ts'
import { receiptCandidate, sessionCandidate, readSourceCandidates } from '../server/lib/codex-sources.ts'
import { localRequestAllowed } from '../server/lib/local-request.ts'
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const date = '2026-10-29', range = periodRange(date, 'day'), now = { date, minute: 1440 }, nowMs = Date.parse('2026-10-30T00:00:00+08:00')
const iso = (time: string) => date + 'T' + time + ':00+08:00'
const record = (id: string, start: number, end: number, patch: Partial<LedgerRecord> = {}): LedgerRecord => ({ id, date, start, end, category: 'work', activity: 'fixture', project: '旧项目文本', note: '保留', approximate: false, context: { ...emptyContext(), projectId: 'video' }, ...patch })
const run = (id: string, start: string, end: string, patch: Partial<AgentRun> = {}): AgentRun => ({ id, taskId: 'task', sourceKey: id, date, status: 'completed', quality: 'observed', startedAt: iso(start), endedAt: iso(end), pauses: [], sources: [{ kind: 'session', locator: 'fixture#' + id }], ...patch })
const data = (runs: AgentRun[] = []): Collaboration => ({ entities: [{ id: 'video', kind: 'project', name: '视频日记', status: 'active' }], tasks: [{ id: 'task', title: '制作', projectId: 'video', stage: '剪辑', outcomes: [] }], runs, reviews: [] })
test('55 human minutes, 65 Codex minutes, 100 elapsed: no mixed total', () => {
  const rows = [record('a', 540, 555), record('b', 570, 590), record('c', 600, 610), record('d', 630, 640)]
  const d = data([run('r1', '09:15', '10:00'), run('r2', '10:10', '10:30')])
  const p = projectSummary(d, rows, range, now, false)[0]
  assert.equal(p.human.humanMinutes, 55); assert.equal(p.agent.knownMs, 65 * 60000)
  assert.equal(Math.max(...rows.map(r => r.end)) - Math.min(...rows.map(r => r.start)), 100)
  assert.deepEqual(rows.map(r => r.project), Array(4).fill('旧项目文本'))
})
test('human union subtracts explicit interruptions without modifying original records', () => {
  const rows = [record('a', 540, 600, { context: { ...emptyContext(), projectId: 'video', breaks: [{ start: 560, end: 570 }] } }), record('b', 580, 620)]
  const original = structuredClone(rows)
  assert.equal(contextSummary(rows, range, now, false, c => c.projectId === 'video').humanMinutes, 70)
  assert.deepEqual(rows, original)
  assert.equal(validRecordShape(record('bad', 540, 600, { context: { ...emptyContext(), breaks: [{ start: 0, end: 60 }] } })), false)
})
test('multi-person and reference-book links never inflate human total or reading time', () => {
  const c = { ...emptyContext(), books: [{ id: 'book', role: 'reference' as const }], people: [{ id: 'p1', role: 'together' as const }, { id: 'p2', role: 'together' as const }] }
  const rows = [record('a', 540, 570, { context: c })]
  assert.equal(contextSummary(rows, range, now, false, x => x.books.some(b => b.role === 'reading')).covered, 0)
  for (const person of ['p1', 'p2']) assert.equal(contextSummary(rows, range, now, false, x => x.people.some(p => p.id === person && p.role === 'together')).covered, 30)
})
test('unknown legacy executor is counted separately until explicitly confirmed', () => {
  const p = projectSummary(data(), [record('a', 540, 600, { context: { ...emptyContext('legacy'), projectId: 'video' } })], range, now, false)[0]
  assert.equal(p.human.humanMinutes, 0); assert.equal(p.human.legacyMinutes, 60)
})
test('nested runs excluded, independent parallel roots additive, failed work retained', () => {
  const a = agentSummary([run('a', '09:00', '10:00'), run('b', '09:30', '10:00', { parentKey: 'a' }), run('c', '09:30', '10:00', { status: 'failed' })], range, nowMs)
  assert.equal(a.knownMs, 90 * 60000); assert.equal(a.coveredMs, 60 * 60000); assert.equal(a.nestedCount, 1)
})
test('cross-midnight clip uses Shanghai, excludes known pauses, rounds after sum', () => {
  const r = run('a', '23:30', '23:59', { endedAt: '2026-10-30T00:30:00+08:00', pauses: [{ start: iso('23:40'), end: iso('23:50') }] })
  assert.equal(agentSummary([r], range, nowMs).knownMs, 20 * 60000)
  const small = [1, 2, 3].map(i => run('r' + i, '09:00', '09:01', { durationMs: 20000 }))
  assert.equal(timeText(agentSummary(small, range, nowMs).knownMs), '1 分')
})
test('unknown, running and estimated are separate from settled known time', () => {
  const runs = [run('a', '09:00', '10:00', { quality: 'estimated' }), run('b', '09:00', '10:00', { quality: 'unknown' }), run('c', '09:00', '10:00', { status: 'running', endedAt: undefined })]
  const a = agentSummary(runs, range, Date.parse(iso('11:00')))
  assert.equal(a.knownMs, 0); assert.equal(a.estimatedMs, 3600000); assert.equal(a.runningMs, 7200000); assert.equal(a.unknownCount, 1)
})
test('duration-only receipts cannot be positioned in today elapsed view', () => {
  const r = run('a', '09:00', '10:00', { startedAt: undefined, endedAt: undefined, durationMs: 600000, quality: 'reported' })
  assert.equal(agentSummary([r], range, Date.parse(iso('10:00')), true).unknownCount, 1)
  assert.equal(agentSummary([r], range, nowMs).knownMs, 600000)
})
test('24h composition is exclusive even sleep overlaps listening and future is separate', () => {
  const c = dayComposition([record('a', 0, 480, { category: 'rest' }), record('b', 0, 10)], date, ['rest'], 600)
  assert.deepEqual(c, { sleep: 470, single: 0, parallel: 10, unrecorded: 120, future: 840 })
  assert.equal(Object.values(c).reduce((n, v) => n + v), 1440)
})
test('idempotent reimport preserves user task assignment and restores on undo', () => {
  const before = data([run('a', '09:00', '10:00')])
  const change = { runs: [run('different-id', '09:00', '10:30', { sourceKey: 'a', taskId: 'new-task' })], importing: true }
  const next = applyCollaboration(before, change)
  assert.equal(next.runs.length, 1); assert.equal(next.runs[0].taskId, 'task'); assert.equal(next.runs[0].id, 'a')
  const edit = { tasks: [{ ...before.tasks[0], title: 'new' }] }
  assert.deepEqual(applyCollaboration(applyCollaboration(before, edit), inverseCollaboration(before, edit)), before)
})
test('reject duplicate execution identity, cycles, invalid references and invalid durations', () => {
  assert.equal(validCollaboration(data([run('a', '09:00', '10:00'), run('b', '09:00', '10:00', { sourceKey: 'a' })])), false)
  assert.equal(validCollaboration(data([run('a', '09:00', '10:00', { parentKey: 'b' }), run('b', '09:00', '10:00', { parentKey: 'a' })])), false)
  assert.equal(validRun(run('a', '10:00', '09:00')), false)
  assert.throws(() => applyCollaboration(data(), { deleteEntityIds: ['video'] }))
})
test('Codex and session receipts share the turn identity, memory can supply explicit timing', () => {
  const receipt = receiptCandidate({ turnId: 'turn1', title: 'fixture', startedAt: iso('09:00'), endedAt: iso('10:00') }, 'memory', 'memory/date.md')
  const session = sessionCandidate({ type: 'task_complete', turn_id: 'turn1', started_at: Date.parse(iso('09:00')) / 1000, completed_at: Date.parse(iso('10:00')) / 1000, duration_ms: 3600000 }, 'session.jsonl')!
  assert.equal(receipt.run.id, session.run.id); assert.equal(receipt.run.quality, 'reported'); assert.equal(session.run.quality, 'observed')
  assert.equal(receiptCandidate({ sourceKey: 'manual1', date, title: 'no time' }, 'codex', 'receipt').run.quality, 'unknown')
})
test('source scan ignores prose/header timing, deduplicates memory/session, rejects symlink escape', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ledger-sources-')), memoryRoot = path.join(root, 'memory'), sessionRoot = path.join(root, 'sessions'), folder = path.join(sessionRoot, '2026/10/29')
  await mkdir(memoryRoot); await mkdir(folder, { recursive: true })
  const payload = { type: 'task_complete', turn_id: 'turn1', root_turn_id: 'turn1', started_at: Date.parse(iso('09:00')) / 1000, completed_at: Date.parse(iso('10:00')) / 1000, duration_ms: 3600000 }
  await writeFile(path.join(folder, 'rollout-test.jsonl'), JSON.stringify({ type: 'event_msg', payload }) + '\n')
  await writeFile(path.join(memoryRoot, date + '.md'), '### 12:00 已完成，不提供开工时间\n更新ID：turn1\n一句话结论：实际任务\n```time-ledger-run\n' + JSON.stringify({ turnId: 'turn1', date, startedAt: iso('09:00'), endedAt: iso('10:00'), title: 'fixture' }) + '\n```')
  await writeFile(path.join(root, 'outside.jsonl'), JSON.stringify({ type: 'event_msg', payload: { ...payload, turn_id: 'outside' } }))
  await symlink(path.join(root, 'outside.jsonl'), path.join(folder, 'rollout-escape.jsonl'))
  const scan = await readSourceCandidates(date, { memoryRoot, sessionRoot })
  assert.equal(scan.candidates.length, 1); assert.equal(scan.candidates[0].run.quality, 'observed')
  assert.ok(scan.candidates[0].run.sources.some(s => s.kind === 'memory'))
})
test('loopback APIs reject foreign origins and rebinding hosts', () => {
  assert.equal(localRequestAllowed(new Request('http://127.0.0.1:8786/api/ledger')), true)
  assert.equal(localRequestAllowed(new Request('http://evil.test/api/ledger')), false)
  assert.equal(localRequestAllowed(new Request('http://127.0.0.1:8786/api/ledger', { headers: { origin: 'https://evil.test' } })), false)
})
test('future range under elapsed scope is empty; unknown running start is not zero work', () => {
  assert.equal(agentSummary([run('a', '09:00', '10:00')], range, Date.parse('2026-10-28T00:00:00+08:00'), true).entries.length, 0)
  assert.equal(agentSummary([run('a', '09:00', '10:00', { status: 'running', startedAt: undefined, endedAt: undefined })], range, nowMs).unknownCount, 1)
})
test('reimport preserves manual timing; inverse uses normalized execution id', () => {
  const before = data([run('a', '09:00', '10:00', { durationMs: 1000, sources: [{ kind: 'manual', locator: '本人修正' }] })])
  const change = { runs: [run('newid', '09:00', '10:00', { sourceKey: 'a' })], importing: true }
  const next = applyCollaboration(before, change)
  assert.equal(next.runs[0].durationMs, 1000)
  assert.deepEqual(applyCollaboration(next, inverseCollaboration(before, change)), before)
})
test('receipts require timezone, explicit execution time outranks source content date', () => {
  assert.throws(() => receiptCandidate({ sourceKey: 'k', date, startedAt: '2026-10-29T09:00:00' }, 'codex', 'receipt'))
  const r = receiptCandidate({ sourceKey: 'k', date: '2026-10-26', startedAt: iso('09:00'), endedAt: iso('10:00') }, 'memory', 'memory/date.md').run
  assert.equal(r.date, date)
})
