import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  createEprPending,
  getEprPendingsMemoryPath,
  getEprPendingsStorePath,
  getEprPendingsSummary,
  listEprPendings,
  searchEprPendings,
  type PendingOrigin,
  type PendingPriority,
  type PendingStatus,
} from '../../server/epr-pendings-store'

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

export const Route = createFileRoute('/api/epr-pendings')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return jsonResponse({ error: 'Unauthorized' }, 401)
        }

        const url = new URL(request.url)
        const includeDone = url.searchParams.get('include_done') === 'true'
        const includeArchived = url.searchParams.get('include_archived') === 'true'
        const query = url.searchParams.get('query')?.trim() || ''
        const limitParam = Number(url.searchParams.get('limit') || '')
        const filters = {
          status: url.searchParams.get('status'),
          priority: url.searchParams.get('priority'),
          assignee: url.searchParams.get('assignee'),
          executionAgent: url.searchParams.get('execution_agent'),
          withFollowUp: url.searchParams.get('follow_up') === 'true',
          includeDone,
          includeArchived,
        }
        const items = query
          ? searchEprPendings(query, {
              ...filters,
              limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 10,
            })
          : listEprPendings(filters)

        return jsonResponse({
          items,
          summary: getEprPendingsSummary(items),
          store_path: getEprPendingsStorePath(),
          memory_path: getEprPendingsMemoryPath(),
        })
      },

      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return jsonResponse({ error: 'Unauthorized' }, 401)
        }

        try {
          const body = (await request.json()) as Record<string, unknown>
          if (typeof body.title !== 'string' || !body.title.trim()) {
            return jsonResponse({ error: 'title is required' }, 400)
          }

          const item = createEprPending({
            title: body.title.trim(),
            description: typeof body.description === 'string' ? body.description : '',
            status: isPendingStatus(body.status) ? body.status : 'backlog',
            archived: body.archived === true,
            priority: isPendingPriority(body.priority) ? body.priority : 'medium',
            tags: Array.isArray(body.tags)
              ? body.tags.filter((tag): tag is string => typeof tag === 'string')
              : [],
            assignee: typeof body.assignee === 'string' ? body.assignee : null,
            origin: isPendingOrigin(body.origin) ? body.origin : 'workspace',
            next_action:
              typeof body.next_action === 'string' ? body.next_action : '',
            follow_up_at:
              typeof body.follow_up_at === 'string' ? body.follow_up_at : null,
            last_note: typeof body.last_note === 'string' ? body.last_note : '',
            live_summary:
              typeof body.live_summary === 'string' ? body.live_summary : '',
            created_by:
              typeof body.created_by === 'string' ? body.created_by : 'user',
          })

          return jsonResponse({ item }, 201)
        } catch {
          return jsonResponse({ error: 'Invalid request body' }, 400)
        }
      },
    },
  },
})
