import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
const checker = fileURLToPath(new URL('./check-release.mjs', import.meta.url))
test('history finds removed private context and never prints its value', () => {
  const base = mkdtempSync(join(tmpdir(), 'release-check-')), repo = join(base, 'repo')
  mkdirSync(repo)
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' })
  try {
    git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid')
    const marker = 'PRIVATE_' + 'SYNTHETIC_SENTINEL', deny = join(base, 'terms.json')
    writeFileSync(deny, JSON.stringify([marker]))
    writeFileSync(join(repo, 'README.md'), marker); git('add', 'README.md'); git('commit', '-qm', 'Fixture')
    writeFileSync(join(repo, 'README.md'), 'Clean sample'); git('add', 'README.md'); git('commit', '-qm', 'Clean')
    const run = (...a) => spawnSync(process.execPath, [checker, ...a], { cwd: repo, encoding: 'utf8' })
    assert.equal(run('--deny-file', deny).status, 0)
    const result = run('--history', '--deny-file', deny)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /private-context match/)
    assert.equal(result.stderr.includes(marker), false)
  } finally { rmSync(base, { recursive: true, force: true }) }
})
test('staged scan checks the exact upload candidate even when working files are clean', () => {
  const base = mkdtempSync(join(tmpdir(), 'release-index-'))
  const git = (...a) => execFileSync('git', ['-C', base, ...a], { stdio: 'pipe' })
  try {
    git('init', '-q')
    writeFileSync(join(base, 'README.md'), 'gh' + 'p_' + 'x'.repeat(36)); git('add', 'README.md')
    writeFileSync(join(base, 'README.md'), 'Clean working copy')
    const result = spawnSync(process.execPath, [checker, '--staged'], { cwd: base, encoding: 'utf8' })
    assert.notEqual(result.status, 0); assert.match(result.stderr, /possible credential/)
  } finally { rmSync(base, { recursive: true, force: true }) }
})
