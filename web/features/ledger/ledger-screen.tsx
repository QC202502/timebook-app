'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { CATEGORIES, activityTitle, activityInput, activityFields, applyCategoryAction, secondaryIdsOf, secondaryNames, sameSecondaries, addDays, categoryOf, visiblePrimaryCategories, clock, demoRecords, duration, isFuture, layoutFilledBlocks, maxConcurrentActivities, MAX_CONCURRENT_ACTIVITIES, parseTimeInput, recordsForDay, shanghaiNow, summarize, toCsv, validDate, validRecord, type Category, type CategoryId, type Change, type LedgerRecord, type Snapshot } from '@/shared/lib/ledger-v2'

import { CategoryManager } from './category-manager'
import { ProtectionPanel } from './protection-panel'
import { OverlapNotice } from './overlap-notice'
import { inferDayPatch, entryOverlap, duplicateActivities } from '@/shared/lib/entry-feedback'
import { categoriesByFrequency } from '@/shared/lib/category-frequency'
import { ActivityBlock } from './activity-block'
import { CategoryTimeGrid } from './category-time-grid'
import { DayShareDialog } from './day-share-dialog'
import { TimeInput } from './time-input'
import { StatisticsPanel } from './collaboration-statistics'
import { resolvePeople } from '@/shared/lib/people-input'
import { emptyCollaboration, emptyContext, applyCollaboration, inverseCollaboration } from '@/shared/lib/collaboration'
import { useTimelineDrag } from './use-timeline-drag'
import { replacementNeedsConfirmation } from '@/shared/lib/record-edit'
import { changeQuickDraft, prefill, prefillNewEntry, parallelChoices, parallelSpan, quickPreferences, DEFAULT_QUICK_PREFERENCES, type QuickContext, type QuickPreferences, type ParallelChoice } from '@/shared/lib/quick-input'
import { QuickSettings } from './quick-input-controls'
import { EntryActivityFields, type EntryDraft } from './entry-activity-fields'
import { ParallelActivityPicker, type ActivityChoice } from './parallel-activity-picker'
import { entryBatch, followEntryTime, sameSavedActivity, parallelConflicts } from '@/shared/lib/parallel-entry'
import { useQuickUsage } from './use-quick-usage'
import type { SaveTicket } from './quick-usage-recorder'
import type { UsageDetails } from '@/shared/lib/quick-usage'

type Draft = EntryDraft
const newId = () => crypto.randomUUID()
const HOUR_ROW_HEIGHT = 72
const titleDate = (date: string) => new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'))
function draftFor(date: string, start = 540, end = 570): Draft {
  return { id: '', entryKey: newId(), date, start: clock(start), end: clock(end % 1440), nextDay: end >= 1440, category: 'work', context: emptyContext(), secondaryIds: [], activity: '', project: '', note: '', approximate: false }
}
function fromRecord(r: LedgerRecord): Draft {
  return { ...r, entryKey: newId(), activity: activityInput(r), secondaryIds: [...secondaryIdsOf(r)], start: clock(r.start), end: clock(r.end % 1440), nextDay: r.end >= 1440, secondaryManual: true, projectManual: true }
}
function draftRecord(d: Draft, id = d.id): LedgerRecord {
  return { id, date: d.date, start: parseTimeInput(d.start), end: parseTimeInput(d.end) + (d.nextDay ? 1440 : 0), category: d.category, secondaryId: d.secondaryIds[0] ?? null, secondaryIds: [...d.secondaryIds], ...activityFields(d.activity), project: d.project.trim(), note: d.note, approximate: d.approximate, ...(d.context !== undefined ? { context: d.context } : {}), ...(d.stage !== undefined ? { stage: d.stage } : {}), ...(d.suggestedFields !== undefined ? { suggestedFields: d.suggestedFields } : {}) }
}
function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function LedgerScreen() {
  const [now, setNow] = useState(() => shanghaiNow())
  const [date, setDate] = useState(now.date)
  const [demo, setDemo] = useState(true)
  const [examples, setExamples] = useState<LedgerRecord[]>(() => demoRecords(now.date))
  const [demoCollaboration, setDemoCollaboration] = useState(emptyCollaboration)
  const [demoCategories, setDemoCategories] = useState<Category[]>(() => structuredClone(CATEGORIES))
  const [snapshot, setSnapshot] = useState<Snapshot>({ revision: 0, records: [], categories: CATEGORIES })
  const [loading, setLoading] = useState(true)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [draft, setDraft] = useState<Draft>(() => draftFor(now.date))
  const [companions, setCompanions] = useState<Draft[]>([])
  const [activeCompanion, setActiveCompanion] = useState<string | null>(null)
  const [choosingParallel, setChoosingParallel] = useState(false)
  const [editingBaseline, setEditingBaseline] = useState<LedgerRecord | null>(null)
  const [preferences, setPreferences] = useState<QuickPreferences>(DEFAULT_QUICK_PREFERENCES)
  const [preferenceWarning, setPreferenceWarning] = useState('')
  const pendingOperation = useRef<{ key: string; id: string } | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [undo, setUndo] = useState<Change | null>(null)
  const [tab, setTab] = useState<'timeline' | 'stats' | 'categories'>('timeline')
  const [filter, setFilter] = useState('all')
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [duplicateReview, setDuplicateReview] = useState<{ matches: ReturnType<typeof duplicateActivities>; asNew?: boolean; confirmed?: boolean } | null>(null)
  const duplicateRef = useRef<HTMLDivElement>(null)
  const [sharing, setSharing] = useState(false)
  const reviewRef = useRef<HTMLDivElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const usage = useQuickUsage(form, hasLoaded && !demo && tab === 'timeline', !!editing)
  const saveSource = useRef<NonNullable<UsageDetails['source']>>('button')
  const undoUsage = useRef<SaveTicket | undefined>(undefined)
  const composing = useRef(false)
  const compositionGuardUntil = useRef(0)
  const nativeControlGuardUntil = useRef(0)
  const editorActive = useRef(false)
  const lock = useRef(false)
  const [ready, setReady] = useState(false)
  const records = demo ? examples : snapshot.records
  const categories = demo ? demoCategories : snapshot.categories
  const displayCategories = useMemo(() => visiblePrimaryCategories(categories, records), [categories, records])
  const entryCategories = useMemo(() => categoriesByFrequency(displayCategories, records, now.date), [displayCategories, records, now.date])
  const collaboration = demo ? demoCollaboration : snapshot.collaboration ?? emptyCollaboration()
  const recentEntityIds = useMemo(() => [...new Set([...records].sort((a, b) => b.date.localeCompare(a.date) || b.start - a.start).flatMap(r => r.context ? [r.context.projectId, ...r.context.books.map(b => b.id), ...r.context.people.map(p => p.id)].filter(Boolean) as string[] : []))], [records])
  const contextEntities = useMemo(() => [...new Map([...collaboration.entities, ...(draft.pendingPeople ?? []), ...companions.flatMap(d => d.pendingPeople ?? [])].map(e => [e.id, e])).values()].sort((a, b) => (recentEntityIds.indexOf(a.id) < 0 ? 10000 : recentEntityIds.indexOf(a.id)) - (recentEntityIds.indexOf(b.id) < 0 ? 10000 : recentEntityIds.indexOf(b.id))), [collaboration.entities, recentEntityIds, draft.pendingPeople, companions])
  function enterToSave(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.defaultPrevented || tab !== 'timeline' || sharing) return
    const editor = form.current, target = e.target
    if (!editor || !(target instanceof HTMLElement)) return
    // Mouse selection can leave focus on the page, especially on macOS.
    // Only an explicitly selected/changed draft enables Enter outside the form.
    if (!editor.contains(target) && !(editorActive.current && (target === document.body || target === document.documentElement))) return
    if (composing.current || e.isComposing || e.keyCode === 229 || Date.now() < compositionGuardUntil.current) {
      compositionGuardUntil.current = Date.now() + 100
      // Keep the IME's native candidate confirmation, but do not invoke child shortcuts.
      e.stopPropagation(); return
    }
    if (target.closest('select,.quick-settings,[data-catalog-input]')) { nativeControlGuardUntil.current = Date.now() + 100; return }
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || target.closest('summary,[contenteditable="true"]') || (target.closest('textarea') && !target.matches('textarea[data-usage-field="activity"]'))) return
    const button = target.closest('button')
    // Direct secondary/project buttons confirm even after a choice was cleared.
    // Space toggles a focused choice; Enter must not silently select it again.
    if (button && !button.matches('.save-button') && !button.closest('.secondary-picker,.project-shortcuts') && !(button.matches('[aria-pressed="true"]') && button.closest('.category-field,.recent-projects,.stage-picker'))) return
    e.preventDefault(); e.stopPropagation()
    if (!e.repeat && !lock.current && ready && (demo || !loading)) { saveSource.current = 'enter'; editor.requestSubmit() }
  }
  useEffect(() => {
    document.addEventListener('keydown', enterToSave, true)
    return () => document.removeEventListener('keydown', enterToSave, true)
  })
  function contextFor(d: Draft): QuickContext { return { records, categories, date: d.date, start: parseTimeInput(d.start), now, preferences } }
  function freshDraft(day: string, start = 540, end = 570): Draft {
    const defaultCategory = categories.find(c => c.id === 'work' && !c.archived) ?? categories.find(c => !c.archived)!
    const d = { ...draftFor(day, start, end), category: defaultCategory.id }
    return prefillNewEntry(d, contextFor(d), end)
  }

  async function downloadCurrentBackup() {
    if (busy || (!demo && (loading || !hasLoaded))) return
    try {
      let saved = { records, categories, collaboration, revision: snapshot.revision }
      if (!demo) {
        const response = await fetch('/api/ledger', { cache: 'no-store' })
        const latest = await response.json()
        if (!response.ok) throw new Error(latest.error || '备份读取失败。')
        saved = latest
      }
      download(`时间账本-${demo ? '示例-' : ''}${date}.json`, JSON.stringify({ version: 3, timezone: 'Asia/Shanghai', exportedAt: new Date().toISOString(), demo, scope: 'full-ledger', ...saved }, null, 2), 'application/json')
    } catch (e) { setError(e instanceof Error ? e.message : '备份读取失败，未导出空账本。') }
  }
  async function refresh() {
    setLoading(true)
    try {
      const response = await fetch('/api/ledger', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setSnapshot(data); setHasLoaded(true); setUndo(null); setError('')
    } catch (e) { setError(e instanceof Error ? e.message : '读取失败，请重试。') }
    finally { setLoading(false) }
  }
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    try { setPreferences(quickPreferences(JSON.parse(localStorage.getItem('time-ledger-quick-preferences') ?? 'null'))) } catch { /* use defaults */ }
    const mode = params.get('mode')
    const view = params.get('view')
    if (view === 'categories' || view === 'stats') setTab(view)
    const chosenDate = params.get('date')
    if (validDate(chosenDate)) { setDate(chosenDate); setDraft({ ...draftFor(chosenDate), id: newId() }); setExamples(demoRecords(chosenDate)) }
    setDemo(mode ? mode !== 'real' : localStorage.getItem('time-ledger-mode') !== 'real')
    setReady(true); void refresh()
    const timer = setInterval(() => setNow(shanghaiNow()), 30000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!ready) return
    const url = new URL(window.location.href); url.searchParams.set('view', tab); window.history.replaceState(null, '', url)
  }, [tab, ready])
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 8 * HOUR_ROW_HEIGHT }, [tab, ready])
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 6000); return () => clearTimeout(id) }, [toast])

  const daily = useMemo(() => recordsForDay(records, date), [records, date])
  const limit = demo || date < now.date ? 1440 : date === now.date ? now.minute : 0
  const stats = useMemo(() => summarize(records, date, 1440, categories), [records, date, categories])
  const elapsedStats = useMemo(() => summarize(records, date, limit, categories), [records, date, limit, categories])
  const futureCount = demo ? 0 : daily.filter(r => isFuture({ ...r, date }, now)).length
  const visible = daily.filter(r => filter === 'all' || r.category === filter || secondaryIdsOf(r).includes(filter) || (!secondaryIdsOf(r).length && filter === r.category + ':unset'))
  const parsedStart = parseTimeInput(draft.start), parsedEnd = parseTimeInput(draft.end) + (draft.nextDay ? 1440 : 0)
  const draftDuration = parsedEnd - parsedStart
  const validSpan = Number.isFinite(draftDuration) && draftDuration > 0 && draftDuration <= 1440 && parsedStart < 1440
  const defaultActivityTitle = activityTitle({ ...draft, activitySource: 'category' }, categories)
  const pendingSpans = [...(validSpan ? [{ date: draft.date, start: parsedStart, end: parsedEnd }] : []), ...companions.map(d => draftRecord(d)).filter(r => validRecord(r, categories))]
  const mainOverlap = entryOverlap(records, validSpan ? [pendingSpans[0]] : [], editing)
  const intersecting = mainOverlap.related
  const overlap = companions.length ? entryOverlap(records, pendingSpans, editing) : mainOverlap
  const original = editing ? editingBaseline?.id === editing ? editingBaseline : records.find(r => r.id === editing) : undefined
  const activeDraft = companions.find(d => d.id === activeCompanion) ?? draft
  const activeSlot = activeDraft === draft ? 0 : companions.indexOf(activeDraft) + 1
  const originalChanged = !!original && !sameSavedActivity(draftRecord(draft), original)
  const saveLabel = companions.length ? editing ? `${originalChanged ? '保存修改并' : '保存'}新增 ${companions.length} 条` : `保存 ${companions.length + 1} 条活动` : editing ? '保存修改' : '保存这段时间'
  const quickContext = contextFor(draft)
  const patchDraft = (patch: Partial<Draft>) => {
    if (lock.current) return
    editorActive.current = true
    const adjusted = { ...patch, ...inferDayPatch(draft, patch) }
    const next = changeQuickDraft(draft, adjusted, contextFor({ ...draft, ...adjusted }), !!editing)
    setDraft(next)
    if (patch.start !== undefined || patch.end !== undefined || patch.date !== undefined || patch.nextDay !== undefined) setCompanions(items => followEntryTime(next, items))
    setReviewing(false); setError('')
  }
  function patchActive(patch: Partial<Draft>) {
    if (activeDraft === draft) { patchDraft(patch); return }
    if (lock.current) return
    editorActive.current = true
    setCompanions(items => items.map(d => {
      if (d.id !== activeDraft.id) return d
      const adjusted = { ...patch, ...inferDayPatch(d, patch) }
      if ((patch.start !== undefined || patch.end !== undefined) && patch.followMain !== true) adjusted.followMain = false
      return changeQuickDraft(d, adjusted, contextFor({ ...d, ...adjusted }))
    }))
    setError(''); setReviewing(false)
  }
  function selectActivity(id: string | null) { setActiveCompanion(id); setChoosingParallel(false); editorActive.current = true }
  function removeCompanion(id: string) {
    usage.recorder.record('parallel_remove', { slot: companions.findIndex(d => d.id === id) + 1, count: companions.length, result: 'success' })
    setCompanions(items => items.filter(d => d.id !== id)); setActiveCompanion(null); setError('')
  }
  useEffect(() => { setActiveCompanion(null); setChoosingParallel(false) }, [draft.id, editing, date, demo])
  function changePreferences(p: QuickPreferences) {
    setPreferences(p)
    try { localStorage.setItem('time-ledger-quick-preferences', JSON.stringify(p)); setPreferenceWarning('') } catch { setPreferenceWarning('本次设置已生效，但当前浏览器未能保存设置。') }
  }
  useEffect(() => {
    if (!ready || (!demo && loading)) return
    if (!editing) setDraft(d => prefill(d, contextFor(d)))
    setCompanions(items => items.map(d => prefill(d, contextFor(d))))
  }, [records, categories, preferences, ready, demo, loading])
  useEffect(() => { setReviewing(false) }, [editing, date, demo])
  const draftReviewKey = JSON.stringify({ ...draft, id: undefined })
  useEffect(() => { setDuplicateReview(null) }, [draftReviewKey, companions, editing, date, demo, records])
  useEffect(() => { if (duplicateReview) duplicateRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, [duplicateReview])
  useEffect(() => { if (reviewing) reviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, [reviewing])
  const startDrag = useTimelineDrag({ scroll, enabled: ready && tab === 'timeline' && !busy && (demo || !loading), selection, onPreview: setSelection,
    onCreate: span => { if (lock.current) return; usage.begin('create', 'drag'); editorActive.current = true; form.current?.focus({ preventScroll: true }); setDraft({ ...freshDraft(date, span.start, span.end), id: newId() }); setCompanions([]); setEditing(null); setSelection(span); setReviewing(false); setError('') }, onEdit: selectRecord })

  useEffect(() => {
    setDraft(d => {
      if (editing) return d
      const current = categories.find(c => c.id === d.category && !c.archived) ?? categories.find(c => !c.archived)!
      return { ...d, category: current.id, secondaryIds: d.secondaryIds.filter(id => current.children.some(c => c.id === id && !c.archived)) }
    })
    if (filter !== 'all' && !categories.some(c => c.id === filter || c.id + ':unset' === filter || c.children.some(s => s.id === filter))) setFilter('all')
  }, [categories, records, editing]) // Classification changes must not overwrite the user's activity text.

  function switchMode(value: boolean) {
    if (busy) return
    usage.interrupt()
    editorActive.current = false
    setDemo(value); localStorage.setItem('time-ledger-mode', value ? 'demo' : 'real')
    const url = new URL(window.location.href); url.searchParams.set('mode', value ? 'demo' : 'real'); window.history.replaceState(null, '', url)
    setUndo(null); setEditing(null); setSelection(null); setFilter('all'); setError('')
    setCompanions([])
    const end = value ? 570 : Math.max(1, now.minute)
    setDraft({ ...freshDraft(date, Math.max(0, end - 30), end), id: newId() })
    if (!value) void refresh()
  }
  function chooseDate(value: string) {
    if (!validDate(value) || busy) return
    usage.interrupt()
    editorActive.current = false
    const url = new URL(window.location.href); url.searchParams.set('date', value); window.history.replaceState(null, '', url)
    setDate(value); setEditing(null); setSelection(null); setCompanions([]); setDraft({ ...freshDraft(value), id: newId() }); setError('')
  }
  function selectRecord(id: string) {
    if (lock.current || busy || (!demo && loading)) return
    const r = records.find(item => item.id === id)
    if (!r) return
    usage.begin('edit', 'existing')
    editorActive.current = true
    form.current?.focus({ preventScroll: true })
    setEditingBaseline(structuredClone(r))
    setTab('timeline'); setEditing(id); setCompanions([]); setDraft(fromRecord(r)); setSelection(null); setReviewing(false); setError('')
  }
  async function apply(change: Change, label: string, isUndo = false, ticket?: SaveTicket) {
    if (lock.current || (!demo && loading)) return false
    lock.current = true; setBusy(true); setError('')
    const touched = new Set([...change.upserts.map(r => r.id), ...change.deleteIds])
    const inverse: Change = { upserts: records.filter(r => touched.has(r.id)).map(r => ({ ...r, secondaryIds: [...secondaryIdsOf(r)], activitySource: r.activitySource ?? 'custom' })), deleteIds: change.upserts.filter(r => !records.some(old => old.id === r.id)).map(r => r.id) }
    inverse.clearContextIds = inverse.upserts.filter(r => r.context === undefined).map(r => r.id)
    if (change.collaborationChange) inverse.collaborationChange = inverseCollaboration(collaboration, change.collaborationChange)
    let failure: UsageDetails['reason'] = 'overlap'
    try {
      if (change.createIds && (change.upserts.length !== change.createIds.length || records.some(r => change.createIds!.includes(r.id)))) throw new Error('成组新增不能覆盖已有记录。')
      const nextRecords = [...records.filter(r => !touched.has(r.id)), ...change.upserts]
      if (change.upserts.length && maxConcurrentActivities(nextRecords) > MAX_CONCURRENT_ACTIVITIES) throw new Error('同一分钟最多记录 3 件事。这个时段会出现第 4 件同时进行的事，请调整起止时间。')
      if (demo) {
        if (change.collaborationChange) setDemoCollaboration(applyCollaboration(collaboration, change.collaborationChange))
        if (change.categoryAction) {
          const next = applyCategoryAction(categories, records, change.categoryAction)
          setDemoCategories(next.categories); setExamples(next.records)
        } else setExamples(nextRecords)
      }
      else {
        const payload = { ...change, ...(isUndo ? { confirmedReplacementIds: change.upserts.map(r => r.id) } : {}), revision: snapshot.revision }
        const key = JSON.stringify(payload)
        if (pendingOperation.current?.key !== key) pendingOperation.current = { key, id: newId() }
        failure = 'network'
        const response = await fetch('/api/ledger', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, operationId: pendingOperation.current.id }) })
        failure = response.status === 409 ? 'conflict' : 'server'
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || '保存失败。')
        setSnapshot(data)
      }
      pendingOperation.current = null
      undoUsage.current = isUndo || change.categoryAction ? undefined : ticket
      usage.recorder.saveResult(ticket, 'success')
      setUndo(isUndo || change.categoryAction ? null : inverse); setToast(demo ? `${label} · 仅示例` : label)
      return true
    } catch (e) { usage.recorder.saveResult(ticket, 'failed', failure); setError(e instanceof Error ? e.message : '保存失败，请重试。'); return false }
    finally { lock.current = false; setBusy(false) }
  }
  async function save(options: { confirmed?: boolean; asNew?: boolean; duplicatesConfirmed?: boolean } = {}) {
    if (lock.current || (!demo && loading) || choosingParallel) return
    usage.commitFields()
    usage.recorder.ensure(editing && !options.asNew ? 'edit' : 'create')
    const source = options.confirmed || options.duplicatesConfirmed ? 'confirm' : options.asNew ? 'as_new' : saveSource.current
    saveSource.current = 'button'
    const ticket = usage.recorder.saveAttempt(source, companions.length + 1)
    const rejected = (reason: UsageDetails['reason']) => usage.recorder.saveResult(ticket, 'failed', reason)
    if (!options.asNew && editing && (!original || draft.id !== editing || !records.some(item => item.id === editing))) { rejected('record_changed'); setError('原记录已变化，请重新选择要修改的记录；输入仍保留。'); return }
    let resolved: ReturnType<typeof resolvePeople>
    try { resolved = resolvePeople([draftRecord(draft, options.asNew ? newId() : editing ?? (draft.id || newId())), ...companions.map(d => draftRecord(d))], [draft, ...companions].flatMap(d => d.pendingPeople ?? []), collaboration.entities) } catch (e) { rejected('invalid'); setError(e instanceof Error ? e.message : '人物关联未能保存，请重新选择。'); return }
    const r = resolved.upserts[0]
    if (!draft.id && !editing) setDraft(d => ({ ...d, id: r.id }))
    if (!validRecord(r, categories)) { rejected('invalid'); setError('请填写有效时间，如 09:07—09:42；结束须晚于开始，时长不超过 24 小时。'); return }
    if (!options.asNew && original && replacementNeedsConfirmation(original, r) && !options.confirmed) { usage.recorder.saveResult(ticket, 'review_required'); setReviewing(true); return }
    const kind = editing && !options.asNew ? 'update' : 'create'
    if (kind === 'update' && original && (!records.some(item => item.id === original.id && sameSavedActivity(item, original)))) { rejected('record_changed'); setError('原活动已被其他页面修改，请重新选择核对；本次输入仍保留。'); return }
    if (kind === 'create' && records.some(old => old.id === r.id)) { rejected('duplicate'); setError('新增活动不能使用已有记录的编号，请重新新增。'); return }
    const group = resolved.upserts
    if (companions.length) {
      if (group.some(item => !validRecord(item, categories) || (item.id !== original?.id && categories.find(c => c.id === item.category)?.archived) || item.secondaryIds?.some(id => categories.find(c => c.id === item.category)?.children.find(s => s.id === id)?.archived))) { rejected('invalid'); setError('请检查每条并行活动的时间与分类，尚未保存任何一条。'); return }
    }
    const change = entryBatch(r, group.slice(1), kind === 'update' ? original : undefined)
    const duplicates = duplicateActivities(records, change.upserts)
    if (duplicates.length && !options.duplicatesConfirmed) {
      usage.recorder.saveResult(ticket, 'review_required')
      setReviewing(false); setError(''); setDuplicateReview({ matches: duplicates, asNew: options.asNew, confirmed: options.confirmed }); return
    }
    if (!change.upserts.length) { setToast('没有需要保存的修改'); usage.recorder.saveResult(ticket, 'success'); return }
    if (options.confirmed && kind === 'update' && change.upserts.some(item => item.id === r.id)) change.confirmedReplacementIds = [r.id]
    if (resolved.entities.length) change.collaborationChange = { entities: resolved.entities }
    if (await apply(change, companions.length ? `${originalChanged ? '修改与 ' : ''}${companions.length + (editing ? 0 : 1)} 条新增已一起保存，可撤销` : kind === 'update' ? '修改已保存' : '新活动已保存，原记录保留', false, ticket)) { usage.recorder.end('saved'); editorActive.current = false; setCompanions([]); setActiveCompanion(null); setChoosingParallel(false); setEditing(r.id); setEditingBaseline(r); setDraft(fromRecord(r)); setSelection(null); setReviewing(false); setDuplicateReview(null) }
  }
  function newEntry(track = true) {
    if (lock.current || busy) return
    if (track) usage.begin('create', 'button'); else usage.interrupt()
    setReviewing(false)
    setCompanions([])
    setTab('timeline')
    const end = demo ? 570 : Math.max(1, now.minute)
    setDraft({ ...freshDraft(date, Math.max(0, end - 30), end), id: newId() }); setEditing(null); setSelection(null); setError('')
    form.current?.querySelector<HTMLInputElement>('[name=activity]')?.focus()
  }
  const parallelOptions = parallelChoices(quickContext, draft).filter(choice => ![...intersecting, ...companions.map(d => draftRecord(d))].some(r => r.category === choice.category && sameSecondaries(r, { category: choice.category, secondaryIds: choice.secondaryIds }) && r.project === choice.project))
  function addQuickParallel(choice: ParallelChoice | ActivityChoice) {
    if (lock.current || !validSpan || companions.length >= 2) return
    usage.recorder.ensure(editing ? 'edit' : 'create')
    const shortcut = 'score' in choice
    const span = parallelSpan(parsedStart, parsedEnd, shortcut ? choice : undefined)
    let next: Draft = { ...draftFor(draft.date, span.start, span.end), id: newId(), category: choice.category, secondaryIds: choice.secondaryIds, secondaryManual: true, followMain: span.start === parsedStart && span.end === parsedEnd }
    next = prefill(next, contextFor(next))
    if (shortcut) next = { ...next, project: choice.project, projectManual: true, suggestedFields: [] }
    editorActive.current = true
    usage.recorder.record('parallel_add', { count: companions.length + 2, source: shortcut ? 'shortcut' : 'manual', result: 'success' })
    setCompanions(items => [...items, next]); setActiveCompanion(next.id); setChoosingParallel(false)
    setError(''); setReviewing(false)
  }
  function locateNow() {
    if (lock.current || busy) return
    if (!demo && date !== now.date) chooseDate(now.date)
    requestAnimationFrame(() => {
      const viewport = scroll.current
      if (!viewport) return
      const hour = demo ? 12 : Math.floor(now.minute / 60)
      viewport.scrollTo({ top: Math.max(0, hour * HOUR_ROW_HEIGHT - viewport.clientHeight / 3), behavior: 'smooth' })
    })
  }

  return <div className={`ledger-shell${tab === 'timeline' ? ' timeline-page' : ''}`}>
    <header className="app-header">
      <a className="brand" href="/today" aria-label="时间账本首页"><span className="brand-mark"><i /><i /><i /><i /></span><span>时间账本<small>TIME LEDGER</small></span></a>
      <nav aria-label="主导航"><button className={tab === 'timeline' ? 'nav-active' : ''} onClick={() => setTab('timeline')}>时间轴</button><button className={tab === 'stats' ? 'nav-active' : ''} onClick={() => setTab('stats')}>时间统计</button><button className={tab === 'categories' ? 'nav-active' : ''} onClick={() => setTab('categories')}>分类管理</button></nav>
      {tab === 'timeline' && <section className="header-metrics" aria-label={`${date} ${demo ? '示例' : '当天'}统计`}>
        {[['覆盖', stats.covered, '同一分钟只计一次，按已录入完整区间计算', 'covered'], ['累计', stats.total, '每件活动分别相加，含并行活动', 'total'], ['并行', stats.parallel, '同时两件或三件事的分钟数', 'parallel']].map(([label, value, hint, id]) => <div className="header-metric" key={id} title={`${date} · ${hint}`} aria-label={`${label} ${value} 分钟；${hint}`}><span>{label}</span><div><strong data-testid={`metric-${id}`}>{!demo && loading ? '—' : value}</strong><small>分</small></div></div>)}
        <div className="header-metric" title={demo ? '示例不会写进正式账本' : date === now.date ? `截至 ${clock(now.minute)}，未记录 ${duration(elapsedStats.unrecorded)}` : `全天未记录 ${duration(stats.unrecorded)}`}><span>{demo ? '示例' : '记录'}</span><div><strong>{!demo && loading ? '—' : daily.length}</strong><small>条</small></div></div>
      </section>}
      <div className="header-actions"><span className="local-status"><i />{demo ? '示例体验' : loading ? '读取中' : busy ? '保存中' : '本机账本'}</span>{!demo && hasLoaded && snapshot.revision > 0 && <ProtectionPanel revision={snapshot.revision} busy={busy} categories={categories} />}{<button className="soft-button" title="备份全部记录、分类、项目与Codex执行" disabled={busy || (!demo && (loading || !hasLoaded))} onClick={() => void downloadCurrentBackup()}>备份 JSON <span>↗</span></button>}</div>
    </header>

    <main>
      {tab === 'categories' && <>
      {demo && <div className="demo-note"><span><b>示例的一天</b>　可以随意添加、修改，体验分钟记录与并行活动。</span><button onClick={() => switchMode(false)}>开始我的记录 →</button></div>}
      </>}
      {tab === 'categories' ? <>
        {error && <div className="error-message" role="alert">{error}{!demo && <button onClick={() => void refresh()}>刷新账本，保留输入</button>}</div>}
        <CategoryManager categories={categories} records={records} busy={busy || (!demo && loading)} demo={demo} onAction={(categoryAction, label) => apply({ upserts: [], deleteIds: [], categoryAction }, label)} />
      </> : tab === 'stats' ? <StatisticsPanel data={collaboration} busy={busy} onSave={apply} records={records} categories={categories} initialDate={date} now={now} demo={demo} loading={!demo && loading} error={error} onRefresh={() => void refresh()} onOpenRecord={id => { const record = records.find(r => r.id === id); if (record) { chooseDate(record.date); selectRecord(id) } }} /> : <><div className="ledger-workspace">
        <div className="timeline-column"><section className="ledger-main">
          <div className="section-toolbar"><div className="day-control"><button aria-label="前一天" disabled={busy} onClick={() => chooseDate(addDays(date, -1))}>‹</button><label className="date-title"><span>{titleDate(date)}</span><input type="date" aria-label="查看日期" value={date} onChange={e => chooseDate(e.target.value)} /></label><button aria-label="后一天" disabled={busy} onClick={() => chooseDate(addDays(date, 1))}>›</button><button className="today-link" onClick={() => chooseDate(now.date)}>今天</button></div><div className="timeline-actions"><button className="soft-button" disabled={!ready || busy || (!demo && (loading || !hasLoaded))} onClick={() => setSharing(true)}>分享图片 ↗</button><button className="new-button locate-now-button" disabled={busy} onClick={locateNow}>定位{demo ? '示例' : '此刻'} ↓</button></div></div>
          <>
            <div className="grid-toolbar"><span>单击编辑 · <b>拖动新增</b>（已有色块上也可以）</span><select aria-label="筛选分类" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">全部分类</option>{displayCategories.map(c => <optgroup key={c.id} label={c.name}><option value={c.id}>{c.name}{c.archived ? '（已归档）' : ''}</option>{c.children.map(child => <option key={child.id} value={child.id}>↳ {child.name}{child.archived ? '（已归档）' : ''}</option>)}<option value={c.id + ':unset'}>↳ 未设二级</option></optgroup>)}</select></div>
            <div className="minute-ruler"><span>小时</span><div>{[0, 15, 30, 45, 60].map(n => <span key={n}>{String(n).padStart(2, '0')}</span>)}</div></div>
            <div className="timeline-scroll" ref={scroll} aria-label="一天的时间轴">
              {Array.from({ length: 24 }, (_, hour) => {
                const start = hour * 60, end = start + 60
                const blocks = layoutFilledBlocks(visible, start, end)
                const active = selection && selection.start < end && selection.end > start
                return <div className="hour-row" key={hour} data-hour={hour}>
                  <div className="hour-label"><b>{String(hour).padStart(2, '0')}</b><span>:00</span></div>
                  <div className="hour-track" style={{ height: HOUR_ROW_HEIGHT }} onPointerDown={e => startDrag(e, hour)}>
                    {active && <div className="selection-block" style={{ left: `${(Math.max(selection!.start, start) - start) / 60 * 100}%`, width: `${(Math.min(selection!.end, end) - Math.max(selection!.start, start)) / 60 * 100}%` }} />}
                    {blocks.map(({ record: r, start: blockStart, end: blockEnd, slot, slots, showLabel }) => <ActivityBlock key={`${r.id}-${blockStart}`} record={r} categories={categories} selected={editing === r.id} start={blockStart} end={blockEnd} hourStart={start} slot={slot} slots={slots} showLabel={showLabel} onSelect={selectRecord} />)}
                    {!demo && date === now.date && Math.floor(now.minute / 60) === hour && <div className="now-line" style={{ left: `${now.minute % 60 / 60 * 100}%` }}><i /><span>{clock(now.minute)}</span></div>}
                  </div>
                </div>
              })}
            </div>
          </>
        </section>
        <CategoryTimeGrid categories={stats.categories} filter={filter} onFilter={setFilter} />
        </div>
        <aside className="side-panel">
          <form className="entry-panel" data-usage-slot="0" ref={form} tabIndex={-1} style={{ outline: 'none' }}
            onCompositionStartCapture={() => { composing.current = true }}
            onCompositionEndCapture={() => { composing.current = false; compositionGuardUntil.current = Date.now() + 100 }}
            onSubmit={e => { e.preventDefault(); if (!composing.current && Date.now() >= compositionGuardUntil.current && Date.now() >= nativeControlGuardUntil.current) void save() }}>
            <div className="panel-heading"><div><p className="eyebrow">{editing ? 'EDIT ACTIVITY' : 'ADD A MOMENT'}</p><h2>{companions.length ? `这段时间 · ${companions.length + 1} 件事` : editing ? '修改这条活动' : '新增一条活动'}</h2></div><span className="duration-badge">{validSpan ? `${draftDuration} 分` : '待填写'}</span></div>
            {original && !companions.length && <div className="editing-origin" aria-label="正在修改的原记录"><span>正在修改</span><strong>{activityTitle(original, categories)}</strong><small>{original.date} · {clock(original.start)}—{original.end >= 1440 ? '次日 ' : ''}{clock(original.end % 1440)} · {duration(original.end - original.start)}</small></div>}
            {!editing && selection && <p className="new-entry-note">已选 {clock(selection.start)}—{clock(selection.end)} · 将新增一条，已有活动保留。</p>}
            <fieldset className="entry-fields" disabled={busy || !ready || (!demo && loading)}>
            {draft.date !== date && <p className="field-hint">跨日记录，开始日期为 {draft.date}</p>}
            {companions.length > 0 && <div className="anchor-time-label">本段时间 · 活动 1</div>}
            <div className="time-inputs" data-usage-field="time">
              <TimeInput label="开始" value={draft.start} disabled={busy || !ready || (!demo && loading)} onChange={value => patchDraft({ start: value })} />
              <span className="time-range-separator" aria-hidden="true">—</span>
              <TimeInput label="结束" value={draft.end} nextDay={draft.nextDay} maxAbsolute={Number.isFinite(parsedStart) ? parsedStart + 1440 : undefined} allowNextDay disabled={busy || !ready || (!demo && loading)} onChange={(value, nextDay) => patchDraft({ end: value, nextDay })} />
            </div>
            {validSpan && !demo && isFuture({ date: draft.date, end: parsedEnd }, now) && <p className="advance-entry-note">可以提前记录，实际时间有变化时再修改。</p>}
            <section className="parallel-editor" aria-label="本时段活动">
              <div className="activity-cards" role="group" aria-label="切换活动">
                {[draft, ...companions].map((item, index) => <div className={`activity-card${activeDraft.id === item.id ? ' is-active' : ''}`} key={item.id || 'main'}>
                  <button type="button" aria-pressed={activeDraft.id === item.id} onClick={() => selectActivity(index ? item.id : null)} style={{ '--category-color': categoryOf(item.category, categories).color } as CSSProperties}>
                    <b>{activityTitle({ ...item, activitySource: item.activity.trim() ? 'custom' : 'category' }, categories)}</b>
                    <span>{item.start}—{item.nextDay ? '次日 ' : ''}{item.end} · {index === 0 && editing ? originalChanged ? '待修改' : '已保存' : '新增'}</span>
                  </button>
                  {index > 0 && <button className="remove-companion" type="button" aria-label={`移除活动 ${index + 1}`} onClick={() => removeCompanion(item.id)}>×</button>}
                </div>)}
              </div>
              <section className="parallel-shortcuts" data-usage-group="parallel" aria-label="并行快捷输入"><div className="quick-chips">
                {parallelOptions.map(choice => <button className="quick-recommended" type="button" key={choice.category + choice.secondaryIds.join()} title={choice.reason} disabled={!validSpan || companions.length >= 2} onClick={() => addQuickParallel(choice)}>＋ {choice.label}</button>)}
                <button type="button" aria-expanded={choosingParallel} disabled={!validSpan || companions.length >= 2} onClick={() => setChoosingParallel(value => !value)}>＋ 并行活动</button>
              </div></section>
              {choosingParallel && <ParallelActivityPicker categories={entryCategories} choices={parallelOptions} onSelect={addQuickParallel} onShortcut={addQuickParallel} onClose={() => setChoosingParallel(false)} />}
            </section>
            {!choosingParallel && <div className="active-activity-fields" data-usage-slot={activeSlot} key={activeDraft.id}>
              {companions.length > 0 && <div className="active-activity-heading">正在填写 · 活动 {activeSlot + 1}</div>}
              {activeSlot > 0 && <div className="companion-time">
                <div className="companion-time-mode"><span>{activeDraft.followMain ? `同本段时间 · ${draft.start}—${draft.nextDay ? '次日 ' : ''}${draft.end}` : '独立时间'}</span><button type="button" onClick={() => patchActive(activeDraft.followMain ? { followMain: false } : { followMain: true, date: draft.date, start: draft.start, end: draft.end, nextDay: draft.nextDay })}>{activeDraft.followMain ? '单独设置' : '恢复同本段时间'}</button></div>
                {!activeDraft.followMain && <div className="time-inputs" data-usage-field="time"><TimeInput label="本活动开始" value={activeDraft.start} onChange={start => patchActive({ start })}/><span aria-hidden="true">—</span><TimeInput label="本活动结束" value={activeDraft.end} allowNextDay nextDay={activeDraft.nextDay} maxAbsolute={parseTimeInput(activeDraft.start) + 1440} onChange={(end, nextDay) => patchActive({ end, nextDay })}/></div>}
              </div>}
              <EntryActivityFields key={demo ? 'demo' : hasLoaded ? 'real' : 'loading'} draft={activeDraft} context={contextFor(activeDraft)} categories={entryCategories} entities={contextEntities} recentIds={recentEntityIds.slice(0, 6)} legacy={activeSlot === 0 && !!editing} onChange={patchActive} onCreate={entity => apply({ upserts: [], deleteIds: [], collaborationChange: { entities: [entity] } }, '档案已创建')}/>
            </div>}
            {editorActive.current && validSpan && <OverlapNotice conflicts={overlap.peak > 3 ? parallelConflicts(records, [draftRecord(draft), ...companions.map(d => draftRecord(d))], editing) : []} peak={overlap.peak} related={overlap.related} categories={categories} editing={!!editing} />}
            {error && <div className="error-message" role="alert">{error}{!demo && <button type="button" onClick={() => void refresh()}>刷新账本，保留输入</button>}</div>}
            {reviewing && original && <div className="replacement-review" ref={reviewRef} role="alert"><b>这会改掉原来的「{activityTitle(original, categories)}」</b><p>原来 {clock(original.start)}—{original.end >= 1440 ? '次日 ' : ''}{clock(original.end % 1440)}（{duration(original.end - original.start)}），将改成「{draft.activity.trim() || defaultActivityTitle}」{draft.start}—{draft.nextDay ? '次日 ' : ''}{draft.end}（{duration(draftDuration)}）。</p><button type="button" className="keep-original" onClick={() => void save({ asNew: true })}>保留原记录，另存为新活动</button><button type="button" onClick={() => void save({ confirmed: true })}>确认修改原记录</button><button type="button" onClick={() => setReviewing(false)}>返回检查</button></div>}
            {duplicateReview && <div className="replacement-review" ref={duplicateRef} role="alert"><b>同一时段已有同类活动</b><p>请检查是否重复记录。若只是补充人物，可以返回修改原记录；确实是不同活动，也可以继续保存。</p>{duplicateReview.matches.map(({ record, existing }, index) => <p key={record.id + index}>{secondaryNames(record, categories) || categoryOf(record.category, categories).name} · {clock(record.start)}—{record.end >= 1440 ? '次日 ' : ''}{clock(record.end % 1440)}<br />已有：{activityTitle(existing, categories)}{existing.project ? ` · ${existing.project}` : ''}</p>)}<button type="button" className="keep-original" onClick={() => setDuplicateReview(null)}>返回检查</button><button type="button" onClick={() => void save({ asNew: duplicateReview.asNew, confirmed: duplicateReview.confirmed, duplicatesConfirmed: true })}>仍然保存这次记录</button></div>}
            <div className="entry-save-bar"><button className="save-button" type="submit" title="回车保存（Enter）" aria-keyshortcuts="Enter" disabled={busy || choosingParallel || (!demo && loading)}>{busy ? '保存中…' : saveLabel}<span aria-hidden="true">↵</span></button></div>
            {editing && !companions.length && !choosingParallel && <div className="edit-actions"><button type="button" className="delete-button" disabled={busy} onClick={async () => { if (await apply({ upserts: [], deleteIds: [editing] }, '记录已删除，可撤销')) { setEditing(null); setDraft({ ...draft, id: newId() }) } }}>删除</button></div>}
            <QuickSettings date={draft.date} value={preferences} onChange={changePreferences} warning={preferenceWarning} />
            </fieldset>
            <div className="usage-settings" aria-label="快捷录入操作记录">{!demo && <><span>操作记录 · 仅本机 · {usage.paused ? '已暂停' : usage.available ? '开启' : '暂不可用，不影响保存'}</span><button type="button" onClick={usage.toggle}>{usage.paused ? '继续记录' : '暂停记录'}</button></>}</div>
            <p className="save-hint">{demo ? '当前操作仅用于示例体验' : '保存在这台电脑，刷新网页后仍在'}</p>
          </form>
        </aside>
      </div>
      <section className="records-panel"><div className="records-heading"><div><p className="eyebrow">THE DETAILS</p><h2>当天明细 <span>{visible.length}</span></h2></div><button className="soft-button" onClick={() => download(`时间账本-${demo ? '示例-' : ''}${date}.csv`, toCsv(records.filter(r => visible.some(v => v.id === r.id)), categories), 'text/csv;charset=utf-8')}>导出 CSV ↗</button></div><div className="table-scroll"><table><thead><tr><th>时间</th><th>活动</th><th>分类</th><th>项目 / 对象</th><th>当天时长</th><th /></tr></thead><tbody>{visible.map(r => <tr key={r.id} className={editing === r.id ? 'row-selected' : ''}><td className="mono">{clock(r.start)} <span>—</span> {clock(r.end)}{r.approximate && <em>约</em>}</td><td><i className="record-dot" style={{ background: categoryOf(r.category, categories).color }} />{activityTitle(r, categories)}{r.stage && r.activitySource !== 'category' && <small className="record-secondary">制作阶段 · {r.stage}</small>}</td><td>{categoryOf(r.category, categories).name}<small className="record-secondary">{secondaryNames(r, categories) || '未设二级'}</small></td><td>{r.project || '—'}</td><td>{r.end - r.start} 分钟</td><td><button aria-label={`编辑 ${activityTitle(r, categories)} ${clock(r.start)}`} onClick={() => selectRecord(r.id)}>编辑 ↗</button></td></tr>)}</tbody></table></div>{!visible.length && <div className="empty-message"><b>这一天，还留着空白。</b><p>拖选一段时间，或在右侧输入起止时间，记下第一件事。</p></div>}</section></>}
      {tab === 'timeline' && <section className="timeline-about" aria-label="账本说明与模式">
      <div className="page-heading"><div><p className="eyebrow">YOUR DAY, IN MINUTES</p><h1>把时间，记清楚。</h1><p className="intro">每一段投入，都有自己的位置。一起发生的事，也可以一起记。</p></div><div className="mode-switch" aria-label="账本模式"><button aria-pressed={demo} className={demo ? 'selected' : ''} onClick={() => switchMode(true)}>示例体验</button><button aria-pressed={!demo} className={!demo ? 'selected' : ''} onClick={() => switchMode(false)}>我的记录</button></div></div>
      {demo && <div className="demo-note"><span><b>示例的一天</b>　可以随意添加、修改，体验分钟记录与并行活动。</span><button onClick={() => switchMode(false)}>开始我的记录 →</button></div>}
        {futureCount > 0 && <p className="advance-stats-note">含 {futureCount} 条提前记录 · 覆盖与累计按已填写的完整时段计算；仅统计已过去的时间可到时间统计页勾选“仅截至现在”。</p>}
      </section>}
      <footer className="page-footer"><span>时间账本 <b>·</b> 本地版 v0.1</span><span>北京时间 · 分钟精度 · 活动可并行</span>{demo && <button onClick={() => { setExamples(demoRecords(date)); setDemoCollaboration(emptyCollaboration()); setDemoCategories(structuredClone(CATEGORIES)); setUndo(null); setEditing(null); setSelection(null); setToast('示例已重置') }}>重置示例</button>}</footer>
      {tab === 'stats' && <section className="statistics-about"><div className="page-heading page-heading--statistics"><h1>时间，花在哪里。</h1><div className="mode-switch" aria-label="账本模式"><button aria-pressed={demo} className={demo ? 'selected' : ''} onClick={() => switchMode(true)}>示例体验</button><button aria-pressed={!demo} className={!demo ? 'selected' : ''} onClick={() => switchMode(false)}>我的记录</button></div></div></section>}
    </main>
    {sharing && <DayShareDialog records={records} categories={categories} entities={collaboration.entities} date={date} demo={demo} now={now} onClose={() => setSharing(false)} />}
    {(toast || undo) && <div className="toast" role="status"><span>{toast || '上一步操作可撤销'}</span>{undo && <button disabled={busy} onClick={async () => { const ticket = undoUsage.current; if (ticket) usage.recorder.undo(undefined, ticket); const ok = await apply(undo, '已撤销', true); if (ticket) usage.recorder.undo(ok ? 'success' : 'failed', ticket); if (ok && tab === 'timeline') newEntry(false) }}>撤销</button>}<button aria-label="关闭提示" onClick={() => { setToast(''); setUndo(null) }}>×</button></div>}
  </div>
}
