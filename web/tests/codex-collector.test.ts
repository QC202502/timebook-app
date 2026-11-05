import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const python = spawnSync('python3', ['--version'])
test('optional collector reads only synthetic sources, preserves execution states and refresh is idempotent', { skip: python.status !== 0 ? 'Python 3 unavailable; core app does not require it' : false }, () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ledger-codex-fixture-'))
  const sessions = path.join(root, 'sessions'), memory = path.join(root, 'memory')
  mkdirSync(sessions); mkdirSync(memory)
  const event = (minute: number, type: string, id: string, extra = {}) => ({ timestamp: `2025-01-02T01:${String(minute).padStart(2,'0')}:00Z`, type: 'event_msg', payload: { type, turn_id: id, ...extra } })
  const rows = [
    { type: 'session_meta', payload: { id: 'synthetic-thread' } },
    event(0, 'task_started', 'parent'), event(0, 'user_message', 'parent', { message: '整理示例资料' }),
    event(2, 'task_started', 'child', { root_turn_id: 'parent' }),
    event(5, 'task_complete', 'child', { last_agent_message: '完成示例提取' }),
    event(10, 'task_complete', 'parent', { last_agent_message: '整理示例资料完成' }),
    event(12, 'task_started', 'open'),
    event(15, 'task_complete', 'unknown', { last_agent_message: '无开始信号的示例' }),
  ]
  writeFileSync(path.join(sessions,'rollout-synthetic.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n')
  const run = (rules?: string) => {
    const env: NodeJS.ProcessEnv = { ...process.env, TIME_LEDGER_CODEX_FIRST_DAY: '2025-01-01' }
    delete env.TIME_LEDGER_CODEX_RULES_FILE
    if (rules) env.TIME_LEDGER_CODEX_RULES_FILE = rules
    const p = spawnSync('python3', ['server/scripts/codex_work.py','refresh','--store',path.join(root,'index'),'--sessions',sessions,'--memory',memory,'--start','2025-01-02','--end','2025-01-03'], { env, encoding: 'utf8' })
    assert.equal(p.status, 0, p.stdout + p.stderr)
    return JSON.parse(p.stdout)
  }
  const first = run(), second = run()
  assert.deepEqual(first.metrics, { ms: 600000, closed: 3, open: 1, unknown: 1, nested: 1 })
  assert.deepEqual(second.metrics, first.metrics)
  assert.deepEqual(second.runs, first.runs)
  assert.ok(first.runs.every((r: {group:string}) => r.group === '待归属'))
  const rules = path.join(root,'rules.json')
  writeFileSync(rules,JSON.stringify({ rules: [['示例整理','整理示例资料']], destinations: [] }))
  assert.equal(run(rules).runs.find((r: {id:string}) => r.id === 'parent').group, '示例整理')
})
