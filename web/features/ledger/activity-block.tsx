'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { activityTitle, categoryOf, clock, duration, secondaryNames, type Category, type LedgerRecord } from '@/shared/lib/ledger-v2'

type Props = { record: LedgerRecord; categories: Category[]; selected: boolean; start: number; end: number; hourStart: number; slot: number; slots: number; showLabel: boolean; onSelect: (id: string) => void }
type Anchor = { left: number; right: number; top: number; bottom: number }

export function ActivityBlock({ record, categories, selected, start, end, hourStart, slot, slots, showLabel: showDuration, onSelect }: Props) {
  const id = useId()
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const tooltip = useRef<HTMLDivElement>(null)
  const focusFrame = useRef(0)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const title = activityTitle(record, categories), category = categoryOf(record.category, categories)
  const secondary = secondaryNames(record, categories)
  const cancelClose = () => { if (closeTimer.current) clearTimeout(closeTimer.current); closeTimer.current = null }
  const close = () => { cancelClose(); setAnchor(null) }
  const open = (button: HTMLButtonElement) => {
    cancelClose()
    const label = button.querySelector<HTMLElement>('.activity-label')
    // Line clamping or a narrow fragment may hide text.
    // Measure the rendered result instead of guessing from the title's length.
    if (label && label.scrollHeight <= label.clientHeight + 1 && label.scrollWidth <= label.clientWidth + 1) {
      setAnchor(null)
      return
    }
    const rect = button.getBoundingClientRect()
    setAnchor({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })
  }
  const leave = () => { cancelClose(); closeTimer.current = setTimeout(close, 160) }

  useLayoutEffect(() => {
    if (!anchor || !tooltip.current) return
    const rect = tooltip.current.getBoundingClientRect()
    const above = anchor.top - rect.height - 7
    let left = Math.max(12, Math.min(anchor.left, window.innerWidth - rect.width - 12))
    let top = Math.max(12, above)
    if (above < 12) {
      if (anchor.right + 7 + rect.width <= window.innerWidth - 12) left = anchor.right + 7
      else if (anchor.left - rect.width - 7 >= 12) left = anchor.left - rect.width - 7
      top = Math.max(12, Math.min(anchor.top, window.innerHeight - rect.height - 12))
    }
    setPosition({ left, top })
  }, [anchor, title, secondary, record.project])
  useEffect(() => {
    if (!anchor) return
    const outside = (event: Event) => { if (!(event.target instanceof Node) || !tooltip.current?.contains(event.target)) close() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('scroll', outside, true)
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('scroll', outside, true); window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('resize', close); window.removeEventListener('blur', close); window.removeEventListener('keydown', escape)
    }
  }, [anchor])
  useEffect(() => () => { cancelClose(); cancelAnimationFrame(focusFrame.current) }, [])

  return <><button type="button" data-record-id={record.id} data-parallel-count={slots}
    aria-label={`${title} ${clock(record.start)} 至 ${clock(record.end)}`} aria-describedby={anchor ? id : undefined}
    className={`activity-block${selected ? ' is-selected' : ''}`}
    onPointerEnter={e => { if (e.pointerType !== 'touch' && e.buttons === 0) open(e.currentTarget) }} onPointerLeave={leave}
    onFocus={e => { const button = e.currentTarget; focusFrame.current = requestAnimationFrame(() => { if (document.activeElement === button) open(button) }) }} onBlur={close}
    onClick={e => { if (e.detail === 0) onSelect(record.id) }}
    style={{ '--activity-color': category.color, '--label-lines': slots === 1 ? 4 : slots === 2 ? 2 : 1, left: `${(start - hourStart) / 60 * 100}%`, width: `${(end - start) / 60 * 100}%`, top: `${slot / slots * 100}%`, height: `${100 / slots}%` } as CSSProperties}>
    <span className="activity-label">{title}</span>
    {showDuration && end - start >= 18 && <small>{record.end - record.start}′</small>}
  </button>{anchor && createPortal(<div ref={tooltip} id={id} role="tooltip" className="activity-tooltip" style={{ ...position, '--activity-color': category.color } as CSSProperties}>
    <strong>{title}</strong><p className="tooltip-time">{clock(record.start)}—{clock(record.end)} <span>· {duration(record.end - record.start)}{slots > 1 ? ` · ${slots} 件事同时进行` : ''}</span></p>
    <p className="tooltip-category">{category.name}{secondary ? ` / ${secondary}` : ''}{record.stage ? ` · ${record.stage}` : ''}</p>
    {record.project && <p className="tooltip-project">{record.project}</p>}
  </div>, document.body)}</>
}
