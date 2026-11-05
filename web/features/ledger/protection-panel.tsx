'use client'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { protectionStatus, Version } from '@/server/lib/ledger-protection'
import type { previewRecovery } from '@/server/lib/ledger-v2-store'
import { activityTitle, clock, type Category, type LedgerRecord } from '@/shared/lib/ledger-v2'

type Status = Awaited<ReturnType<typeof protectionStatus>>
type Preview = Awaited<ReturnType<typeof previewRecovery>>
const when = (value?: string | null) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '尚无'
async function request(url: string, options?: RequestInit) {
  const res = await fetch(url, { cache: 'no-store', ...options }), data = await res.json()
  if (!res.ok) throw new Error(data.error || '操作失败')
  return data
}
export function ProtectionPanel({ revision, busy, categories }: { revision: number; busy: boolean; categories: Category[] }) {
  const [status, setStatus] = useState<Status | null>(null), [open, setOpen] = useState(false), [error, setError] = useState('')
  const [selected, setSelected] = useState(''), [records, setRecords] = useState<LedgerRecord[]>([]), [record, setRecord] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null), [working, setWorking] = useState(false), [confirm, setConfirm] = useState(false)
  const [mounted, setMounted] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null), versionRequest = useRef(0)
  async function load() {
    try { setStatus(await request('/api/protection')) }
    catch (e) { setStatus(null); setError((e as Error).message) }
  }
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 15000); return () => clearInterval(timer) }, [revision])
  useEffect(() => setMounted(true), [])
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close() }, [open])
  async function selectVersion(id: string) {
    const serial = ++versionRequest.current
    setSelected(id); setPreview(null); setConfirm(false); setRecords([]); setRecord(''); setError('')
    if (!id) return
    try { const data = await request('/api/protection?version=' + encodeURIComponent(id)); if (serial === versionRequest.current) setRecords(data.records) }
    catch (e) { if (serial === versionRequest.current) setError((e as Error).message) }
  }
  async function compare() {
    setWorking(true); setConfirm(false); setError('')
    try { setPreview(await request('/api/protection?preview=1&version=' + encodeURIComponent(selected) + (record && record !== '__whole__' ? '&record=' + encodeURIComponent(record) : ''))) }
    catch (e) { setError((e as Error).message) }
    finally { setWorking(false) }
  }
  async function restore() {
    if (!preview) return
    setWorking(true); setError('')
    try {
      await request('/api/protection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'restore', ...preview, operationId: 'restore-' + crypto.randomUUID(), confirm: preview.recordId ? 'restore-record' : 'restore-ledger', changes: undefined, meta: undefined }) })
      window.location.reload()
    } catch (e) { setError((e as Error).message); setConfirm(false); setWorking(false) }
  }
  function title(r: LedgerRecord) { return `${r.date} ${clock(r.start)}–${clock(r.end)} ${activityTitle(r, categories)}` }
  return <>
    <button className="protection-trigger" title={status?.label || '保护状态未读取'} onClick={() => { setOpen(true); void load() }}>数据安全 <span>{status?.remoteCovered ? '已备份' : status?.localCovered ? '本机' : '待检查'}</span></button>
    {mounted && createPortal(<><button className="protection-mobile-trigger" onClick={() => { setOpen(true); void load() }}>数据安全</button><dialog ref={dialog} className="protection-dialog" aria-label="数据安全与版本恢复" onCancel={e => { if (working) e.preventDefault(); else setOpen(false) }}>
      <div className="protection-heading"><h2>数据安全</h2><button aria-label="关闭数据安全" disabled={working} onClick={() => setOpen(false)}>×</button></div>
      <p className={status?.localCovered ? 'protection-state' : 'protection-warning'} role="status">{status?.label || '无法读取保护状态，请检查'}</p>
      {status && <>
        <dl className="protection-facts"><div><dt>当前版本</dt><dd>第 {status.currentRevision} 版</dd></div><div><dt>本机历史版本</dt><dd>{status.versions.length}</dd></div></dl>
        {status.unresolvedArchiveFailures > 0 && <p className="protection-warning">有 {status.unresolvedArchiveFailures} 个较早版本归档失败，当前版本成功不代表历史缺口已经补回。</p>}
        {status.error && <p className="protection-warning">{status.error}</p>}
        <details><summary>保存位置和范围</summary><p>版本库：<code>{status.dataDirectory}</code></p><p>包含全部日期的已保存记录、分类、项目、人物、书籍与账本内关联数据。Codex 扩展索引另行保存。尚未保存的输入不在版本中。</p><p>当前保留全部版本。请定期导出 JSON 并另存到其他设备。本地版未内置 NAS 自动备份。</p></details>
        <div className="protection-actions"><button disabled={working} onClick={async () => { try { await request('/api/protection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'retry' }) }); await load() } catch (e) { setError((e as Error).message) } }}>检查 / 重试本机归档</button><button onClick={() => void load()}>刷新状态</button></div>
        <h3>找回记录</h3>
        <label>历史版本<select aria-label="历史版本" value={selected} onChange={e => void selectVersion(e.target.value)} disabled={working}><option value="">选择版本</option>{status.versions.map((v: Version) => <option key={v.id} value={v.id}>第 {v.revision} 版 · {when(v.createdAt)} · {v.records} 条</option>)}</select></label>
        {selected && <label>恢复范围<select aria-label="恢复范围" value={record} disabled={working} onChange={e => { setRecord(e.target.value); setPreview(null); setConfirm(false) }}><option value="">选择要找回的记录</option>{records.map(r => <option key={r.id} value={r.id}>{title(r)}</option>)}<option value="__whole__">整本恢复（先查看全部差异）</option></select></label>}
        <button disabled={!selected || !record || working || busy} onClick={() => void compare()}>预览差异</button>
        {preview && <section className="protection-preview"><h3>{preview.recordId ? '恢复这一条' : '整本恢复预览'}</h3><p>新增 {preview.changes.filter(c => c.type === 'add').length} 条 · 修改 {preview.changes.filter(c => c.type === 'change').length} 条 · 移除 {preview.changes.filter(c => c.type === 'remove').length} 条</p>
          {(preview.categoriesChanged || preview.collaborationChanged) && <p>同时恢复{preview.categoriesChanged ? '分类' : ''}{preview.collaborationChanged ? '、项目与 Codex 数据' : ''}。</p>}
          <div className="protection-diff-list">{preview.changes.map(c => <details key={c.id}><summary>{({ add: '找回', change: '替换', remove: '移除' })[c.type]} · {title((c.after || c.before)!)}</summary><div className="protection-diff"><div><b>当前</b><pre>{JSON.stringify(c.before, null, 2)}</pre></div><div><b>恢复后</b><pre>{JSON.stringify(c.after, null, 2)}</pre></div></div></details>)}</div>
          {preview.conflict ? <p className="protection-warning">{preview.conflict}</p> : <><p>{preview.recordId ? '其他后来新增的记录会保留。' : '整本恢复会替换当前内容；当前账本将先永久留档。'}恢复后本页刷新，请先保存正在填写的输入。</p><label className="protection-confirm"><input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} />我已核对差异，确认恢复{preview.recordId ? '这一条' : '整本账本'}</label><button className="protection-restore" disabled={!confirm || working || busy} onClick={() => void restore()}>{working ? '恢复中…' : '确认恢复'}</button></>}
        </section>}
      </>}
      {error && <p role="alert" className="protection-warning">{error}</p>}
    </dialog></>, document.body)}
  </>
}
