import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getWorkspaceHermesHome } from './claude-paths'

export type PendingStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'review'
  | 'blocked'
  | 'standby'
  | 'done'

export type PendingPriority = 'high' | 'medium' | 'low'

export type PendingOrigin = 'workspace' | 'telegram' | 'agent' | 'api'

export type ExecutionStatus =
  | 'requested'
  | 'queued'
  | 'running'
  | 'blocked'
  | 'done'
  | 'cancelled'

export type PendingHistoryEntry = {
  id: string
  type:
    | 'created'
    | 'updated'
    | 'note'
    | 'delegated'
    | 'execution_updated'
    | 'memory_promoted'
  message: string
  created_at: string
  actor: string
}

export type PendingExecution = {
  id: string
  agent_id: string
  objective: string
  target_workspace: string | null
  status: ExecutionStatus
  linked_task_id: string | null
  linked_session_id: string | null
  output_summary: string
  created_at: string
  updated_at: string
}

export type PendingGorpoTriage = {
  demand_type: string
  dependencies: string[]
  deadline: string | null
  risk: string
  actionable_now: boolean | null
  specialist_needed: string
  definition_of_done: string
}

export type EprPendingRecord = {
  id: string
  sequence_number: number
  title: string
  description: string
  status: PendingStatus
  archived: boolean
  priority: PendingPriority
  tags: string[]
  assignee: string | null
  origin: PendingOrigin
  next_action: string
  follow_up_at: string | null
  last_note: string
  live_summary: string
  created_by: string
  created_at: string
  updated_at: string
  gorpo_triage: PendingGorpoTriage
  executions: PendingExecution[]
  history: PendingHistoryEntry[]
}

type PendingFile = {
  next_sequence_number: number
  items: EprPendingRecord[]
}

type PendingFilters = {
  status?: string | null
  priority?: string | null
  assignee?: string | null
  executionAgent?: string | null
  withFollowUp?: boolean
  includeDone?: boolean
  includeArchived?: boolean
}

export type CreatePendingInput = {
  title: string
  description?: string
  sequence_number?: number
  status?: PendingStatus
  archived?: boolean
  priority?: PendingPriority
  tags?: string[]
  assignee?: string | null
  origin?: PendingOrigin
  next_action?: string
  follow_up_at?: string | null
  last_note?: string
  live_summary?: string
  created_by?: string
  gorpo_triage?: Partial<PendingGorpoTriage>
}

export type UpdatePendingInput = Partial<
  Omit<
    EprPendingRecord,
    'id' | 'created_at' | 'updated_at' | 'created_by' | 'executions' | 'history'
  >
>

export type CreatePendingExecutionInput = {
  agent_id: string
  objective: string
  target_workspace?: string | null
  actor?: string
  linked_task_id?: string | null
  linked_session_id?: string | null
}

export type UpdatePendingExecutionInput = Partial<
  Omit<
    PendingExecution,
    'id' | 'agent_id' | 'objective' | 'target_workspace' | 'created_at'
  >
> & {
  actor?: string
}

const HERMES_HOME = getWorkspaceHermesHome()
const STORE_FILE = path.join(HERMES_HOME, 'epr-pendings.json')
const MEMORY_FILE = path.join(HERMES_HOME, 'memories', 'epr-pendencias.md')

function ensureStoreFile() {
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true })
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(
      STORE_FILE,
      JSON.stringify(
        {
          next_sequence_number: 1,
          items: [] satisfies EprPendingRecord[],
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    )
  }
}

function normalizeGorpoTriage(
  triage: Partial<PendingGorpoTriage> | null | undefined,
): PendingGorpoTriage {
  return {
    demand_type:
      typeof triage?.demand_type === 'string' ? triage.demand_type : '',
    dependencies: Array.isArray(triage?.dependencies)
      ? triage.dependencies
          .filter((dependency): dependency is string => typeof dependency === 'string')
          .map((dependency) => dependency.trim())
          .filter(Boolean)
      : [],
    deadline:
      typeof triage?.deadline === 'string' && triage.deadline
        ? triage.deadline
        : null,
    risk: typeof triage?.risk === 'string' ? triage.risk : '',
    actionable_now:
      typeof triage?.actionable_now === 'boolean' ? triage.actionable_now : null,
    specialist_needed:
      typeof triage?.specialist_needed === 'string'
        ? triage.specialist_needed
        : '',
    definition_of_done:
      typeof triage?.definition_of_done === 'string'
        ? triage.definition_of_done
        : '',
  }
}

function readStoreFile(): PendingFile {
  ensureStoreFile()
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf-8').trim()
    if (!raw) return { next_sequence_number: 1, items: [] }
    const parsed = JSON.parse(raw) as Partial<PendingFile>
    const sourceItems = Array.isArray(parsed.items) ? parsed.items : []
    let changed = false
    let maxSequenceNumber = 0
    const items = sourceItems.map((item, index) => {
      const normalized = normalizePending(
        item as Partial<EprPendingRecord> &
          Pick<EprPendingRecord, 'id' | 'title' | 'created_at' | 'updated_at' | 'created_by'>,
        index + 1,
      )
      if ((item as Partial<EprPendingRecord>).sequence_number !== normalized.sequence_number) {
        changed = true
      }
      maxSequenceNumber = Math.max(maxSequenceNumber, normalized.sequence_number)
      return normalized
    })
    const nextSequenceNumber =
      typeof parsed.next_sequence_number === 'number' &&
      Number.isFinite(parsed.next_sequence_number) &&
      parsed.next_sequence_number > maxSequenceNumber
        ? parsed.next_sequence_number
        : maxSequenceNumber + 1
    const file = { next_sequence_number: nextSequenceNumber, items }
    if (changed || parsed.next_sequence_number !== nextSequenceNumber) {
      writeStoreFile(file)
    }
    return file
  } catch {
    return { next_sequence_number: 1, items: [] }
  }
}

function writeStoreFile(file: PendingFile) {
  ensureStoreFile()
  fs.writeFileSync(
    STORE_FILE,
    JSON.stringify(
      {
        next_sequence_number:
          typeof file.next_sequence_number === 'number' &&
          Number.isFinite(file.next_sequence_number) &&
          file.next_sequence_number > 0
            ? Math.floor(file.next_sequence_number)
            : 1,
        items: file.items.map((item) => normalizePending(item, item.sequence_number)),
      },
      null,
      2,
    ) + '\n',
    'utf-8',
  )
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  return tags
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function normalizeHistory(entry: Partial<PendingHistoryEntry>): PendingHistoryEntry {
  return {
    id: typeof entry.id === 'string' && entry.id ? entry.id : randomUUID(),
    type:
      entry.type === 'created' ||
      entry.type === 'updated' ||
      entry.type === 'note' ||
      entry.type === 'delegated' ||
      entry.type === 'execution_updated' ||
      entry.type === 'memory_promoted'
        ? entry.type
        : 'updated',
    message: typeof entry.message === 'string' ? entry.message : '',
    created_at:
      typeof entry.created_at === 'string' && entry.created_at
        ? entry.created_at
        : new Date().toISOString(),
    actor: typeof entry.actor === 'string' && entry.actor ? entry.actor : 'system',
  }
}

function normalizeExecution(
  execution: Partial<PendingExecution> & Pick<PendingExecution, 'id' | 'agent_id' | 'objective'>,
): PendingExecution {
  return {
    id: execution.id,
    agent_id: execution.agent_id,
    objective: execution.objective,
    target_workspace:
      typeof execution.target_workspace === 'string' && execution.target_workspace
        ? execution.target_workspace
        : null,
    status:
      execution.status === 'requested' ||
      execution.status === 'queued' ||
      execution.status === 'running' ||
      execution.status === 'blocked' ||
      execution.status === 'done' ||
      execution.status === 'cancelled'
        ? execution.status
        : 'requested',
    linked_task_id:
      typeof execution.linked_task_id === 'string' && execution.linked_task_id
        ? execution.linked_task_id
        : null,
    linked_session_id:
      typeof execution.linked_session_id === 'string' && execution.linked_session_id
        ? execution.linked_session_id
        : null,
    output_summary:
      typeof execution.output_summary === 'string' ? execution.output_summary : '',
    created_at:
      typeof execution.created_at === 'string' && execution.created_at
        ? execution.created_at
        : new Date().toISOString(),
    updated_at:
      typeof execution.updated_at === 'string' && execution.updated_at
        ? execution.updated_at
        : new Date().toISOString(),
  }
}

function normalizePending(
  item: Partial<EprPendingRecord> &
    Pick<EprPendingRecord, 'id' | 'title' | 'created_at' | 'updated_at' | 'created_by'>,
  fallbackSequenceNumber: number,
): EprPendingRecord {
  return {
    id: item.id,
    sequence_number:
      typeof item.sequence_number === 'number' &&
      Number.isFinite(item.sequence_number) &&
      item.sequence_number > 0
        ? Math.floor(item.sequence_number)
        : fallbackSequenceNumber,
    title: item.title,
    description: typeof item.description === 'string' ? item.description : '',
    status:
      item.status === 'backlog' ||
      item.status === 'todo' ||
      item.status === 'in_progress' ||
      item.status === 'review' ||
      item.status === 'blocked' ||
      item.status === 'standby' ||
      item.status === 'done'
        ? item.status
        : 'backlog',
    archived: item.archived === true,
    priority:
      item.priority === 'high' || item.priority === 'low' || item.priority === 'medium'
        ? item.priority
        : 'medium',
    tags: normalizeTags(item.tags),
    assignee: typeof item.assignee === 'string' && item.assignee ? item.assignee : null,
    origin:
      item.origin === 'workspace' ||
      item.origin === 'telegram' ||
      item.origin === 'agent' ||
      item.origin === 'api'
        ? item.origin
        : 'workspace',
    next_action: typeof item.next_action === 'string' ? item.next_action : '',
    follow_up_at:
      typeof item.follow_up_at === 'string' && item.follow_up_at ? item.follow_up_at : null,
    last_note: typeof item.last_note === 'string' ? item.last_note : '',
    live_summary: typeof item.live_summary === 'string' ? item.live_summary : '',
    created_by: item.created_by,
    created_at: item.created_at,
    updated_at: item.updated_at,
    gorpo_triage: normalizeGorpoTriage(item.gorpo_triage),
    executions: Array.isArray(item.executions)
      ? item.executions
          .filter(
            (execution): execution is PendingExecution =>
              execution &&
              typeof execution === 'object' &&
              typeof execution.id === 'string' &&
              typeof execution.agent_id === 'string' &&
              typeof execution.objective === 'string',
          )
          .map((execution) => normalizeExecution(execution))
      : [],
    history: Array.isArray(item.history)
      ? item.history
          .filter((entry): entry is PendingHistoryEntry => Boolean(entry))
          .map((entry) => normalizeHistory(entry))
      : [],
  }
}

function appendHistory(
  item: EprPendingRecord,
  type: PendingHistoryEntry['type'],
  message: string,
  actor: string,
): EprPendingRecord {
  return {
    ...item,
    history: [
      ...item.history,
      normalizeHistory({
        id: randomUUID(),
        type,
        message,
        actor,
        created_at: new Date().toISOString(),
      }),
    ],
  }
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function pendingSearchText(item: EprPendingRecord): string {
  return normalizeSearchText(
    [
      item.title,
      item.description,
      item.live_summary,
      item.last_note,
      item.next_action,
      item.assignee ?? '',
      item.tags.join(' '),
      item.executions.map((execution) => execution.agent_id).join(' '),
      item.executions.map((execution) => execution.objective).join(' '),
    ].join(' '),
  )
}

export function listEprPendings(filters: PendingFilters = {}): EprPendingRecord[] {
  let items = readStoreFile().items.map((item) =>
    normalizePending(item, item.sequence_number),
  )
  if (filters.status) {
    items = items.filter((item) => item.status === filters.status)
  }
  if (filters.priority) {
    items = items.filter((item) => item.priority === filters.priority)
  }
  if (filters.assignee) {
    items = items.filter((item) => item.assignee === filters.assignee)
  }
  if (filters.executionAgent) {
    items = items.filter((item) =>
      item.executions.some((execution) => execution.agent_id === filters.executionAgent),
    )
  }
  if (filters.withFollowUp) {
    items = items.filter((item) => Boolean(item.follow_up_at))
  }
  if (filters.includeArchived !== true) {
    items = items.filter((item) => item.archived !== true)
  }
  if (filters.includeDone === false) {
    items = items.filter((item) => item.status !== 'done')
  }

  return items.sort((left, right) => right.updated_at.localeCompare(left.updated_at))
}

export function getEprPending(id: string): EprPendingRecord | null {
  return readStoreFile().items.find((item) => item.id === id) ?? null
}

export function getEprPendingBySequenceNumber(
  sequenceNumber: number,
): EprPendingRecord | null {
  if (!Number.isFinite(sequenceNumber) || sequenceNumber <= 0) return null
  return (
    readStoreFile().items.find(
      (item) => item.sequence_number === Math.floor(sequenceNumber),
    ) ?? null
  )
}

export function createEprPending(input: CreatePendingInput): EprPendingRecord {
  const file = readStoreFile()
  const now = new Date().toISOString()
  const sequenceNumber =
    typeof input.sequence_number === 'number' &&
    Number.isFinite(input.sequence_number) &&
    input.sequence_number > 0
      ? Math.floor(input.sequence_number)
      : file.next_sequence_number
  let item = normalizePending({
    id: randomUUID(),
    sequence_number: sequenceNumber,
    title: input.title,
    description: input.description ?? '',
    status: input.status ?? 'backlog',
    archived: input.archived ?? false,
    priority: input.priority ?? 'medium',
    tags: input.tags ?? [],
    assignee: input.assignee ?? null,
    origin: input.origin ?? 'workspace',
    next_action: input.next_action ?? '',
    follow_up_at: input.follow_up_at ?? null,
    last_note: input.last_note ?? '',
    live_summary: input.live_summary ?? '',
    created_by: input.created_by ?? 'user',
    created_at: now,
    updated_at: now,
    gorpo_triage: normalizeGorpoTriage(input.gorpo_triage),
    executions: [],
    history: [],
  }, sequenceNumber)
  item = appendHistory(item, 'created', 'Pendencia criada', input.created_by ?? 'user')
  file.items.push(item)
  file.next_sequence_number = Math.max(file.next_sequence_number, sequenceNumber + 1)
  writeStoreFile(file)
  return item
}

export function findEprPendingByTitle(
  title: string,
  options: { includeDone?: boolean } = {},
): EprPendingRecord | null {
  const normalized = normalizeSearchText(title)
  if (!normalized) return null
  return (
    listEprPendings({ includeDone: options.includeDone })
      .find((item) => normalizeSearchText(item.title) === normalized) ?? null
  )
}

export function findEprPendingBySequenceNumber(
  sequenceNumber: number,
  options: { includeDone?: boolean } = {},
): EprPendingRecord | null {
  if (!Number.isFinite(sequenceNumber) || sequenceNumber <= 0) return null
  return (
    listEprPendings({ includeDone: options.includeDone })
      .find((item) => item.sequence_number === Math.floor(sequenceNumber)) ?? null
  )
}

export function searchEprPendings(
  query: string,
  options: PendingFilters & { limit?: number } = {},
): EprPendingRecord[] {
  const normalized = normalizeSearchText(query)
  const limit = Math.max(1, Math.min(options.limit ?? 10, 100))
  const items = listEprPendings(options)
  if (!normalized) return items.slice(0, limit)

  return items
    .map((item) => {
      const haystack = pendingSearchText(item)
      const title = normalizeSearchText(item.title)
      let score = 0
      if (`#${item.sequence_number}` === normalized || `p${item.sequence_number}` === normalized) {
        score += 200
      }
      if (title === normalized) score += 100
      if (title.includes(normalized)) score += 50
      if (haystack.includes(normalized)) score += 20
      for (const token of normalized.split(/\s+/).filter(Boolean)) {
        if (title.includes(token)) score += 5
        if (haystack.includes(token)) score += 2
      }
      return { item, score }
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      return right.item.updated_at.localeCompare(left.item.updated_at)
    })
    .slice(0, limit)
    .map((entry) => entry.item)
}

export function updateEprPending(
  id: string,
  updates: UpdatePendingInput,
  actor = 'user',
): EprPendingRecord | null {
  const file = readStoreFile()
  const index = file.items.findIndex((item) => item.id === id)
  if (index === -1) return null

  const current = normalizePending(
    file.items[index] as EprPendingRecord,
    file.items[index]?.sequence_number ?? index + 1,
  )
  let next = normalizePending({
    ...current,
    ...updates,
    id: current.id,
    sequence_number: current.sequence_number,
    created_by: current.created_by,
    created_at: current.created_at,
    updated_at: new Date().toISOString(),
    title: typeof updates.title === 'string' ? updates.title : current.title,
    gorpo_triage: updates.gorpo_triage ?? current.gorpo_triage,
    executions: current.executions,
    history: current.history,
  }, current.sequence_number)
  const archivedNow = current.archived !== true && next.archived === true
  if (archivedNow && next.status === 'done' && !updates.last_note) {
    const closingNote = `Encerrada e arquivada em ${new Date().toISOString().slice(0, 10)}.`
    next = normalizePending({
      ...next,
      last_note: closingNote,
      live_summary: next.live_summary || closingNote,
    }, current.sequence_number)
    next = appendHistory(next, 'note', closingNote, actor)
  }
  next = appendHistory(next, 'updated', 'Pendencia atualizada', actor)
  file.items[index] = next
  writeStoreFile(file)
  return next
}

export function addEprPendingNote(
  id: string,
  note: string,
  actor = 'user',
): EprPendingRecord | null {
  const current = getEprPending(id)
  if (!current) return null
  const trimmed = note.trim()
  if (!trimmed) return current

  let next = normalizePending({
    ...current,
    last_note: trimmed,
    live_summary: current.live_summary || trimmed,
    updated_at: new Date().toISOString(),
  }, current.sequence_number)
  next = appendHistory(next, 'note', trimmed, actor)
  replacePending(next)
  return next
}

export function createEprPendingExecution(
  id: string,
  input: CreatePendingExecutionInput,
): { pending: EprPendingRecord; execution: PendingExecution } | null {
  const current = getEprPending(id)
  if (!current) return null
  const now = new Date().toISOString()
  const execution = normalizeExecution({
    id: randomUUID(),
    agent_id: input.agent_id,
    objective: input.objective,
    target_workspace: input.target_workspace ?? null,
    status: input.linked_task_id ? 'queued' : 'requested',
    linked_task_id: input.linked_task_id ?? null,
    linked_session_id: input.linked_session_id ?? null,
    output_summary: '',
    created_at: now,
    updated_at: now,
  })

  let next = normalizePending({
    ...current,
    updated_at: now,
    executions: [...current.executions, execution],
  }, current.sequence_number)
  next = appendHistory(
    next,
    'delegated',
    `Delegado para ${execution.agent_id}: ${execution.objective}`,
    input.actor ?? 'user',
  )
  replacePending(next)
  return { pending: next, execution }
}

export function updateEprPendingExecution(
  id: string,
  executionId: string,
  updates: UpdatePendingExecutionInput,
): { pending: EprPendingRecord; execution: PendingExecution } | null {
  const current = getEprPending(id)
  if (!current) return null
  const executionIndex = current.executions.findIndex(
    (execution) => execution.id === executionId,
  )
  if (executionIndex === -1) return null

  const currentExecution = current.executions[executionIndex]
  const nextExecution = normalizeExecution({
    ...currentExecution,
    ...updates,
    id: currentExecution.id,
    agent_id: currentExecution.agent_id,
    objective: currentExecution.objective,
    target_workspace: currentExecution.target_workspace,
    created_at: currentExecution.created_at,
    updated_at: new Date().toISOString(),
  })

  const executions = [...current.executions]
  executions[executionIndex] = nextExecution
  let next = normalizePending({
    ...current,
    executions,
    updated_at: new Date().toISOString(),
  }, current.sequence_number)
  next = appendHistory(
    next,
    'execution_updated',
    `Execucao ${nextExecution.agent_id} atualizada para ${nextExecution.status}`,
    updates.actor ?? 'user',
  )
  replacePending(next)
  return { pending: next, execution: nextExecution }
}

function replacePending(next: EprPendingRecord) {
  const file = readStoreFile()
  const index = file.items.findIndex((item) => item.id === next.id)
  if (index === -1) return
  file.items[index] = next
  writeStoreFile(file)
}

export function getEprPendingsSummary(items = listEprPendings()) {
  const summary = {
    total: items.length,
    backlog: 0,
    todo: 0,
    in_progress: 0,
    review: 0,
    blocked: 0,
    standby: 0,
    done: 0,
    follow_up: 0,
    archived: 0,
  }

  for (const item of items) {
    if (item.archived) summary.archived += 1
    summary[item.status] += 1
    if (item.follow_up_at) summary.follow_up += 1
  }

  return summary
}

export function promotePendingToMemory(id: string, actor = 'user'): EprPendingRecord | null {
  const current = getEprPending(id)
  if (!current) return null

  fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true })
  const block = [
    `## ${current.title}`,
    '',
    `- Data: ${new Date().toISOString()}`,
    `- Status: ${current.status}`,
    `- Prioridade: ${current.priority}`,
    `- Origem: ${current.origin}`,
    `- Assignee: ${current.assignee ?? 'unassigned'}`,
    `- Tags: ${current.tags.join(', ') || 'nenhuma'}`,
    `- Proxima acao: ${current.next_action || 'nao definida'}`,
    '',
    current.live_summary || current.last_note || current.description || 'Sem resumo.',
    '',
  ].join('\n')
  fs.appendFileSync(MEMORY_FILE, `${block}\n`, 'utf-8')

  let next = normalizePending({
    ...current,
    updated_at: new Date().toISOString(),
  }, current.sequence_number)
  next = appendHistory(next, 'memory_promoted', 'Resumo promovido para memoria', actor)
  replacePending(next)
  return next
}

export function getEprPendingsStorePath() {
  return STORE_FILE
}

export function getEprPendingsMemoryPath() {
  return MEMORY_FILE
}
