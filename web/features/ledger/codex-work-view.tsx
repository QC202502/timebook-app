'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CodexReport, CodexMatter, CodexRun } from '@/shared/lib/codex-work'
import { timeText } from '@/shared/lib/collaboration-stats'
import type { ReportRange } from '@/shared/lib/ledger-stats'
const localTime = (ms?: number) => ms ? new Date(ms + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ') : '待核'
export function useCodexWork(range: ReportRange, enabled: boolean) {
  const [report, setReport] = useState<CodexReport | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const generation = useRef(0), active = useRef(false)
  const url = '/api/codex-work?start=' + range.start + '&end=' + range.end
  const load = useCallback(async (refresh = true) => {
    if (!enabled || active.current) return
    active.current = true; const id = generation.current; setBusy(true)
    try {
      const response = await fetch(url, refresh ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'refresh' }) } : {})
      const value = await response.json()
      if (!response.ok) throw new Error(value.error)
      if (id === generation.current) { setReport(previous => previous && previous.revision > value.revision ? previous : value); setError('') }
    } catch (e) { if (id === generation.current) setError(e instanceof Error ? e.message : '暂时无法读取Codex工作。') }
    finally { if (id === generation.current) { active.current = false; setBusy(false) } }
  }, [url, enabled])
  useEffect(() => {
    generation.current++; active.current = false; setReport(null); setError('')
    const id = generation.current
    if (enabled) void load(false).then(() => { if (id === generation.current) void load(true) })
    return () => { generation.current++; active.current = false }
  }, [load, enabled])
  useEffect(() => {
    if (!enabled) return
    const timer = setTimeout(() => { if (document.visibilityState === 'visible') void load(true) }, report?.scan.pendingFiles ? 1600 : 30000)
    return () => clearTimeout(timer)
  }, [report, error, busy, enabled, load])
  useEffect(() => {
    const focus = () => { if (document.visibilityState === 'visible') void load(true) }
    if (enabled) document.addEventListener('visibilitychange', focus)
    return () => document.removeEventListener('visibilitychange', focus)
  }, [enabled, load])
  async function mutate(body: unknown) {
    const id = generation.current
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const value = await response.json()
    if (!response.ok) throw new Error(value.error)
    if (id === generation.current) { setReport(previous => previous && previous.revision > value.revision ? previous : value); setError('') }
  }
  return { report, busy, error, load, mutate, url }
}
export type CodexState = ReturnType<typeof useCodexWork>
function Correction({ matter, runs, revision, onSave, onClose }: { matter: CodexMatter; runs: CodexRun[]; revision: number; onSave: CodexState['mutate']; onClose: () => void }) {
  const [group, setGroup] = useState(runs[0]?.group || ''), [title, setTitle] = useState(matter.title), [summary, setSummary] = useState(matter.summary), [ids, setIds] = useState(matter.runs), [error, setError] = useState(''), [saving, setSaving] = useState(false)
  return <form className="codex-correction" onSubmit={async e => {
    e.preventDefault(); setSaving(true); setError('')
    try { await onSave({ action: 'patch', revision, ids, fields: { group, title, summary } }); onClose() } catch (e) { setError(e instanceof Error ? e.message : '保存失败，输入保留。') } finally { setSaving(false) }
  }}><label>归到项目 / 事项<input aria-label="更正项目归属" required maxLength={100} value={group} onChange={e => setGroup(e.target.value)} /></label><label>事项名称<input aria-label="更正事项名称" required maxLength={100} value={title} onChange={e => setTitle(e.target.value)} /></label><label>结果摘要<textarea aria-label="更正结果摘要" required maxLength={2000} rows={4} value={summary} onChange={e => setSummary(e.target.value)} /></label>
    {runs.length > 1 && <details><summary>作用于 {ids.length} 轮执行 · 可选部分拆开</summary>{runs.map(r => <label className="check-line" key={r.id}><input type="checkbox" checked={ids.includes(r.id)} onChange={e => setIds(e.target.checked ? [...ids, r.id] : ids.filter(x => x !== r.id))} />{localTime(r.start)} · {r.id.slice(-8)}</label>)}</details>}
    {error && <p role="alert">{error}</p>}<div className="collab-actions"><button type="submit" className="primary-button" disabled={saving || !ids.length}>保存更正</button><button type="button" onClick={onClose}>取消</button></div>
  </form>
}
export function CodexWorkView({ state }: { state: CodexState }) {
  const { report, busy, error, load, mutate, url } = state
  const [selected, setSelected] = useState(''), [editing, setEditing] = useState(''), [mode, setMode] = useState<'results' | 'runs'>('results'), [showHidden, setShowHidden] = useState(false), [notice, setNotice] = useState('')
  const importRef = useRef<HTMLInputElement>(null)
  const current = report?.groups.find(g => g.name === selected) || report?.groups[0]
  const byId = new Map(report?.runs.map(r => [r.id, r]))
  const durationLabel = (ms: number, runs: CodexRun[]) => runs.some(r => r.bucket === 'known') || !runs.length ? timeText(ms) : runs.some(r => r.bucket === 'open') ? '未结算' : runs.some(r => r.bucket === 'unknown') ? '用时待核' : '子执行'
  async function hide(m: CodexMatter) {
    try { await mutate({ action: 'patch', revision: report!.revision, ids: m.runs, fields: { hidden: !m.hidden } }); setNotice(m.hidden ? '已恢复展示' : '已隐藏，累计用时仍保留') } catch (e) { setNotice(e instanceof Error ? e.message : '保存失败') }
  }
  function runsView(runs: CodexRun[]) {
    return runs.map(r => <details className="codex-run" key={r.id}><summary><span>{localTime(r.start)} → {r.end ? localTime(r.end).slice(11) : '未结束'}</span><b>{r.bucket === 'known' ? timeText(r.ms || 0) : ({ open: '未结算', nested: '子执行', unknown: '用时待核' }[r.bucket])}</b></summary><p>{r.title} · {({ completed: '执行结束', cancelled: '已中断', failed: '执行失败', open: '尚无结束事件' } as Record<string, string>)[r.status] || r.status}</p><p className="codex-receipt">{r.receipt || '暂无最终回执'}</p>{r.sourceConflict && <p role="alert">来源时间存在冲突，未计时。</p>}{r.orphanChild && <p>父子执行关系待核，暂不按父执行排重。</p>}<small>{r.sources.join('\n')}</small><small>执行编号：{r.id}</small>{typeof r.sourceDurationMs === 'number' && <small>来源原始时长 {(r.sourceDurationMs / 1000).toFixed(3)} 秒</small>}</details>)
  }
  function matterView(m: CodexMatter) {
    return <article className="codex-matter" key={m.title}><div className="collab-heading"><h3>{m.title}</h3><small>{durationLabel(m.ms, m.runs.map(id => byId.get(id)!))} · {m.runs.length} 轮</small></div><p className="codex-receipt">{m.summary}</p><div className="codex-matter-status"><span>{m.state}</span><small>{m.basis}{m.runs.some(id => byId.get(id)?.corrected) ? ' · 已更正' : ''}</small></div>
      {m.artifacts.length > 0 && <details><summary>{m.artifacts.length} 个产物入口</summary>{m.artifacts.map((a, i) => <button className="codex-artifact" key={i} title={a.path} onClick={async () => { try { await navigator.clipboard.writeText(a.path); setNotice('已复制产物路径，可在电脑中打开') } catch { setNotice(a.path) } }}>{a.label} · 复制路径</button>)}</details>}
      <details><summary>{m.runs.length} 轮执行 · 展开依据</summary>{runsView(m.runs.map(id => byId.get(id)!))}</details><div className="collab-actions"><button onClick={() => setEditing(m.title)}>更正 / 拆分</button><button onClick={() => void hide(m)}>{m.hidden ? '恢复展示' : '隐藏'}</button></div>
      {editing === m.title && <Correction key={current?.name + m.title + report?.revision} matter={m} runs={m.runs.map(id => byId.get(id)!)} revision={report!.revision} onSave={mutate} onClose={() => setEditing('')} />}
    </article>
  }
  return <div className="codex-work-view">
    {report && <div className="collab-metrics codex-two-metrics"><article><small>Codex 执行历时累计</small><strong data-testid="codex-total">{durationLabel(report.metrics.ms, report.runs)}</strong><span>独立执行分别累计</span></article><article><small>已结束执行</small><strong>{report.metrics.closed} 轮</strong><span>{report.metrics.open ? report.metrics.open + ' 轮未结算 · ' : ''}{report.metrics.unknown ? report.metrics.unknown + ' 轮用时待核 · ' : ''}{report.metrics.nested ? report.metrics.nested + ' 轮子执行单列' : '按执行编号排重'}</span></article></div>}
    <div className="codex-status"><div><button disabled={busy} onClick={() => void load(true)}>{busy ? '正在更新…' : '刷新'}</button><small>{report?.scan.updatedAt ? '更新于 ' + report.scan.updatedAt.slice(11, 19) : '准备读取本机来源'}{report?.scan.pendingFiles ? ' · ' + report.scan.pendingFiles + ' 个来源续读中' : ''}{report?.scan.partialFiles ? ' · ' + report.scan.partialFiles + ' 个来源等待完整行' : ''}</small></div><nav className="collab-tabs"><button aria-pressed={mode === 'results'} onClick={() => setMode('results')}>工作成果</button><button aria-pressed={mode === 'runs'} onClick={() => setMode('runs')}>执行明细</button></nav></div>
    {error && <p role="alert" className="collab-warning">{error}<button onClick={() => void load(true)}>重试</button></p>}{notice && <p role="status" className="collab-note">{notice}<button onClick={() => setNotice('')}> ×</button></p>}
    {report && !report.runs.length && <div className="collab-empty">{report.scan.pendingFiles ? '正在分批读取历史会话，已有结果会陆续显示。' : '当前范围尚无可显示的执行。可展开来源状态核对接入范围。'}</div>}
    {mode === 'runs' ? runsView(report?.runs || []) : current && <div className="codex-results"><nav className="codex-projects" aria-label="Codex项目与事项">{report!.groups.map(g => <button key={g.name} aria-pressed={g === current} onClick={() => { setSelected(g.name); setEditing('') }}><span>{g.name}</span><b>{durationLabel(g.ms, report!.runs.filter(r => r.group === g.name))}</b><small>{g.count} 轮 · {g.matters.length} 项</small><i><span style={{ width: (g.ms / Math.max(1, ...report!.groups.map(x => x.ms)) * 100) + '%' }} /></i></button>)}</nav><section className="collab-card codex-result-detail"><div className="collab-heading"><h2>{current.name}</h2><small>{durationLabel(current.ms, report!.runs.filter(r => r.group === current.name))}</small></div>
      {Object.keys(current.days).length > 1 && <details className="codex-days"><summary>{Object.keys(current.days).length} 天有执行 · 每日用时</summary>{Object.entries(current.days).sort().map(([day, ms]) => <div key={day}><span>{day}</span><b>{timeText(ms)}</b></div>)}</details>}
      {current.matters.filter(m => !m.routine && !m.hidden).map(matterView)}
      {current.matters.some(m => m.routine && !m.hidden) && <details><summary>例行检查与维护</summary>{current.matters.filter(m => m.routine && !m.hidden).map(matterView)}</details>}
      {current.matters.some(m => m.hidden) && <details open={showHidden} onToggle={e => setShowHidden(e.currentTarget.open)}><summary>已隐藏事项 · 保留用时</summary>{current.matters.filter(m => m.hidden).map(matterView)}</details>}
    </section></div>}
    {!!report?.memoryNotes?.length && <details className="codex-source-status"><summary>memory 线索 · {report.memoryNotes.length} 项待核</summary><p>尚未匹配到可靠的 Codex 执行标识，不计入轮数与用时。</p>{report.memoryNotes.map(m => <article key={m.title}><h3>{m.title}</h3><p>{m.summary}</p><small>memory/{m.sourceDate}.md</small></article>)}</details>}
    <details className="codex-source-status"><summary>来源与保存</summary><p>自 {report?.scan.firstDay || '配置日期'} 起，已发现 {report?.scan.files || 0} 个有更新的本机会话文件。旧聊天按新增事件续读。{report?.scan.pendingFiles ? '仍有来源未读完，当前汇总不完整。' : '已读取发现的完整日志行；缺失来源、未闭合执行与待核内容不代表没有工作。'}</p>{report?.scan.warnings.map(w => <p key={w}>{w}</p>)}{!!report?.scan.malformedLines && <p>{report.scan.malformedLines} 行来源格式异常，待核。</p>}{!!report?.scan.oversizeLines && <p>{report.scan.oversizeLines} 行超大内容跳过，可能存在未采集信息。</p>}<p>用时来自执行起止，可能包含工具等待；未结束的执行不持续加时。内容为回执摘录，执行结束不代表业务验收。</p><p>个人账本独立保存。更正和隐藏设置在本机独立保存并逐版备份；隐藏不会减少累计用时。</p><div className="collab-actions"><button onClick={async () => { try { const response = await fetch(url + '&backup=1'); if (!response.ok) throw new Error('备份失败'); const blob = new Blob([JSON.stringify(await response.json(), null, 2)], { type: 'application/json' }); const href = URL.createObjectURL(blob), a = document.createElement('a'); a.href = href; a.download = 'Codex工作更正备份.json'; a.click(); setTimeout(() => URL.revokeObjectURL(href), 5000) } catch { setNotice('备份下载失败，请重试') } }}>备份更正 JSON</button><button onClick={() => importRef.current?.click()}>恢复更正备份</button></div><input hidden type="file" accept=".json,application/json" ref={importRef} onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file || !report) return; try { if (file.size > 2 * 1024 * 1024) throw new Error('备份过大'); const backup = JSON.parse(await file.text()); if (!window.confirm('用这份备份恢复 Codex 归组和更正？当前更正会先保留备份，个人记录不受影响。')) return; await mutate({ action: 'restore', revision: report.revision, backup }); setNotice('更正已恢复') } catch (e) { setNotice(e instanceof Error ? e.message : '备份格式无效') } }} /></details>
  </div>
}
