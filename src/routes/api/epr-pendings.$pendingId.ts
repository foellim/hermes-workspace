import { createFileRoute } from '@tanstack/react-router'
import { randomUUID } from 'node:crypto'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  addEprPendingNote,
  createEprPendingExecution,
  getEprPending,
  promotePendingToMemory,
  updateEprPending,
  updateEprPendingExecution,
  type ExecutionStatus,
  type PendingOrigin,
  type PendingPriority,
  type PendingStatus,
} from '../../server/epr-pendings-store'
import {
  createTask,
  updateTask as updateWorkspaceTask,
} from '../../server/tasks-store'
import {
  appendLocalMessage,
  ensureLocalSession,
} from '../../server/local-session-store'

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
    'You are handling a delegated task from the EPR pending board.',
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
    'Return a concise status, blockers, and next action.',
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

export const Route = createFileRoute('/api/epr-pendings/$pendingId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return jsonResponse({ error: 'Unauthorized' }, 401)
        }

        const item = getEprPending(params.pendingId)
        if (!item) return jsonResponse({ error: 'Pending not found' }, 404)
        return jsonResponse({ item })
      },

      PATCH: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return jsonResponse({ error: 'Unauthorized' }, 401)
        }

        try {
          const body = (await request.json()) as Record<string, unknown>
          const item = updateEprPending(
            params.pendingId,
            {
              title: typeof body.title === 'string' ? body.title : undefined,
              description:
                typeof body.description === 'string' ? body.description : undefined,
              status: isPendingStatus(body.status) ? body.status : undefined,
              archived: body.archived === true || body.archived === false ? body.archived : undefined,
              priority: isPendingPriority(body.priority)
                ? body.priority
                : undefined,
              tags: Array.isArray(body.tags)
                ? body.tags.filter((tag): tag is string => typeof tag === 'string')
                : undefined,
              assignee:
                body.assignee === null || typeof body.assignee === 'string'
                  ? body.assignee
                  : undefined,
              origin: isPendingOrigin(body.origin) ? body.origin : undefined,
              next_action:
                typeof body.next_action === 'string'
                  ? body.next_action
                  : undefined,
              follow_up_at:
                body.follow_up_at === null ||
                typeof body.follow_up_at === 'string'
                  ? body.follow_up_at
                  : undefined,
              last_note:
                typeof body.last_note === 'string' ? body.last_note : undefined,
              live_summary:
                typeof body.live_summary === 'string'
                  ? body.live_summary
                  : undefined,
            },
            typeof body.actor === 'string' ? body.actor : 'user',
          )
          if (!item) return jsonResponse({ error: 'Pending not found' }, 404)
          return jsonResponse({ item })
        } catch {
          return jsonResponse({ error: 'Invalid request body' }, 400)
        }
      },

      POST: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return jsonResponse({ error: 'Unauthorized' }, 401)
        }

        const url = new URL(request.url)
        const action = url.searchParams.get('action') || 'note'

        try {
          const body = (await request.json().catch(() => ({}))) as Record<
            string,
            unknown
          >

          if (action === 'note') {
            if (typeof body.content !== 'string' || !body.content.trim()) {
              return jsonResponse({ error: 'content is required' }, 400)
            }
            const item = addEprPendingNote(
              params.pendingId,
              body.content,
              typeof body.actor === 'string' ? body.actor : 'user',
            )
            if (!item) return jsonResponse({ error: 'Pending not found' }, 404)
            return jsonResponse({ item })
          }

          if (action === 'promote-memory') {
            const item = promotePendingToMemory(
              params.pendingId,
              typeof body.actor === 'string' ? body.actor : 'user',
            )
            if (!item) return jsonResponse({ error: 'Pending not found' }, 404)
            return jsonResponse({ item })
          }

          if (action === 'delegate') {
            if (typeof body.agent_id !== 'string' || !body.agent_id.trim()) {
              return jsonResponse({ error: 'agent_id is required' }, 400)
            }
            if (typeof body.objective !== 'string' || !body.objective.trim()) {
              return jsonResponse({ error: 'objective is required' }, 400)
            }

            const pending = getEprPending(params.pendingId)
            if (!pending) return jsonResponse({ error: 'Pending not found' }, 404)

            let linkedTaskId: string | null = null
            let linkedSessionId: string | null = null
            let sessionBriefing: string | null = null

            const autoTask = body.auto_task !== false
            const launchSession = body.launch_session === true
            const targetWorkspace =
              typeof body.target_workspace === 'string'
                ? body.target_workspace
                : null

            if (autoTask && !targetWorkspace) {
              const linkedTask = createTask({
                title: `[EPR] ${pending.title}`,
                description: [
                  pending.description,
                  '',
                  `Execution objective: ${body.objective}`,
                  pending.next_action
                    ? `Next action: ${pending.next_action}`
                    : '',
                ]
                  .filter(Boolean)
                  .join('\n'),
                assignee: body.agent_id,
                tags: ['epr', 'pending-link', pending.id],
                priority: pending.priority,
                created_by:
                  typeof body.actor === 'string' ? body.actor : 'user',
              })
              linkedTaskId = linkedTask.id

              if (launchSession) {
                const session = createDelegatedSession({
                  pendingTitle: pending.title,
                  pendingDescription: pending.description,
                  objective: body.objective,
                  agentId: body.agent_id,
                })
                linkedSessionId = session.sessionId
                sessionBriefing = session.briefing
                updateWorkspaceTask(linkedTask.id, {
                  session_id: session.sessionId,
                })
              }
            }

            const result = createEprPendingExecution(params.pendingId, {
              agent_id: body.agent_id.trim(),
              objective: body.objective.trim(),
              target_workspace: targetWorkspace,
              actor: typeof body.actor === 'string' ? body.actor : 'user',
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

          if (action === 'execution') {
            if (typeof body.execution_id !== 'string' || !body.execution_id.trim()) {
              return jsonResponse({ error: 'execution_id is required' }, 400)
            }

            const result = updateEprPendingExecution(
              params.pendingId,
              body.execution_id,
              {
                status: isExecutionStatus(body.status) ? body.status : undefined,
                linked_task_id:
                  body.linked_task_id === null ||
                  typeof body.linked_task_id === 'string'
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
                    : undefined,
                actor: typeof body.actor === 'string' ? body.actor : 'user',
              },
            )
            if (!result) {
              return jsonResponse(
                { error: 'Pending or execution not found' },
                404,
              )
            }
            return jsonResponse({ item: result.pending, execution: result.execution })
          }

          return jsonResponse({ error: `Unsupported action: ${action}` }, 400)
        } catch {
          return jsonResponse({ error: 'Invalid request body' }, 400)
        }
      },
    },
  },
})
