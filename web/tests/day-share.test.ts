import './fixtures/profile.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDayShare, DEFAULT_DAY_SHARE_OPTIONS as options, PRIVATE_BLOCK_COLOR } from '../shared/lib/day-share.ts'
import { CATEGORIES, type LedgerRecord } from '../shared/lib/ledger-v2.ts'

const date = '2026-10-26', now = { date, minute: 1000 }
const record = (id: string, start: number, end: number, extra: Partial<LedgerRecord> = {}): LedgerRecord => ({ id, date, start, end, category: 'work', activity: '私人活动名称', activitySource: 'custom', project: '私人项目', note: '私人备注', approximate: false, ...extra })

test('share keeps minute boundaries, three parallel rows and distinct coverage totals', () => {
  const records = [record('a', 547, 602), record('b', 560, 590, { category: 'learn' }), record('c', 570, 580, { category: 'health' })]
  const before = JSON.stringify(records)
  const data = buildDayShare(records, CATEGORIES, date, options, now)
  assert.deepEqual([data.start, data.end, data.covered, data.total, data.parallel, data.count], [540, 660, 55, 95, 30, 3])
  const simultaneous = data.hours[0].blocks.filter(b => b.start === 570 && b.end === 580)
  assert.deepEqual(simultaneous.map(b => [b.slot, b.slots]), [[0, 3], [1, 3], [2, 3]])
  assert.equal(data.hours[1].blocks[0].end, 602)
  assert.equal(JSON.stringify(records), before)
})
test('midnight share clips to requested day, not the source start date', () => {
  const data = buildDayShare([record('a', 1430, 1460, { date: '2026-10-25' }), record('b', 1438, 1450)], CATEGORIES, date, { ...options, details: true }, now)
  assert.deepEqual([data.covered, data.total, data.start, data.end], [22, 22, 0, 1440])
  assert.deepEqual(data.details.map(r => [r.start, r.end]), [[0, 20], [1438, 1440]])
  assert.equal(data.futureCount, 1)
})
test('primary-only mode removes custom and secondary names from every image section', () => {
  const records = [record('private-id', 540, 570), record('auto', 600, 620, { activitySource: 'category', secondaryId: 'work-1' })]
  const data = buildDayShare(records, CATEGORIES, date, { ...options, labels: 'primary', details: true }, now)
  const serialized = JSON.stringify(data)
  for (const secret of ['私人活动名称', '私人项目', '私人备注', 'private-id', '写方案']) assert.ok(!serialized.includes(secret))
  assert.ok(data.details.every(r => r.label === '工作事业'))
})
test('multi-action training is one entry and gets current category names', () => {
  const data = buildDayShare([record('health', 540, 570, { category: 'health', secondaryId: 'health-3', secondaryIds: ['health-3', 'health-4'], activitySource: 'category' })], CATEGORIES, date, { ...options, details: true }, now)
  assert.deepEqual([data.count, data.covered, data.total, data.parallel], [1, 30, 30, 0])
  assert.equal(data.details[0].label, '力量训练、拉伸')
})
test('full range, empty date, demo and future markings remain explicit', () => {
  const records = [record('a', 600, 620), record('b', 1100, 1110)]
  const full = buildDayShare(records, CATEGORIES, date, { ...options, range: 'full' }, now)
  assert.deepEqual([full.start, full.end, full.hours.length, full.futureCount], [0, 1440, 24, 1])
  const empty = buildDayShare(records, CATEGORIES, '2026-10-27', options, now)
  assert.deepEqual([empty.count, empty.covered, empty.total, empty.parallel, empty.hours.length], [0, 0, 0, 0, 24])
  assert.deepEqual(empty.categories, [])
  const demo = buildDayShare(records, CATEGORIES, date, options, now, true)
  assert.equal(demo.demo, true); assert.equal(demo.futureCount, 0)
})

test('from six clips carry-in sleep, parallel totals and details without changing originals', () => {
  const records = [
    record('sleep', 1410, 1845, { date: '2026-10-25', category: 'rest' }),
    record('ends-six', 330, 360, { category: 'fun' }),
    record('straddles-six', 359, 361, { category: 'learn' }),
    record('starts-six', 360, 380, { category: 'work' }),
  ]
  const before = JSON.stringify(records)
  const data = buildDayShare(records, CATEGORIES, date, { ...options, range: 'from-six', details: true }, now)
  assert.deepEqual([data.start, data.end, data.hours.length, data.count], [360, 405, 1, 3])
  assert.equal(data.rangeLabel, '06:00—06:45')
  assert.deepEqual([data.covered, data.total, data.parallel], [45, 66, 20])
  assert.deepEqual(data.details.map(r => [r.start, r.end]).sort((a,b) => a[1]-b[1]), [[360,361],[360,380],[360,405]])
  assert.deepEqual(data.categories.map(c => c.minutes), [45,20,1])
  assert.ok(data.hours.every(h => h.hour >= 6))
  assert.ok(data.hours.flatMap(h => h.blocks).every(b => b.start >= 360))
  assert.equal(JSON.stringify(records), before)
  const full = buildDayShare(records, CATEGORIES, date, { ...options, range: 'full' }, now)
  assert.equal(full.count, 4); assert.equal(full.covered, 405)
})

test('from six shows no empty future hours if all records end before six', () => {
  const data = buildDayShare([record('night', 0, 360)], CATEGORIES, date, { ...options, range: 'from-six', details: true }, now)
  assert.deepEqual([data.start, data.end, data.count, data.covered, data.total, data.parallel], [360,360,0,0,0,0])
  assert.deepEqual(data.details, []); assert.deepEqual(data.categories, [])
  assert.equal(data.futureCount, 0); assert.equal(data.hours.length, 0)
  assert.equal(data.rangeLabel, '06:00 起（暂无记录）')
})

test('from six ends at the latest end minute, keeps a partial final hour and recorded future spans', () => {
  const records = [record('long', 360, 1021), record('later-start', 1000, 1020)]
  const data = buildDayShare(records, CATEGORIES, date, { ...options, range: 'from-six' }, now)
  assert.equal(data.end, 1021); assert.equal(data.rangeLabel, '06:00—17:01')
  assert.equal(data.hours.length, 12); assert.equal(data.hours.at(-1)!.hour, 17)
  assert.deepEqual(data.hours.at(-1)!.blocks.map(b => [b.start,b.end]), [[1020,1021]])
  assert.equal(data.futureCount, 2)
  assert.equal(buildDayShare(records, CATEGORIES, date, options, now).end, 1080)
  assert.equal(buildDayShare(records, CATEGORIES, date, { ...options, range: 'full' }, now).end, 1440)
})

test('private sharing publishes a single record without revealing parallel or unrelated content', () => {
  const records = [record('secret-night-id', 0, 400, { activity: '夜间私密内容', category: 'rest' }),
    record('public-id', 720, 765, { activity: '与朋友交流' }),
    record('parallel-id', 725, 755, { category: 'learn', activity: '并行私人内容', approximate: true }),
    record('third-id', 730, 750, { category: 'health', activity: '第三项私密内容' }),
    record('future-private-id', 1200, 1215, { activity: '未来私人内容' })]
  const before = JSON.stringify(records)
  const all = buildDayShare(records, CATEGORIES, date, options, now)
  const data = buildDayShare(records, CATEGORIES, date, { ...options, labels: 'selected', selectedIds: ['public-id'], details: true }, now)
  assert.deepEqual([data.start, data.end, data.covered, data.total, data.parallel, data.count, data.futureCount], [0, 1260, 45, 45, 0, 1, 0])
  const geometry = (model: typeof data) => model.hours.map(h => [h.hour, h.blocks.map(b => [b.start, b.end, b.slot, b.slots, b.color])])
  assert.deepEqual(geometry(data), geometry(all), 'All minute partitions and original colors remain')
  assert.deepEqual(data.categories, [])
  assert.deepEqual(data.details.map(r => [r.start, r.end, r.label]), [[720, 765, '与朋友交流']])
  assert.ok(data.hours.flatMap(h => h.blocks).filter(b => b.hidden).every(b => !b.label && !b.showLabel && !b.approximate))
  const serialized = JSON.stringify(data)
  for (const secret of ['夜间私密内容', '并行私人内容', '第三项私密内容', '未来私人内容', '私人项目', '私人备注', ...records.map(r => r.id), ...CATEGORIES.map(c => c.name)]) assert.ok(!serialized.includes(secret), `Unexpected private field: ${secret}`)
  assert.equal(JSON.stringify(records), before)
})

test('privacy is closed by default; invalid or out-of-range selections never expose other records', () => {
  const records = [record('early', 345, 355), record('noon', 720, 750)]
  for (const selectedIds of [undefined, [], ['missing'], ['early']]) {
    const data = buildDayShare(records, CATEGORIES, date, { ...options, range: 'from-six', labels: 'selected', selectedIds, details: true }, now)
    assert.deepEqual([data.count, data.covered, data.total, data.parallel], [0, 0, 0, 0])
    assert.deepEqual(data.details, []); assert.deepEqual(data.categories, [])
    assert.ok(data.hours.flatMap(h => h.blocks).every(b => b.hidden && !b.label))
  }
})

test('private titles override all fragments and details; blank text never falls back to original', () => {
  const records = [record('public', 715, 755), record('private', 725, 745, { activity: '不公开' })]
  for (const title of ['可以分享的文字', '']) {
    const data = buildDayShare(records, CATEGORIES, date, { ...options, labels: 'selected', selectedIds: ['public'], shareTitles: { public: title }, details: true, neutralHiddenColors: true }, now)
    assert.equal(data.details[0].label, title)
    assert.ok(data.hours.flatMap(h => h.blocks).filter(b => !b.hidden).every(b => b.label === title))
    assert.ok(data.hours.flatMap(h => h.blocks).filter(b => b.hidden).every(b => b.color === PRIVATE_BLOCK_COLOR))
    assert.ok(!JSON.stringify(data).includes('私人活动名称'))
    assert.ok(!JSON.stringify(data).includes('不公开'))
  }
})

test('multiple public records use union coverage after midnight and six-o-clock clipping', () => {
  const records = [record('carry', 1430, 1820, { date: '2026-10-25' }), record('same', 350, 390), record('hidden', 360, 400)]
  const data = buildDayShare(records, CATEGORIES, date, { ...options, range: 'from-six', labels: 'selected', selectedIds: ['carry', 'same', 'same'], details: true }, now)
  assert.deepEqual([data.count, data.covered, data.total, data.parallel], [2, 30, 50, 20])
  assert.deepEqual(data.details.map(r => [r.start, r.end]), [[360, 380], [360, 390]])
  assert.equal(data.end, 400, 'Hidden activity geometry still determines the image extent')
})
