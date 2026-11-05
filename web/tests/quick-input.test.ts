import './fixtures/profile.ts'
import { profile } from '../config/profile.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CATEGORIES, validRecord, type LedgerRecord } from '../shared/lib/ledger-v2.ts'
import { secondaryChoices, recentProjects, changeQuickDraft, prefill, prefillNewEntry, parallelChoices, isWorkday, quickPreferences, DEFAULT_QUICK_PREFERENCES, type QuickContext, type QuickDraft } from '../shared/lib/quick-input.ts'

const categories = structuredClone(CATEGORIES)
categories.find(c => c.id === 'health')!.children = ['12 分钟拉伸课程', '4 分钟拉伸一组', '深蹲 12 个', '斜撑 8 个', '快走'].map((name, i) => ({ id: 'move-' + i, name, archived: false }))
categories.find(c => c.id === 'create')!.children[0].name = '视频日记'
categories.find(c => c.id === 'family')!.children.find(c => c.id === 'family-3')!.name = '接送小安'
const row = (id: string, category = 'learn', secondaryId = 'learn-1', project = '书甲', start = 600, date = '2026-10-26'): LedgerRecord => ({ id, date, start, end: start + 20, category, secondaryId, activity: '', activitySource: 'category', project, note: '', approximate: false })
const context = (records: LedgerRecord[] = [], start = 900): QuickContext => ({ categories, records, date: '2026-10-27', start, now: { date: '2026-10-27', minute: 1100 }, preferences: structuredClone(DEFAULT_QUICK_PREFERENCES) })
const draft = (category = 'learn'): QuickDraft => ({ category, secondaryIds: [], project: '' })

test('one/two minute selections use only the recording primary despite learned defaults and refreshes', () => {
  const ctx = context([
    row('log-a', 'recording-id', 'recording-stat', '近期项目', 900, '2026-10-25'),
    row('log-b', 'recording-id', 'recording-stat', '近期项目', 900, '2026-10-26')
  ], 900)
  ctx.categories = [...categories, { id: 'recording-id', name: '记录', color: '#123456', archived: false, children: [{ id: 'recording-stat', name: '统计和分析', archived: false }] }]
  const before = structuredClone(ctx)
  for (const minutes of [1, 2]) {
    const selected = prefillNewEntry(draft('work'), ctx, ctx.start + minutes)
    assert.equal(selected.category, 'recording-id')
    assert.deepEqual(selected.secondaryIds, [])
    assert.equal(selected.project, '')
    assert.deepEqual(prefill(selected, ctx), selected, 'data/preferences refresh cannot add a secondary')
    assert.deepEqual(changeQuickDraft(selected, { project: '手写项目' }, ctx).secondaryIds, [])
    assert.equal(changeQuickDraft(selected, { project: '手写项目' }, ctx).project, '手写项目')
    assert.equal(changeQuickDraft(selected, { secondaryIds: ['recording-stat'] }, ctx).secondaryIds[0], 'recording-stat')
    const manual = changeQuickDraft(selected, { category: 'health' }, ctx)
    assert.equal(manual.category, 'health')
    assert.equal(manual.primaryOnlyDefault, undefined)
    assert.equal(manual.secondaryIds.length, 3, 'explicit category choice restores its usual workout defaults')
  }
  assert.deepEqual(ctx, before, 'history and category definitions are never changed')
})

test('short selection defaults support renamed recording and midnight; archived/missing recording and longer spans keep normal defaults', () => {
  const ctx = context([], 1439)
  ctx.categories = [...categories, { id: 'stable-recording-id', name: '记录与系统', color: '#123456', archived: false, children: [] }]
  for (const end of [1440, 1441]) assert.equal(prefillNewEntry(draft('work'), ctx, end).category, 'stable-recording-id')
  for (const end of [1438, 1439, 1442, NaN, Infinity]) assert.deepEqual(prefillNewEntry(draft('work'), ctx, end), prefill(draft('work'), ctx))
  ctx.categories.at(-1)!.archived = true
  assert.deepEqual(prefillNewEntry(draft('work'), ctx, 1440), prefill(draft('work'), ctx))
  ctx.categories = categories
  assert.deepEqual(prefillNewEntry(draft('work'), ctx, 1440), prefill(draft('work'), ctx))
})

test('short saved activities and explicit parallel category choices bypass new-selection initialization', () => {
  const ctx = context([], 600)
  const saved = { ...draft('learn'), secondaryIds: ['learn-1'], project: '原书名', secondaryManual: true, projectManual: true }
  assert.equal(prefill(saved, ctx, true), saved)
  const changed = changeQuickDraft(saved, { project: '修改书名' }, ctx, true)
  assert.equal(changed.category, 'learn')
  assert.deepEqual(changed.secondaryIds, ['learn-1'])
  const companion = prefill({ ...draft('fun'), secondaryIds: ['fun-2'], secondaryManual: true }, ctx)
  assert.equal(companion.category, 'fun')
  assert.deepEqual(companion.secondaryIds, ['fun-2'])
})

test('workday morning and daytime use different three-action sets without modifying records', () => {
  assert.deepEqual(prefill(draft('health'), context([], 465)).secondaryIds, ['move-0', 'move-2', 'move-3'])
  assert.deepEqual(prefill(draft('health'), context([], 600)).secondaryIds, ['move-1', 'move-2', 'move-3'])
  const weekend = { ...context([], 465), date: '2026-10-31' }
  assert.deepEqual(prefill(draft('health'), weekend).secondaryIds, [])
  weekend.preferences.dayOverrides[weekend.date] = true
  assert.equal(isWorkday(weekend.date, weekend.preferences), true)
  assert.equal(prefill(draft('health'), weekend).secondaryIds[0], 'move-0')
})
test('changing time updates automatic values, never manual choice or explicit clearing', () => {
  const morning = prefill(draft('health'), context([], 465))
  assert.equal(prefill(morning, context([], 600)).secondaryIds[0], 'move-1')
  const manual = changeQuickDraft(morning, { secondaryIds: ['move-4'] }, context([], 465))
  assert.deepEqual(prefill(manual, context([], 600)).secondaryIds, ['move-4'])
  const empty = changeQuickDraft(morning, { secondaryIds: [] }, context([], 465))
  assert.deepEqual(prefill(empty, context([], 600)).secondaryIds, [])
  assert.equal(prefill(morning, context([], 600), true), morning, 'editing is an identity operation')
  const editing = { ...morning, secondaryManual: true, projectManual: true }
  assert.deepEqual(changeQuickDraft(editing, {}, context([], 600), true).suggestedFields, morning.suggestedFields, 'unrelated edit does not pretend automatic fields were manually chosen')
})
test('recent books stay separate by activity; same-day, old backfills, future and midnight boundaries', () => {
  const rows = [row('old'), row('new', 'learn', 'learn-1', '书乙', 700), row('novel', 'fun', 'fun-2', '小说甲', 720), row('future', 'learn', 'learn-1', '未来书', 1150, '2026-10-27'), row('ancient', 'learn', 'learn-1', '旧书', 600, '2026-08-01')]
  assert.deepEqual(recentProjects(context(rows), 'learn', ['learn-1']), ['书乙', '书甲'])
  assert.deepEqual(recentProjects(context(rows), 'fun', ['fun-2']), ['小说甲'])
  assert.deepEqual(recentProjects({ ...context(rows), date: '2026-10-26', start: 650 }, 'learn', ['learn-1']), ['书甲'])
  const crossing = { ...row('cross', 'learn', 'learn-1', '夜读', 1430), end: 1460 }
  assert.deepEqual(recentProjects(context([crossing], 10), 'learn', ['learn-1']), [])
  assert.deepEqual(recentProjects(context([crossing], 25), 'learn', ['learn-1']), ['夜读'])
})
test('accepted defaults are weak evidence and do not displace a manually switched book', () => {
  const rows = [row('first'), row('switch', 'learn', 'learn-1', '书乙', 700), { ...row('automatic', 'learn', 'learn-1', '书甲', 720), suggestedFields: ['project' as const] }]
  assert.equal(recentProjects(context(rows), 'learn', ['learn-1'])[0], '书乙')
  const auto = prefill(draft(), context(rows))
  assert.equal(auto.project, '书乙')
  const manual = changeQuickDraft(auto, { project: '书丙' }, context(rows))
  assert.equal(prefill(manual, context(rows)).project, '书丙')
  assert.equal(changeQuickDraft(auto, { project: '' }, context(rows)).project, '')
  assert.equal(changeQuickDraft(auto, { category: 'fun' }, context(rows)).project, '')
})
test('duplicate covered minutes do not amplify evidence; archived categories excluded, source unchanged', () => {
  const rows = Array.from({ length: 15 }, (_, i) => row('seg-' + i, 'create', 'create-1', '', 600))
  const before = structuredClone(rows), ctx = context(rows)
  assert.equal(secondaryChoices(ctx, 'create')[0].score, secondaryChoices(context(rows.slice(0, 1)), 'create')[0].score)
  assert.deepEqual(rows, before)
  ctx.categories = structuredClone(categories); ctx.categories.find(c => c.id === 'create')!.children[0].archived = true
  assert.deepEqual(prefill(draft('create'), ctx).secondaryIds, [])
})
test('parallel candidates use current objects without learning unrelated AI project overlaps', () => {
  const ctx = context([row('novel', 'fun', 'fun-2', '小说乙')])
  assert.equal(parallelChoices(ctx, prefill(draft('health'), ctx))[0].project, '小说乙')
  assert.deepEqual(parallelChoices(ctx, draft('create')), [])
  assert.ok(validRecord({ ...row('source'), suggestedFields: ['project'] }, categories))
  assert.equal(validRecord({ ...row('source'), suggestedFields: ['other'] } as unknown as LedgerRecord, categories), false)
  assert.deepEqual(quickPreferences(null), DEFAULT_QUICK_PREFERENCES)
})
test('one-off non-book projects stay optional and explicit no-secondary can replace a temporary development default', () => {
  const old = row('project', 'create', 'create-1', '一次性项目')
  assert.equal(prefill(draft('create'), context([old])).project, '')
  assert.deepEqual(recentProjects(context([old]), 'create', ['create-1']), ['一次性项目'])
  const empty = { ...old, id: 'no-secondary', date: '2026-10-27', start: 860, end: 880, secondaryId: null, secondaryIds: [], project: '', suggestedFields: [] }
  assert.deepEqual(prefill(draft('create'), context([old, empty])).secondaryIds, [])
  assert.deepEqual(prefill(draft('create'), context([old, { ...empty, suggestedFields: undefined }])).secondaryIds, ['create-1'], 'legacy blanks are not inferred preferences')
})
test('combined reading/course category rename keeps recent object defaults tied to the existing ID', () => {
  const ctx = context([row('only-book')]); ctx.categories = structuredClone(categories)
  ctx.categories.find(c => c.id === 'learn')!.children.find(c => c.id === 'learn-1')!.name = '读/听书/课程'
  assert.equal(prefill(draft('learn'), ctx).project, '书甲')
})

test('full intervals and recent local coverage outweigh an old generic default, independent of fragmentation', () => {
  const rows = [
    { ...row('old', 'work', 'work-1', '', 840, '2026-10-25'), end: 850 },
    { ...row('new', 'work', 'work-4', '', 810), end: 900 },
    { ...row('evening', 'family', 'family-2', '', 1250), end: 1290 },
    { ...row('earlier-evening', 'family', 'family-2', '', 1250, '2026-10-23'), end: 1290 },
    { ...row('chat', 'family', 'family-4', '', 1140), end: 1170 }
  ]
  assert.equal(secondaryChoices(context(rows, 860), 'work')[0].secondaryIds[0], 'work-4')
  assert.equal(prefill(draft('family'), context(rows, 1260)).secondaryIds[0], 'family-2')
  const fragmented = [...rows.filter(r => r.id !== 'new'), ...Array.from({ length: 9 }, (_, i) => ({ ...rows[1], id: 'piece-' + i, start: 810 + i * 10, end: 820 + i * 10 }))]
  const score = (rs: LedgerRecord[]) => secondaryChoices(context(rs, 860), 'work').find(c => c.secondaryIds[0] === 'work-4')!.score
  assert.equal(score(rows), score(fragmented))
  assert.equal(score(rows), score([...fragmented, ...fragmented]))
})

test('walking on two workdays can replace training presets; morning and daytime sets remain available', () => {
  const rows = [
    { ...row('lunch', 'health', 'move-4', '', 680), end: 755 },
    { ...row('pickup', 'health', 'move-4', '', 1050), end: 1085 }
  ]
  rows.push(...rows.map(r => ({ ...r, id: r.id + '-earlier', date: '2026-10-23' })))
  assert.deepEqual(prefill(draft('health'), context(rows, 700)).secondaryIds, ['move-4'])
  assert.deepEqual(prefill(draft('health'), context(rows, 1050)).secondaryIds, ['move-4'])
  assert.deepEqual(prefill(draft('health'), context(rows, 465)).secondaryIds, ['move-0', 'move-2', 'move-3'])
  assert.deepEqual(prefill(draft('health'), context(rows, 840)).secondaryIds, ['move-1', 'move-2', 'move-3'])
  const archived = context(rows, 700); archived.categories = structuredClone(categories)
  archived.categories.find(c => c.id === 'health')!.children.find(c => c.id === 'move-4')!.archived = true
  assert.equal(prefill(draft('health'), archived).secondaryIds.includes('move-4'), false)
  assert.notEqual(prefill(draft('health'), context(rows.map(r => ({ ...r, date: '2026-10-10' })), 700)).secondaryIds[0], 'move-4')
})

test('several recent books stay visible; nearby explicit time context chooses the book, manual selection survives', () => {
  const rows = [row('night', 'learn', 'learn-1', '夜读书', 1410, '2026-10-23'), row('morning', 'learn', 'learn-1', '早间课程', 515), { ...row('noon', 'learn', 'learn-1', '午间课程', 685), end: 775 }]
  const ctx = context(rows, 1420)
  assert.deepEqual(recentProjects(ctx, 'learn', ['learn-1']), ['午间课程', '早间课程', '夜读书'])
  assert.equal(prefill(draft(), ctx).project, '夜读书')
  assert.equal(prefill(draft(), context(rows, 525)).project, '早间课程')
  assert.equal(prefill(draft(), context(rows, 740)).project, '午间课程')
  const manual = changeQuickDraft(prefill(draft(), ctx), { project: '午间课程' }, ctx)
  assert.equal(prefill(manual, ctx).project, '午间课程')
})

test('observed walking and reading work in both directions; pickup exposes two independent companions', () => {
  const rows = [
    { ...row('walk', 'health', 'move-4', '', 680), end: 755 },
    { ...row('course', 'learn', 'learn-1', '午间课程', 680), end: 780 },
    { ...row('pickup', 'family', 'family-3', '', 1050), end: 1085 },
    { ...row('walk-home', 'health', 'move-4', '', 1050), end: 1085 },
    { ...row('chat', 'family', 'family-4', '家人甲', 1050), end: 1085 }
  ]
  const before = structuredClone(rows), ctx = context(rows, 700)
  const walk = { ...draft('health'), secondaryIds: ['move-4'] }
  assert.equal(parallelChoices(ctx, walk).find(c => c.category === 'learn')?.project, '', 'midday course is now a user-picked object')
  const reverse = parallelChoices(ctx, { ...draft(), secondaryIds: ['learn-1'] })
  assert.equal(reverse[0].secondaryIds[0], 'move-4')
  const pickup = parallelChoices(context(rows, profile.pickup!.returnStart + 10), { ...draft('family'), secondaryIds: ['family-3'] })
  assert.equal(pickup.length, 2)
  assert.ok(pickup.some(c => c.secondaryIds.includes('move-4')))
  assert.ok(pickup.some(c => c.secondaryIds.includes('family-4') && c.project === '和小安'))
  assert.deepEqual(rows, before)
  const archived = context(rows, 700); archived.categories = structuredClone(categories)
  archived.categories.find(c => c.id === 'learn')!.children.find(c => c.id === 'learn-1')!.archived = true
  assert.equal(parallelChoices(archived, walk).some(c => c.secondaryIds.includes('learn-1')), false, 'archived choice is excluded; another active reading category remains available')
  const noOverlap = [{ ...rows[0], end: 690 }, { ...rows[1], start: 690 }]
  assert.equal(parallelChoices(context(noOverlap, 700), walk).find(c => c.category === 'learn')?.project, '', 'confirmed option does not infer the object from non-overlap')
  const future = rows.map(r => ({ ...r, date: '2026-10-29' }))
  assert.equal(parallelChoices(context(future, 700), walk).find(c => c.category === 'learn')?.project, '', 'future data cannot fill the object')
})

test('work and AI overlaps are not learned; confirmed sleep shortcut only offers ten minutes', () => {
  const rows = [row('video', 'create', 'create-1', '', 1200), row('dev', 'family', 'family-1', '', 1200), row('work', 'work', 'work-4', '', 900), row('info', 'learn', 'learn-3', '', 900), row('sleep', 'rest', 'rest-1', '', 10), row('novel', 'fun', 'fun-2', '小说甲', 10)]
  assert.deepEqual(parallelChoices(context(rows, 1250), { ...draft('create'), secondaryIds: ['create-1'] }), [])
  assert.deepEqual(parallelChoices(context(rows, 920), { ...draft('work'), secondaryIds: ['work-4'] }), [])
  assert.equal(parallelChoices(context(rows, 45), { ...draft('rest'), secondaryIds: ['rest-1'] })[0].maxMinutes, 10)
  assert.deepEqual(parallelChoices(context(rows, 45), { ...draft('fun'), secondaryIds: ['fun-2'] }), [])
})

test('work uses recent choices only: duration and time of day cannot prefill a project or activity', () => {
  const rows = [
    { ...row('long-project', 'work', 'work-4', '项目甲', 540), end: 900 },
    row('recent-project', 'work', 'work-1', '项目乙', 1000),
    { ...row('accepted-auto', 'work', 'work-4', '项目甲', 1040), suggestedFields: ['secondary' as const, 'project' as const] }
  ]
  const before = structuredClone(rows), ctx = context(rows, 850)
  const blank = prefill(draft('work'), ctx)
  assert.deepEqual(blank.secondaryIds, [])
  assert.equal(blank.project, '')
  for (const minute of [550, 850, 1050]) assert.equal(secondaryChoices(context(rows, minute), 'work')[0].secondaryIds[0], 'work-1', 'new explicit choice stays first, regardless of clock time or total duration')
  const categoryPicked = changeQuickDraft(blank, { secondaryIds: ['work-4'] }, ctx)
  assert.equal(categoryPicked.project, '', 'even a repeated project requires a click')
  assert.deepEqual(recentProjects(ctx, 'work', ['work-4']), ['项目甲'])
  const picked = changeQuickDraft(categoryPicked, { project: '项目甲' }, ctx)
  assert.deepEqual(prefill(picked, context(rows, 1100)).secondaryIds, ['work-4'])
  assert.equal(prefill(picked, context(rows, 1100)).project, '项目甲')
  assert.equal(prefill(picked, ctx, true), picked)
  assert.equal(prefill(changeQuickDraft(picked, { project: '' }, ctx), ctx).project, '')
  const oldAutomatic = { ...draft('work'), secondaryIds: ['work-4'], project: '项目甲', suggestedFields: ['secondary' as const, 'project' as const] }
  assert.deepEqual(prefill(oldAutomatic, ctx).secondaryIds, [])
  assert.equal(prefill(oldAutomatic, ctx).project, '')
  assert.equal(prefill(oldAutomatic, ctx, true), oldAutomatic, 'existing saved automatic fields are not rewritten')
  assert.deepEqual(rows, before)
})
