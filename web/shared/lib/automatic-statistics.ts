import { profile } from '../../config/profile.ts'
import { activityTitle, secondaryIdsOf, VIDEO_STAGES, type Category, type LedgerRecord } from './ledger-v2.ts'
import { emptyContext, type Collaboration, type Entity, type EntityKind } from './collaboration.ts'
import { contextSummary, projectSummary, humanSegments } from './collaboration-stats.ts'
import { isReadingActivity } from './quick-input.ts'
import { peopleInText, personName } from './people-input.ts'
import { summarizePeriod, type ReportRange, type ReportNow } from './ledger-stats.ts'

export type InferredLink = { recordId: string; entityId: string; kind: EntityKind; source: '原项目 / 对象' | '二级分类' | '活动描述'; text: string }
const unquote = (text: string) => text.trim().replace(/^[《「“](.+)[》」”]$/, '$1')
const development = (text: string) => /^开发[「《“]([^」》”]+)[」》”]$/.exec(text.trim())?.[1] ?? ''
const canonical = (kind: EntityKind, text: string) => (kind === 'person' ? personName(text) : kind === 'project' ? development(text) || unquote(text) : unquote(text)).normalize('NFC').trim()
const projectKey = (text: string) => canonical('project', text).replace(/\s+/gu, '').toLowerCase()
// User-reviewed exclusions for automatic project groups only. Explicit saved links take precedence.
const excludedAutomaticProjects = new Set(profile.excludedProjects.map(projectKey))
const projectWords = /(ETF|项目|开发|系统|工具|方案|制度|修订|基金|培训|产品|平台|计划|研究)/i
const namesOnly = (text: string) => {
  const names = text.trim().replace(/^和/, '').split(/[、，,＋+]/).map(s => s.trim())
  // A constrained subject, not arbitrary sentences or names split at 和/与.
  return names.length && names.every(n => /^[\p{Script=Han}·]{2,6}$/u.test(n) && !/(一起|公司|部门|朋友|同事|方案|问题|学习|聊天|团队|学校|工作|家长们)/.test(n)) ? [...new Set(names)] : []
}
/** Read-only projection. Virtual IDs and contexts MUST NEVER be passed to the save API. */
export function deriveStatistics(data: Collaboration, records: LedgerRecord[], categories: Category[]) {
  const entities = [...data.entities], virtualIds = new Set<string>(), inferred: InferredLink[] = []
  const unresolved: { recordId: string; text: string }[] = []
  function entity(kind: EntityKind, text: string) {
    const name = canonical(kind, text)
    const matches = entities.filter(e => e.kind === kind && canonical(kind, e.name) === name)
    if (matches.length === 1) return matches[0]
    // No merging of distinct registered profiles. Namespace cannot collide with valid persisted IDs.
    const id = 'derived:' + kind + ':' + name
    let item = entities.find(e => e.id === id)
    if (!item) { item = { id, kind, name, status: 'active' }; entities.push(item); virtualIds.add(id) }
    return item
  }
  const projected = records.map(r => {
    const ids = secondaryIdsOf(r), category = categories.find(c => c.id === r.category)
    const secondary = (category?.children ?? []).filter(s => ids.includes(s.id)).map(s => s.name)
    const raw = r.project.trim(), reading = isReadingActivity(categories, r.category, ids) || secondary.some(name => /听课/.test(name))
    const context = { ...(r.context ?? emptyContext('legacy')), books: [...(r.context?.books ?? [])], people: [...(r.context?.people ?? [])] }
    let changed = false, usedRaw = false
    function infer(kind: EntityKind, name: string, source: InferredLink['source'], text: string) {
      const item = entity(kind, name)
      inferred.push({ recordId: r.id, entityId: item.id, kind, source, text }); changed = true
      if (source === '原项目 / 对象') usedRaw = true
      return item.id
    }
    if (!context.books.length && raw && reading && !peopleInText(raw, entities).length) {
      context.books.push({ id: infer('book', raw, '原项目 / 对象', raw), role: 'reading' })
    }
    if (!context.people.length) {
      let people = peopleInText(raw, entities), source: InferredLink['source'] = '原项目 / 对象', evidence = raw
      if (!people.length && raw && (r.category === 'social' || category?.name === '社交')) people = namesOnly(raw)
      if (!people.length) {
        const together = /^和(.+?)一起(?:走路|散步|快走|吃|聊|运动|做)/.exec(r.activity.trim())
        const exact = /^和([^。！？~～:：]+)$/.exec(r.activity.trim())
        people = together ? namesOnly(together[1]) : exact ? namesOnly(exact[1]) : []
        source = '活动描述'; evidence = r.activity
      }
      if (people.length) context.people = people.map(name => ({ id: infer('person', name, source, evidence), role: 'together' as const }))
    }
    if (!context.projectId) {
      const explicitName = raw && !reading && !peopleInText(raw, entities).length ? data.entities.filter(e => e.kind === 'project' && canonical('project', e.name) === canonical('project', raw)) : []
      let name = '', source: InferredLink['source'] = '二级分类', evidence = secondary.join('、')
      const dev = secondary.map(development).find(Boolean)
      if (explicitName.length === 1) { name = explicitName[0].name; source = '原项目 / 对象'; evidence = raw }
      else if (!reading && !usedRaw && development(raw)) { name = development(raw); source = '原项目 / 对象'; evidence = raw }
      else if (secondary.includes('视频日记')) {
        name = '视频日记'
        if (!context.stage && !r.stage && VIDEO_STAGES.some(s => s === raw)) { context.stage = raw; usedRaw = true }
      } else if (dev) { name = dev }
      else if (raw && !reading && !usedRaw && !peopleInText(raw, entities).length && secondary.some(s => ['工具与系统建设', '教育工具建设'].includes(s))) {
        name = raw; source = '原项目 / 对象'; evidence = raw
      }
      else if (r.category === 'work' || category?.name === '工作') {
        if (raw && !usedRaw && !peopleInText(raw, entities).length && projectWords.test(raw)) { name = raw; source = '原项目 / 对象'; evidence = raw }
        else name = secondary.join('、') || '其他工作事项'
      }
      if (name && excludedAutomaticProjects.has(projectKey(name))) {
        // Deliberately omitted, not an unrecognized object. Do not create a fallback group.
        if (source === '原项目 / 对象') usedRaw = true
      } else if (name) context.projectId = infer('project', name, source, evidence)
    }
    if (raw && !usedRaw && !r.context?.projectId && !r.context?.books.length && !r.context?.people.length) unresolved.push({ recordId: r.id, text: raw })
    return changed ? { ...r, context } : r
  })
  return { data: { ...data, entities }, records: projected, virtualIds, inferred, unresolved }
}
export function activeProjects(data: Collaboration, records: LedgerRecord[], range: ReportRange, now: ReportNow, elapsed: boolean) {
  return projectSummary(data, records, range, now, elapsed).filter(p => p.human.count > 0 || p.agent.entries.length > 0)
}
export function objectSummary(data: Collaboration, records: LedgerRecord[], range: ReportRange, now: ReportNow, elapsed: boolean, kind?: 'book' | 'person') {
  return data.entities.filter(e => e.kind !== 'project' && (!kind || e.kind === kind)).map(entity => {
    const all = contextSummary(records, range, now, elapsed, c => (entity.kind === 'book' ? c.books : c.people).some(l => l.id === entity.id))
    const actual = contextSummary(records, range, now, elapsed, c => entity.kind === 'book' ? c.books.some(l => l.id === entity.id && l.role === 'reading') : c.people.some(l => l.id === entity.id && l.role === 'together'))
    return { entity, all, actual }
  }).filter(r => r.all.count > 0).sort((a, b) => b.actual.covered - a.actual.covered || b.all.covered - a.all.covered)
}
export function activityRollup(records: LedgerRecord[], categories: Category[], range: ReportRange, now: ReportNow, elapsed: boolean) {
  const labels = [...new Set(records.map(r => activityTitle(r, categories)))]
  return labels.map(name => ({ name, ...summarizePeriod(humanSegments(records.filter(r => activityTitle(r, categories) === name)), [], range, {}, now, elapsed) })).filter(r => r.count).sort((a, b) => b.covered - a.covered)
}
