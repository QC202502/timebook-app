/** Optional metadata: legacy record text and times remain the source of truth. */
export type EntityKind = 'project' | 'book' | 'person'
export type Entity = { id: string; kind: EntityKind; name: string; status: 'active' | 'archived'; nextStep?: string }
export type RecordContext = {
  executor: 'human' | 'legacy'
  projectId?: string
  books: { id: string; role: 'reading' | 'reference' }[]
  people: { id: string; role: 'together' | 'mentioned' }[]
  stage?: string
  breaks?: { start: number; end: number }[]
}
export type Outcome = { id: string; title: string; location: string; state: 'draft' | 'delivered' | 'accepted' | 'published'; version: string }
export type WorkItem = { id: string; title: string; projectId: string; stage: string; outcomes: Outcome[] }
export type RunSource = { kind: 'session' | 'memory' | 'codex' | 'manual'; locator: string; fingerprint?: string }
export type AgentRun = {
  id: string; taskId: string; sourceKey: string; date: string
  status: 'completed' | 'failed' | 'cancelled' | 'running'
  quality: 'observed' | 'reported' | 'estimated' | 'unknown'
  startedAt?: string; endedAt?: string; durationMs?: number
  pauses: { start: string; end: string }[]
  parentKey?: string; sources: RunSource[]
}
export type ProjectReview = { id: string; projectId: string; period: 'week' | 'month'; start: string; minMinutes: number; maxMinutes: number; result: string; nextStep: string }
export type Collaboration = { entities: Entity[]; tasks: WorkItem[]; runs: AgentRun[]; reviews: ProjectReview[] }
export type CollaborationChange = {
  entities?: Entity[]; tasks?: WorkItem[]; runs?: AgentRun[]; reviews?: ProjectReview[]
  deleteEntityIds?: string[]; deleteTaskIds?: string[]; deleteRunIds?: string[]; deleteReviewIds?: string[]
  importing?: boolean; acknowledgeOverlap?: boolean
}
export const emptyCollaboration = (): Collaboration => ({ entities: [], tasks: [], runs: [], reviews: [] })
export const emptyContext = (executor: RecordContext['executor'] = 'human'): RecordContext => ({ executor, books: [], people: [] })
const id = (x: unknown): x is string => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(x)
const text = (x: unknown, max = 200): x is string => typeof x === 'string' && x.length <= max
const date = (x: unknown): x is string => typeof x === 'string' && /^20\d\d-\d\d-\d\d$/.test(x) && Number.isFinite(Date.parse(x + 'T00:00:00Z')) && new Date(x + 'T00:00:00Z').toISOString().slice(0, 10) === x
const iso = (x: unknown): x is string => typeof x === 'string' && /^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(x) && Number.isFinite(Date.parse(x))
const array = (x: unknown, max = 100): x is unknown[] => Array.isArray(x) && x.length <= max
const unique = (xs: { id: string }[]) => new Set(xs.map(x => x.id)).size === xs.length
export function validContext(x: unknown): x is RecordContext {
  if (!x || typeof x !== 'object') return false
  const c = x as RecordContext
  return ['human', 'legacy'].includes(c.executor) && (c.projectId === undefined || c.projectId === '' || id(c.projectId)) &&
    array(c.books, 20) && c.books.every(b => b && id(b.id) && ['reading', 'reference'].includes(b.role)) && unique(c.books) &&
    array(c.people, 30) && c.people.every(p => p && id(p.id) && ['together', 'mentioned'].includes(p.role)) && unique(c.people) &&
    (c.stage === undefined || text(c.stage, 40)) && (c.breaks === undefined || (array(c.breaks, 20) && c.breaks.every(b => b && Number.isInteger(b.start) && Number.isInteger(b.end) && b.start >= 0 && b.end > b.start && b.end <= 2880)))
}
export function validRun(x: unknown): x is AgentRun {
  if (!x || typeof x !== 'object') return false
  const r = x as AgentRun
  if (!id(r.id) || !id(r.taskId) || !text(r.sourceKey, 200) || !r.sourceKey.trim() || !date(r.date) ||
    !['completed', 'failed', 'cancelled', 'running'].includes(r.status) || !['observed', 'reported', 'estimated', 'unknown'].includes(r.quality) ||
    (r.startedAt !== undefined && !iso(r.startedAt)) || (r.endedAt !== undefined && !iso(r.endedAt)) ||
    (r.durationMs !== undefined && (!Number.isFinite(r.durationMs) || r.durationMs < 0 || r.durationMs > 366 * 86400000)) ||
    (r.parentKey !== undefined && (!text(r.parentKey, 200) || r.parentKey === r.sourceKey)) || !array(r.sources, 20) || !r.sources.length ||
    !r.sources.every(s => s && ['session', 'memory', 'codex', 'manual'].includes(s.kind) && text(s.locator, 1000) && (s.fingerprint === undefined || text(s.fingerprint, 128))) || !array(r.pauses, 30)) return false
  if (r.startedAt && r.date !== new Date(Date.parse(r.startedAt) + 8 * 3600000).toISOString().slice(0, 10)) return false
  if (r.endedAt && !r.startedAt || r.startedAt && r.endedAt && Date.parse(r.endedAt) <= Date.parse(r.startedAt)) return false
  if (r.status === 'running' && (r.endedAt || r.durationMs !== undefined)) return false
  if (r.durationMs !== undefined && r.startedAt && r.endedAt && r.durationMs > Date.parse(r.endedAt) - Date.parse(r.startedAt) + 1000) return false
  return r.pauses.every(p => p && iso(p.start) && iso(p.end) && r.startedAt && r.endedAt && Date.parse(p.start) >= Date.parse(r.startedAt) && Date.parse(p.end) <= Date.parse(r.endedAt) && Date.parse(p.end) > Date.parse(p.start))
}
export function validCollaboration(x: unknown): x is Collaboration {
  if (!x || typeof x !== 'object') return false
  const d = x as Collaboration
  if (!array(d.entities, 3000) || !array(d.tasks, 10000) || !array(d.runs, 20000) || !array(d.reviews, 1000)) return false
  if (!d.entities.every(e => e && id(e.id) && ['project', 'book', 'person'].includes(e.kind) && text(e.name, 100) && e.name.trim() === e.name && e.name.length > 0 && ['active', 'archived'].includes(e.status) && (e.nextStep === undefined || text(e.nextStep, 1000))) || !unique(d.entities)) return false
  if (new Set(d.entities.map(e => e.kind + ':' + e.name.toLocaleLowerCase())).size !== d.entities.length) return false
  const projects = new Set(d.entities.filter(e => e.kind === 'project').map(e => e.id))
  if (!d.tasks.every(t => t && id(t.id) && text(t.title, 200) && !!t.title.trim() && (t.projectId === '' || projects.has(t.projectId)) && text(t.stage, 40) && array(t.outcomes, 30) && t.outcomes.every(o => o && id(o.id) && text(o.title, 200) && !!o.title.trim() && text(o.location, 1000) && text(o.version, 80) && ['draft', 'delivered', 'accepted', 'published'].includes(o.state)) && unique(t.outcomes)) || !unique(d.tasks)) return false
  const tasks = new Set(d.tasks.map(t => t.id))
  if (!d.runs.every(r => validRun(r) && tasks.has(r.taskId)) || !unique(d.runs) || new Set(d.runs.map(r => r.sourceKey)).size !== d.runs.length) return false
  const runs = new Map(d.runs.map(r => [r.sourceKey, r]))
  for (const run of d.runs) {
    const seen = new Set([run.sourceKey]); let parent = run.parentKey
    while (parent) { if (seen.has(parent)) return false; seen.add(parent); parent = runs.get(parent)?.parentKey }
  }
  if (!d.reviews.every(r => r && id(r.id) && projects.has(r.projectId) && ['week', 'month'].includes(r.period) && date(r.start) && Number.isInteger(r.minMinutes) && Number.isInteger(r.maxMinutes) && r.minMinutes >= 0 && r.maxMinutes >= r.minMinutes && r.maxMinutes <= 44640 && text(r.result, 2000) && text(r.nextStep, 1000)) || !unique(d.reviews)) return false
  const reviewKeys = d.reviews.map(r => r.period + ':' + r.start + ':' + r.projectId)
  if (new Set(reviewKeys).size !== reviewKeys.length) return false
  return d.reviews.every(r => d.reviews.filter(a => a.start === r.start && a.period === r.period).length <= 3)
}
export function contextReferencesExist(context: RecordContext | undefined, data: Collaboration) {
  return !context || ((!context.projectId || data.entities.some(e => e.id === context.projectId && e.kind === 'project')) && context.books.every(b => data.entities.some(e => e.id === b.id && e.kind === 'book')) && context.people.every(p => data.entities.some(e => e.id === p.id && e.kind === 'person')))
}
export function applyCollaboration(before: Collaboration, change: CollaborationChange): Collaboration {
  if (!change || typeof change !== 'object' || Object.keys(change).some(k => !['entities', 'tasks', 'runs', 'reviews', 'deleteEntityIds', 'deleteTaskIds', 'deleteRunIds', 'deleteReviewIds', 'importing', 'acknowledgeOverlap'].includes(k))) throw new Error('协作修改格式不正确。')
  const merge = <T extends { id: string }>(old: T[], values: T[] | undefined, deletes: string[] | undefined) => {
    if (values !== undefined && (!array(values) || !values.every(v => v && id(v.id)) || !unique(values)) || deletes !== undefined && (!array(deletes) || !deletes.every(id))) throw new Error('每次最多修改100项，编号不能重复。')
    const touched = new Set([...(values ?? []).map(v => v.id), ...(deletes ?? [])])
    return [...old.filter(v => !touched.has(v.id)), ...(values ?? [])]
  }
  if (change.importing !== undefined && typeof change.importing !== 'boolean' || change.acknowledgeOverlap !== undefined && typeof change.acknowledgeOverlap !== 'boolean') throw new Error('导入确认格式不正确。')
  let incomingRuns = change.runs
  if (change.importing && incomingRuns) incomingRuns = incomingRuns.map(r => {
    const old = before.runs.find(a => a.sourceKey === r.sourceKey)
    if (!old) return r
    const sources = [...new Map([...old.sources, ...r.sources].map(s => [s.kind + ':' + s.locator, s])).values()].slice(-20)
    // Reimport updates timing evidence, never the user's work-item association.
    return old.sources.some(s => s.kind === 'manual') ? { ...old, sources } : { ...r, id: old.id, taskId: old.taskId, sources }
  })
  const next = {
    entities: merge(before.entities, change.entities, change.deleteEntityIds),
    tasks: merge(before.tasks, change.importing ? change.tasks?.filter(t => !before.tasks.some(o => o.id === t.id)) : change.tasks, change.deleteTaskIds),
    runs: merge(before.runs, incomingRuns, change.deleteRunIds), reviews: merge(before.reviews, change.reviews, change.deleteReviewIds)
  }
  if (!validCollaboration(next)) throw new Error('请检查名称、时间、执行来源和关联；同一执行只能保存一次，每期最多关注3个项目。')
  return next
}
export function inverseCollaboration(before: Collaboration, change: CollaborationChange): CollaborationChange {
  if (change.importing && change.runs) change = { ...change, runs: change.runs.map(r => ({ ...r, id: before.runs.find(o => o.sourceKey === r.sourceKey)?.id ?? r.id })) }
  const result: CollaborationChange = {}
  const pairs = [['entities', 'deleteEntityIds'], ['tasks', 'deleteTaskIds'], ['runs', 'deleteRunIds'], ['reviews', 'deleteReviewIds']] as const
  for (const [key, deleteKey] of pairs) {
    const ids = new Set([...(change[key] ?? []).map(v => v.id), ...(change[deleteKey] ?? [])])
    Object.assign(result, { [key]: before[key].filter(v => ids.has(v.id)), [deleteKey]: (change[key] ?? []).filter(v => !before[key].some(p => p.id === v.id)).map(v => v.id) })
  }
  return result
}
