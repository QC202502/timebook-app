import { addDays, type LedgerRecord } from './ledger-v2.ts'
import { summarizePeriod, type ReportRange, type ReportNow } from './ledger-stats.ts'
import type { AgentRun, Collaboration, RecordContext } from './collaboration.ts'

export const dayStartMs = (date: string) => Date.parse(date + 'T00:00:00+08:00')
export type Span = { start: number; end: number }
export function unionMs(spans: Span[]) {
  const sorted = [...spans].filter(s => s.end > s.start).sort((a, b) => a.start - b.start)
  let total = 0, end = -Infinity
  for (const span of sorted) { total += Math.max(0, span.end - Math.max(span.start, end)); end = Math.max(end, span.end) }
  return total
}
export function subtractSpans(span: Span, breaks: Span[]): Span[] {
  let spans = [span]
  for (const cut of breaks) spans = spans.flatMap(s => cut.end <= s.start || cut.start >= s.end ? [s] : [{ start: s.start, end: Math.min(cut.start, s.end) }, { start: Math.max(cut.end, s.start), end: s.end }].filter(s => s.end > s.start))
  return spans
}
export function humanSegments(records: LedgerRecord[]) {
  return records.flatMap(r => subtractSpans(r, r.context?.breaks ?? []).map(s => ({ ...r, ...s })))
}
export function contextSummary(records: LedgerRecord[], range: ReportRange, now: ReportNow, elapsed: boolean, predicate: (c: RecordContext) => boolean) {
  const entries = humanSegments(records).filter(r => r.context && predicate(r.context))
  const report = summarizePeriod(entries, [], range, {}, now, elapsed)
  const human = summarizePeriod(entries.filter(r => r.context?.executor === 'human'), [], range, {}, now, elapsed)
  const legacy = summarizePeriod(entries.filter(r => r.context?.executor !== 'human'), [], range, {}, now, elapsed)
  return { ...report, humanMinutes: human.covered, legacyMinutes: legacy.covered }
}
export function runMetric(run: AgentRun, range: ReportRange, nowMs: number, elapsedOnly = false) {
  const lower = dayStartMs(range.start), upper = Math.min(dayStartMs(range.end), elapsedOnly ? nowMs : Infinity)
  if (upper <= lower) return { inRange: false, ms: 0, spans: [] as Span[], bucket: 'unknown' as const }
  const started = run.startedAt ? Date.parse(run.startedAt) : NaN
  const ended = run.status === 'running' ? nowMs : run.endedAt ? Date.parse(run.endedAt) : NaN
  const hasInterval = Number.isFinite(started) && Number.isFinite(ended) && ended > started
  const inRange = hasInterval ? started < upper && ended > lower : run.date >= range.start && run.date < range.end
  if (!inRange) return { inRange: false, ms: 0, spans: [] as Span[], bucket: 'unknown' as const }
  let spans: Span[] = [], ms = 0
  if (hasInterval) {
    spans = subtractSpans({ start: started, end: ended }, run.pauses.map(p => ({ start: Date.parse(p.start), end: Date.parse(p.end) })))
      .map(s => ({ start: Math.max(lower, s.start), end: Math.min(upper, s.end) })).filter(s => s.end > s.start)
    const scale = run.durationMs !== undefined ? Math.min(1, run.durationMs / (ended - started)) : 1
    ms = spans.reduce((n, s) => n + s.end - s.start, 0) * scale
  } else if (run.durationMs !== undefined && (!elapsedOnly || dayStartMs(addDays(run.date, 1)) <= nowMs)) ms = run.durationMs
  const bucket = run.parentKey ? 'nested' : run.status === 'running' ? hasInterval ? 'running' : 'unknown' : run.quality === 'unknown' || (!hasInterval && (run.durationMs === undefined || elapsedOnly && dayStartMs(addDays(run.date, 1)) > nowMs)) ? 'unknown' : run.quality === 'estimated' ? 'estimated' : 'known'
  return { inRange, ms, spans, bucket }
}
export function agentSummary(runs: AgentRun[], range: ReportRange, nowMs: number, elapsedOnly = false) {
  const entries = runs.map(run => ({ run, ...runMetric(run, range, nowMs, elapsedOnly) })).filter(e => e.inRange)
  const inBucket = (bucket: string) => entries.filter(e => e.bucket === bucket)
  const sum = (bucket: string) => inBucket(bucket).reduce((n, e) => n + e.ms, 0)
  return { entries, knownMs: sum('known'), runningMs: sum('running'), estimatedMs: sum('estimated'), unknownCount: inBucket('unknown').length, nestedCount: inBucket('nested').length, coveredMs: unionMs(inBucket('known').flatMap(e => e.spans)) }
}
export function projectSummary(data: Collaboration, records: LedgerRecord[], range: ReportRange, now: ReportNow, elapsed: boolean) {
  const nowMs = dayStartMs(now.date) + now.minute * 60000
  return data.entities.filter(e => e.kind === 'project').map(entity => {
    const tasks = data.tasks.filter(t => t.projectId === entity.id), ids = new Set(tasks.map(t => t.id))
    const human = contextSummary(records, range, now, elapsed, c => c.projectId === entity.id)
    const agent = agentSummary(data.runs.filter(r => ids.has(r.taskId)), range, nowMs, elapsed)
    const stages = [...new Set([...human.entries.map(e => e.record.context?.stage || e.record.stage || '未设阶段'), ...tasks.map(t => t.stage || '未设阶段')])].map(name => {
      const stageTasks = new Set(tasks.filter(t => (t.stage || '未设阶段') === name).map(t => t.id))
      const h = contextSummary(records, range, now, elapsed, c => c.projectId === entity.id && (c.stage || records.find(r => r.context === c)?.stage || '未设阶段') === name)
      const a = agentSummary(data.runs.filter(r => stageTasks.has(r.taskId)), range, nowMs, elapsed)
      return { name, covered: h.covered, human: h.humanMinutes, legacy: h.legacyMinutes, agent: a.knownMs }
    })
    return { entity, human, agent, stages, tasks }
  }).sort((a, b) => b.human.covered - a.human.covered || b.agent.knownMs - a.agent.knownMs)
}
/** Mutually exclusive states, unlike overlapping category totals. */
export function dayComposition(records: LedgerRecord[], date: string, sleepCategoryIds: string[], limit = 1440) {
  const masks = new Uint16Array(1440), asleep = new Uint8Array(1440)
  for (const r of humanSegments(records)) {
    const offset = (dayStartMs(r.date) - dayStartMs(date)) / 60000
    for (let m = Math.max(0, r.start + offset); m < Math.min(limit, r.end + offset, 1440); m++) { masks[m]++; if (sleepCategoryIds.includes(r.category)) asleep[m] = 1 }
  }
  let sleep = 0, single = 0, parallel = 0, unrecorded = 0
  for (let m = 0; m < limit; m++) { if (masks[m] > 1) parallel++; else if (!masks[m]) unrecorded++; else if (asleep[m]) sleep++; else single++ }
  return { sleep, single, parallel, unrecorded, future: 1440 - limit }
}
export function timeText(ms: number) {
  if (ms > 0 && ms < 60000) return '<1 分'
  const minutes = Math.round(ms / 60000)
  return minutes < 60 ? minutes + ' 分' : Math.floor(minutes / 60) + ' 小时' + (minutes % 60 ? ' ' + minutes % 60 + ' 分' : '')
}
