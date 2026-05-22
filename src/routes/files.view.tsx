import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { WorkspaceFileViewer } from '@/components/file-explorer/workspace-file-viewer'
import { usePageTitle } from '@/hooks/use-page-title'
import { Button } from '@/components/ui/button'

const searchSchema = z.object({
  path: z.string().optional(),
})

function getFileName(path: string | undefined) {
  if (!path) return 'File Viewer'
  const parts = path.split('/').filter(Boolean)
  return parts.at(-1) || path
}

export const Route = createFileRoute('/files/view')({
  ssr: false,
  validateSearch: searchSchema,
  component: FilesViewRoute,
})

function FilesViewRoute() {
  const navigate = useNavigate()
  const { path } = Route.useSearch()

  usePageTitle(path ? `Viewer - ${getFileName(path)}` : 'File Viewer')

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface px-3 py-3 text-primary-900 md:px-4 md:py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-medium text-primary-900">
            File Viewer
          </h1>
          <p className="text-sm text-primary-600">
            Full-page preview for workspace files, with save and download
            actions.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void navigate({ to: '/files', search: {} })}
        >
          Back to files
        </Button>
      </div>

      <div className="min-h-0 flex-1">
        <WorkspaceFileViewer path={path ?? null} layout="page" />
      </div>
    </div>
  )
}
