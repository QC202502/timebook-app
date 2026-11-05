'use client'

import { useState } from 'react'
import type { Entity } from '@/shared/lib/collaboration'
import { allowsUnregisteredPeople, peopleInText, recentPeople, selectedPeople, togglePerson } from '@/shared/lib/people-input'
import { clock, secondaryNames, isVideoDiary, VIDEO_STAGES } from '@/shared/lib/ledger-v2'
import { isProjectDrivenSelection, isReadingActivity, isWorkday, recentProjects, recentRecords, toolProjectChoices, workoutChoices, type QuickContext, type QuickDraft, type QuickPreferences } from '@/shared/lib/quick-input'

export function QuickAlternatives({ draft, context, onChange }: { draft: QuickDraft; context: QuickContext; onChange: (patch: Partial<QuickDraft>) => void }) {
  const category = context.categories.find(c => c.id === draft.category)
  const presets = category ? workoutChoices(category) : []
  if (!presets.length) return null
  return <div className="quick-alternatives" aria-label="动作组合" data-usage-group="secondary">
    <span>动作组合</span><div className="quick-chips">{presets.map(c => {
      const selected = [...draft.secondaryIds].sort().join() === [...c.secondaryIds].sort().join()
      return <button type="button" className={selected ? 'quick-selected' : ''} aria-pressed={selected} key={c.label} title={secondaryNames({ category: c.category, secondaryIds: c.secondaryIds }, context.categories)} onClick={() => onChange({ secondaryIds: selected ? [] : c.secondaryIds })}>{selected ? '✓ ' : ''}{c.label}</button>
    })}</div>
  </div>
}

export function ProjectShortcuts({ draft, context, entities, onChange }: { draft: QuickDraft; context: QuickContext; entities: Entity[]; onChange: (patch: Partial<QuickDraft>) => void }) {
  const choices = toolProjectChoices(context.categories, draft.category)
    .filter(c => context.categories.find(p => p.id === c.category)?.name !== '家庭与家务' || c.secondaryIds.some(id => draft.secondaryIds.includes(id)))
  if (!choices.length) return null
  return <div className="project-shortcuts" aria-label="工具项目快捷组合" data-usage-group="project"><span>项目快捷 · 同时选好二级分类</span><div className="quick-chips">{choices.map(choice => {
    const selected = draft.project === choice.project && choice.secondaryIds.length === draft.secondaryIds.length && choice.secondaryIds.every(id => draft.secondaryIds.includes(id))
    return <button type="button" key={choice.project} aria-pressed={selected} className={selected ? 'quick-selected' : ''} onClick={() => onChange({ secondaryIds: choice.secondaryIds, project: choice.project, ...(draft.context ? { context: { ...draft.context, projectId: entities.find(e => e.kind === 'project' && e.name === choice.project)?.id } } : {}) })}>{selected ? '✓ ' : ''}{choice.label}</button>
  })}</div></div>
}

export function RecentProjects({ draft, context, onChange, entities = [], legacy = false }: { draft: QuickDraft; context: QuickContext; onChange: (patch: Partial<QuickDraft>) => void; entities?: Entity[]; legacy?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [personCandidates, setPersonCandidates] = useState<string[]>([])
  const projects = recentProjects(context, draft.category, draft.secondaryIds)
  const books = isReadingActivity(context.categories, draft.category, draft.secondaryIds)
  const projectDriven = isProjectDrivenSelection(context.categories, draft.category, draft.secondaryIds)
  const peopleMode = !books && !projectDriven
  const allowUnregistered = peopleMode && allowsUnregisteredPeople(context.categories, draft.category, draft.secondaryIds)
  const people = peopleMode ? [...new Set([...recentPeople(projects, recentRecords(context), draft.category, draft.secondaryIds, entities, draft, allowUnregistered), ...personCandidates])] : []
  const selected = peopleMode ? selectedPeople(draft, entities, allowUnregistered) : []
  const shortcutProjects = new Set(toolProjectChoices(context.categories, draft.category).filter(c => c.secondaryIds.some(id => draft.secondaryIds.includes(id))).map(c => c.project))
  const others = (peopleMode ? projects.filter(p => !peopleInText(p, entities, allowUnregistered).length) : projects).filter(p => !shortcutProjects.has(p))
  if (!people.length && !others.length) return null
  return <div className="recent-projects" data-usage-group="project" data-usage-automatic={people.length ? false : draft.suggestedFields?.includes('project') ?? false} aria-label={people.length ? '近期人物' : books ? '近期书籍' : '近期项目对象'}>
    {!!people.length && <><span>近期人物 · 可多选</span><div className="quick-chips people-chips">{people.map(name => <button type="button" key={name} aria-pressed={selected.includes(name)} className={selected.includes(name) ? 'quick-selected' : 'quick-recommended'} onClick={() => { setPersonCandidates(people); onChange(togglePerson(draft, name, entities, () => crypto.randomUUID(), legacy, allowUnregistered)) }}>{selected.includes(name) ? '✓ ' : ''}{name}</button>)}</div></>}
    {!!others.length && <><span>{people.length ? '其他近期内容' : projectDriven ? '近期项目 · 点选' : books ? '近期在读' : '近期对象'}{draft.suggestedFields?.includes('project') ? ' · 已预填' : ''}</span>
    <div className="quick-chips">{(expanded ? others : others.slice(0, 3)).map(project => <button type="button" key={project} aria-pressed={draft.project === project} className={draft.project === project ? 'quick-selected' : 'quick-recommended'} onClick={() => onChange({ project })}>{project}</button>)}</div>
    {others.length > 3 && <button data-usage-action="expand" aria-expanded={expanded} className="quick-more" type="button" onClick={() => setExpanded(!expanded)}>{expanded ? '收起' : `全部 ${others.length} 项`}</button>}</>}
  </div>
}

export function QuickSettings({ date, value, onChange, warning }: { date: string; value: QuickPreferences; onChange: (p: QuickPreferences) => void; warning: string }) {
  return <details className="quick-settings"><summary>推荐设置 <span>{isWorkday(date, value) ? '工作日' : '休息日'} · 早晨 {clock(value.morningStart)}—{clock(value.morningEnd)}</span></summary>
    <div><span>每周工作日</span><div className="quick-weekdays">{['日', '一', '二', '三', '四', '五', '六'].map((name, index) => <label key={name}><input type="checkbox" checked={value.weekdays.includes(index)} onChange={e => onChange({ ...value, weekdays: e.target.checked ? [...value.weekdays, index] : value.weekdays.filter(d => d !== index) })} />{name}</label>)}</div></div>
    <label>本日（{date}）<select aria-label="本日类型" value={value.dayOverrides[date] === undefined ? 'auto' : value.dayOverrides[date] ? 'work' : 'rest'} onChange={e => { const dayOverrides = { ...value.dayOverrides }; if (e.target.value === 'auto') delete dayOverrides[date]; else dayOverrides[date] = e.target.value === 'work'; onChange({ ...value, dayOverrides }) }}><option value="auto">按每周设置</option><option value="work">工作日</option><option value="rest">休息日</option></select></label>
    <div className="quick-morning">{(['morningStart', 'morningEnd'] as const).map((key, i) => <label key={key}>{i ? '早晨结束' : '早晨开始'}<input type="time" aria-label={i ? '早晨结束' : '早晨开始'} value={clock(value[key])} onChange={e => { if (!e.target.value) return; const [h, m] = e.target.value.split(':').map(Number); const next = { ...value, [key]: h * 60 + m }; if (next.morningEnd > next.morningStart) onChange(next) }} /></label>)}</div>
    <small>设置保存在当前浏览器，可为调休单独调整日期。</small>{warning && <p role="alert">{warning}</p>}
  </details>
}

export function VideoStagePicker({ draft, context, onChange, label = '制作阶段' }: { draft: QuickDraft; context: QuickContext; onChange: (patch: Partial<QuickDraft>) => void; label?: string }) {
  if (!isVideoDiary(draft, context.categories) && !draft.stage) return null
  return <div className="quick-alternatives stage-picker" data-usage-group="stage" role="group" aria-label={label}>
    <span>{label} · 选填</span>
    <div className="quick-chips">{VIDEO_STAGES.map(stage => <button type="button" key={stage} aria-pressed={draft.stage === stage} className={draft.stage === stage ? 'quick-selected' : 'quick-recommended'} onClick={() => onChange({ stage })}>{stage}</button>)}
      {draft.stage && <button type="button" data-usage-action="clear-stage" onClick={() => onChange({ stage: '' })}>清除阶段</button>}
    </div>
  </div>
}
