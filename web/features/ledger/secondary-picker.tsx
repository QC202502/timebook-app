'use client'

import { useState } from 'react'
import { allowsMultipleSecondaries, categoryOf } from '@/shared/lib/ledger-v2'
import { secondariesByFrequency } from '@/shared/lib/category-frequency'
import { secondaryChoices, type QuickContext, type QuickDraft } from '@/shared/lib/quick-input'
import { QuickAlternatives } from './quick-input-controls'

export function SecondaryPicker({ draft, context, onChange, label = '记录二级分类' }: { draft: QuickDraft; context: QuickContext; onChange: (patch: Partial<QuickDraft>) => void; label?: string }) {
  const category = categoryOf(draft.category, context.categories), multiple = allowsMultipleSecondaries(category)
  // Parent remounts this picker for a new draft or primary category. Refreshes and
  // edits within the same draft must not move the button under the pointer.
  const [order] = useState(() => secondariesByFrequency(category, context.records, context.now.date).map(s => s.id))
  const children = category.children.filter(c => !c.archived || draft.secondaryIds.includes(c.id))
    .map((child, index) => ({ child, index, rank: order.indexOf(child.id) }))
    .sort((a, b) => (a.rank < 0 ? order.length + a.index : a.rank) - (b.rank < 0 ? order.length + b.index : b.rank)).map(row => row.child)
  const recommended = new Set(secondaryChoices(context, draft.category).filter(c => c.score > 0).slice(0, 3).flatMap(c => c.secondaryIds))
  return <fieldset className={`secondary-picker secondary-choice-field${multiple ? ' secondary-multiselect' : ''}`} data-usage-field="secondary" data-usage-automatic={draft.suggestedFields?.includes('secondary') ?? false}>
    <legend>二级分类 <small>{category.name} · {multiple ? '动作可多选' : '单选 · 再点取消'}</small></legend>
    {draft.suggestedFields?.includes('secondary') && <p className="secondary-prefilled">已按常用习惯预填，可改选</p>}
    {multiple && <QuickAlternatives draft={draft} context={context} onChange={onChange} />}
    <div className="secondary-options" role="group" aria-label={label} title="按最近30天记录次数排序，本次填写顺序固定">{children.map(child => {
      const selected = draft.secondaryIds.includes(child.id), suggested = recommended.has(child.id)
      return <button type="button" key={child.id} aria-pressed={selected} className={selected ? 'is-selected' : suggested ? 'is-recommended' : ''}
        title={child.name + (child.archived ? '（已归档）' : suggested && !selected ? ' · 常用备选' : '')}
        onClick={() => onChange({ secondaryIds: selected ? draft.secondaryIds.filter(id => id !== child.id) : multiple ? [...draft.secondaryIds, child.id] : [child.id] })}>
        <span className="secondary-check" aria-hidden="true">{selected ? '✓' : ''}</span><span>{child.name}{child.archived ? '（已归档）' : ''}</span>
      </button>
    })}</div>
    {multiple && <p className="secondary-multi-note">多个动作共用时段，训练时长只记一次。</p>}
    {!children.length && <p className="secondary-empty">还没有二级分类，可到分类管理添加。</p>}
  </fieldset>
}
