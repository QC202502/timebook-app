'use client'
import { useState } from 'react'
import type { Category } from '@/shared/lib/ledger-v2'
import type { ParallelChoice } from '@/shared/lib/quick-input'

export type ActivityChoice = { category:string; secondaryIds:string[] }
export function ParallelActivityPicker({categories,choices,onSelect,onShortcut,onClose}: {
  categories:Category[]; choices:ParallelChoice[]; onSelect:(choice:ActivityChoice)=>void;
  onShortcut:(choice:ParallelChoice)=>void; onClose:()=>void
}) {
  const [query,setQuery]=useState(''), [categoryId,setCategoryId]=useState('')
  const visible=categories.filter(c=>!c.archived), selected=visible.find(c=>c.id===categoryId)
  const needle=query.trim().toLocaleLowerCase()
  const results=visible.flatMap(c=>[{category:c.id,secondaryIds:[] as string[],name:c.name,label:c.name},...c.children.filter(s=>!s.archived).map(s=>({category:c.id,secondaryIds:[s.id],name:s.name,label:`${c.name} › ${s.name}`}))])
    .filter(c=>c.label.toLocaleLowerCase().includes(needle))
    .sort((a,b)=>Number(b.name.toLocaleLowerCase()===needle)-Number(a.name.toLocaleLowerCase()===needle))
  return <section className="parallel-picker" aria-label="选择并行活动" data-catalog-input>
    <div className="parallel-picker-heading"><b>同时还在做什么？</b><button type="button" onClick={onClose}>取消</button></div>
    <input autoFocus aria-label="搜索并行活动" placeholder="搜索活动，如听小说、聊天…" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation()} if(e.key==='Escape'){e.preventDefault();onClose()}}}/>
    <div className="parallel-picker-options">
      {needle?<div className="picker-results">{results.map(c=><button type="button" key={c.category+c.secondaryIds.join()} onClick={()=>onSelect(c)}>{c.label}</button>)}{!results.length&&<p>没有匹配的分类，试试其他名称。</p>}</div>:selected?<>
        <button type="button" className="picker-back" onClick={()=>setCategoryId('')}>‹ 全部分类</button>
        <b className="picker-category-name">{selected.name}</b>
        <div className="quick-chips"><button type="button" onClick={()=>onSelect({category:selected.id,secondaryIds:[]})}>只记{selected.name}</button>{selected.children.filter(s=>!s.archived).map(s=><button type="button" key={s.id} onClick={()=>onSelect({category:selected.id,secondaryIds:[s.id]})}>{s.name}</button>)}</div>
      </>:<>
        {!!choices.length&&<div className="quick-chips picker-shortcuts">{choices.map(c=><button type="button" className="quick-recommended" key={c.category+c.secondaryIds.join()} onClick={()=>onShortcut(c)}>{c.label}</button>)}</div>}
        <div className="picker-categories">{visible.map(c=><button type="button" key={c.id} onClick={()=>setCategoryId(c.id)}><i style={{background:c.color}}/>{c.name}<span>›</span></button>)}</div>
      </>}
    </div>
  </section>
}
