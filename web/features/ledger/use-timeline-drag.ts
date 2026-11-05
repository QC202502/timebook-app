'use client'

import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { dragSpan, minuteInTrack } from '@/shared/lib/record-edit'

type Span = { start: number; end: number }
type Options = { scroll: RefObject<HTMLDivElement | null>; enabled: boolean; selection: Span | null; onPreview: (span: Span | null) => void; onCreate: (span: Span) => void; onEdit: (id: string) => void }
type Gesture = { pointerId: number; origin: number; last: number; x: number; y: number; currentX: number; currentY: number; moved: boolean; recordId?: string; previous: Span | null; target: HTMLElement }

export function useTimelineDrag(options: Options) {
  const latest = useRef(options); latest.current = options
  const gesture = useRef<Gesture | null>(null)
  useEffect(() => {
    let frame = 0
    function minuteAt(x: number, y: number) {
      const viewport = latest.current.scroll.current
      if (!viewport) return null
      const area = viewport.getBoundingClientRect()
      if (y < area.top || y >= area.bottom) return null
      for (const row of viewport.querySelectorAll<HTMLElement>('.hour-track')) {
        const rect = row.getBoundingClientRect()
        if (y >= rect.top && y < rect.bottom && x >= rect.left && x <= rect.right) return minuteInTrack(x, rect.left, rect.width, Number(row.parentElement!.dataset.hour))
      }
      return null
    }
    function preview(g: Gesture) {
      const minute = minuteAt(g.currentX, g.currentY)
      if (minute !== null) { g.last = minute; latest.current.onPreview(dragSpan(g.origin, minute)) }
    }
    function autoScroll() {
      const g = gesture.current, viewport = latest.current.scroll.current
      if (!g?.moved || !viewport) { frame = 0; return }
      const area = viewport.getBoundingClientRect()
      // Only scroll at the actual visible edge, including when the page clips the grid.
      const top = Math.max(0, area.top), bottom = Math.min(window.innerHeight, area.bottom)
      const delta = g.currentY < top + 24 ? -9 : g.currentY > bottom - 24 ? 9 : 0
      if (delta && g.currentX >= area.left && g.currentX <= area.right && g.currentY >= top && g.currentY <= bottom) { viewport.scrollTop += delta; preview(g) }
      frame = requestAnimationFrame(autoScroll)
    }
    function release(g: Gesture) {
      gesture.current = null; cancelAnimationFrame(frame); frame = 0
      if (g.target.hasPointerCapture(g.pointerId)) g.target.releasePointerCapture(g.pointerId)
    }
    function cancel() {
      const g = gesture.current
      if (!g) return
      release(g); latest.current.onPreview(g.previous)
    }
    function move(e: PointerEvent) {
      const g = gesture.current
      if (!g || e.pointerId !== g.pointerId) return
      if (!latest.current.enabled) { cancel(); return }
      g.currentX = e.clientX; g.currentY = e.clientY
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) >= 4) g.moved = true
      if (g.moved) { e.preventDefault(); preview(g); if (!frame) frame = requestAnimationFrame(autoScroll) }
    }
    function finish(e: PointerEvent) {
      const g = gesture.current
      if (!g || g.pointerId !== e.pointerId) return
      const minute = minuteAt(e.clientX, e.clientY)
      if (!latest.current.enabled || minute === null) { cancel(); return }
      release(g)
      if (!g.moved && g.recordId) latest.current.onEdit(g.recordId)
      else latest.current.onCreate(dragSpan(g.origin, minute))
    }
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel() }
    window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel); window.addEventListener('blur', cancel); window.addEventListener('keydown', escape)
    return () => { cancel(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', cancel); window.removeEventListener('keydown', escape) }
  }, [])
  return (e: ReactPointerEvent<HTMLDivElement>, hour: number) => {
    if (!latest.current.enabled || e.button !== 0 || gesture.current) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect(), minute = minuteInTrack(e.clientX, rect.left, rect.width, hour)
    const recordId = (e.target as HTMLElement).closest<HTMLElement>('[data-record-id]')?.dataset.recordId
    gesture.current = { pointerId: e.pointerId, origin: minute, last: minute, x: e.clientX, y: e.clientY, currentX: e.clientX, currentY: e.clientY, moved: false, recordId, previous: latest.current.selection, target: e.currentTarget }
    e.currentTarget.setPointerCapture(e.pointerId)
    if (!recordId) latest.current.onPreview(dragSpan(minute, minute))
  }
}
