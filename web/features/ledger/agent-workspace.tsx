'use client'
import { useRef, useState } from 'react'
import { activityTitle, type Category, type LedgerRecord } from '@/shared/lib/ledger-v2'
import { validRun, type AgentRun, type Collaboration, type Outcome, type WorkItem } from '@/shared/lib/collaboration'
import { agentSummary, timeText } from '@/shared/lib/collaboration-stats'
import type { ReportRange } from '@/shared/lib/ledger-stats'
import type { SaveChange } from './catalog-manager'
import type { RunCandidate } from '@/server/lib/codex-sources'

const statusName = { completed: '执行完成', failed: '失败', cancelled: '已取消', running: '运行中 · 暂计' }
const qualityName = { observed: '会话事件', reported: '明确申报', estimated: '估计', unknown: '用时待核' }
const outcomeName = { draft: '草稿', delivered: '已交付', accepted: '已验收', published: '已发布' }
const localInput = (iso?: string) => iso ? new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(0, 19) : ''
const toISO = (value: string) => value ? new Date(value + '+08:00').toISOString() : undefined
export function AgentEditor({ data, run, date, onSave, onClose, busy }: { data: Collaboration; run?: AgentRun; date: string; onSave: SaveChange; onClose: () => void; busy: boolean }) {
  const originalTask = data.tasks.find(t => t.id === run?.taskId)
  const ids = useRef({ run: run?.id || crypto.randomUUID(), task: originalTask?.id || crypto.randomUUID() })
  const [taskId, setTaskId] = useState(originalTask?.id ?? ''), [title, setTitle] = useState(originalTask?.title ?? ''), [projectId, setProjectId] = useState(originalTask?.projectId ?? ''), [stage, setStage] = useState(originalTask?.stage ?? '')
  const [start, setStart] = useState(localInput(run?.startedAt)), [end, setEnd] = useState(localInput(run?.endedAt)), [day, setDay] = useState(run?.date ?? date)
  const [status, setStatus] = useState<AgentRun['status']>(run?.status ?? 'completed'), [quality, setQuality] = useState<AgentRun['quality']>(run?.quality ?? 'reported')
  const [minutes, setMinutes] = useState(run?.durationMs === undefined ? '' : String(run.durationMs / 60000)), [sourceKey, setSourceKey] = useState(run?.sourceKey ?? ''), [parentKey, setParentKey] = useState(run?.parentKey ?? '')
  const [pauses, setPauses] = useState(run?.pauses.map(p => ({ start: localInput(p.start), end: localInput(p.end) })) ?? [])
  const [outcomes, setOutcomes] = useState<Outcome[]>(originalTask?.outcomes ?? []), [error, setError] = useState('')
  function chooseTask(id: string) {
    setTaskId(id)
    const task = data.tasks.find(t => t.id === id)
    setTitle(task?.title ?? ''); setProjectId(task?.projectId ?? ''); setStage(task?.stage ?? ''); setOutcomes(task?.outcomes ?? [])
  }
  async function save() {
    setError('')
    try {
      const task: WorkItem = { id: taskId || ids.current.task, title: title.trim(), projectId, stage: stage.trim(), outcomes }
      const updated: AgentRun = { id: ids.current.run, taskId: task.id, sourceKey: sourceKey.trim() || 'manual:' + ids.current.run, date: start ? start.slice(0, 10) : day, status, quality,
        ...(start ? { startedAt: toISO(start) } : {}), ...(end && status !== 'running' ? { endedAt: toISO(end) } : {}), ...(minutes !== '' && status !== 'running' ? { durationMs: Number(minutes) * 60000 } : {}),
        pauses: pauses.map(p => ({ start: toISO(p.start)!, end: toISO(p.end)! })), ...(parentKey ? { parentKey } : {}), sources: run?.sources ?? [{ kind: 'manual', locator: '本人填写Codex执行时间' }] }
      if (run && JSON.stringify([run.startedAt, run.endedAt, run.durationMs, run.pauses]) !== JSON.stringify([updated.startedAt, updated.endedAt, updated.durationMs, updated.pauses])) { updated.quality = quality === 'observed' ? 'reported' : quality; updated.sources = [...run.sources.filter(s => s.kind !== 'manual'), { kind: 'manual' as const, locator: '本人修正执行时间' }].slice(-20) }
      if (!validRun(updated) || !task.title) throw new Error('请检查任务名、起止和暂停时间。用时未知可留空；明确时长可单独填写。')
      if (await onSave({ upserts: [], deleteIds: [], collaborationChange: { tasks: [task], runs: [updated] } }, 'Codex执行已保存')) onClose()
    } catch (e) { setError(e instanceof Error ? e.message : '请检查输入。') }
  }
  return <section className="collab-card agent-editor" aria-label="Codex执行编辑"><div className="collab-heading"><h3>{run ? '修改执行与成果' : '记一段Codex工作'}</h3><button onClick={onClose}>取消</button></div>
    <p className="collab-note">记录Codex自主执行；你的交办、思考和复核仍在时间轴记录。北京时间。</p>
    <form onSubmit={e => { e.preventDefault(); void save() }}><fieldset disabled={busy}>
      <div className="collab-form-grid"><label>业务任务<select aria-label="执行所属任务" value={taskId} onChange={e => chooseTask(e.target.value)}><option value="">新任务</option>{data.tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label><label>任务名称<input aria-label="Codex任务名称" required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} /></label><label>项目<select aria-label="Codex项目" value={projectId} onChange={e => setProjectId(e.target.value)}><option value="">待归属</option>{data.entities.filter(e => e.kind === 'project').map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label><label>阶段<input aria-label="Codex阶段" maxLength={40} value={stage} onChange={e => setStage(e.target.value)} placeholder="如制作、剪辑、返工" /></label>
      <label>开始<input aria-label="Codex开始" type="datetime-local" step="1" value={start} onChange={e => setStart(e.target.value)} /></label><label>结束<input aria-label="Codex结束" type="datetime-local" step="1" disabled={status === 'running'} value={end} onChange={e => setEnd(e.target.value)} /></label><label>无起止时的归属日期<input aria-label="Codex归属日期" type="date" required disabled={!!start} value={start ? start.slice(0, 10) : day} onChange={e => setDay(e.target.value)} /></label><label>明确申报时长（分钟，可留空）<input aria-label="Codex申报分钟" type="number" step="any" min="0" disabled={status === 'running'} value={minutes} onChange={e => setMinutes(e.target.value)} placeholder="有起止时可留空" /></label><label>执行状态<select aria-label="Codex执行状态" value={status} onChange={e => setStatus(e.target.value as AgentRun['status'])}>{Object.entries(statusName).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label><label>时间依据<select aria-label="Codex时间依据" value={quality} onChange={e => setQuality(e.target.value as AgentRun['quality'])}>{Object.entries(qualityName).filter(([v]) => v !== 'observed' || run?.quality === 'observed').map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label></div>
      <details><summary>来源、父执行与明确暂停</summary><div className="collab-form-grid"><label>执行唯一标识<input aria-label="执行唯一标识" value={sourceKey} maxLength={200} onChange={e => setSourceKey(e.target.value)} placeholder="自动生成；同一执行的多种来源共用此值" /></label><label>所属父执行<select aria-label="所属父执行" value={parentKey} onChange={e => setParentKey(e.target.value)}><option value="">独立执行</option>{data.runs.filter(r => r.id !== run?.id).map(r => <option key={r.id} value={r.sourceKey}>{data.tasks.find(t => t.id === r.taskId)?.title} · {r.date}</option>)}</select></label></div>
      {pauses.map((p, i) => <div key={i} className="collab-form-grid"><label>暂停开始<input type="datetime-local" step="1" required value={p.start} onChange={e => setPauses(pauses.map((x, j) => j === i ? { ...x, start: e.target.value } : x))} /></label><label>暂停结束<input type="datetime-local" step="1" required value={p.end} onChange={e => setPauses(pauses.map((x, j) => j === i ? { ...x, end: e.target.value } : x))} /></label><button type="button" onClick={() => setPauses(pauses.filter((_, j) => i !== j))}>移除此暂停</button></div>)}<button type="button" onClick={() => setPauses([...pauses, { start: '', end: '' }])}>＋ 排除明确暂停</button></details>
      <details open={!!outcomes.length}><summary>任务成果与版本</summary><p className="collab-note">执行完成不代表成果已验收或发布。同一业务任务的名称、项目、阶段和成果对各轮执行共同生效；起止时间单独保存。</p>{outcomes.map((o, i) => <div className="outcome-editor" key={o.id}><input aria-label={'成果名称 ' + i} placeholder="成果名称" required maxLength={200} value={o.title} onChange={e => setOutcomes(outcomes.map((v, j) => i === j ? { ...v, title: e.target.value } : v))} /><input aria-label={'成果位置 ' + i} placeholder="文件路径或链接（可空）" maxLength={1000} value={o.location} onChange={e => setOutcomes(outcomes.map((v, j) => i === j ? { ...v, location: e.target.value } : v))} /><input aria-label={'成果版本 ' + i} placeholder="版本" maxLength={80} value={o.version} onChange={e => setOutcomes(outcomes.map((v, j) => i === j ? { ...v, version: e.target.value } : v))} /><select aria-label={'成果状态 ' + i} value={o.state} onChange={e => setOutcomes(outcomes.map((v, j) => i === j ? { ...v, state: e.target.value as Outcome['state'] } : v))}>{Object.entries(outcomeName).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select><button type="button" onClick={() => setOutcomes(outcomes.filter((_, j) => i !== j))}>移除成果</button></div>)}<button type="button" onClick={() => setOutcomes([...outcomes, { id: crypto.randomUUID(), title: '', version: '', location: '', state: 'draft' }])}>＋ 成果</button></details>
      {error && <p role="alert" className="error-message">{error}</p>}<button className="primary-button" type="submit">保存Codex执行</button>
    </fieldset></form>
  </section>
}

export function SourceImport({ data, date, demo, records, categories, onSave, busy }: { data: Collaboration; date: string; demo: boolean; records: LedgerRecord[]; categories: Category[]; onSave: SaveChange; busy: boolean }) {
  const [day, setDay] = useState(date), [receipt, setReceipt] = useState(''), [candidates, setCandidates] = useState<RunCandidate[]>([]), [warnings, setWarnings] = useState<string[]>([]), [error, setError] = useState(''), [scanning, setScanning] = useState(false)
  const [selected, setSelected] = useState(''), [projectId, setProjectId] = useState(''), [taskId, setTaskId] = useState(''), [ack, setAck] = useState(false), [stage, setStage] = useState('')
  const item = candidates.find(c => c.run.id === selected), prior = data.runs.find(r => r.sourceKey === item?.run.sourceKey)
  const overlap = item?.run.startedAt && item.run.endedAt ? records.filter(r => r.context?.executor !== 'human' && Date.parse(r.date + 'T00:00:00+08:00') + r.start * 60000 < Date.parse(item.run.endedAt!) && Date.parse(r.date + 'T00:00:00+08:00') + r.end * 60000 > Date.parse(item.run.startedAt!)) : []
  async function scan(pasted = false) {
    setScanning(true); setError(''); setSelected(''); setAck(false)
    try {
      const response = await fetch(pasted ? '/api/codex-sources' : '/api/codex-sources?date=' + day, pasted ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: receipt } : { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      setCandidates(result.candidates); setWarnings([...(result.warnings ?? []), !result.candidates.length ? '没有找到这天可用的执行证据；不会根据memory标题时间推算。' : '读取到 ' + result.candidates.length + ' 项，尚未计入账本。'])
    } catch (e) { setError(e instanceof Error ? e.message : '来源读取失败。') }
    finally { setScanning(false) }
  }
  async function importOne() {
    if (!item || overlap.length && !ack) return
    const task = prior ? data.tasks.find(t => t.id === prior.taskId)! : data.tasks.find(t => t.id === taskId) ?? { ...item.task, projectId, stage }
    const run = { ...item.run, id: prior?.id ?? item.run.id, taskId: task.id }
    if (await onSave({ upserts: [], deleteIds: [], collaborationChange: { runs: [run], tasks: [task], importing: true, acknowledgeOverlap: ack } }, prior ? '来源已更新，归属保持不变' : '执行已确认导入')) { setSelected(''); setAck(false) }
  }
  return <details className="collab-card source-import"><summary>从Codex / memory导入</summary>
    <p className="collab-note">读取本机memory明确计时块及关联会话事件。逐项核对归属；不把整段聊天算作工作时间。</p>
    <div className="catalog-form"><input aria-label="来源日期" type="date" value={day} onChange={e => setDay(e.target.value)} /><button disabled={scanning || busy || demo} onClick={() => void scan()}>{scanning ? '读取中…' : '读取当日来源'}</button>{demo && <small>真实来源仅在“我的记录”中读取</small>}</div>
    <details><summary>粘贴Codex提供的执行回执</summary><p className="collab-note">sourceKey（或turnId）用于同次执行去重，起止需含时区。也可仅提供date和durationMs；未知时间留空。</p><textarea aria-label="Codex执行回执" rows={6} value={receipt} onChange={e => setReceipt(e.target.value)} placeholder={'{"sourceKey":"task-unique-id","title":"制作视频","startedAt":"' + date + 'T09:00:00+08:00","endedAt":"' + date + 'T09:30:00+08:00"}'} /><button disabled={scanning || busy || !receipt.trim()} onClick={() => void scan(true)}>预览回执</button></details>
    {error && <p className="error-message" role="alert">{error}</p>}{warnings.map(w => <p className="collab-note" key={w}>{w}</p>)}
    <div className="import-list">{candidates.map(c => <button key={c.run.id} className={selected === c.run.id ? 'selected' : ''} onClick={() => { setSelected(c.run.id); setAck(false); setTaskId(''); setProjectId(''); setStage(c.task.stage) }}><b>{c.task.title}</b><small>{c.run.startedAt ? localInput(c.run.startedAt).replace('T', ' ') : c.run.date} · {qualityName[c.run.quality]} · {data.runs.some(r => r.sourceKey === c.run.sourceKey) ? '已导入，核对后更新' : '未导入'}</small></button>)}</div>
    {item && <div className="import-preview"><h4>{item.task.title}</h4><p>{item.run.startedAt ? localInput(item.run.startedAt).replace('T', ' ') : '开始待核'} — {item.run.endedAt ? localInput(item.run.endedAt).replace('T', ' ') : '结束待核'}</p><SourceList run={item.run} />{item.warnings.map(w => <p key={w}>{w}</p>)}
      {prior ? <p>保留你已确认的任务与项目：{data.tasks.find(t => t.id === prior.taskId)?.title}</p> : <div className="collab-form-grid"><label>业务任务<select aria-label="导入所属任务" value={taskId} onChange={e => setTaskId(e.target.value)}><option value="">作为新任务</option>{data.tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>{!taskId && <><label>项目<select aria-label="导入项目" value={projectId} onChange={e => setProjectId(e.target.value)}><option value="">暂未归属</option>{data.entities.filter(e => e.kind === 'project').map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label><label>阶段<input aria-label="导入阶段" value={stage} maxLength={40} onChange={e => setStage(e.target.value)} /></label></>}</div>}
      {!!overlap.length && <div className="collab-warning"><p>与 {overlap.length} 条未区分执行者的历史记录重叠，可能已有手工Codex记录：</p>{overlap.slice(0, 5).map(r => <small key={r.id}>{r.date} · {activityTitle(r, categories)}</small>)}<label className="check-line"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />已核对本人和Codex分别记录；原记录不会被自动改写</label></div>}
      <button className="primary-button" disabled={busy || !!overlap.length && !ack} onClick={() => void importOne()}>{prior ? '确认更新这次执行' : '确认导入这次执行'}</button>
    </div>}
  </details>
}

export function SourceList({ run }: { run: AgentRun }) {
  return <details className="source-list"><summary>来源依据 · {qualityName[run.quality]}</summary><p>执行标识：{run.sourceKey}</p>{run.sources.map((s, i) => <p key={i}><b>{s.kind}</b> · {s.locator}{s.fingerprint && <small>版本 {s.fingerprint.slice(0, 12)}</small>}</p>)}{run.durationMs !== undefined && <small>来源原始时长 {(run.durationMs / 1000).toFixed(3)} 秒</small>}<p>任务经过时间；仅扣除明确填写的暂停，不代表GPU或纯推理用时。</p></details>
}
export function AgentWorkspace({ data, records, categories, range, nowMs, elapsed, date, onSave, busy, demo }: { data: Collaboration; records: LedgerRecord[]; categories: Category[]; range: ReportRange; nowMs: number; elapsed: boolean; date: string; onSave: SaveChange; busy: boolean; demo: boolean }) {
  const report = agentSummary(data.runs, range, nowMs, elapsed)
  const [editing, setEditing] = useState<string | null>(null)
  return <div className="collab-agent-view"><div className="collab-metrics"><article><small>Codex任务用时</small><strong data-testid="agent-known">{timeText(report.knownMs)}</strong><span>独立执行累计，含已知失败用时</span></article><article><small>运行中 · 暂计</small><strong>{timeText(report.runningMs)}</strong><span>完成后结算；估计另列 {timeText(report.estimatedMs)}</span></article><article><small>用时待核</small><strong>{report.unknownCount} 项</strong><span>另有 {report.nestedCount} 项子执行，不重复累加</span></article></div>
    <div className="collab-heading"><h2>Codex做了什么</h2><button className="primary-button" onClick={() => setEditing('new')}>＋ 记录Codex工作</button></div>
    {editing && <AgentEditor key={editing} data={data} run={data.runs.find(r => r.id === editing)} date={date} onSave={onSave} onClose={() => setEditing(null)} busy={busy} />}
    <SourceImport data={data} date={date} demo={demo} records={records} categories={categories} onSave={onSave} busy={busy} />
    {!report.entries.length && <div className="collab-empty">本期尚无Codex执行记录。可以手工填写，或读取来源后确认导入。</div>}
    <div className="agent-run-list">{report.entries.slice().reverse().map(e => { const task = data.tasks.find(t => t.id === e.run.taskId)!; return <article className="collab-card" key={e.run.id}><div className="collab-heading"><div><span className="agent-badge">Codex · {statusName[e.run.status]}</span><h3>{task.title}</h3><small>{data.entities.find(p => p.id === task.projectId)?.name ?? '待归属'} · {task.stage || '未设阶段'}</small></div><strong>{e.bucket === 'unknown' ? '待核' : timeText(e.ms)}{e.bucket === 'nested' ? ' · 子执行' : ''}</strong></div><p>{e.run.startedAt ? localInput(e.run.startedAt).replace('T', ' ') : e.run.date} — {e.run.endedAt ? localInput(e.run.endedAt).replace('T', ' ') : e.run.status === 'running' ? '运行中' : '区间待核'}</p><SourceList run={e.run} /><div className="outcome-list">{task.outcomes.map(o => <p key={o.id}><b>{o.title}</b> · {o.version} · {outcomeName[o.state]}{o.location && <small>{o.location}</small>}</p>)}</div><div className="collab-actions"><button onClick={() => setEditing(e.run.id)}>修改执行 / 成果</button><button disabled={busy} onClick={() => void onSave({ upserts: [], deleteIds: [], collaborationChange: { deleteRunIds: [e.run.id] } }, '执行已移除，可撤销')}>移除此执行</button></div></article> })}</div>
  </div>
}
