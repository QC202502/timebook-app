'use client'
import type { CodexReport } from '@/shared/lib/codex-work'
import { codexProjectName } from '@/shared/lib/codex-work'
import { useState } from 'react'
import { activityTitle, clock, type Category, type LedgerRecord } from '@/shared/lib/ledger-v2'
import { type Collaboration, type ProjectReview } from '@/shared/lib/collaboration'
import { contextSummary, dayStartMs, projectSummary, timeText } from '@/shared/lib/collaboration-stats'
import { activeProjects, objectSummary, activityRollup, type InferredLink } from '@/shared/lib/automatic-statistics'
import type { ReportNow, ReportRange, Period } from '@/shared/lib/ledger-stats'
import type { SaveChange } from './catalog-manager'

type Props = { codexReport?: CodexReport | null; savedData: Collaboration; inferred: InferredLink[]; virtualIds: Set<string>; data: Collaboration; records: LedgerRecord[]; categories: Category[]; range: ReportRange; now: ReportNow; elapsed: boolean; period: Period; onSave: SaveChange; busy: boolean; onOpenRecord: (id: string) => void }
export function PairedBars({ human, agent, legacy = 0, max }: { human: number; agent: number; legacy?: number; max: number }) {
  return <div className="paired-bars"><div><span>本人</span><i><b style={{ width: human / max * 100 + '%' }} /></i><strong>{timeText(human * 60000)}</strong></div><div className="agent"><span>Codex</span><i><b style={{ width: agent / max * 100 + '%' }} /></i><strong>{timeText(agent * 60000)}</strong></div>{legacy > 0 && <small>另有原口径 {timeText(legacy * 60000)}，未标为本人净投入</small>}</div>
}
export function ProjectStatistics(props: Props) {
  const { data, savedData, records, categories, range, now, elapsed, period, inferred, virtualIds, onSave, busy, onOpenRecord } = props
  const projects = activeProjects(data, records, range, now, elapsed), [selected, setSelected] = useState('')
  const current = projects.find(p => p.entity.id === selected) ?? projects[0]
  const max = Math.max(1, ...projects.map(p => p.human.covered))
  const currentRecords = current ? [...new Map(current.human.entries.map(e => [e.record.id, records.find(r => r.id === e.record.id)!])).values()] : []
  const activities = activityRollup(currentRecords, categories, range, now, elapsed)
  const days = current ? current.human.days.filter(d => d.count) : []
  const stages = current?.stages.filter(s => s.name !== '未设阶段' && s.human + s.legacy + s.agent > 0) ?? []
  const codexGroups = props.codexReport?.groups.filter(g => codexProjectName(g.name) === current?.entity.name) || []
  const periodLabel = period === 'day' ? '这一天' : period === 'week' ? '这一周' : '这个月'
  return <div className="automatic-statistics">
    <div className="automatic-heading"><span>项目与事项</span><small>按记录自动汇总 · {projects.length} 项</small></div>
    {!projects.length ? <div className="collab-empty">这段时间暂无可汇总的项目。记录具体项目，或使用开发、视频日记等二级分类后，这里会自动汇总。</div> : <div className="collab-columns automatic-projects"><div className="project-list">{projects.map(p => {
      const ids = new Set(p.human.entries.map(e => e.record.id))
      const autoCount = new Set(inferred.filter(l => l.kind === 'project' && l.entityId === p.entity.id && ids.has(l.recordId)).map(l => l.recordId)).size
      return <button key={p.entity.id} aria-pressed={p.entity.id === current?.entity.id} className={'collab-card project-card' + (p.entity.id === current?.entity.id ? ' selected' : '')} onClick={() => setSelected(p.entity.id)}><div className="project-card-heading"><h3>{p.entity.name}</h3><strong>{p.human.count ? timeText(p.human.covered * 60000) : 'Codex ' + timeText(p.agent.knownMs)}</strong></div><i className="project-coverage-bar"><b style={{ width: p.human.covered / max * 100 + '%' }} /></i><small>{p.human.count} 条记录{autoCount ? ' · 自动归组' : ' · 已关联'}{p.agent.entries.length ? ' · Codex ' + timeText(p.agent.knownMs) + (p.agent.unknownCount ? ' / 有待核用时' : '') : ''}</small></button>
    })}</div>
    {current && <section className="collab-card project-detail"><div className="collab-heading"><h2>{current.entity.name}</h2><small>{periodLabel}</small></div>
      <p className="automatic-summary">记录了 <strong>{current.human.count}</strong> 段活动，覆盖 <strong>{timeText(current.human.covered * 60000)}</strong>{period !== 'day' ? '，分布在 ' + days.length + ' 天' : ''}。{activities.length > 0 && <>主要记录：{activities.slice(0, 3).map(a => a.name).join('；')}{activities.length > 3 ? '等' : ''}。</>}</p>
      {codexGroups.length > 0 && <section className="project-codex-results"><h3>Codex 推进了什么 · {timeText(current.agent.knownMs)}</h3>{codexGroups.flatMap(g => g.matters.filter(m => !m.hidden && !m.routine).map(m => <details key={g.name + m.title}><summary>{m.title} <small> · {timeText(m.ms)}</small></summary><p className="codex-receipt">{m.summary}</p><small>{m.state} · {m.basis}</small></details>))}</section>}
      <h3>具体做了什么</h3><div className="activity-rollup">{activities.map(a => <details key={a.name}><summary><span>{a.name}</span><small>{a.count} 条 · {timeText(a.covered * 60000)}</small></summary>{a.entries.map((e, i) => <button className="record-drill" key={e.record.id + ':' + i} onClick={() => onOpenRecord(e.record.id)}><span>{e.record.date} {clock(e.record.start)}–{clock(e.record.end)}{e.record.project && <small>{e.record.project}</small>}</span><small>{timeText((e.end - e.start) * 60000)} ↗</small></button>)}</details>)}</div>
      {stages.length > 0 && <><h3>记录中的阶段</h3>{stages.map(stage => <div className="automatic-stage" key={stage.name}><span>{stage.name}</span><b>{timeText(stage.covered * 60000)}</b>{stage.agent > 0 && <small>Codex {timeText(stage.agent)}</small>}</div>)}</>}
      {period !== 'day' && days.length > 0 && <><h3>每天投入</h3><div className="project-days">{days.map(d => <div key={d.date}><span>{d.date.slice(5)}</span><i><b style={{ width: d.covered / Math.max(...days.map(x => x.covered)) * 100 + '%' }} /></i><small>{timeText(d.covered * 60000)}</small></div>)}</div></>}
      {(current.agent.entries.length > 0 || current.human.humanMinutes > 0) && <details className="input-breakdown"><summary>本人和 Codex 用时</summary><PairedBars human={current.human.humanMinutes} agent={current.agent.knownMs / 60000} legacy={current.human.legacyMinutes} max={Math.max(1, current.human.humanMinutes, current.agent.knownMs / 60000)} />{current.agent.estimatedMs > 0 && <p>Codex 估计 {timeText(current.agent.estimatedMs)}</p>}{current.agent.runningMs > 0 && <p>Codex 运行中 {timeText(current.agent.runningMs)}</p>}{current.agent.unknownCount > 0 && <p>{current.agent.unknownCount} 次执行用时待核</p>}</details>}
      {current.human.legacyMinutes > 0 && <p className="collab-note">包含未区分执行者的旧记录；以上为记录用时，不等同于已核实的本人净投入。</p>}
      {current.tasks.some(t => t.outcomes.length) && <><h3>已登记成果</h3><div className="outcome-list">{current.tasks.flatMap(t => t.outcomes.map(o => <p key={o.id}><b>{o.title}</b><small>{t.title} · {o.version || '未标版本'} · {({ draft: '草稿', delivered: '已交付', accepted: '已验收', published: '已发布' })[o.state]}</small>{o.location && <small className="source-location">{o.location}</small>}</p>))}</div></>}
      {!virtualIds.has(current.entity.id) && <details className="project-followup"><summary>下一步 · 选填{current.entity.nextStep ? ' · ' + current.entity.nextStep : ''}</summary><ProjectNext key={current.entity.id + ':' + (current.entity.nextStep ?? '')} entity={current.entity} onSave={onSave} busy={busy} /></details>}
      {current.agent.entries.length > 0 && <CollaborationTrace data={data} records={currentRecords} projectId={current.entity.id} range={range} categories={categories} />}
    </section>}</div>}
    {period !== 'day' && savedData.entities.some(e => e.kind === 'project') && <details className="optional-review"><summary>计划与复盘 · 选填</summary><ReviewPanel key={period + range.start} {...props} data={savedData} /></details>}
  </div>
}
function ProjectNext({ entity, onSave, busy }: { entity: Collaboration['entities'][number]; onSave: SaveChange; busy: boolean }) {
  const [text, setText] = useState(entity.nextStep ?? '')
  return <form className="project-next" onSubmit={e => { e.preventDefault(); void onSave({ upserts: [], deleteIds: [], collaborationChange: { entities: [{ ...entity, nextStep: text.trim() }] } }, '项目下一步已保存') }}><label>下一步<textarea aria-label="项目下一步" rows={2} maxLength={1000} value={text} onChange={e => setText(e.target.value)} placeholder="留一句最重要的下一步" /></label><button disabled={busy || text === (entity.nextStep ?? '')} type="submit">保存下一步</button></form>
}
function ReviewPanel({ data, records, range, now, elapsed, period, onSave, busy }: Props) {
  const reviews = data.reviews.filter(r => r.period === period && r.start === range.start)
  const [editing, setEditing] = useState<Partial<ProjectReview>>({ projectId: '', minMinutes: 0, maxMinutes: 0, result: '', nextStep: '' })
  async function save() {
    const review: ProjectReview = { id: editing.id || crypto.randomUUID(), projectId: editing.projectId!, period: period as 'week' | 'month', start: range.start, minMinutes: Number(editing.minMinutes), maxMinutes: Number(editing.maxMinutes), result: editing.result ?? '', nextStep: editing.nextStep ?? '' }
    if (await onSave({ upserts: [], deleteIds: [], collaborationChange: { reviews: [review] } }, '本期复盘已保存')) setEditing({ projectId: '', minMinutes: 0, maxMinutes: 0, result: '', nextStep: '' })
  }
  return <section className="collab-card review-panel"><h3>本期关注与复盘 <small>选填 · 最多3个项目</small></h3>{reviews.map(r => {
    const h = contextSummary(records, range, now, elapsed, c => c.projectId === r.projectId)
    return <div className="review-row" key={r.id}><b>{data.entities.find(p => p.id === r.projectId)?.name}</b><p>计划本人投入 {r.minMinutes}–{r.maxMinutes} 分 · 本期本人 {timeText(h.humanMinutes * 60000)}{h.legacyMinutes ? ' · 另有原口径待区分' : ''}</p><p>{r.result || '尚未填写结果与偏差'}</p><small>下一步：{r.nextStep || '待定'}</small><button onClick={() => setEditing(r)}>修改复盘</button><button disabled={busy} onClick={() => void onSave({ upserts: [], deleteIds: [], collaborationChange: { deleteReviewIds: [r.id] } }, '已取消本期关注')}>取消关注</button></div>
  })}<details open={!!editing.id}><summary>{editing.id ? '修改本期复盘' : '关注一个项目'}</summary><form onSubmit={e => { e.preventDefault(); void save() }}><fieldset disabled={busy}><div className="collab-form-grid"><label>关注项目<select required aria-label="复盘项目" value={editing.projectId} onChange={e => setEditing({ ...editing, projectId: e.target.value })}><option value="">选择项目</option>{data.entities.filter(e => e.kind === 'project').map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label><label>计划下限（本人分钟）<input type="number" required min="0" value={editing.minMinutes} onChange={e => setEditing({ ...editing, minMinutes: Number(e.target.value) })} /></label><label>计划上限（本人分钟）<input type="number" required min={editing.minMinutes} value={editing.maxMinutes} onChange={e => setEditing({ ...editing, maxMinutes: Number(e.target.value) })} /></label></div><label>完成情况与偏差<textarea aria-label="完成情况与偏差" maxLength={2000} value={editing.result} onChange={e => setEditing({ ...editing, result: e.target.value })} /></label><label>下一步<textarea aria-label="复盘下一步" maxLength={1000} value={editing.nextStep} onChange={e => setEditing({ ...editing, nextStep: e.target.value })} /></label><button className="primary-button" type="submit">保存本期关注</button></fieldset></form></details></section>
}
export function ObjectStatistics({ data, records, categories, range, now, elapsed, inferred, onOpenRecord }: Props) {
  const [kind, setKind] = useState<'book' | 'person'>('book'), [selected, setSelected] = useState('')
  const allRows = objectSummary(data, records, range, now, elapsed), rows = allRows.filter(r => r.entity.kind === kind)
  const current = rows.find(r => r.entity.id === selected) ?? rows[0], max = Math.max(1, ...rows.map(r => r.actual.covered))
  return <div className="automatic-statistics"><div className="automatic-heading"><div className="collab-tabs object-tabs"><button aria-label="书籍" aria-pressed={kind === 'book'} onClick={() => { setKind('book'); setSelected('') }}>书籍与课程 <small>{allRows.filter(r => r.entity.kind === 'book').length}</small></button><button aria-label="人物" aria-pressed={kind === 'person'} onClick={() => { setKind('person'); setSelected('') }}>人物 <small>{allRows.filter(r => r.entity.kind === 'person').length}</small></button></div><small>按记录自动汇总</small></div>
    {!rows.length ? <div className="collab-empty">这段时间没有明确的{kind === 'book' ? '书籍或课程' : '人物'}记录。{kind === 'book' ? '读书、听小说或听课时填上名称，就会显示在这里。' : '聊天时选人物或填具体对象，就会显示在这里；空白对象不会猜测。'}</div> : <div className="collab-columns automatic-objects"><section className="collab-card"><h3>{kind === 'book' ? '读听了哪些内容' : '与谁度过时间'}</h3>{rows.map(r => <button className={'rank-row' + (current?.entity.id === r.entity.id ? ' selected' : '')} key={r.entity.id} aria-pressed={current?.entity.id === r.entity.id} onClick={() => setSelected(r.entity.id)}><span>{r.entity.name}</span><i><b style={{ width: r.actual.covered / max * 100 + '%' }} /></i><strong>{r.actual.count ? timeText(r.actual.covered * 60000) : '仅关联'}</strong></button>)}</section>{current && <section className="collab-card object-detail"><div className="collab-heading"><h2>{current.entity.name}</h2><small>{inferred.some(l => l.entityId === current.entity.id && current.all.entries.some(e => e.record.id === l.recordId)) ? '自动归组' : '已关联'}</small></div><p className="automatic-summary">{kind === 'book' ? '阅读 / 听书 / 课程' : '共同参与'} <strong>{timeText(current.actual.covered * 60000)}</strong>，{current.actual.count} 条记录，分布在 {current.actual.days.filter(d => d.count).length} 天。</p>
      <h3>本期明细</h3>{current.all.entries.map((e, i) => <button className="record-drill" key={e.record.id + ':' + i} onClick={() => onOpenRecord(e.record.id)}><span>{e.record.date} {clock(e.record.start)}–{clock(e.record.end)}<small>{activityTitle(e.record, categories)}{e.record.project ? ' · ' + e.record.project : ''}</small></span><small>{current.actual.entries.some(a => a.record.id === e.record.id) ? timeText((e.end - e.start) * 60000) : '引用 / 仅提及'} ↗</small></button>)}
      {[...new Set(current.all.entries.map(e => data.entities.find(p => p.id === e.record.context?.projectId)?.name).filter(Boolean))].length > 0 && <><h3>相关项目</h3><p>{[...new Set(current.all.entries.map(e => data.entities.find(p => p.id === e.record.context?.projectId)?.name).filter(Boolean))].join('、')}</p></>}
    </section>}</div>}
    <p className="collab-note">{kind === 'book' ? '同一本书的阅读和听书区间去重；仅引用不算阅读时间。' : '同一人的相处时间去重；多人共同参与会分别计入，人物小计不可相加。'}</p>
  </div>
}
function CollaborationTrace({ data, records, projectId, range, categories }: { data: Collaboration; records: LedgerRecord[]; projectId: string; range: ReportRange; categories: Category[] }) {
  const tasks = new Set(data.tasks.filter(t => t.projectId === projectId).map(t => t.id))
  const runs = data.runs.filter(r => tasks.has(r.taskId) && r.startedAt && r.endedAt)
  const days = [...new Set([...records.map(r => r.date), ...runs.map(r => new Date(Date.parse(r.startedAt!) + 8 * 3600000).toISOString().slice(0, 10))])].filter(d => d >= range.start && d < range.end).sort()
  const [selected, setSelected] = useState(''), day = days.includes(selected) ? selected : days[0]
  if (!day) return null
  const rows = [
    ...records.flatMap(r => { const start = (dayStartMs(r.date) - dayStartMs(day)) / 60000 + r.start, end = (dayStartMs(r.date) - dayStartMs(day)) / 60000 + r.end; return end > 0 && start < 1440 ? [{ id: r.id, start: Math.max(0, start), end: Math.min(1440, end), title: activityTitle(r, categories), actor: r.context?.executor === 'human' ? '本人' : '原口径' }] : [] }),
    ...runs.flatMap(r => { const start = (Date.parse(r.startedAt!) - dayStartMs(day)) / 60000, end = (Date.parse(r.endedAt!) - dayStartMs(day)) / 60000; return end > 0 && start < 1440 ? [{ id: r.id, start: Math.max(0, start), end: Math.min(1440, end), title: data.tasks.find(t => t.id === r.taskId)?.title ?? 'Codex', actor: 'Codex' }] : [] })
  ].sort((a, b) => a.start - b.start)
  const lower = Math.floor(Math.min(...rows.map(r => r.start)) / 60) * 60, upper = Math.ceil(Math.max(...rows.map(r => r.end)) / 60) * 60
  return <details className="collaboration-trace"><summary>展开人机协作轨迹</summary><select aria-label="协作轨迹日期" value={day} onChange={e => setSelected(e.target.value)}>{days.map(d => <option key={d}>{d}</option>)}</select><p>{clock(lower)} — {clock(upper)} · 位置按真实钟点，不把并行相加成经过时间</p>{rows.map(r => <div className="trace-row" key={r.id}><small>{r.actor}</small><i><b className={r.actor === 'Codex' ? 'agent' : ''} style={{ marginLeft: (r.start - lower) / Math.max(1, upper - lower) * 100 + '%', width: (r.end - r.start) / Math.max(1, upper - lower) * 100 + '%' }} /></i><span>{clock(Math.floor(r.start))}–{clock(Math.ceil(r.end))} · {r.title}</span></div>)}</details>
}
