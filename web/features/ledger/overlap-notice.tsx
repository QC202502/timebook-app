import type { parallelConflicts } from '@/shared/lib/parallel-entry'
import { activityTitle, clock, MAX_CONCURRENT_ACTIVITIES, type Category, type LedgerRecord } from '@/shared/lib/ledger-v2'

export function OverlapNotice({ peak, related, categories, editing, conflicts = [] }: { peak: number; related: LedgerRecord[]; categories: Category[]; editing: boolean; conflicts?: ReturnType<typeof parallelConflicts> }) {
  if (peak <= 1) return null
  if (peak > MAX_CONCURRENT_ACTIVITIES) return <div className="overlap-note overlap-limit" role="alert">保存后，所选时段最多会同时有 {peak} 件事，超过 3 件上限。请调整时间或移除一条待添加活动。<ul>{conflicts.map((span, index) => <li key={index}>{span.date.slice(5)} {span.start}—{span.end}：{span.activities.map(r => activityTitle(r, categories)).join('、')}</li>)}</ul></div>
  return <details className="overlap-notice">
    <summary>保存后，最多同时 {peak} 件事 <small>含本次 · 查看</small></summary>
    <p>{editing ? '修改当前活动后，仍与以下记录同时进行。' : related.length ? '这段时间已有记录，本次将作为并行活动保存。' : '本次待保存的活动有时间重叠。'}</p>
    {!!related.length && <ul>{related.map(r => <li key={r.id}><span>{r.date.slice(5)} {clock(r.start)}—{r.end >= 1440 ? '次日 ' : ''}{clock(r.end % 1440)}</span><b>{activityTitle(r, categories)}</b></li>)}</ul>}
  </details>
}
