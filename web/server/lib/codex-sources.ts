import { createReadStream } from 'node:fs'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { createInterface } from 'node:readline'
import { addDays, validDate } from '../../shared/lib/ledger-v2.ts'
import { validRun, type AgentRun, type WorkItem } from '../../shared/lib/collaboration.ts'
import { dayStartMs } from '../../shared/lib/collaboration-stats.ts'

export type RunCandidate = { run: AgentRun; task: WorkItem; warnings: string[] }
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const runId = (key: string) => 'run-' + hash(key).slice(0, 32)
const timestamp = (value: unknown): string | undefined => {
  const ms = typeof value === 'number' ? value * 1000 : typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(ms) && ms >= Date.parse('2000-01-01') && ms < Date.parse('2100-01-01') ? new Date(ms).toISOString() : undefined
}
const localDate = (iso: string) => new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(0, 10)
const boundedTitle = (s: unknown) => typeof s === 'string' ? s.replace(/[#*`\[\]]/g, '').split('\n').find(v => v.trim())?.slice(0, 160) || 'Codex执行' : 'Codex执行'

/** Portable receipts from Codex or explicit structured memory, not inferred prose. */
export function receiptCandidate(value: unknown, source: 'codex' | 'memory', locator: string): RunCandidate {
  if (!value || typeof value !== 'object') throw new Error('请粘贴有效执行回执。')
  const x = value as Record<string, unknown>
  const key = typeof x.sourceKey === 'string' ? x.sourceKey.trim() : typeof x.turnId === 'string' ? 'codex-turn:' + x.turnId : ''
  if (!key) throw new Error('回执需提供稳定的sourceKey或turnId，用于重复导入去重。')
  for (const value of [x.startedAt, x.endedAt]) if (value !== undefined && (typeof value !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(value) || !timestamp(value))) throw new Error('起止时间需为有效ISO时间并包含时区。')
  const startedAt = timestamp(x.startedAt), endedAt = timestamp(x.endedAt)
  const run: AgentRun = {
    id: runId(key), taskId: 'task-' + hash(key).slice(0, 32), sourceKey: key,
    date: startedAt ? localDate(startedAt) : validDate(x.date) ? x.date : '',
    status: (x.status ?? 'completed') as AgentRun['status'], quality: x.estimated === true ? 'estimated' : 'reported',
    ...(startedAt ? { startedAt } : {}), ...(endedAt ? { endedAt } : {}),
    ...(typeof x.durationMs === 'number' ? { durationMs: x.durationMs } : {}),
    pauses: Array.isArray(x.pauses) ? x.pauses as AgentRun['pauses'] : [],
    ...(typeof x.parentKey === 'string' ? { parentKey: x.parentKey } : {}), sources: [{ kind: source, locator, fingerprint: hash(JSON.stringify(x)) }]
  }
  if (!startedAt && x.durationMs === undefined) run.quality = 'unknown'
  if (!validRun(run)) throw new Error('回执时间、日期或状态不完整；起止必须含时区，durationMs使用毫秒。')
  return { run, task: { id: run.taskId, title: boundedTitle(x.title), projectId: '', stage: typeof x.stage === 'string' ? x.stage.slice(0, 40) : '', outcomes: [] }, warnings: run.quality === 'unknown' ? ['用时待核，尚无明确执行区间或时长'] : [] }
}

export function sessionCandidate(payload: Record<string, unknown>, sessionLocator: string, title?: string): RunCandidate | null {
  if (payload.type !== 'task_complete' || typeof payload.turn_id !== 'string') return null
  const key = 'codex-turn:' + payload.turn_id, startedAt = timestamp(payload.started_at), endedAt = timestamp(payload.completed_at)
  if (!endedAt) return null
  const run: AgentRun = {
    id: runId(key), taskId: 'task-' + hash(key).slice(0, 32), sourceKey: key,
    date: localDate(startedAt ?? endedAt), status: 'completed', quality: startedAt ? 'observed' : 'unknown',
    ...(startedAt ? { startedAt, endedAt } : {}),
    ...(typeof payload.duration_ms === 'number' && startedAt ? { durationMs: payload.duration_ms } : {}), pauses: [],
    ...(typeof payload.root_turn_id === 'string' && payload.root_turn_id !== payload.turn_id ? { parentKey: 'codex-turn:' + payload.root_turn_id } : {}),
    sources: [{ kind: 'session', locator: sessionLocator + '#' + payload.turn_id, fingerprint: hash(JSON.stringify({ turn: payload.turn_id, startedAt, endedAt, duration: payload.duration_ms })) }]
  }
  if (!validRun(run as unknown)) { delete run.durationMs; run.quality = 'unknown' }
  if (!validRun(run)) return null
  return { run, task: { id: run.taskId, title: boundedTitle(title || payload.last_agent_message), projectId: '', stage: '', outcomes: [] }, warnings: run.parentKey ? ['子执行仅展开，不与父执行重复累加'] : run.quality === 'unknown' ? ['缺少可信开工时间，用时待核'] : [] }
}

export async function readSourceCandidates(date: string, options: { memoryRoot?: string; sessionRoot?: string } = {}) {
  if (!validDate(date)) throw new Error('请选择有效日期。')
  const memoryRoot = options.memoryRoot ?? process.env.TIME_LEDGER_CODEX_MEMORY
  const sessionRoot = options.sessionRoot ?? process.env.TIME_LEDGER_CODEX_SESSIONS
  if (!memoryRoot || !sessionRoot || (!options.sessionRoot && process.env.TIME_LEDGER_CODEX_ENABLED !== '1')) throw new Error('Codex 来源未启用')
  const candidates: RunCandidate[] = [], warnings: string[] = [], refs = new Set<string>()
  const memoryByTurn = new Map<string, { title: string; locator: string; fingerprint: string }>()
  let memory = ''
  const memoryFile = path.join(memoryRoot, date + '.md')
  try {
    const actual = await realpath(memoryFile), root = await realpath(memoryRoot)
    if (!actual.startsWith(root + path.sep) || (await stat(actual)).size > 2 * 1024 * 1024) throw new Error('memory过大或路径越界')
    memory = await readFile(actual, 'utf8')
    for (const block of memory.split(/(?=^### )/m)) {
      const turn = block.match(/更新ID[：:]\s*([a-zA-Z0-9_-]{1,80})/)?.[1]
      const title = block.match(/一句话结论[：:]\s*([^\n]+)/)?.[1] || block.split('\n')[0]
      if (turn) memoryByTurn.set(turn, { title, locator: 'memory/' + date + '.md#' + turn, fingerprint: hash(block) })
    }
    for (const match of memory.matchAll(/\/[^\s`"<>]+\/rollout-[^\s`"<>]+\.jsonl/g)) refs.add(match[0])
    for (const match of memory.matchAll(/```time-ledger-run\s*\n([\s\S]*?)```/g)) {
      try {
        const candidate = receiptCandidate(JSON.parse(match[1]), 'memory', 'memory/' + date + '.md#' + hash(match[1]).slice(0, 16))
        const r = candidate.run
        if (r.startedAt && r.endedAt ? Date.parse(r.startedAt) < dayStartMs(addDays(date, 1)) && Date.parse(r.endedAt) > dayStartMs(date) : r.date === date) candidates.push(candidate)
      }
      catch { warnings.push('一条memory执行回执格式不完整，已跳过；未由文字猜测时间。') }
    }
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push('这天memory未能读取或超出范围。') }
  // Recent folders plus explicitly referenced older sessions. No arbitrary browser path.
  for (const day of [addDays(date, -1), date]) {
    const folder = path.join(sessionRoot, ...day.split('-'))
    try { for (const name of (await readdir(folder)).sort()) if (/^rollout-.*\.jsonl$/.test(name)) refs.add(path.join(folder, name)) } catch { /* missing folder is normal */ }
  }
  let bytes = 0, scanned = 0
  const root = await realpath(sessionRoot).catch(() => '')
  for (const ref of refs) {
    if (scanned >= 30 || candidates.length >= 200) { warnings.push('已到单次扫描上限，其余来源未扫描。'); break }
    let file: string
    try { file = await realpath(ref); if (!root || !file.startsWith(root + path.sep) || !/^rollout-.*\.jsonl$/.test(path.basename(file))) continue } catch { continue }
    const size = (await stat(file)).size
    if (size > 64 * 1024 * 1024 || bytes + size > 128 * 1024 * 1024) { warnings.push('有来源文件较大，本次跳过。可使用结构化执行回执。'); continue }
    scanned++; bytes += size
    const stream = createReadStream(file, { encoding: 'utf8' }), lines = createInterface({ input: stream, crlfDelay: Infinity })
    try {
      for await (const line of lines) {
        if (line.length > 2 * 1024 * 1024 || !line.includes('task_complete')) continue
        let event: { type?: string; payload?: Record<string, unknown> }
        try { event = JSON.parse(line) } catch { continue }
        if (event.type !== 'event_msg' || !event.payload) continue
        const info = memoryByTurn.get(String(event.payload.turn_id))
        const candidate = sessionCandidate(event.payload, 'codex/sessions/' + path.relative(root, file), info?.title)
        if (!candidate) continue
        const run = candidate.run
        const start = run.startedAt ? Date.parse(run.startedAt) : dayStartMs(run.date), end = run.endedAt ? Date.parse(run.endedAt) : start + 1
        if (start >= dayStartMs(addDays(date, 1)) || end <= dayStartMs(date)) continue
        if (info) run.sources.push({ kind: 'memory', locator: info.locator, fingerprint: info.fingerprint })
        candidates.push(candidate)
        if (candidates.length >= 200) break
      }
    } finally { lines.close(); stream.destroy() }
  }
  const byKey = new Map<string, RunCandidate>()
  for (const c of candidates) {
    const old = byKey.get(c.run.sourceKey)
    if (!old) { byKey.set(c.run.sourceKey, c); continue }
    const preferred = c.run.quality === 'observed' ? c : old
    preferred.run.sources = [...new Map([...old.run.sources, ...c.run.sources].map(s => [s.kind + ':' + s.locator, s])).values()].slice(-20)
    byKey.set(c.run.sourceKey, preferred)
  }
  return { candidates: [...byKey.values()].sort((a, b) => (a.run.startedAt ?? '').localeCompare(b.run.startedAt ?? '')), warnings: [...new Set(warnings)], scanned, date, memoryFound: !!memory }
}
