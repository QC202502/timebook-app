import './fixtures/profile.ts'
import { profile } from '../config/profile.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { CATEGORIES, VIDEO_STAGES, activityTitle, toCsv, validRecordShape, type LedgerRecord } from '../shared/lib/ledger-v2.ts'
import { parallelChoices, parallelSpan, secondaryChoices, recentProjects, prefill, changeQuickDraft, DEFAULT_QUICK_PREFERENCES, type QuickContext, type QuickDraft } from '../shared/lib/quick-input.ts'

const categories = structuredClone(CATEGORIES)
for (const [parent, id, name] of [['family', 'family-3', '接送小安'], ['create', 'create-1', '视频日记'], ['health', 'health-1', '快走'], ['learn', 'learn-1', '读/听书/课程']]) categories.find(c => c.id === parent)!.children.find(s => s.id === id)!.name = name
categories.find(c => c.id === 'family')!.children.push({ id: 'cook', name: '做饭', archived: false }, { id: 'chores', name: '家务', archived: false })
categories.push({ id: 'social', name: '社交', color: '#123456', archived: false, children: [{ id: 'friend', name: '朋友', archived: false }] })
const row = (id: string, category: string, secondaryId: string, start: number, end: number, project = ''): LedgerRecord => ({ id, date: '2026-10-27', start, end, category, secondaryId, activity: '', activitySource: 'category', project, note: '', approximate: false })
const draft = (category: string, secondaryId: string): QuickDraft => ({ category, secondaryIds: [secondaryId], secondaryManual: true, project: '' })
const ctx = (start: number, date = '2026-10-29', records: LedgerRecord[] = []): QuickContext => ({ categories, records, date, start, now: { date: '2026-11-01', minute: 1400 }, preferences: structuredClone(DEFAULT_QUICK_PREFERENCES) })

test('pickup routes use configured weekdays and boundaries, rest overrides and editable spans', () => {
  const { start, returnStart, end } = profile.pickup!
  for (const date of ['2026-10-27', '2026-10-29']) {
    const outward = parallelChoices(ctx(start + 10, date), draft('family', 'family-3'))
    assert.deepEqual(outward.map(c => c.category), ['fun'])
    const home = parallelChoices(ctx(returnStart, date), draft('family', 'family-3'))
    assert.deepEqual(home.map(c => [c.secondaryIds, c.project]), [[['health-1'], ''], [['family-4'], '和小安']])
    assert.deepEqual(parallelSpan(returnStart + 2, end - 8, home[0]), { start: returnStart + 2, end: end - 8 })
    const walkHome = parallelChoices(ctx(returnStart + 5, date), draft('health', 'health-1'))
    assert.ok(walkHome.some(c => c.secondaryIds.includes('family-3')))
    assert.ok(walkHome.some(c => c.secondaryIds.includes('family-4') && c.project === '和小安'))
    assert.equal(secondaryChoices(ctx(returnStart, date), 'family')[0].secondaryIds[0], 'family-3')
  }
  for (const date of ['2026-10-26', '2026-10-28', '2026-10-30', '2026-10-31', '2026-11-01']) assert.deepEqual(parallelChoices(ctx(returnStart, date), draft('family', 'family-3')), [])
  const rest = ctx(returnStart); rest.preferences.dayOverrides[rest.date] = false
  assert.deepEqual(parallelChoices(rest, draft('family', 'family-3')), [])
  for (const outside of [start - 1, end]) assert.equal(secondaryChoices(ctx(outside), 'family').some(c => c.reason === '已配置的接送时段'), false)
  assert.equal(parallelChoices(ctx(430), draft('family', 'family-3')).some(c => c.category === 'health'), false)
})

test('midday walking offers social/course once each; neither assumes person or book', () => {
  const records = [row('walk', 'health', 'health-1', 690, 780), row('friend', 'social', 'friend', 690, 720, '明明'), row('course', 'learn', 'learn-1', 720, 780, '课程甲')]
  const context = ctx(700, undefined, records), before = structuredClone(records)
  const choices = parallelChoices(context, draft('health', 'health-1'))
  assert.deepEqual(choices.map(c => [c.category, c.project]), [['social', ''], ['learn', '']])
  assert.deepEqual(recentProjects(context, 'social', []), ['明明'])
  assert.deepEqual(recentProjects(context, 'learn', ['learn-1']), ['课程甲'])
  assert.deepEqual(records, before)
})

test('cooking/chores/commute/meal companions are optional with person left for selection', () => {
  for (const [category, id] of [['family', 'cook'], ['family', 'chores'], ['life', 'life-2'], ['life', 'life-3'], ['life', 'life-1']]) {
    const d = draft(category, id), before = structuredClone(d)
    const choices = parallelChoices(ctx(1120), d)
    assert.ok(choices.some(c => c.secondaryIds[0] === 'family-4' && c.project === ''))
    assert.deepEqual(d, before)
  }
})

test('company lunch is a lunch candidate only, manual input survives later time changes', () => {
  const records = [row('l1', 'life', 'life-1', 740, 760, '测试套餐+果汁'), row('l2', 'life', 'life-1', 720, 740, '测试套餐＋果汁')]
  for (const start of [420, 1080]) assert.deepEqual(recentProjects(ctx(start, undefined, records), 'life', ['life-1']), [])
  assert.equal(recentProjects(ctx(720, undefined, records), 'life', ['life-1']).length, 2)
  assert.deepEqual(recentProjects(ctx(720, '2026-10-31', records), 'life', ['life-1']), [])
  assert.equal(prefill(draft('life', 'life-1'), ctx(720, undefined, records)).project, '')
  const chosen = changeQuickDraft(draft('life', 'life-1'), { project: '测试套餐+果汁' }, ctx(720, undefined, records))
  assert.equal(prefill(chosen, ctx(1080, undefined, records)).project, '测试套餐+果汁')
})

test('sleep only offers the first ten minutes, including short and overnight spans', () => {
  const choice = parallelChoices(ctx(1435), draft('rest', 'rest-1'))[0]
  assert.equal(choice.category, 'fun')
  for (const [start, end, expected] of [[15, 405, 25], [1435, 1830, 1445], [1435, 1439, 1439]]) assert.deepEqual(parallelSpan(start, end, choice), { start, end: expected })
  assert.equal(parallelChoices(ctx(1435), draft('fun', 'fun-2')).some(c => c.category === 'rest'), false)
})

test('video stages are independent, validated, optional and exported without altering legacy project', () => {
  const legacy = row('old', 'create', 'create-1', 800, 820, '选题'), before = structuredClone(legacy)
  assert.ok(validRecordShape(legacy))
  for (const stage of VIDEO_STAGES) {
    const next = { ...legacy, stage }
    assert.ok(validRecordShape(next))
    assert.equal(activityTitle(next, categories), '视频日记 · ' + stage)
    const csv = toCsv([next], categories).split('\r\n')
    assert.ok(csv[0].endsWith('"制作阶段"')); assert.ok(csv[1].endsWith('"' + stage + '"'))
    assert.equal(next.project, '选题')
  }
  assert.ok(validRecordShape({ ...legacy, stage: '' }))
  for (const stage of ['自动发布', null, 123, ['录制']]) assert.equal(validRecordShape({ ...legacy, stage }), false)
  assert.deepEqual(recentProjects(ctx(900, undefined, [legacy]), 'create', ['create-1']), [])
  assert.equal(activityTitle({ ...legacy, activity: '自写活动', activitySource: 'custom', stage: '录制' }, categories), '自写活动')
  assert.deepEqual(legacy, before)
})

test('video stage clicks keep project and lock secondary; reclassification clears only draft stage', () => {
  const context = ctx(900), d = { ...draft('create', 'create-1'), project: '示例第3期', projectManual: true }
  const selected = changeQuickDraft(d, { stage: '录制' }, context)
  assert.equal(selected.stage, '录制'); assert.equal(selected.project, '示例第3期')
  assert.equal(prefill(selected, ctx(1200)).stage, '录制')
  assert.equal(changeQuickDraft(selected, { stage: '' }, context).stage, '')
  assert.equal(changeQuickDraft(selected, { category: 'work' }, context).stage, '')
  assert.equal(prefill(selected, ctx(1200), true), selected)
})
