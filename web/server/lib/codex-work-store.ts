import { runtimePaths } from './runtime-paths'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import os from 'node:os'
import type { CodexReport } from '../../shared/lib/codex-work'
const exec = promisify(execFile)
const runtime = globalThis as typeof globalThis & { codexRefresh?: Promise<CodexReport>; codexRefreshAt?: number }
const script = path.join(process.cwd(), 'server/scripts/codex_work.py')
export class CodexWorkError extends Error { constructor(public status: number, message: string) { super(message) } }
export async function codexCommand(command: 'read' | 'refresh' | 'patch' | 'backup' | 'restore', start: string, end: string, body?: unknown): Promise<CodexReport> {
  if (process.env.TIME_LEDGER_CODEX_ENABLED !== '1' || !process.env.TIME_LEDGER_CODEX_SESSIONS || !process.env.TIME_LEDGER_CODEX_MEMORY) throw new CodexWorkError(503, 'Codex 汇总未启用。请按 docs/extensions.md 配置来源；普通记账不受影响。')
  const args = [script, command, '--store', runtimePaths().codex, '--sessions', process.env.TIME_LEDGER_CODEX_SESSIONS, '--memory', process.env.TIME_LEDGER_CODEX_MEMORY, '--start', start, '--end', end]
  if (process.env.TIME_LEDGER_CODEX_ARCHIVED) args.push('--archived', process.env.TIME_LEDGER_CODEX_ARCHIVED)
  try {
    const child = exec(process.env.TIME_LEDGER_PYTHON || 'python3', args, { timeout: 25000, maxBuffer: 16 * 1024 * 1024 })
    child.child.stdin?.end(body === undefined ? '' : JSON.stringify(body))
    const { stdout } = await child
    return JSON.parse(stdout)
  } catch (e) {
    let error = 'Codex索引暂时不可用；个人录入仍可正常使用。'
    try { error = JSON.parse((e as { stdout?: string }).stdout || '{}').error || error } catch { /* no raw shell output */ }
    throw new CodexWorkError(error.startsWith('CONFLICT:') ? 409 : 503, error.replace('CONFLICT: ', ''))
  }
}
export async function refreshCodex(start: string, end: string) {
  if (runtime.codexRefresh) { await runtime.codexRefresh; return codexCommand('read', start, end) }
  if (Date.now() - (runtime.codexRefreshAt || 0) < 1000) return codexCommand('read', start, end)
  runtime.codexRefresh = codexCommand('refresh', start, end)
  try { return await runtime.codexRefresh } finally { runtime.codexRefresh = undefined; runtime.codexRefreshAt = Date.now() }
}
