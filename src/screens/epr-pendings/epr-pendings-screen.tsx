import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import {
  addEprPendingNote,
  createEprPending,
  delegateEprPending,
  fetchEprPendings,
  promoteEprPendingToMemory,
  PENDING_PRIORITY_LABELS,
  PENDING_STATUS_LABELS,
  updateEprPending,
  type EprPending,
  type PendingPriority,
  type PendingStatus,
} from '@/lib/epr-pendings-api'
import { fetchAssignees, type TaskAssignee } from '@/lib/tasks-api'

const QUERY_KEY = ['epr-pendings'] as const
const ASSIGNEES_KEY = ['claude', 'tasks', 'assignees'] as const
const EXECUTION_AGENT_PRESETS: Array<TaskAssignee> = [
  { id: 'orchestrator', label: 'Orchestrator', isHuman: false },
  { id: 'gorpo', label: 'Gorpo', isHuman: false },
  { id: 'duncan', label: 'Duncan', isHuman: false },
]

const STATUS_OPTIONS: PendingStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'review',
  'blocked',
  'standby',
  'done',
]

function formatDateTime(value: string | null) {
  if (!value) return 'Not set'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function formatDate(value: string | null) {
  if (!value) return ''
  return value.slice(0, 10)
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent?: boolean
}) {
  return (
    <div
      style={!accent ? { backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' } : undefined}
      className={cn(
        'rounded-xl border p-3 shadow-sm',
        accent ? 'border-accent-300 bg-accent-50/50' : 'border-primary-200',
      )}
    >
      <div className="text-xs uppercase tracking-[0.08em] text-primary-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-primary-950">{value}</div>
    </div>
  )
}

export function EprPendingsScreen() {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<PendingStatus | 'all'>('all')
  const [showArchived, setShowArchived] = useState(false)
  const [note, setNote] = useState('')
  const [delegateAgents, setDelegateAgents] = useState<string[]>([])
  const [delegateObjective, setDelegateObjective] = useState('')
  const [liveSummaryDraft, setLiveSummaryDraft] = useState('')
  const [nextActionDraft, setNextActionDraft] = useState('')
  const [newPending, setNewPending] = useState({
    title: '',
    description: '',
    priority: 'medium' as PendingPriority,
    next_action: '',
  })

  const pendingsQuery = useQuery({
    queryKey: [...QUERY_KEY, statusFilter],
    queryFn: () =>
      fetchEprPendings({
        status: statusFilter === 'all' ? undefined : statusFilter,
        include_archived: showArchived,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  })
  const assigneesQuery = useQuery({
    queryKey: ASSIGNEES_KEY,
    queryFn: fetchAssignees,
    staleTime: 5 * 60_000,
  })

  const items = pendingsQuery.data?.items ?? []
  const summary = pendingsQuery.data?.summary
  const memoryPath = pendingsQuery.data?.memory_path ?? ''
  const storePath = pendingsQuery.data?.store_path ?? ''
  const assignees = assigneesQuery.data?.assignees ?? []
  const executionAgents = useMemo(() => {
    const merged = new Map<string, TaskAssignee>()
    for (const agent of EXECUTION_AGENT_PRESETS) merged.set(agent.id, agent)
    for (const assignee of assignees) merged.set(assignee.id, assignee)
    return Array.from(merged.values()).sort((left, right) =>
      left.label.localeCompare(right.label),
    )
  }, [assignees])

  const selected = useMemo(() => {
    if (!items.length) return null
    if (selectedId) {
      const found = items.find((item) => item.id === selectedId)
      if (found) return found
    }
    return items[0] ?? null
  }, [items, selectedId])

  useEffect(() => {
    setLiveSummaryDraft(selected?.live_summary ?? '')
    setNextActionDraft(selected?.next_action ?? '')
  }, [selected?.id, selected?.live_summary, selected?.next_action])

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: QUERY_KEY })
  }

  const createMutation = useMutation({
    mutationFn: createEprPending,
    onSuccess: async (item) => {
      setSelectedId(item.id)
      setNewPending({ title: '', description: '', priority: 'medium', next_action: '' })
      await invalidate()
      toast('EPR pending created')
    },
    onError: (error) =>
      toast(error instanceof Error ? error.message : 'Failed to create pending', {
        type: 'error',
      }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateEprPending>[1] }) =>
      updateEprPending(id, input),
    onSuccess: async () => {
      await invalidate()
      toast('Pending updated')
    },
    onError: (error) =>
      toast(error instanceof Error ? error.message : 'Failed to update pending', {
        type: 'error',
      }),
  })

  const noteMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      addEprPendingNote(id, content),
    onSuccess: async () => {
      setNote('')
      await invalidate()
      toast('Note added')
    },
    onError: (error) =>
      toast(error instanceof Error ? error.message : 'Failed to add note', {
        type: 'error',
      }),
  })

  const delegateMutation = useMutation({
    mutationFn: ({
      id,
      agent_ids,
      objective,
    }: {
      id: string
      agent_ids: string[]
      objective: string
    }) =>
      Promise.all(
        agent_ids.map((agent_id) =>
          delegateEprPending(id, {
            agent_id,
            objective,
            launch_session: true,
            auto_task: true,
          }),
        ),
      ),
    onSuccess: async (results) => {
      setDelegateAgents([])
      setDelegateObjective('')
      await invalidate()
      const agents = results.map((result) => result.execution.agent_id).join(', ')
      const sessionCount = results.filter((result) => result.linked_session_id).length
      const linked = sessionCount > 0 ? ` ${sessionCount} session(s) created.` : ''
      toast(`Executions delegated to ${agents}.${linked}`)
    },
    onError: (error) =>
      toast(error instanceof Error ? error.message : 'Failed to delegate pending', {
        type: 'error',
      }),
  })

  const promoteMutation = useMutation({
    mutationFn: promoteEprPendingToMemory,
    onSuccess: async () => {
      await invalidate()
      toast('Pending promoted to memory')
    },
    onError: (error) =>
      toast(error instanceof Error ? error.message : 'Failed to promote memory', {
        type: 'error',
      }),
  })

  const loading = pendingsQuery.isLoading && !pendingsQuery.data

  function toggleDelegateAgent(agentId: string) {
    setDelegateAgents((current) =>
      current.includes(agentId)
        ? current.filter((value) => value !== agentId)
        : [...current, agentId],
    )
  }

  return (
    <div className="min-h-full overflow-y-auto bg-surface text-ink">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-4 py-6 pb-[calc(var(--tabbar-h,80px)+1.5rem)] sm:px-6 lg:px-8">
        <header className="rounded-2xl border border-primary-200 bg-primary-50/85 p-5 backdrop-blur-xl">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <h1 className="text-2xl font-semibold text-primary-950">
                EPR Pendings
              </h1>
              <p className="mt-2 text-sm text-primary-700">
                New operational board for the EPR workspace. This page is separate
                from the current <code>/tasks</code> board and tracks live summary,
                follow-up, memory promotion, and linked agent executions.
              </p>
            </div>
            <div
              className="min-w-[240px] rounded-xl border border-primary-200 px-4 py-3 text-xs text-primary-700 shadow-sm"
              style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
            >
              <div>Store: <code>{storePath || 'loading...'}</code></div>
              <div className="mt-1">Memory: <code>{memoryPath || 'loading...'}</code></div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5 xl:grid-cols-10">
            <SummaryCard label="Total" value={summary?.total ?? 0} accent />
            <SummaryCard label="Backlog" value={summary?.backlog ?? 0} />
            <SummaryCard label="Ready" value={summary?.todo ?? 0} />
            <SummaryCard label="Running" value={summary?.in_progress ?? 0} />
            <SummaryCard label="Review" value={summary?.review ?? 0} />
            <SummaryCard label="Blocked" value={summary?.blocked ?? 0} />
            <SummaryCard label="Stand By" value={summary?.standby ?? 0} />
            <SummaryCard label="Done" value={summary?.done ?? 0} />
            <SummaryCard label="Follow-up" value={summary?.follow_up ?? 0} />
            <SummaryCard label="Archived" value={summary?.archived ?? 0} />
          </div>
        </header>

        <section className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <div
              className="rounded-2xl border border-primary-200 p-4 shadow-sm"
              style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
            >
              <h2 className="text-sm font-semibold text-primary-950">
                New Pending
              </h2>
              <div className="mt-3 space-y-3">
                <input
                  className="w-full rounded-xl border border-primary-200 px-3 py-2 text-sm text-primary-900 outline-none ring-accent-400 focus:ring-2"
                  style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
                  placeholder="Title"
                  value={newPending.title}
                  onChange={(event) =>
                    setNewPending((current) => ({ ...current, title: event.target.value }))
                  }
                />
                <textarea
                  className="h-24 w-full resize-none rounded-xl border border-primary-200 px-3 py-2 text-sm text-primary-900 outline-none ring-accent-400 focus:ring-2"
                  style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
                  placeholder="Description"
                  value={newPending.description}
                  onChange={(event) =>
                    setNewPending((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                />
                <div className="grid grid-cols-2 gap-3">
                  <select
                    className="rounded-xl border border-primary-200 px-3 py-2 text-sm text-primary-900 outline-none ring-accent-400 focus:ring-2"
                    style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
                    value={newPending.priority}
                    onChange={(event) =>
                      setNewPending((current) => ({
                        ...current,
                        priority: event.target.value as PendingPriority,
                      }))
                    }
                  >
                    {(['high', 'medium', 'low'] as PendingPriority[]).map((priority) => (
                      <option key={priority} value={priority}>
                        {PENDING_PRIORITY_LABELS[priority]}
                      </option>
                    ))}
                  </select>
                  <input
                    className="rounded-xl border border-primary-200 px-3 py-2 text-sm text-primary-900 outline-none ring-accent-400 focus:ring-2"
                    style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
                    placeholder="Next action"
                    value={newPending.next_action}
                    onChange={(event) =>
                      setNewPending((current) => ({
                        ...current,
                        next_action: event.target.value,
                      }))
                    }
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={!newPending.title.trim() || createMutation.isPending}
                  onClick={() =>
                    createMutation.mutate({
                      title: newPending.title.trim(),
                      description: newPending.description.trim(),
                      priority: newPending.priority,
                      next_action: newPending.next_action.trim(),
                      origin: 'workspace',
                    })
                  }
                >
                  {createMutation.isPending ? 'Creating...' : 'Create Pending'}
                </Button>
              </div>
            </div>

            <div
              className="rounded-2xl border border-primary-200 p-4 shadow-sm"
              style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-primary-950">Queue</h2>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-[11px] text-primary-600">
                    <input
                      type="checkbox"
                      checked={showArchived}
                      onChange={(event) => setShowArchived(event.target.checked)}
                    />
                    Archived
                  </label>
                  <select
                    className="rounded-lg border border-primary-200 px-2 py-1 text-xs text-primary-800"
                    style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
                    value={statusFilter}
                    onChange={(event) =>
                      setStatusFilter(event.target.value as PendingStatus | 'all')
                    }
                  >
                    <option value="all">All statuses</option>
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {PENDING_STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {loading ? (
                  <div className="text-sm text-primary-500">Loading...</div>
                ) : items.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-primary-300 bg-primary-50/40 px-3 py-5 text-sm text-primary-600">
                    No pendings yet.
                  </div>
                ) : (
                  items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      className={cn(
                        'w-full rounded-xl border px-3 py-3 text-left transition-colors',
                        selected?.id === item.id
                          ? 'border-accent-400 bg-accent-50/50'
                          : 'border-primary-200 hover:border-primary-300',
                      )}
                      style={
                        selected?.id === item.id
                          ? undefined
                          : { backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }
                      }
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-primary-950">
                            #{item.sequence_number} {item.title}
                          </div>
                          <div className="mt-1 text-xs text-primary-600">
                            {PENDING_STATUS_LABELS[item.status]} · {PENDING_PRIORITY_LABELS[item.priority]}{item.archived ? ' · Archived' : ''}
                          </div>
                        </div>
                        <div className="rounded-full bg-primary-100 px-2 py-0.5 text-[11px] font-medium text-primary-700">
                          {item.executions.length}
                        </div>
                      </div>
                      <div className="mt-2 line-clamp-2 text-xs text-primary-700">
                        {item.live_summary || item.last_note || item.description || 'No summary yet.'}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </aside>

          <section
            className="rounded-2xl border border-primary-200 p-5 shadow-sm"
            style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
          >
            {selected ? (
              <div className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.1em] text-primary-500">
                      Pending #{selected.sequence_number}
                    </div>
                    <h2 className="mt-1 text-2xl font-semibold text-primary-950">
                      #{selected.sequence_number} {selected.title}
                    </h2>
                    <p className="mt-2 max-w-3xl whitespace-pre-wrap text-sm text-primary-700">
                      {selected.description || 'No description yet.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={updateMutation.isPending}
                      onClick={() =>
                        updateMutation.mutate({
                          id: selected.id,
                          input: { archived: !selected.archived },
                        })
                      }
                    >
                      {selected.archived ? 'Restore' : 'Archive'}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={promoteMutation.isPending}
                      onClick={() => promoteMutation.mutate(selected.id)}
                    >
                      {promoteMutation.isPending ? 'Promoting...' : 'Promote to Memory'}
                    </Button>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <label className="space-y-1 text-xs text-primary-600">
                    <span>Status</span>
                    <select
                      className="w-full rounded-xl border border-primary-200 px-3 py-2 text-sm text-primary-900"
                      style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
                      value={selected.status}
                      onChange={(event) =>
                        updateMutation.mutate({
                          id: selected.id,
                          input: { status: event.target.value as PendingStatus },
                        })
                      }
                    >
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {PENDING_STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1 text-xs text-primary-600">
                    <span>Priority</span>
                    <select
                      className="w-full rounded-xl border border-primary-200 px-3 py-2 text-sm text-primary-900"
                      style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
                      value={selected.priority}
                      onChange={(event) =>
                        updateMutation.mutate({
                          id: selected.id,
                          input: { priority: event.target.value as PendingPriority },
                        })
                      }
                    >
                      {(['high', 'medium', 'low'] as PendingPriority[]).map((priority) => (
                        <option key={priority} value={priority}>
                          {PENDING_PRIORITY_LABELS[priority]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1 text-xs text-primary-600">
                    <span>Assignee</span>
                    <select
                      className="w-full rounded-xl border border-primary-200 px-3 py-2 text-sm text-primary-900"
                      style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
                      value={selected.assignee ?? ''}
                      onChange={(event) =>
                        updateMutation.mutate({
                          id: selected.id,
                          input: { assignee: event.target.value || null },
                        })
                      }
                    >
                      <option value="">Unassigned</option>
                      {assignees.map((assignee) => (
                        <option key={assignee.id} value={assignee.id}>
                          {assignee.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1 text-xs text-primary-600">
                    <span>Follow-up</span>
                    <input
                      type="date"
                      className="w-full rounded-xl border border-primary-200 px-3 py-2 text-sm text-primary-900"
                      style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
                      value={formatDate(selected.follow_up_at)}
                      onChange={(event) =>
                        updateMutation.mutate({
                          id: selected.id,
                          input: { follow_up_at: event.target.value || null },
                        })
                      }
                    />
                  </label>
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-primary-200 bg-primary-50/60 p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-primary-500">
                        Live Summary
                      </div>
                      <textarea
                        className="mt-2 h-28 w-full resize-none rounded-xl border border-primary-200 px-3 py-2 text-sm text-primary-900"
                        style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
                        value={liveSummaryDraft}
                        onChange={(event) => setLiveSummaryDraft(event.target.value)}
                      />
                      <Button
                        className="mt-3"
                        size="sm"
                        disabled={
                          liveSummaryDraft === selected.live_summary ||
                          updateMutation.isPending
                        }
                        onClick={() =>
                          updateMutation.mutate({
                            id: selected.id,
                            input: { live_summary: liveSummaryDraft },
                          })
                        }
                      >
                        Save Summary
                      </Button>
                    </div>

                    <div
                      className="rounded-2xl border border-primary-200 p-4"
                      style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
                    >
                      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-primary-500">
                        Next Action
                      </div>
                      <textarea
                        className="mt-2 h-24 w-full resize-none rounded-xl border border-primary-200 px-3 py-2 text-sm text-primary-900"
                        style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
                        value={nextActionDraft}
                        onChange={(event) => setNextActionDraft(event.target.value)}
                      />
                      <Button
                        className="mt-3"
                        size="sm"
                        disabled={
                          nextActionDraft === selected.next_action ||
                          updateMutation.isPending
                        }
                        onClick={() =>
                          updateMutation.mutate({
                            id: selected.id,
                            input: { next_action: nextActionDraft },
                          })
                        }
                      >
                        Save Next Action
                      </Button>
                    </div>

                    <div
                      className="rounded-2xl border border-primary-200 p-4"
                      style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
                    >
                      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-primary-500">
                        Gorpo Triage
                      </div>
                      <div className="mt-3 grid gap-3 text-sm text-primary-700 md:grid-cols-2">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.08em] text-primary-500">
                            Demand Type
                          </div>
                          <div className="mt-1">{selected.gorpo_triage.demand_type || 'Not defined'}</div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.08em] text-primary-500">
                            Deadline
                          </div>
                          <div className="mt-1">{selected.gorpo_triage.deadline || 'Not defined'}</div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.08em] text-primary-500">
                            Risk
                          </div>
                          <div className="mt-1 whitespace-pre-wrap">{selected.gorpo_triage.risk || 'Not defined'}</div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.08em] text-primary-500">
                            Can Act Now
                          </div>
                          <div className="mt-1">
                            {selected.gorpo_triage.actionable_now === null
                              ? 'Not defined'
                              : selected.gorpo_triage.actionable_now
                                ? 'Yes'
                                : 'No'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.08em] text-primary-500">
                            Specialist / Skill
                          </div>
                          <div className="mt-1 whitespace-pre-wrap">
                            {selected.gorpo_triage.specialist_needed || 'Not defined'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.08em] text-primary-500">
                            Dependencies
                          </div>
                          <div className="mt-1 whitespace-pre-wrap">
                            {selected.gorpo_triage.dependencies.length > 0
                              ? selected.gorpo_triage.dependencies.join(', ')
                              : 'None listed'}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 text-sm text-primary-700">
                        <div className="text-[11px] uppercase tracking-[0.08em] text-primary-500">
                          Definition of Done
                        </div>
                        <div className="mt-1 whitespace-pre-wrap">
                          {selected.gorpo_triage.definition_of_done || 'Not defined'}
                        </div>
                      </div>
                    </div>

                    <div
                      className="rounded-2xl border border-primary-200 p-4"
                      style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.08em] text-primary-500">
                          History
                        </div>
                        <div className="text-xs text-primary-500">
                          {selected.history.length} events
                        </div>
                      </div>
                      <div className="mt-3 max-h-[320px] space-y-2 overflow-auto pr-1">
                        {[...selected.history]
                          .slice()
                          .reverse()
                          .map((entry) => (
                            <div
                              key={entry.id}
                              className="rounded-xl border border-primary-100 bg-primary-50/50 px-3 py-2"
                            >
                              <div className="text-xs font-medium text-primary-900">
                                {entry.actor} · {entry.type}
                              </div>
                              <div className="mt-1 text-sm text-primary-700">
                                {entry.message}
                              </div>
                              <div className="mt-1 text-[11px] text-primary-500">
                                {formatDateTime(entry.created_at)}
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div
                      className="rounded-2xl border border-primary-200 p-4"
                      style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
                    >
                      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-primary-500">
                        Quick Note
                      </div>
                      <textarea
                        className="mt-2 h-24 w-full resize-none rounded-xl border border-primary-200 px-3 py-2 text-sm text-primary-900"
                        style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        placeholder="Add the latest update, blocker, or decision..."
                      />
                      <Button
                        className="mt-3 w-full"
                        disabled={!note.trim() || noteMutation.isPending}
                        onClick={() =>
                          noteMutation.mutate({
                            id: selected.id,
                            content: note.trim(),
                          })
                        }
                      >
                        {noteMutation.isPending ? 'Saving...' : 'Add Note'}
                      </Button>
                    </div>

                    <div
                      className="rounded-2xl border border-primary-200 p-4"
                      style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
                    >
                      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-primary-500">
                        Delegate Execution
                      </div>
                      <div className="mt-2 text-xs text-primary-600">
                        Assignee is the owner of the pending. Executions are the specialists or
                        orchestrators working on it.
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {executionAgents.map((agent) => {
                          const active = delegateAgents.includes(agent.id)
                          return (
                            <button
                              key={agent.id}
                              type="button"
                              className={cn(
                                'rounded-xl border px-3 py-2 text-left text-sm transition',
                                active
                                  ? 'border-accent-400 bg-accent-50 text-accent-900'
                                  : 'border-primary-200 text-primary-800 hover:border-primary-300',
                              )}
                              style={
                                active
                                  ? undefined
                                  : {
                                      backgroundColor: 'var(--theme-card)',
                                      borderColor: 'var(--theme-border)',
                                    }
                              }
                              onClick={() => toggleDelegateAgent(agent.id)}
                            >
                              <div className="font-medium">{agent.label}</div>
                              <div className="text-[11px] uppercase tracking-[0.08em] text-primary-500">
                                {active ? 'Selected' : 'Available'}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                      <textarea
                        className="mt-2 h-24 w-full resize-none rounded-xl border border-primary-200 px-3 py-2 text-sm text-primary-900"
                        style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
                        value={delegateObjective}
                        onChange={(event) => setDelegateObjective(event.target.value)}
                        placeholder="What should this agent solve?"
                      />
                      <Button
                        className="mt-3 w-full"
                        disabled={
                          delegateAgents.length === 0 ||
                          !delegateObjective.trim() ||
                          delegateMutation.isPending
                        }
                        onClick={() =>
                          delegateMutation.mutate({
                            id: selected.id,
                            agent_ids: delegateAgents,
                            objective: delegateObjective.trim(),
                          })
                        }
                      >
                        {delegateMutation.isPending
                          ? 'Delegating...'
                          : delegateAgents.length > 1
                            ? `Delegate to ${delegateAgents.length} agents`
                            : 'Delegate'}
                      </Button>
                    </div>

                    <div
                      className="rounded-2xl border border-primary-200 p-4"
                      style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.08em] text-primary-500">
                          Linked Executions
                        </div>
                        <div className="text-xs text-primary-500">
                          {selected.executions.length}
                        </div>
                      </div>
                      <div className="mt-3 space-y-2">
                        {selected.executions.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-primary-300 bg-primary-50/40 px-3 py-4 text-sm text-primary-600">
                            No executions linked yet.
                          </div>
                        ) : (
                          [...selected.executions]
                            .slice()
                            .reverse()
                            .map((execution) => (
                              <div
                                key={execution.id}
                                className="rounded-xl border border-primary-100 bg-primary-50/50 px-3 py-3"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-sm font-semibold text-primary-950">
                                    {execution.agent_id}
                                  </div>
                                  <div
                                    className="rounded-full px-2 py-0.5 text-[11px] font-medium text-primary-700"
                                    style={{ backgroundColor: 'var(--theme-card2)' }}
                                  >
                                    {execution.status}
                                  </div>
                                </div>
                                <div className="mt-1 text-sm text-primary-700">
                                  {execution.objective}
                                </div>
                                {execution.output_summary ? (
                                  <div className="mt-2 text-xs text-primary-600">
                                    {execution.output_summary}
                                  </div>
                                ) : null}
                                <div className="mt-2 text-[11px] text-primary-500">
                                  Task: {execution.linked_task_id ?? 'none'} · Session:{' '}
                                  {execution.linked_session_id ?? 'none'}
                                </div>
                              </div>
                            ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-dashed border-primary-300 bg-primary-50/50 text-center">
                <div>
                  <div className="text-base font-semibold text-primary-900">
                    No pending selected
                  </div>
                  <div className="mt-2 text-sm text-primary-600">
                    Create the first EPR pending or choose one from the queue.
                  </div>
                </div>
              </div>
            )}
          </section>
        </section>
      </div>
    </div>
  )
}
