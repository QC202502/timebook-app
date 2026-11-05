import { validContext, type RecordContext, type Collaboration, type CollaborationChange } from './collaboration.ts'
const SEEDS = [
  { id: 'work', name: '工作', color: '#3f6960', activities: ['写方案', '开会', '沟通', '业务研究'] },
  { id: 'learn', name: '学习成长', color: '#687db3', activities: ['读书', '听书', '听课', '练习'] },
  { id: 'create', name: '内容创作', color: '#b5744c', activities: ['视频日记', '写作', '剪辑', '封面'] },
  { id: 'family', name: '家庭与家务', color: '#ad6985', activities: ['陪伴', '辅导', '聚会', '聊天'] },
  { id: 'health', name: '运动健康', color: '#778b49', activities: ['走路', '跑步', '力量训练', '拉伸'] },
  { id: 'life', name: '个人生活与出行', color: '#b39853', activities: ['吃饭', '家务', '通勤', '洗漱'] },
  { id: 'fun', name: '休闲娱乐', color: '#9c795d', activities: ['听音乐', '听小说', '看电影', '游戏'] },
  { id: 'rest', name: '睡眠休息', color: '#8e88a5', activities: ['睡觉', '午休', '放空'] },
  { id: 'recording', name: '记录与系统', color: '#6555aa', activities: ['统计和分析', '工具与系统建设'] },
  { id: 'social', name: '社交', color: '#b46b92', activities: ['朋友', '同事'] },
  { id: 'other', name: '未分类', color: '#969a94', activities: [] }
] as const

export type SecondaryCategory = { id: string; name: string; archived: boolean }
export type Category = { id: string; name: string; color: string; archived: boolean; children: SecondaryCategory[]; multipleSecondaries?: boolean }
export const CATEGORIES: Category[] = SEEDS.map(c => ({ id: c.id, name: c.name, color: c.color, archived: false,
  children: c.activities.map((name, i) => ({ id: `${c.id}-${i + 1}`, name, archived: false })) }))
export type CategoryId = string
export const VIDEO_STAGES = ['选题', '写稿', '录制', '剪辑', '发布'] as const
export type VideoStage = typeof VIDEO_STAGES[number]
export type LedgerRecord = {
  id: string; date: string; start: number; end: number; category: CategoryId; secondaryId?: string | null; secondaryIds?: string[]
  activity: string; activitySource?: 'category' | 'custom'; project: string; note: string; approximate: boolean
  context?: RecordContext
  stage?: VideoStage | ''
  suggestedFields?: ('secondary' | 'project')[]
}
export type Snapshot = { revision: number; records: LedgerRecord[]; categories: Category[]; collaboration?: Collaboration }
export type CategoryAction =
  | { type: 'save-primary'; id: string; name: string; color: string }
  | { type: 'save-secondary'; id: string; parentId: string; name: string }
  | { type: 'reorder'; id: string; direction: -1 | 1 }
  | { type: 'archive'; id: string; archived: boolean }
  | { type: 'merge'; sourceId: string; targetId: string }
export type Change = { batchIntents?: { id: string; kind: 'create' | 'update' }[]; clearContextIds?: string[]; collaborationChange?: CollaborationChange; upserts: LedgerRecord[]; deleteIds: string[]; categoryAction?: CategoryAction; recordIntent?: { kind: 'create' | 'update'; id: string }; createIds?: string[]; confirmedReplacementIds?: string[] }
export const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id)
const validName = (name: unknown): name is string => typeof name === 'string' && name.trim() === name && name.length > 0 && name.length <= 40
export const categoryOf = (id: string, categories: Category[] = CATEGORIES): Category => categories.find(c => c.id === id) ?? categories.find(c => c.id === 'other') ?? CATEGORIES[CATEGORIES.length - 1]
// Keep the compatibility fallback in storage, but do not present an unused bucket as a user category.
export const isUnusedFallbackCategory = (category: Category, records: LedgerRecord[]) => category.id === 'other' && !category.children.length && !records.some(r => r.category === 'other')
export const visiblePrimaryCategories = (categories: Category[], records: LedgerRecord[]) => categories.filter(c => !isUnusedFallbackCategory(c, records))
type Classification = Pick<LedgerRecord, 'category' | 'secondaryId' | 'secondaryIds'>
export const allowsMultipleSecondaries = (category: Category) => category.id === 'health' || category.multipleSecondaries === true
export const secondaryIdsOf = (r: Pick<LedgerRecord, 'secondaryId' | 'secondaryIds'>): string[] => r.secondaryIds ?? (r.secondaryId ? [r.secondaryId] : [])
export const sameSecondaries = (a: Classification, b: Classification) => [...secondaryIdsOf(a)].sort().join('|') === [...secondaryIdsOf(b)].sort().join('|')
export const secondariesOf = (r: Classification, categories: Category[] = CATEGORIES) => categoryOf(r.category, categories).children.filter(c => secondaryIdsOf(r).includes(c.id))
export const secondaryOf = (r: Classification, categories: Category[] = CATEGORIES) => secondariesOf(r, categories)[0]
export const secondaryNames = (r: Classification, categories: Category[] = CATEGORIES) => secondariesOf(r, categories).map(c => c.name).join('、')
// Keep the legacy first ID for older readers; do not rewrite untouched single-select records.
export function withSecondaries<T extends Classification>(record: T, ids: string[]): T {
  const unique = [...new Set(ids)]
  return { ...record, secondaryId: unique[0] ?? null, ...(record.secondaryIds !== undefined || unique.length > 1 ? { secondaryIds: unique } : {}) }
}
// Auto names are derived at display time; legacy text remains custom unless explicitly changed.
export const isVideoDiary = (r: Classification, categories: Category[]) => secondariesOf(r, categories).some(s => s.name === '视频日记')
export function activityTitle(r: Classification & Pick<LedgerRecord, 'activity' | 'activitySource' | 'stage'>, categories: Category[] = CATEGORIES) {
  const base = secondaryNames(r, categories) || categoryOf(r.category, categories).name
  return r.activitySource === 'category' ? base + (r.stage ? ` · ${r.stage}` : '') : r.activity
}
export function activityInput(r: Pick<LedgerRecord, 'activity' | 'activitySource'>) {
  return r.activitySource === 'category' ? '' : r.activity
}
export function activityFields(input: string): Pick<LedgerRecord, 'activity' | 'activitySource'> {
  const activity = input.trim()
  return { activity, activitySource: activity ? 'custom' : 'category' }
}
export function validCategories(value: unknown): value is Category[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) return false
  const ids = new Set<string>(), names = new Set<string>()
  for (const c of value) {
    if (c?.multipleSecondaries !== undefined && typeof c.multipleSecondaries !== 'boolean') return false
    if (!c || !validId(c.id) || ids.has(c.id) || !validName(c.name) || names.has(c.name.toLocaleLowerCase()) || typeof c.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(c.color) || typeof c.archived !== 'boolean' || !Array.isArray(c.children) || c.children.length > 100) return false
    ids.add(c.id); names.add(c.name.toLocaleLowerCase())
    const childrenNames = new Set<string>()
    for (const child of c.children) {
      if (!child || !validId(child.id) || ids.has(child.id) || !validName(child.name) || childrenNames.has(child.name.toLocaleLowerCase()) || typeof child.archived !== 'boolean') return false
      ids.add(child.id); childrenNames.add(child.name.toLocaleLowerCase())
    }
  }
  return value.some(c => c.id === 'other' && !c.archived)
}
// Upgrade only exact matches to the old built-in activity suggestions. Free text stays untouched.
export function migrateLegacyRecords(records: LedgerRecord[]): LedgerRecord[] {
  return records.map(r => ({ ...r, secondaryId: categoryOf(r.category).children.find(c => c.name === r.activity)?.id ?? null }))
}
export function applyCategoryAction(categories: Category[], records: LedgerRecord[], action: CategoryAction) {
  const next = structuredClone(categories)
  let updated = records
  const fail = (message: string): never => { throw new Error(message) }
  if (!action || typeof action !== 'object') return fail('分类操作格式不正确。')
  const allIds = () => next.flatMap(c => [c.id, ...c.children.map(s => s.id)])
  const primary = (id: string) => next.find(c => c.id === id)
  const parent = (id: string) => next.find(c => c.children.some(s => s.id === id))
  switch (action.type) {
    case 'save-primary': {
      if (!validId(action.id) || !validName(action.name) || typeof action.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(action.color)) return fail('分类名称需为 1–40 字，颜色需有效。')
      const c = primary(action.id)
      if (c) { c.name = action.name; c.color = action.color }
      else { if (allIds().includes(action.id)) return fail('分类编号重复。'); next.push({ id: action.id, name: action.name, color: action.color, archived: false, children: [] }) }
      break
    }
    case 'save-secondary': {
      if (!validId(action.id) || !validName(action.name)) return fail('分类名称需为 1–40 字。')
      const target = primary(action.parentId), source = parent(action.id)
      if (!target || target.archived) return fail('请选择启用的一级分类。')
      if (primary(action.id)) return fail('分类编号重复。')
      if (source) {
        const child = source.children.find(c => c.id === action.id)!
        child.name = action.name
        if (source.id !== target.id) {
          if (records.some(r => secondaryIdsOf(r).includes(action.id) && secondaryIdsOf(r).length > 1)) return fail('这个动作被用于多选记录，不能单独跨一级移动。请先调整相关记录的动作选择，或合并整个一级分类。')
          source.children = source.children.filter(c => c.id !== action.id); target.children.push(child)
          updated = records.map(r => secondaryIdsOf(r).includes(action.id) ? { ...r, category: target.id } : r)
        }
      } else target.children.push({ id: action.id, name: action.name, archived: false })
      break
    }
    case 'reorder': {
      if (action.direction !== -1 && action.direction !== 1) return fail('排序方向不正确。')
      const list = primary(action.id) ? next : parent(action.id)?.children
      if (!list) return fail('分类不存在，请刷新。')
      const i = list.findIndex(c => c.id === action.id)
      let j = i + action.direction
      while (list === next && action.id !== 'other' && j >= 0 && j < list.length && isUnusedFallbackCategory(next[j], records)) j += action.direction
      if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]]
      break
    }
    case 'archive': {
      if (typeof action.archived !== 'boolean' || action.id === 'other') return fail('未分类需保持启用。')
      const c = primary(action.id) ?? parent(action.id)?.children.find(c => c.id === action.id)
      if (!c) return fail('分类不存在，请刷新。')
      c.archived = action.archived
      break
    }
    case 'merge': {
      if (action.sourceId === action.targetId || action.sourceId === 'other') return fail('请选择不同的目标；未分类需保留。')
      const source = primary(action.sourceId), target = primary(action.targetId)
      if (source && target && !target.archived) {
        if (allowsMultipleSecondaries(source)) target.multipleSecondaries = true
        const mapping = new Map<string, string>()
        for (const child of source.children) {
          const match = target.children.find(s => s.name.toLocaleLowerCase() === child.name.toLocaleLowerCase())
          if (match) mapping.set(child.id, match.id)
          else { target.children.push(child); mapping.set(child.id, child.id) }
        }
        next.splice(next.indexOf(source), 1)
        updated = records.map(r => r.category === source.id ? withSecondaries({ ...r, category: target.id }, secondaryIdsOf(r).map(id => mapping.get(id)!)) : r)
      } else {
        const sp = parent(action.sourceId), tp = parent(action.targetId)
        const dest = tp?.children.find(c => c.id === action.targetId)
        if (!sp || !tp || tp.archived || !dest || dest.archived) return fail('合并目标必须是启用的同级分类。')
        if (sp.id !== tp.id && records.some(r => secondaryIdsOf(r).includes(action.sourceId) && secondaryIdsOf(r).length > 1)) return fail('这个动作被用于多选记录，不能单独跨一级合并。请先调整相关记录的动作选择，或合并整个一级分类。')
        sp.children = sp.children.filter(c => c.id !== action.sourceId)
        updated = records.map(r => secondaryIdsOf(r).includes(action.sourceId) ? withSecondaries({ ...r, category: tp.id }, secondaryIdsOf(r).map(id => id === action.sourceId ? dest.id : id)) : r)
      }
      break
    }
    default: return fail('未知分类操作。')
  }
  if (!validCategories(next)) return fail('分类名称不能与同级重复（含已归档），一级和每组二级各最多 100 个。')
  if (!updated.every(r => validRecord(r, next))) return fail('分类调整会使记录归属无效，未保存。')
  return { categories: next, records: updated }
}
export function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
}
export function addDays(date: string, days: number) {
  return new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10)
}
export function shanghaiNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const get = (key: string) => parts.find(p => p.type === key)!.value
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minute: Number(get('hour')) * 60 + Number(get('minute')) }
}
export function clock(minute: number) {
  if (minute === 1440) return '24:00'
  const m = ((minute % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
export function duration(minutes: number) {
  return minutes < 60 ? `${minutes} 分` : `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分` : ''}`
}
export function parseClock(value: string) {
  if (value === '24:00') return 1440
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return NaN
  const [h, m] = value.split(':').map(Number)
  return h * 60 + m
}
export function parseTimeInput(value: string) {
  if (!/^\d{1,2}:\d{1,2}$/.test(value)) return NaN
  return parseClock(value.split(':').map(part => part.padStart(2, '0')).join(':'))
}
/** Minute stepping preserves the start date; only the end can cross midnight. */
export function stepClock(value: string, delta: number, nextDay = false, allowNextDay = false) {
  const minute = parseClock(value)
  if (!Number.isFinite(minute) || !Number.isInteger(delta)) return null
  const absolute = minute + (nextDay && allowNextDay ? 1440 : 0)
  const result = Math.max(0, Math.min(allowNextDay ? 2879 : 1439, absolute + delta))
  return { value: clock(result % 1440), nextDay: allowNextDay && result >= 1440 }
}
export function validRecordShape(value: unknown): value is LedgerRecord {
  if (!value || typeof value !== 'object') return false
  const r = value as LedgerRecord
  return (r.context === undefined || validContext(r.context) && (r.context.breaks ?? []).every(b => b.start >= r.start && b.end <= r.end)) && typeof r.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(r.id) && validDate(r.date) &&
    Number.isInteger(r.start) && Number.isInteger(r.end) && r.start >= 0 && r.start < 1440 &&
    r.end > r.start && r.end <= 2880 && r.end - r.start <= 1440 &&
    validId(r.category) && (r.secondaryId == null || validId(r.secondaryId)) &&
    (r.secondaryIds === undefined || (Array.isArray(r.secondaryIds) && r.secondaryIds.length <= 100 && r.secondaryIds.every(validId) && new Set(r.secondaryIds).size === r.secondaryIds.length && (r.secondaryId === undefined || r.secondaryId === (r.secondaryIds[0] ?? null)))) &&
    typeof r.activity === 'string' && (r.activitySource === 'category' || r.activity.trim().length > 0) &&
    (r.activitySource === undefined || r.activitySource === 'category' || r.activitySource === 'custom') &&
    (r.suggestedFields === undefined || (Array.isArray(r.suggestedFields) && r.suggestedFields.length <= 2 && r.suggestedFields.every(k => k === 'secondary' || k === 'project') && new Set(r.suggestedFields).size === r.suggestedFields.length)) &&
    (r.stage === undefined || r.stage === '' || VIDEO_STAGES.includes(r.stage)) &&
    typeof r.project === 'string' && r.project.length <= 100 && typeof r.note === 'string' && r.note.length <= 2000 && typeof r.approximate === 'boolean'
}
export function validRecord(value: unknown, categories: Category[] = CATEGORIES): value is LedgerRecord {
  if (!validRecordShape(value)) return false
  const c = categories.find(c => c.id === value.category)
  const ids = secondaryIdsOf(value)
  return !!c && (ids.length <= 1 || allowsMultipleSecondaries(c)) && ids.every(id => c.children.some(s => s.id === id))
}
export function isFuture(r: Pick<LedgerRecord, 'date' | 'end'>, now = shanghaiNow()) {
  return Date.parse(r.date + 'T00:00:00Z') + r.end * 60000 > Date.parse(now.date + 'T00:00:00Z') + now.minute * 60000
}
export function recordsForDay(records: LedgerRecord[], date: string) {
  return records.flatMap(r => {
    const offset = (Date.parse(date + 'T00:00:00Z') - Date.parse(r.date + 'T00:00:00Z')) / 86400000 * 1440
    const start = Math.max(0, r.start - offset), end = Math.min(1440, r.end - offset)
    return end > start ? [{ ...r, start, end }] : []
  }).sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id))
}
export function summarize(records: LedgerRecord[], date: string, limit = 1440, categories: Category[] = CATEGORIES) {
  const day = recordsForDay(records, date).map(r => ({ ...r, end: Math.min(r.end, limit) })).filter(r => r.end > r.start)
  const counts = new Uint16Array(1440)
  const masks = Object.fromEntries(categories.map(c => [c.id, new Uint8Array(1440)])) as Record<string, Uint8Array>
  const secondaryMasks = Object.fromEntries(categories.flatMap(c => [...c.children.map(s => [s.id, new Uint8Array(1440)]), [c.id + ":unset", new Uint8Array(1440)]])) as Record<string, Uint8Array>
  let total = 0
  for (const r of day) {
    const ids = secondaryIdsOf(r)
    for (let m = r.start; m < r.end; m++) {
      const originalMinute = m + (Date.parse(date + 'T00:00:00Z') - Date.parse(r.date + 'T00:00:00Z')) / 60000
      if (r.context?.breaks?.some(b => originalMinute >= b.start && originalMinute < b.end)) continue
      total++
      counts[m]++; if (masks[r.category]) masks[r.category][m] = 1
      for (const id of ids.length ? ids : [r.category + ':unset']) if (secondaryMasks[id]) secondaryMasks[id][m] = 1
    }
  }
  const covered = counts.reduce((s, n) => s + Number(n > 0), 0)
  const parallel = counts.reduce((s, n) => s + Number(n > 1), 0)
  return { total, covered, parallel, unrecorded: Math.max(0, limit - covered), categories: categories.map(c => ({ ...c, minutes: masks[c.id].reduce((s, n) => s + n, 0), children: [...c.children, { id: c.id + ':unset', name: '未设二级', archived: false }].map(s => ({ ...s, minutes: secondaryMasks[s.id].reduce((sum, n) => sum + n, 0) })) })) }
}
export function layoutLanes(records: LedgerRecord[]) {
  const ends: number[] = []
  return [...records].sort((a, b) => a.start - b.start || b.end - a.end || a.id.localeCompare(b.id)).map(record => {
    let lane = ends.findIndex(end => end <= record.start)
    if (lane < 0) lane = ends.length
    ends[lane] = record.end
    return { record, lane }
  })
}
export const MAX_CONCURRENT_ACTIVITIES = 3
type TimeSpan = Pick<LedgerRecord, 'date' | 'start' | 'end'>
export function maxConcurrentActivities(records: TimeSpan[], window?: TimeSpan) {
  const absolute = (r: TimeSpan, edge: 'start' | 'end') => Date.parse(r.date + 'T00:00:00Z') / 60000 + r[edge]
  const lower = window ? absolute(window, 'start') : -Infinity
  const upper = window ? absolute(window, 'end') : Infinity
  const events = new Map<number, number>()
  for (const r of records) {
    const start = Math.max(lower, absolute(r, 'start')), end = Math.min(upper, absolute(r, 'end'))
    if (end <= start) continue
    events.set(start, (events.get(start) ?? 0) + 1)
    events.set(end, (events.get(end) ?? 0) - 1)
  }
  let current = 0, peak = 0
  // Combine starts and ends at each boundary: adjacent intervals never overlap.
  for (const minute of [...events.keys()].sort((a, b) => a - b)) {
    current += events.get(minute)!
    peak = Math.max(peak, current)
  }
  return peak
}

/** Display fragments only: original records and their durations remain intact. */
export function layoutFilledBlocks(records: LedgerRecord[], start: number, end: number) {
  const ordered = records.filter(r => r.start < end && r.end > start).sort((a, b) => a.start - b.start || b.end - a.end || a.id.localeCompare(b.id))
  const boundaries = [...new Set([start, end, ...ordered.flatMap(r => [Math.max(start, r.start), Math.min(end, r.end)])])].sort((a, b) => a - b)
  type Block = { record: LedgerRecord; start: number; end: number; slot: number; slots: number; showLabel: boolean }
  const blocks: Block[] = []
  const last = new Map<string, Block>()
  for (let i = 0; i < boundaries.length - 1; i++) {
    const left = boundaries[i], right = boundaries[i + 1]
    const active = ordered.filter(r => r.start < right && r.end > left)
    active.forEach((record, slot) => {
      const previous = last.get(record.id)
      if (previous && previous.end === left && previous.slot === slot && previous.slots === active.length) previous.end = right
      else {
        const block = { record, start: left, end: right, slot, slots: active.length, showLabel: false }
        blocks.push(block); last.set(record.id, block)
      }
    })
  }
  const labels = new Map<string, Block>()
  for (const block of blocks) {
    const previous = labels.get(block.record.id)
    if (!previous || (block.end - block.start) / block.slots > (previous.end - previous.start) / previous.slots) labels.set(block.record.id, block)
  }
  for (const block of labels.values()) block.showLabel = true
  return blocks
}
export function demoRecords(date: string): LedgerRecord[] {
  const data: Array<[string, number, number, CategoryId, string]> = [
    ['早餐与出门', 460, 492, 'life', ''], ['通勤', 495, 534, 'life', ''], ['听书', 499, 529, 'learn', '在读书目'],
    ['写方案', 547, 602, 'work', '产品方案'], ['听音乐', 560, 590, 'fun', ''], ['团队沟通', 610, 643, 'work', '产品方案'],
    ['午饭', 688, 717, 'life', ''], ['走路', 723, 761, 'health', ''], ['听书', 728, 752, 'learn', '在读书目'], ['记录灵感', 738, 745, 'create', ''],
    ['午休', 775, 798, 'rest', ''], ['整理素材', 817, 867, 'create', '视频日记'], ['写作', 880, 922, 'create', '视频日记']
  ]
  return migrateLegacyRecords(data.map(([activity, start, end, category, project], i) => ({ id: `demo-${i}`, date, start, end, category, activity, project, note: '', approximate: false })))
}
export function toCsv(records: LedgerRecord[], categories: Category[] = CATEGORIES) {
  const cell = (value: unknown) => {
    let s = String(value)
    if (/^[=+@\-\t\r]/.test(s)) s = "'" + s
    return '"' + s.replaceAll('"', '""') + '"'
  }
  const rows = records.map(r => [r.date, clock(r.start), addDays(r.date, Math.floor(r.end / 1440)), clock(r.end % 1440), r.end - r.start, categoryOf(r.category, categories).name, secondaryNames(r, categories) || '未设二级', activityTitle(r, categories), r.project, r.note, r.approximate ? '约' : '用户输入', r.stage ?? ''])
  return '\uFEFF' + [['开始日期', '开始时间', '结束日期', '结束时间', '活动分钟', '一级分类', '二级分类', '活动', '项目或对象', '备注', '时间性质', '制作阶段'], ...rows].map(row => row.map(cell).join(',')).join('\r\n')
}
