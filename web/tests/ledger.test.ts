import './fixtures/profile.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CATEGORIES, visiblePrimaryCategories, activityTitle, activityInput, activityFields, applyCategoryAction, migrateLegacyRecords, validCategories, secondaryOf, summarize, layoutLanes, layoutFilledBlocks, maxConcurrentActivities, recordsForDay, validRecord, isFuture, parseClock, parseTimeInput, stepClock, toCsv, type LedgerRecord } from '../shared/lib/ledger-v2.ts'

const date = '2026-10-25'
const rec = (start: number, end: number, id = 'a', category: LedgerRecord['category'] = 'health'): LedgerRecord => ({ id, date, start, end, category, activity: '示例', project: '', note: '', approximate: false })
test('minute endpoints are preserved', () => { assert.equal(summarize([rec(547, 582)], date).total, 35); assert.equal(parseClock('09:07'), 547) })
test('walk and book retain their durations', () => {
  const s = summarize([rec(723, 761), rec(728, 752, 'b', 'learn')], date)
  assert.deepEqual([s.covered, s.total, s.parallel], [38, 62, 24])
})
test('editing one concurrent record does not require trimming another', () => {
  const s = summarize([rec(723, 761), rec(728, 740, 'b', 'learn')], date)
  assert.deepEqual([s.covered, s.total, s.parallel], [38, 50, 12])
})
test('category union differs from activity sum', () => {
  const s = summarize([rec(540, 600), rec(570, 630, 'b')], date)
  assert.deepEqual([s.covered, s.total, s.parallel, s.categories.find(c => c.id === 'health')!.minutes], [90, 120, 30, 90])
})
test('three overlaps count wall time once', () => {
  const s = summarize([rec(10, 20), rec(10, 20, 'b'), rec(10, 20, 'c')], date)
  assert.deepEqual([s.covered, s.total, s.parallel], [10, 30, 10])
})
test('adjacent records are not concurrent and can share a lane', () => {
  const r = [rec(10, 20), rec(20, 30, 'b')]
  assert.equal(summarize(r, date).parallel, 0); assert.deepEqual(layoutLanes(r).map(x => x.lane), [0, 0])
})
test('midnight clips each day without altering record', () => {
  const r = rec(1430, 1460)
  assert.equal(summarize([r], date).covered, 10)
  assert.equal(summarize([r], '2026-10-26').covered, 20)
  assert.equal(r.end, 1460)
  assert.equal(recordsForDay([r], '2026-10-27').length, 0)
})
test('today excludes future gaps and clips records at now', () => {
  const s = summarize([rec(10, 90)], date, 60)
  assert.deepEqual([s.covered, s.total, s.unrecorded], [50, 50, 10])
})
test('unclassified still counts toward coverage', () => { assert.equal(summarize([rec(0, 5, 'a', 'other')], date).covered, 5) })
test('invalid dates, intervals, category and fractional minutes rejected', () => {
  for (const patch of [{ date: '2026-02-30' }, { start: 1.5 }, { start: -1 }, { end: 10 }, { category: 'fake' }, { end: 3000 }, { activity: '' }]) assert.equal(validRecord({ ...rec(10, 20), ...patch }), false)
  assert.equal(validRecord(rec(1430, 1460)), true)
  assert.equal(isFuture(rec(20, 40), { date, minute: 30 }), true)
  assert.equal(isFuture(rec(20, 40), { date, minute: 40 }), false)
})
test('clock validation and midnight export', () => {
  assert.equal(parseClock('24:00'), 1440); assert.ok(Number.isNaN(parseClock('24:01')))
  const csv = toCsv([{ ...rec(1430, 1460), activity: '=1+1', note: 'hello,"world"' }])
  assert.ok(csv.includes('"2026-10-26","00:20"')); assert.ok(csv.includes('"\'=1+1"')); assert.ok(csv.includes('"hello,""world"""'))
})
test('lanes never collide across nested and partially overlapping events', () => {
  const items = layoutLanes([rec(0, 60), rec(10, 20, 'b'), rec(18, 40, 'c'), rec(21, 35, 'd'), rec(60, 70, 'e')])
  for (const a of items) for (const b of items) if (a !== b && a.lane === b.lane) assert.ok(a.record.end <= b.record.start || b.record.end <= a.record.start)
})

const fresh = () => structuredClone(CATEGORIES)
test('legacy migration links only exact suggestions and preserves original record text and time', () => {
  const originals = [{ ...rec(547, 582), activity: '走路' }, { ...rec(1, 8, 'b'), activity: '午间散步' }]
  const migrated = migrateLegacyRecords(originals)
  assert.equal(migrated[0].secondaryId, 'health-1'); assert.equal(migrated[1].secondaryId, null)
  for (let i = 0; i < originals.length; i++) { const { secondaryId, ...rest } = migrated[i]; assert.deepEqual(rest, originals[i]) }
})
test('renaming categories updates historical labels and exports without touching activity or minutes', () => {
  const records = [{ ...rec(547, 582), secondaryId: 'health-1', activity: '去公园走走' }]
  let state = applyCategoryAction(fresh(), records, { type: 'save-primary', id: 'health', name: '身体与健康', color: '#112233' })
  state = applyCategoryAction(state.categories, state.records, { type: 'save-secondary', id: 'health-1', parentId: 'health', name: '散步' })
  assert.deepEqual(state.records, records)
  const stats = summarize(records, date, 1440, state.categories)
  assert.equal(stats.covered, 35); assert.equal(stats.categories.find(c => c.id === 'health')?.name, '身体与健康')
  assert.equal(secondaryOf(records[0], state.categories)?.name, '散步')
  assert.match(toCsv(records, state.categories), /身体与健康","散步","去公园走走/)
})
test('new categories and two levels of ordering retain stable references', () => {
  let s = applyCategoryAction(fresh(), [], { type: 'save-primary', id: 'personal', name: '个人项目', color: '#abcdef' })
  s = applyCategoryAction(s.categories, s.records, { type: 'save-secondary', id: 'prototype', parentId: 'personal', name: '原型' })
  s = applyCategoryAction(s.categories, s.records, { type: 'reorder', id: 'personal', direction: -1 })
  assert.equal(visiblePrimaryCategories(s.categories, s.records).at(-2)?.id, 'personal')
  s = applyCategoryAction(s.categories, s.records, { type: 'reorder', id: 'work-2', direction: -1 })
  assert.equal(s.categories[0].children[0].id, 'work-2')
  assert.ok(validRecord({ ...rec(0, 5), category: 'personal', secondaryId: 'prototype' }, s.categories))
  assert.equal(validRecord({ ...rec(0, 5), category: 'health', secondaryId: 'prototype' }, s.categories), false)
})
test('secondary movement carries historical parent reference and retains stats', () => {
  const old = { ...rec(10, 25), secondaryId: 'health-1' }
  const s = applyCategoryAction(fresh(), [old], { type: 'save-secondary', id: 'health-1', parentId: 'life', name: '走路' })
  assert.equal(s.records[0].category, 'life'); assert.equal(s.records[0].secondaryId, 'health-1')
  assert.equal(s.records[0].activity, old.activity)
  const stats = summarize(s.records, date, 1440, s.categories)
  assert.equal(stats.categories.find(c => c.id === 'health')?.minutes, 0)
  assert.equal(stats.categories.find(c => c.id === 'life')?.minutes, 15)
})
test('secondary union and unset time are computed independently inside primary union', () => {
  const rows = [{ ...rec(0, 20), secondaryId: 'health-1' }, { ...rec(10, 30, 'b'), secondaryId: 'health-2' }, rec(25, 40, 'c')]
  const c = summarize(rows, date).categories.find(c => c.id === 'health')!
  assert.equal(c.minutes, 40)
  assert.deepEqual(c.children.filter(s => s.minutes > 0).map(s => s.minutes), [20, 20, 15])
})
test('archive keeps historical data and stats, restore retains ID', () => {
  const rows = [{ ...rec(10, 40), secondaryId: 'health-1' }]
  let s = applyCategoryAction(fresh(), rows, { type: 'archive', id: 'health', archived: true })
  assert.deepEqual(s.records, rows); assert.equal(summarize(rows, date, 1440, s.categories).categories.find(c => c.id === 'health')?.minutes, 30)
  s = applyCategoryAction(s.categories, rows, { type: 'archive', id: 'health', archived: false })
  assert.equal(s.categories.find(c => c.id === 'health')?.archived, false)
})
test('merging primary categories moves children and coalesces matching names without double count', () => {
  let categories = fresh()
  categories.find(c => c.id === 'life')!.children.push({ id: 'life-walk', name: '走路', archived: false })
  const rows = [{ ...rec(0, 20), secondaryId: 'health-1' }, { ...rec(10, 30, 'b', 'life'), secondaryId: 'life-walk' }, { ...rec(50, 60, 'c'), secondaryId: 'health-2' }]
  const s = applyCategoryAction(categories, rows, { type: 'merge', sourceId: 'health', targetId: 'life' })
  assert.ok(!s.categories.some(c => c.id === 'health'))
  assert.deepEqual(s.records.map(r => [r.category, r.secondaryId]), [['life', 'life-walk'], ['life', 'life-walk'], ['life', 'health-2']])
  const stats = summarize(s.records, date, 1440, s.categories)
  assert.equal(stats.total, 50); assert.equal(stats.covered, 40)
  assert.equal(stats.categories.find(c => c.id === 'life')?.children.find(c => c.id === 'life-walk')?.minutes, 30)
  assert.deepEqual(categories, [...fresh().map(c => c.id === 'life' ? { ...c, children: [...c.children, { id: 'life-walk', name: '走路', archived: false }] } : c)])
})
test('secondary merge across parents preserves all interval endpoints', () => {
  const rows = [{ ...rec(1430, 1460), secondaryId: 'health-1' }]
  const s = applyCategoryAction(fresh(), rows, { type: 'merge', sourceId: 'health-1', targetId: 'learn-2' })
  assert.deepEqual(s.records[0], { ...rows[0], category: 'learn', secondaryId: 'learn-2' })
  assert.equal(summarize(s.records, '2026-10-26', 1440, s.categories).covered, 20)
})
test('category validation blocks duplicate names, invalid IDs, broken fallback and mixed-level merges', () => {
  const invalid = [
    { type: 'save-primary', id: 'x', name: '工作事业', color: '#123456' },
    { type: 'save-secondary', id: 'x', parentId: 'health', name: '走路' },
    { type: 'save-primary', id: 'x', name: ' ', color: '#123456' },
    { type: 'save-primary', id: 'x', name: '合法', color: 'url(bad)' },
    { type: 'archive', id: 'other', archived: true },
    { type: 'merge', sourceId: 'health', targetId: 'health-1' },
    { type: 'save-secondary', id: 'work', parentId: 'health', name: '新二级' }
  ]
  for (const action of invalid) assert.throws(() => applyCategoryAction(fresh(), [], action as Parameters<typeof applyCategoryAction>[2]))
  assert.equal(validCategories(null), false)
  const bad = fresh(); bad[1].children[0].id = 'work'; assert.equal(validCategories(bad), false)
})

test('automatic title uses secondary then primary and keeps input empty', () => {
  const record = { ...rec(575, 585, 'auto', 'work'), secondaryId: 'work-1', ...activityFields('  ') }
  assert.ok(validRecord(record)); assert.equal(activityTitle(record), '写方案'); assert.equal(activityInput(record), '')
  assert.equal(activityTitle({ ...record, secondaryId: null }), '工作事业')
  assert.deepEqual(activityFields('  写季度方案  '), { activity: '写季度方案', activitySource: 'custom' })
})
test('auto mode follows category edits without changing the saved interval or historical text', () => {
  const record: LedgerRecord = { ...rec(575, 585, 'auto', 'work'), secondaryId: 'work-1', activity: '工作事业', activitySource: 'category' }
  const renamed = applyCategoryAction(fresh(), [record], { type: 'save-secondary', id: 'work-1', parentId: 'work', name: '开发时间账本' })
  assert.deepEqual(renamed.records[0], record)
  assert.equal(activityTitle(record, renamed.categories), '开发时间账本')
  assert.equal(activityInput(record), '')
  assert.ok(toCsv([record], renamed.categories).includes('"开发时间账本","开发时间账本"'))
})
test('custom description survives category changes even when equal to a classification name', () => {
  const record: LedgerRecord = { ...rec(10, 20, 'custom', 'work'), activity: '工作事业', activitySource: 'custom', secondaryId: 'work-1' }
  assert.equal(activityTitle(record), '工作事业')
  assert.equal(activityTitle({ ...record, category: 'learn', secondaryId: 'learn-2' }), '工作事业')
  assert.equal(activityInput(record), '工作事业')
})
test('unmarked legacy text is not guessed as auto and can explicitly return to category mode', () => {
  const old = { ...rec(10, 20, 'legacy', 'work'), activity: '工作事业', secondaryId: 'work-1' }
  assert.equal(activityTitle(old), '工作事业'); assert.equal(activityInput(old), '工作事业')
  const changed = { ...old, ...activityFields('') }
  assert.equal(activityTitle(changed), '写方案'); assert.equal(changed.start, old.start)
})
test('auto labels follow secondary movement and merge; totals remain independent of naming', () => {
  const r = { ...rec(10, 30), secondaryId: 'health-1', ...activityFields('') }
  const s = applyCategoryAction(fresh(), [r], { type: 'merge', sourceId: 'health-1', targetId: 'learn-2' })
  assert.equal(activityTitle(s.records[0], s.categories), '听书')
  assert.equal(summarize(s.records, date, 1440, s.categories).total, 20)
})
test('activity source validation rejects corrupt metadata and empty custom text', () => {
  assert.equal(validRecord({ ...rec(1, 2), activitySource: 'unexpected' }), false)
  assert.equal(validRecord({ ...rec(1, 2), activitySource: 'custom', activity: '' }), false)
  assert.equal(validRecord({ ...rec(1, 2), activitySource: 'category', activity: '' }), true)
})


test('minute arrows carry and borrow hours without changing the selected start day', () => {
  assert.deepEqual(stepClock('09:59', 1), { value: '10:00', nextDay: false })
  assert.deepEqual(stepClock('10:00', -1), { value: '09:59', nextDay: false })
  assert.deepEqual(stepClock('00:00', -1), { value: '00:00', nextDay: false })
  assert.deepEqual(stepClock('23:59', 1), { value: '23:59', nextDay: false })
})
test('segmented input accepts a single digit before blur without turning empty fields into midnight', () => {
  assert.equal(parseTimeInput('9:7'), 547)
  assert.equal(parseTimeInput('0:0'), 0)
  for (const value of [':30', '09:', ':', '99:00', '12:60', '1a:00']) assert.ok(Number.isNaN(parseTimeInput(value)), value)
})
test('end arrows cross midnight reversibly, including legacy 24:00', () => {
  assert.deepEqual(stepClock('23:59', 1, false, true), { value: '00:00', nextDay: true })
  assert.deepEqual(stepClock('00:00', -1, true, true), { value: '23:59', nextDay: false })
  assert.deepEqual(stepClock('00:00', 1, true, true), { value: '00:01', nextDay: true })
  assert.deepEqual(stepClock('24:00', 1, false, true), { value: '00:01', nextDay: true })
  assert.deepEqual(stepClock('23:59', 1, true, true), { value: '23:59', nextDay: true })
  assert.equal(stepClock('09:99', 1), null)
  assert.equal(stepClock(':30', 1), null)
})
test('future entries count in full-day categories but cannot fill past gaps', () => {
  const rows = [rec(30, 90), rec(80, 100, 'b', 'learn')]
  const day = summarize(rows, date)
  assert.deepEqual([day.covered, day.total, day.parallel], [70, 80, 10])
  assert.equal(day.categories.find(c => c.id === 'health')?.minutes, 60)
  assert.equal(day.categories.find(c => c.id === 'learn')?.minutes, 20)
  const elapsed = summarize(rows, date, 60)
  assert.deepEqual([elapsed.covered, elapsed.unrecorded], [30, 30])
  assert.ok(validRecord({ ...rec(1439, 1441), date: '2099-01-01' }))
})


test('filled blocks occupy the whole height for one, halves for two and thirds for three', () => {
  for (const count of [1, 2, 3]) {
    const rows = Array.from({ length: count }, (_, i) => rec(540, 600, `r${i}`))
    const blocks = layoutFilledBlocks(rows, 540, 600)
    assert.equal(blocks.length, count)
    assert.deepEqual(blocks.map(b => [b.start, b.end, b.slot, b.slots]), rows.map((_, i) => [540, 600, i, count]))
    assert.equal(summarize(rows, date).total, 60 * count, 'height must not divide recorded minutes')
  }
})
test('partial overlaps fill every occupied minute and leave only genuinely empty time blank', () => {
  const rows = [rec(540, 590, 'a'), rec(550, 580, 'b'), rec(560, 570, 'c'), rec(590, 595, 'd')]
  const original = structuredClone(rows)
  const blocks = layoutFilledBlocks(rows, 540, 600)
  for (let minute = 540; minute < 600; minute++) {
    const expected = rows.filter(r => r.start <= minute && r.end > minute).map(r => r.id).sort()
    const visible = blocks.filter(b => b.start <= minute && b.end > minute).sort((a, b) => a.slot - b.slot)
    assert.deepEqual(visible.map(b => b.record.id).sort(), expected)
    assert.deepEqual(visible.map(b => b.slot), visible.map((_, i) => i))
    assert.ok(visible.every(b => b.slots === visible.length))
  }
  for (const row of rows) assert.equal(blocks.filter(b => b.record.id === row.id && b.showLabel).length, 1)
  assert.deepEqual(rows, original)
})
test('adjacent fragments with unchanged height merge, and hour boundaries clip display only', () => {
  const rows = [rec(530, 610, 'a'), rec(540, 570, 'b'), rec(570, 600, 'c')]
  const blocks = layoutFilledBlocks(rows, 540, 600)
  assert.equal(blocks.filter(b => b.record.id === 'a').length, 1)
  assert.deepEqual(blocks.filter(b => b.record.id === 'a').map(b => [b.start, b.end, b.slots]), [[540, 600, 2]])
  assert.deepEqual(layoutFilledBlocks(rows, 600, 660).map(b => [b.start, b.end, b.slots]), [[600, 610, 1]])
  assert.equal(rows[0].start, 530); assert.equal(rows[0].end, 610)
})
test('parallel limit counts simultaneous minutes, not every intersecting activity', () => {
  const rows = [rec(0, 60, 'base'), ...Array.from({ length: 4 }, (_, i) => rec(i * 15, (i + 1) * 15, `short${i}`))]
  assert.equal(maxConcurrentActivities(rows), 2)
  assert.equal(maxConcurrentActivities([rec(0, 10), rec(0, 10, 'b'), rec(0, 10, 'c')]), 3)
  assert.equal(maxConcurrentActivities([rec(0, 10), rec(0, 10, 'b'), rec(0, 10, 'c'), rec(9, 10, 'd')]), 4)
  assert.equal(maxConcurrentActivities([rec(0, 10), rec(10, 20, 'b')]), 1)
})
test('concurrency checks include midnight and can be restricted to the draft interval', () => {
  const rows = [rec(1430, 1460), { ...rec(0, 30, 'b'), date: '2026-10-26' }, { ...rec(10, 30, 'c'), date: '2026-10-26' }]
  assert.equal(maxConcurrentActivities(rows), 3)
  assert.equal(maxConcurrentActivities([...rows, { ...rec(19, 20, 'd'), date: '2026-10-26' }]), 4)
  assert.equal(maxConcurrentActivities(rows, { date: '2026-10-26', start: 20, end: 30 }), 2)
  assert.equal(maxConcurrentActivities(rows, { date: '2026-10-26', start: 30, end: 40 }), 0)
})
