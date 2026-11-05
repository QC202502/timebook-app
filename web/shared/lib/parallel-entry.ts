import { activityInput, secondaryIdsOf, type Change, type LedgerRecord } from './ledger-v2.ts'

type Time = { date: string; start: string; end: string; nextDay: boolean }
/** Only unsaved companions with an explicit link follow the anchor. */
export function followEntryTime<T extends Time & { followMain?: boolean }>(main: Time, companions: T[]): T[] {
  return companions.map(d => d.followMain ? { ...d, date: main.date, start: main.start, end: main.end, nextDay: main.nextDay } : d)
}
export function sameSavedActivity(a: LedgerRecord, b: LedgerRecord) {
  const comparable = (r: LedgerRecord) => ({ date:r.date, start:r.start, end:r.end, category:r.category,
    secondaryIds:secondaryIdsOf(r), activity:activityInput(r).trim(), activitySource:r.activitySource ?? 'custom',
    project:r.project.trim(), note:r.note, approximate:r.approximate, stage:r.stage ?? '', context:r.context })
  return JSON.stringify(comparable(a)) === JSON.stringify(comparable(b))
}
export function entryBatch(main: LedgerRecord, companions: LedgerRecord[], original?: LedgerRecord): Change {
  const upserts = [...(!original || !sameSavedActivity(main, original) ? [main] : []), ...companions]
  return { upserts, deleteIds: [], batchIntents: upserts.map(r => ({ id:r.id, kind:original?.id === r.id ? 'update' : 'create' })) }
}
/** Explicit write intent is validated inside the same version-checked transaction. */
export function batchIntentError(change: Change, records: LedgerRecord[]): {status:number; message:string} | null {
  if (change.batchIntents === undefined) return null
  const intents = change.batchIntents
  const malformed = () => ({status:400,message:'并行保存目标不一致，未写入任何活动。'})
  if (!Array.isArray(intents) || !intents.length || intents.length > 3 || change.createIds !== undefined || change.recordIntent !== undefined || change.categoryAction || change.deleteIds.length || intents.length !== change.upserts.length) return malformed()
  if (intents.some(i => !i || !['create','update'].includes(i.kind) || typeof i.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(i.id)) || new Set(intents.map(i => i.id)).size !== intents.length || change.upserts.some(r => !intents.some(i => i.id === r.id)) || new Set(change.upserts.map(r => r.id)).size !== intents.length) return malformed()
  if (change.confirmedReplacementIds?.some(id => !intents.some(i => i.id === id && i.kind === 'update'))) return malformed()
  for (const intent of intents) {
    const exists = records.some(r => r.id === intent.id)
    if (intent.kind === 'create' && exists) return {status:409,message:'新增活动不能覆盖已有记录，所有输入仍保留。'}
    if (intent.kind === 'update' && !exists) return {status:409,message:'原记录已不存在，未写入任何活动。请刷新核对。'}
  }
  return null
}

export function parallelConflicts(records: LedgerRecord[], pending: LedgerRecord[], editingId?: string | null) {
  const absolute = (r: LedgerRecord, edge:'start'|'end') => Date.parse(r.date+'T00:00:00Z')/60000+r[edge]
  const rows=[...records.filter(r=>r.id!==editingId),...pending].filter(r=>Number.isFinite(absolute(r,'start')) && Number.isFinite(absolute(r,'end')) && r.end>r.start)
  const edges=[...new Set(rows.flatMap(r=>[absolute(r,'start'),absolute(r,'end')]))].sort((a,b)=>a-b)
  const result:{date:string;start:string;end:string;activities:LedgerRecord[]}[]=[]
  for(let i=0;i<edges.length-1;i++) {
    const start=edges[i],end=edges[i+1]
    const activities=rows.filter(r=>absolute(r,'start')<end && absolute(r,'end')>start)
    if(activities.length<=3 || !pending.some(r=>absolute(r,'start')<end && absolute(r,'end')>start)) continue
    const from=new Date(start*60000).toISOString(),to=new Date(end*60000).toISOString()
    result.push({date:from.slice(0,10),start:from.slice(11,16),end:to.slice(0,10)!==from.slice(0,10)?'次日 '+to.slice(11,16):to.slice(11,16),activities})
  }
  return result
}
