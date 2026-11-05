'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { buildDayShare, DEFAULT_DAY_SHARE_OPTIONS, type DayShareOptions } from '@/shared/lib/day-share'
import type { Category, LedgerRecord } from '@/shared/lib/ledger-v2'
import type { Entity } from '@/shared/lib/collaboration'
import { renderDayShare } from './day-share-canvas'
import { DaySharePrivateOptions } from './day-share-private-options'

type Props = { records: LedgerRecord[]; categories: Category[]; entities: Entity[]; date: string; demo: boolean; now: { date: string; minute: number }; onClose: () => void }

export function DayShareDialog({ records, categories, entities, date, demo, now, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [options, setOptions] = useState<DayShareOptions>(DEFAULT_DAY_SHARE_OPTIONS)
  const [source] = useState(() => ({ records, categories, entities, date, demo, now }))
  const [attempt, setAttempt] = useState(0)
  const model = useMemo(() => buildDayShare(source.records, source.categories, source.date, options, source.now, source.demo), [source, options, attempt])
  const [image, setImage] = useState<{ model: typeof model; blob: Blob; url: string; width: number; height: number } | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [copying, setCopying] = useState(false)
  const current = image?.model === model ? image : null
  const privateShare = options.labels === 'selected'
  const canExport = !!current && (!privateShare || model.count > 0) && !copying
  const canCopy = typeof navigator !== 'undefined' && !!navigator.clipboard?.write && typeof ClipboardItem !== 'undefined'
  useEffect(() => {
    const el = dialog.current!
    el.showModal()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous; el.close() }
  }, [])
  useEffect(() => {
    let cancelled = false, url = ''
    setError(''); setMessage('')
    void renderDayShare(model).then(result => {
      if (cancelled) return
      url = URL.createObjectURL(result.blob)
      setImage({ ...result, url, model })
    }).catch(() => { if (!cancelled) setError('图片生成失败；如果附了较多明细，可关闭明细后重试。') })
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [model])
  function save() {
    if (!current || !canExport) return
    const a = document.createElement('a')
    a.href = current.url; a.download = `时间账本-${demo ? '示例-' : ''}${date}${options.range === 'from-six' ? '-从06点起' : ''}${privateShare ? '-隐私分享' : options.labels === 'primary' ? '-仅分类' : ''}.png`; a.click()
    setMessage('已发起 PNG 下载。')
  }
  async function copy() {
    if (!current || !canExport || !canCopy) return
    setCopying(true); setMessage('')
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': current.blob })])
      setMessage('图片已复制，可以到聊天窗口粘贴。')
    } catch { setMessage('浏览器未允许复制图片。可以点“保存 PNG”，再把图片发给朋友。') }
    finally { setCopying(false) }
  }
  return <dialog ref={dialog} className="day-share-dialog" aria-labelledby="day-share-title" onCancel={e => { e.preventDefault(); onClose() }} onClick={e => { if (e.target === dialog.current) onClose() }}>
    <div className="day-share-shell">
      <header className="day-share-heading"><div><p className="eyebrow">A DAY TO SHARE</p><h2 id="day-share-title">分享这一天</h2><p>{date} · {privateShare ? '隐私分享 · 仅公开所选' : demo ? '示例日程' : options.range === 'from-six' ? model.rangeLabel : '当天全部已保存记录'} · {model.count} 条</p></div><button autoFocus type="button" className="share-close" aria-label="关闭分享预览" onClick={onClose}>×</button></header>
      <div className="day-share-body">
        <div className="day-share-preview" aria-busy={!current && !error}>
          {current ? <img src={current.url} width={current.width} height={current.height} alt={`${date} ${privateShare ? '隐私分享预览，仅公开' : '日程分享预览，'}${model.count}条记录，${privateShare ? '公开' : '记录'}覆盖${model.covered}分钟，活动累计${model.total}分钟，并行${model.parallel}分钟`} /> : <div><p role="status">{error || '正在生成图片…'}</p>{error && <button className="soft-button" onClick={() => setAttempt(a => a + 1)}>重新生成</button>}</div>}
        </div>
        <aside className="day-share-options">
          <div className="share-options-scroll">
          <fieldset disabled={copying}><legend>图片范围</legend><label><input type="radio" name="share-range" checked={options.range === 'recorded'} onChange={() => setOptions(o => ({ ...o, range: 'recorded' }))} /> 已记录时段</label><label><input type="radio" name="share-range" checked={options.range === 'from-six'} onChange={() => setOptions(o => ({ ...o, range: 'from-six' }))} /> 06:00 起，至最后记录</label><label><input type="radio" name="share-range" checked={options.range === 'full'} onChange={() => setOptions(o => ({ ...o, range: 'full' }))} /> 完整 24 小时</label></fieldset>
          <fieldset disabled={copying}><legend>显示内容</legend><label><input type="radio" name="share-labels" checked={options.labels === 'activity'} onChange={() => setOptions(o => ({ ...o, labels: 'activity' }))} /> 活动名称</label><label><input type="radio" name="share-labels" checked={options.labels === 'primary'} onChange={() => setOptions(o => ({ ...o, labels: 'primary' }))} /> 仅一级分类</label><label><input type="radio" name="share-labels" checked={privateShare} onChange={() => setOptions(o => ({ ...o, labels: 'selected', details: true }))} /> 隐私分享 · 仅公开所选</label><label className="share-details-option"><input type="checkbox" checked={options.details} onChange={e => setOptions(o => ({ ...o, details: e.target.checked }))} /> {privateShare ? '附所选活动明细' : '附活动明细'}</label></fieldset>
          {privateShare && <DaySharePrivateOptions records={source.records} categories={source.categories} entities={source.entities} date={source.date} options={options} disabled={copying} onChange={setOptions} />}
          <p className="share-note">{privateShare ? '其他活动不显示文字和分类统计。色块与时间仍可见，可统一其他活动颜色，隐藏分类配色。项目和备注不放进图片。' : `${options.range === 'from-six' ? '从 06:00 到最后一条已记录活动结束，统计与明细同步。' : '图片包含当天全部分类，不含未保存修改。'}项目和备注不放进图片。`}</p>
          </div>
          {privateShare && !model.count && <p className="share-note share-selection-required">先勾选要公开的活动，再复制或保存。</p>}
          <div className="share-actions"><button type="button" className="new-button" disabled={!canExport || !canCopy} onClick={() => void copy()}>{copying ? '正在复制…' : '复制图片'}</button><button type="button" className="soft-button" disabled={!canExport} onClick={save}>保存 PNG ↓</button></div>
          {!canCopy && <p className="share-note">此浏览器暂不支持复制图片，可以保存 PNG。</p>}
          <p className="share-feedback" role="status">{message}</p>
          {current && <p className="share-resolution">{current.width} × {current.height} · PNG</p>}
        </aside>
      </div>
    </div>
  </dialog>
}
