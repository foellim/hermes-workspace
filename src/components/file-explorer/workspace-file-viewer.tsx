import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Markdown } from '@/components/prompt-kit/markdown'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

const LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  md: 'markdown',
  css: 'css',
  html: 'html',
  yml: 'yaml',
  yaml: 'yaml',
  env: 'dotenv',
}

function getExtension(path: string) {
  const parts = path.split('.')
  return parts.length > 1 ? parts.pop()!.toLowerCase() : ''
}

function isImageFile(path: string) {
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(
    getExtension(path),
  )
}

function isMarkdownFile(path: string) {
  return ['md', 'mdx'].includes(getExtension(path))
}

function isHtmlFile(path: string) {
  return ['html', 'htm'].includes(getExtension(path))
}

function isTextFile(path: string) {
  return !isImageFile(path)
}

function getDefaultViewMode(path: string) {
  if (isMarkdownFile(path) || isHtmlFile(path)) return 'preview'
  return 'source'
}

export function downloadWorkspaceFile(path: string, name?: string) {
  const anchor = document.createElement('a')
  anchor.href = `/api/files?action=download&path=${encodeURIComponent(path)}`
  if (name) anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
}

type WorkspaceFileViewerProps = {
  path: string | null
  onSaved?: () => void
  leadingAction?: ReactNode
  trailingAction?: ReactNode
  onOpenPage?: () => void
  layout?: 'dialog' | 'page'
  className?: string
}

export function WorkspaceFileViewer({
  path,
  onSaved,
  leadingAction,
  trailingAction,
  onOpenPage,
  layout = 'dialog',
  className,
}: WorkspaceFileViewerProps) {
  const [loading, setLoading] = useState(false)
  const [content, setContent] = useState('')
  const [dataUrl, setDataUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('source')

  const language = useMemo(() => {
    if (!path) return 'plaintext'
    const ext = getExtension(path)
    return LANGUAGE_MAP[ext] || 'plaintext'
  }, [path])

  useEffect(() => {
    if (!path) return
    setViewMode(getDefaultViewMode(path) as 'preview' | 'source')
  }, [path])

  const loadFile = useCallback(async () => {
    if (!path) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/files?action=read&path=${encodeURIComponent(path)}`,
      )
      if (!res.ok) throw new Error('Failed to read file')
      const data = (await res.json()) as {
        type: 'text' | 'image'
        content: string
      }
      if (data.type === 'image') {
        setDataUrl(data.content)
        setContent('')
      } else {
        setContent(data.content)
        setDataUrl('')
      }
      setDirty(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [path])

  useEffect(() => {
    if (path) void loadFile()
  }, [loadFile, path])

  const handleSave = useCallback(async () => {
    if (!path) return
    await fetch('/api/files', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'write',
        path,
        content,
      }),
    })
    setDirty(false)
    onSaved?.()
  }, [content, onSaved, path])

  if (!path) {
    return (
      <div
        className={cn(
          'flex h-full min-h-[260px] items-center justify-center rounded-2xl border border-dashed border-primary-200 bg-primary-50/50 px-6 text-center',
          className,
        )}
      >
        <div className="max-w-md">
          <h2 className="text-base font-medium text-primary-900">
            No file selected
          </h2>
          <p className="mt-2 text-sm text-primary-600">
            Choose a file in the explorer to preview, edit, or download it.
          </p>
        </div>
      </div>
    )
  }

  const showPreviewTabs =
    isTextFile(path) && (isMarkdownFile(path) || isHtmlFile(path))
  const allowSave = isTextFile(path)
  const shellClassName =
    layout === 'page'
      ? 'flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-primary-200 bg-primary-50/60 shadow-sm'
      : 'overflow-hidden rounded-2xl border border-primary-200 bg-primary-50/60 shadow-sm'

  return (
    <div className={cn(shellClassName, className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-primary-200 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-primary-900">
            {path}
          </div>
          <div className="mt-1 text-xs text-primary-500">
            {isImageFile(path)
              ? 'Image preview'
              : isMarkdownFile(path)
                ? 'Markdown source and rendered preview'
                : isHtmlFile(path)
                  ? 'HTML source and rendered preview'
                  : `Text editor (${language})`}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {leadingAction}
          {onOpenPage ? (
            <Button size="sm" variant="outline" onClick={onOpenPage}>
              Open page
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadWorkspaceFile(path, path.split('/').pop())}
          >
            Download
          </Button>
          {allowSave ? (
            <Button size="sm" onClick={handleSave} disabled={!dirty || loading}>
              Save
            </Button>
          ) : null}
          {trailingAction}
        </div>
      </div>

      <div className={cn(layout === 'page' ? 'min-h-0 flex-1' : '')}>
        {loading ? (
          <div className="px-4 py-6 text-sm text-primary-500">Loading...</div>
        ) : error ? (
          <div className="px-4 py-6 text-sm text-red-600">{error}</div>
        ) : isImageFile(path) ? (
          <div className="flex min-h-[320px] items-center justify-center p-4">
            {dataUrl ? (
              <img
                src={dataUrl}
                alt={path}
                className="max-h-[70vh] max-w-full rounded-xl border border-primary-200 bg-white object-contain"
              />
            ) : null}
          </div>
        ) : showPreviewTabs ? (
          <Tabs
            value={viewMode}
            onValueChange={(value) =>
              setViewMode(value as 'preview' | 'source')
            }
            className="h-full min-h-0 gap-0"
          >
            <div className="border-b border-primary-200 px-4 pt-3">
              <TabsList variant="underline" className="w-full justify-start">
                <TabsTab value="preview">Preview</TabsTab>
                <TabsTab value="source">Source</TabsTab>
              </TabsList>
            </div>
            <TabsPanel value="preview" className="min-h-0 flex-1">
              {viewMode === 'preview' ? (
                isMarkdownFile(path) ? (
                  <div className="h-full overflow-auto px-4 py-4">
                    <div className="mx-auto max-w-4xl rounded-2xl border border-primary-200 bg-primary-50 p-5 shadow-sm">
                      <Markdown className="gap-3 [&_article]:bg-transparent [&_aside]:bg-transparent [&_div]:bg-transparent [&_footer]:bg-transparent [&_header]:bg-transparent [&_li]:bg-transparent [&_main]:bg-transparent [&_nav]:bg-transparent [&_ol]:bg-transparent [&_p]:bg-transparent [&_section]:bg-transparent [&_span]:bg-transparent [&_table]:bg-transparent [&_tbody]:bg-transparent [&_td]:bg-transparent [&_tfoot]:bg-transparent [&_th]:bg-transparent [&_tr]:bg-transparent [&_ul]:bg-transparent">
                        {content}
                      </Markdown>
                    </div>
                  </div>
                ) : (
                  <div className="h-full min-h-[440px] overflow-hidden p-4">
                    <iframe
                      title={path}
                      srcDoc={content}
                      className="h-full min-h-[440px] w-full rounded-xl border border-primary-200 bg-white"
                      sandbox="allow-same-origin"
                    />
                  </div>
                )
              ) : null}
            </TabsPanel>
            <TabsPanel value="source" className="min-h-0 flex-1">
              {viewMode === 'source' ? (
                <div className="h-full p-4">
                  <textarea
                    className="h-[60vh] min-h-[440px] w-full resize-none rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 font-mono text-xs leading-relaxed text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                    value={content}
                    onChange={(e) => {
                      setContent(e.target.value)
                      setDirty(true)
                    }}
                    spellCheck={false}
                  />
                </div>
              ) : null}
            </TabsPanel>
          </Tabs>
        ) : (
          <div className="p-4">
            <textarea
              className="h-[60vh] min-h-[440px] w-full resize-none rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 font-mono text-xs leading-relaxed text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              value={content}
              onChange={(e) => {
                setContent(e.target.value)
                setDirty(true)
              }}
              spellCheck={false}
            />
          </div>
        )}
      </div>
    </div>
  )
}
