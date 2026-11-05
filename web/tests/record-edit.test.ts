import './fixtures/profile.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { replacementNeedsConfirmation, dragSpan, minuteInTrack } from '../shared/lib/record-edit.ts'
import type { LedgerRecord } from '../shared/lib/ledger-v2.ts'
const sleep: LedgerRecord = { id:'sleep', date:'2026-10-26', start:15, end:405, category:'rest', secondaryId:'rest-1', activity:'', activitySource:'category', project:'', note:'', approximate:false }
test('sleep replaced by a short novel segment requires an explicit decision',()=>{
 assert.equal(replacementNeedsConfirmation(sleep,{...sleep,end:30,category:'fun',secondaryId:'fun-2'}),true)
})
test('large accidental truncations and moving to another date are protected',()=>{
 assert.equal(replacementNeedsConfirmation(sleep,{...sleep,end:30}),true)
 assert.equal(replacementNeedsConfirmation(sleep,{...sleep,date:'2026-10-27'}),true)
 assert.equal(replacementNeedsConfirmation(sleep,{...sleep,start:15,end:210}),true)
})
test('minor time corrections, descriptions and unchanged full-interval classifications remain direct edits',()=>{
 for(const after of [{...sleep,end:400},{...sleep,note:'补充'},{...sleep,category:'fun',secondaryId:'fun-2'},{...sleep,activity:'午睡'},{...sleep,end:410}]) assert.equal(replacementNeedsConfirmation(sleep,after),false)
})
test('reclassified short records with removed minutes are protected too',()=>{
 assert.equal(replacementNeedsConfirmation({...sleep,end:30},{...sleep,end:25,category:'fun'}),true)
 assert.equal(replacementNeedsConfirmation({...sleep,end:30},{...sleep,end:25}),false)
})
test('cross-midnight intersection uses absolute days',()=>{
 const night={...sleep,start:1430,end:1460}
 assert.equal(replacementNeedsConfirmation(night,{...night,date:'2026-10-27',start:0,end:20,category:'fun'}),true)
 assert.equal(replacementNeedsConfirmation(night,{...night,end:1455}),false)
})
test('drag ranges include pointed minute cells, in either direction and across hours',()=>{
 assert.deepEqual(dragSpan(555,569),{start:555,end:570})
 assert.deepEqual(dragSpan(614,590),{start:590,end:615})
 assert.deepEqual(dragSpan(1439,1439),{start:1439,end:1440})
})
test('minute coordinate uses the full hour track, not the width of its activity button',()=>{
 assert.equal(minuteInTrack(250,100,600,9),555)
 assert.equal(minuteInTrack(400,100,600,9),570)
 assert.equal(minuteInTrack(99,100,600,9),540)
 assert.equal(minuteInTrack(700,100,600,9),599)
})
