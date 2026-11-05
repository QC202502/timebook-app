import './fixtures/profile.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { CATEGORIES, VIDEO_STAGES, activityTitle, toCsv, validRecord, type LedgerRecord, type Snapshot } from '../shared/lib/ledger-v2.ts'
import { planWritingStageMigration } from '../shared/lib/writing-stage-migration.ts'
import { recentProjects, DEFAULT_QUICK_PREFERENCES } from '../shared/lib/quick-input.ts'
import { deriveStatistics, activeProjects } from '../shared/lib/automatic-statistics.ts'
import { emptyCollaboration, emptyContext } from '../shared/lib/collaboration.ts'
import { summarizePeriod } from '../shared/lib/ledger-stats.ts'

const categories = structuredClone(CATEGORIES)
categories.find(c => c.id === 'create')!.children.push({ id: 'video-writing', name: '视频日记', archived: false })
const record = (id: string, patch: Partial<LedgerRecord> = {}): LedgerRecord => ({ id, date: '2026-11-03', start: 900, end: 925, category: 'create', secondaryIds: ['video-writing'], activity: '', activitySource: 'category', project: '写稿', note: '', approximate: false, ...patch })
const snapshot = (records: LedgerRecord[]): Snapshot => ({ revision: 1, categories, records, collaboration: emptyCollaboration() })

test('writing is a valid stage between topic and recording, with title and export support', () => {
  assert.deepEqual(VIDEO_STAGES, ['选题', '写稿', '录制', '剪辑', '发布'])
  const writing = record('writing', { project: '', stage: '写稿' })
  assert.equal(validRecord(writing, categories), true)
  assert.equal(activityTitle(writing, categories), '视频日记 · 写稿')
  assert.match(toCsv([writing], categories), /写稿/)
})

test('migration moves only an exact video-diary project; all unrelated fields and source remain intact', () => {
  const context = { ...emptyContext('human'), projectId: 'real-project', stage: '', books: [{ id: 'book', role: 'reference' as const }], people: [{ id: 'person', role: 'together' as const }], breaks: [{ start: 905, end: 910 }] }
  const source = record('writing', { project: ' 写稿 ', activity: '原有的详细描述', activitySource: 'custom', note: '旧备注', approximate: true, context })
  const sourceCopy = structuredClone(source)
  const unrelated = [record('non-video', { category: 'work', secondaryIds: [], project: '写稿' }), record('specific-project', { project: '写稿资料' }), record('description-only', { project: '', activity: '写稿' })]
  const plan = planWritingStageMigration(snapshot([source, ...unrelated]))
  assert.deepEqual(plan.conflicts, [])
  assert.deepEqual(plan.change.deleteIds, [])
  assert.deepEqual(plan.change.upserts, [{ ...source, project: '', stage: '写稿' }])
  assert.deepEqual(source, sourceCopy)
  assert.deepEqual(plan.change.upserts[0].context, context)
  assert.equal(planWritingStageMigration(snapshot([...plan.change.upserts, ...unrelated])).change.upserts.length, 0)
})

test('conflicting saved stages require an explicit record-level decision; matching stages can be moved', () => {
  const records = [record('topic', { stage: '选题' }), record('context-stage', { context: { ...emptyContext('human'), stage: '剪辑' } }), record('already-writing', { stage: '写稿', context: { ...emptyContext('human'), stage: '写稿' } })]
  const before = structuredClone(records)
  const plan = planWritingStageMigration(snapshot(records))
  assert.deepEqual(plan.conflicts.map(r => r.id), ['topic', 'context-stage'])
  assert.deepEqual(plan.change.upserts.map(r => r.id), ['already-writing'])
  const explicit = planWritingStageMigration(snapshot(records), ['topic', 'context-stage'])
  assert.equal(explicit.conflicts.length, 0)
  assert.equal(explicit.change.upserts[0].stage, '写稿')
  assert.equal(explicit.change.upserts[1].context?.stage, '写稿')
  assert.deepEqual(records, before)
})

test('stage names leave video recent objects while genuine projects and other categories keep them', () => {
  const rows = [record('writing'), record('padded', { project: ' 写稿 ' }), record('recording', { project: '录制' }), record('project', { project: '示例创作工具项目' }), record('work', { category: 'work', secondaryIds: ['work-1'], project: '写稿' })]
  const context = { categories, records: rows, date: '2026-11-03', start: 1000, now: { date: '2026-11-03', minute: 1100 }, preferences: structuredClone(DEFAULT_QUICK_PREFERENCES) }
  assert.deepEqual(recentProjects(context, 'create', ['video-writing']), ['示例创作工具项目'])
  assert.deepEqual(recentProjects(context, 'work', ['work-1']), ['写稿'])
})

test('migration preserves clock and video-project totals; writing stays a stage rather than a separate project', () => {
  const before = snapshot([record('writing', { context: emptyContext('human') }), record('parallel', { category: 'work', secondaryIds: [], project: '正式项目', start: 910, end: 940 })])
  const plan = planWritingStageMigration(before)
  const after = { ...before, records: before.records.map(r => plan.change.upserts.find(u => u.id === r.id) ?? r) }
  const range = { start: '2026-11-03', end: '2026-11-04' }, now = { date: '2026-11-03', minute: 1400 }
  const totals = (s: Snapshot) => { const t = summarizePeriod(s.records, s.categories, range, {}, now, false); return [t.covered, t.total, t.parallel, t.count] }
  assert.deepEqual(totals(after), totals(before))
  const projects = (s: Snapshot) => { const v = deriveStatistics(s.collaboration!, s.records, s.categories); return activeProjects(v.data, v.records, range, now, false) }
  const videoBefore = projects(before).find(p => p.entity.name === '视频日记')!
  const videoAfter = projects(after).find(p => p.entity.name === '视频日记')!
  const clocks = (p: typeof videoAfter) => [p.human.covered, p.human.total, p.human.parallel, p.human.count, p.human.humanMinutes, p.human.legacyMinutes]
  assert.deepEqual(clocks(videoAfter), clocks(videoBefore))
  assert.deepEqual(videoAfter.stages.map(s => s.name), ['写稿'])
  assert.equal(projects(after).some(p => p.entity.name === '写稿'), false)
})
