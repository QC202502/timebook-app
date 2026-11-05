import './fixtures/profile.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { entryBatch, followEntryTime, batchIntentError } from '../shared/lib/parallel-entry.ts'
import type { Change, LedgerRecord } from '../shared/lib/ledger-v2.ts'
const row = (id: string, start=540, end=570): LedgerRecord => ({id,date:'2026-11-02',start,end,category:'work',secondaryId:null,activity:'工作',project:'',note:'',approximate:false})

test('unchanged original is not resubmitted, changed original keeps update intent',()=>{
 const original=row('old'), companion={...row('new'),category:'fun'}
 assert.deepEqual(entryBatch({...original,secondaryIds:[],activitySource:'custom',suggestedFields:[]},[companion],original),{upserts:[companion],deleteIds:[],batchIntents:[{id:'new',kind:'create'}]})
 const changed={...original,activity:'写方案'}
 assert.deepEqual(entryBatch(changed,[companion],original),{upserts:[changed,companion],deleteIds:[],batchIntents:[{id:'old',kind:'update'},{id:'new',kind:'create'}]})
 assert.equal(entryBatch(original,[],original).upserts.length,0)
 assert.equal(entryBatch(original,[]).batchIntents?.[0].kind,'create')
 assert.equal(entryBatch({...original,end:580},[],original).upserts.length,1)
 assert.equal(entryBatch({...original,project:'新项目'},[],original).upserts.length,1)
 assert.equal(entryBatch({...original,context:{executor:'human',books:[],people:[]}},[],original).upserts.length,1)
})
test('follow time moves only linked drafts including midnight; does not mutate source',()=>{
 const main={date:'2026-11-02',start:'23:50',end:'00:10',nextDay:true}
 const drafts=[{...main,id:'a',end:'23:55',followMain:true},{...main,id:'b',end:'00:05',followMain:false}]
 const before=structuredClone(drafts), after=followEntryTime(main,drafts)
 assert.equal(after[0].end,'00:10');assert.equal(after[0].nextDay,true)
 assert.deepEqual(after[1],drafts[1]);assert.deepEqual(drafts,before)
})
test('batch intents reject ambiguous, missing and existing targets before any write',()=>{
 const old=row('old'), fresh=row('new'), valid:Change={upserts:[old,fresh],deleteIds:[],batchIntents:[{id:'old',kind:'update'},{id:'new',kind:'create'}]}
 assert.equal(batchIntentError(valid,[old]),null)
 assert.equal(batchIntentError({upserts:[],deleteIds:[]},[old]),null)
 for(const change of [
  {...valid,batchIntents:[]}, {...valid,batchIntents:[{id:'old',kind:'create'},{id:'new',kind:'create'}]},
  {...valid,batchIntents:[{id:'old',kind:'update'},{id:'new',kind:'update'}]},
  {...valid,batchIntents:[{id:'old',kind:'update'},{id:'old',kind:'update'}]},
  {...valid,batchIntents:[{id:'old',kind:'update'},{id:'wrong',kind:'create'}]},
  {...valid,createIds:['new']}, {...valid,recordIntent:{id:'old',kind:'update'}},
  {...valid,deleteIds:['old']}, {...valid,confirmedReplacementIds:['new']},
  {...valid,batchIntents:[{id:'old',kind:'remove'},{id:'new',kind:'create'}]},
  {...valid,batchIntents:null}, {...valid,batchIntents:[{id:'bad id',kind:'create'}]},
  {...valid,batchIntents:Array(4).fill({id:'new',kind:'create'})},
  {...valid,categoryAction:{type:'rename'}},
 ] as Change[]) assert.ok(batchIntentError(change,[old]))
 assert.equal(batchIntentError({...valid,confirmedReplacementIds:['old']},[old]),null)
})

import { parallelConflicts } from '../shared/lib/parallel-entry.ts'
test('conflict details locate only the four-way intersection, including midnight',()=>{
 const fixed=[row('a',540,600),row('b',550,580),row('c',560,590)]
 const result=parallelConflicts(fixed,[row('d',570,620)])
 assert.equal(result.length,1);assert.equal(result[0].start,'09:30');assert.equal(result[0].end,'09:40')
 assert.deepEqual(result[0].activities.map(r=>r.id),['a','b','c','d'])
 assert.equal(parallelConflicts(fixed,[row('d',600,620)]).length,0)
 assert.equal(parallelConflicts(fixed,[row('a',570,620)],'a').length,0)
 const night=[row('n1',1430,1460),row('n2',1430,1460),row('n3',1430,1460)]
 assert.equal(parallelConflicts(night,[{...row('n4',0,5),date:'2026-11-03'}])[0].date,'2026-11-03')
 assert.equal(parallelConflicts(night,[row('bad',NaN,NaN)]).length,0)
})
