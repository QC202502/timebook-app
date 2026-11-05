import './fixtures/profile.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CATEGORIES, activityTitle, applyCategoryAction, allowsMultipleSecondaries, secondaryIdsOf, secondaryNames, sameSecondaries, withSecondaries, validRecord, validRecordShape, summarize, maxConcurrentActivities, toCsv, type LedgerRecord } from '../shared/lib/ledger-v2.ts'
import { groupKeys, summarizePeriod, periodRange, projectKey } from '../shared/lib/ledger-stats.ts'
import { replacementNeedsConfirmation } from '../shared/lib/record-edit.ts'

const training: LedgerRecord = { id: 'training', date: '2026-10-26', start: 540, end: 570, category: 'health', secondaryId: 'health-3', secondaryIds: ['health-3', 'health-4'], activity: '', activitySource: 'category', project: '日常训练', note: '', approximate: false }
test('legacy, empty and multiple movement selections validate without duplicate or foreign IDs', () => {
  assert.ok(validRecord(training))
  const { secondaryIds, ...legacy } = training
  assert.ok(validRecord(legacy)); assert.deepEqual(secondaryIdsOf(legacy), ['health-3'])
  assert.ok(validRecord({ ...training, secondaryId: null, secondaryIds: [] }))
  for (const ids of [['health-3', 'health-3'], ['health-3', 'work-1'], ['health-3', 'missing']]) assert.equal(validRecord({ ...training, secondaryIds: ids }), false)
  assert.equal(validRecordShape({ ...training, secondaryIds: 'health-3' }), false)
  assert.equal(validRecordShape({ ...training, secondaryId: 'health-4' }), false)
  assert.equal(validRecord({ ...training, category: 'work', secondaryId: 'work-1', secondaryIds: ['work-1', 'work-2'] }), false)
})
test('automatic titles and CSV show all movements in category order; custom descriptions remain', () => {
  assert.equal(activityTitle(training), '力量训练、拉伸')
  assert.equal(activityTitle({ ...training, activitySource: 'custom', activity: '晨练一组' }), '晨练一组')
  const { categories } = applyCategoryAction(CATEGORIES, [training], { type: 'save-secondary', id: 'health-4', parentId: 'health', name: '放松拉伸' })
  assert.equal(activityTitle(training, categories), '力量训练、放松拉伸')
  assert.match(toCsv([training], categories), /力量训练、放松拉伸/)
  assert.equal(toCsv([training], categories).split('\r\n').length, 2, 'one CSV data row per training record')
})
test('several movements are one activity, not extra concurrent activities or repeated global duration', () => {
  const daily = summarize([training], training.date)
  assert.deepEqual([daily.covered, daily.total, daily.parallel], [30, 30, 0])
  const health = daily.categories.find(c => c.id === 'health')!
  assert.equal(health.minutes, 30)
  assert.deepEqual(health.children.filter(c => c.minutes).map(c => c.minutes), [30, 30])
  assert.equal(maxConcurrentActivities([training]), 1)
  for (const period of ['day', 'week', 'month'] as const) {
    const report = summarizePeriod([training], CATEGORIES, periodRange(training.date, period))
    assert.deepEqual([report.covered, report.total, report.parallel, report.count], [30, 30, 0, 1])
    assert.equal(report.primary[0].total, 30); assert.equal(report.projects[0].total, 30)
    assert.deepEqual(report.secondary.map(g => [g.total, g.count]), [[30, 1], [30, 1]])
    assert.deepEqual(groupKeys(training, 'secondary'), ['health-3', 'health-4'])
  }
})
test('secondary filtering and period clipping retain a single original record', () => {
  const crossing = { ...training, date: '2026-10-31', start: 1430, end: 1460 }
  const report = summarizePeriod([crossing], CATEGORIES, periodRange(training.date, 'month'), { primary: 'health', secondary: 'health-4', project: projectKey(training.project) })
  assert.deepEqual([report.covered, report.total, report.count], [10, 10, 1])
  assert.equal(report.entries[0].record, crossing)
  assert.equal(summarizePeriod([crossing], CATEGORIES, periodRange(training.date, 'month'), { secondary: 'health:unset' }).count, 0)
})
test('real parallel records still add once each even with multiple shared movements', () => {
  const another = { ...training, id: 'another', start: 550, end: 580 }
  const report = summarizePeriod([training, another], CATEGORIES, periodRange(training.date, 'week'))
  assert.deepEqual([report.covered, report.total, report.parallel, report.count], [40, 60, 20, 2])
  assert.deepEqual(report.secondary.map(s => [s.covered, s.total, s.parallel, s.count]), [[40, 60, 20, 2], [40, 60, 20, 2]])
})
test('archiving/reordering preserves movement links and same-parent merge deduplicates', () => {
  let state = applyCategoryAction(CATEGORIES, [training], { type: 'archive', id: 'health-4', archived: true })
  assert.deepEqual(state.records, [training]); assert.ok(validRecord(training, state.categories))
  state = applyCategoryAction(state.categories, state.records, { type: 'reorder', id: 'health-4', direction: -1 })
  assert.equal(secondaryNames(training, state.categories), '拉伸、力量训练')
  state = applyCategoryAction(state.categories, state.records, { type: 'merge', sourceId: 'health-4', targetId: 'health-3' })
  assert.deepEqual(secondaryIdsOf(state.records[0]), ['health-3'])
  assert.equal(state.records[0].secondaryId, 'health-3'); assert.equal(state.records[0].end, 570)
})
test('cross-parent movement actions reject ambiguous multi-record reassignment atomically', () => {
  const before = structuredClone(CATEGORIES), rows = structuredClone([training])
  assert.throws(() => applyCategoryAction(CATEGORIES, rows, { type: 'save-secondary', id: 'health-4', parentId: 'life', name: '拉伸' }), /多选记录/)
  assert.throws(() => applyCategoryAction(CATEGORIES, rows, { type: 'merge', sourceId: 'health-4', targetId: 'life-1' }), /多选记录/)
  assert.deepEqual(CATEGORIES, before); assert.deepEqual(rows, [training])
})
test('whole primary merge preserves all movements and carries multi-select capability', () => {
  const state = applyCategoryAction(CATEGORIES, [training], { type: 'merge', sourceId: 'health', targetId: 'life' })
  assert.equal(state.records[0].category, 'life')
  assert.ok(allowsMultipleSecondaries(state.categories.find(c => c.id === 'life')!))
  assert.ok(validRecord(state.records[0], state.categories))
  assert.deepEqual(secondaryIdsOf(state.records[0]), ['health-3', 'health-4'])
})
test('selection order is not a different activity; shortening and removing a movement is guarded', () => {
  const reordered = withSecondaries(training, ['health-4', 'health-3'])
  assert.ok(sameSecondaries(training, reordered))
  assert.equal(replacementNeedsConfirmation(training, { ...reordered, end: 569 }), false)
  assert.equal(replacementNeedsConfirmation(training, withSecondaries({ ...training, end: 569 }, ['health-3'])), true)
})
