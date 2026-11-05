'use client'

import { useState } from 'react'
import { secondaryIdsOf, visiblePrimaryCategories, type Category, type CategoryAction, type LedgerRecord } from '@/shared/lib/ledger-v2'

type Props = { categories: Category[]; records: LedgerRecord[]; busy: boolean; demo: boolean; onAction: (action: CategoryAction, label: string) => Promise<boolean> }
export function CategoryManager({ categories, records, busy, demo, onAction }: Props) {
  const [selected, setSelected] = useState('work')
  const [sortBy, setSortBy] = useState<'frequency' | 'manual'>('frequency')
  const [addingPrimary, setAddingPrimary] = useState(false)
  const [primaryDraft, setPrimaryDraft] = useState<{ id: string; name: string; color: string } | null>(null)
  const [secondary, setSecondary] = useState<{ id: string; name: string; parentId: string } | null>(null)
  const [merging, setMerging] = useState<{ sourceId: string; name: string; level: 'primary' | 'secondary' } | null>(null)
  const [targetId, setTargetId] = useState('')
  const listedCategories = visiblePrimaryCategories(categories, records)
  const current = listedCategories.find(c => c.id === selected) ?? listedCategories[0] ?? categories[0]
  const primaryValues = primaryDraft?.id === current.id ? primaryDraft : current
  const active = listedCategories.filter(c => !c.archived)
  const affected = merging ? records.filter(r => merging.level === 'primary' ? r.category === merging.sourceId : secondaryIdsOf(r).includes(merging.sourceId)).length : 0
  const mergeTargets = merging?.level === 'primary' ? active.map(c => ({ id: c.id, label: c.name })) : active.flatMap(c => c.children.filter(s => !s.archived).map(s => ({ id: s.id, label: `${c.name} / ${s.name}` })))
  const startMerge = (sourceId: string, name: string, level: 'primary' | 'secondary') => { setMerging({ sourceId, name, level }); setTargetId(''); setSecondary(null) }
  const count = (id: string, child = false) => records.filter(r => child ? secondaryIdsOf(r).includes(id) : r.category === id).length
  const primaryList = sortBy === 'frequency' ? [...listedCategories].sort((a, b) => count(b.id) - count(a.id)) : listedCategories
  const secondaryList = sortBy === 'frequency' ? [...current.children].sort((a, b) => count(b.id, true) - count(a.id, true)) : current.children
  const move = (id: string, direction: -1 | 1) => void onAction({ type: 'reorder', id, direction }, '分类顺序已更新')

  return <section className="category-manager" aria-label="分类管理工作台">
    <div className="manager-heading"><div><p className="eyebrow">MAKE ROOM FOR YOUR LIFE</p><h2>按你的生活，整理分类。</h2><p>名称与颜色会同步到记录和统计。活动文字、时间与时长保持原样。</p></div><div className="manager-tools"><span className="manager-badge">{demo ? '示例分类 · 可随意试' : '全部日期共用一套分类'}</span><div className="category-sort" role="group" aria-label="分类排序方式"><button type="button" aria-pressed={sortBy === 'frequency'} onClick={() => setSortBy('frequency')}>按记录次数</button><button type="button" aria-pressed={sortBy === 'manual'} onClick={() => setSortBy('manual')}>手动排序</button></div></div></div>
    <fieldset disabled={busy} className="manager-fieldset">
      <div className="category-columns">
        <div className="primary-list">
          <div className="list-heading"><h3>一级分类 <small>{listedCategories.length}</small></h3><button onClick={() => setAddingPrimary(v => !v)}>＋ 新增一级</button></div>
          {addingPrimary && <form className="category-inline-form" onSubmit={async e => {
            e.preventDefault(); const values = new FormData(e.currentTarget); const id = crypto.randomUUID()
            if (await onAction({ type: 'save-primary', id, name: String(values.get('name')).trim(), color: String(values.get('color')) }, '一级分类已添加')) { setAddingPrimary(false); setSelected(id); setSecondary(null) }
          }}><label>一级分类名称<input aria-label="新增一级分类名称" name="name" maxLength={40} required autoFocus placeholder="例如：个人项目" /></label><label className="color-field">颜色<input aria-label="新增一级分类颜色" name="color" type="color" defaultValue="#3f6960" /></label><div className="form-actions"><button type="submit" className="new-button">添加一级分类</button><button type="button" onClick={() => setAddingPrimary(false)}>取消</button></div></form>}
          <div className="primary-items">{primaryList.map((c, i) => <div className={`primary-item${current.id === c.id ? ' current' : ''}`} key={c.id}>
            <button className="primary-select" aria-pressed={current.id === c.id} onClick={() => { setSelected(c.id); setSecondary(null); setMerging(null) }}><i aria-hidden="true" style={{ background: c.color }} /><span>{c.name}<small>{c.archived ? '已归档 · ' : ''}{c.children.length} 个二级 · {count(c.id)} 条记录</small></span></button>
            {sortBy === 'manual' && <div className="order-buttons"><button aria-label={`上移一级 ${c.name}`} disabled={i === 0} onClick={() => move(c.id, -1)}>↑</button><button aria-label={`下移一级 ${c.name}`} disabled={i === listedCategories.length - 1} onClick={() => move(c.id, 1)}>↓</button></div>}
          </div>)}</div>
          <p className="manager-footnote">{sortBy === 'frequency' ? '按全部历史记录次数排列，同次数沿用手动顺序。' : '用 ↑ ↓ 调整自定义顺序，作为同次数时的排序依据。'}归档分类仍可在这里找到。</p>
        </div>
        {listedCategories.length > 0 ? <div className="category-detail">
          <div className="detail-heading"><span className="category-color-block" style={{ background: current.color }} /><div><p className="eyebrow">一级分类</p><h3>{current.name}{current.archived && <small>已归档</small>}</h3></div><span className="record-count">{count(current.id)} 条历史记录</span></div>
          <form className="primary-edit-form" key={current.id} onSubmit={async e => {
            e.preventDefault(); const data = new FormData(e.currentTarget)
            if (await onAction({ type: 'save-primary', id: current.id, name: String(data.get('name')).trim(), color: String(data.get('color')) }, '一级分类已更新，历史记录同步显示')) setPrimaryDraft(null)
          }}><label>分类名称<input aria-label="一级分类名称" name="name" value={primaryValues.name} onChange={e => setPrimaryDraft({ id: current.id, name: e.target.value, color: primaryValues.color })} maxLength={40} required /></label><label className="color-field">颜色<input aria-label="一级分类颜色" type="color" name="color" value={primaryValues.color} onChange={e => setPrimaryDraft({ id: current.id, name: primaryValues.name, color: e.target.value })} /></label><button type="submit" className="soft-button">保存一级分类</button></form>
          <div className="secondary-heading"><div><h3>二级分类 <small>{current.children.length}</small></h3><p>用来区分这一类时间里，具体是哪种活动。</p></div><button className="soft-button" disabled={current.archived} onClick={() => { setSecondary({ id: '', name: '', parentId: current.id }); setMerging(null) }}>＋ 新增二级</button></div>
          {!current.children.length && !secondary && <div className="category-empty">还没有二级分类，先加一个你常用的活动。</div>}
          <div className="secondary-items">{secondaryList.map((child, i) => <div className="secondary-item" key={child.id}>
            <div><span>{child.name}</span><small>{child.archived ? '已归档 · ' : ''}{count(child.id, true)} 条记录</small></div><div className="secondary-actions"><button aria-label={`编辑二级 ${child.name}`} onClick={() => { setSecondary({ id: child.id, name: child.name, parentId: current.id }); setMerging(null) }}>修改</button>{sortBy === 'manual' && <><button aria-label={`上移二级 ${child.name}`} disabled={i === 0} onClick={() => move(child.id, -1)}>↑</button><button aria-label={`下移二级 ${child.name}`} disabled={i === current.children.length - 1} onClick={() => move(child.id, 1)}>↓</button></>}<button aria-label={`${child.archived ? '恢复' : '归档'}二级 ${child.name}`} onClick={() => void onAction({ type: 'archive', id: child.id, archived: !child.archived }, child.archived ? '二级分类已恢复' : '二级分类已归档，历史记录保留')}>{child.archived ? '恢复' : '归档'}</button><button aria-label={`合并二级 ${child.name}`} onClick={() => startMerge(child.id, child.name, 'secondary')}>合并</button></div>
          </div>)}</div>
          {secondary && <form className="secondary-edit-form" key={`${secondary.id}-${secondary.parentId}`} onSubmit={async e => {
            e.preventDefault(); const data = new FormData(e.currentTarget); const parentId = String(data.get('parentId'))
            if (await onAction({ type: 'save-secondary', id: secondary.id || crypto.randomUUID(), parentId, name: String(data.get('name')).trim() }, secondary.id ? '二级分类已更新，历史记录同步显示' : '二级分类已添加')) { setSecondary(null); setSelected(parentId) }
          }}><h4>{secondary.id ? '修改二级分类' : '添加二级分类'}</h4><div className="secondary-form-fields"><label>二级分类名称<input aria-label="二级分类名称" name="name" defaultValue={secondary.name} maxLength={40} required autoFocus /></label><label>所属一级<select aria-label="所属一级分类" name="parentId" defaultValue={secondary.parentId}>{listedCategories.filter(c => !c.archived || c.id === secondary.parentId).map(c => <option value={c.id} key={c.id} disabled={c.archived}>{c.name}{c.archived ? '（已归档）' : ''}</option>)}</select></label></div>{secondary.id && <p>更换所属一级后，历史记录也会一起移动。涉及多选动作的记录，需先调整动作选择，或合并整个一级分类。</p>}<div className="form-actions"><button type="submit" className="new-button">保存二级分类</button><button type="button" onClick={() => setSecondary(null)}>取消</button></div></form>}
          {merging && <form className="merge-form" onSubmit={async e => {
            e.preventDefault()
            if (await onAction({ type: 'merge', sourceId: merging.sourceId, targetId }, '分类已合并，历史记录与统计已更新')) { setMerging(null); if (merging.level === 'primary') setSelected(targetId) }
          }}><h4>将「{merging.name}」合并到</h4><select aria-label="合并目标分类" value={targetId} required onChange={e => setTargetId(e.target.value)}><option value="">选择目标分类</option>{mergeTargets.filter(t => t.id !== merging.sourceId).map(t => <option value={t.id} key={t.id}>{t.label}</option>)}</select><p>会转移 <b>{affected} 条历史记录</b>，移除来源分类。{merging.level === 'primary' ? '二级分类一并转移，同名二级归到一起。' : ''}时间和活动文字不变。合并不支持一键撤销。</p><div className="form-actions"><button type="submit" className="new-button" disabled={!targetId}>确认合并 {affected} 条记录</button><button type="button" onClick={() => setMerging(null)}>取消合并</button></div></form>}
          <div className="category-lifecycle"><p>不再使用的分类可以归档，历史记录与用时统计仍然保留。</p><div><button disabled={current.id === 'other'} onClick={() => void onAction({ type: 'archive', id: current.id, archived: !current.archived }, current.archived ? '一级分类已恢复' : '一级分类已归档，历史记录保留')}>{current.archived ? '恢复这个一级分类' : '归档这个一级分类'}</button><button disabled={current.id === 'other'} onClick={() => startMerge(current.id, current.name, 'primary')}>合并到其他一级…</button></div></div>
        </div> : <div className="category-empty">添加一个一级分类，开始整理。</div>}
      </div>
    </fieldset>
  </section>
}
