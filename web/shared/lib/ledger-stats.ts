import { addDays, secondaryIdsOf, type Category, type LedgerRecord } from './ledger-v2.ts'

export type Period = 'day' | 'week' | 'month'
export type Grouping = 'primary' | 'secondary' | 'project'
export type ReportRange = { start: string; end: string }
export type ReportFilters = { primary?: string; secondary?: string; project?: string }
export type ReportNow = { date: string; minute: number }
export type ReportEntry = { record: LedgerRecord; start: number; end: number }
export type TimeMetrics = { covered: number; total: number; parallel: number; count: number }
export type ReportGroup = TimeMetrics & { key: string; name: string; parentName?: string; color: string; archived: boolean }
const midnight = (date: string) => Date.parse(date + 'T00:00:00Z') / 60000
const iso = (date: Date) => date.toISOString().slice(0, 10)

export function periodRange(anchor: string, period: Period): ReportRange {
  const date = new Date(anchor + 'T00:00:00Z')
  if (period === 'week') {
    const start = addDays(anchor, -((date.getUTCDay() + 6) % 7))
    return { start, end: addDays(start, 7) }
  }
  if (period === 'month') return { start: iso(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))), end: iso(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))) }
  return { start: anchor, end: addDays(anchor, 1) }
}
export function shiftPeriod(anchor: string, period: Period, direction: number) {
  if (period !== 'month') return addDays(anchor, direction * (period === 'week' ? 7 : 1))
  const date = new Date(anchor + 'T00:00:00Z')
  return iso(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + direction, 1)))
}
export const projectKey = (project: string) => 'project:' + JSON.stringify(project.trim() || null)
export function groupKeys(record: LedgerRecord, grouping: Grouping): string[] {
  const ids = secondaryIdsOf(record)
  return grouping === 'primary' ? [record.category] : grouping === 'secondary' ? (ids.length ? ids : [record.category + ':unset']) : [projectKey(record.project)]
}

function measure(entries: ReportEntry[]): TimeMetrics {
  const events = new Map<number, number>()
  let total = 0
  for (const entry of entries) {
    total += entry.end - entry.start
    events.set(entry.start, (events.get(entry.start) ?? 0) + 1)
    events.set(entry.end, (events.get(entry.end) ?? 0) - 1)
  }
  let active = 0, previous = 0, covered = 0, parallel = 0
  for (const minute of [...events.keys()].sort((a, b) => a - b)) {
    if (active > 0) covered += minute - previous
    if (active > 1) parallel += minute - previous
    active += events.get(minute)!
    previous = minute
  }
  return { covered, total, parallel, count: new Set(entries.map(e => e.record.id)).size }
}

export function summarizePeriod(records: LedgerRecord[], categories: Category[], range: ReportRange, filters: ReportFilters = {}, now?: ReportNow, elapsedOnly = false) {
  const lower = midnight(range.start), rangeEnd = midnight(range.end)
  const nowMinute = now ? midnight(now.date) + now.minute : Infinity
  const upper = elapsedOnly ? Math.min(rangeEnd, nowMinute) : rangeEnd
  const entries: ReportEntry[] = []
  for (const record of records) {
    if (filters.primary && record.category !== filters.primary) continue
    if (filters.secondary && !groupKeys(record, 'secondary').includes(filters.secondary)) continue
    if (filters.project && projectKey(record.project) !== filters.project) continue
    const origin = midnight(record.date)
    const start = Math.max(lower, origin + record.start), end = Math.min(upper, origin + record.end)
    if (end > start) entries.push({ record, start, end })
  }
  entries.sort((a, b) => a.start - b.start || a.end - b.end || a.record.id.localeCompare(b.record.id))
  const buckets: Record<Grouping, Map<string, ReportEntry[]>> = { primary: new Map(), secondary: new Map(), project: new Map() }
  for (const entry of entries) for (const grouping of ['primary', 'secondary', 'project'] as const) {
    for (const key of groupKeys(entry.record, grouping)) {
      const bucket = buckets[grouping].get(key) ?? []
      bucket.push(entry); buckets[grouping].set(key, bucket)
    }
  }
  const primary: ReportGroup[] = [], secondary: ReportGroup[] = [], projects: ReportGroup[] = []
  for (const category of categories) {
    const rows = buckets.primary.get(category.id)
    if (rows) primary.push({ key: category.id, name: category.name, color: category.color, archived: category.archived, ...measure(rows) })
    for (const child of [...category.children, { id: category.id + ':unset', name: '未设二级', archived: false }]) {
      const children = buckets.secondary.get(child.id)
      if (children) secondary.push({ key: child.id, name: child.name, parentName: category.name, color: category.color, archived: child.archived || category.archived, ...measure(children) })
    }
  }
  for (const [key, rows] of buckets.project) projects.push({ key, name: rows[0].record.project.trim() || '未填写项目 / 对象', color: '#708c72', archived: false, ...measure(rows) })
  projects.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  const days: Array<TimeMetrics & { date: string }> = []
  for (let day = range.start; day < range.end; day = addDays(day, 1)) {
    const start = midnight(day), end = start + 1440
    const rows = entries.filter(e => e.start < end && e.end > start).map(e => ({ ...e, start: Math.max(e.start, start), end: Math.min(e.end, end) }))
    days.push({ date: day, ...measure(rows) })
  }
  return { ...measure(entries), entries, primary, secondary, projects, days, recordedDays: days.filter(d => d.count > 0).length, futureCount: entries.filter(e => e.end > nowMinute).length }
}

export function reportCsv(range: ReportRange, groups: ReportGroup[], summary: TimeMetrics, scope: string) {
  const cell = (value: string | number) => {
    let text = String(value)
    if (/^[=+@\-\t\r]/.test(text)) text = "'" + text
    return '"' + text.replaceAll('"', '""') + '"'
  }
  const row = (name: string, parent: string, metrics: TimeMetrics) => [range.start, addDays(range.end, -1), scope, parent, name, metrics.covered, metrics.total, metrics.parallel, metrics.count]
  return '\uFEFF' + [
    ['开始日期', '结束日期（含）', '统计范围', '所属一级', '分组', '已记录覆盖分钟（去重）', '活动累计分钟（逐条相加）', '并行覆盖分钟（至少两项）', '记录条数'],
    ...groups.map(g => row(g.name, g.parentName ?? '', g)), row('所选范围合计（重新去重）', '', summary)
  ].map(values => values.map(cell).join(',')).join('\r\n')
}
