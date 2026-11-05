'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { activityTitle, addDays, clock, duration, secondaryNames, validDate, type Category, type LedgerRecord } from '@/shared/lib/ledger-v2'
import { groupKeys, periodRange, projectKey, reportCsv, shiftPeriod, summarizePeriod, type Grouping, type Period, type ReportNow } from '@/shared/lib/ledger-stats'
import { agentSummary, contextSummary, dayStartMs, humanSegments, projectSummary, timeText } from '@/shared/lib/collaboration-stats'
import { deriveStatistics, activeProjects, objectSummary } from '@/shared/lib/automatic-statistics'
import type { Collaboration } from '@/shared/lib/collaboration'
import { CatalogManager, type SaveChange } from './catalog-manager'
import { ProjectStatistics, ObjectStatistics } from './project-statistics'
import { AgentWorkspace } from './agent-workspace'
import { CodexWorkView, useCodexWork } from './codex-work-view'
import { codexCsv, withCodexProjects } from '@/shared/lib/codex-work'

const views = { life: '我的时间', projects: '项目推进', objects: '书籍与人物', agents: 'Codex工作' } as const
type View = keyof typeof views
const names = { day: '日', week: '周', month: '月' }
const short = (date: string) => Number(date.slice(5, 7)) + '/' + Number(date.slice(8, 10))
const groupNames = { primary: '一级分类', secondary: '二级分类', project: '原项目 / 对象' }
type Props = { records: LedgerRecord[]; categories: Category[]; data: Collaboration; initialDate: string; now: ReportNow; demo: boolean; loading: boolean; busy: boolean; error: string; onRefresh: () => void; onOpenRecord: (id: string) => void; onSave: SaveChange }
export function StatisticsPanel({ records, categories, data, initialDate, now, demo, loading, busy, error, onRefresh, onOpenRecord, onSave }: Props) {
  const [anchor, setAnchor] = useState(initialDate), [period, setPeriod] = useState<Period>('week'), [view, setView] = useState<View>('life'), [elapsed, setElapsed] = useState(false), [ready, setReady] = useState(false)
  const [grouping, setGrouping] = useState<Grouping>('primary'), [primary, setPrimary] = useState(''), [secondary, setSecondary] = useState(''), [project, setProject] = useState(''), [selected, setSelected] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false), filterRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!filtersOpen) return
    const outside = (e: PointerEvent) => { if (!filterRef.current?.contains(e.target as Node)) setFiltersOpen(false) }
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { setFiltersOpen(false); filterRef.current?.querySelector('button')?.focus() } }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [filtersOpen])
  useEffect(() => {
    const params = new URLSearchParams(window.location.search), p = params.get('period'), g = params.get('group'), v = params.get('perspective'), d = params.get('statsDate')
    if (p === 'day' || p === 'week' || p === 'month') setPeriod(p)
    if (g === 'primary' || g === 'secondary' || g === 'project') setGrouping(g)
    if (v && v in views) setView(v as View)
    if (validDate(d)) setAnchor(d)
    setPrimary(params.get('statsPrimary') || ''); setSecondary(params.get('statsSecondary') || ''); setProject(params.get('statsProject') || ''); setElapsed(params.get('scope') === 'elapsed'); setReady(true)
  }, [])
  useEffect(() => {
    if (!ready) return
    const url = new URL(window.location.href)
    for (const [key, value] of Object.entries({ period, group: grouping, perspective: view, statsDate: anchor, statsPrimary: primary, statsSecondary: secondary, statsProject: project, scope: elapsed ? 'elapsed' : 'all' })) value ? url.searchParams.set(key, value) : url.searchParams.delete(key)
    window.history.replaceState(null, '', url)
  }, [ready, period, grouping, view, anchor, primary, secondary, project, elapsed])
  const range = useMemo(() => periodRange(anchor, period), [anchor, period])
  const codex = useCodexWork(range, ready && !demo && (view === 'agents' || view === 'projects'))
  const segments = useMemo(() => humanSegments(records), [records])
  const report = useMemo(() => summarizePeriod(segments, categories, range, { primary, secondary, project }, now, elapsed), [segments, categories, range, primary, secondary, project, now, elapsed])
  const groups = [...(grouping === 'primary' ? report.primary : grouping === 'secondary' ? report.secondary : report.projects)].sort((a, b) => b.covered - a.covered || b.total - a.total)
  const chosen = groups.find(g => g.key === selected), entries = chosen ? report.entries.filter(e => groupKeys(e.record, grouping).includes(chosen.key)) : []
  const oldCount = new Set(report.entries.filter(e => !e.record.context || e.record.context.executor === 'legacy').map(e => e.record.id)).size
  const allProjects = [...new Map(records.map(r => [projectKey(r.project), r.project.trim() || '未填写'])).entries()]
  const nowMs = dayStartMs(now.date) + now.minute * 60000
  const automatic = useMemo(() => deriveStatistics(data, records, categories), [data, records, categories])
  const codexProjects = useMemo(() => withCodexProjects(automatic.data, codex.report), [automatic.data, codex.report])
  const scopeRecordIds = new Set(summarizePeriod(segments, categories, range, {}, now, elapsed).entries.map(e => e.record.id))
  const shared = { data: codexProjects.data, savedData: data, records: automatic.records, inferred: automatic.inferred, virtualIds: new Set([...automatic.virtualIds, ...codexProjects.virtualIds]), codexReport: codex.report, categories, range, now, elapsed, period, onSave, busy, onOpenRecord }
  const filtered = !!(primary || secondary || project)
  const filterCount = [primary, secondary, project].filter(Boolean).length
  const dayScale = Math.max(1, ...report.days.map(d => d.total))
  const scope = elapsed ? '仅截至 ' + now.date + ' ' + clock(now.minute) : '含提前填写的完整时段'
  const title = period === 'month' ? anchor.slice(0, 4) + ' 年 ' + Number(anchor.slice(5, 7)) + ' 月' : period === 'day' ? anchor : range.start + ' — ' + addDays(range.end, -1)
  function exportCurrent() {
    const escape = (x: unknown) => '"' + String(x ?? '').replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""') + '"'
    let csv: string
    if (view === 'agents' && !demo && codex.report) csv = codexCsv(codex.report)
    else if (view === 'life') csv = reportCsv(range, groups, report, scope + '；' + groupNames[grouping] + (oldCount ? '；含执行者未区分历史' : '') + (grouping === 'secondary' ? '；多选动作关联时段不可相加' : ''))
    else {
      const meta = [range.start, addDays(range.end, -1), scope]
      let rows: unknown[][]
      if (view === 'projects') rows = [['起始', '结束', '范围', '项目', '记录覆盖分钟', '记录累计分钟', '记录条数', '本人去重分钟', '原口径分钟', 'Codex明确分钟', 'Codex估计分钟', '用时待核条数'], ...activeProjects(codexProjects.data, automatic.records, range, now, elapsed).map(p => [...meta, p.entity.name, p.human.covered, p.human.total, p.human.count, p.human.humanMinutes, p.human.legacyMinutes, p.agent.knownMs / 60000, p.agent.estimatedMs / 60000, p.agent.unknownCount])]
      else if (view === 'agents') rows = [['起始', '结束', '范围', '任务', '执行唯一标识', '状态', '计时状态', '分钟', '来源'], ...agentSummary(data.runs, range, nowMs, elapsed).entries.map(e => [...meta, data.tasks.find(t => t.id === e.run.taskId)?.title, e.run.sourceKey, e.run.status, e.bucket, e.bucket === 'unknown' ? '' : e.ms / 60000, e.run.sources.map(s => s.kind + ':' + s.locator).join(' | ')])]
      else rows = [['起始', '结束', '范围', '类型', '对象', '阅读或共同参与分钟', '全部关联分钟'], ...objectSummary(automatic.data, automatic.records, range, now, elapsed).map(r => [...meta, r.entity.kind, r.entity.name, r.actual.covered, r.all.covered])]
      csv = '\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\r\n')
    }
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), a = document.createElement('a')
    a.href = url; a.download = '时间统计-' + views[view] + '-' + range.start + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section className="statistics-panel collab-statistics" aria-label="时间统计">
    <div className="statistics-controls" aria-label="统计工具栏">
      <nav className="collab-tabs statistics-views" aria-label="统计视角">{Object.entries(views).map(([v, label]) => <button key={v} aria-pressed={view === v} onClick={() => { setView(v as View); setFiltersOpen(false) }}>{label}</button>)}</nav>
      <div className="report-periods" aria-label="统计周期">{(['day', 'week', 'month'] as const).map(p => <button key={p} aria-label={names[p] + '统计'} title={names[p] + '统计'} aria-pressed={period === p} className={period === p ? 'active' : ''} onClick={() => { setPeriod(p); setSelected('') }}>{names[p]}</button>)}</div>
      <div className="report-navigation"><button aria-label={'上一' + names[period]} disabled={!validDate(shiftPeriod(anchor, period, -1))} onClick={() => setAnchor(shiftPeriod(anchor, period, -1))}>‹</button><label className="report-date"><strong title={title}>{period === 'week' ? range.start.slice(0, 4) + '/' + short(range.start) + '—' + short(addDays(range.end, -1)) : title}</strong><input aria-label="统计基准日期" type="date" min="2000-01-01" max="2099-12-31" value={anchor} onChange={e => { if (validDate(e.target.value)) setAnchor(e.target.value) }} /></label><button aria-label={'下一' + names[period]} disabled={!validDate(shiftPeriod(anchor, period, 1))} onClick={() => setAnchor(shiftPeriod(anchor, period, 1))}>›</button><button className="report-current" onClick={() => setAnchor(now.date)}>{period === 'day' ? '今天' : '本' + names[period]}</button></div>
      {view === 'life' && <div className="statistics-filter" ref={filterRef}><button className={'filter-toggle' + (filtered ? ' is-filtered' : '')} aria-label="分类与项目筛选" aria-expanded={filtersOpen} aria-controls="statistics-filter-panel" onClick={() => setFiltersOpen(!filtersOpen)}>{filtered ? '筛选 · ' + filterCount : '全部分类'} <span aria-hidden="true">⌄</span></button>{filtersOpen && <div className="statistics-filter-panel" id="statistics-filter-panel" role="region" aria-label="分类筛选"><div className="filter-panel-heading"><strong>筛选范围</strong><button onClick={() => setFiltersOpen(false)} aria-label="关闭筛选">×</button></div>
      <div className="report-filters"><label>一级分类<select autoFocus aria-label="统计一级分类筛选" value={primary} onChange={e => { setPrimary(e.target.value); setSecondary(''); setSelected('') }}><option value="">全部一级分类</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>二级分类<select aria-label="统计二级分类筛选" value={secondary} onChange={e => { setSecondary(e.target.value); setSelected('') }}><option value="">全部二级分类</option>{categories.filter(c => !primary || c.id === primary).map(c => <optgroup key={c.id} label={c.name}>{c.children.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}<option value={c.id + ':unset'}>未设二级</option></optgroup>)}</select></label><label>原项目 / 对象<select aria-label="统计项目对象筛选" value={project} onChange={e => setProject(e.target.value)}><option value="">全部原文字</option>{allProjects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>{filtered && <button onClick={() => { setPrimary(''); setSecondary(''); setProject(''); setSelected('') }}>清除筛选</button>}</div>
      <button className="filter-done" onClick={() => setFiltersOpen(false)}>完成</button></div>}</div>}
      <label className="check-line statistics-scope"><input aria-label="仅截至现在" type="checkbox" checked={elapsed} onChange={e => setElapsed(e.target.checked)} />截至现在</label>
      {demo && <small className="statistics-demo">示例</small>}
      <button className="statistics-export" aria-label="导出统计 CSV ↗" title="导出统计 CSV" disabled={loading || !ready || (view === 'agents' && !demo && !codex.report)} onClick={exportCurrent}>CSV ↗</button>
    </div>
    {error && <div className="error-message" role="alert">{error}<button onClick={onRefresh}>重新读取账本</button></div>}
    {loading || !ready ? <div role="status" className="collab-empty">正在读取账本…</div> : <>
    {view === 'life' && <>

      <div className="collab-metrics"><article><small>已记录覆盖</small><strong data-testid="report-covered">{duration(report.covered)}</strong><span>同一分钟只计一次 · 含睡眠与生活</span></article><article><small>活动累计</small><strong data-testid="report-total">{duration(report.total)}</strong><span>每件事分别计时 · {report.count} 条记录</span></article><article><small>其中并行时段</small><strong data-testid="report-parallel">{duration(report.parallel)}</strong><span>同时两件或三件事 · {report.recordedDays} 天有记录</span></article></div>
      <div className={'life-breakdown' + (period === 'day' ? ' life-breakdown--day' : '')}>
      <section className="collab-card category-ranks"><div className="collab-heading"><h2>时间花在哪里</h2><small>按覆盖时长排序</small></div><div className="collab-tabs compact">{(['primary', 'secondary', 'project'] as const).map(g => <button key={g} aria-pressed={grouping === g} onClick={() => { setGrouping(g); setSelected('') }}>{groupNames[g]}</button>)}</div>{groups.length ? groups.map(g => <button className={'rank-row' + (selected === g.key ? ' selected' : '')} key={g.key} onClick={() => setSelected(selected === g.key ? '' : g.key)}><span>{g.parentName && <small>{g.parentName}</small>}{g.name}</span><i><b style={{ width: g.covered / Math.max(1, ...groups.map(x => x.covered)) * 100 + '%', background: g.color }} /></i><strong>{duration(g.covered)}</strong></button>) : <div className="collab-empty">这个范围还没有记录。</div>}<p className="collab-note">{grouping === 'secondary' ? '多选动作关联整段训练，不表示每个动作各做了整段；各组不可相加。' : '各分类可能并行，分类小计不可直接相加。点击横条查看明细。'}</p></section>
      {period !== 'day' && <section className="collab-card daily-comparison"><div className="collab-heading"><h2>每日用时</h2><div className="daily-legend"><span><i />覆盖</span><span><i />累计</span></div></div><div className={period === 'month' ? 'daily-calendar' : 'daily-rows'}>
        {period === 'month' && ['一', '二', '三', '四', '五', '六', '日'].map(d => <small className="calendar-weekday" key={d}>{d}</small>)}{period === 'month' && Array.from({ length: (new Date(range.start + 'T00:00:00Z').getUTCDay() + 6) % 7 }, (_, i) => <span key={'pad-' + i} />)}
        {report.days.map(day => <button className={'daily-usage' + (!day.count ? ' is-empty' : '')} key={day.date} aria-label={day.date + '，覆盖 ' + duration(day.covered) + '，累计 ' + duration(day.total)} title={day.date + ' · 覆盖 ' + duration(day.covered) + ' · 累计 ' + duration(day.total)} onClick={() => { setAnchor(day.date); setPeriod('day'); setSelected('') }}><b>{period === 'month' ? Number(day.date.slice(8)) : short(day.date)}</b><span className="daily-bars"><i><i style={{ width: day.covered / dayScale * 100 + '%' }} /></i><i><i style={{ width: day.total / dayScale * 100 + '%' }} /></i></span><small>{!day.count ? day.date > now.date ? '未到' : '暂无记录' : duration(day.covered)}</small></button>)}
      </div></section>}
</div>
      {(oldCount > 0 || report.futureCount > 0) && <p className="collab-note">{oldCount > 0 ? '含 ' + oldCount + ' 条执行者未区分的历史记录，沿用原口径；不能直接称为本人净投入。' : ''}{report.futureCount > 0 ? ' 本期 ' + report.futureCount + ' 条含未来时段。' : ''}</p>}
      {chosen && <section className="collab-card report-details"><div className="collab-heading"><div><h2>{chosen.name}</h2><p>覆盖 {duration(chosen.covered)} · 累计 {duration(chosen.total)} · 并行 {duration(chosen.parallel)}</p></div>{grouping === 'primary' && <button onClick={() => { setPrimary(chosen.key); setGrouping('secondary'); setSelected('') }}>查看二级分类 ↗</button>}</div><div className="table-wrap"><table className="statistics-table"><thead><tr><th>时间</th><th>活动</th><th>分类</th><th>原项目 / 对象</th><th>本期分钟</th><th /></tr></thead><tbody>{entries.map((e, i) => <tr key={e.record.id + ':' + i}><td>{new Date(e.start * 60000).toISOString().slice(0, 10)}<small>{clock(e.start % 1440)}—{short(new Date(e.end * 60000).toISOString().slice(0, 10))} {clock(e.end % 1440)}</small></td><td>{activityTitle(e.record, categories)}</td><td>{secondaryNames(e.record, categories) || categories.find(c => c.id === e.record.category)?.name}</td><td>{e.record.project || '—'}</td><td>{e.end - e.start}</td><td><button onClick={() => onOpenRecord(e.record.id)}>查看原记录 ↗</button></td></tr>)}</tbody></table></div><p className="collab-note">这里按统计边界裁剪，原记录的起止时间不变。</p></section>}
    </>}
    {view === 'projects' && <ProjectStatistics {...shared} />}
    {view === 'objects' && <ObjectStatistics {...shared} />}
    {view === 'agents' && (demo ? <AgentWorkspace data={data} records={records} categories={categories} range={range} nowMs={nowMs} elapsed={elapsed} date={anchor} onSave={onSave} busy={busy} demo={demo} /> : <><CodexWorkView state={codex} /><details className="optional-review"><summary>手动补录与原有导入记录</summary><AgentWorkspace data={{ ...data, runs: data.runs.filter(r => !codex.report?.runs.some(a => 'codex-turn:' + a.id === r.sourceKey)) }} records={records} categories={categories} range={range} nowMs={nowMs} elapsed={elapsed} date={anchor} onSave={onSave} busy={busy} demo={demo} /></details></>)}
    {(view === 'projects' || view === 'objects') && <details className="automatic-sources"><summary>汇总依据与未识别对象</summary><p>按记录中的项目文字、二级分类、读听内容和明确人物整理；手动关联优先。仅影响当前展示，不改历史记录。需要调整时可点明细回到原记录。</p>{automatic.unresolved.filter(item => scopeRecordIds.has(item.recordId)).length > 0 ? <div className="unresolved-objects">{automatic.unresolved.filter(item => scopeRecordIds.has(item.recordId)).map(item => <button key={item.recordId} onClick={() => onOpenRecord(item.recordId)}>{item.text} <small>查看原记录 ↗</small></button>)}</div> : <small>本期没有未识别的原对象文字。</small>}</details>}
    {view !== 'life' && <details className="statistics-advanced"><summary>高级设置 · 手动档案与历史关联</summary><p>自动汇总无需填写。只有需要更正归属、保存项目下一步或登记 Codex 任务时，再维护独立档案。</p><CatalogManager data={data} records={records} onSave={onSave} busy={busy} /></details>}
    </>}
  </section>
}
