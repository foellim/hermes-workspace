import path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { safeErrorMessage, requireJsonContentType } from '../../server/rate-limit'
import { loadWorkspaceCatalog } from './workspace'
import {
  buildMilleoFiles,
  buildMilleoSummary,
  classifyMilleoFile,
  readMilleoState,
  upsertMilleoProject,
  type MilleoFileKind,
  type MilleoFileStatus,
} from '../../server/milleo-cockpit-store'

async function getWorkspaceRoot() {
  const catalog = await loadWorkspaceCatalog()
  if (!catalog.isValid || !catalog.path) throw new Error('No valid workspace selected')
  return catalog.path
}

function ensureRelativePath(input: unknown, workspaceRoot: string) {
  const raw = typeof input === 'string' ? input.trim() : ''
  if (!raw) throw new Error('Path is required')
  const resolved = path.isAbsolute(raw)
    ? path.resolve(raw)
    : path.resolve(workspaceRoot, raw)
  const relative = path.relative(workspaceRoot, resolved)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path is outside workspace')
  }
  return relative
}

function stringArray(input: unknown) {
  if (!Array.isArray(input)) return []
  return input
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
}

export const Route = createFileRoute('/api/milleo')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        try {
          const workspaceRoot = await getWorkspaceRoot()
          const url = new URL(request.url)
          const action = url.searchParams.get('action') || 'summary'

          if (action === 'files') {
            return json({
              ok: true,
              workspaceRoot,
              files: await buildMilleoFiles(workspaceRoot),
            })
          }

          if (action === 'projects') {
            const state = await readMilleoState()
            return json({ ok: true, projects: state.projects })
          }

          return json({
            ok: true,
            summary: await buildMilleoSummary(workspaceRoot),
          })
        } catch (err) {
          return json({ ok: false, error: safeErrorMessage(err) }, { status: 500 })
        }
      },
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        try {
          const workspaceRoot = await getWorkspaceRoot()
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
          const action = typeof body.action === 'string' ? body.action : ''

          if (action === 'project') {
            const name = typeof body.name === 'string' ? body.name : ''
            const summary = typeof body.summary === 'string' ? body.summary : ''
            const project = await upsertMilleoProject({
              name,
              summary,
              tags: stringArray(body.tags),
            })
            return json({ ok: true, project })
          }

          if (action === 'classify') {
            const record = await classifyMilleoFile({
              path: ensureRelativePath(body.path, workspaceRoot),
              title: typeof body.title === 'string' ? body.title : undefined,
              summary: typeof body.summary === 'string' ? body.summary : undefined,
              projectId:
                typeof body.projectId === 'string' && body.projectId
                  ? body.projectId
                  : null,
              projectName:
                typeof body.projectName === 'string' ? body.projectName : undefined,
              kind: typeof body.kind === 'string' ? (body.kind as MilleoFileKind) : undefined,
              status:
                typeof body.status === 'string'
                  ? (body.status as MilleoFileStatus)
                  : undefined,
              tags: stringArray(body.tags),
              people: stringArray(body.people),
            })
            return json({ ok: true, record })
          }

          return json({ ok: false, error: 'Unsupported action' }, { status: 400 })
        } catch (err) {
          return json({ ok: false, error: safeErrorMessage(err) }, { status: 500 })
        }
      },
    },
  },
})
