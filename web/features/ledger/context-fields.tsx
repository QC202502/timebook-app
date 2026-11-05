'use client'
import { useState } from 'react'
import { clock, parseTimeInput } from '@/shared/lib/ledger-v2'
import { TimeInput } from './time-input'
import { emptyContext, type Entity, type EntityKind, type RecordContext } from '@/shared/lib/collaboration'

export function ContextFields({ value, entities, onChange, onCreate, legacy = false, suggestedKind, recentIds = [], bookRole = 'reference', personRole = 'mentioned', legacyNote = '' }: { value?: RecordContext; entities: Entity[]; onChange: (c: RecordContext) => void; onCreate: (e: Entity) => Promise<boolean>; legacy?: boolean; suggestedKind?: EntityKind; recentIds?: string[]; bookRole?: 'reading' | 'reference'; personRole?: 'together' | 'mentioned'; legacyNote?: string }) {
  const c = value ?? emptyContext(legacy ? 'legacy' : 'human')
  const [name, setName] = useState(''), [kind, setKind] = useState<EntityKind>(suggestedKind ?? 'project'), [creating, setCreating] = useState(false)
  const patch = (p: Partial<RecordContext>) => onChange({ ...c, ...p })
  const list = (kind: EntityKind) => entities.filter(e => e.kind === kind && (e.status !== 'archived' || e.id === c.projectId || [...c.books, ...c.people].some(v => v.id === e.id)))
  async function create() {
    if (!name.trim() || creating) return
    setCreating(true)
    try {
      const entity: Entity = { id: crypto.randomUUID(), kind, name: name.trim(), status: 'active' }
      if (await onCreate(entity)) {
        setName('')
        if (kind === 'project') patch({ projectId: entity.id })
        if (kind === 'book') patch({ books: [...c.books, { id: entity.id, role: bookRole }] })
        if (kind === 'person') patch({ people: [...c.people, { id: entity.id, role: personRole }] })
      }
    } finally { setCreating(false) }
  }
  return <><details className="context-fields">
    <summary>调整统计归属 <small>{c.projectId || c.books.length || c.people.length || c.stage ? [c.projectId ? '1个项目' : '', c.books.length ? `${c.books.length}本书` : '', c.people.length ? `${c.people.length}个人物` : '', c.stage ? '已设阶段' : ''].filter(Boolean).join(' · ') : '仅用于更正报表'}{legacyNote ? ' · 含历史备注' : ''}</small></summary>
    <p className="context-purpose">项目、书籍或人物在报表中归错位置时，在这里指定归属；日常记录会自动汇总，无需重复填写。</p>
    {legacyNote && <section className="legacy-note"><small>历史备注 · 原文保留</small><p aria-label="历史备注">{legacyNote}</p></section>}
    {!!recentIds.length && <div className="context-recent"><small>近期关联</small>{recentIds.flatMap(id => { const e = entities.find(v => v.id === id && v.status === 'active'); if (!e) return []; return [<button type="button" key={id} onClick={() => { if (e.kind === 'project') patch({ projectId: e.id }); if (e.kind === 'book' && !c.books.some(b => b.id === id)) patch({ books: [...c.books, { id, role: bookRole }] }); if (e.kind === 'person' && !c.people.some(p => p.id === id)) patch({ people: [...c.people, { id, role: personRole }] }) }}>{e.name}</button>] })}</div>}
    <label className="field-label">项目<select aria-label="关联项目" value={c.projectId ?? ''} onChange={e => patch({ projectId: e.target.value })}><option value="">暂不关联</option>{list('project').map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
    <label className="field-label">项目阶段<input aria-label="项目阶段" value={c.stage ?? ''} maxLength={40} placeholder="如构思、交办、复核；可留空" onChange={e => patch({ stage: e.target.value })} /></label>
    {(['book', 'person'] as const).map(type => <div key={type} className="context-object-group"><label className="field-label">{type === 'book' ? '书籍' : '人物'}<select aria-label={type === 'book' ? '添加书籍关联' : '添加人物关联'} value="" onChange={e => { if (e.target.value) type === 'book' ? patch({ books: [...c.books, { id: e.target.value, role: bookRole }] }) : patch({ people: [...c.people, { id: e.target.value, role: personRole }] }) }}><option value="">添加…</option>{list(type).filter(e => !(type === 'book' ? c.books : c.people).some(v => v.id === e.id)).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
      {(type === 'book' ? c.books : c.people).map(link => <div className="context-link" key={link.id}><span>{entities.find(e => e.id === link.id)?.name ?? '未找到档案'}</span><select aria-label={'关联方式 ' + link.id} value={link.role} onChange={e => type === 'book' ? patch({ books: c.books.map(b => b.id === link.id ? { ...b, role: e.target.value as 'reading' | 'reference' } : b) }) : patch({ people: c.people.map(p => p.id === link.id ? { ...p, role: e.target.value as 'together' | 'mentioned' } : p) })}>{type === 'book' ? <><option value="reading">阅读 / 听书</option><option value="reference">引用</option></> : <><option value="together">共同参与</option><option value="mentioned">仅提及</option></>}</select><button type="button" aria-label={'解除关联 ' + link.id} onClick={() => type === 'book' ? patch({ books: c.books.filter(b => b.id !== link.id) }) : patch({ people: c.people.filter(p => p.id !== link.id) })}>×</button></div>)}
    </div>)}
    <div className="context-create"><select aria-label="新档案类型" value={kind} onChange={e => setKind(e.target.value as EntityKind)}><option value="project">项目</option><option value="book">书籍</option><option value="person">人物</option></select><input data-catalog-input aria-label="新档案名称" value={name} maxLength={100} placeholder="新建档案" onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void create() } }} /><button type="button" disabled={creating || !name.trim()} onClick={() => void create()}>添加</button></div>
    {legacy && <label className="field-label">历史执行者口径<select aria-label="历史执行者口径" value={c.executor} onChange={e => patch({ executor: e.target.value as RecordContext['executor'] })}><option value="legacy">保留原口径，尚未区分</option><option value="human">确认这段是本人参与</option></select></label>}
  </details>
    <details className="context-breaks"><summary>扣除中断时间 <small>{c.breaks?.length ? `已设置 ${c.breaks.length} 段` : '选填'}</small></summary><p className="context-purpose">如工作途中休息了10分钟，可在项目投入统计中扣除这段中断；时间轴保留原时段。中断须在活动起止时间内。</p>{(c.breaks ?? []).map((b, i) => <div key={i}><div className="time-inputs"><TimeInput label="中断开始" value={clock(b.start % 1440)} allowNextDay nextDay={b.start >= 1440} onChange={(v, next) => patch({ breaks: c.breaks!.map((p, j) => j === i ? { ...p, start: parseTimeInput(v) + (next ? 1440 : 0) } : p) })} /><span>—</span><TimeInput label="中断结束" value={clock(b.end % 1440)} allowNextDay nextDay={b.end >= 1440} onChange={(v, next) => patch({ breaks: c.breaks!.map((p, j) => j === i ? { ...p, end: parseTimeInput(v) + (next ? 1440 : 0) } : p) })} /></div><button type="button" onClick={() => patch({ breaks: c.breaks!.filter((_, j) => j !== i) })}>移除此中断</button></div>)}<button type="button" onClick={() => patch({ breaks: [...(c.breaks ?? []), { start: 540, end: 550 }] })}>＋ 中断区间</button></details>
  </>
}
