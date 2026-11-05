'use client'

import { useId, useRef, type KeyboardEvent, type ClipboardEvent } from 'react'
import { parseClock, stepClock } from '@/shared/lib/ledger-v2'

type Props = {
  label: string
  value: string
  nextDay?: boolean
  allowNextDay?: boolean
  disabled?: boolean
  maxAbsolute?: number
  onChange: (value: string, nextDay: boolean) => void
}

export function TimeInput({ label, value, nextDay = false, allowNextDay = false, disabled = false, maxAbsolute, onChange }: Props) {
  const id = useId()
  const hours = useRef<HTMLInputElement>(null)
  const minutes = useRef<HTMLInputElement>(null)
  const [hour = '', minute = ''] = value.split(':')
  const normalized = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
  const valid = hour !== '' && minute !== '' && Number.isFinite(parseClock(normalized)) && Number(hour) < 24
  const absolute = parseClock(normalized) + (nextDay ? 1440 : 0)
  const upperBound = Math.min(maxAbsolute ?? Infinity, allowNextDay ? 2879 : 1439)
  const invalidHour = hour !== '' && (!/^\d{1,2}$/.test(hour) || Number(hour) > 23)
  const invalidMinute = minute !== '' && (!/^\d{1,2}$/.test(minute) || Number(minute) > 59)

  function step(delta: number) {
    if (disabled || !valid || absolute + delta > upperBound) return
    const result = stepClock(normalized, delta, nextDay, allowNextDay)
    if (result) onChange(result.value, result.nextDay)
  }
  function change(part: 'hour' | 'minute', text: string) {
    if (!/^\d{0,2}$/.test(text)) return
    onChange(part === 'hour' ? `${text}:${minute}` : `${hour}:${text}`, nextDay)
  }
  function pad(part: 'hour' | 'minute') {
    const text = part === 'hour' ? hour : minute
    if (text.length === 1) change(part, text.padStart(2, '0'))
  }
  function key(e: KeyboardEvent<HTMLInputElement>, part: 'hour' | 'minute') {
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
    if (e.key === 'Enter') {
      e.preventDefault(); if (!e.repeat) e.currentTarget.form?.requestSubmit()
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault(); step(e.key === 'ArrowUp' ? 1 : -1)
    } else if (part === 'hour' && (e.key === ':' || (e.key === 'ArrowRight' && e.currentTarget.selectionStart === hour.length))) {
      e.preventDefault(); minutes.current?.focus(); minutes.current?.select()
    } else if (part === 'minute' && e.key === 'ArrowLeft' && e.currentTarget.selectionStart === 0) {
      e.preventDefault(); hours.current?.focus(); hours.current?.select()
    }
  }
  function paste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text').trim().replace('：', ':')
    if (!/^\d{1,2}:\d{2}$/.test(text)) return
    e.preventDefault()
    const [h, m] = text.split(':')
    const total = parseClock(`${h.padStart(2, '0')}:${m}`)
    if (!Number.isFinite(total) || (total === 1440 && !allowNextDay)) return
    onChange(total === 1440 ? '00:00' : `${h.padStart(2, '0')}:${m}`, total === 1440 ? true : nextDay)
  }

  return <fieldset className="time-control" disabled={disabled}>
    <legend>{label}{nextDay && <span className="time-day-badge">次日</span>}</legend>
    <div className={`time-control-body${invalidHour || invalidMinute ? ' time-control-invalid' : ''}`}>
      <label className="time-part" htmlFor={`${id}-hour`}>
        <input id={`${id}-hour`} ref={hours} aria-label={`${label}小时`} aria-invalid={invalidHour || undefined} value={hour} placeholder="HH" inputMode="numeric" autoComplete="off" maxLength={2} pattern="(?:[01]?[0-9]|2[0-3])" required onChange={e => change('hour', e.target.value)} onBlur={() => pad('hour')} onFocus={e => e.target.select()} onKeyDown={e => key(e, 'hour')} onPaste={paste} />
        <span>时</span>
      </label>
      <span className="time-colon" aria-hidden="true">:</span>
      <label className="time-part" htmlFor={`${id}-minute`}>
        <input id={`${id}-minute`} ref={minutes} aria-label={`${label}分钟`} aria-invalid={invalidMinute || undefined} value={minute} placeholder="mm" inputMode="numeric" autoComplete="off" maxLength={2} pattern="[0-5]?[0-9]" required onChange={e => change('minute', e.target.value)} onBlur={() => pad('minute')} onFocus={e => e.target.select()} onKeyDown={e => key(e, 'minute')} onPaste={paste} />
        <span>分</span>
      </label>
      <div className="time-stepper">
        <button type="button" aria-label={`${label}时间增加 1 分钟`} title="增加 1 分钟（↑）" disabled={!valid || absolute >= upperBound} onClick={() => step(1)}><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 7 3-3 3 3" /></svg></button>
        <button type="button" aria-label={`${label}时间减少 1 分钟`} title="减少 1 分钟（↓）" disabled={!valid || absolute <= 0} onClick={() => step(-1)}><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 5 3 3 3-3" /></svg></button>
      </div>
    </div>
  </fieldset>
}
