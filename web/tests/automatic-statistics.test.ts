import './fixtures/profile.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveStatistics, activeProjects, objectSummary, activityRollup } from '../shared/lib/automatic-statistics.ts'
import { emptyCollaboration, emptyContext } from '../shared/lib/collaboration.ts'
import { CATEGORIES, type LedgerRecord, type Category } from '../shared/lib/ledger-v2.ts'
const categories: Category[] = structuredClone(CATEGORIES)
categories.find(c => c.id === 'work')!.children.push({ id: 'etf', name: '项目A 相关工作', archived: false })
categories.find(c => c.id === 'create')!.children.push({ id: 'video', name: '视频日记', archived: false })
categories.find(c => c.id === 'family')!.children.push({ id: 'math', name: '开发「示例学习工具」', archived: false }, { id: 'pickup', name: '接送小安', archived: false })
categories.push({ id: 'social', name: '社交', color: '#000000', archived: false, children: [] })
const record = (id: string, patch: Partial<LedgerRecord> = {}): LedgerRecord => ({ id, date: '2026-10-29', start: 600, end: 620, category: 'work', secondaryIds: [], activity: '', project: '', note: '', approximate: false, ...patch })
const range = { start: '2026-10-29', end: '2026-10-30' }, now = { date: '2026-10-29', minute: 1080 }

test('no catalog needed; specific project beats broad secondary; stage is not a project; source is immutable', () => {
 const data = emptyCollaboration(), rows = [record('a', { category: 'family', secondaryIds: ['math'] }), record('b', { category: 'family', secondaryIds: ['math'], project: '开发「示例日历」' }), record('c', { category: 'create', secondaryIds: ['video'], project: '选题' }), record('d', { secondaryIds: ['etf'], project: '项目A 策略' })]
 const before = JSON.stringify({ data, rows }), v = deriveStatistics(data, rows, categories), p = activeProjects(v.data, v.records, range, now, false)
 assert.deepEqual(new Set(p.map(r => r.entity.name)), new Set(['示例学习工具', '示例日历', '视频日记', '项目A 策略']))
 assert.equal(v.records[2].context?.stage, '选题');assert.equal(v.records[0].context?.executor, 'legacy');assert.equal(JSON.stringify({ data, rows }), before)
 assert.ok(p.every(p => p.human.covered === 20 && p.human.humanMinutes === 0));assert.equal(v.data.tasks, data.tasks)
})
test('explicit links and reference roles override inferred names; virtual profiles reuse only unique known matches', () => {
 const data = emptyCollaboration();data.entities.push({ id: 'explicit', kind: 'project', name: '正式项目', status: 'active' }, { id: 'book', kind: 'book', name: '测试书甲', status: 'active' }, { id: 'person', kind: 'person', name: '林林', status: 'active' })
 const rows = [record('a', { category: 'learn', secondaryIds: ['learn-1'], project: '另一本书', context: { ...emptyContext('human'), projectId: 'explicit', books: [{ id: 'book', role: 'reference' }], people: [{ id: 'person', role: 'mentioned' }] } }), record('b', { category: 'learn', secondaryIds: ['learn-1'], project: '《测试书甲》' })]
 const v = deriveStatistics(data, rows, categories);assert.equal(v.records[0], rows[0]);assert.equal(v.records[1].context?.books[0].id, 'book');assert.equal(v.virtualIds.size, 0)
 const b = objectSummary(v.data, v.records, range, now, false, 'book')[0];assert.equal(b.actual.count, 1);assert.equal(b.all.count, 2)
 const p = objectSummary(v.data, v.records, range, now, false, 'person')[0];assert.equal(p.actual.covered, 0);assert.equal(p.all.covered, 20)
})
test('books/courses come from reading context, never a blank title, topic, movie or stage', () => {
 const rows = [record('a', { category: 'learn', secondaryIds: ['learn-1'], project: '《测试书甲》' }), record('b', { category: 'learn', secondaryIds: ['learn-3'], project: '测试课程甲' }), record('c', { category: 'fun', secondaryIds: ['fun-2'], project: '示例小说' }), record('d', { category: 'fun', secondaryIds: ['fun-3'], project: '《测试电影乙》' }), record('e', { category: 'learn', secondaryIds: ['learn-1'] })]
 const v = deriveStatistics(emptyCollaboration(), rows, categories);assert.deepEqual(new Set(objectSummary(v.data, v.records, range, now, false).map(r => r.entity.name)), new Set(['测试书甲', '测试课程甲', '示例小说']));assert.equal(v.records[4].context, undefined);assert.ok(v.unresolved.some(u => u.text === '《测试电影乙》'))
})
test('approved joint names are split; social subjects and explicit participants are identified without guessing blank chatter or pickup', () => {
 const rows = [record('a', { category: 'family', project: '和林林与小安' }), record('b', { category: 'social', project: '明明' }), record('c', { category: 'social', activity: '和阿青一起走路' }), record('d', { activity: '和小白、小蓝、小绿' }), record('e', { category: 'family', secondaryIds: ['pickup'] }), record('f', { category: 'family', activity: '和同事讨论方案' })]
 const v = deriveStatistics(emptyCollaboration(), rows, categories);const people = objectSummary(v.data, v.records, range, now, false, 'person');assert.deepEqual(new Set(people.map(r => r.entity.name)), new Set(['林林', '小安', '明明', '阿青', '小白', '小蓝', '小绿']));assert.equal(v.records[4].context, undefined);assert.equal(v.records[5].context, undefined);assert.equal(v.records.length, rows.length)
})
test('overlap, cross-midnight and elapsed cutoff deduplicate each person and keep unrelated/future scopes empty', () => {
 const rows = [record('a', { category: 'family', project: '和林林和小安', date: '2026-10-28', start: 1430, end: 1460 }), record('b', { category: 'family', project: '和林林', start: 10, end: 40 })]
 const v = deriveStatistics(emptyCollaboration(), rows, categories), people = objectSummary(v.data, v.records, range, now, false, 'person');assert.equal(people.find(r => r.entity.name === '林林')?.actual.covered, 40);assert.equal(people.find(r => r.entity.name === '小安')?.actual.covered, 20)
 assert.equal(objectSummary(v.data, v.records, range, { ...now, minute: 15 }, true)[0].actual.covered, 15);assert.equal(objectSummary(v.data, v.records, { start: '2026-11-01', end: '2026-11-02' }, now, false).length, 0)
})
test('pauses and mixed executor overlap are preserved in project stage and activity totals', () => {
 const rows = [record('a', { activity: '写方案', project: '测试项目', context: { ...emptyContext('human'), stage: '准备', breaks: [{ start: 605, end: 610 }] } }), record('b', { activity: '写方案', project: '测试项目', start: 610, end: 625, context: { ...emptyContext('legacy'), stage: '准备' } })]
 const v = deriveStatistics(emptyCollaboration(), rows, categories), project = activeProjects(v.data, v.records, range, now, false)[0]
 assert.equal(project.human.covered, 20);assert.equal(project.human.total, 30);assert.equal(project.stages[0].covered, 20);assert.equal(activityRollup(v.records, categories, range, now, false)[0].covered, 20)
})
test('unclassified work is retained without a catch-all project; inactive profiles stay out of reports', () => {
 const data = emptyCollaboration();data.entities.push({ id: 'unused', kind: 'project', name: '另一个项目', status: 'active' })
 const rows = [record('a', { activity: '处理示例任务' })], v = deriveStatistics(data, rows, categories)
 assert.equal(activeProjects(v.data, v.records, range, now, false).length, 0);assert.equal(v.records[0], rows[0]);assert.equal(v.virtualIds.size, 0)
})
test('the seven excluded groups are not inferred, including spacing/case variants; other projects survive', () => {
 const names = ['其他工作事项', '示例联络', '项目A 推广', '项目A 商务', '沟通', '路演', '示例巡检'], cats = structuredClone(categories)
 cats.find(c => c.id === 'work')!.children.push(...names.map((name, i) => ({ id: 'excluded-' + i, name, archived: false })))
 const rows = names.map((_, i) => record('x' + i, { secondaryIds: ['excluded-' + i] }))
 rows.push(record('variant1', { project: '项目a商务', secondaryIds: ['etf'] }), record('variant2', { project: '项目A　推 广', secondaryIds: ['etf'] }), record('keep1', { project: '项目A 策略' }), record('keep2', { project: '项目A 商务平台' }), record('keep3', { project: '示例流程修订' }))
 const before = JSON.stringify(rows), v = deriveStatistics(emptyCollaboration(), rows, cats)
 assert.deepEqual(new Set(activeProjects(v.data, v.records, range, now, false).map(p => p.entity.name)), new Set(['项目A 策略', '项目A 商务平台', '示例流程修订']))
 assert.ok(v.records.slice(0, 9).every((r, i) => r === rows[i]));assert.equal(v.records.length, rows.length);assert.equal(JSON.stringify(rows), before)
 assert.equal(v.inferred.filter(l => l.kind === 'project').length, 3);assert.equal(v.unresolved.length, 0)
})
test('excluded automatic names never override explicitly saved project links or modify registered profiles', () => {
 const data = emptyCollaboration();data.entities.push({ id: 'manual', kind: 'project', name: '项目A 商务', status: 'active' })
 const rows = [record('manual-link', { project: '项目A 商务', context: { ...emptyContext('human'), projectId: 'manual' } }), record('raw-only', { project: '项目A 商务' })]
 const before = JSON.stringify({ data, rows }), v = deriveStatistics(data, rows, categories), p = activeProjects(v.data, v.records, range, now, false)
 assert.equal(p.length, 1);assert.equal(p[0].human.count, 1);assert.equal(p[0].entity.id, 'manual');assert.equal(v.virtualIds.size, 0);assert.equal(JSON.stringify({ data, rows }), before)
})
test('project exclusions preserve person associations and same-named books', () => {
 const cats = structuredClone(categories);cats.find(c => c.id === 'work')!.children.push({ id: 'communication', name: '沟通', archived: false })
 const rows = [record('people', { secondaryIds: ['communication'], project: '和林林与小安' }), record('book', { category: 'learn', secondaryIds: ['learn-1'], project: '《沟通》' })]
 const before = JSON.stringify(rows), v = deriveStatistics(emptyCollaboration(), rows, cats)
 assert.equal(activeProjects(v.data, v.records, range, now, false).length, 0)
 assert.deepEqual(new Set(objectSummary(v.data, v.records, range, now, false).map(r => r.entity.name)), new Set(['林林', '小安', '沟通']))
 assert.ok(objectSummary(v.data, v.records, range, now, false).every(r => r.actual.covered === 20));assert.equal(JSON.stringify(rows), before)
})
