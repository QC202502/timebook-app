import { validUsageEvent, type UsageDetails, type UsageEvent, type UsageEventName } from '../../shared/lib/quick-usage.ts'

type Task = { id: string; started: number; mode: 'create' | 'edit'; attempt: number }
export type SaveTicket = { task: Task; attempt: number; started: number }
type Options = { transport?: (events: UsageEvent[], signal: AbortSignal) => Promise<void>; now?: () => number; elapsedNow?: () => number; timeoutMs?: number; onStatus?: (ok: boolean) => void }
export class QuickUsageRecorder {
  private enabled = true
  private session = ''
  private seq = 0
  private task: Task | null = null
  private last: Task | null = null
  private queue: UsageEvent[] = []
  private exposures = new Map<string, string>()
  private lost = 0
  private sending = false
  private options: Options
  constructor(options: Options = {}) { this.options = options }
  get pending() { return this.queue.length }
  get active() { return !!this.task && this.enabled }
  private now() { return Math.floor((this.options.now ?? Date.now)()) }
  private elapsedNow() { return Math.floor((this.options.elapsedNow ?? this.options.now ?? (() => performance.now()))()) }
  setEnabled(value: boolean) { this.enabled = value; if (!value) { this.task = null; this.exposures.clear() } }
  begin(mode: 'create' | 'edit', entry: NonNullable<UsageDetails['entry']>) {
    try {
      if (!this.enabled) return
      if (this.task) this.end('unknown', 'context_change')
      this.session ||= crypto.randomUUID()
      this.task = { id: crypto.randomUUID(), started: this.elapsedNow(), mode, attempt: 0 }
      this.last = this.task; this.exposures.clear(); this.record('task_start', { mode, entry })
    } catch { /* Analytics must never affect editing. */ }
  }
  ensure(mode: 'create' | 'edit', entry: NonNullable<UsageDetails['entry']> = 'form') { if (!this.active) this.begin(mode, entry) }
  record(event: UsageEventName, details: UsageDetails = {}, task = this.task) {
    try {
      if (!this.enabled || !task) return
      const e = { ...details, schema: 1 as const, rules: 1 as const, session: this.session, task: task.id, seq: ++this.seq, at: this.now(), elapsedMs: Math.max(0, Math.min(604800000, this.elapsedNow() - task.started)), event }
      if (!validUsageEvent(e)) return
      if (this.queue.length >= 200) { this.queue.shift(); this.lost++; this.status(false) }
      this.queue.push(e)
    } catch { /* No private error details or console logging. */ }
  }
  expose(group: NonNullable<UsageDetails['group']>, slot: number, ephemeralKey: string, details: UsageDetails) {
    try {
      if (!this.active || !details.visible) return
      const key = group + ':' + slot
      if (this.exposures.get(key) === ephemeralKey) return
      this.exposures.set(key, ephemeralKey)
      this.record('exposure', { ...details, group, slot })
    } catch { /* Never persist the ephemeral DOM fingerprint. */ }
  }
  saveAttempt(source: NonNullable<UsageDetails['source']>, count: number): SaveTicket | undefined {
    try {
      if (!this.enabled) return
      if (!this.task) this.begin('create', 'form')
      if (!this.task) return
      const ticket = { task: this.task, attempt: ++this.task.attempt, started: this.elapsedNow() }
      this.record('save_attempt', { source, count, attempt: ticket.attempt, mode: ticket.task.mode }, ticket.task)
      return ticket
    } catch { return }
  }
  saveResult(ticket: SaveTicket | undefined, result: NonNullable<UsageDetails['result']>, reason?: UsageDetails['reason']) {
    try { if (ticket) this.record('save_result', { result, ...(reason ? { reason } : {}), attempt: ticket.attempt, durationMs: Math.max(0, Math.min(604800000, this.elapsedNow() - ticket.started)) }, ticket.task) } catch { /* optional */ }
  }
  end(result: 'saved' | 'unknown', reason?: UsageDetails['reason']) {
    this.record('task_end', { result, ...(reason ? { reason } : {}) })
    this.task = null; this.exposures.clear()
  }
  undo(result?: 'success' | 'failed', ticket?: SaveTicket) { this.record(result ? 'undo_result' : 'undo_attempt', result ? { result } : {}, ticket?.task ?? this.last) }
  private status(ok: boolean) { try { this.options.onStatus?.(ok) } catch { /* optional UI */ } }
  async flush() {
    if (this.sending || !this.queue.length) return
    this.sending = true
    if (this.lost && this.last) { const n = this.lost; this.lost = 0; this.record('log_gap', { count: Math.min(10000, n), reason: 'delivery_failed' }, this.last) }
    const batch = this.queue.splice(0, 40)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const controller = new AbortController()
      const transport = this.options.transport ?? (async (events, signal) => {
        const res = await fetch('/api/quick-input-usage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events }), signal, keepalive: true })
        if (!res.ok) throw new Error('usage_unavailable')
      })
      await Promise.race([transport(batch, controller.signal), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('usage_timeout')) }, this.options.timeoutMs ?? 1500) })])
      this.status(true)
    } catch { this.lost += batch.length; this.status(false) }
    finally { if (timer) clearTimeout(timer); this.sending = false }
  }
}
