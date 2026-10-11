import type { Board, Check, HistoryEntry, Task, TaskStatus, Usage } from '../types'

export function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, steps: 0 }
}

export const EMPTY_BOARD: Board = {
  goal: '',
  createdAt: null,
  tasks: [],
  activeId: null,
  looseAgents: [],
  untracked: emptyUsage(),
  needsPlan: false,
  isArchived: false,
  isResumed: false,
}

const CHECK_PATTERNS: [Check['kind'], RegExp][] = [
  ['test', /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\b(?:vitest|jest|pytest|mocha|playwright|cypress|phpunit)\b|\bgo\s+test\b|\bcargo\s+test\b|\bdotnet\s+test\b|\bclaude\s+plugin\s+test\b|\bmake\s+test\b/i],
  ['validate', /\bclaude\s+plugin\s+validate\b|\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:check|validate|verify)\b/i],
  ['typecheck', /\btsc\b|\bmypy\b|\bpyright\b|\bcargo\s+check\b/i],
  ['lint', /\beslint\b|\bruff\b|\bflake8\b|\bclippy\b|\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?lint\b/i],
  ['build', /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b|\bvite\s+build\b|\bcargo\s+build\b|\bgo\s+build\b|\bgradle\b|\bmvn\b/i],
]

/**
 * What kind of verification a shell command is, or null when it is not one.
 * `extra` are the person's own commands (substrings, any case) that also count.
 */
export function checkKindOf(command: string, extra: readonly string[] = []): Check['kind'] | null {
  for (const [kind, pattern] of CHECK_PATTERNS) {
    if (pattern.test(command)) return kind
  }

  const lower = command.toLowerCase()
  if (extra.some(part => part !== '' && lower.includes(part.toLowerCase()))) return 'custom'

  return null
}

const CD_PREFIX = /^\s*(?:cd|pushd|set-location)\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+)\s*(?:&&|;)\s*/i

/** A command as the board shows it: without the `cd <folder> &&` that only says where it ran. */
export function commandLabel(command: string): string {
  let text = command
  for (let i = 0; i < 3; i += 1) {
    const next = text.replace(CD_PREFIX, '')
    if (next === text || next.trim() === '') break
    text = next
  }

  return text.trim()
}

/**
 * The task a subagent was started for, when its description or prompt names one:
 * `t3: revisar tipos`, `[t3] revisar tipos`, `(t3) …`.
 */
export function taskIdFrom(...texts: readonly string[]): string | null {
  for (const text of texts) {
    const head = text.slice(0, 120)
    const lead = /^\s*[[(]?\b(t\d{1,2})\b[\])]?\s*[:·–-]/i.exec(head)
    const tagged = /[[(]\s*(t\d{1,2})\s*[\])]/i.exec(head)
    const id = lead?.[1] ?? tagged?.[1]
    if (id) return id.toLowerCase()
  }

  return null
}

const ACTION_WORDS =
  /\b(?:implement\w*|cre(?:a|ar|e|es|en)|agreg\w*|a[ñn]ad\w*|refactor\w*|migr\w*|integr\w*|constru\w*|desarroll\w*|build\w*|add|create\w*|develop\w*)\b/gi

/** Whether a prompt reads as a complex request that deserves a plan first. */
export function looksComplex(text: string, minChars: number): boolean {
  const t = text.trim()
  if (t === '' || t.startsWith('/')) return false

  const bullets = t.split(/\r?\n/).filter(l => /^\s*(?:[-*•]|\d+[.)])\s+/.test(l)).length
  const actions = (t.match(ACTION_WORDS) ?? []).length

  if (bullets >= 3) return true
  if (actions >= 2) return true
  if (t.endsWith('?') && t.length < minChars) return false

  // Length alone is not a task: a pasted log or a long question names no action.
  return actions >= 1 && t.length >= minChars
}

export function countsOf(tasks: readonly Task[]): Record<TaskStatus, number> {
  const counts: Record<TaskStatus, number> = { pending: 0, in_progress: 0, done: 0, failed: 0, blocked: 0 }
  for (const t of tasks) counts[t.status] += 1

  return counts
}

/** A past plan brought back to the board: what was done stays done, the rest starts again. */
export function boardFromEntry(
  entry: HistoryEntry,
  now: number,
  noteOf: (status: TaskStatus) => string = () => '',
): Board {
  return {
    ...EMPTY_BOARD,
    goal: entry.goal,
    createdAt: now,
    isResumed: true,
    tasks: entry.tasks.map((t, i) => ({
      id: `t${i + 1}`,
      title: t.title,
      status: t.status === 'done' ? ('done' as const) : ('pending' as const),
      startedAt: null,
      endedAt: null,
      calls: 0,
      agents: [],
      checks: [],
      note: t.status === 'done' || t.status === 'pending' ? '' : noteOf(t.status),
      usage: emptyUsage(),
      agentUsage: emptyUsage(),
      cost: 0,
      costMark: null,
    })),
  }
}

export function progressOf(tasks: readonly Task[]): { done: number; total: number; percent: number } {
  const total = tasks.length
  const done = tasks.filter(t => t.status === 'done').length

  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) }
}

export function isFinished(board: Board): boolean {
  return board.tasks.length > 0 && board.tasks.every(t => t.status === 'done' || t.status === 'failed')
}

/** A task's elapsed time: running ones count to `now`, finished ones to their end. */
export function elapsedOf(task: Task, now: number): number | null {
  if (task.startedAt === null) return null

  return Math.max(0, (task.endedAt ?? now) - task.startedAt)
}

/**
 * Time actually spent on a plan: the union of its tasks' running stretches (to `now` for running ones).
 * A plan left open overnight does not count the hours nobody worked on it.
 */
export function workTimeOf(tasks: readonly Task[], now: number): number {
  const spans = tasks
    .filter(t => t.startedAt !== null)
    .map(t => [t.startedAt as number, Math.max(t.startedAt as number, t.endedAt ?? now)] as const)
    .sort((a, b) => a[0] - b[0])

  let total = 0
  let end = -Infinity
  for (const [from, to] of spans) {
    total += Math.max(0, to - Math.max(from, end))
    end = Math.max(end, to)
  }

  return total
}

/** `45s`, `3m05s`, `1h02m`. */
export function durationOf(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`

  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

export function gauge(done: number, total: number, width: number): { on: string; off: string } {
  const full = total === 0 ? 0 : Math.round((done / total) * width)

  return { on: '▰'.repeat(full), off: '▱'.repeat(Math.max(0, width - full)) }
}

export function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim()

  return one.length > max ? `${one.slice(0, Math.max(0, max - 1)).trimEnd()}…` : one
}

export const GLYPH: Record<TaskStatus, string> = {
  pending: '○',
  in_progress: '◐',
  done: '✓',
  failed: '✗',
  blocked: '⏸',
}

export const STATUSES: readonly TaskStatus[] = ['pending', 'in_progress', 'done', 'failed', 'blocked']

/** Tasks from the model's plan input: strings or `{ title }` objects, ids t1, t2, … */
export function tasksFrom(input: unknown): Task[] {
  if (!Array.isArray(input)) return []

  return input
    .map(item =>
      typeof item === 'string' ? item : typeof item === 'object' && item !== null ? String((item as { title?: unknown }).title ?? '') : '',
    )
    .map(title => clip(title, 120))
    .filter(title => title !== '')
    .slice(0, 30)
    .map((title, i) => ({
      id: `t${i + 1}`,
      title,
      status: 'pending' as const,
      startedAt: null,
      endedAt: null,
      calls: 0,
      agents: [],
      checks: [],
      note: '',
      usage: emptyUsage(),
      agentUsage: emptyUsage(),
      cost: 0,
      costMark: null,
    }))
}

/** A task as Claude Code's own plan mode or todo list names it. */
export type NativeItem = { title: string; status: TaskStatus }

function blankTask(id: string, title: string, status: TaskStatus = 'pending'): Task {
  return {
    id,
    title,
    status,
    startedAt: null,
    endedAt: null,
    calls: 0,
    agents: [],
    checks: [],
    note: '',
    usage: emptyUsage(),
    agentUsage: emptyUsage(),
    cost: 0,
    costMark: null,
  }
}

const NATIVE_STATUS: Record<string, TaskStatus> = {
  pending: 'pending',
  in_progress: 'in_progress',
  completed: 'done',
  done: 'done',
}

/** The items of a `TodoWrite` input (`{ todos: [{ content, status, activeForm }] }`). */
export function itemsFromTodos(input: unknown): NativeItem[] {
  if (!Array.isArray(input)) return []

  const items: NativeItem[] = []
  for (const raw of input) {
    if (typeof raw !== 'object' || raw === null) continue
    const r = raw as { content?: unknown; subject?: unknown; activeForm?: unknown; status?: unknown }
    const title = clip(String(r.content ?? r.subject ?? r.activeForm ?? ''), 120)
    if (title === '') continue
    items.push({ title, status: NATIVE_STATUS[String(r.status ?? '')] ?? 'pending' })
  }

  return items.slice(0, 30)
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^\[[ xX]\]\s+/, '')
    .replace(/[*_`]+/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim()
}

/**
 * The goal and the steps of a plan-mode plan (markdown): the first heading is the goal;
 * the steps are its numbered items, or its bullets when nothing is numbered, or its
 * sub-headings as a last resort. Nested items are details, not steps.
 */
export function planFromMarkdown(text: string): { goal: string; steps: string[] } {
  const lines = text.split(/\r?\n/)
  const heading = lines.map(l => /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(l)?.[1]).find(h => h !== undefined)
  const firstText = lines.map(l => l.trim()).find(l => l !== '' && !/^(?:#|[-*•]|\d+[.)])/.test(l))
  const goal = clip(stripMarkdown(heading ?? firstText ?? ''), 160)

  const top = (re: RegExp) =>
    lines
      .map(l => (/^ {0,1}\S/.test(l) ? re.exec(l)?.[1] : undefined))
      .filter((s): s is string => s !== undefined)
      .map(s => clip(stripMarkdown(s), 120))
      .filter(s => s !== '')
  const numbered = top(/^\s*\d+[.)]\s+(.+)$/)
  const bullets = top(/^\s*[-*•]\s+(.+)$/)
  const subs = lines
    .map(l => /^\s{0,3}#{2,6}\s+(.+?)\s*#*\s*$/.exec(l)?.[1])
    .filter((s): s is string => s !== undefined)
    .map(s => clip(stripMarkdown(s), 120))

  const steps = numbered.length > 0 ? numbered : bullets.length > 0 ? bullets : subs

  return { goal, steps: steps.slice(0, 30) }
}

const sameTitle = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Whether the board already holds at least one of these items (by title). */
export function sharesTask(board: Board, items: readonly NativeItem[]): boolean {
  return items.some(i => board.tasks.some(t => sameTitle(t.title, i.title)))
}

/**
 * The board after Claude Code's own list changed. Tasks already on the board (by title)
 * keep their time, tokens, checks and agents; the list's statuses are the truth.
 * `fresh` starts a new board instead of editing the current one.
 */
export function boardFromNative(
  board: Board,
  items: readonly NativeItem[],
  opts: { goal: string; source: NonNullable<Board['source']>; now: number; cost: number | null; fresh: boolean },
): Board {
  const base: Board = opts.fresh ? { ...EMPTY_BOARD, createdAt: opts.now } : board
  const taken = new Set<string>()

  const tasks = items.map((item, i) => {
    const old = base.tasks.find(t => !taken.has(t.id) && sameTitle(t.title, item.title))
    if (old) taken.add(old.id)
    const was = old ?? blankTask('', item.title)
    const settled = was.status === 'in_progress' && item.status !== 'in_progress' ? settleCost(was, opts.cost) : was
    const id = `t${i + 1}`

    if (item.status === 'in_progress') {
      const resumed = was.status === 'in_progress' ? settled : markCost(settled, opts.cost)
      return { ...resumed, id, title: item.title, status: item.status, startedAt: was.startedAt ?? opts.now, endedAt: null }
    }
    if (item.status === 'pending') {
      return { ...settled, id, title: item.title, status: item.status, startedAt: null, endedAt: null }
    }

    return {
      ...settled,
      id,
      title: item.title,
      status: item.status,
      startedAt: was.startedAt ?? opts.now,
      endedAt: was.endedAt ?? opts.now,
    }
  })

  return {
    ...base,
    goal: base.goal !== '' && !opts.fresh ? base.goal : opts.goal,
    createdAt: base.createdAt ?? opts.now,
    tasks,
    activeId: tasks.find(t => t.status === 'in_progress')?.id ?? null,
    needsPlan: false,
    isArchived: false,
    source: opts.source,
  }
}

/** Replaces one task, leaving the others. */
export function withTask(board: Board, id: string, fn: (task: Task) => Task): Board {
  return { ...board, tasks: board.tasks.map(t => (t.id === id ? fn(t) : t)) }
}

/** The check that decides whether a task may be called done: its latest one, if any. */
export function lastCheck(task: Task): Check | null {
  return task.checks.length === 0 ? null : (task.checks[task.checks.length - 1] ?? null)
}

export function historyEntryOf(board: Board, now: number, reason: HistoryEntry['reason']): HistoryEntry | null {
  if (board.tasks.length === 0 || board.createdAt === null) return null
  const { done, total } = progressOf(board.tasks)
  const lastEnd = board.tasks.reduce((m, t) => Math.max(m, t.endedAt ?? 0), 0)
  const endedAt = reason === 'completed' && lastEnd > 0 ? lastEnd : now

  return {
    goal: clip(board.goal, 160),
    startedAt: board.createdAt,
    endedAt,
    durationMs: workTimeOf(board.tasks, endedAt),
    total,
    done,
    failed: board.tasks.filter(t => t.status === 'failed').length,
    reason,
    tokens: board.tasks.reduce((n, t) => n + billableOf(t.usage) + billableOf(t.agentUsage), 0) + billableOf(board.untracked),
    cost: Math.round(board.tasks.reduce((n, t) => n + (t.cost ?? 0), 0) * 10_000) / 10_000,
    tasks: board.tasks.map(t => ({ title: clip(t.title, 100), status: t.status })),
  }
}

/** `2026-10-10 20:31`, local time. */
export function stampOf(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')

  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ---------------------------------------------------------------- project

/** The branch a `.git/HEAD` text names; a detached HEAD reads as its short hash in parentheses. */
export function branchFromHead(text: string): string | null {
  const line = text.trim().split(/\r?\n/)[0] ?? ''
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(line)
  if (ref?.[1]) return ref[1].trim()
  if (/^[0-9a-f]{7,40}$/i.test(line)) return `(${line.slice(0, 7)})`

  return null
}

/** The git directory a `.git` file (a worktree or a submodule) points to, or null. */
export function gitDirFromFile(text: string): string | null {
  const match = /^gitdir:\s*(.+)$/m.exec(text.trim())

  return match?.[1]?.trim() ?? null
}

/** A file Claude Code itself keeps its plans in (`.claude/plans/…`): writing it is planning, not building. */
export function isPlanFile(path: unknown): boolean {
  return typeof path === 'string' && /(?:^|[\\/])\.claude[\\/]plans[\\/]/.test(path)
}

/** Keeps the end of a long path: `…\money\Money-Fast-Web`. */
export function tailClip(text: string, max: number): string {
  if (max <= 1) return ''

  if (text.length <= max) return text

  // Start at a folder boundary when that still keeps most of the room, not in the middle of a name.
  const tail = text.slice(-(max - 1))
  const sep = tail.search(/[\\/]/)

  return `…${sep > 0 && sep < tail.length - 4 ? tail.slice(sep) : tail}`
}

/** The parent folder of a path, or null at the top. Works with `\` and `/`. */
export function parentOf(path: string): string | null {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (cut <= 0) return null
  const parent = path.slice(0, cut)

  return /^[A-Za-z]:$/.test(parent) ? `${parent}${path[cut]}` : parent
}

// ---------------------------------------------------------------- tokens and cost

/** One model request's usage as the API spells it; any field may be missing. */
export type StepUsage = {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
} | null

export function addUsage(into: Usage | undefined, step: StepUsage): Usage {
  const u = into ?? emptyUsage()
  if (!step) return u

  return {
    input: u.input + (step.input_tokens ?? 0),
    output: u.output + (step.output_tokens ?? 0),
    cacheRead: u.cacheRead + (step.cache_read_input_tokens ?? 0),
    cacheWrite: u.cacheWrite + (step.cache_creation_input_tokens ?? 0),
    steps: u.steps + 1,
  }
}

export function sumUsage(a: Usage | undefined, b: Usage | undefined): Usage {
  const x = a ?? emptyUsage()
  const y = b ?? emptyUsage()

  return {
    input: x.input + y.input,
    output: x.output + y.output,
    cacheRead: x.cacheRead + y.cacheRead,
    cacheWrite: x.cacheWrite + y.cacheWrite,
    steps: x.steps + y.steps,
  }
}

/** What a request really sent and got: fresh input, cache writes and output. Cache reads are the cheap part. */
export function billableOf(u: Usage | undefined): number {
  return u ? u.input + u.cacheWrite + u.output : 0
}

/** `842`, `12.4k`, `1.3M`. */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`

  return `${(n / 1_000_000).toFixed(1)}M`
}

/** `$0.04`, `$1.20`. */
export function fmtUsd(n: number): string {
  return `$${n.toFixed(n < 10 ? 2 : 1)}`
}

/** A rough token count for a text the mod adds to every request (about 4 characters a token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** A stored task from an older version, brought up to the current shape. */
export function normalizeTask(t: Task): Task {
  return {
    ...t,
    usage: t.usage ?? emptyUsage(),
    agentUsage: t.agentUsage ?? emptyUsage(),
    cost: typeof t.cost === 'number' ? t.cost : 0,
    costMark: typeof t.costMark === 'number' ? t.costMark : null,
  }
}

/** Closes a running stretch: the session cost since the mark joins the task's own. */
export function settleCost(task: Task, cost: number | null): Task {
  if (task.costMark === null) return task
  const added = cost === null ? 0 : Math.max(0, cost - task.costMark)

  return { ...task, cost: task.cost + added, costMark: null }
}

/** Opens a running stretch at the session cost now. */
export function markCost(task: Task, cost: number | null): Task {
  return { ...task, costMark: cost }
}
