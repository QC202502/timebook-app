'use client'

import { useLayoutEffect, useRef } from 'react'

type Props = { value: string; onChange: (value: string) => void; label: string; placeholder: string; describedBy?: string }
export function ActivityInput({ value, onChange, label, placeholder, describedBy }: Props) {
  const field = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const resize = () => {
      const el = field.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = Math.min(182, el.scrollHeight + 2) + 'px'
      el.style.overflowY = el.scrollHeight > 180 ? 'auto' : 'hidden'
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [value])
  return <textarea ref={field} data-usage-field="activity" name="activity" className="activity-input" aria-label={label} aria-describedby={describedBy} aria-keyshortcuts="Enter Shift+Enter" title="Enter 保存 · Shift+Enter 换行" rows={1} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
}
