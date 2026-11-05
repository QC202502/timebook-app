// Production HTTP integration on a temporary home and OS-assigned loopback port.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rename, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
const home = await mkdtemp(path.join(tmpdir(), 'time-ledger-release-'))
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1', TIME_LEDGER_HOME: home, TIME_LEDGER_CODEX_ENABLED: '0' }
for (const key of ['TIME_LEDGER_DATA_FILE','TIME_LEDGER_PROTECTION_DIR','TIME_LEDGER_USAGE_FILE','TIME_LEDGER_CODEX_DIR']) delete env[key]
let child, base, logs = ''
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function start() {
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; await new Promise(r => probe.close(r))
  base = `http://127.0.0.1:${port}`
  child = spawn(process.execPath, ['../tools/start.mjs','--port',String(port)], { cwd: process.cwd(), env, stdio: ['ignore','pipe','pipe'] })
  child.stdout.on('data', b => { logs += b }); child.stderr.on('data', b => { logs += b })
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('Server exited: ' + logs)
    try { if ((await fetch(base + '/api/ledger')).status === 200) return } catch {}
    await sleep(100)
  }
  throw new Error('Server did not start: ' + logs)
}
async function stop() { if (child && child.exitCode === null) { const done = once(child, 'exit'); child.kill('SIGTERM'); await done } }
async function request(url, body, status = 200) {
  const res = await fetch(base + url, body ? { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
  const value = await res.json(); assert.equal(res.status, status, JSON.stringify(value)); return value
}
let n = 0
const save = async change => request('/api/ledger', { revision: (await request('/api/ledger')).revision, operationId: 'smoke-' + ++n, upserts: [], deleteIds: [], ...change })
const row = (id, category, start, end) => ({ id, category, date: '2030-01-02', start, end, secondaryId: null, activity: '合成活动 '+id, activitySource: 'custom', project: '示例项目', note: '', approximate: false })
try {
  await start()
  assert.equal((await request('/api/ledger')).records.length, 0)
  assert.equal((await fetch(base + '/today?mode=real')).status, 200)
  await request('/api/codex-work?start=2030-01-01&end=2030-01-08', undefined, 503)
  await request('/api/codex-sources?date=2030-01-02', undefined, 503)
  const sleepRow = row('sleep','rest',0,400), walk = row('walk','health',600,630), book = row('book','learn',600,620)
  await save({ upserts: [sleepRow,walk,book] })
  const original = await request('/api/ledger'), protection = await request('/api/protection'), first = protection.versions[0]
  assert.equal(protection.localCovered, true)
  const modified = { ...book, activity: '合成活动 更新书籍' }
  const payload = { revision: original.revision, operationId: 'update-book', upserts: [modified], deleteIds: [], recordIntent: { kind: 'update', id: 'book' } }
  const changed = await request('/api/ledger', payload)
  assert.deepEqual(changed.records.find(r => r.id === 'sleep'), sleepRow)
  assert.equal((await request('/api/ledger', payload)).revision, changed.revision)
  await request('/api/ledger', { ...payload, operationId: 'stale' }, 409)
  const bytes = await readFile(path.join(home,'ledger-v2.json'))
  await save({ upserts: [row('third','fun',605,610)] })
  await request('/api/ledger', { revision: (await request('/api/ledger')).revision, operationId: 'fourth', upserts: [row('fourth','work',605,610)], deleteIds: [] }, 400)
  await save({ categoryAction: { type: 'save-primary', id: 'learn', name: '阅读学习', color: '#123456' } })
  assert.equal((await request('/api/ledger')).categories.find(c => c.id === 'learn').name, '阅读学习')
  await stop(); await start()
  assert.equal((await request('/api/ledger')).records.length, 4)
  const preview = await request('/api/protection?preview=1&version=' + first.id + '&record=book')
  const restored = await request('/api/protection', { action: 'restore', versionId: first.id, recordId: 'book', revision: preview.revision, currentHash: preview.currentHash, operationId: 'restore-one', confirm: 'restore-record' })
  assert.deepEqual(restored.records.find(r => r.id === 'book'), book)
  assert.deepEqual(restored.records.find(r => r.id === 'sleep'), sleepRow)
  assert.equal(restored.records.length, 4)
  const current = await readFile(path.join(home,'ledger-v2.json')), archive = path.join(home,'ledger-v2.json.versions','versions',first.id,'ledger.json')
  const old = await readFile(archive); await writeFile(archive,'{}')
  await request('/api/protection?preview=1&version=' + first.id, undefined, 500)
  assert.deepEqual(await readFile(path.join(home,'ledger-v2.json')), current); await writeFile(archive,old)
  assert.equal((await fetch(base + '/api/ledger', { headers: { Origin: 'https://foreign.invalid' } })).status, 403)
  const rebound = await new Promise((resolve, reject) => { const r = http.get(base + '/api/ledger', { headers: { Host: 'foreign.invalid' } }, res => { res.resume(); resolve(res.statusCode) }); r.on('error', reject) })
  assert.equal(rebound, 403)
  await rename(path.join(home,'ledger-v2.json'),path.join(home,'ledger.held'))
  await request('/api/ledger',undefined,500)
  await rename(path.join(home,'ledger.held'),path.join(home,'ledger-v2.json'))
  // Download-format backup can be restored on another installation, without overwriting any directory.
  const backup = path.join(home,'download.json'); await writeFile(backup, JSON.stringify({ ...restored, version: 3, scope: 'full-ledger', demo: false }))
  const imported = home + '-restored'
  const runImport = () => new Promise(resolve => { const p = spawn(process.execPath, ['tools/import-backup.mjs',backup,imported], { env, stdio: 'pipe' }); p.on('exit', resolve) })
  assert.equal(await runImport(), 0); assert.equal(await runImport(), 1)
  assert.deepEqual(JSON.parse(await readFile(path.join(imported,'ledger-v2.json'),'utf8')).records, restored.records)
  await stop(); env.TIME_LEDGER_HOME = imported; await start()
  assert.deepEqual((await request('/api/ledger')).records, restored.records)
  assert.equal((await request('/api/protection')).localCovered, true)
  assert.equal((await readdir(home)).some(f => f.includes('codex') || f.includes('quick-input')), false)
  console.log('PASS: blank install, save, parallel limit, edit isolation, idempotency, stale rejection, category rename, restart, recovery, corrupt/missing data refusal, origin/host guard, opt-in sources, new-install backup import.')
} finally { await stop() }
