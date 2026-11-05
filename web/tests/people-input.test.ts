import './fixtures/profile.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyContext, type Entity } from '../shared/lib/collaboration.ts'
import { allowsUnregisteredPeople, changePeopleText, peopleInText, recentPeople, selectedPeople, syncPeopleContext, togglePerson, resolvePeople } from '../shared/lib/people-input.ts'
import { CATEGORIES, type LedgerRecord } from '../shared/lib/ledger-v2.ts'
import { prefill, DEFAULT_QUICK_PREFERENCES } from '../shared/lib/quick-input.ts'
const a: Entity = { id: 'person-alpha', kind: 'person', name: '林林', status: 'active' }
const b: Entity = { id: 'person-beta', kind: 'person', name: '小安', status: 'active' }
const row = (id: string, project = ''): LedgerRecord => ({ id, date: '2026-10-29', start: 600, end: 620, category: 'family', secondaryId: 'chat', activity: '聊天', project, note: '', approximate: false })

test('only approved combinations and exact known people are split; prose and books are not guessed', () => {
  for (const value of ['和林林和小安', '和林林与小安', '林林、小安']) assert.deepEqual(peopleInText(value), ['林林', '小安'])
  assert.deepEqual(peopleInText('和林林'), ['林林'])
  for (const value of ['战争与和平', '和林林聊项目', '张三和李四', '产品与渠道']) assert.deepEqual(peopleInText(value), [])
  assert.deepEqual(peopleInText('和王和平', [{ ...a, name: '王和平' }]), ['王和平'])
})
test('multi-select stages profiles, deselects independently, and keeps unrelated project text and metadata', () => {
  let n = 0
  const initial = { project: '', context: { ...emptyContext(), projectId: 'work-project', stage: '复核', books: [{ id: 'book', role: 'reference' as const }] } }
  const first = { ...initial, ...togglePerson(initial, '林林', [], () => 'new-' + ++n) }
  const both = { ...first, ...togglePerson(first, '小安', first.pendingPeople, () => 'new-' + ++n) }
  assert.equal(both.project, '林林、小安'); assert.equal(both.context.people.length, 2)
  assert.equal(both.context.projectId, 'work-project'); assert.deepEqual(both.context.books, initial.context.books)
  const removed = { ...both, ...togglePerson(both, '林林', both.pendingPeople, () => 'unused') }
  assert.deepEqual(selectedPeople(removed, both.pendingPeople), ['小安'])
  const cleared = togglePerson(removed, '小安', both.pendingPeople, () => 'unused')
  assert.equal(cleared.project, ''); assert.deepEqual(cleared.context.people, [])
  assert.equal(togglePerson({ ...initial, project: '周末计划' }, '林林', [a], () => 'unused').project, undefined)
})
test('opening legacy combinations is read-only, toggling retains legacy executor; recent candidates deduplicate', () => {
  const old = row('old', '和林林和小安'), frozen = structuredClone(old)
  assert.deepEqual(recentPeople(['和林林', '和林林和小安', '和林林与小安', '和小安'], [old], 'family', ['chat'], [], old), ['林林', '小安'])
  assert.deepEqual(old, frozen)
  const patch = togglePerson(old, '林林', [a, b], () => 'unused', true)
  assert.equal(patch.project, '小安'); assert.equal(patch.context.executor, 'legacy'); assert.deepEqual(patch.context.people, [{ id: 'person-beta', role: 'together' }])
  assert.deepEqual(old, frozen)
})
test('main and parallel cards resolve one person once and reuse an existing profile; unselected pending profiles are not saved', () => {
  const x = { ...a, id: 'new-one' }, y = { ...a, id: 'new-two' }
  const one = { ...row('one'), context: { ...emptyContext(), people: [{ id: x.id, role: 'together' as const }] } }
  const two = { ...row('two'), context: { ...emptyContext(), people: [{ id: y.id, role: 'mentioned' as const }] } }
  const result = resolvePeople([one, two], [x, y, b], [])
  assert.equal(result.entities.length, 1); assert.equal(result.upserts[0].context!.people[0].id, result.upserts[1].context!.people[0].id)
  const reuse = resolvePeople([one, two], [x, y], [a]); assert.deepEqual(reuse.entities, []); assert.ok(reuse.upserts.every(r => r.context!.people[0].id === a.id))
  assert.equal(one.context.people[0].id, x.id); assert.equal(two.context.people[0].id, y.id)
})
test('lower person fields synchronize selected text only for actual people changes, preserving other field edits', () => {
  const draft = { project: '和林林和小安', context: { ...emptyContext(), people: [{ id: a.id, role: 'together' as const }, { id: b.id, role: 'together' as const }] } }
  assert.equal(syncPeopleContext(draft, { ...draft.context, stage: '沟通' }, [a,b]).project, undefined)
  assert.equal(syncPeopleContext(draft, { ...draft.context, people: [draft.context.people[0]] }, [a,b]).project, '林林')
  assert.equal(syncPeopleContext(draft, { ...draft.context, people: [] }, [a,b]).project, '')
})
test('repeated old person text no longer auto-fills a new activity', () => {
  const categories = structuredClone(CATEGORIES); categories.find(c => c.id === 'family')!.children = [{ id: 'chat', name: '聊天', archived: false }]
  const records = [{ ...row('a', '和林林'), date: '2026-10-27' }, { ...row('b', '和林林'), date: '2026-10-28' }]
  const draft = prefill({ category: 'family', secondaryIds: ['chat'], secondaryManual: true, project: '' }, { records, categories, date: '2026-10-29', start: 650, now: { date: '2026-10-29', minute: 1100 }, preferences: DEFAULT_QUICK_PREFERENCES })
  assert.equal(draft.project, '')
})
test('social and family conversation accept new person candidates, without broadening book/project or report inference', () => {
  const categories = structuredClone(CATEGORIES)
  categories.push({ id: 'social-test', name: '社交', color: '#123456', archived: false, children: [{ id: 'parents', name: '同学家长', archived: false }, { id: 'book-club', name: '读书会', archived: false }] })
  assert.equal(allowsUnregisteredPeople(categories, 'social-test', ['parents']), true)
  assert.equal(allowsUnregisteredPeople(categories, 'social-test', ['book-club']), false)
  assert.equal(allowsUnregisteredPeople(categories, 'work', []), false)
  assert.equal(allowsUnregisteredPeople(categories, 'learn', ['learn-1']), false)
  assert.deepEqual(peopleInText('周女士、李先生、周女士', [], true), ['周女士', '李先生'])
  assert.deepEqual(peopleInText('周女士'), [])
  for (const text of ['张三和李四', '战争与和平', '周末计划', '讨论接送问题']) assert.deepEqual(peopleInText(text, [], true), [])
})
test('a legacy unregistered person stays selected when adding another and each person can be removed independently', () => {
  let seq = 0;const initial = { project: '周女士' }, frozen = structuredClone(initial)
  assert.deepEqual(recentPeople(['李先生'], [], 'social', ['parents'], [], initial, true), ['周女士', '李先生'])
  const both = { ...initial, ...togglePerson(initial, '李先生', [], () => 'person-' + ++seq, true, true) }
  assert.equal(both.project, '周女士、李先生');assert.equal(both.context.executor, 'legacy');assert.equal(both.pendingPeople.length, 2)
  const one = { ...both, ...togglePerson(both, '周女士', both.pendingPeople, () => 'unused', true, true) }
  assert.equal(one.project, '李先生');assert.equal(one.context.people.length, 1)
  const empty = togglePerson(one, '李先生', one.pendingPeople, () => 'unused', true, true)
  assert.equal(empty.project, '');assert.deepEqual(empty.context.people, []);assert.deepEqual(initial, frozen)
})
test('editing or clearing person text updates links and preserves executor, project, book, stage and breaks', () => {
  let seq = 0;const original = { project: '周女士', context: { ...emptyContext('legacy'), projectId: 'manual-project', stage: '复核', books: [{ id: 'book', role: 'reference' as const }], breaks: [{ start: 605, end: 608 }] } }
  const both = { ...original, ...changePeopleText(original, '周女士、李先生', [], () => 'person-' + ++seq, true, true) }
  assert.ok('pendingPeople' in both)
  assert.equal(both.context.people.length, 2)
  const one = { ...both, ...changePeopleText(both, '周女士', both.pendingPeople!, () => 'unused', true, true) }
  assert.ok('pendingPeople' in one)
  assert.equal(one.context.people.length, 1);assert.equal(one.context.people[0].id, both.context.people[0].id)
  const clear = changePeopleText(one, '', one.pendingPeople!, () => 'unused', true, true)
  assert.ok('context' in clear)
  assert.deepEqual(clear.context, original.context);assert.equal(clear.project, '')
  assert.deepEqual(changePeopleText({ ...both, project: '周末计划' }, '工作项目', both.pendingPeople!, () => 'unused'), { project: '工作项目' })
})
