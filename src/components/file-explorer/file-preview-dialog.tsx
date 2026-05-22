import { DialogClose, DialogContent, DialogRoot } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { resolveRouterBasepath } from '@/router'
import { WorkspaceFileViewer } from './workspace-file-viewer'

type FilePreviewDialogProps = {
  path: string | null
  onClose: () => void
  onSaved: () => void
}

export default function FilePreviewDialog({
  path,
  onClose,
  onSaved,
}: FilePreviewDialogProps) {
  const basepath = resolveRouterBasepath()

  return (
    <DialogRoot
      open={Boolean(path)}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="w-[min(900px,96vw)]">
        <WorkspaceFileViewer
          path={path}
          onSaved={onSaved}
          onOpenPage={
            path
              ? () => {
                  onClose()
                  const prefix = basepath === '/' ? '' : basepath
                  window.location.assign(
                    `${prefix}/files/view?path=${encodeURIComponent(path)}`,
                  )
                }
              : undefined
          }
          trailingAction={
            <DialogClose render={<Button variant="outline">Close</Button>} />
          }
        />
      </DialogContent>
    </DialogRoot>
  )
}
