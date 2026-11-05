import './fixtures/profile.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withCodexProjects, codexCsv, type CodexReport } from '../shared/lib/codex-work.ts'
import { emptyCollaboration } from '../shared/lib/collaboration.ts'
const run = { id:'r1', group:'时间账本', title:'分类', summary:'改动', state:'回执摘录', basis:'自动摘录', routine:false, hidden:false, corrected:false, start:Date.parse('2026-10-30T09:00:00+08:00'),end:Date.parse('2026-10-30T09:10:00+08:00'),ms:600000,bucket:'known' as const,status:'completed',sources:['sessions/log:3'],receipt:'完成',sourceConflict:false,orphanChild:false,artifacts:[] }
const report: CodexReport = { schema: 1, revision: 0, range: { start: '2026-10-30', end: '2026-10-31' }, runs: [run], groups: [], metrics: { ms: 600000, closed: 1, open: 0, unknown: 0, nested: 0 }, scan: { firstDay: '2026-10-26', updatedAt: null, files: 1, pendingFiles: 0, partialFiles: 0, warnings: [] } }
test('project projection does not mutate ledger and source identity prevents double counts',()=>{
 const original=emptyCollaboration(); const before=JSON.stringify(original)
 const projected=withCodexProjects(original,report)
 assert.equal(JSON.stringify(original),before);assert.equal(projected.data.runs.length,1);assert.equal(projected.virtualIds.size,1)
 assert.equal(withCodexProjects(projected.data,report).data.runs.length,1)
})
test('open runs do not become continually growing project time',()=>{
 const result=withCodexProjects(emptyCollaboration(),{...report,runs:[{...run,bucket:'open',end:undefined,status:'open'}]})
 assert.equal(result.data.runs.length,0)
})
test('CSV escapes formulas and keeps unknown distinct from zero',()=>{
 const csv=codexCsv({...report,runs:[{...run,title:'=1+2',ms:null,bucket:'unknown'}]})
 assert.ok(csv.includes("'=1+2"));assert.ok(csv.includes(',"","unknown",'))
})

test('project time respects the first approved collection date',()=>{
 const month={...report,range:{start:'2026-10-01',end:'2026-11-01'},runs:[{...run,start:Date.parse('2026-10-25T23:50:00+08:00'),end:Date.parse('2026-10-26T00:10:00+08:00')}]}
 const projected=withCodexProjects(emptyCollaboration(),month)
 assert.equal(projected.data.runs[0].startedAt,'2026-10-25T16:00:00.000Z')
})
