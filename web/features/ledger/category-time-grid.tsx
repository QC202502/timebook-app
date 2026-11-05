'use client'

import type { CSSProperties } from 'react'
import type { Category } from '@/shared/lib/ledger-v2'

type Props = { categories: Array<Category & { minutes: number }>; filter: string; onFilter: (id: string) => void }

export function CategoryTimeGrid({ categories, filter, onFilter }: Props) {
  const rows = categories.filter(c => c.minutes > 0).sort((a, b) => b.minutes - a.minutes)
  const cells = Math.max(6, Math.ceil((rows[0]?.minutes ?? 0) / 30))
  return <section className="category-time-grid" aria-label="当天一级分类用时格表" style={{ '--time-cells': cells } as CSSProperties}>
    <div className="category-grid-heading"><h3>分类用时</h3><span>每格 30 分钟 · 同类去重</span></div>
    {rows.length ? <div className="category-time-scroll"><table className="category-time-table">
      <thead><tr><th scope="col">一级分类</th><th scope="col">用时格</th><th scope="col">分钟 ↓</th></tr></thead>
      <tbody>{rows.map(category => <tr key={category.id} className={filter === category.id ? 'is-filtered' : ''} style={{ '--category-color': category.color } as CSSProperties}>
        <th scope="row"><button type="button" aria-pressed={filter === category.id} aria-label={`筛选一级分类 ${category.name}`} onClick={() => onFilter(filter === category.id ? 'all' : category.id)}><i />{category.name}</button></th>
        <td><div className="category-time-cells" role="img" aria-label={`${category.name}：${category.minutes} 分钟，${Math.floor(category.minutes / 30)} 个整格${category.minutes % 30 ? `，另 ${category.minutes % 30} 分钟` : ''}`}>
          {Array.from({ length: cells }, (_, i) => { const minutes = Math.max(0, Math.min(30, category.minutes - i * 30)); return <span className="category-time-cell" key={i} aria-hidden="true" title={`${category.name} · 本格 ${minutes} 分钟`}><i style={{ width: `${minutes / 30 * 100}%` }} /></span> })}
        </div></td><td className="category-time-total">{category.minutes}</td>
      </tr>)}</tbody>
    </table></div> : <p className="category-grid-empty">记录一段时间后，这里会按用时从多到少排列。</p>}
  </section>
}
