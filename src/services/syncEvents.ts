export const SYNC_COMPLETED_EVENT = 'notes-app:sync-completed'
export interface SyncCompleted {
  owner: string
  entryIds: string[]
  groupIds: string[]
}
