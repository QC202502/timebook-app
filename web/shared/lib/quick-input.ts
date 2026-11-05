import { profile } from '../../config/profile.ts'
import type { PeopleDraft } from './people-input.ts'
import { peopleInText } from './people-input.ts'
import { allowsMultipleSecondaries, secondaryIdsOf, isVideoDiary, VIDEO_STAGES, type VideoStage, type Category, type LedgerRecord } from './ledger-v2.ts'

export type QuickPreferences = { weekdays: number[]; morningStart: number; morningEnd: number; dayOverrides: Record<string, boolean> }
export const DEFAULT_QUICK_PREFERENCES: QuickPreferences = { weekdays: [1, 2, 3, 4, 5], morningStart: 360, morningEnd: 540, dayOverrides: {} }
export function quickPreferences(value: unknown): QuickPreferences {
  const p = value as Partial<QuickPreferences> | null
  return {
    weekdays: Array.isArray(p?.weekdays) ? [...new Set(p.weekdays.filter(n => Number.isInteger(n) && n >= 0 && n <= 6))] : [...DEFAULT_QUICK_PREFERENCES.weekdays],
    morningStart: Number.isInteger(p?.morningStart) && p!.morningStart! >= 0 && p!.morningStart! < 1440 ? p!.morningStart! : 360,
    morningEnd: Number.isInteger(p?.morningEnd) && p!.morningEnd! > (p?.morningStart ?? 360) && p!.morningEnd! <= 1440 ? p!.morningEnd! : 540,
    dayOverrides: Object.fromEntries(Object.entries(p?.dayOverrides ?? {}).filter(([d, v]) => /^20\d{2}-\d{2}-\d{2}$/.test(d) && typeof v === 'boolean'))
  }
}
export function isWorkday(date: string, prefs: QuickPreferences) {
  return prefs.dayOverrides[date] ?? prefs.weekdays.includes(new Date(date + 'T12:00:00Z').getUTCDay())
}
export type QuickContext = { records: LedgerRecord[]; categories: Category[]; date: string; start: number; now: { date: string; minute: number }; preferences: QuickPreferences }
export type ParallelChoice = QuickChoice & { project: string; maxMinutes?: number }
export function parallelSpan(start: number, end: number, choice?: ParallelChoice) {
  return { start, end: choice?.maxMinutes ? Math.min(end, start + choice.maxMinutes) : end }
}
export const isPickupDay = (ctx: QuickContext) => (profile.pickup?.weekdays ?? []).includes(new Date(ctx.date + 'T12:00:00Z').getUTCDay()) && isWorkday(ctx.date, ctx.preferences)
const lunchTime = (ctx: QuickContext) => isWorkday(ctx.date, ctx.preferences) && ctx.start >= 660 && ctx.start < 840
const companyLunch = (value: string) => !!profile.lunchObject && value.replace(/[\s＋+]/g, '') === profile.lunchObject.replace(/[\s＋+]/g, '')

export type QuickChoice = { category: string; secondaryIds: string[]; label: string; reason: string; score: number }
const stamp = (date: string, minute: number) => Date.parse(date + 'T00:00:00Z') / 60000 + minute
const keyOf = (ids: string[]) => [...ids].sort().join('|')
export function recentRecords(ctx: QuickContext) {
  if (!Number.isFinite(ctx.start)) return []
  const cutoff = Math.min(stamp(ctx.date, ctx.start), stamp(ctx.now.date, ctx.now.minute))
  return ctx.records.filter(r => {
    const end = stamp(r.date, r.end)
    return end <= cutoff && end >= cutoff - 30 * 1440
  })
}

// Aggregate covered minutes, not entry counts: splitting or duplicating a record
// must not make it a stronger habit. Keep automatic selections weak evidence.
function contextualScores(ctx: QuickContext, rows: LedgerRecord[], key: (r: LedgerRecord) => string, field: 'secondary' | 'project') {
  const groups = new Map<string, Map<string, Map<number, number>>>()
  for (const r of rows) {
    const group = groups.get(key(r)) ?? new Map<string, Map<number, number>>()
    const minutes = group.get(r.date) ?? new Map<number, number>()
    const weight = r.suggestedFields?.includes(field) ? 0.2 : 1
    for (let m = r.start; m < r.end; m++) minutes.set(m % 1440, Math.max(minutes.get(m % 1440) ?? 0, weight))
    group.set(r.date, minutes); groups.set(key(r), group)
  }
  return new Map([...groups].map(([id, days]) => {
    let score = 0
    for (const [date, minutes] of days) {
      let peak = 0, area = 0
      for (const [minute, weight] of minutes) {
        const distance = Math.abs(ctx.start - minute)
        const evidence = weight * Math.exp(-Math.min(distance, 1440 - distance) / 45)
        peak = Math.max(peak, evidence); area += evidence
      }
      const age = Math.max(0, (stamp(ctx.date, 0) - stamp(date, 0)) / 1440)
      const dayMatch = isWorkday(date, ctx.preferences) === isWorkday(ctx.date, ctx.preferences) ? 1 : 0.35
      score += (peak + Math.min(1.5, area / 30)) * Math.exp(-age / 2) * dayMatch
    }
    return [id, score]
  }))
}

function distanceToInterval(start: number, end: number, minute: number) {
  return Math.min(...[-1440, 0, 1440].map(shift => Math.max(start + shift - minute, minute - (end + shift - 1), 0)))
}
// A repeated click or fragmented interval on one day is still only one day's evidence.
function explicitDays(ctx: QuickContext, rows: LedgerRecord[], field: 'secondary' | 'project', nearMinutes = 60) {
  return new Set(rows.filter(r => !r.suggestedFields?.includes(field)
    && isWorkday(r.date, ctx.preferences) === isWorkday(ctx.date, ctx.preferences)
    && stamp(ctx.date, ctx.start) - stamp(r.date, r.end) <= 14 * 1440
    && distanceToInterval(r.start, r.end, ctx.start) <= nearMinutes).map(r => r.date)).size
}
export function recentProjects(ctx: QuickContext, category: string, ids: string[]) {
  const social = ctx.categories.find(c => c.id === category)?.name === '社交'
  if (!ids.length && !social) return []
  const latest = new Map<string, { project: string; when: number; explicit: boolean }>()
  for (const r of recentRecords(ctx)) {
    if (r.category !== category || ((!social || ids.length > 0) && keyOf(secondaryIdsOf(r)) !== keyOf(ids)) || !r.project.trim()) continue
    if (companyLunch(r.project) && !lunchTime(ctx)) continue
    if (isVideoDiary({ category, secondaryIds: ids }, ctx.categories) && VIDEO_STAGES.includes(r.project.trim() as VideoStage)) continue
    const when = stamp(r.date, r.end), project = r.project.trim(), explicit = !r.suggestedFields?.includes('project')
    const previous = latest.get(project)
    // An automatic default must not repeatedly displace a deliberately chosen book.
    if (!previous || (explicit && !previous.explicit) || (explicit === previous.explicit && when > previous.when)) latest.set(project, { project, when, explicit })
  }
  return [...latest.values()].sort((a, b) => Number(b.explicit) - Number(a.explicit) || b.when - a.when || a.project.localeCompare(b.project)).map(p => p.project)
}
export function isReadingActivity(categories: Category[], category: string, ids: string[]) {
  if (category === 'health') return false // A stretching course is still exercise, not a book.
  return categories.find(c => c.id === category)?.children.some(s => ids.includes(s.id) && /读.*书|听.*书|小说|课程/.test(s.name)) ?? false
}
export function isProjectDrivenSelection(categories: Category[], category: string, ids: string[]) {
  if (category === 'work') return true
  return categories.find(c => c.id === category)?.children.some(s => ids.includes(s.id) &&
    (/工具与系统建设|教育工具建设/.test(s.name) || (category === 'family' && /财务|采买|采购|开发|教辅/.test(s.name)))) ?? false
}

/** User-confirmed combinations, never a frequency-based guess about today's project. */
export function toolProjectChoices(categories: Category[], categoryId: string) {
  const category = categories.find(c => c.id === categoryId && !c.archived)
  if (!category) return []
  return profile.toolProjects.flatMap(item => {
    const child = category.children.find(s => !s.archived && s.name === item.secondary)
    return child ? [{ category: category.id, secondaryIds: [child.id], project: item.project, label: item.label }] : []
  })
}

/** Editing the visible tool project must also update its saved report association. */
export function toolProjectPatch<T extends QuickDraft>(draft: T, patch: Partial<T>, categories: Category[], entities: { id: string; kind: string; name: string }[]): Partial<T> {
  const isTool = categories.find(c => c.id === draft.category)?.name === '记录与系统'
    || toolProjectChoices(categories, draft.category).some(c => c.secondaryIds.some(id => draft.secondaryIds.includes(id)))
  if (!isTool || !draft.context || patch.project === undefined || patch.project === draft.project) return patch
  return { ...patch, context: { ...(patch.context ?? draft.context), projectId: entities.find(e => e.kind === 'project' && e.name === patch.project!.trim())?.id } }
}
function projectDefault(ctx: QuickContext, category: string, ids: string[]) {
  // A recent project is an alternative, not evidence of the current assignment.
  if (isProjectDrivenSelection(ctx.categories, category, ids) || isVideoDiary({ category, secondaryIds: ids }, ctx.categories)) return ''
  const project = recentProjects(ctx, category, ids)[0] ?? ''
  if (category !== 'work' && !isReadingActivity(ctx.categories, category, ids) && peopleInText(project).length) return '' // People require an explicit choice.
  if (companyLunch(project)) return '' // A lunch object is offered, never silently chosen.
  if (isReadingActivity(ctx.categories, category, ids)) {
    const nearby = recentRecords(ctx).filter(r => r.category === category && keyOf(secondaryIdsOf(r)) === keyOf(ids) && r.project.trim() && !r.suggestedFields?.includes('project') && distanceToInterval(r.start, r.end, ctx.start) <= 60 && isWorkday(r.date, ctx.preferences) === isWorkday(ctx.date, ctx.preferences))
    const scores = contextualScores(ctx, nearby, r => r.project.trim(), 'project')
    return [...scores].sort((a, b) => b[1] - a[1])[0]?.[0] ?? project
  }
  // Research subjects change with the assignment, just like work projects.
  if (category === 'learn') return ''
  // A one-off project remains an alternative, not a permanent category binding.
  const days = new Set(recentRecords(ctx).filter(r => r.category === category && keyOf(secondaryIdsOf(r)) === keyOf(ids) && r.project === project && !r.suggestedFields?.includes('project')).map(r => r.date))
  return project && days.size >= 2 ? project : ''
}
export function workoutChoices(category: Category): QuickChoice[] {
  const ids = (names: string[]) => names.map(name => category.children.find(s => !s.archived && s.name === name)?.id)
  if (!allowsMultipleSecondaries(category)) return []
  return profile.workouts.flatMap(({ label, activities }) => {
    const selected = ids(activities)
    return selected.length && selected.every(Boolean) ? [{ category: category.id, secondaryIds: selected as string[], label, reason: '运动默认', score: 0 }] : []
  })
}
export function secondaryChoices(ctx: QuickContext, categoryId: string): QuickChoice[] {
  const category = ctx.categories.find(c => c.id === categoryId && !c.archived)
  if (!category) return []
  const active = new Set(category.children.filter(s => !s.archived).map(s => s.id))
  const ranked = new Map<string, QuickChoice>()
  const rows = recentRecords(ctx).filter(r => {
    const ids = secondaryIdsOf(r)
    return r.category === categoryId && !(!ids.length && (r.suggestedFields === undefined || r.suggestedFields.includes('secondary'))) && ids.every(id => active.has(id)) && (ids.length <= 1 || allowsMultipleSecondaries(category))
  })
  if (categoryId === 'work') {
    const latest = new Map<string, { ids: string[]; when: number; explicit: boolean }>()
    for (const r of rows) {
      const ids = secondaryIdsOf(r)
      if (!ids.length) continue
      const key = keyOf(ids), previous = latest.get(key)
      const when = stamp(r.date, r.end), explicit = !r.suggestedFields?.includes('secondary')
      if (!previous || explicit && !previous.explicit || explicit === previous.explicit && when > previous.when) latest.set(key, { ids, when, explicit })
    }
    const recent: QuickChoice[] = [...latest.values()].sort((a, b) => Number(b.explicit) - Number(a.explicit) || b.when - a.when || keyOf(a.ids).localeCompare(keyOf(b.ids))).map((r, index) => ({ category: categoryId, secondaryIds: [...r.ids], label: r.ids.map(id => category.children.find(s => s.id === id)!.name).join('＋'), reason: '近期工作，点选后填写', score: 1 / (index + 1) }))
    return [...recent, ...category.children.filter(s => !s.archived && !latest.has(s.id)).map(s => ({ category: categoryId, secondaryIds: [s.id], label: s.name, reason: '可选', score: 0 }))]
  }
  const scores = contextualScores(ctx, rows, r => keyOf(secondaryIdsOf(r)), 'secondary')
  for (const r of rows) {
    const ids = secondaryIdsOf(r), key = keyOf(ids)
    ranked.set(key, { category: categoryId, secondaryIds: [...ids], label: ids.length ? ids.map(id => category.children.find(s => s.id === id)!.name).join('＋') : '仅一级分类', reason: '近期相近时段', score: scores.get(key) ?? 0 })
  }
  for (const child of category.children.filter(s => !s.archived)) {
    if (!ranked.has(child.id)) ranked.set(child.id, { category: categoryId, secondaryIds: [child.id], label: child.name, reason: '可选', score: 0 })
  }
  if (categoryId === 'family' && profile.pickup) {
    const pickup = category.children.find(s => !s.archived && s.name === profile.pickup?.activity)
    if (pickup && isPickupDay(ctx) && ctx.start >= profile.pickup.start && ctx.start < profile.pickup.end) ranked.set(pickup.id, { category: categoryId, secondaryIds: [pickup.id], label: pickup.name, score: 100, reason: '已配置的接送时段' })
    if (!isPickupDay(ctx) && pickup) ranked.delete(pickup.id)
  }
  const presets = workoutChoices(category)
  if (isWorkday(ctx.date, ctx.preferences) && ctx.start >= ctx.preferences.morningStart && ctx.start < 1080) {
    const morning = ctx.start < ctx.preferences.morningEnd
    const selected = presets.find(c => c.label === (morning ? '早晨组' : '日间组'))
    if (selected) ranked.set(keyOf(selected.secondaryIds), { ...selected, score: 100, reason: morning ? '工作日早晨' : '工作日日间' })
    const walk = category.children.find(s => !s.archived && s.name === '快走')
    if (walk && (scores.get(walk.id) ?? 0) >= Math.max(0, ...scores.values()) && explicitDays(ctx, rows.filter(r => keyOf(secondaryIdsOf(r)) === walk.id && stamp(ctx.date, ctx.start) - stamp(r.date, r.end) <= 7 * 1440), 'secondary', 15) >= 2) {
      ranked.set(walk.id, { category: categoryId, secondaryIds: [walk.id], label: walk.name, score: 101, reason: '近期同一时段快走' })
    }
  }
  return [...ranked.values()].sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, 'zh-CN'))
}
export type QuickDraft = PeopleDraft & {
  category: string; secondaryIds: string[]; project: string; stage?: VideoStage | ''
  secondaryManual?: boolean; projectManual?: boolean; suggestedFields?: ('secondary' | 'project')[]
  primaryOnlyDefault?: boolean
}
/** Only initialize a new selection; saved records and explicitly picked companions use prefill directly. */
export function prefillNewEntry<T extends QuickDraft>(draft: T, ctx: QuickContext, end: number): T {
  const minutes = end - ctx.start
  const recording = (minutes === 1 || minutes === 2) && ctx.categories.find(c => !c.archived && ['记录', '记录与系统'].includes(c.name))
  return prefill(recording ? { ...draft, category: recording.id, secondaryIds: [], project: '', suggestedFields: [], primaryOnlyDefault: true } : draft, ctx)
}
export function prefill<T extends QuickDraft>(draft: T, ctx: QuickContext, editing = false): T {
  if (editing || draft.primaryOnlyDefault) return draft
  const next = { ...draft, secondaryIds: [...draft.secondaryIds], suggestedFields: [...(draft.suggestedFields ?? [])] }
  if (!draft.secondaryManual) {
    const topChoice = secondaryChoices(ctx, draft.category).find(c => c.score > 0)
    // Do not silently replace a likely project with a different routine either.
    const eligible = topChoice && (topChoice.score >= 100
      || isVideoDiary(topChoice, ctx.categories)
      || isReadingActivity(ctx.categories, draft.category, topChoice.secondaryIds)
      || explicitDays(ctx, recentRecords(ctx).filter(r => r.category === draft.category && keyOf(secondaryIdsOf(r)) === keyOf(topChoice.secondaryIds)), 'secondary') >= 2)
    const choice = topChoice && eligible && !isProjectDrivenSelection(ctx.categories, draft.category, topChoice.secondaryIds) ? topChoice : undefined
    next.secondaryIds = choice ? [...choice.secondaryIds] : []
    next.suggestedFields = next.suggestedFields.filter(k => k !== 'secondary')
    if (choice) next.suggestedFields.push('secondary')
  }
  if (!draft.projectManual) {
    next.project = projectDefault(ctx, draft.category, next.secondaryIds)
    next.suggestedFields = next.suggestedFields.filter(k => k !== 'project')
    if (next.project) next.suggestedFields.push('project')
  }
  if (next.stage && !isVideoDiary(next, ctx.categories)) next.stage = ''
  return next
}
export function changeQuickDraft<T extends QuickDraft>(draft: T, patch: Partial<T>, ctx: QuickContext, editing = false): T {
  const next = { ...draft, ...patch }
  if ((patch.category !== undefined && patch.category !== draft.category) || patch.secondaryIds !== undefined) delete next.primaryOnlyDefault
  if (patch.category !== undefined && patch.category !== draft.category) {
    next.secondaryIds = []; next.secondaryManual = false
    if (!draft.projectManual) next.project = ''
  } else if (patch.secondaryIds !== undefined) next.secondaryManual = true
  if (patch.project !== undefined) next.projectManual = true
  if (patch.stage) next.secondaryManual = true
  if ((patch.category !== undefined || patch.secondaryIds !== undefined) && next.stage && !isVideoDiary(next, ctx.categories)) next.stage = ''
  next.suggestedFields = (draft.suggestedFields ?? []).filter(k => k === 'secondary'
    ? patch.secondaryIds === undefined && (patch.category === undefined || patch.category === draft.category)
    : patch.project === undefined)
  return prefill(next, ctx, editing)
}
export function parallelChoices(ctx: QuickContext, draft: QuickDraft): ParallelChoice[] {
  const cat = ctx.categories.find(c => c.id === draft.category)
  const names = cat?.children.filter(s => draft.secondaryIds.includes(s.id)).map(s => s.name) ?? []
  const kind = (category: string, ids: string[]) => {
    const c = ctx.categories.find(c => c.id === category && !c.archived)
    if (!c || ids.some(id => !c.children.some(s => s.id === id && !s.archived))) return ''
    const labels = c.children.filter(s => ids.includes(s.id)).map(s => s.name)
    if (category === 'health') return labels.includes('快走') ? 'walk' : labels.includes('爬楼') ? 'stairs' : labels.length && labels.every(n => /拉伸|深蹲|斜撑|力量训练/.test(n)) ? 'training' : ''
    if (category === 'learn' && isReadingActivity(ctx.categories, category, ids)) return 'reading'
    if (category === 'fun' && labels.includes('听小说')) return 'novel'
    if (category === 'rest' && labels.includes('睡觉')) return 'sleep'
    if (category === 'family') return ids.includes('family-4') || labels.some(n => ['聊天', '聊天与沟通'].includes(n)) ? 'chat' : labels.includes(profile.pickup?.activity ?? '接送') ? 'pickup' : labels.includes('做饭') ? 'cook' : ids.includes('life-2') || labels.includes('家务') ? 'chores' : ''
    if (category === 'life') return labels.includes('吃饭') ? 'meal' : ids.includes('life-2') || labels.includes('家务') ? 'chores' : labels.includes('通勤') ? 'commute' : labels.includes('洗手间') ? 'washroom' : labels.includes('收拾') ? 'tidy' : ''
    return c.name === '社交' ? 'social' : ''
  }
  // These are optional life-activity companions. Work/AI execution and sleep
  // overlaps cannot establish that the person was doing both activities.
  const pairs = [['pickup', 'novel'], ['training', 'novel'], ['walk', 'reading'], ['walk', 'social'], ['walk', 'pickup'], ['walk', 'chat'], ['pickup', 'chat'], ['cook', 'chat'], ['meal', 'chat'], ['chores', 'chat'], ['commute', 'chat'], ['meal', 'reading'], ['meal', 'social'], ['washroom', 'reading'], ['washroom', 'novel'], ['chores', 'novel'], ['stairs', 'chat'], ['tidy', 'novel']]
  const sourceKind = kind(draft.category, draft.secondaryIds)
  const candidates = new Map<string, ParallelChoice>()
  const rows = recentRecords(ctx).map(record => ({ record, kind: kind(record.category, secondaryIdsOf(record)) }))
  const sources = rows.filter(r => sourceKind && r.kind === sourceKind)
  const companions = rows.filter(r => pairs.some(([x, y]) => sourceKind === x && r.kind === y || sourceKind === y && r.kind === x))
  for (const { record: a } of sources) for (const { record: b } of companions) {
    if (a.id === b.id) continue
    const start = Math.max(stamp(a.date, a.start), stamp(b.date, b.start))
    const end = Math.min(stamp(a.date, a.end), stamp(b.date, b.end))
    if (end <= start) continue
    const distance = distanceToInterval(start - stamp(a.date, 0), end - stamp(a.date, 0), ctx.start)
    if (distance > 120) continue
    const age = Math.max(0, (stamp(ctx.date, ctx.start) - end) / 1440)
    const dayMatch = isWorkday(a.date, ctx.preferences) === isWorkday(ctx.date, ctx.preferences) ? 1 : 0.35
    const explicit = a.suggestedFields?.includes('secondary') || b.suggestedFields?.includes('secondary') ? 0.2 : 1
    const score = 5 * Math.exp(-distance / 90) * Math.exp(-age / 7) * dayMatch * explicit
    const ids = secondaryIdsOf(b), key = b.category + ':' + keyOf(ids)
    if ((candidates.get(key)?.score ?? 0) >= score) continue
    const c = ctx.categories.find(c => c.id === b.category)!
    const project = isReadingActivity(ctx.categories, b.category, ids) ? projectDefault(ctx, b.category, ids) : ''
    const label = ids.length ? ids.map(id => c.children.find(s => s.id === id)!.name).join('＋') : c.name
    candidates.set(key, { category: b.category, secondaryIds: [...ids], project, label: label + (project ? ' · ' + project : ''), score, reason: '近期同段搭配，可改时间' })
  }
  const targets: [string, string | null][] = []
  const social = ctx.categories.find(c => c.name === '社交' && !c.archived)
  if (social && ctx.start >= 660 && ctx.start < 840 && names.some(n => ['快走', '吃饭'].includes(n))) targets.push([social.id, null])
  if (sourceKind === 'training') targets.push(['fun', '听小说'])
  // Built-in chat keeps its meaning after renaming; use the current display name.
  const childFor = (c: Category | undefined, name: string | null) => {
    if (name === '聊天' && c?.id === 'family') {
      const bound = c.children.find(s => s.id === 'family-4')
      if (bound) return bound.archived ? undefined : bound
      return c.children.find(s => !s.archived && ['聊天', '聊天与沟通'].includes(s.name))
    }
    return c?.children.find(s => s.name === name && !s.archived)
  }
  for (const [category, name] of targets) {
    const c = ctx.categories.find(c => c.id === category && !c.archived)
    const child = childFor(c, name)
    if (!c || (name && !child)) continue
    const ids = child ? [child.id] : []
    const key = category + ':' + keyOf(ids)
    if (candidates.has(key)) continue
    const project = projectDefault(ctx, category, ids)
    candidates.set(key, { category, secondaryIds: ids, label: (name ?? c.name) + (project ? ' · ' + project : ''), project, score: 0.1, reason: '常用搭配，可改时间' })
  }
  if (!profile.confirmedCompanions) return [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, 3)
  // User-confirmed routines override incidental overlaps. They only create optional chips.
  const removeKind = (...kinds: string[]) => { for (const [key, c] of candidates) if (kinds.includes(kind(c.category, c.secondaryIds))) candidates.delete(key) }
  const offer = (category: string, name: string | null, score: number, project: string | null = '', label?: string, maxMinutes?: number) => {
    const c = ctx.categories.find(c => c.id === category && !c.archived)
    const child = childFor(c, name)
    if (!c || (name && !child)) return
    const ids = child ? [child.id] : []
    const object = project === null ? projectDefault(ctx, category, ids) : project
    candidates.set(category + ':' + keyOf(ids), { category, secondaryIds: ids, project: object, label: label ?? (child?.name ?? c.name) + (object ? ' · ' + object : ''), score, reason: '按你的常用组合，点击添加后可调整', ...(maxMinutes ? { maxMinutes } : {}) })
  }
  if (sourceKind === 'sleep') {
    candidates.clear()
    offer('fun', '听小说', 100, null, '入睡前听小说 · 10 分钟', 10)
  }
  if (['cook', 'chores', 'commute', 'meal', 'stairs'].includes(sourceKind)) offer('family', '聊天', 50)
  if (sourceKind === 'chores') offer('fun', '听小说', 40, null)
  if (sourceKind === 'tidy') offer('fun', '听小说', 0.2, null)
  // Do not guess the other person when returning from a generic chat shortcut.
  if (sourceKind === 'chat') for (const c of candidates.values()) {
    if (['chores', 'cook', 'commute', 'meal'].includes(kind(c.category, c.secondaryIds))) {
      c.project = ''; c.label = c.secondaryIds.map(id => ctx.categories.find(cat => cat.id === c.category)!.children.find(s => s.id === id)!.name).join('＋')
    }
  }
  if (sourceKind === 'walk') {
    removeKind('social', 'reading', 'novel', 'pickup', 'chat')
    if (social) offer(social.id, null, 101, '', '社交')
    const reading = ctx.categories.find(c => c.id === 'learn')?.children.find(s => !s.archived && /读.*书|听.*书|课程/.test(s.name))
    if (reading) offer('learn', reading.name, 100)
  }
  const afternoonPickup = ctx.start >= (profile.pickup?.start ?? 1020) && ctx.start < (profile.pickup?.end ?? 1110)
  if (sourceKind === 'walk' && isPickupDay(ctx) && ctx.start >= (profile.pickup?.returnStart ?? 1050) && ctx.start < (profile.pickup?.end ?? 1095)) {
    offer('family', profile.pickup!.activity, 103)
    offer('family', '聊天', 102, profile.pickup?.person ?? '')
  }
  if (sourceKind === 'pickup' && afternoonPickup) {
    removeKind('walk', 'chat', 'novel')
    if (isPickupDay(ctx)) {
      if (ctx.start < (profile.pickup?.returnStart ?? 1050)) offer('fun', '听小说', 101, null)
      else { offer('health', '快走', 101); offer('family', '聊天', 100, profile.pickup?.person ?? '') }
    }
  }
  if (!isPickupDay(ctx) || (afternoonPickup && ctx.start < (profile.pickup?.returnStart ?? 1050) && sourceKind !== 'novel')) removeKind('pickup')
  return [...candidates.values()].sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, 'zh-CN')).slice(0, 3)
}
