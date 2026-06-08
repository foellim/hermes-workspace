import { useEffect, useMemo, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'

type MilleoFile = {
  path: string
  name: string
  title: string
  summary: string
  projectId: string | null
  projectName: string | null
  kind: string
  status: string
  tags: Array<string>
  people: Array<string>
  modifiedAt: string
  indexed: boolean
}

type MilleoProject = {
  id: string
  name: string
}

const FILE_KINDS = [
  'analysis',
  'minutes',
  'briefing',
  'report',
  'summary',
  'proposal',
  'official_letter',
  'checklist',
  'evidence',
  'source',
  'other',
]

const FILE_STATUSES = [
  'unclassified',
  'draft',
  'final',
  'evidence',
  'reference',
  'pending',
  'archived',
]

const selectClassName =
  'rounded-md border border-primary-200 bg-surface px-3 py-2 text-sm text-primary-900 outline-none focus:border-accent-500 [&_option]:bg-white [&_option]:text-neutral-950'

export const Route = createFileRoute('/curation')({
  ssr: false,
  component: CurationRoute,
})

function CurationRoute() {
  usePageTitle('File Curation')
  const [files, setFiles] = useState<Array<MilleoFile>>([])
  const [projects, setProjects] = useState<Array<MilleoProject>>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('needs_curation')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedFile = files.find((file) => file.path === selectedPath) ?? files[0] ?? null

  const filteredFiles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return files.filter((file) => {
      const matchesStatus =
        status === 'all' ||
        (status === 'needs_curation'
          ? !file.indexed || file.status === 'unclassified'
          : file.status === status)
      const matchesQuery =
        !normalizedQuery ||
        [file.title, file.summary, file.path, file.projectName ?? '', file.tags.join(' ')]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery)
      return matchesStatus && matchesQuery
    })
  }, [files, query, status])

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const [filesRes, projectsRes] = await Promise.all([
        fetch('/api/milleo?action=files'),
        fetch('/api/milleo?action=projects'),
      ])
      const filesData = await filesRes.json()
      const projectsData = await projectsRes.json()
      if (!filesRes.ok || !filesData.ok) throw new Error(filesData.error || 'Failed to load files')
      if (!projectsRes.ok || !projectsData.ok) {
        throw new Error(projectsData.error || 'Failed to load projects')
      }
      const nextFiles = filesData.files as Array<MilleoFile>
      setFiles(nextFiles)
      setProjects(projectsData.projects)
      setSelectedPath((current) => current ?? nextFiles[0]?.path ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  async function saveClassification(formData: FormData) {
    if (!selectedFile) return
    setSaving(true)
    setError(null)
    try {
      const projectMode = String(formData.get('projectMode') || 'existing')
      const body = {
        action: 'classify',
        path: selectedFile.path,
        title: String(formData.get('title') || ''),
        summary: String(formData.get('summary') || ''),
        projectId:
          projectMode === 'existing'
            ? String(formData.get('projectId') || '') || null
            : null,
        projectName:
          projectMode === 'new' ? String(formData.get('projectName') || '') : '',
        kind: String(formData.get('kind') || 'other'),
        status: String(formData.get('status') || 'reference'),
        tags: String(formData.get('tags') || '')
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        people: String(formData.get('people') || '')
          .split(',')
          .map((person) => person.trim())
          .filter(Boolean),
      }
      const res = await fetch('/api/milleo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to save classification')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface text-primary-900">
      <header className="border-b border-primary-200 px-4 py-4 md:px-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-xl font-semibold">Curadoria de arquivos</h1>
            <p className="mt-1 max-w-2xl text-sm text-primary-600">
              Classifique apenas documentos úteis de projeto. Arquivos técnicos,
              memória interna, logs e estado operacional ficam fora desta fila.
            </p>
          </div>
          <Link
            to="/cockpit"
            className="inline-flex items-center justify-center rounded-md border border-primary-200 px-3 py-2 text-sm hover:bg-primary-50"
          >
            Voltar ao Cockpit
          </Link>
        </div>
      </header>

      {error ? (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[420px_1fr]">
        <aside className="flex min-h-0 flex-col border-r border-primary-200">
          <div className="space-y-2 border-b border-primary-200 p-3">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por arquivo, projeto ou tag"
              className="w-full rounded-md border border-primary-200 bg-surface px-3 py-2 text-sm outline-none focus:border-accent-500"
            />
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className={`w-full ${selectClassName}`}
            >
              <option value="needs_curation">A curar</option>
              <option value="all">Documentos úteis</option>
              {FILE_STATUSES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {loading ? (
              <p className="p-4 text-sm text-primary-500">Carregando arquivos...</p>
            ) : filteredFiles.length === 0 ? (
              <p className="p-4 text-sm text-primary-500">Nenhum documento útil neste filtro.</p>
            ) : (
              filteredFiles.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => setSelectedPath(file.path)}
                  className={[
                    'mb-2 w-full rounded-md border p-3 text-left transition-colors',
                    selectedFile?.path === file.path
                      ? 'border-accent-500 bg-accent-50'
                      : 'border-primary-100 bg-primary-50 hover:bg-primary-100',
                  ].join(' ')}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium">{file.title}</span>
                    <span className="shrink-0 rounded bg-surface px-2 py-0.5 text-[11px] text-primary-600">
                      {file.indexed ? file.status : 'new'}
                    </span>
                  </div>
                  <p className="mt-2 truncate text-[11px] text-primary-500">{file.path}</p>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="min-h-0 overflow-y-auto p-4 md:p-6">
          {!selectedFile ? (
            <p className="text-sm text-primary-500">Selecione um documento para classificar.</p>
          ) : (
            <form
              key={selectedFile.path}
              className="mx-auto flex max-w-3xl flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                void saveClassification(new FormData(event.currentTarget))
              }}
            >
              <div>
                <p className="text-xs uppercase tracking-wide text-primary-500">Documento selecionado</p>
                <h2 className="mt-1 text-lg font-semibold">{selectedFile.name}</h2>
                <p className="mt-1 break-all text-sm text-primary-600">{selectedFile.path}</p>
                <a
                  href={`/files/view?path=${encodeURIComponent(selectedFile.path)}`}
                  className="mt-2 inline-flex text-sm font-medium text-accent-600 hover:text-accent-700"
                >
                  Abrir no viewer
                </a>
              </div>

              <label className="grid gap-1 text-sm">
                <span className="font-medium">Título</span>
                <input
                  name="title"
                  defaultValue={selectedFile.title}
                  className="rounded-md border border-primary-200 bg-surface px-3 py-2 outline-none focus:border-accent-500"
                />
              </label>

              <label className="grid gap-1 text-sm">
                <span className="font-medium">Resumo</span>
                <textarea
                  name="summary"
                  defaultValue={selectedFile.summary}
                  rows={5}
                  className="rounded-md border border-primary-200 bg-surface px-3 py-2 outline-none focus:border-accent-500"
                />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">Tipo</span>
                  <select
                    name="kind"
                    defaultValue={selectedFile.kind}
                    className={selectClassName}
                  >
                    {FILE_KINDS.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">Status</span>
                  <select
                    name="status"
                    defaultValue={selectedFile.indexed ? selectedFile.status : 'reference'}
                    className={selectClassName}
                  >
                    {FILE_STATUSES.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <fieldset className="rounded-lg border border-primary-200 p-3">
                <legend className="px-1 text-sm font-medium">Projeto vinculado</legend>
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <input type="radio" name="projectMode" value="existing" defaultChecked />
                  Projeto existente
                </label>
                <select
                  name="projectId"
                  defaultValue={selectedFile.projectId ?? ''}
                  className={`mt-2 w-full ${selectClassName}`}
                >
                  <option value="">Sem projeto</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input type="radio" name="projectMode" value="new" />
                  Criar projeto
                </label>
                <input
                  name="projectName"
                  placeholder="Nome do novo projeto"
                  className="mt-2 w-full rounded-md border border-primary-200 bg-surface px-3 py-2 text-sm outline-none focus:border-accent-500"
                />
              </fieldset>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">Tags</span>
                  <input
                    name="tags"
                    defaultValue={selectedFile.tags.join(', ')}
                    placeholder="antt, free-flow, cct"
                    className="rounded-md border border-primary-200 bg-surface px-3 py-2 outline-none focus:border-accent-500"
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">Pessoas / organizações</span>
                  <input
                    name="people"
                    defaultValue={selectedFile.people.join(', ')}
                    placeholder="ANTT, EPR, supplier"
                    className="rounded-md border border-primary-200 bg-surface px-3 py-2 outline-none focus:border-accent-500"
                  />
                </label>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-md bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-60"
                >
                  {saving ? 'Salvando...' : 'Salvar classificação'}
                </button>
              </div>
            </form>
          )}
        </section>
      </main>
    </div>
  )
}
