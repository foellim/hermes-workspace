import { randomUUID } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  addEprPendingNote,
  createEprPending,
  createEprPendingExecution,
  findEprPendingBySequenceNumber,
  findEprPendingByTitle,
  getEprPending,
  getEprPendingsSummary,
  listEprPendings,
  promotePendingToMemory,
  searchEprPendings,
  updateEprPending,
  updateEprPendingExecution,
  type EprPendingRecord,
  type ExecutionStatus,
  type PendingGorpoTriage,
  type PendingOrigin,
  type PendingPriority,
  type PendingStatus,
} from '../../server/epr-pendings-store'
import { appendLocalMessage, ensureLocalSession } from '../../server/local-session-store'
import { createTask, updateTask as updateWorkspaceTask } from '../../server/tasks-store'

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function isPendingStatus(value: unknown): value is PendingStatus {
  return (
    value === 'backlog' ||
    value === 'todo' ||
    value === 'in_progress' ||
    value === 'review' ||
    value === 'blocked' ||
    value === 'standby' ||
    value === 'done'
  )
}

function isPendingPriority(value: unknown): value is PendingPriority {
  return value === 'high' || value === 'medium' || value === 'low'
}

function isPendingOrigin(value: unknown): value is PendingOrigin {
  return (
    value === 'workspace' ||
    value === 'telegram' ||
    value === 'agent' ||
    value === 'api'
  )
}

function isExecutionStatus(value: unknown): value is ExecutionStatus {
  return (
    value === 'requested' ||
    value === 'queued' ||
    value === 'running' ||
    value === 'blocked' ||
    value === 'done' ||
    value === 'cancelled'
  )
}

function createDelegatedSession(params: {
  pendingTitle: string
  pendingDescription: string
  objective: string
  agentId: string
}) {
  const sessionId = `epr-${params.agentId}-${randomUUID().slice(0, 8)}`
  const briefing = [
    'You are handling a delegated task from the EPR pending bridge.',
    '',
    `Pending: ${params.pendingTitle}`,
    `Assigned agent: ${params.agentId}`,
    '',
    'Pending context:',
    params.pendingDescription || '(no description)',
    '',
    'Execution objective:',
    params.objective,
    '',
    'Return a concise status, blockers, next action, and any concrete artifact paths.',
  ].join('\n')

  ensureLocalSession(sessionId)
  appendLocalMessage(sessionId, {
    id: randomUUID(),
    role: 'user',
    content: briefing,
    timestamp: Date.now(),
  })

  return { sessionId, briefing }
}

function pickLatestExecution(
  pending: EprPendingRecord,
  params: { executionId?: string | null; agentId?: string | null },
) {
  if (params.executionId) {
    return pending.executions.find((execution) => execution.id === params.executionId) ?? null
  }
  if (params.agentId) {
    return (
      [...pending.executions]
        .reverse()
        .find((execution) => execution.agent_id === params.agentId) ?? null
    )
  }
  return null
}

function readPendingSequenceNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().replace(/^[#pP-]+/, '')
    const parsed = Number(trimmed)
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed)
  }
  return null
}

function extractGorpoTriage(body: Record<string, unknown>): Partial<PendingGorpoTriage> | undefined {
  const triage = typeof body.gorpo_triage === 'object' && body.gorpo_triage
    ? (body.gorpo_triage as Record<string, unknown>)
    : body
  const next: Partial<PendingGorpoTriage> = {}

  if (typeof triage.demand_type === 'string') next.demand_type = triage.demand_type
  if (Array.isArray(triage.dependencies)) {
    next.dependencies = triage.dependencies.filter(
      (dependency): dependency is string => typeof dependency === 'string',
    )
  }
  if (typeof triage.deadline === 'string') next.deadline = triage.deadline
  if (triage.deadline === null) next.deadline = null
  if (typeof triage.risk === 'string') next.risk = triage.risk
  if (typeof triage.actionable_now === 'boolean') {
    next.actionable_now = triage.actionable_now
  }
  if (typeof triage.specialist_needed === 'string') {
    next.specialist_needed = triage.specialist_needed
  }
  if (typeof triage.definition_of_done === 'string') {
    next.definition_of_done = triage.definition_of_done
  }

  return Object.keys(next).length > 0 ? next : undefined
}

function resolvePending(body: Record<string, unknown>): EprPendingRecord | null {
  const pendingSequenceNumber = readPendingSequenceNumber(
    body.pending_number ?? body.sequence_number,
  )
  if (pendingSequenceNumber) {
    const byNumber = findEprPendingBySequenceNumber(pendingSequenceNumber, {
      includeDone: true,
    })
    if (byNumber) return byNumber
  }

  if (typeof body.pending_id === 'string' && body.pending_id.trim()) {
    return getEprPending(body.pending_id.trim())
  }

  if (typeof body.title === 'string' && body.title.trim()) {
    const exact = findEprPendingByTitle(body.title.trim(), { includeDone: true })
    if (exact) return exact
  }

  if (typeof body.query === 'string' && body.query.trim()) {
    return (
      searchEprPendings(body.query.trim(), {
        includeDone: true,
        limit: 1,
      })[0] ?? null
    )
  }

  return null
}

function extractPendingUpdates(body: Record<string, unknown>) {
  const gorpoTriage = extractGorpoTriage(body)
  return {
    title: typeof body.title === 'string' ? body.title.trim() : undefined,
    description:
      typeof body.description === 'string' ? body.description : undefined,
    status: isPendingStatus(body.status) ? body.status : undefined,
    priority: isPendingPriority(body.priority) ? body.priority : undefined,
    tags: Array.isArray(body.tags)
      ? body.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean)
      : undefined,
    archived:
      body.archived === true || body.archived === false ? body.archived : undefined,
    assignee:
      body.assignee === null || typeof body.assignee === 'string'
        ? body.assignee
        : undefined,
    origin: isPendingOrigin(body.origin) ? body.origin : undefined,
    next_action:
      typeof body.next_action === 'string' ? body.next_action : undefined,
    follow_up_at:
      body.follow_up_at === null || typeof body.follow_up_at === 'string'
        ? body.follow_up_at
        : undefined,
    last_note:
      typeof body.last_note === 'string' ? body.last_note : undefined,
    live_summary:
      typeof body.live_summary === 'string' ? body.live_summary : undefined,
    gorpo_triage: gorpoTriage,
  }
}

function sanitizeCreatedBy(body: Record<string, unknown>) {
  return typeof body.actor === 'string' && body.actor.trim() ? body.actor.trim() : 'hermes'
}

function formatPendingSnapshot(item: EprPendingRecord) {
  return {
    number: item.sequence_number,
    title: item.title,
    status: item.status,
    priority: item.priority,
    next_action: item.next_action,
    follow_up_at: item.follow_up_at,
    risk: item.gorpo_triage.risk,
    specialist_needed: item.gorpo_triage.specialist_needed,
  }
}

function formatPendingLine(item: EprPendingRecord) {
  const parts = [
    `#${item.sequence_number}`,
    item.title,
    `[${item.status}/${item.priority}]`,
  ]
  if (item.next_action) parts.push(`next: ${item.next_action}`)
  if (item.follow_up_at) parts.push(`follow-up: ${item.follow_up_at}`)
  if (item.gorpo_triage.risk) parts.push(`risk: ${item.gorpo_triage.risk}`)
  if (item.gorpo_triage.specialist_needed) {
    parts.push(`specialist: ${item.gorpo_triage.specialist_needed}`)
  }
  return parts.join(' | ')
}

function buildBoardBriefing(items: EprPendingRecord[]) {
  const summary = getEprPendingsSummary(items)
  const now = new Date().toISOString().slice(0, 10)
  const open = items.filter((item) => item.status !== 'done')
  const blocked = open.filter((item) => item.status === 'blocked')
  const due = open.filter(
    (item) => item.follow_up_at && item.follow_up_at.slice(0, 10) <= now,
  )
  const delegated = open.filter((item) =>
    item.executions.some((execution) =>
      execution.status === 'requested' ||
      execution.status === 'queued' ||
      execution.status === 'running' ||
      execution.status === 'blocked',
    ),
  )
  const topQueue = [...open]
    .sort((left, right) => {
      const priorityWeight = { high: 0, medium: 1, low: 2 } as const
      const leftFollowUp = left.follow_up_at ?? '9999-99-99'
      const rightFollowUp = right.follow_up_at ?? '9999-99-99'
      if (leftFollowUp !== rightFollowUp) {
        return leftFollowUp.localeCompare(rightFollowUp)
      }
      if (priorityWeight[left.priority] !== priorityWeight[right.priority]) {
        return priorityWeight[left.priority] - priorityWeight[right.priority]
      }
      return left.sequence_number - right.sequence_number
    })
    .slice(0, 7)

  const lines = [
    `EPR pendings overview`,
    `Open: ${summary.total - summary.done} | Blocked: ${summary.blocked} | Follow-up due: ${summary.follow_up} | Done: ${summary.done}`,
    topQueue.length > 0 ? 'Priority queue:' : 'Priority queue: none',
    ...topQueue.map((item) => `- ${formatPendingLine(item)}`),
  ]

  if (blocked.length > 0) {
    lines.push('Blocked items:')
    lines.push(...blocked.slice(0, 5).map((item) => `- ${formatPendingLine(item)}`))
  }

  if (delegated.length > 0) {
    lines.push('Delegated or active executions:')
    lines.push(...delegated.slice(0, 5).map((item) => `- ${formatPendingLine(item)}`))
  }

  return {
    generated_at: new Date().toISOString(),
    summary,
    priority_queue: topQueue.map(formatPendingSnapshot),
    blocked: blocked.slice(0, 5).map(formatPendingSnapshot),
    follow_up_due: due.slice(0, 5).map(formatPendingSnapshot),
    delegated: delegated.slice(0, 5).map(formatPendingSnapshot),
    briefing: lines.join('\n'),
  }
}

export const Route = createFileRoute('/api/epr-pendings/bridge')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return jsonResponse({ error: 'Unauthorized' }, 401)
        }

        const url = new URL(request.url)
        const query = url.searchParams.get('query')?.trim() || ''
        const includeDone = url.searchParams.get('include_done') === 'true'
        const pendingNumber = readPendingSequenceNumber(
          url.searchParams.get('pending_number') ?? url.searchParams.get('sequence_number'),
        )
        if (pendingNumber) {
          const item = findEprPendingBySequenceNumber(pendingNumber, { includeDone: true })
          if (!item) return jsonResponse({ error: 'Pending not found' }, 404)
          return jsonResponse({ item })
        }
        const limitParam = Number(url.searchParams.get('limit') || '')
        const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 50) : 10
        const filters = {
          status: url.searchParams.get('status'),
          priority: url.searchParams.get('priority'),
          assignee: url.searchParams.get('assignee'),
          executionAgent: url.searchParams.get('execution_agent'),
          withFollowUp: url.searchParams.get('follow_up') === 'true',
          includeDone,
        }
        const items = query
          ? searchEprPendings(query, { ...filters, limit })
          : listEprPendings(filters).slice(0, limit)

        return jsonResponse({
          items,
          summary: getEprPendingsSummary(listEprPendings(filters)),
          query,
          limit,
        })
      },

      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return jsonResponse({ error: 'Unauthorized' }, 401)
        }

        try {
          const body = (await request.json()) as Record<string, unknown>
          const op =
            typeof body.op === 'string' && body.op.trim() ? body.op.trim() : 'capture'
          const actor = sanitizeCreatedBy(body)

          if (op === 'summary') {
            const includeDone = body.include_done === true
            const items = listEprPendings({
              includeDone,
              status: typeof body.status === 'string' ? body.status : null,
              assignee: typeof body.assignee === 'string' ? body.assignee : null,
              executionAgent:
                typeof body.execution_agent === 'string' ? body.execution_agent : null,
              withFollowUp: body.follow_up === true,
            })
            const now = new Date().toISOString().slice(0, 10)
            const open = items.filter((item) => item.status !== 'done').slice(0, 10)
            const blocked = items.filter((item) => item.status === 'blocked').slice(0, 10)
            const followUp = items
              .filter((item) => item.follow_up_at && item.follow_up_at.slice(0, 10) <= now)
              .slice(0, 10)
            const snapshot = open.map(formatPendingSnapshot)
            return jsonResponse({
              summary: getEprPendingsSummary(items),
              open,
              blocked,
              follow_up_due: followUp,
              snapshot,
            })
          }

          if (op === 'briefing') {
            const includeDone = body.include_done === true
            const items = listEprPendings({
              includeDone,
              status: typeof body.status === 'string' ? body.status : null,
              assignee: typeof body.assignee === 'string' ? body.assignee : null,
              executionAgent:
                typeof body.execution_agent === 'string' ? body.execution_agent : null,
              withFollowUp: body.follow_up === true,
            })
            return jsonResponse(buildBoardBriefing(items))
          }

          if (op === 'capture') {
            const note = typeof body.note === 'string' ? body.note.trim() : ''
            const updates = extractPendingUpdates(body)
            const existing = resolvePending(body)

            if (existing) {
              let item =
                Object.values(updates).some((value) => value !== undefined)
                  ? updateEprPending(existing.id, updates, actor) ?? existing
                  : existing
              if (note) {
                item = addEprPendingNote(existing.id, note, actor) ?? item
              }
              return jsonResponse({ mode: 'updated', item })
            }

            if (typeof body.title !== 'string' || !body.title.trim()) {
              return jsonResponse(
                { error: 'title is required when creating a pending' },
                400,
              )
            }

            let item = createEprPending({
              title: body.title.trim(),
              sequence_number: readPendingSequenceNumber(
                body.pending_number ?? body.sequence_number,
              ) ?? undefined,
              description:
                typeof body.description === 'string' ? body.description : '',
              status: isPendingStatus(body.status) ? body.status : 'backlog',
              priority: isPendingPriority(body.priority) ? body.priority : 'medium',
              tags: Array.isArray(body.tags)
                ? body.tags.filter((tag): tag is string => typeof tag === 'string')
                : [],
              assignee:
                typeof body.assignee === 'string' ? body.assignee : null,
              origin: isPendingOrigin(body.origin) ? body.origin : 'agent',
              next_action:
                typeof body.next_action === 'string' ? body.next_action : '',
              follow_up_at:
                typeof body.follow_up_at === 'string' ? body.follow_up_at : null,
              live_summary:
                typeof body.live_summary === 'string' ? body.live_summary : '',
              last_note: note || (typeof body.last_note === 'string' ? body.last_note : ''),
              created_by: actor,
              gorpo_triage: extractGorpoTriage(body),
            })
            if (note && note !== item.last_note) {
              item = addEprPendingNote(item.id, note, actor) ?? item
            }
            return jsonResponse({ mode: 'created', item }, 201)
          }

          if (op === 'delegate') {
            const pending = resolvePending(body)
            if (!pending) return jsonResponse({ error: 'Pending not found' }, 404)
            if (typeof body.agent_id !== 'string' || !body.agent_id.trim()) {
              return jsonResponse({ error: 'agent_id is required' }, 400)
            }
            if (typeof body.objective !== 'string' || !body.objective.trim()) {
              return jsonResponse({ error: 'objective is required' }, 400)
            }

            const autoTask = body.auto_task !== false
            const launchSession = body.launch_session === true
            const targetWorkspace =
              typeof body.target_workspace === 'string' && body.target_workspace.trim()
                ? body.target_workspace.trim()
                : null

            let linkedTaskId: string | null = null
            let linkedSessionId: string | null = null
            let sessionBriefing: string | null = null

            if (autoTask && !targetWorkspace) {
              const linkedTask = createTask({
                title: `[EPR] ${pending.title}`,
                description: [
                  pending.description,
                  '',
                  `Execution objective: ${body.objective.trim()}`,
                  pending.next_action ? `Next action: ${pending.next_action}` : '',
                ]
                  .filter(Boolean)
                  .join('\n'),
                assignee: body.agent_id.trim(),
                tags: ['epr', 'pending-link', pending.id],
                priority: pending.priority,
                created_by: actor,
              })
              linkedTaskId = linkedTask.id

              if (launchSession) {
                const session = createDelegatedSession({
                  pendingTitle: pending.title,
                  pendingDescription: pending.description,
                  objective: body.objective.trim(),
                  agentId: body.agent_id.trim(),
                })
                linkedSessionId = session.sessionId
                sessionBriefing = session.briefing
                updateWorkspaceTask(linkedTask.id, { session_id: session.sessionId })
              }
            }

            const result = createEprPendingExecution(pending.id, {
              agent_id: body.agent_id.trim(),
              objective: body.objective.trim(),
              target_workspace: targetWorkspace,
              actor,
              linked_task_id: linkedTaskId,
              linked_session_id: linkedSessionId,
            })
            if (!result) return jsonResponse({ error: 'Pending not found' }, 404)
            return jsonResponse({
              item: result.pending,
              execution: result.execution,
              linked_task_id: linkedTaskId,
              linked_session_id: linkedSessionId,
              session_briefing: sessionBriefing,
            })
          }

          if (op === 'report') {
            const pending = resolvePending(body)
            if (!pending) return jsonResponse({ error: 'Pending not found' }, 404)

            const note = typeof body.note === 'string' ? body.note.trim() : ''
            const updates = extractPendingUpdates(body)
            let item =
              Object.values(updates).some((value) => value !== undefined)
                ? updateEprPending(pending.id, updates, actor) ?? pending
                : pending
            if (note) {
              item = addEprPendingNote(pending.id, note, actor) ?? item
            }

            const execution = pickLatestExecution(item, {
              executionId:
                typeof body.execution_id === 'string' ? body.execution_id.trim() : null,
              agentId: typeof body.agent_id === 'string' ? body.agent_id.trim() : null,
            })

            let nextExecution = execution
            if (execution) {
              const result = updateEprPendingExecution(item.id, execution.id, {
                status: isExecutionStatus(body.status) ? body.status : undefined,
                linked_task_id:
                  body.linked_task_id === null || typeof body.linked_task_id === 'string'
                    ? body.linked_task_id
                    : undefined,
                linked_session_id:
                  body.linked_session_id === null ||
                  typeof body.linked_session_id === 'string'
                    ? body.linked_session_id
                    : undefined,
                output_summary:
                  typeof body.output_summary === 'string'
                    ? body.output_summary
                    : note || undefined,
                actor,
              })
              if (result) {
                item = result.pending
                nextExecution = result.execution
              }
            }

            if (body.promote_memory === true) {
              item = promotePendingToMemory(item.id, actor) ?? item
            }

            return jsonResponse({ item, execution: nextExecution })
          }

          if (op === 'promote-memory') {
            const pending = resolvePending(body)
            if (!pending) return jsonResponse({ error: 'Pending not found' }, 404)
            const item = promotePendingToMemory(pending.id, actor)
            if (!item) return jsonResponse({ error: 'Pending not found' }, 404)
            return jsonResponse({ item })
          }

          return jsonResponse({ error: `Unsupported op: ${op}` }, 400)
        } catch {
          return jsonResponse({ error: 'Invalid request body' }, 400)
        }
      },
    },
  },
})
