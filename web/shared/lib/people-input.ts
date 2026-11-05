import { profile } from '../../config/profile.ts'
import { emptyContext, type Entity, type RecordContext } from './collaboration.ts'
import { secondaryIdsOf, type Category, type LedgerRecord } from './ledger-v2.ts'

export type PeopleDraft = { project: string; context?: RecordContext; pendingPeople?: Entity[] }
// Default report inference recognizes configured names and exact registered profiles.
// The entry UI can separately opt into unregistered names for person-oriented activities.
export function personName(value: string) {
  const name = value.trim()
  return name.startsWith('和') && profile.knownPeople.includes(name.slice(1)) ? name.slice(1) : name
}
export function allowsUnregisteredPeople(categories: Category[], category: string, secondaryIds: string[]) {
  const current = categories.find(c => c.id === category)
  if (current?.children.some(c => secondaryIds.includes(c.id) && /读.*书|听.*书|小说|课程|项目|开发/.test(c.name))) return false
  return current?.name === '社交' || ((category === 'family' || current?.name === '家庭与家务') && !!current?.children.some(c => secondaryIds.includes(c.id) && /聊天|陪伴|聚会/.test(c.name)))
}
export function peopleInText(value: string, entities: Entity[] = [], allowUnregistered = false): string[] {
  const text = value.trim()
  if (!text) return []
  const known = new Set([...profile.knownPeople, ...entities.filter(e => e.kind === 'person').map(e => personName(e.name))])
  if (known.has(text)) return [text]
  if (text.startsWith('和') && known.has(text.slice(1))) return [text.slice(1)]
  for (const a of known) for (const b of known) {
    if (['和', '与', '、', '，', ',', '＋', '+'].some(separator => [a + separator + b, '和' + a + separator + b, '和' + a + separator + '和' + b].includes(text))) return [...new Set([a, b])]
  }
  const parts = text.split(/[、，,；;＋+]/).map(v => v.trim()).filter(Boolean)
  if (parts.length > 1 && parts.every(p => known.has(p))) return [...new Set(parts)]
  // Entry candidates only, in person-oriented activities. Do not broaden report inference.
  if (allowUnregistered && parts.length && parts.every(p => known.has(p) || (/^[\p{Script=Han}·]{2,6}$/u.test(p) && !/(和|与|一起|项目|计划|方案|问题|工作|学习|交流|聊天|讨论|公司|学校|部门|团队|家长们)/.test(p)))) return [...new Set(parts)]
  return []
}
export function selectedPeople(draft: PeopleDraft, entities: Entity[], allowUnregistered = false) {
  return draft.context?.people.length ? [...new Set(draft.context.people.flatMap(p => { const e = entities.find(e => e.id === p.id && e.kind === 'person'); return e ? [personName(e.name)] : [] }))] : peopleInText(draft.project, entities, allowUnregistered)
}
export function recentPeople(projects: string[], records: LedgerRecord[], category: string, secondaryIds: string[], entities: Entity[], draft: PeopleDraft, allowUnregistered = false) {
  const ids = [...secondaryIds].sort().join('|')
  const linked = [...records].filter(r => r.category === category && [...secondaryIdsOf(r)].sort().join('|') === ids).sort((a, b) => b.date.localeCompare(a.date) || b.end - a.end).flatMap(r => r.context?.people.flatMap(p => { const e = entities.find(e => e.id === p.id && e.kind === 'person'); return e ? [personName(e.name)] : [] }) ?? [])
  const selected = selectedPeople(draft, entities, allowUnregistered)
  return [...new Set([...selected, ...linked, ...projects.flatMap(p => peopleInText(p, entities, allowUnregistered))])].filter(name => selected.includes(name) || !entities.some(e => e.kind === 'person' && personName(e.name) === name && e.status === 'archived'))
}
export function syncPeopleContext(draft: PeopleDraft, context: RecordContext, entities: Entity[]): { context: RecordContext; pendingPeople?: Entity[]; project?: string } {
  if (JSON.stringify(draft.context?.people ?? []) === JSON.stringify(context.people)) return { context }
  const linked = context.people.flatMap(p => { const e = entities.find(e => e.id === p.id && e.kind === 'person'); return e ? [e] : [] })
  const managed = !draft.project.trim() || peopleInText(draft.project, entities).length > 0
  return { context, pendingPeople: linked, ...(managed ? { project: linked.map(e => personName(e.name)).join('、') } : {}) }
}
function setPeople(draft: PeopleDraft, names: string[], entities: Entity[], newId: () => string, legacy: boolean) {
  const links = names.map(n => entities.find(e => e.kind === 'person' && personName(e.name) === n) ?? { id: newId(), kind: 'person' as const, name: n, status: 'active' as const })
  const context = draft.context ?? emptyContext(legacy ? 'legacy' : 'human')
  const people = links.map(e => context.people.find(p => p.id === e.id) ?? { id: e.id, role: 'together' as const })
  // Keep unresolved historical references rather than silently dropping them.
  const unresolved = context.people.filter(p => !entities.some(e => e.id === p.id))
  return { context: { ...context, people: [...people, ...unresolved] }, pendingPeople: links }
}
export function togglePerson(draft: PeopleDraft, name: string, entities: Entity[], newId: () => string, legacy = false, allowUnregistered = false) {
  const selected = selectedPeople(draft, entities, allowUnregistered)
  const names = selected.includes(name) ? selected.filter(n => n !== name) : [...selected, name]
  const managed = !draft.project.trim() || peopleInText(draft.project, entities, allowUnregistered).length > 0
  return { ...setPeople(draft, names, entities, newId, legacy), ...(managed ? { project: names.join('、') } : {}) }
}
/** Keep the editable person text and its links in sync without touching unrelated associations. */
export function changePeopleText(draft: PeopleDraft, value: string, entities: Entity[], newId: () => string, legacy = false, allowUnregistered = false) {
  const previous = peopleInText(draft.project, entities, allowUnregistered)
  const names = peopleInText(value, entities, allowUnregistered)
  if ((allowUnregistered && names.length) || (previous.length && draft.context?.people.length)) {
    return { ...setPeople(draft, names, entities, newId, legacy), project: value }
  }
  return { project: value }
}
/** Resolve all cards together, so one person has one stable profile and one atomic save. */
export function resolvePeople(records: LedgerRecord[], pending: Entity[], existing: Entity[]) {
  const added: Entity[] = [], declarations = new Map(pending.map(e => [e.id, e]))
  const upserts = records.map(r => {
    if (!r.context) return r
    const people = new Map<string, RecordContext['people'][number]>()
    for (const link of r.context.people) {
      const candidate = declarations.get(link.id)
      let id = link.id
      if (candidate) {
        const match = [...existing, ...added].find(e => e.kind === 'person' && personName(e.name) === personName(candidate.name))
        if (match) id = match.id
        else {
          if ([...existing, ...added].some(e => e.id === candidate.id)) throw new Error('人物档案编号冲突，请重新选择人物。')
          added.push(candidate)
        }
      }
      const before = people.get(id)
      people.set(id, { id, role: before?.role === 'together' ? 'together' : link.role })
    }
    return { ...r, context: { ...r.context, people: [...people.values()] } }
  })
  return { upserts, entities: added }
}
