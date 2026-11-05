'use client'

import type { CSSProperties } from 'react'
import { activityTitle, secondaryNames, type Category } from '@/shared/lib/ledger-v2'
import { allowsUnregisteredPeople, changePeopleText, syncPeopleContext } from '@/shared/lib/people-input'
import type { Entity, RecordContext } from '@/shared/lib/collaboration'
import { toolProjectPatch, type QuickContext, type QuickDraft } from '@/shared/lib/quick-input'
import { ActivityInput } from './activity-input'
import { SecondaryPicker } from './secondary-picker'
import { ProjectShortcuts, RecentProjects, VideoStagePicker } from './quick-input-controls'
import { ContextFields } from './context-fields'

export type EntryDraft = QuickDraft & { context?: RecordContext; entryKey?:string; id:string; date:string; start:string; end:string; nextDay:boolean; activity:string; note:string; approximate:boolean; followMain?:boolean }
export function EntryActivityFields({draft,context,categories,entities,recentIds,legacy,onChange,onCreate}: {
  draft:EntryDraft; context:QuickContext; categories:Category[]; entities:Entity[]; recentIds:string[]; legacy:boolean;
  onChange:(patch:Partial<EntryDraft>)=>void; onCreate:(entity:Entity)=>Promise<boolean>
}) {
  const title=activityTitle({...draft,activitySource:'category'},context.categories)
  const changeProject=(patch:Partial<EntryDraft>)=>onChange(toolProjectPatch(draft,patch,context.categories,entities))
  return <>
    <fieldset className="category-field" data-usage-field="category"><legend title="按最近30天记录次数排序；次数相同沿用分类管理顺序">归到哪一类</legend><div>{categories.filter(c=>!c.archived || (legacy && c.id===draft.category)).map(c=><button type="button" aria-pressed={draft.category===c.id} className={draft.category===c.id?'category-selected':''} key={c.id} onClick={()=>onChange({category:c.id,...(draft.category!==c.id?{secondaryIds:[]}: {})})} style={{'--category-color':c.color} as CSSProperties}><i/>{c.name}{c.archived?'（归档）':''}</button>)}</div></fieldset>
    <SecondaryPicker key={(draft.entryKey ?? draft.id) + ':' + draft.category} draft={draft} context={context} onChange={onChange}/>
    <VideoStagePicker draft={draft} context={context} onChange={onChange}/>
    <label className="field-label">项目 / 对象 <small>选填</small><input data-usage-field="project" data-usage-automatic={draft.suggestedFields?.includes('project')??false} aria-label="项目或对象" value={draft.project} maxLength={100} onChange={e=>changeProject(changePeopleText(draft,e.target.value,entities,()=>crypto.randomUUID(),legacy,allowsUnregisteredPeople(context.categories,draft.category,draft.secondaryIds)))} placeholder="哪件事、哪本书、和谁"/></label>
    <ProjectShortcuts draft={draft} context={context} entities={entities} onChange={changeProject}/>
    <RecentProjects key={draft.id+draft.category+draft.secondaryIds.join()} draft={draft} context={context} onChange={changeProject} entities={entities} legacy={legacy}/>
    <label className="field-label activity-description">做了什么 <small>选填 · 手写描述优先</small><ActivityInput label="活动名称" describedBy="activity-display-hint" value={draft.activity} onChange={activity=>onChange({activity})} placeholder={`留空使用：${title}`}/></label>
    <div className="activity-name-hint" id="activity-display-hint"><span>时间轴显示：<b>{draft.activity.trim()||title}</b></span>{draft.activity.trim()&&<button type="button" data-usage-action="category-name" onClick={()=>onChange({activity:''})}>使用分类名</button>}</div>
    <ContextFields key={draft.id} legacyNote={draft.note} bookRole={/读|听书|听小说/.test(secondaryNames(draft,context.categories))?'reading':'reference'} personRole={/聊天|开会|沟通|辅导|陪伴|接送|聚会/.test(secondaryNames(draft,context.categories))?'together':'mentioned'} value={draft.context} entities={entities} recentIds={recentIds} legacy={legacy} onChange={value=>onChange(syncPeopleContext(draft,value,entities))} onCreate={onCreate}/>
  </>
}
