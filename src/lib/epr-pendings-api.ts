export type PendingStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'review'
  | 'blocked'
  | 'standby'
  | 'done'

export type PendingPriority = 'high' | 'medium' | 'low'
export type PendingOrigin = 'workspace' | 'telegram' | 'agent' | 'api'
export type ExecutionStatus =
  | 'requested'
  | 'queued'
  | 'running'
  | 'blocked'
  | 'done'
  | 'cancelled'

export type EprPendingHistoryEntry = {
  id: string
  type: string
  message: string
  created_at: string
  actor: string
}

export type EprPendingExecution = {
  id: string
  agent_id: string
  objective: string
  target_workspace: string | null
  status: ExecutionStatus
  linked_task_id: string | null
  linked_session_id: string | null
  output_summary: string
  created_at: string
  updated_at: string
}

export type EprPendingGorpoTriage = {
  demand_type: string
  dependencies: string[]
  deadline: string | null
  risk: string
  actionable_now: boolean | null
  specialist_needed: string
  definition_of_done: string
}

export type EprPending = {
  id: string
  sequence_number: number
  title: string
  description: string
  status: PendingStatus
  archived: boolean
  priority: PendingPriority
  tags: string[]
  assignee: string | null
  origin: PendingOrigin
  next_action: string
  follow_up_at: string | null
  last_note: string
  live_summary: string
  created_by: string
  created_at: string
  updated_at: string
  gorpo_triage: EprPendingGorpoTriage
  executions: EprPendingExecution[]
  history: EprPendingHistoryEntry[]
}

export type EprPendingSummary = {
  total: number
  backlog: number
  todo: number
  in_progress: number
  review: number
  blocked: number
  standby: number
  done: number
  follow_up: number
  archived: number
}

export type CreateEprPendingInput = {
  title: string
  description?: string
  sequence_number?: number
  status?: PendingStatus
  archived?: boolean
  priority?: PendingPriority
  tags?: string[]
  assignee?: string | null
  origin?: PendingOrigin
  next_action?: string
  follow_up_at?: string | null
  last_note?: string
  live_summary?: string
  created_by?: string
  gorpo_triage?: Partial<EprPendingGorpoTriage>
}

export type UpdateEprPendingInput = Partial<CreateEprPendingInput>

export type DelegatePendingInput = {
  agent_id: string
  objective: string
  target_workspace?: string | null
  auto_task?: boolean
  launch_session?: boolean
  actor?: string
}

export type UpdateExecutionInput = {
  execution_id: string
  status?: ExecutionStatus
  linked_task_id?: string | null
  linked_session_id?: string | null
  output_summary?: string
  actor?: string
}

export async function fetchEprPendings(params?: {
  status?: PendingStatus
  priority?: PendingPriority
  assignee?: string | null
  execution_agent?: string | null
  follow_up?: boolean
  include_archived?: boolean
}): Promise<{
  items: EprPending[]
  summary: EprPendingSummary
  store_path: string
  memory_path: string
}> {
  const query = new URLSearchParams()
  if (params?.status) query.set('status', params.status)
  if (params?.priority) query.set('priority', params.priority)
  if (params?.assignee) query.set('assignee', params.assignee)
  if (params?.execution_agent) query.set('execution_agent', params.execution_agent)
  if (params?.follow_up) query.set('follow_up', 'true')
  if (params?.include_archived) query.set('include_archived', 'true')
  const url = query.size > 0 ? `/api/epr-pendings?${query}` : '/api/epr-pendings'
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch EPR pendings: ${res.status}`)
  return res.json()
}

export async function createEprPending(
  input: CreateEprPendingInput,
): Promise<EprPending> {
  const res = await fetch('/api/epr-pendings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`Failed to create pending: ${res.status}`)
  return (await res.json()).item
}

export async function updateEprPending(
  id: string,
  input: UpdateEprPendingInput & { actor?: string },
): Promise<EprPending> {
  const res = await fetch(`/api/epr-pendings/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`Failed to update pending: ${res.status}`)
  return (await res.json()).item
}

export async function addEprPendingNote(
  id: string,
  content: string,
  actor = 'user',
): Promise<EprPending> {
  const res = await fetch(`/api/epr-pendings/${id}?action=note`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, actor }),
  })
  if (!res.ok) throw new Error(`Failed to add note: ${res.status}`)
  return (await res.json()).item
}

export async function promoteEprPendingToMemory(
  id: string,
  actor = 'user',
): Promise<EprPending> {
  const res = await fetch(`/api/epr-pendings/${id}?action=promote-memory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor }),
  })
  if (!res.ok) throw new Error(`Failed to promote pending to memory: ${res.status}`)
  return (await res.json()).item
}

export async function delegateEprPending(
  id: string,
  input: DelegatePendingInput,
): Promise<{
  item: EprPending
  execution: EprPendingExecution
  linked_task_id: string | null
  linked_session_id: string | null
  session_briefing: string | null
}> {
  const res = await fetch(`/api/epr-pendings/${id}?action=delegate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`Failed to delegate pending: ${res.status}`)
  return res.json()
}

export async function updateEprPendingExecution(
  id: string,
  input: UpdateExecutionInput,
): Promise<{ item: EprPending; execution: EprPendingExecution }> {
  const res = await fetch(`/api/epr-pendings/${id}?action=execution`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`Failed to update execution: ${res.status}`)
  return res.json()
}

export const PENDING_STATUS_LABELS: Record<PendingStatus, string> = {
  backlog: 'Backlog',
  todo: 'Ready',
  in_progress: 'Running',
  review: 'Review',
  blocked: 'Blocked',
  standby: 'Stand By',
  done: 'Done',
}

export const PENDING_PRIORITY_LABELS: Record<PendingPriority, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}
