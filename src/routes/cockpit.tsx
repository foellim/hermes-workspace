import { useEffect, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'

type MilleoFile = {
  path: string
  title: string
  summary: string
  projectName: string | null
  status: string
  kind: string
  modifiedAt: string
  indexed: boolean
  source: string
}

type StrategicTask = {
  id: string
  number: number | null
  title: string
  macroFront: string
  status: string
  owner: string
  executor: string
  dependency: string
  risk: string
  blocker: string
  nextAction: string
  updatedAt: string
  staleDays: number | null
}

type StrategicFront = {
  name: string
  totalTasks: number
  highRiskTasks: number
  blockedTasks: number
  staleTasks: number
  nextActions: Array<string>
}

type MilleoSummary = {
  workspaceRoot: string
  totals: {
    filesDiscovered: number
    filesIndexed: number
    filesUnclassified: number
    projects: number
  }
  recentFiles: Array<MilleoFile>
  unclassifiedFiles: Array<MilleoFile>
  strategic: {
    taskTotals: {
      total: number
      highRisk: number
      blocked: number
      stale: number
    }
    fronts: Array<StrategicFront>
    criticalTasks: Array<StrategicTask>
    generatedArtifacts: Array<MilleoFile>
  }
}

export const Route = createFileRoute('/cockpit')({
  ssr: false,
  component: CockpitRoute,
})

function formatDate(input: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
  }).format(new Date(input))
}

function CockpitRoute() {
  usePageTitle('Cockpit')
  const [summary, setSummary] = useState<MilleoSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [copiedTaskId, setCopiedTaskId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/milleo?action=summary')
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to load cockpit')
        if (!cancelled) setSummary(data.summary)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div>
          <h1 className="text-xl font-semibold text-primary-900">Cockpit indisponível</h1>
          <p className="mt-2 text-sm text-primary-600">{error}</p>
        </div>
      </div>
    )
  }

  if (!summary) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-accent-500 border-r-transparent" />
      </div>
    )
  }

  const strategic = summary.strategic
  const selectedTask =
    strategic.criticalTasks.find((task) => task.id === selectedTaskId) ??
    strategic.criticalTasks[0] ??
    null

  async function copyNextAction(task: StrategicTask) {
    const lines = [
      task.number ? `${task.number}. ${task.title}` : task.title,
      task.macroFront ? `Frente: ${task.macroFront}` : '',
      task.owner ? `Dono: ${task.owner}` : '',
      task.executor ? `Executor: ${task.executor}` : '',
      task.blocker ? `Bloqueio: ${task.blocker}` : '',
      task.nextAction ? `Proxima acao: ${task.nextAction}` : '',
    ].filter(Boolean)
    await navigator.clipboard.writeText(lines.join('\n'))
    setCopiedTaskId(task.id)
    window.setTimeout(() => setCopiedTaskId(null), 1600)
  }

  return (
    <div className="min-h-full bg-surface px-4 py-5 text-primary-900 md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-col gap-3 border-b border-primary-200 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">Cockpit Milléo</h1>
            <p className="mt-1 max-w-3xl text-sm text-primary-600">
              Leitura estratégica do workspace: frentes em andamento, riscos,
              bloqueios, próximas ações e artefatos gerados pelo Hermes.
            </p>
            <p className="mt-2 text-xs text-primary-500">{summary.workspaceRoot}</p>
          </div>
          <Link
            to="/curation"
            className="inline-flex items-center justify-center rounded-md bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600"
          >
            Curar arquivos
          </Link>
        </header>

        <section className="grid gap-3 md:grid-cols-4">
          <Metric label="Pendências mapeadas" value={strategic.taskTotals.total} />
          <Metric label="Risco alto" value={strategic.taskTotals.highRisk} tone="danger" />
          <Metric label="Com bloqueio" value={strategic.taskTotals.blocked} tone="warning" />
          <Metric label="Sem atualização 14d+" value={strategic.taskTotals.stale} />
        </section>

        <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <Panel title="Frentes estratégicas">
            {strategic.fronts.length === 0 ? (
              <EmptyText text="Nenhuma frente encontrada em tasks.json." />
            ) : (
              <div className="divide-y divide-primary-100">
                {strategic.fronts.map((front) => (
                  <div key={front.name} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="text-sm font-semibold">{front.name}</h2>
                        <p className="mt-1 text-xs text-primary-500">
                          {front.totalTasks} pendências · {front.highRiskTasks} risco alto ·{' '}
                          {front.blockedTasks} bloqueadas
                        </p>
                      </div>
                      <span className="rounded-md bg-primary-100 px-2 py-1 text-xs text-primary-700">
                        {front.staleTasks} paradas
                      </span>
                    </div>
                    {front.nextActions[0] ? (
                      <p className="mt-2 line-clamp-2 text-sm text-primary-700">
                        Próxima ação: {front.nextActions[0]}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Pendências críticas">
            {strategic.criticalTasks.length === 0 ? (
              <EmptyText text="Nenhuma tarefa crítica detectada." />
            ) : (
              <div className="grid min-h-[520px] gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(320px,1.1fr)]">
                <div className="max-h-[620px] space-y-2 overflow-y-auto pr-1">
                  {strategic.criticalTasks.map((task) => (
                    <TaskRow
                      key={task.id || task.title}
                      task={task}
                      selected={selectedTask?.id === task.id}
                      onSelect={() => setSelectedTaskId(task.id)}
                    />
                  ))}
                </div>
                {selectedTask ? (
                  <TaskDetail
                    task={selectedTask}
                    copied={copiedTaskId === selectedTask.id}
                    onCopy={() => void copyNextAction(selectedTask)}
                  />
                ) : null}
              </div>
            )}
          </Panel>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <Panel title="Artefatos e documentos">
            {strategic.generatedArtifacts.length === 0 ? (
              <EmptyText text="Nenhum artefato gerado encontrado nos diretórios esperados." />
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {strategic.generatedArtifacts.slice(0, 8).map((file) => (
                  <FileRow key={file.path} file={file} />
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Fila de curadoria">
            {summary.unclassifiedFiles.length === 0 ? (
              <EmptyText text="Nenhum documento útil pendente de curadoria." />
            ) : (
              <div className="space-y-3">
                {summary.unclassifiedFiles.slice(0, 6).map((file) => (
                  <FileRow key={file.path} file={file} />
                ))}
              </div>
            )}
          </Panel>
        </section>
      </div>
    </div>
  )
}

function Metric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: number
  tone?: 'neutral' | 'warning' | 'danger'
}) {
  const toneClass =
    tone === 'danger'
      ? 'border-red-200 bg-red-50 text-red-900'
      : tone === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-primary-200 bg-primary-50'
  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-wide opacity-75">{label}</div>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-primary-200 bg-surface p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-primary-500">
        {title}
      </h2>
      {children}
    </section>
  )
}

function TaskRow({
  task,
  selected,
  onSelect,
}: {
  task: StrategicTask
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'w-full rounded-md border p-3 text-left transition-colors',
        selected
          ? 'border-accent-500 bg-accent-50'
          : 'border-primary-100 bg-primary-50 hover:border-primary-300 hover:bg-primary-100',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">
            {task.number ? `${task.number}. ` : ''}
            {task.title}
          </h3>
          <p className="mt-1 text-xs text-primary-500">{task.macroFront}</p>
        </div>
        <span className="shrink-0 rounded bg-surface px-2 py-1 text-[11px] text-primary-600">
          {task.risk}
        </span>
      </div>
      {task.blocker ? (
        <p className="mt-2 line-clamp-2 text-xs text-amber-800">Bloqueio: {task.blocker}</p>
      ) : null}
      {task.nextAction ? (
        <p className="mt-1 line-clamp-2 text-xs text-primary-700">Ação: {task.nextAction}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-primary-500">
        <span>{task.status}</span>
        {task.owner ? <span>{task.owner}</span> : null}
        {task.staleDays !== null ? <span>{task.staleDays}d sem atualização</span> : null}
      </div>
    </button>
  )
}

function TaskDetail({
  task,
  copied,
  onCopy,
}: {
  task: StrategicTask
  copied: boolean
  onCopy: () => void
}) {
  return (
    <div className="rounded-md border border-primary-200 bg-surface p-4">
      <div className="flex flex-col gap-3 border-b border-primary-100 pb-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-primary-500">Pendencia selecionada</p>
          <h3 className="mt-1 text-lg font-semibold">
            {task.number ? `${task.number}. ` : ''}
            {task.title}
          </h3>
          <p className="mt-1 text-sm text-primary-600">{task.macroFront}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onCopy}
            className="rounded-md border border-primary-200 px-3 py-2 text-sm font-medium hover:bg-primary-50"
          >
            {copied ? 'Copiado' : 'Copiar acao'}
          </button>
          <Link
            to="/epr-pendings"
            className="rounded-md bg-accent-500 px-3 py-2 text-sm font-medium text-white hover:bg-accent-600"
          >
            Abrir pendencias
          </Link>
        </div>
      </div>

      <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
        <InfoItem label="Status" value={task.status} />
        <InfoItem label="Risco" value={task.risk} />
        <InfoItem label="Dono" value={task.owner || 'Nao informado'} />
        <InfoItem label="Executor" value={task.executor || 'Nao informado'} />
        <InfoItem label="Atualizacao" value={task.updatedAt || 'Nao informada'} />
        <InfoItem
          label="Tempo parada"
          value={task.staleDays !== null ? `${task.staleDays} dias` : 'Nao calculado'}
        />
      </dl>

      {task.dependency ? (
        <DetailBlock title="Dependencia" text={task.dependency} />
      ) : null}
      {task.blocker ? (
        <DetailBlock title="Bloqueio" text={task.blocker} tone="warning" />
      ) : null}
      {task.nextAction ? (
        <DetailBlock title="Proxima acao" text={task.nextAction} tone="action" />
      ) : null}
    </div>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-primary-50 px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-primary-500">{label}</dt>
      <dd className="mt-1 text-primary-800">{value}</dd>
    </div>
  )
}

function DetailBlock({
  title,
  text,
  tone = 'neutral',
}: {
  title: string
  text: string
  tone?: 'neutral' | 'warning' | 'action'
}) {
  const className =
    tone === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-950'
      : tone === 'action'
        ? 'border-accent-200 bg-accent-50 text-primary-900'
        : 'border-primary-200 bg-primary-50 text-primary-900'
  return (
    <section className={`mt-4 rounded-md border p-3 ${className}`}>
      <h4 className="text-xs font-semibold uppercase tracking-wide opacity-75">{title}</h4>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
    </section>
  )
}

function FileRow({ file }: { file: MilleoFile }) {
  return (
    <div className="rounded-md border border-primary-100 bg-primary-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium">{file.title}</h3>
          <p className="mt-1 truncate text-xs text-primary-600">{file.path}</p>
        </div>
        <span className="shrink-0 rounded bg-surface px-2 py-1 text-[11px] text-primary-600">
          {file.source}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-primary-500">
        <span>{file.kind}</span>
        <span>{formatDate(file.modifiedAt)}</span>
        {file.projectName ? <span>{file.projectName}</span> : null}
      </div>
    </div>
  )
}

function EmptyText({ text }: { text: string }) {
  return <p className="text-sm text-primary-500">{text}</p>
}
