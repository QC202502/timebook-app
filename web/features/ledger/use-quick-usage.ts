'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { QuickUsageRecorder } from './quick-usage-recorder'
import type { UsageDetails } from '@/shared/lib/quick-usage'

const PAUSE_KEY = 'time-ledger-quick-usage-paused'
type Field = NonNullable<UsageDetails['field']>
const fields = new Set(['category', 'secondary', 'project', 'stage', 'time', 'activity', 'note', 'approximate'])
const groups = new Set(['secondary', 'project', 'parallel', 'stage'])
export function useQuickUsage(form: RefObject<HTMLFormElement | null>, enabled: boolean, editing: boolean) {
  const [paused, setPaused] = useState(true)
  const [available, setAvailable] = useState(true)
  const recorderRef = useRef<QuickUsageRecorder | null>(null)
  if (!recorderRef.current) recorderRef.current = new QuickUsageRecorder({ onStatus: setAvailable })
  const recorder = recorderRef.current
  const context = useRef({ enabled, editing }); context.current = { enabled, editing }
  const scan = useRef(() => {})
  const flushFields = useRef(() => {})
  useEffect(() => {
    try { setPaused(localStorage.getItem(PAUSE_KEY) !== 'false') } catch { /* session only */ }
    const sync = (e: StorageEvent) => { if (e.key === PAUSE_KEY) setPaused(e.newValue === 'true') }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  useEffect(() => {
    recorder.setEnabled(enabled && !paused)
    const root = form.current
    if (!enabled || paused || !root) return
    const safe = (fn: () => void) => { try { fn() } catch { /* observability is optional */ } }
    const slot = (e: Element) => Math.min(2, Math.max(0, Number(e.closest<HTMLElement>('[data-usage-slot]')?.dataset.usageSlot) || 0))
    const dirty = new Map<HTMLInputElement | HTMLTextAreaElement, UsageDetails>()
    const fieldOf = (e: Element) => {
      const el = e.closest<HTMLElement>('[data-usage-field]'), field = el?.dataset.usageField
      return field && fields.has(field) ? { field: field as Field, slot: slot(e), automatic: el?.dataset.usageAutomatic === 'true' } : undefined
    }
    const ignored = (e: Element) => !!e.closest('.quick-settings,.usage-settings')
    let io: IntersectionObserver | undefined, mo: MutationObserver | undefined
    const visible = new Set<Element>(), observed = new Set<Element>(), identities = new WeakMap<Element, number>()
    let serial = 0, scheduled = false
    const buttons = (el: Element) => Array.from(el.querySelectorAll<HTMLElement>('.quick-chips > button:not([data-usage-action])'))
    const inspect = () => safe(() => {
      if (!recorder.active) return
      for (const el of root.querySelectorAll<HTMLElement>('[data-usage-group]')) {
        const group = el.dataset.usageGroup as UsageDetails['group']
        if (!group || !groups.has(group)) continue
        const all = buttons(el), positions = all.flatMap((b, i) => visible.has(b) ? [i] : [])
        if (!positions.length) continue
        const ids = all.map(b => { if (!identities.has(b)) identities.set(b, ++serial); return identities.get(b) })
        recorder.expose(group, slot(el), ids.join(',') + ':' + positions.join(','), { total: all.length, visible: positions.length, automatic: el.dataset.usageAutomatic === 'true', selected: all.some(b => b.getAttribute('aria-pressed') === 'true') })
      }
    })
    const schedule = () => { if (scheduled) return; scheduled = true; queueMicrotask(() => { scheduled = false; inspect() }) }
    scan.current = schedule
    const refresh = () => safe(() => {
      for (const el of [...observed]) if (!root.contains(el)) { io?.unobserve(el); observed.delete(el); visible.delete(el) }
      for (const group of root.querySelectorAll('[data-usage-group]')) for (const b of buttons(group)) if (!observed.has(b)) { observed.add(b); io?.observe(b) }
      schedule()
    })
    // IntersectionObserver accounts for viewport AND clipped/closed ancestor areas.
    safe(() => { io = new IntersectionObserver(entries => { for (const e of entries) { if (e.isIntersecting && e.intersectionRatio > 0) visible.add(e.target); else visible.delete(e.target) }; schedule() }); mo = new MutationObserver(refresh); mo.observe(root, { childList: true, subtree: true }); refresh() })
    const ensure = () => { recorder.ensure(context.current.editing ? 'edit' : 'create'); schedule() }
    const focus = (e: Event) => safe(() => { if (e.target instanceof Element && !ignored(e.target)) ensure() })
    const commit = (el: HTMLInputElement | HTMLTextAreaElement) => {
      const detail = dirty.get(el)
      if (!detail) return
      dirty.delete(el); recorder.record('field_commit', { ...detail, source: 'manual', cleared: el.value.length === 0 })
    }
    flushFields.current = () => safe(() => { for (const el of dirty.keys()) commit(el) })
    const input = (e: Event) => safe(() => {
      const el = e.target
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || ignored(el) || ['checkbox', 'radio'].includes(el.type)) return
      const detail = fieldOf(el)
      if (detail) { ensure(); if (!dirty.has(el)) dirty.set(el, detail) }
    })
    const blur = (e: Event) => safe(() => { if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) commit(e.target) })
    const change = (e: Event) => safe(() => {
      const el = e.target
      if (!(el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type))) || ignored(el)) return
      const detail = fieldOf(el)
      if (detail) { ensure(); recorder.record('field_commit', { ...detail, source: 'manual', cleared: el instanceof HTMLSelectElement ? !el.value : !(el as HTMLInputElement).checked }) }
    })
    const click = (e: Event) => safe(() => {
      if (!(e.target instanceof Element) || ignored(e.target)) return
      const b = e.target.closest<HTMLElement>('button,summary')
      if (!b) return
      const action = b.dataset.usageAction
      const group = b.closest<HTMLElement>('[data-usage-group]')
      if (action === 'expand' || b.tagName === 'SUMMARY') {
        ensure(); recorder.record('expand', { ...(group && groups.has(group.dataset.usageGroup!) ? { group: group.dataset.usageGroup as UsageDetails['group'] } : {}), ...fieldOf(b), slot: slot(b), selected: b.getAttribute('aria-expanded') !== 'true' }); return
      }
      if (action === 'clear-stage' || action === 'category-name') { ensure(); recorder.record('field_commit', { field: action === 'clear-stage' ? 'stage' : 'activity', slot: slot(b), cleared: true, source: 'button' }); return }
      if (group && groups.has(group.dataset.usageGroup!) && buttons(group).includes(b)) {
        ensure(); inspect(); recorder.record('choice', { group: group.dataset.usageGroup as UsageDetails['group'], slot: slot(b), position: buttons(group).indexOf(b), selected: b.getAttribute('aria-pressed') === 'true', automatic: group.dataset.usageAutomatic === 'true', source: 'shortcut' }); return
      }
      if (b.closest('.category-field')) { ensure(); recorder.record('field_commit', { field: 'category', slot: slot(b), source: 'button', selected: b.getAttribute('aria-pressed') === 'true' }) }
    })
    const visibility = () => safe(() => { flushFields.current(); recorder.record('visibility', { visibility: document.hidden ? 'hidden' : 'visible' }); if (document.hidden) void recorder.flush() })
    const windowFocus = () => recorder.record('visibility', { visibility: 'focused' })
    const windowBlur = () => recorder.record('visibility', { visibility: 'blurred' })
    const leave = () => { flushFields.current(); recorder.end('unknown', 'page_leave'); void recorder.flush() }
    root.addEventListener('pointerdown', focus, true); root.addEventListener('keydown', focus, true); root.addEventListener('input', input, true); root.addEventListener('change', change, true); root.addEventListener('blur', blur, true); root.addEventListener('click', click, true)
    document.addEventListener('visibilitychange', visibility); window.addEventListener('focus', windowFocus); window.addEventListener('blur', windowBlur); window.addEventListener('pagehide', leave)
    const timer = setInterval(() => { void recorder.flush() }, 1000)
    return () => {
      flushFields.current(); recorder.end('unknown', paused ? 'pause' : 'context_change'); void recorder.flush(); recorder.setEnabled(false)
      io?.disconnect(); mo?.disconnect(); clearInterval(timer); scan.current = () => {}; flushFields.current = () => {}
      root.removeEventListener('pointerdown', focus, true); root.removeEventListener('keydown', focus, true); root.removeEventListener('input', input, true); root.removeEventListener('change', change, true); root.removeEventListener('blur', blur, true); root.removeEventListener('click', click, true)
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('focus', windowFocus); window.removeEventListener('blur', windowBlur); window.removeEventListener('pagehide', leave)
    }
  }, [enabled, paused, recorder, form])
  return {
    recorder, paused, available,
    commitFields: () => flushFields.current(),
    begin: (mode: 'create' | 'edit', entry: NonNullable<UsageDetails['entry']>) => { flushFields.current(); recorder.begin(mode, entry); scan.current() },
    interrupt: () => { flushFields.current(); recorder.end('unknown', 'context_change') },
    toggle: () => { const value = !paused; if (value) { flushFields.current(); recorder.end('unknown', 'pause'); void recorder.flush(); recorder.setEnabled(false) }; setPaused(value); try { localStorage.setItem(PAUSE_KEY, String(value)) } catch { /* pause still works for this page */ } }
  }
}
