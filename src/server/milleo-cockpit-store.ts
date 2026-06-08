import path from 'node:path'
import fs from 'node:fs/promises'
import { getStateDir } from './workspace-state-dir'

export type MilleoFileStatus =
  | 'unclassified'
  | 'draft'
  | 'final'
  | 'evidence'
  | 'reference'
  | 'pending'
  | 'archived'

export type MilleoFileKind =
  | 'analysis'
  | 'minutes'
  | 'briefing'
  | 'report'
  | 'summary'
  | 'proposal'
  | 'official_letter'
  | 'checklist'
  | 'evidence'
  | 'source'
  | 'other'

export type MilleoProject = {
  id: string
  slug: string
  name: string
  summary: string
  status: 'active' | 'paused' | 'archived'
  tags: Array<string>
  createdAt: string
  updatedAt: string
}

export type MilleoFileRecord = {
  path: string
  title: string
  summary: string
  projectId: string | null
  kind: MilleoFileKind
  status: MilleoFileStatus
  tags: Array<string>
  people: Array<string>
  updatedAt: string
}

export type MilleoFileCandidate = {
  path: string
  name: string
  extension: string
  size: number
  modifiedAt: string
  indexed: boolean
  title: string
  summary: string
  projectId: string | null
  projectName: string | null
  kind: MilleoFileKind
  status: MilleoFileStatus
  tags: Array<string>
  people: Array<string>
  source: 'created' | 'workflow' | 'project' | 'pending' | 'root' | 'other'
}

export type MilleoStrategicTask = {
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

export type MilleoStrategicFront = {
  name: string
  totalTasks: number
  highRiskTasks: number
  blockedTasks: number
  staleTasks: number
  nextActions: Array<string>
}

export type MilleoStrategicSummary = {
  taskTotals: {
    total: number
    highRisk: number
    blocked: number
    stale: number
  }
  fronts: Array<MilleoStrategicFront>
  criticalTasks: Array<MilleoStrategicTask>
  generatedArtifacts: Array<MilleoFileCandidate>
}

export type MilleoState = {
  version: 1
  projects: Array<MilleoProject>
  files: Array<MilleoFileRecord>
}

export type MilleoSummary = {
  workspaceRoot: string
  totals: {
    filesDiscovered: number
    filesIndexed: number
    filesUnclassified: number
    projects: number
  }
  recentFiles: Array<MilleoFileCandidate>
  unclassifiedFiles: Array<MilleoFileCandidate>
  strategic: MilleoStrategicSummary
  focusAreas: Array<{
    name: string
    fileCount: number
    signal: string
  }>
  activeProjects: Array<
    MilleoProject & {
      fileCount: number
      recentFile: MilleoFileCandidate | null
    }
  >
}

const INDEX_FILE_NAME = 'milleo-cockpit.json'
const MAX_SCAN_FILES = 600
const MAX_SCAN_DEPTH = 6
const TEXT_PREVIEW_BYTES = 16_000

const IGNORED_DIRS = new Set([
  '.git',
  '.backup',
  '.openclaw',
  'node_modules',
  '__pycache__',
  '.venv',
  '.cache',
  'backups',
  'dist',
  'build',
  'hermes-data',
  'memory',
  'plugins',
  'scripts',
  'skills',
  'tmp',
  'temp',
])

const INDEXABLE_EXTENSIONS = new Set([
  '.md',
  '.txt',
  '.html',
  '.csv',
  '.docx',
  '.pptx',
  '.xlsx',
  '.pdf',
])

const IGNORED_FILE_NAMES = new Set([
  '.gitattributes',
  '.gitignore',
  'agents.md',
  'heartbeat.md',
  'identity.md',
  'memory.md',
  'peoples.md',
  'soul.md',
  'tools.md',
  'user.md',
])

const STRATEGIC_FILE_TERMS = [
  'prd',
  'projeto',
  'estrategico',
  'resumo',
  'pendencia',
  'relatorio',
  'analise',
  'proposta',
  'briefing',
  'reuniao',
  'ata',
  'cadastro',
  'abandono',
  'discord',
  'epr',
  'antt',
  'cct',
  'cco',
  'gorpo',
  'orion',
  'ralph',
]

function nowIso() {
  return new Date().toISOString()
}

function statePath() {
  return path.join(getStateDir(), INDEX_FILE_NAME)
}

function slugify(input: string) {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function wordsFromName(filePath: string) {
  return path
    .basename(filePath, path.extname(filePath))
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function inferKind(filePath: string): MilleoFileKind {
  const normalized = filePath.toLowerCase()
  if (normalized.includes('ata') || normalized.includes('reuniao')) return 'minutes'
  if (normalized.includes('briefing')) return 'briefing'
  if (normalized.includes('relatorio') || normalized.includes('report')) return 'report'
  if (normalized.includes('resumo') || normalized.includes('summary')) return 'summary'
  if (normalized.includes('proposta') || normalized.includes('proposal')) return 'proposal'
  if (normalized.includes('oficio')) return 'official_letter'
  if (normalized.includes('checklist')) return 'checklist'
  if (normalized.includes('evidencia')) return 'evidence'
  if (normalized.includes('analise') || normalized.includes('analysis')) return 'analysis'
  return 'other'
}

function inferTags(filePath: string) {
  const normalized = filePath.toLowerCase()
  const tags = new Set<string>()
  for (const tag of [
    'antt',
    'free-flow',
    'cct',
    'cco',
    'epr',
    'gorpo',
    'duncan',
    'pendencia',
    'telegram',
  ]) {
    if (normalized.includes(tag)) tags.add(tag)
  }
  return Array.from(tags)
}

function normalizeRelativePath(filePath: string) {
  return filePath.replace(/\\/g, '/').toLowerCase()
}

function shouldIndexFile(relativePath: string) {
  const normalized = normalizeRelativePath(relativePath)
  const baseName = path.basename(normalized)
  if (IGNORED_FILE_NAMES.has(baseName)) return false
  if (baseName.endsWith('.bak')) return false
  if (baseName.includes('heartbeat')) return false
  if (baseName.includes('backup-log')) return false
  if (normalized.includes('/.')) return false

  const firstSegment = normalized.split('/')[0]
  if (firstSegment === 'pendencias') return false
  if (['projetos', 'created-files', 'inbox'].includes(firstSegment)) {
    return true
  }
  if (
    normalized.startsWith('workflows/duncan-auto/artefatos/') ||
    normalized.startsWith('workflows/gorpo/output/')
  ) {
    return true
  }
  if (firstSegment === 'workflows') return false

  return STRATEGIC_FILE_TERMS.some((term) => normalized.includes(term))
}

function priorityScore(relativePath: string) {
  const normalized = normalizeRelativePath(relativePath)
  let score = 0
  if (normalized.startsWith('created-files/')) score += 70
  if (normalized.startsWith('workflows/duncan-auto/artefatos/')) score += 60
  if (normalized.startsWith('workflows/gorpo/output/')) score += 55
  if (normalized.startsWith('workflows/duncan-auto/artefatos/')) score += 40
  if (normalized.startsWith('projetos/')) score += 40
  if (normalized.startsWith('inbox/')) score += 15
  for (const term of STRATEGIC_FILE_TERMS) {
    if (normalized.includes(term)) score += 6
  }
  if (normalized.endsWith('.md')) score += 8
  if (normalized.endsWith('.html')) score += 4
  return score
}

function sourceForPath(relativePath: string): MilleoFileCandidate['source'] {
  const normalized = normalizeRelativePath(relativePath)
  if (normalized.startsWith('created-files/')) return 'created'
  if (normalized.startsWith('workflows/')) return 'workflow'
  if (normalized.startsWith('projetos/')) return 'project'
  if (normalized.startsWith('pendencias/')) return 'pending'
  if (!normalized.includes('/')) return 'root'
  return 'other'
}

function inferFocusArea(file: MilleoFileCandidate) {
  const normalized = normalizeRelativePath(file.path)
  if (normalized.includes('modelo-gestao-semanal') || normalized.includes('pendencia')) {
    return {
      name: 'Gestão executiva de pendências',
      signal: 'Modelos, resumos semanais e materiais para acompanhamento recorrente.',
    }
  }
  if (normalized.includes('projetos-estrategicos')) {
    return {
      name: 'Projetos estratégicos EPR',
      signal: 'Resumos executivos e materiais de alinhamento estratégico.',
    }
  }
  if (normalized.includes('inspecao') || normalized.includes('ia-local')) {
    return {
      name: 'Inspeção com IA local',
      signal: 'Escopo técnico e visão de produto para operadores.',
    }
  }
  if (normalized.includes('discord')) {
    return {
      name: 'Organização operacional no Discord',
      signal: 'Estrutura de canais, roteamento e colaboração operacional.',
    }
  }
  if (normalized.includes('prd') || normalized.includes('ralph') || normalized.includes('orion') || normalized.includes('gorpo')) {
    return {
      name: 'Agentes e orquestração Hermes',
      signal: 'PRDs e desenhos de agentes para evoluir a plataforma.',
    }
  }
  return {
    name: 'Outros documentos úteis',
    signal: 'Materiais que parecem relevantes, mas ainda precisam de vínculo.',
  }
}

function buildFocusAreas(files: Array<MilleoFileCandidate>) {
  const byName = new Map<string, { name: string; fileCount: number; signal: string }>()
  for (const file of files) {
    const area = inferFocusArea(file)
    const existing = byName.get(area.name)
    if (existing) existing.fileCount += 1
    else byName.set(area.name, { ...area, fileCount: 1 })
  }
  return Array.from(byName.values()).sort((a, b) => b.fileCount - a.fileCount).slice(0, 6)
}

function daysSince(dateString: string) {
  const time = Date.parse(dateString)
  if (Number.isNaN(time)) return null
  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000))
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

async function readStrategicTasks(workspaceRoot: string): Promise<Array<MilleoStrategicTask>> {
  try {
    const raw = await fs.readFile(path.join(workspaceRoot, 'tasks.json'), 'utf8')
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>
    if (!Array.isArray(parsed)) return []
    return parsed.map((task) => {
      const updatedAt = asString(task.ultAtualizacao)
      return {
        id: asString(task.id),
        number: typeof task.numero === 'number' ? task.numero : null,
        title: asString(task.titulo),
        macroFront: asString(task.macrofrente) || 'Sem macrofrente',
        status: asString(task.status) || 'sem_status',
        owner: asString(task.dono),
        executor: asString(task.quemToca),
        dependency: asString(task.dependencia),
        risk: asString(task.risco) || 'não informado',
        blocker: asString(task.bloqueio),
        nextAction: asString(task.proxAcao),
        updatedAt,
        staleDays: updatedAt ? daysSince(updatedAt) : null,
      }
    })
  } catch {
    return []
  }
}

function isTaskBlocked(task: MilleoStrategicTask) {
  const blocker = task.blocker.toLowerCase()
  return Boolean(blocker) && !['n/a', 'na', 'nenhum'].includes(blocker)
}

function buildStrategicSummary(
  tasks: Array<MilleoStrategicTask>,
  files: Array<MilleoFileCandidate>,
): MilleoStrategicSummary {
  const byFront = new Map<string, MilleoStrategicFront>()
  for (const task of tasks) {
    const front =
      byFront.get(task.macroFront) ??
      {
        name: task.macroFront,
        totalTasks: 0,
        highRiskTasks: 0,
        blockedTasks: 0,
        staleTasks: 0,
        nextActions: [],
      }
    front.totalTasks += 1
    if (task.risk.toLowerCase().includes('alto')) front.highRiskTasks += 1
    if (isTaskBlocked(task)) front.blockedTasks += 1
    if ((task.staleDays ?? 0) >= 14) front.staleTasks += 1
    if (task.nextAction && front.nextActions.length < 3) {
      front.nextActions.push(task.nextAction)
    }
    byFront.set(front.name, front)
  }

  const criticalTasks = tasks
    .filter(
      (task) =>
        task.risk.toLowerCase().includes('alto') ||
        isTaskBlocked(task) ||
        (task.staleDays ?? 0) >= 14,
    )
    .sort((a, b) => {
      const riskDelta =
        Number(b.risk.toLowerCase().includes('alto')) -
        Number(a.risk.toLowerCase().includes('alto'))
      return riskDelta || (b.staleDays ?? 0) - (a.staleDays ?? 0)
    })
    .slice(0, 8)

  return {
    taskTotals: {
      total: tasks.length,
      highRisk: tasks.filter((task) => task.risk.toLowerCase().includes('alto')).length,
      blocked: tasks.filter(isTaskBlocked).length,
      stale: tasks.filter((task) => (task.staleDays ?? 0) >= 14).length,
    },
    fronts: Array.from(byFront.values()).sort((a, b) => {
      const riskDelta = b.highRiskTasks - a.highRiskTasks
      return riskDelta || b.blockedTasks - a.blockedTasks || b.totalTasks - a.totalTasks
    }),
    criticalTasks,
    generatedArtifacts: files
      .filter((file) => ['created', 'workflow', 'project', 'root'].includes(file.source))
      .slice(0, 12),
  }
}

function mergeUnique(a: Array<string>, b: Array<string>) {
  return Array.from(new Set([...a, ...b].map((item) => item.trim()).filter(Boolean)))
}

async function readTextSummary(fullPath: string, extension: string) {
  if (!['.md', '.txt', '.html', '.csv'].includes(extension)) {
    return ''
  }
  try {
    const handle = await fs.open(fullPath, 'r')
    try {
      const buffer = Buffer.alloc(TEXT_PREVIEW_BYTES)
      const result = await handle.read(buffer, 0, TEXT_PREVIEW_BYTES, 0)
      const raw = buffer
        .subarray(0, result.bytesRead)
        .toString('utf8')

      if (extension === '.html') {
        const title = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''
        const body = raw
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
        return `${title} ${body}`
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/[#*_`>|<>{}\[\]]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 260)
      }

      return raw
        .replace(/[#*_`>|<>{}\[\]]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 260)
    } finally {
      await handle.close()
    }
  } catch {
    return ''
  }
}

async function scanFiles(
  dirPath: string,
  workspaceRoot: string,
  depth: number,
  results: Array<{ path: string; size: number; modifiedAt: string; extension: string }>,
) {
  if (depth > MAX_SCAN_DEPTH || results.length >= MAX_SCAN_FILES) return
  let entries: Array<import('node:fs').Dirent>
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (results.length >= MAX_SCAN_FILES) return
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      await scanFiles(fullPath, workspaceRoot, depth + 1, results)
      continue
    }
    if (!entry.isFile()) continue
    const extension = path.extname(entry.name).toLowerCase()
    if (!INDEXABLE_EXTENSIONS.has(extension)) continue
    try {
      const stats = await fs.stat(fullPath)
      const relativePath = path.relative(workspaceRoot, fullPath)
      if (!shouldIndexFile(relativePath)) continue
      results.push({
        path: relativePath,
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        extension,
      })
    } catch {
      continue
    }
  }
}

export async function readMilleoState(): Promise<MilleoState> {
  try {
    const raw = await fs.readFile(statePath(), 'utf8')
    const parsed = JSON.parse(raw) as MilleoState
    return {
      version: 1,
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      files: Array.isArray(parsed.files) ? parsed.files : [],
    }
  } catch {
    return { version: 1, projects: [], files: [] }
  }
}

async function writeMilleoState(state: MilleoState) {
  await fs.mkdir(path.dirname(statePath()), { recursive: true })
  await fs.writeFile(statePath(), JSON.stringify(state, null, 2), 'utf8')
}

export async function upsertMilleoProject(input: {
  name: string
  summary?: string
  tags?: Array<string>
}) {
  const state = await readMilleoState()
  const name = input.name.trim()
  if (!name) throw new Error('Project name is required')
  const baseSlug = slugify(name) || 'project'
  const existing = state.projects.find((project) => project.slug === baseSlug)
  if (existing) return existing
  const timestamp = nowIso()
  const project: MilleoProject = {
    id: `prj_${baseSlug}`,
    slug: baseSlug,
    name,
    summary: input.summary?.trim() ?? '',
    status: 'active',
    tags: input.tags ?? [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  state.projects.push(project)
  await writeMilleoState(state)
  return project
}

export async function classifyMilleoFile(input: {
  path: string
  title?: string
  summary?: string
  projectId?: string | null
  projectName?: string
  kind?: MilleoFileKind
  status?: MilleoFileStatus
  tags?: Array<string>
  people?: Array<string>
}) {
  const state = await readMilleoState()
  let projectId = input.projectId ?? null
  if (!projectId && input.projectName?.trim()) {
    const project = await upsertMilleoProject({ name: input.projectName })
    const latestState = await readMilleoState()
    state.projects = latestState.projects
    state.files = latestState.files
    projectId = project.id
  }

  const existingIndex = state.files.findIndex((record) => record.path === input.path)
  const existing = existingIndex >= 0 ? state.files[existingIndex] : null
  const record: MilleoFileRecord = {
    path: input.path,
    title: input.title?.trim() || existing?.title || wordsFromName(input.path),
    summary: input.summary?.trim() ?? existing?.summary ?? '',
    projectId,
    kind: input.kind ?? existing?.kind ?? inferKind(input.path),
    status: input.status ?? existing?.status ?? (projectId ? 'reference' : 'unclassified'),
    tags: mergeUnique(existing?.tags ?? inferTags(input.path), input.tags ?? []),
    people: mergeUnique(existing?.people ?? [], input.people ?? []),
    updatedAt: nowIso(),
  }

  if (existingIndex >= 0) state.files[existingIndex] = record
  else state.files.push(record)
  await writeMilleoState(state)
  return record
}

export async function buildMilleoFiles(workspaceRoot: string) {
  const state = await readMilleoState()
  const recordsByPath = new Map(state.files.map((record) => [record.path, record]))
  const projectsById = new Map(state.projects.map((project) => [project.id, project]))
  const scanned: Array<{ path: string; size: number; modifiedAt: string; extension: string }> = []
  await scanFiles(workspaceRoot, workspaceRoot, 0, scanned)

  const candidates: Array<MilleoFileCandidate> = []
  for (const file of scanned.sort((a, b) => {
    const scoreDelta = priorityScore(b.path) - priorityScore(a.path)
    return scoreDelta || b.modifiedAt.localeCompare(a.modifiedAt)
  })) {
    const record = recordsByPath.get(file.path)
    const fullPath = path.join(workspaceRoot, file.path)
    const project = record?.projectId ? projectsById.get(record.projectId) : null
    candidates.push({
      path: file.path,
      name: path.basename(file.path),
      extension: file.extension,
      size: file.size,
      modifiedAt: file.modifiedAt,
      indexed: Boolean(record),
      title: record?.title || wordsFromName(file.path),
      summary: record?.summary || (await readTextSummary(fullPath, file.extension)),
      projectId: record?.projectId ?? null,
      projectName: project?.name ?? null,
      kind: record?.kind ?? inferKind(file.path),
      status: record?.status ?? 'unclassified',
      tags: record?.tags ?? inferTags(file.path),
      people: record?.people ?? [],
      source: sourceForPath(file.path),
    })
  }
  return candidates
}

export async function buildMilleoSummary(workspaceRoot: string): Promise<MilleoSummary> {
  const state = await readMilleoState()
  const files = await buildMilleoFiles(workspaceRoot)
  const strategicTasks = await readStrategicTasks(workspaceRoot)
  const activeProjects = state.projects
    .filter((project) => project.status === 'active')
    .map((project) => {
      const projectFiles = files.filter((file) => file.projectId === project.id)
      return {
        ...project,
        fileCount: projectFiles.length,
        recentFile: projectFiles[0] ?? null,
      }
    })

  return {
    workspaceRoot,
    totals: {
      filesDiscovered: files.length,
      filesIndexed: files.filter((file) => file.indexed).length,
      filesUnclassified: files.filter((file) => !file.indexed || file.status === 'unclassified').length,
      projects: state.projects.length,
    },
    recentFiles: files.slice(0, 8),
    unclassifiedFiles: files.filter((file) => !file.indexed || file.status === 'unclassified').slice(0, 12),
    strategic: buildStrategicSummary(strategicTasks, files),
    focusAreas: buildFocusAreas(files),
    activeProjects,
  }
}
