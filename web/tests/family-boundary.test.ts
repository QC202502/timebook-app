import './fixtures/profile.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CATEGORIES, applyCategoryAction, activityTitle, secondaryIdsOf, validCategories, validRecord, type LedgerRecord } from '../shared/lib/ledger-v2.ts'
import { summarizePeriod, periodRange } from '../shared/lib/ledger-stats.ts'
import { buildDayShare } from '../shared/lib/day-share.ts'
import { parallelChoices, prefill, changeQuickDraft, recentProjects, secondaryChoices, DEFAULT_QUICK_PREFERENCES, type QuickContext } from '../shared/lib/quick-input.ts'

const row = (id: string, category: string, secondaryId: string, start: number, end: number): LedgerRecord => ({ id, date: '2026-10-26', start, end, category, secondaryId, secondaryIds: [secondaryId], activity: '', activitySource: 'category', project: '', note: '', approximate: false })
const records = [
  { ...row('chores', 'life', 'life-2', 1140, 1200), activity: '洗衣、收拾厨房', activitySource: 'custom' as const, project: '自定义项目', note: '保留原备注', approximate: true, suggestedFields: ['secondary' as const] },
  row('chat', 'family', 'family-4', 1160, 1180),
  row('overnight', 'life', 'life-2', 1430, 1450),
  row('meal', 'life', 'life-1', 1200, 1220),
  row('sleep', 'rest', 'rest-1', 0, 400),
  { ...row('legacy', 'life', 'life-2', 600, 605), secondaryIds: undefined }
]
function migrate() {
  let s = { categories: structuredClone(CATEGORIES), records: structuredClone(records) }
  for (const [id, name] of [['family', '家庭与家务'], ['life', '个人生活与出行']]) s = applyCategoryAction(s.categories, s.records, { type: 'save-primary', id, name, color: s.categories.find(c => c.id === id)!.color })
  return applyCategoryAction(s.categories, s.records, { type: 'save-secondary', id: 'life-2', parentId: 'family', name: '家务' })
}
const ctx = (start = 1150): QuickContext => ({ ...migrate(), date: '2026-10-27', start, now: { date: '2026-10-27', minute: 1400 }, preferences: structuredClone(DEFAULT_QUICK_PREFERENCES) })

test('approved family move changes only chore primary IDs, keeping every other historical field and category order', () => {
  const original = structuredClone({ categories: CATEGORIES, records }), s = migrate()
  assert.ok(validCategories(s.categories)); assert.ok(s.records.every(r => validRecord(r, s.categories)))
  assert.deepEqual(s.records, records.map(r => secondaryIdsOf(r).includes('life-2') ? { ...r, category: 'family' } : r))
  assert.deepEqual({ categories: CATEGORIES, records }, original)
  assert.deepEqual(s.categories.map(c => c.id), CATEGORIES.map(c => c.id))
  assert.deepEqual(s.categories.find(c => c.id === 'family')!.children.map(c => c.id), [...CATEGORIES.find(c => c.id === 'family')!.children.map(c => c.id), 'life-2'])
  assert.equal(s.categories.find(c => c.id === 'life')!.children.some(c => c.id === 'life-2'), false)
  assert.equal(validRecord(records[0], s.categories), false, 'stale primary/secondary combination is invalid')
  assert.equal(activityTitle(s.records[0], s.categories), '洗衣、收拾厨房')
  assert.equal(activityTitle(s.records[2], s.categories), '家务')
})

test('day/week/month global and project metrics survive reclassification; same-family overlap is deduplicated', () => {
  const s = migrate(), metrics = ({ covered, total, parallel, count }: ReturnType<typeof summarizePeriod>) => ({ covered, total, parallel, count })
  for (const period of ['day', 'week', 'month'] as const) {
    const range = periodRange('2026-10-26', period)
    const before = summarizePeriod(records, CATEGORIES, range), after = summarizePeriod(s.records, s.categories, range)
    assert.deepEqual(metrics(after), metrics(before)); assert.deepEqual(after.days, before.days)
    assert.deepEqual(after.projects, before.projects)
    const chore = after.secondary.find(g => g.key === 'life-2')!, old = before.secondary.find(g => g.key === 'life-2')!
    assert.deepEqual({ ...chore, parentName: old.parentName, color: old.color }, old)
    assert.equal(chore.parentName, '家庭与家务')
    assert.equal(after.primary.find(g => g.key === 'family')!.covered - before.primary.find(g => g.key === 'family')!.covered, chore.covered - 20)
    assert.equal(after.primary.find(g => g.key === 'life')!.name, '个人生活与出行')
  }
  const share = buildDayShare(s.records, s.categories, '2026-10-26', { range: 'recorded', labels: 'primary', details: true }, { date: '2026-10-27', minute: 1000 })
  assert.equal(share.details.find(d => d.start === 1140)!.label, '家庭与家务')
  assert.equal(share.details.find(d => d.start === 1200)!.label, '个人生活与出行')
  assert.ok(share.categories.some(c => c.name === '家庭与家务'))
})

test('moved household work and family chat remain bidirectional companions using stable child IDs', () => {
  const context = ctx()
  const chores = { category: 'family', secondaryIds: ['life-2'], project: '' }
  const chat = { category: 'family', secondaryIds: ['family-4'], project: '' }
  assert.ok(parallelChoices(context, chores).some(c => c.category === 'family' && c.secondaryIds.includes('family-4')))
  assert.ok(parallelChoices(context, chat).some(c => c.category === 'family' && c.secondaryIds.includes('life-2')))
  assert.equal(secondaryChoices(context, 'life').some(c => c.secondaryIds.includes('life-2')), false)
  const householdOnly = { ...context, records: context.records.filter(r => secondaryIdsOf(r).includes('life-2')).map(r => ({ ...r, suggestedFields: [] })) }
  assert.deepEqual(prefill({ category: 'family', secondaryIds: [], project: '' }, householdOnly).secondaryIds, [], 'one observed day remains an alternative')
  householdOnly.records.push(...householdOnly.records.map(r => ({ ...r, id: r.id + '-earlier', date: '2026-10-23' })))
  assert.deepEqual(prefill({ category: 'family', secondaryIds: [], project: '' }, householdOnly).secondaryIds, ['life-2'])
})

test('phase-like family tasks and projects require a click while explicit choices and editing survive', () => {
  for (const name of ['家庭财务', '物资采买', '开发「数学错题本」', '准备教辅材料/工具']) {
    const context = ctx(900)
    context.categories.find(c => c.id === 'family')!.children.push({ id: 'phase', name, archived: false })
    context.records = [1, 2].map(i => ({ ...row('phase-' + i, 'family', 'phase', 850 + i * 20, 870 + i * 20), project: '阶段项目' }))
    const automatic = prefill({ category: 'family', secondaryIds: [] as string[], project: '' }, context)
    assert.deepEqual(automatic.secondaryIds, []); assert.equal(automatic.project, '')
    assert.equal(secondaryChoices(context, 'family')[0].secondaryIds[0], 'phase')
    const manual = changeQuickDraft(automatic, { secondaryIds: ['phase'] }, context)
    assert.equal(manual.project, '')
    assert.deepEqual(recentProjects(context, 'family', ['phase']), ['阶段项目'])
    const chosen = changeQuickDraft(manual, { project: '阶段项目' }, context)
    assert.deepEqual(prefill(chosen, { ...context, start: 1000 }), chosen)
    assert.equal(prefill(chosen, context, true), chosen)
  }
})
