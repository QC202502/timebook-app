import './fixtures/profile.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { validUsageEvent, validUsageBatch } from '../shared/lib/quick-usage.ts'
import { QuickUsageRecorder } from '../features/ledger/quick-usage-recorder.ts'

const session = '00000000-0000-4000-8000-000000000001'
const task = '00000000-0000-4000-8000-000000000002'
const event = () => ({ schema: 1, rules: 1, session, task, seq: 1, at: Date.now(), elapsedMs: 0, event: 'task_start', mode: 'create', entry: 'form' })
test('usage whitelist rejects private text, record identifiers, arbitrary enums and malformed batches', () => {
  assert.equal(validUsageEvent(event()), true)
  for (const key of ['text', 'project', 'note', 'activity', 'category', 'recordId', 'date', 'start', 'end', 'url', 'error']) assert.equal(validUsageEvent({ ...event(), [key]: 'PRIVATE_SENTINEL' }), false)
  for (const patch of [{ field: 'PRIVATE_SENTINEL' }, { session: 'PRIVATE_SENTINEL' }, { event: 'PRIVATE_SENTINEL' }, { result: 'PRIVATE_SENTINEL' }, { seq: -1 }, { elapsedMs: NaN }, { slot: 3 }, { position: 'PRIVATE_SENTINEL' }]) assert.equal(validUsageEvent({ ...event(), ...patch }), false)
  assert.equal(validUsageBatch({ events: [event()] }), true)
  assert.equal(validUsageBatch({ events: [event()], text: 'PRIVATE_SENTINEL' }), false)
  assert.equal(validUsageBatch({ events: [] }), false)
  assert.equal(validUsageBatch({ events: Array(41).fill(event()) }), false)
})
test('recorder links ordered tasks and save attempts, deduplicates exposures, excludes arbitrary input', async () => {
  const batches: unknown[][] = []; let clock = 1000
  const recorder = new QuickUsageRecorder({ transport: async batch => { batches.push(batch) }, now: () => clock++ })
  recorder.begin('create', 'drag')
  recorder.expose('project', 0, 'ephemeral-only', { total: 4, visible: 3, automatic: true })
  recorder.expose('project', 0, 'ephemeral-only', { total: 4, visible: 3, automatic: true })
  recorder.record('field_commit', { field: 'project', cleared: true, automatic: true })
  recorder.record('field_commit', { field: 'PRIVATE_SENTINEL' } as never)
  const first = recorder.saveAttempt('enter', 2)
  recorder.saveResult(first, 'failed', 'invalid')
  const second = recorder.saveAttempt('button', 2)
  recorder.saveResult(second, 'success')
  recorder.end('saved')
  recorder.begin('edit', 'existing')
  recorder.record('field_commit', { field: 'note' })
  await recorder.flush()
  const events = batches.flat() as ReturnType<typeof event>[]
  assert.equal(events.filter(e => e.event === 'exposure').length, 1)
  assert.equal(events.filter(e => e.event === 'save_attempt').length, 2)
  assert.equal(new Set(events.map(e => e.task)).size, 2)
  assert.equal(JSON.stringify(events).includes('PRIVATE_SENTINEL'), false)
  assert.equal(JSON.stringify(events).includes('ephemeral-only'), false)
  assert.deepEqual(events.map(e => e.seq), [...events.map(e => e.seq)].sort((a, b) => a - b))
  assert.ok(events.every(validUsageEvent))
})
test('disabled mode emits nothing; failing/hung transport is bounded, recovers and marks gaps', async () => {
  let fail = true; const output: unknown[] = []
  const recorder = new QuickUsageRecorder({ timeoutMs: 10, transport: async batch => { if (fail) throw new Error('PRIVATE_SENTINEL'); output.push(...batch) } })
  recorder.setEnabled(false); recorder.begin('create', 'form'); recorder.record('choice', { group: 'project' }); await recorder.flush()
  assert.equal(output.length, 0)
  recorder.setEnabled(true); recorder.begin('create', 'form')
  await assert.doesNotReject(() => recorder.flush())
  fail = false; recorder.record('field_commit', { field: 'project' }); await recorder.flush()
  assert.ok(output.some(e => (e as { event: string }).event === 'log_gap'))
  assert.equal(JSON.stringify(output).includes('PRIVATE_SENTINEL'), false)
  const hung = new QuickUsageRecorder({ timeoutMs: 10, transport: () => new Promise(() => {}) })
  hung.begin('create', 'form'); const start = performance.now(); await hung.flush()
  assert.ok(performance.now() - start < 1000)
  for (let i = 0; i < 1000; i++) recorder.record('field_commit', { field: 'time' })
  assert.ok(recorder.pending <= 200)
})
test('default delivery contains only validated events, handles HTTP errors and undo tickets', async () => {
  const original = globalThis.fetch; const delivered: unknown[] = []; let ok = false
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/quick-input-usage')
    const body = JSON.parse(String(init?.body)); assert.equal(validUsageBatch(body), true)
    if (ok) delivered.push(...body.events)
    return new Response('{}', { status: ok ? 200 : 503 })
  }
  try {
    const r = new QuickUsageRecorder({ onStatus: () => { throw new Error('ignored UI failure') } })
    r.record('field_commit', { field: 'project' }); assert.equal(r.pending, 0)
    r.ensure('edit', 'existing'); r.ensure('edit', 'existing')
    r.expose('secondary', 0, 'hidden', { total: 3, visible: 0 })
    const ticket = r.saveAttempt('button', 1)
    r.saveResult(ticket, 'success'); r.end('saved'); await r.flush()
    ok = true; r.begin('create', 'button'); r.undo(undefined, ticket); r.undo('success', ticket)
    r.saveResult(undefined, 'failed'); await r.flush()
    assert.ok(delivered.some(e => (e as { event: string }).event === 'undo_result'))
    assert.ok(delivered.some(e => (e as { event: string }).event === 'log_gap'))
  } finally { globalThis.fetch = original }
})
test('elapsed durations remain monotonic when wall clock changes', async () => {
  let wall = 100000, elapsed = 100
  const output: { at: number; elapsedMs: number }[] = []
  const r = new QuickUsageRecorder({ now: () => wall, elapsedNow: () => elapsed, transport: async batch => { output.push(...batch) } })
  r.begin('create', 'button'); wall = 90000; elapsed = 200; r.record('field_commit', { field: 'project' }); await r.flush()
  assert.equal(output[1].at, 90000); assert.equal(output[1].elapsedMs, 100)
})
