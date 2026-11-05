export type CodexRun = {
  id: string; threadId?: string; group: string; title: string; summary: string; state: string; basis: string; routine: boolean; hidden: boolean; corrected: boolean;
  start?: number; end?: number; ms: number | null; bucket: 'known' | 'unknown' | 'open' | 'nested'; status: string; sourceDurationMs?: number;
  sources: string[]; receipt: string; sourceConflict: boolean; orphanChild: boolean; artifacts: { label: string; path: string }[];
}
export type CodexMatter = { title: string; summary: string; state: string; basis: string; ms: number; runs: string[]; routine: boolean; hidden: boolean; artifacts: { label: string; path: string }[] }
export type CodexGroup = { name: string; ms: number; count: number; matters: CodexMatter[]; days: Record<string, number> }
export type CodexReport = {
  schema: number; revision: number; range: { start: string; end: string }; runs: CodexRun[]; groups: CodexGroup[];
  memoryNotes?: { title: string; summary: string; sourceDate: string }[];
  metrics: { ms: number; closed: number; open: number; unknown: number; nested: number };
  scan: { firstDay: string; updatedAt: string | null; files: number; pendingFiles: number; partialFiles: number; malformedLines?: number; oversizeLines?: number; warnings: string[] };
}
export function codexCsv(report: CodexReport) {
  const quote = (s: unknown) => '"' + String(s ?? '').replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""') + '"'
  return '\uFEFF' + [['项目或事项', '工作事项', '结果摘要', '执行标识', '开始', '结束', '本期分钟', '计时状态', '执行状态', '摘要依据', '隐藏', '来源'], ...report.runs.map(r => [r.group, r.title, r.summary, r.id, r.start ? new Date(r.start).toISOString() : '', r.end ? new Date(r.end).toISOString() : '', r.ms === null ? '' : r.ms / 60000, r.bucket, r.status, r.basis, r.hidden ? '是' : '否', r.sources.join(' | ')])].map(row => row.map(quote).join(',')).join('\r\n')
}

import type { Collaboration } from './collaboration'
export const codexProjectName = (name: string) => /Day\s*\d+.*视频日记/i.test(name) ? '视频日记' : name
/** Read-only project projection; never passes these virtual IDs to ledger mutations. */
export function withCodexProjects(original: Collaboration, report: CodexReport | null) {
  const data: Collaboration = { ...original, entities: [...original.entities], tasks: [...original.tasks], runs: [...original.runs] }
  const virtualIds = new Set<string>()
  if (!report) return { data, virtualIds }
  const hash = (s: string) => { let n = 2166136261; for (const ch of s) n = Math.imul(n ^ ch.codePointAt(0)!, 16777619); return (n >>> 0).toString(16) }
  for (const r of report.runs) {
    if (r.group === '待归属' || r.bucket === 'open') continue
    const key = 'codex-turn:' + r.id
    if (data.runs.some(x => x.sourceKey === key)) continue
    const name = codexProjectName(r.group)
    let entity = data.entities.find(e => e.kind === 'project' && e.name === name)
    if (!entity) { entity = { id: 'codex-project-' + hash(name), kind: 'project', name, status: 'active' }; data.entities.push(entity); virtualIds.add(entity.id) }
    const first = report.range.start > report.scan.firstDay ? report.range.start : report.scan.firstDay
    const start = r.start ? Math.max(r.start, Date.parse(first + 'T00:00:00+08:00')) : undefined
    const end = r.end ? Math.min(r.end, Date.parse(report.range.end + 'T00:00:00+08:00')) : undefined
    const taskId = 'codex-task-' + r.id
    data.tasks.push({ id: taskId, title: r.title, projectId: entity.id, stage: '', outcomes: [] })
    data.runs.push({ id: 'codex-run-' + r.id, taskId, sourceKey: key, date: new Date((start || end || 0) + 8 * 3600000).toISOString().slice(0, 10),
      status: r.status === 'failed' ? 'failed' : r.status === 'cancelled' ? 'cancelled' : 'completed', quality: r.bucket === 'known' || r.bucket === 'nested' ? 'observed' : 'unknown',
      ...(start ? { startedAt: new Date(start).toISOString() } : {}), ...(end ? { endedAt: new Date(end).toISOString() } : {}),
      ...(r.bucket === 'nested' ? { parentKey: 'source-parent' } : {}), pauses: [], sources: r.sources.map(locator => ({ kind: 'session' as const, locator })) })
  }
  return { data, virtualIds }
}
