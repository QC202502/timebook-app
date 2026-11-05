/** Optional installation defaults. Shipped empty: recommendations learn from your own records.
 * These values are bundled into the browser. Do not put secrets or private history here.
 */
export type Profile = {
  knownPeople: string[]
  toolProjects: { secondary: string; project: string; label: string }[]
  workouts: { label: string; activities: string[] }[]
  pickup: null | { activity: string; person: string; weekdays: number[]; start: number; returnStart: number; end: number }
  lunchObject: string
  confirmedCompanions: boolean
  excludedProjects: string[]
}
export const profile: Profile = {
  knownPeople: [], toolProjects: [], workouts: [], pickup: null,
  lunchObject: '', confirmedCompanions: false, excludedProjects: []
}
