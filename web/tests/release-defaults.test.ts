// Intentionally does not load the optional regression profile.
import test from 'node:test'
import assert from 'node:assert/strict'
import { profile } from '../config/profile.ts'
import { runtimePaths } from '../server/lib/runtime-paths.ts'
import { CATEGORIES, validCategories } from '../shared/lib/ledger-v2.ts'
import { prefillNewEntry, DEFAULT_QUICK_PREFERENCES, toolProjectChoices, workoutChoices, secondaryChoices } from '../shared/lib/quick-input.ts'
import { peopleInText } from '../shared/lib/people-input.ts'
import { readSourceCandidates } from '../server/lib/codex-sources.ts'
test('fresh install has valid generic categories, no named-person or project assumptions', () => {
  assert.equal(validCategories(CATEGORIES),true)
  assert.deepEqual(profile.knownPeople,[]); assert.equal(profile.pickup,null)
  assert.deepEqual(toolProjectChoices(CATEGORIES,'recording'),[])
  assert.deepEqual(workoutChoices(CATEGORIES.find(c => c.id === 'health')!),[])
  assert.deepEqual(peopleInText('和示例人物'),[])
  const ctx = { records: [], categories: CATEGORIES, date: '2030-01-02', start: 600, now: { date: '2030-01-02', minute: 660 }, preferences: DEFAULT_QUICK_PREFERENCES }
  assert.equal(secondaryChoices(ctx,'health').some(c => c.score > 0),false)
  const result = prefillNewEntry({ category: 'work', secondaryIds: [], project: '' },ctx,602)
  assert.equal(result.category,'recording'); assert.deepEqual(result.secondaryIds,[])
})
test('installation data paths are independent of checkout, sources fail closed', async () => {
  const isolated = runtimePaths({ TIME_LEDGER_HOME: '/tmp/synthetic-home' })
  assert.equal(isolated.ledger,'/tmp/synthetic-home/ledger-v2.json')
  assert.ok(!runtimePaths({}).ledger.startsWith(process.cwd()))
  assert.equal(runtimePaths({ TIME_LEDGER_DATA_FILE: '/tmp/example-ledger' }).protection,'/tmp/example-ledger.versions')
  assert.throws(() => runtimePaths({ TIME_LEDGER_HOME: './data' }), /绝对路径/)
  await assert.rejects(readSourceCandidates('2030-01-02'), /未启用/)
})
