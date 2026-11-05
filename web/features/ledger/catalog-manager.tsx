'use client'
import { useState } from 'react'
import { emptyContext, type Collaboration, type Entity, type EntityKind } from '@/shared/lib/collaboration'
import { clock, type Change, type LedgerRecord } from '@/shared/lib/ledger-v2'
export type SaveChange = (change: Change, label: string) => Promise<boolean>
export function CatalogManager({ data, records, onSave, busy }: { data: Collaboration; records: LedgerRecord[]; onSave: SaveChange; busy: boolean }) {
  const [kind, setKind] = useState<EntityKind>('project'), [name, setName] = useState(''), [editing, setEditing] = useState('')
  const [legacy, setLegacy] = useState(''), [target, setTarget] = useState(''), [selected, setSelected] = useState<string[]>([]), [confirmed, setConfirmed] = useState(false)
  const values = [...new Set(records.map(r => r.project.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const candidates = records.filter(r => !!legacy && r.project.trim() === legacy).sort((a, b) => b.date.localeCompare(a.date) || b.start - a.start)
  const chosen = data.entities.find(e => e.id === target)
  async function saveEntity() {
    const prior = data.entities.find(e => e.id === editing)
    const e: Entity = { ...prior, id: editing || crypto.randomUUID(), name: name.trim(), kind, status: prior?.status ?? 'active' }
    if (await onSave({ upserts: [], deleteIds: [], collaborationChange: { entities: [e] } }, '档案已保存')) { setName(''); setEditing('') }
  }
  async function link() {
    if (!chosen || !confirmed || !selected.length) return
    const upserts = candidates.filter(r => selected.includes(r.id)).map(r => {
      const c = r.context ?? emptyContext('legacy')
      return { ...r, context: chosen.kind === 'project' ? { ...c, projectId: chosen.id } : chosen.kind === 'book' ? { ...c, books: [...c.books.filter(b => b.id !== chosen.id), { id: chosen.id, role: 'reading' as const }] } : { ...c, people: [...c.people.filter(p => p.id !== chosen.id), { id: chosen.id, role: 'together' as const }] } }
    })
    if (await onSave({ upserts, deleteIds: [] }, '归属关联已保存，原文字与时间保留')) { setSelected([]); setConfirmed(false) }
  }
  return <details className="collab-card catalog-manager"><summary>管理项目、书籍与人物</summary><fieldset disabled={busy}>
    <form className="catalog-form" onSubmit={e => { e.preventDefault(); void saveEntity() }}><select aria-label="档案类型" disabled={!!editing} value={kind} onChange={e => setKind(e.target.value as EntityKind)}><option value="project">项目</option><option value="book">书籍</option><option value="person">人物</option></select><input aria-label="档案名称" required maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="名称" /><button className="primary-button" type="submit">{editing ? '保存档案' : '新建档案'}</button>{editing && <button type="button" onClick={() => { setEditing(''); setName('') }}>取消</button>}</form>
    <div className="catalog-list">{data.entities.map(entity => <div key={entity.id}><span>{({ project: '项目', book: '书籍', person: '人物' })[entity.kind]} · <b>{entity.name}</b>{entity.status === 'archived' && '（归档）'}</span><button onClick={() => { setEditing(entity.id); setKind(entity.kind); setName(entity.name) }}>改名</button><button onClick={() => void onSave({ upserts: [], deleteIds: [], collaborationChange: { entities: [{ ...entity, status: entity.status === 'archived' ? 'active' : 'archived' }] } }, '档案状态已更新')}>{entity.status === 'active' ? '归档' : '恢复'}</button></div>)}</div>
    <details className="legacy-linker"><summary>历史归属预览</summary><p>只补充关联，保留原项目/对象文字、时间、描述和分类；执行者仍为“原口径”。每批最多100条。</p><div className="catalog-form"><select aria-label="原项目对象文字" value={legacy} onChange={e => { setLegacy(e.target.value); setSelected([]); setConfirmed(false) }}><option value="">选择原文字</option>{values.map(v => <option key={v}>{v}</option>)}</select><select aria-label="关联到档案" value={target} onChange={e => { setTarget(e.target.value); setConfirmed(false) }}><option value="">关联到…</option>{data.entities.filter(e => e.status === 'active').map(e => <option key={e.id} value={e.id}>{({ project: '项目', book: '书籍', person: '人物' })[e.kind]} · {e.name}</option>)}</select><button onClick={() => setSelected(candidates.slice(0, 100).map(r => r.id))}>选择本批</button></div>
      <div className="import-list">{candidates.slice(0, 100).map(r => <label key={r.id}><input type="checkbox" checked={selected.includes(r.id)} onChange={e => setSelected(e.target.checked ? [...selected, r.id] : selected.filter(id => id !== r.id))} /><span>{r.date} {clock(r.start)}–{clock(r.end)} · {r.activity || r.project}<small>{r.context?.projectId ? '已有项目关联，选中后将替换项目归属' : '原记录保留'}</small></span></label>)}</div>
      {!!selected.length && <><label className="check-line"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />确认这 {selected.length} 条属于{chosen?.kind === 'book' ? '阅读/听书' : chosen?.kind === 'person' ? '共同参与' : '所选项目'}；引用或仅提及请逐条关联</label><button className="primary-button" disabled={!confirmed || !target} onClick={() => void link()}>确认关联 {selected.length} 条</button></>}
    </details>
  </fieldset></details>
}
