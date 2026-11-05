import { runtimePaths } from './runtime-paths.ts'
import { mkdir, readFile, rename, writeFile, lstat, unlink, link } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { validUsageEvent, type UsageEvent } from '../../shared/lib/quick-usage.ts'

const runtime = globalThis as typeof globalThis & { quickUsageQueue?: Promise<unknown> }
const MAX_EVENTS = 5000, MAX_BYTES = 2_000_000
const RETENTION = 'until_reviewed_and_user_approved'
const key = (e: UsageEvent) => e.session + ':' + e.seq
const validKey = (k: unknown) => typeof k === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[0-9]{1,10}$/i.test(k) && Number(k.split(':')[1]) <= 1e9

async function replaceActive(filename: string, contents: string) {
  const temporary = filename + '.' + randomUUID() + '.tmp'
  try { await writeFile(temporary, contents, { mode: 0o600, flag: 'wx' }); await rename(temporary, filename) }
  finally { await unlink(temporary).catch(() => {}) }
}
async function sealVolume(filename: string, events: UsageEvent[]) {
  const contents = JSON.stringify({ version: 2, retention: RETENTION, events })
  const directory = filename + '.archives'
  await mkdir(directory, { recursive: true, mode: 0o700 })
  if (!(await lstat(directory)).isDirectory()) throw new Error('usage_archive_unavailable')
  const archive = path.join(directory, 'segment-' + createHash('sha256').update(contents).digest('hex') + '.json')
  const temporary = path.join(directory, randomUUID() + '.tmp')
  try {
    await writeFile(temporary, contents, { mode: 0o600, flag: 'wx' })
    // Publish a complete immutable volume without overwriting an existing archive.
    try { await link(temporary, archive) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const info = await lstat(archive)
      if (!info.isFile() || info.size !== Buffer.byteLength(contents) || await readFile(archive, 'utf8') !== contents) throw new Error('usage_archive_unavailable')
    }
  } finally { await unlink(temporary).catch(() => {}) }
}
export function usageFilename(env: Record<string, string | undefined> = process.env) {
  const { ledger, usage: file } = runtimePaths(env)
  if (path.resolve(file) === path.resolve(ledger)) throw new Error('usage_file_conflict')
  return file
}
export function appendUsage(events: UsageEvent[], filename = usageFilename()): Promise<{ stored: number }> {
  const operation = async () => {
    if (!events.length || events.length > 40 || !events.every(validUsageEvent)) throw new Error('invalid_usage')
    let old: UsageEvent[] = [], recent: string[] = []
    try {
      const info = await lstat(filename)
      if (!info.isFile() || info.size > MAX_BYTES) throw new Error('usage_file_unavailable')
      const data = JSON.parse(await readFile(filename, 'utf8'))
      if (![1, 2].includes(data.version) || !Array.isArray(data.events) || data.events.length > MAX_EVENTS || !data.events.every(validUsageEvent)) throw new Error('usage_file_unavailable')
      if (data.version === 2) {
        if (data.retention !== RETENTION || !Array.isArray(data.recentEventKeys) || data.recentEventKeys.length > MAX_EVENTS || !data.recentEventKeys.every(validKey)) throw new Error('usage_file_unavailable')
        recent = data.recentEventKeys
      }
      old = data.events
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    // Bounded retry keys are only an index. They never replace or expire raw events.
    const seen = new Set([...recent, ...old.map(key)])
    const added: UsageEvent[] = []
    for (const e of events) {
      if (seen.has(key(e))) continue
      added.push(e); seen.add(key(e))
    }
    if (!added.length) return { stored: 0 }
    const recentEventKeys = [...seen].slice(-MAX_EVENTS)
    const encode = (items: UsageEvent[]) => JSON.stringify({ version: 2, retention: RETENTION, maxEventsPerFile: MAX_EVENTS, maxBytesPerFile: MAX_BYTES, recentEventKeys, events: items })
    const combined = [...old, ...added]
    let contents = encode(combined)
    const rollover = combined.length > MAX_EVENTS || Buffer.byteLength(contents) > MAX_BYTES
    if (rollover) contents = encode(added)
    if (Buffer.byteLength(contents) > MAX_BYTES) throw new Error('usage_file_full')
    await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 })
    if (rollover && old.length) await sealVolume(filename, old)
    await replaceActive(filename, contents)
    return { stored: added.length }
  }
  const result = (runtime.quickUsageQueue ?? Promise.resolve()).then(operation, operation)
  runtime.quickUsageQueue = result.catch(() => {})
  return result
}
