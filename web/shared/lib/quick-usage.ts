// Only fixed semantic values and bounded numbers may cross the logging boundary.
export const USAGE_EVENTS = ['task_start', 'task_end', 'exposure', 'choice', 'expand', 'field_commit', 'parallel_add', 'parallel_remove', 'save_attempt', 'save_result', 'undo_attempt', 'undo_result', 'visibility', 'log_gap'] as const
export type UsageEventName = typeof USAGE_EVENTS[number]
const enums = {
  mode: ['create', 'edit'], entry: ['button', 'drag', 'existing', 'form'],
  group: ['secondary', 'project', 'parallel', 'stage'],
  field: ['category', 'secondary', 'project', 'stage', 'time', 'activity', 'note', 'approximate'],
  source: ['button', 'enter', 'confirm', 'as_new', 'shortcut', 'manual'],
  result: ['success', 'failed', 'review_required', 'blocked', 'unknown', 'saved'],
  reason: ['invalid', 'duplicate', 'record_changed', 'overlap', 'conflict', 'network', 'server', 'context_change', 'page_leave', 'pause', 'queue_overflow', 'delivery_failed'],
  visibility: ['visible', 'hidden', 'focused', 'blurred']
} as const
type EnumFields = { [K in keyof typeof enums]?: typeof enums[K][number] }
export type UsageDetails = EnumFields & { slot?: number; position?: number; total?: number; visible?: number; count?: number; attempt?: number; automatic?: boolean; cleared?: boolean; selected?: boolean; durationMs?: number }
export type UsageEvent = UsageDetails & { schema: 1; rules: 1; session: string; task: string; seq: number; at: number; elapsedMs: number; event: UsageEventName }
const integer = (v: unknown, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max
const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
const numbers = { seq: 1e9, at: 8640000000000000, elapsedMs: 604800000, slot: 2, position: 10000, total: 10000, visible: 10000, count: 10000, attempt: 10000, durationMs: 604800000 } as const
const keys = new Set(['schema', 'rules', 'session', 'task', 'event', ...Object.keys(enums), ...Object.keys(numbers), 'automatic', 'cleared', 'selected'])
export function validUsageEvent(value: unknown): value is UsageEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const e = value as Record<string, unknown>
  if (Object.keys(e).some(k => !keys.has(k)) || e.schema !== 1 || e.rules !== 1 || !uuid(e.session) || !uuid(e.task) || !USAGE_EVENTS.includes(e.event as UsageEventName)) return false
  if (!['seq', 'at', 'elapsedMs'].every(k => k in e)) return false
  for (const [k, limit] of Object.entries(numbers)) if (k in e && !integer(e[k], limit)) return false
  for (const [k, values] of Object.entries(enums)) if (k in e && !(values as readonly unknown[]).includes(e[k])) return false
  return ['automatic', 'cleared', 'selected'].every(k => !(k in e) || typeof e[k] === 'boolean')
}
export function validUsageBatch(body: unknown): body is { events: UsageEvent[] } {
  if (!body || typeof body !== 'object' || Object.keys(body).length !== 1 || !('events' in body)) return false
  const events = body.events
  return Array.isArray(events) && events.length > 0 && events.length <= 40 && events.every(validUsageEvent)
}
