import { addDays, secondaryIdsOf, type Category, type LedgerRecord } from './ledger-v2.ts'

/** Each saved activity counts once per selected secondary, including multi-action workouts. */
export function secondariesByFrequency(category: Category, records: LedgerRecord[], today: string) {
  const firstDay = addDays(today, -29), counts = new Map<string, number>(), seen = new Set<string>()
  for (const record of records) {
    if (record.category !== category.id || record.date < firstDay || record.date > today || seen.has(record.id)) continue
    seen.add(record.id)
    for (const id of new Set(secondaryIdsOf(record))) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return category.children.map((child, index) => ({ child, index, count: counts.get(child.id) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.index - b.index).map(row => row.child)
}

/** Saved entries in the latest 30 calendar days, independent of the editor's time. */
export function categoriesByFrequency(categories: Category[], records: LedgerRecord[], today: string): Category[] {
  const firstDay = addDays(today, -29)
  const counts = new Map<string, number>(), seen = new Set<string>()
  for (const record of records) {
    if (record.date < firstDay || record.date > today || seen.has(record.id)) continue
    seen.add(record.id)
    counts.set(record.category, (counts.get(record.category) ?? 0) + 1)
  }
  // Stable tie-breaking preserves the user's category-manager order.
  return categories.map((category, index) => ({ category, index, count: counts.get(category.id) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.index - b.index).map(row => row.category)
}
