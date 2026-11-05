import './fixtures/profile.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { inferDayPatch, entryOverlap } from '../shared/lib/entry-feedback.ts'
import type { LedgerRecord } from '../shared/lib/ledger-v2.ts'

const time = { start: '23:50', end: '23:59', nextDay: false }
const row = (id: string, start: number, end: number, date = '2026-10-30'): LedgerRecord => ({ id, date, start, end, category: 'work', activity: id, project: '', note: '', approximate: false })

test('clock edits infer midnight, preserve full days, and tolerate incomplete input', () => {
  assert.equal(inferDayPatch(time, { end: '00:10' }).nextDay, true)
  assert.equal(inferDayPatch({ ...time, end: '00:10', nextDay: true }, { end: '23:55' }).nextDay, false)
  assert.equal(inferDayPatch({ start: '09:00', end: '09:30', nextDay: false }, { start: '10:00' }).nextDay, true)
  assert.equal(inferDayPatch({ start: '09:00', end: '09:00', nextDay: true }, { end: '09:00' }).nextDay, true)
  assert.equal(inferDayPatch({ start: '09:00', end: '09:00', nextDay: false }, { end: '09:00' }).nextDay, false)
  assert.deepEqual(inferDayPatch(time, { end: ':10' }), { end: ':10' })
  assert.deepEqual(inferDayPatch({ ...time, nextDay: true }, {}), {})
})

test('four sequential intersections are two concurrent activities, unrelated peaks are ignored', () => {
  const sequential = [row('a', 540, 550), row('b', 550, 560), row('c', 560, 570), row('d', 570, 580)]
  const unrelated = [row('x', 100, 120), row('y', 100, 120), row('z', 100, 120)]
  const before = structuredClone(sequential)
  const result = entryOverlap([...sequential, ...unrelated], [row('draft', 540, 580)])
  assert.equal(result.peak, 2)
  assert.deepEqual(result.related.map(r => r.id), ['a', 'b', 'c', 'd'])
  assert.deepEqual(entryOverlap(unrelated, [row('draft', 540, 580)]), { peak: 1, related: [] })
  assert.deepEqual(sequential, before)
})

test('editing replaces one original, companions share the limit, and boundaries do not overlap', () => {
  const existing = [row('a', 540, 570), row('b', 570, 600)]
  assert.equal(entryOverlap(existing, [row('draft', 540, 570)], 'a').peak, 1)
  assert.equal(entryOverlap(existing, [row('draft', 540, 570), row('companion', 540, 570)]).peak, 3)
  assert.equal(entryOverlap(existing, [row('draft', 540, 570), row('companion', 540, 570), row('third', 540, 570)]).peak, 4)
  assert.equal(entryOverlap(existing, [row('invalid', 600, 540)]).peak, 0)
})

test('cross-midnight intersections use actual dates, including an independently timed companion', () => {
  const existing = [row('night', 1430, 1470, '2026-10-29'), row('later', 600, 630, '2026-10-31')]
  const result = entryOverlap(existing, [row('draft', 0, 10), row('companion', 610, 620, '2026-10-31')])
  assert.equal(result.peak, 2)
  assert.deepEqual(result.related.map(r => r.id), ['night', 'later'])
  assert.equal(entryOverlap([row('different-day', 0, 10, '2026-10-28')], [row('draft', 0, 10)]).peak, 1)
})
