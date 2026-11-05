import { activityTitle, categoryOf, clock, isFuture, layoutFilledBlocks, recordsForDay, summarize, type Category, type LedgerRecord } from './ledger-v2.ts'

export type DayShareOptions = { range: 'recorded' | 'from-six' | 'full'; labels: 'activity' | 'primary' | 'selected'; details: boolean; selectedIds?: string[]; shareTitles?: Record<string, string>; neutralHiddenColors?: boolean }
export const DEFAULT_DAY_SHARE_OPTIONS: DayShareOptions = { range: 'recorded', labels: 'activity', details: false }
export const PRIVATE_BLOCK_COLOR = '#a5aea1'

export function dayShareRecords(records: LedgerRecord[], date: string, range: DayShareOptions['range']) {
  const lowerBound = range === 'from-six' ? 360 : 0
  // Rebase clipped carry-in records to the selected date before summarizing again.
  return recordsForDay(records, date).filter(r => r.end > lowerBound).map(r => ({ ...r, date, start: Math.max(lowerBound, r.start) }))
}

/** A presentation-only snapshot: notes, projects and record IDs never enter the image. */
export function buildDayShare(records: LedgerRecord[], categories: Category[], date: string, options: DayShareOptions, now: { date: string; minute: number }, demo = false) {
  const daily = dayShareRecords(records, date, options.range)
  const privateShare = options.labels === 'selected', selected = new Set(options.selectedIds ?? [])
  const publicRecords = privateShare ? daily.filter(r => selected.has(r.id)) : daily
  const stats = summarize(publicRecords, date, 1440, categories)
  const start = options.range === 'from-six' ? 360 : options.range === 'full' || !daily.length ? 0 : Math.floor(daily[0].start / 60) * 60
  const lastEnd = daily.length ? Math.max(...daily.map(r => r.end)) : start
  const end = options.range === 'from-six' ? lastEnd : options.range === 'full' || !daily.length ? 1440 : Math.ceil(lastEnd / 60) * 60
  const rangeLabel = options.range === 'from-six' && !daily.length ? '06:00 起（暂无记录）' : `${clock(start)}—${clock(end)}`
  const label = (r: LedgerRecord) => options.labels === 'primary' ? categoryOf(r.category, categories).name
    : privateShare && Object.hasOwn(options.shareTitles ?? {}, r.id) ? options.shareTitles![r.id] : activityTitle(r, categories)
  return {
    date, demo, start, end, rangeLabel, count: publicRecords.length, labels: options.labels, range: options.range,
    futureCount: demo ? 0 : publicRecords.filter(r => isFuture({ ...r, date }, now)).length,
    covered: stats.covered, total: stats.total, parallel: stats.parallel,
    hours: Array.from({ length: Math.ceil((end - start) / 60) }, (_, i) => {
      const hour = start / 60 + i
      return { hour, blocks: layoutFilledBlocks(daily, hour * 60, Math.min(end, (hour + 1) * 60)).map(b => {
        const hidden = privateShare && !selected.has(b.record.id)
        return {
          start: b.start, end: b.end, slot: b.slot, slots: b.slots, hidden, showLabel: !hidden && (privateShare || b.showLabel),
          label: hidden ? '' : label(b.record), color: hidden && options.neutralHiddenColors ? PRIVATE_BLOCK_COLOR : categoryOf(b.record.category, categories).color,
          approximate: hidden ? false : b.record.approximate,
        }
      }) }
    }),
    categories: privateShare ? [] : stats.categories.filter(c => c.minutes > 0).sort((a, b) => b.minutes - a.minutes).map(c => ({ name: c.name, color: c.color, minutes: c.minutes })),
    details: options.details ? publicRecords.map(r => ({ start: r.start, end: r.end, label: label(r), color: categoryOf(r.category, categories).color, approximate: r.approximate })) : [],
  }
}

export type DayShare = ReturnType<typeof buildDayShare>
