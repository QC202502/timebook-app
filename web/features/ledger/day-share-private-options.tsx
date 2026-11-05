'use client'

import { useMemo, useState } from 'react'
import { activityTitle, categoryOf, clock, type Category, type LedgerRecord } from '@/shared/lib/ledger-v2'
import { dayShareRecords, type DayShareOptions } from '@/shared/lib/day-share'
import type { Entity } from '@/shared/lib/collaboration'

type Props = { records: LedgerRecord[]; categories: Category[]; entities: Entity[]; date: string; options: DayShareOptions; disabled: boolean; onChange: (options: DayShareOptions) => void }

/** This picker is private UI only. The canvas receives buildDayShare's allowlisted projection. */
export function DaySharePrivateOptions({ records, categories, entities, date, options, disabled, onChange }: Props) {
  const [search, setSearch] = useState('')
  const candidates = useMemo(() => dayShareRecords(records, date, options.range).map(r => {
    const linkedIds = [r.context?.projectId, ...(r.context?.books.map(b => b.id) ?? []), ...(r.context?.people.map(p => p.id) ?? [])]
    const related = [...new Set([r.project, ...entities.filter(e => linkedIds.includes(e.id)).map(e => e.name)].filter(Boolean))].join(' · ')
    return { record: r, title: activityTitle(r, categories), category: categoryOf(r.category, categories).name, related }
  }), [records, categories, entities, date, options.range])
  const selected = new Set(options.selectedIds ?? [])
  const chosen = candidates.filter(c => selected.has(c.record.id))
  const query = search.trim().toLocaleLowerCase()
  const matches = candidates.filter(c => `${c.title} ${c.category} ${c.related}`.toLocaleLowerCase().includes(query))
  function toggle(id: string) {
    const next = new Set(options.selectedIds ?? [])
    if (next.has(id)) next.delete(id); else next.add(id)
    onChange({ ...options, selectedIds: [...next] })
  }
  return <fieldset className="share-private-options" disabled={disabled}>
    <legend>选择公开活动 <span>已选 {chosen.length} 条</span></legend>
    <label className="share-private-search"><input type="search" aria-label="搜索公开活动" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索活动或人物" /></label>
    <div className="share-record-list">
      {matches.map(({ record: r, title, category, related }) => <label key={r.id} className={`share-record-choice${selected.has(r.id) ? ' is-public' : ''}`}>
        <input type="checkbox" aria-label={`公开 ${clock(r.start)}—${clock(r.end)} ${title}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
        <span><small className="share-record-time">{clock(r.start)}—{clock(r.end)}</small><span className="share-record-title">{title}</span><small className="share-record-context">{[category, related].filter(Boolean).join(' · ')}</small></span>
      </label>)}
      {!matches.length && <p className="share-note">{candidates.length ? '没有匹配活动，可换个关键词。' : '这个图片范围内没有记录。'}</p>}
    </div>
    {chosen.length > 0 && <button type="button" className="share-clear" onClick={() => onChange({ ...options, selectedIds: [] })}>取消全部选择</button>}
    {chosen.map(({ record: r, title }) => <label className="share-public-text" key={r.id}>
      <span>分享文字 <small>{clock(r.start)}—{clock(r.end)}</small></span>
      <textarea rows={3} aria-label={`${clock(r.start)}—${clock(r.end)} 分享文字`} value={options.shareTitles?.[r.id] ?? title} onChange={e => onChange({ ...options, shareTitles: { ...options.shareTitles, [r.id]: e.target.value } })} />
    </label>)}
    {!!chosen.length && <p className="share-note share-edit-hint">只修改图片里的文字，原记录不变。</p>}
    <label className="share-neutral-option"><input type="checkbox" checked={!!options.neutralHiddenColors} onChange={e => onChange({ ...options, neutralHiddenColors: e.target.checked })} /> 统一其他活动颜色</label>
  </fieldset>
}
