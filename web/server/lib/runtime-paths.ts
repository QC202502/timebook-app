import path from 'node:path'
import os from 'node:os'
export function runtimePaths(env: Record<string, string | undefined> = process.env) {
  for (const key of ['TIME_LEDGER_HOME', 'TIME_LEDGER_DATA_FILE', 'TIME_LEDGER_PROTECTION_DIR', 'TIME_LEDGER_USAGE_FILE', 'TIME_LEDGER_CODEX_DIR']) {
    if (env[key] && !path.isAbsolute(env[key]!)) throw new Error(`${key} 必须是绝对路径。`)
  }
  const home = path.resolve(env.TIME_LEDGER_HOME || (process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'TimeLedger-Community')
    : path.join(os.homedir(), '.local', 'share', 'time-ledger-community')))
  const ledger = path.resolve(env.TIME_LEDGER_DATA_FILE || path.join(home, 'ledger-v2.json'))
  // An explicitly isolated ledger gets isolated auxiliary files too.
  return { home, ledger,
    protection: path.resolve(env.TIME_LEDGER_PROTECTION_DIR || ledger + '.versions'),
    usage: path.resolve(env.TIME_LEDGER_USAGE_FILE || ledger + '.quick-input-events.json'),
    codex: path.resolve(env.TIME_LEDGER_CODEX_DIR || path.join(home, 'codex-work')) }
}
