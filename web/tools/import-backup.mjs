// Restore to a NEW, explicit directory only. Never replaces an existing ledger.
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { validateRecovery } from '../shared/lib/ledger-recovery.ts'
import { atomicPrivateFile, archiveVersion } from '../server/lib/ledger-protection.ts'
const [input, destination] = process.argv.slice(2)
if (!input || !destination || process.argv.length !== 4 || !path.isAbsolute(destination)) throw new Error('Usage: node tools/import-backup.mjs BACKUP.json /absolute/new-data-directory')
const raw = await readFile(input)
if (raw.length > 64 * 1024 * 1024) throw new Error('Backup exceeds 64 MB')
const value = JSON.parse(raw.toString('utf8'))
if (value.demo === true) throw new Error('This is demo data, not a personal backup')
if (value.version !== 3) throw new Error('Only version 3 backups are supported')
const db = { version: 3, revision: value.revision, categories: value.categories, records: value.records, ...(value.collaboration ? { collaboration: value.collaboration } : {}), operations: [] }
validateRecovery(db)
// Exclusive directory creation protects against mistaken overwrite and duplicate invocations.
await mkdir(destination, { mode: 0o700 })
const file = path.join(destination, 'ledger-v2.json'), bytes = JSON.stringify(db, null, 2)
await atomicPrivateFile(file, bytes)
await archiveVersion(bytes, 'imported', file + '.versions')
console.log(`Restored ${db.records.length} records to ${file}. Start with TIME_LEDGER_HOME set to ${destination}.`)
