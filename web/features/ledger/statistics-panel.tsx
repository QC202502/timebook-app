'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { activityTitle, addDays, categoryOf, clock, duration, secondaryNames, validDate, type Category, type LedgerRecord } from '@/shared/lib/ledger-v2'
import { groupKeys, periodRange, projectKey, reportCsv, shiftPeriod, summarizePeriod, type Grouping, type Period, type ReportNow } from '@/shared/lib/ledger-stats'

const periodNames = { day: '日', week: '周', month: '月' }
const groupNames = { primary: '一级分类', secondary: '二级分类', project: '项目 / 对象' }
const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`
function endpoint(minute: number) {
  const date = new Date(minute * 60000).toISOString().slice(0, 10)
  return `${shortDate(date)} ${clock(minute % 1440)}`
}

type Props = { records: LedgerRecord[]; categories: Category[]; initialDate: string; now: ReportNow; demo: boolean; loading: boolean; error: string; onRefresh: () => void; onOpenRecord: (id: string) => void }
export function StatisticsPanel({ records, categories, initialDate, now, demo, loading, error, onRefresh, onOpenRecord }: Props) {
  const [anchor, setAnchor] = useState(initialDate)
  const [period, setPeriod] = useState<Period>('week')
  const [grouping, setGrouping] = useState<Grouping>('primary')
  const [primary, setPrimary] = useState('')
  const [secondary, setSecondary] = useState('')
  const [project, setProject] = useState('')
  const [elapsedOnly, setElapsedOnly] = useState(false)
  const [sort, setSort] = useState('covered')
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const detailsRef = useRef<HTMLElement>(null)
  useEffect(() => { if (selectedGroup) detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, [selectedGroup])
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const unit = params.get('period'), dimension = params.get('group'), date = params.get('statsDate')
    if (unit === 'day' || unit === 'week' || unit === 'month') setPeriod(unit)
    if (dimension === 'primary' || dimension === 'secondary' || dimension === 'project') setGrouping(dimension)
    if (validDate(date)) setAnchor(date)
    setPrimary(params.get('statsPrimary') || ''); setSecondary(params.get('statsSecondary') || ''); setProject(params.get('statsProject') || '')
    setElapsedOnly(params.get('scope') === 'elapsed'); setReady(true)
  }, [])
  useEffect(() => {
    if (!ready) return
    const url = new URL(window.location.href)
    for (const [key, value] of Object.entries({ period, group: grouping, statsDate: anchor, statsPrimary: primary, statsSecondary: secondary, statsProject: project, scope: elapsedOnly ? 'elapsed' : 'all' })) {
      if (value) url.searchParams.set(key, value); else url.searchParams.delete(key)
    }
    window.history.replaceState(null, '', url)
  }, [ready, period, grouping, anchor, primary, secondary, project, elapsedOnly])
  useEffect(() => { setSelectedGroup(null) }, [anchor, period, grouping, primary, secondary, project, elapsedOnly, demo])
  useEffect(() => {
    if (!ready || loading) return
    if (primary && !categories.some(c => c.id === primary)) { setPrimary(''); setSecondary('') }
    if (secondary && !categories.some(c => c.id + ':unset' === secondary || c.children.some(s => s.id === secondary))) setSecondary('')
    if (project && !records.some(r => projectKey(r.project) === project)) setProject('')
  }, [ready, loading, categories, records, primary, secondary, project])

  const range = useMemo(() => periodRange(anchor, period), [anchor, period])
  const report = useMemo(() => summarizePeriod(records, categories, range, { primary, secondary, project }, now, elapsedOnly), [records, categories, range, primary, secondary, project, now, elapsedOnly])
  const groups = useMemo(() => {
    const rows = [...(grouping === 'primary' ? report.primary : grouping === 'secondary' ? report.secondary : report.projects)]
    if (sort !== 'order') rows.sort((a, b) => (sort === 'total' ? b.total - a.total : b.covered - a.covered) || b.total - a.total)
    return rows
  }, [report, grouping, sort])
  const projectOptions = useMemo(() => [...new Map(records.map(r => [projectKey(r.project), r.project.trim() || '未填写项目 / 对象'])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'zh-CN')), [records])
  const selected = groups.find(g => g.key === selectedGroup)
  const details = selected ? report.entries.filter(e => groupKeys(e.record, grouping).includes(selected.key)) : []
  const maxDay = Math.max(1, ...report.days.map(d => d.total))
  const maxGroup = Math.max(1, ...groups.map(g => g.total))
  const hasFilter = !!(primary || secondary || project)
  const scopeText = elapsedOnly ? `仅截至 ${now.date} ${clock(now.minute)}` : '全部已录入时段（含提前记录）'
  const rangeTitle = period === 'month' ? `${anchor.slice(0, 4)} 年 ${Number(anchor.slice(5, 7))} 月` : period === 'day' ? anchor.replaceAll('-', '.') : `${range.start.replaceAll('-', '.')} — ${addDays(range.end, -1).replaceAll('-', '.')}`
  function exportReport() {
    const filterText = [scopeText, ...(grouping === 'secondary' ? ['多选动作按关联训练时段计入；组间覆盖和累计不可相加，合计按原记录计算'] : []), `维度：${groupNames[grouping]}`, `一级：${categories.find(c => c.id === primary)?.name || '全部'}`, `二级：${categories.flatMap(c => [...c.children, { id: c.id + ':unset', name: c.name + ' / 未设二级' }]).find(c => c.id === secondary)?.name || '全部'}`, `项目/对象：${projectOptions.find(([key]) => key === project)?.[1] || '全部'}`].join('；')
    const url = URL.createObjectURL(new Blob([reportCsv(range, groups, report, filterText)], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = `时间统计-${demo ? '示例-' : ''}${range.start}-${addDays(range.end, -1)}-${groupNames[grouping].replaceAll(' / ', '-')}.csv`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <section className="statistics-panel" aria-label="时间统计">
    <div className="report-toolbar">
      <div className="report-periods" aria-label="统计周期">{(['day', 'week', 'month'] as const).map(value => <button key={value} aria-pressed={period === value} className={period === value ? 'active' : ''} onClick={() => setPeriod(value)}>{periodNames[value]}统计</button>)}</div>
      <div className="report-navigation">
        <button aria-label={`上一${periodNames[period]}`} disabled={!validDate(shiftPeriod(anchor, period, -1))} onClick={() => setAnchor(shiftPeriod(anchor, period, -1))}>‹</button>
        <label className="report-date"><strong>{rangeTitle}</strong><input type="date" aria-label="统计基准日期" value={anchor} min="2000-01-01" max="2099-12-31" onChange={e => { if (validDate(e.target.value)) setAnchor(e.target.value) }} /></label>
        <button aria-label={`下一${periodNames[period]}`} disabled={!validDate(shiftPeriod(anchor, period, 1))} onClick={() => setAnchor(shiftPeriod(anchor, period, 1))}>›</button>
        <button className="report-current" onClick={() => setAnchor(now.date)}>{period === 'day' ? '今天' : `本${periodNames[period]}`}</button>
      </div>
      <button className="soft-button" disabled={!ready || loading} onClick={exportReport}>导出统计 CSV ↗</button>
    </div>
    <div className="report-filters">
      <label>一级分类<select aria-label="统计一级分类筛选" value={primary} onChange={e => { setPrimary(e.target.value); setSecondary('') }}><option value="">全部一级分类</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}{c.archived ? '（归档）' : ''}</option>)}</select></label>
      <label>二级分类<select aria-label="统计二级分类筛选" value={secondary} onChange={e => setSecondary(e.target.value)}><option value="">全部二级分类</option>{categories.filter(c => !primary || c.id === primary).map(c => <optgroup key={c.id} label={c.name}>{c.children.map(child => <option key={child.id} value={child.id}>{child.name}{child.archived ? '（归档）' : ''}</option>)}<option value={c.id + ':unset'}>未设二级 · {c.name}</option></optgroup>)}</select></label>
      <label>项目 / 对象<select aria-label="统计项目对象筛选" value={project} onChange={e => setProject(e.target.value)}><option value="">全部项目 / 对象</option>{projectOptions.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <label className="report-scope"><input type="checkbox" checked={elapsedOnly} onChange={e => setElapsedOnly(e.target.checked)} />仅截至现在</label>
      {hasFilter && <button className="report-clear" onClick={() => { setPrimary(''); setSecondary(''); setProject('') }}>清除筛选</button>}
    </div>
    <p className="report-scope-note">北京时间 · {period === 'week' ? '周一至周日' : period === 'month' ? '自然月' : '自然日'} · {hasFilter ? '当前筛选范围' : '全部活动'} · {scopeText}{!demo && report.futureCount > 0 ? `；本期有 ${report.futureCount} 条含未来时段` : ''}</p>
    {error && <div className="error-message" role="alert">{error}<button onClick={onRefresh}>重新读取账本</button></div>}
    {!ready || loading ? <div className="report-loading" role="status">正在读取账本…</div> : <>
      <div className="report-metrics" aria-label="所选周期统计">
        <article className="report-metric coverage"><p>已记录覆盖时长</p><strong data-testid="report-covered">{duration(report.covered)}</strong><small>{report.covered} 分钟 · 同一分钟只计一次</small></article>
        <article className="report-metric cumulative"><p>活动累计时长</p><strong data-testid="report-total">{duration(report.total)}</strong><small>{report.total} 分钟 · 并行活动分别累计</small></article>
        <article className="report-metric parallel"><p>其中并行时段</p><strong data-testid="report-parallel">{duration(report.parallel)}</strong><small>{report.parallel} 分钟 · 同时两件或三件事</small></article>
        <article className="report-metric report-count"><p>本期记录</p><strong>{report.count}<span> 条</span></strong><small>{report.recordedDays} / {report.days.length} 天有记录{demo ? ' · 示例数据' : ''}</small></article>
      </div>
      <p className="report-explanation">走路时听书 30 分钟：覆盖 30 分钟，活动累计 60 分钟。覆盖按已填写的区间计算；提前记录不代表活动已经发生。</p>
      <section className="report-trend" aria-label="每日用时趋势">
        <div className="report-section-heading"><div><p className="eyebrow">DAY BY DAY</p><h2>每天的投入</h2></div><div className="report-legend"><span><i className="coverage-key" />已记录覆盖</span><span><i className="total-key" />活动累计</span></div></div>
        <div className="report-chart-scroll"><div className={`report-chart report-chart--${period}`} style={{ gridTemplateColumns: `repeat(${report.days.length}, minmax(24px, 1fr))` }}>{report.days.map(day => <button key={day.date} className={`report-chart-day${day.date === now.date ? ' is-today' : ''}`} aria-label={`${day.date}：覆盖 ${day.covered} 分钟，累计 ${day.total} 分钟，查看当天`} title={`${day.date}\n覆盖 ${duration(day.covered)} · 累计 ${duration(day.total)}\n点击查看当天`} onClick={() => { setAnchor(day.date); setPeriod('day') }}><div className="report-chart-bars"><i className="coverage-bar" style={{ height: `${day.covered / maxDay * 100}%` }} /><i className="total-bar" style={{ height: `${day.total / maxDay * 100}%` }} /></div><span>{period === 'month' ? Number(day.date.slice(8)) : shortDate(day.date)}</span></button>)}</div></div>
        <p className="report-chart-hint">纵轴同一比例，最高累计 {duration(maxDay === 1 && report.total === 0 ? 0 : maxDay)} · 点击日期查看当天；空白表示尚无记录。</p>
      </section>
      <section className="report-breakdown">
        <div className="report-section-heading"><div><p className="eyebrow">WHERE TIME GOES</p><h2>时间花在哪里</h2></div><label className="report-sort">排序<select aria-label="统计排序" value={sort} onChange={e => setSort(e.target.value)}><option value="covered">覆盖时长最多</option><option value="total">活动累计最多</option><option value="order">分类 / 名称顺序</option></select></label></div>
        <div className="report-grouping" aria-label="统计维度">{(['primary', 'secondary', 'project'] as const).map(value => <button key={value} aria-pressed={grouping === value} className={grouping === value ? 'active' : ''} onClick={() => setGrouping(value)}>{groupNames[value]}</button>)}</div>
        <div className="table-scroll"><table className="statistics-table"><thead><tr><th>{groupNames[grouping]}</th><th>已记录覆盖</th><th>活动累计</th><th>并行时段</th><th>记录</th></tr></thead><tbody>{groups.map(group => <tr key={group.key} className={selectedGroup === group.key ? 'report-selected' : ''}><td><button className="report-group-name" aria-label={`查看${groupNames[grouping]} ${group.parentName ? group.parentName + ' / ' : ''}${group.name}的记录`} aria-expanded={selectedGroup === group.key} onClick={() => setSelectedGroup(selectedGroup === group.key ? null : group.key)}><i style={{ background: group.color }} /><span>{group.parentName && <small>{group.parentName} / </small>}{group.name}{group.archived && <em>归档</em>}</span><b>↗</b></button><div className="report-group-bars" aria-hidden="true"><i className="coverage-bar" style={{ width: `${group.covered / maxGroup * 100}%` }} /><i className="total-bar" style={{ width: `${group.total / maxGroup * 100}%` }} /></div></td><td title={`${group.covered} 分钟`}>{duration(group.covered)}</td><td title={`${group.total} 分钟`}>{duration(group.total)}</td><td>{duration(group.parallel)}</td><td>{group.count} 条</td></tr>)}</tbody></table></div>
        {!groups.length && <div className="report-empty"><h3>这个范围还没有记录</h3><p>{hasFilter ? '可以清除筛选，或查看其他周期。' : '选择其他日期，或回到时间轴记录一段时间。'}</p></div>}
        <p className="report-table-note">每组覆盖独立去重，组间可能同时发生，不能把各组覆盖直接相加。父分类按原记录重新计算。{grouping === 'secondary' ? '多选动作显示关联的整段训练用时，并非单个动作实耗，各动作的覆盖和累计均不能直接相加。' : '每条活动在当前维度只归入一组，累计时长可相加。'}并行时段也按当前分组内的活动计算。</p>
      </section>
      {selected && <section className="report-details" ref={detailsRef} aria-label="分组记录明细"><div className="report-section-heading"><div><p className="eyebrow">TRACE THE RECORDS</p><h2>{selected.parentName ? `${selected.parentName} / ` : ''}{selected.name}</h2><p>覆盖 {duration(selected.covered)} · 累计 {duration(selected.total)} · {selected.count} 条记录</p></div><button aria-label="关闭分组明细" onClick={() => setSelectedGroup(null)}>×</button></div><div className="table-scroll"><table className="statistics-table"><thead><tr><th>本期内时间</th><th>活动</th><th>分类</th><th>项目 / 对象</th><th>计入本期</th><th /></tr></thead><tbody>{details.map(({ record, start, end }) => <tr key={record.id}><td className="mono">{endpoint(start)} — {endpoint(end)}</td><td>{activityTitle(record, categories)}{record.stage && record.activitySource !== 'category' && <small className="record-secondary">制作阶段 · {record.stage}</small>}</td><td>{categoryOf(record.category, categories).name}<small className="record-secondary">{secondaryNames(record, categories) || '未设二级'}</small></td><td>{record.project.trim() || '未填写'}</td><td>{duration(end - start)}</td><td><button aria-label={`打开原记录 ${activityTitle(record, categories)} ${record.date} ${clock(record.start)}`} onClick={() => onOpenRecord(record.id)}>查看 / 编辑 ↗</button></td></tr>)}</tbody></table></div><p className="report-table-note">这里只显示落在本期内的时间；查看原记录会保留完整起止，不会按统计周期拆分保存。</p></section>}
    </>}
  </section>
}
