import './fixtures/profile.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { categoriesByFrequency } from '../shared/lib/category-frequency.ts'
import { CATEGORIES, visiblePrimaryCategories, applyCategoryAction, validCategories, validRecord, activityTitle, activityFields, toCsv, type LedgerRecord } from '../shared/lib/ledger-v2.ts'
const row = (id: string, category: string, date = '2026-10-30', start = 600, end = 610): LedgerRecord => ({ id, category, date, start, end, activity: '', activitySource: 'category', project: '', note: '', approximate: false })
const ranked = (records: LedgerRecord[]) => categoriesByFrequency(CATEGORIES, records, '2026-10-30').map(c => c.id)
test('entry frequency wins over duration and current time; ties retain manual order without mutation', () => {
 const records = [row('sleep', 'rest', '2026-10-29', 0, 600), row('a', 'health'), row('b', 'health'), row('c', 'learn')]
 const before = structuredClone(records), categories = structuredClone(CATEGORIES)
 assert.equal(ranked(records)[0], 'health')
 assert.deepEqual(categoriesByFrequency(categories, [], '2026-10-30'), categories)
 assert.deepEqual(ranked(records).filter(id => ['rest', 'learn'].includes(id)), CATEGORIES.filter(c => ['rest', 'learn'].includes(c.id)).map(c => c.id))
 assert.deepEqual(records, before); assert.deepEqual(categories, CATEGORIES)
})
test('30 calendar days includes first day and today, excludes older and future dates', () => {
 assert.equal(ranked([row('edge', 'health', '2026-10-01'), row('old', 'work', '2026-09-30'), row('future', 'work', '2026-10-31')])[0], 'health')
 assert.equal(ranked([row('earlier', 'work', '2026-10-29'), row('later-today', 'health', '2026-10-30', 1400, 1410), row('today', 'health')])[0], 'health')
})
test('hour fragments and duplicate IDs count once, distinct simultaneous entries count separately', () => {
 const overnight = row('overnight', 'rest', '2026-10-29', 1400, 1800)
 assert.equal(ranked([overnight, overnight, overnight, row('a', 'health'), row('b', 'health')])[0], 'health')
})
test('archived category is preserved for editing; sorting never rewrites archive or category definitions', () => {
 const categories = structuredClone(CATEGORIES);categories.find(c=>c.id==='work')!.archived=true
 const before=structuredClone(categories), ordered=categoriesByFrequency(categories,[row('a','work')],'2026-10-30')
 assert.equal(ordered[0].id,'work');assert.ok(ordered[0].archived);assert.deepEqual(categories,before)
})
test('long multilingual activity text passes validation and retains full text for editing/display/CSV', () => {
 const text = '完整描述，包含标点“引号”与 emoji 🚶。'.repeat(1000) + '\n第二段,"结尾标记"'
 const record={...row('long','work'), ...activityFields(text)}
 assert.ok(text.length>10000);assert.ok(validRecord(record));assert.equal(activityTitle(record),text)
 assert.ok(toCsv([record]).includes(text.replaceAll('"','""')))
 assert.equal(validRecord({...record, activity:12}),false);assert.equal(validRecord({...record,activity:'   '}),false)
})

test('unused fallback is hidden without dropping custom or archived categories or changing storage', () => {
 const categories=structuredClone(CATEGORIES);categories[0].archived=true
 const original=structuredClone(categories), shown=visiblePrimaryCategories(categories,[])
 assert.ok(!shown.some(c=>c.id==='other'));assert.ok(shown.some(c=>c.id==='work'&&c.archived))
 assert.equal(shown.length,categories.length-1);assert.deepEqual(categories,original);assert.ok(validCategories(categories))
 assert.deepEqual(visiblePrimaryCategories([categories.find(c=>c.id==='other')!],[]),[])
})
test('fallback with historical records or secondary categories remains reachable', () => {
 assert.ok(visiblePrimaryCategories(CATEGORIES,[row('legacy','other','2024-01-01')]).some(c=>c.id==='other'))
 const categories=structuredClone(CATEGORIES);categories.find(c=>c.id==='other')!.children.push({id:'old-child',name:'旧分类',archived:true})
 assert.ok(visiblePrimaryCategories(categories,[]).some(c=>c.id==='other'))
})
test('manual primary ordering skips a hidden fallback and preserves records and secondary ordering', () => {
 const categories=structuredClone(CATEGORIES), fallback=categories.pop()!;categories.splice(1,0,fallback)
 const before=structuredClone(categories), records=[row('kept','health')]
 const changed=applyCategoryAction(categories,records,{type:'reorder',id:'work',direction:1})
 assert.deepEqual(changed.categories.slice(0,3).map(c=>c.id),['learn','other','work'])
 assert.deepEqual(changed.records,records);assert.deepEqual(categories,before)
 const restored=applyCategoryAction(changed.categories,records,{type:'reorder',id:'work',direction:-1})
 assert.deepEqual(restored.categories,categories)
 const used=applyCategoryAction(categories,[row('old','other')],{type:'reorder',id:'work',direction:1})
 assert.deepEqual(used.categories.slice(0,3).map(c=>c.id),['other','work','learn'])
 const child=applyCategoryAction(categories,records,{type:'reorder',id:'work-1',direction:1})
 assert.deepEqual(child.categories[0].children.slice(0,2).map(c=>c.id),['work-2','work-1'])
})
