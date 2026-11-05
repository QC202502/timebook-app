import './fixtures/profile.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { CATEGORIES, type LedgerRecord } from '../shared/lib/ledger-v2.ts'
import { prefill, parallelChoices, recentProjects, DEFAULT_QUICK_PREFERENCES, type QuickContext } from '../shared/lib/quick-input.ts'
import { duplicateActivities } from '../shared/lib/entry-feedback.ts'

const categories = structuredClone(CATEGORIES)
categories.find(c => c.id === 'family')!.children.find(s => s.id === 'family-4')!.name = '聊天与沟通'
categories.find(c => c.id === 'family')!.children.push({ id: 'life-2', name: '家务', archived: false })
categories.find(c => c.id === 'life')!.children = categories.find(c => c.id === 'life')!.children.filter(s => s.id !== 'life-2')
categories.find(c => c.id === 'life')!.children.push({ id: 'tidy', name: '收拾', archived: false })
categories.find(c => c.id === 'health')!.children = ['12 分钟拉伸课程', '4 分钟拉伸一组', '深蹲 12 个', '斜撑 8 个', '快走', '爬楼', '散步消食'].map((name, i) => ({ id: 'm' + i, name, archived: false }))
categories.find(c => c.id === 'create')!.children[0].name = '视频日记'
categories.push({ id: 'social', name: '社交', color: '#123456', archived: false, children: [{ id: 'friend', name: '朋友', archived: false }] })
const row = (id: string, date: string, category: string, secondaryIds: string[], start = 900, end = 930, project = ''): LedgerRecord => ({ id, date, category, secondaryIds, start, end, project, activity: '', activitySource: 'category', note: '', approximate: false })
const ctx = (start = 900, date = '2026-11-02', records: LedgerRecord[] = []): QuickContext => ({ categories: structuredClone(categories), start, date, records, now: { date: '2026-11-02', minute: 1400 }, preferences: structuredClone(DEFAULT_QUICK_PREFERENCES) })
const draft = (category: string, secondaryIds: string[] = []) => ({ category, secondaryIds, project: '' })

test('renamed family chat works on weekends and after another rename; archive stops recommendation', () => {
  for (const start of [420, 720, 1140]) for (const date of ['2026-10-31', '2026-11-01']) {
    for (const [category, id] of [['life', 'life-1'], ['life', 'life-3'], ['family', 'life-2']]) {
      const choice = parallelChoices(ctx(start, date), draft(category, [id])).find(c => c.secondaryIds.includes('family-4'))
      assert.equal(choice?.label, '聊天与沟通'); assert.equal(choice?.project, '')
    }
  }
  const c = ctx(); const chat = c.categories.find(x => x.id === 'family')!.children.find(s => s.id === 'family-4')!
  chat.name = '家人交流'
  assert.ok(parallelChoices(c, draft('life', ['life-1'])).some(x => x.label === '家人交流'))
  chat.archived = true
  assert.equal(parallelChoices(c, draft('life', ['life-1'])).some(x => x.secondaryIds.includes('family-4')), false)
})

test('new companions stay optional: chores/novel, stairs/chat, tidy/novel; unknown movement is not training', () => {
  for (const [category, id, expected] of [['family', 'life-2', 'fun-2'], ['health', 'm5', 'family-4'], ['life', 'tidy', 'fun-2']]) {
    const d = draft(category, [id]), before = structuredClone(d)
    assert.ok(parallelChoices(ctx(), d).some(c => c.secondaryIds.includes(expected)))
    assert.deepEqual(d, before)
  }
  for (const ids of [['m5'], ['m6'], []]) assert.equal(parallelChoices(ctx(), draft('health', ids)).some(c => c.secondaryIds.includes('fun-2')), false)
  const stairs = parallelChoices(ctx(), draft('health', ['m5']))
  assert.equal(stairs.find(c => c.secondaryIds.includes('family-4'))?.project, '')
})

test('walking offers social and course outside noon without inheriting yesterday\'s person or book', () => {
  const records = [row('walk', '2026-10-30', 'health', ['m4'], 840, 930), row('friend', '2026-10-30', 'social', ['friend'], 840, 930, '明明')]
  const options = parallelChoices(ctx(900, undefined, records), draft('health', ['m4']))
  assert.deepEqual(options.slice(0, 2).map(c => [c.category, c.project]), [['social', ''], ['learn', '']])
})

test('reverse chat companions survive category rename and do not copy old people', () => {
  const records = [row('meal', '2026-10-31', 'life', ['life-1'], 1140, 1180), row('chat', '2026-10-31', 'family', ['family-4'], 1140, 1180, '家人甲')]
  assert.ok(parallelChoices(ctx(1150, undefined, records), draft('family', ['family-4'])).some(c => c.secondaryIds.includes('life-1')))
})

test('one long walk and same-day duplicates cannot replace the confirmed training preset; two workdays can', () => {
  const one = row('walk', '2026-10-30', 'health', ['m4'], 840, 930)
  assert.deepEqual(prefill(draft('health'), ctx(900, undefined, [one])).secondaryIds, ['m1', 'm2', 'm3'])
  assert.deepEqual(prefill(draft('health'), ctx(900, undefined, [one, { ...one, id: 'dup' }])).secondaryIds, ['m1', 'm2', 'm3'])
  assert.deepEqual(prefill(draft('health'), ctx(900, undefined, [one, { ...one, id: 'earlier', date: '2026-10-29' }])).secondaryIds, ['m4'])
  assert.deepEqual(prefill(draft('health'), ctx(900, undefined, [one, { ...one, id: 'auto', date: '2026-10-29', suggestedFields: ['secondary'] }])).secondaryIds, ['m1', 'm2', 'm3'])
})

test('weekend does not inherit weekday workouts; general auto learning needs distinct explicit same-type dates', () => {
  const one = row('one', '2026-10-30', 'health', ['m0', 'm2', 'm3'], 420, 460)
  assert.deepEqual(prefill(draft('health'), ctx(440, '2026-10-31', [one])).secondaryIds, [])
  const family = row('help', '2026-10-30', 'family', ['family-2'], 1200, 1230, '数学')
  assert.deepEqual(prefill(draft('family'), ctx(1210, undefined, [family])).secondaryIds, [])
  const twice = [family, { ...family, id: 'yesterday', date: '2026-10-29' }]
  assert.deepEqual(prefill(draft('family'), ctx(1210, undefined, twice)).secondaryIds, ['family-2'])
  assert.equal(prefill(draft('family'), ctx(1210, undefined, twice)).project, '数学')
})

test('research topics stay recent alternatives, reading/video exceptions and manual edits stay intact', () => {
  const records = ['2026-10-29', '2026-10-30'].map((date, i) => row('ai' + i, date, 'learn', ['learn-4'], 900, 940, '一次研究主题'))
  const d = { ...draft('learn', ['learn-4']), secondaryManual: true }
  assert.equal(prefill(d, ctx(910, undefined, records)).project, '')
  assert.deepEqual(recentProjects(ctx(910, undefined, records), 'learn', ['learn-4']), ['一次研究主题'])
  const book = row('book', '2026-10-30', 'learn', ['learn-1'], 900, 930, '新书')
  assert.equal(prefill(draft('learn'), ctx(910, undefined, [book])).project, '新书')
  const video = row('video', '2026-10-30', 'create', ['create-1'])
  assert.deepEqual(prefill(draft('create'), ctx(910, undefined, [video])).secondaryIds, ['create-1'])
  const manual = { ...d, project: '手选主题', projectManual: true }
  assert.equal(prefill(manual, ctx(910, undefined, records)).project, '手选主题')
  assert.equal(prefill(manual, ctx(), true), manual)
})

test('same-category same-interval warning includes different people/descriptions and batch companions; never mutates', () => {
  const existing = row('old', '2026-11-01', 'family', ['family-4'], 1050, 1093)
  const next = { ...existing, id: 'new', project: '林林、小安', activity: '聊不同内容' }
  const before = structuredClone(existing)
  assert.equal(duplicateActivities([existing], [next]).length, 1)
  assert.equal(duplicateActivities([existing], [{ ...existing, project: '编辑' }]).length, 0)
  assert.equal(duplicateActivities([], [existing, next]).length, 1)
  assert.equal(duplicateActivities([existing], [{ ...next, end: 1094 }]).length, 0)
  assert.equal(duplicateActivities([existing], [{ ...next, secondaryIds: ['family-2'] }]).length, 0)
  assert.equal(duplicateActivities([existing], [{ ...next, date: '2026-11-02' }]).length, 0)
  assert.deepEqual(existing, before)
  const night = row('night', '2026-10-31', 'family', ['family-4'], 1440, 1460)
  assert.equal(duplicateActivities([night], [row('next', '2026-11-01', 'family', ['family-4'], 0, 20)]).length, 1)
})
