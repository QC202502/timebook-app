import './fixtures/profile.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CATEGORIES, applyCategoryAction, summarize, type LedgerRecord } from '../shared/lib/ledger-v2.ts'
import { periodRange, shiftPeriod, summarizePeriod, projectKey, reportCsv } from '../shared/lib/ledger-stats.ts'

const rec = (id: string, date: string, start: number, end: number, patch: Partial<LedgerRecord> = {}): LedgerRecord => ({ id, date, start, end, category: 'work', secondaryId: 'work-1', activity: 'fixture', project: '时间账本', note: '', approximate: false, ...patch })
test('weeks are Monday through Sunday, including cross-year weeks', () => {
  assert.deepEqual(periodRange('2026-10-26', 'week'), { start: '2026-10-26', end: '2026-11-02' })
  assert.deepEqual(periodRange('2026-11-01', 'week'), periodRange('2026-10-26', 'week'))
  assert.deepEqual(periodRange('2027-01-01', 'week'), { start: '2026-12-28', end: '2027-01-04' })
  assert.deepEqual(periodRange('2026-10-26', 'day'), { start: '2026-10-26', end: '2026-10-27' })
})
test('month boundaries and navigation handle leap years, short months and year changes', () => {
  assert.deepEqual(periodRange('2024-02-29', 'month'), { start: '2024-02-01', end: '2024-03-01' })
  assert.deepEqual(periodRange('2025-02-28', 'month'), { start: '2025-02-01', end: '2025-03-01' })
  assert.deepEqual(periodRange('2099-12-31', 'month'), { start: '2099-12-01', end: '2100-01-01' })
  assert.equal(shiftPeriod('2026-01-31', 'month', 1), '2026-02-01')
  assert.equal(shiftPeriod('2026-01-31', 'month', -1), '2025-12-01')
  assert.equal(shiftPeriod('2026-10-26', 'week', -1), '2026-10-19')
})
test('parent and project coverage union siblings while activity total remains additive', () => {
  const rows = [rec('a', '2026-10-26', 540, 600), rec('b', '2026-10-26', 570, 630, { secondaryId: 'work-2' })]
  const r = summarizePeriod(rows, CATEGORIES, periodRange('2026-10-26', 'week'))
  assert.deepEqual([r.covered, r.total, r.parallel, r.count, r.recordedDays], [90, 120, 30, 2, 1])
  assert.deepEqual([r.primary[0].covered, r.primary[0].total], [90, 120])
  assert.equal(r.secondary.reduce((sum, s) => sum + s.covered, 0), 120)
  assert.deepEqual([r.projects[0].covered, r.projects[0].total], [90, 120])
  const day = summarize(rows, '2026-10-26')
  assert.deepEqual([r.covered, r.total, r.parallel], [day.covered, day.total, day.parallel])
})
test('cross-category and three-way parallel time are not confused with extra activity minutes', () => {
  const rows = [rec('a', '2026-10-26', 0, 10), rec('b', '2026-10-26', 0, 10, { category: 'learn', secondaryId: 'learn-1' }), rec('c', '2026-10-26', 0, 10, { category: 'health', secondaryId: 'health-1' })]
  const r = summarizePeriod(rows, CATEGORIES, periodRange('2026-10-26', 'month'))
  assert.deepEqual([r.covered, r.total, r.parallel], [10, 30, 10])
  assert.equal(r.primary.reduce((s, g) => s + g.covered, 0), 30)
  assert.equal(r.projects[0].covered, 10)
})
test('month clipping includes carry-in and excludes end boundary, without changing source records', () => {
  const rows = [rec('carry', '2026-09-30', 1430, 1460), rec('last', '2026-10-31', 1430, 1470), rec('nov', '2026-11-01', 60, 90)]
  const original = structuredClone(rows)
  const october = summarizePeriod(rows, CATEGORIES, periodRange('2026-10-26', 'month'))
  assert.deepEqual([october.covered, october.total, october.count], [30, 30, 2])
  assert.equal(october.days[0].covered, 20); assert.equal(october.days[30].covered, 10)
  const week = summarizePeriod(rows, CATEGORIES, periodRange('2026-10-26', 'week'))
  assert.deepEqual([week.total, week.count], [70, 2])
  assert.equal(week.days[5].total, 10); assert.equal(week.days[6].total, 60)
  assert.equal(week.days.reduce((s, d) => s + d.total, 0), week.total)
  assert.equal(week.days.reduce((s, d) => s + d.covered, 0), week.covered)
  assert.deepEqual(rows, original)
})
test('week carry-in, adjacent boundaries and record count remain exact', () => {
  const rows = [rec('carry', '2026-10-25', 1430, 1450), rec('next', '2026-10-26', 10, 20)]
  const r = summarizePeriod(rows, CATEGORIES, periodRange('2026-10-26', 'week'))
  assert.deepEqual([r.covered, r.total, r.parallel, r.count], [20, 20, 0, 2])
})
test('blank and named projects remain separate; trimmed names group without splitting text', () => {
  const rows = [rec('a', '2026-10-26', 0, 10, { project: '' }), rec('b', '2026-10-26', 0, 10, { project: '未填写项目 / 对象' }), rec('c', '2026-10-26', 0, 10, { project: ' A / B ' }), rec('d', '2026-10-26', 10, 20, { project: 'A / B' })]
  const r = summarizePeriod(rows, CATEGORIES, periodRange('2026-10-26', 'week'))
  assert.equal(r.projects.length, 3)
  assert.notEqual(projectKey(''), projectKey('未填写项目 / 对象'))
  assert.equal(r.projects.find(g => g.key === projectKey('A / B'))?.total, 20)
  const blank = summarizePeriod(rows, CATEGORIES, periodRange('2026-10-26', 'week'), { project: projectKey('') })
  assert.deepEqual(blank.entries.map(e => e.record.id), ['a'])
})
test('combined filters and unset-secondary buckets narrow the same records for every dimension', () => {
  const rows = [rec('a', '2026-10-26', 0, 10, { secondaryId: null, project: '' }), rec('b', '2026-10-26', 10, 30, { secondaryId: null }), rec('c', '2026-10-26', 0, 40)]
  const r = summarizePeriod(rows, CATEGORIES, periodRange('2026-10-26', 'week'), { primary: 'work', secondary: 'work:unset', project: projectKey('') })
  assert.deepEqual([r.covered, r.total, r.count], [10, 10, 1])
  assert.equal(r.secondary[0].name, '未设二级')
})
test('latest category rename, move and archive are reflected without rewriting activity text', () => {
  const rows = [rec('a', '2026-10-26', 0, 30)]
  let state = applyCategoryAction(structuredClone(CATEGORIES), rows, { type: 'save-secondary', id: 'work-1', parentId: 'learn', name: '项目学习' })
  state = applyCategoryAction(state.categories, state.records, { type: 'archive', id: 'work-1', archived: true })
  const r = summarizePeriod(state.records, state.categories, periodRange('2026-10-26', 'month'))
  assert.equal(r.primary[0].key, 'learn'); assert.equal(r.secondary[0].name, '项目学习'); assert.equal(r.secondary[0].archived, true)
  assert.equal(r.secondary[0].parentName, '学习成长'); assert.equal(r.total, 30)
  assert.equal(rows[0].activity, 'fixture')
})
test('elapsed scope clips ongoing activities and never counts future days as elapsed', () => {
  const rows = [rec('a', '2026-10-26', 590, 620), rec('b', '2026-10-27', 0, 60)]
  const range = periodRange('2026-10-26', 'week'), now = { date: '2026-10-26', minute: 600 }
  const full = summarizePeriod(rows, CATEGORIES, range, {}, now)
  const elapsed = summarizePeriod(rows, CATEGORIES, range, {}, now, true)
  assert.deepEqual([full.total, full.futureCount], [90, 2])
  assert.deepEqual([elapsed.total, elapsed.covered, elapsed.futureCount, elapsed.count], [10, 10, 0, 1])
  const future = summarizePeriod(rows, CATEGORIES, periodRange('2026-11-02', 'week'), {}, now, true)
  assert.equal(future.total, 0); assert.equal(future.days.length, 7)
})
test('empty month is zero rather than missing or NaN, with every day represented', () => {
  const r = summarizePeriod([], CATEGORIES, periodRange('2024-02-10', 'month'))
  assert.deepEqual([r.covered, r.total, r.parallel, r.count, r.days.length], [0, 0, 0, 0, 29])
  assert.deepEqual(r.primary, []); assert.deepEqual(r.projects, [])
})
test('CSV exposes both minute columns, recalculated union total and safe project text', () => {
  const range = periodRange('2026-10-26', 'week')
  const r = summarizePeriod([rec('a', '2026-10-26', 0, 10, { project: '=formula' })], CATEGORIES, range)
  const csv = reportCsv(range, r.projects, r, '全部已录入')
  assert.match(csv, /已记录覆盖分钟（去重）/); assert.match(csv, /活动累计分钟（逐条相加）/)
  assert.match(csv, /2026-11-01/); assert.match(csv, /'=formula/)
  assert.match(csv, /所选范围合计（重新去重）/)
})
