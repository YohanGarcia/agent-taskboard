import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { AgentRun, Board, HistoryEntry, Project, TaskStatus, View } from '../types'
import { messages, resolveLang, systemLocale } from './i18n'
import type { Messages } from './i18n'
import {
  EMPTY_BOARD,
  GLYPH,
  STATUSES,
  addUsage,
  billableOf,
  boardFromEntry,
  branchFromHead,
  checkKindOf,
  clip,
  countsOf,
  durationOf,
  elapsedOf,
  emptyUsage,
  estimateTokens,
  fmtTokens,
  fmtUsd,
  gauge,
  gitDirFromFile,
  historyEntryOf,
  isFinished,
  lastCheck,
  looksComplex,
  markCost,
  normalizeTask,
  parentOf,
  progressOf,
  settleCost,
  stampOf,
  sumUsage,
  tailClip,
  taskIdFrom,
  tasksFrom,
  withTask,
} from './logic'

const PANE = 'agent-taskboard'
const PLAN_TOOL = 'mcp__agent-taskboard__plan'
const TASK_TOOL = 'mcp__agent-taskboard__task'
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
const HISTORY_LIMIT = 100

const boardAtom = atom({ plugin: 'agent-taskboard', key: 'board' } as const, EMPTY_BOARD)
const FRESH_VIEW: View = { mode: 'board', expanded: null, expandAll: false, historyOpen: null }
const viewAtom = atom({ plugin: 'agent-taskboard', key: 'view' } as const, FRESH_VIEW)
const historyAtom = atom({ plugin: 'agent-taskboard', key: 'history' } as const, [] as HistoryEntry[])
const projectAtom = atom({ plugin: 'agent-taskboard', key: 'project' } as const, { root: '', branch: null } as Project)

let ticker: Timer | null = null

// ---------------------------------------------------------------- project root and branch

/** Reads `.git/HEAD` by walking up from the project folder: no process, only file reads. */
async function readBranch($: EngineInterface, root: string): Promise<string | null> {
  const sep = root.includes('\\') ? '\\' : '/'
  let dir: string | null = root

  for (let i = 0; i < 8 && dir !== null; i += 1) {
    const dot = `${dir.replace(/[\\/]+$/, '')}${sep}.git`
    try {
      const stat = await $.fs.stat(dot)
      let gitDir = dot
      if (stat.kind === 'file') {
        const raw = await $.fs.read(dot)
        const pointed = gitDirFromFile(typeof raw === 'string' ? raw : '')
        if (!pointed) return null
        gitDir = /^([A-Za-z]:|[\\/])/.test(pointed) ? pointed : `${dir}${sep}${pointed}`
      }
      const head = await $.fs.read(`${gitDir}${sep}HEAD`)

      return branchFromHead(typeof head === 'string' ? head : '')
    } catch {
      dir = parentOf(dir)
    }
  }

  return null
}

async function refreshProject($: EngineInterface): Promise<void> {
  const root = await $.session.cwd()
  const branch = await readBranch($, root)

  await update($, projectAtom, cur => (cur.root === root && cur.branch === branch ? cur : { root, branch }))
}

// ---------------------------------------------------------------- persistence

async function persist($: EngineInterface): Promise<void> {
  const cwd = await $.session.cwd()
  const [b, h] = await Promise.all([read($, boardAtom), read($, historyAtom)])
  await $.store.set(`board:${cwd}`, b)
  await $.store.set(`history:${cwd}`, h)
}

async function syncTicker($: EngineInterface): Promise<void> {
  const b = await read($, boardAtom)
  const isLive = b.tasks.some(t => t.status === 'in_progress')

  if (isLive && ticker === null) {
    ticker = $.clock.every(1000, () => $.ui.invalidate('ui.render'))
  } else if (!isLive && ticker !== null) {
    ticker.cancel()
    ticker = null
  }
}

async function mutate($: EngineInterface, fn: (b: Board) => Board): Promise<void> {
  await update($, boardAtom, fn)
  await persist($)
  await syncTicker($)
}

async function restore($: EngineInterface, t: Messages): Promise<void> {
  const cwd = await $.session.cwd()
  const saved = (await $.store.get(`board:${cwd}`)) as Board | undefined
  const entries = (await $.store.get(`history:${cwd}`)) as HistoryEntry[] | undefined

  if (Array.isArray(entries)) await update($, historyAtom, () => entries.slice(-HISTORY_LIMIT))
  if (!saved || !Array.isArray(saved.tasks) || saved.tasks.length === 0 || saved.isArchived) return

  // Work in flight when the last session ended comes back paused, its agents stopped.
  const resumed: Board = {
    ...EMPTY_BOARD,
    ...saved,
    activeId: null,
    needsPlan: false,
    isResumed: true,
    looseAgents: [],
    untracked: saved.untracked ?? emptyUsage(),
    tasks: saved.tasks.map(normalizeTask).map(task => ({
      ...task,
      agents: task.agents.map(a => (a.status === 'running' ? { ...a, status: 'stopped' as const } : a)),
      ...(task.status === 'in_progress'
        ? { status: 'pending' as const, startedAt: null, endedAt: null, note: task.note || t.resumedNote }
        : {}),
    })),
  }

  await update($, boardAtom, () => resumed)
}

async function archiveBoard($: EngineInterface, reason: HistoryEntry['reason']): Promise<void> {
  const b = await read($, boardAtom)
  if (b.isArchived) return

  const entry = historyEntryOf(b, await $.clock.now(), isFinished(b) ? 'completed' : reason)
  if (!entry) return

  await update($, historyAtom, list => [...list, entry].slice(-HISTORY_LIMIT))
  await update($, boardAtom, x => ({ ...x, isArchived: true }))
}

async function clearBoard($: EngineInterface): Promise<void> {
  await archiveBoard($, 'cleared')
  await update($, viewAtom, () => FRESH_VIEW)
  await mutate($, () => EMPTY_BOARD)
}

// ---------------------------------------------------------------- real events

async function afterCall(
  $: EngineInterface,
  tool: string,
  input: Record<string, unknown>,
  isOk: boolean,
  extraChecks: readonly string[],
): Promise<void> {
  const b = await read($, boardAtom)
  if (b.tasks.length === 0) return

  const now = await $.clock.now()
  const willStart = b.activeId === null && b.tasks.some(x => x.status === 'pending')
  const cost = willStart ? await costNow($) : null
  const command = typeof input.command === 'string' ? input.command : ''
  const kind = tool === 'Bash' || tool === 'PowerShell' ? checkKindOf(command, extraChecks) : null

  await mutate($, cur => {
    let next = cur
    let activeId = cur.activeId

    // The first real call after a plan starts its first pending task.
    if (activeId === null) {
      const first = cur.tasks.find(task => task.status === 'pending')
      if (!first) return cur
      activeId = first.id
      next = withTask({ ...cur, activeId }, first.id, task => ({
        ...markCost(task, cost),
        status: 'in_progress',
        startedAt: task.startedAt !== null && task.endedAt !== null ? now - (task.endedAt - task.startedAt) : now,
        endedAt: null,
      }))
    }

    return withTask(next, activeId, task => ({
      ...task,
      calls: task.calls + 1,
      checks: kind ? [...task.checks, { kind, command: clip(command, 80), ok: isOk, at: now }].slice(-10) : task.checks,
    }))
  })
}

async function setTaskStatus($: EngineInterface, id: string, status: TaskStatus, note: string): Promise<void> {
  const now = await $.clock.now()
  const cost = await costNow($)

  await mutate($, cur => {
    const paused = cur.tasks.find(task => task.status === 'in_progress' && task.id !== id)
    let next = cur

    // One task at a time: starting another pauses the running one.
    if (status === 'in_progress' && paused) {
      next = withTask(next, paused.id, task => ({ ...settleCost(task, cost), status: 'pending', endedAt: now }))
    }

    next = withTask(next, id, task => {
      if (status === 'in_progress') {
        const wasPaused = task.startedAt !== null && task.endedAt !== null
        return {
          ...markCost(task, cost),
          status,
          startedAt: wasPaused ? now - ((task.endedAt ?? now) - (task.startedAt ?? now)) : (task.startedAt ?? now),
          endedAt: null,
          note: note || task.note,
        }
      }
      if (status === 'pending') return { ...settleCost(task, cost), status, startedAt: null, endedAt: null, note: note || task.note }

      return { ...settleCost(task, cost), status, startedAt: task.startedAt ?? now, endedAt: now, note: note || task.note }
    })

    const activeId = status === 'in_progress' ? id : cur.activeId === id ? null : cur.activeId

    return { ...next, activeId }
  })

  if (isFinished(await read($, boardAtom))) await archiveBoard($, 'completed')
}

/** The session's cost so far, read fresh; null where the host keeps no ledger. */
async function costNow($: EngineInterface): Promise<number | null> {
  const usage = await $.session.usage().catch(() => null)

  return usage?.cost?.usd ?? null
}

/** Adds one model request to the task it belongs to: the active one for the main agent, the owner for a subagent. */
async function recordUsage($: EngineInterface, agentId: string | null, step: Parameters<typeof addUsage>[1]): Promise<void> {
  if (!step) return

  await mutate($, cur => {
    if (agentId === null) {
      if (cur.activeId === null) return { ...cur, untracked: addUsage(cur.untracked, step) }

      return withTask(cur, cur.activeId, task => ({ ...task, usage: addUsage(task.usage, step) }))
    }

    const owner = cur.tasks.find(task => task.agents.some(a => a.id === agentId))?.id ?? cur.activeId
    if (owner === null) return { ...cur, untracked: addUsage(cur.untracked, step) }

    return withTask(cur, owner, task => ({ ...task, agentUsage: addUsage(task.agentUsage, step) }))
  })
}

async function setAgentStatus($: EngineInterface, agentId: string, status: AgentRun['status']): Promise<void> {
  const swap = (list: AgentRun[]) => list.map(a => (a.id === agentId ? { ...a, status } : a))

  await mutate($, cur => ({
    ...cur,
    looseAgents: swap(cur.looseAgents),
    tasks: cur.tasks.map(task => ({ ...task, agents: swap(task.agents) })),
  }))
}

async function skipPlan($: EngineInterface): Promise<void> {
  await mutate($, cur => ({ ...cur, needsPlan: false }))
}

async function reopenEntry($: EngineInterface, entry: HistoryEntry, t: Messages): Promise<void> {
  await archiveBoard($, 'replaced')
  const now = await $.clock.now()
  await update($, viewAtom, () => FRESH_VIEW)
  await mutate($, () => boardFromEntry(entry, now, status => t.previously(t.status[status])))
}

// ---------------------------------------------------------------- text answers

function historyText(entries: readonly HistoryEntry[], t: Messages): string {
  if (entries.length === 0) return t.historyEmpty
  const lines = entries
    .slice(-15)
    .reverse()
    .map(entry => {
      const mark = entry.reason === 'completed' ? '✓' : entry.reason === 'replaced' ? '↻' : '✗'
      return `${mark} ${stampOf(entry.startedAt)} · ${entry.done}/${entry.total} · ${durationOf(entry.durationMs)} · ${entry.goal}`
    })

  return [t.historyHeading, ...lines].join('\n')
}

function boardText(b: Board, t: Messages): string {
  if (b.tasks.length === 0) return t.noActivePlan
  const { done, total, percent } = progressOf(b.tasks)
  const rows = b.tasks.map(task => `${GLYPH[task.status]} ${task.id} ${task.title} (${t.status[task.status]})`)

  return [`${b.goal} · ${done}/${total} (${percent}%)`, ...rows].join('\n')
}

/** Tokens and cost per task, plus what the mod itself adds to every request (an estimate). */
function statsText(b: Board, t: Messages): string {
  const overheadRules = estimateTokens(t.planRules)
  const overheadTools =
    estimateTokens(
      [t.planToolDescription, t.taskToolDescription, t.goalDescription, t.tasksDescription, t.idDescription, t.noteDescription].join(' '),
    ) + 70
  const overhead = t.statsOverhead(fmtTokens(overheadRules), fmtTokens(overheadTools), fmtTokens(overheadRules + overheadTools))
  if (b.tasks.length === 0 && billableOf(b.untracked) === 0) return `${t.statsNoPlan}\n${overhead}`

  const usd = (n: number) => (n > 0 ? fmtUsd(n) : '')
  const rows = b.tasks.map(task => {
    const all = sumUsage(task.usage, task.agentUsage)
    const detail =
      all.steps === 0 ? '' : t.tokensLine(fmtTokens(all.input + all.cacheWrite), fmtTokens(all.output), fmtTokens(all.cacheRead), '', '')
    return t.statsRow(task.id, task.title, fmtTokens(billableOf(all)), detail, usd(task.cost))
  })
  const total =
    b.tasks.reduce((n, task) => n + billableOf(task.usage) + billableOf(task.agentUsage), 0) + billableOf(b.untracked)
  const cost = b.tasks.reduce((n, task) => n + task.cost, 0)
  const lines = [t.statsTitle(b.goal || '-'), ...rows]
  if (billableOf(b.untracked) > 0) lines.push(t.statsUntracked(fmtTokens(billableOf(b.untracked))))

  return [...lines, t.statsTotal(fmtTokens(total), usd(cost)), '', overhead].join('\n')
}

// ---------------------------------------------------------------- the module

export const register: Register = (on, options) => {
  const isOpenOnStart = options.openOnStart !== false
  const planMode = options.planMode === 'warn' || options.planMode === 'off' ? options.planMode : 'block'
  const isEnforcing = planMode === 'block'
  const isFlagging = planMode !== 'off'
  const minChars = Number(options.minPromptChars) > 0 ? Number(options.minPromptChars) : 240
  const extraChecks = String(options.extraChecks ?? '')
    .split(',')
    .map(part => part.trim())
    .filter(part => part !== '')
  const t = messages(resolveLang(options.language, systemLocale()))

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'taskboard',
      description: t.commandDescription,
      argumentHint: '[open|close|history|clear|skip|stats]',
    })
    await $.tool.register({
      name: 'plan',
      description: t.planToolDescription,
      inputSchema: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: t.goalDescription },
          tasks: { type: 'array', items: { type: 'string' }, description: t.tasksDescription },
        },
        required: ['goal', 'tasks'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'task',
      description: t.taskToolDescription,
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: t.idDescription },
          status: { type: 'string', enum: ['in_progress', 'done', 'failed', 'blocked', 'pending'] },
          note: { type: 'string', description: t.noteDescription },
        },
        required: ['id', 'status'],
      },
      isDeferred: false,
    })
    await restore($, t)
    await refreshProject($).catch(() => undefined)
    await syncTicker($)
    if (isOpenOnStart) void $.ui.open({ id: PANE, title: t.paneTitle, columns: 52 }).catch(() => undefined)

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return { sections: [...composed.sections, { id: 'agent-taskboard:plan', text: t.planRules, scope: 'session' as const }] }
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    if (isFlagging && looksComplex(e.text, minChars)) {
      const b = await read($, boardAtom)
      const hasOpenPlan = b.tasks.length > 0 && !isFinished(b)
      if (!hasOpenPlan) await update($, boardAtom, x => ({ ...x, needsPlan: true }))
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    await recordUsage($, e.agentId ?? null, result.usage).catch(() => undefined)

    return result
  })

  on('tool.call', { tool: PLAN_TOOL }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const tasks = tasksFrom(input.tasks)
    if (tasks.length === 0) return { result: t.emptyPlan }

    await archiveBoard($, 'replaced')
    const now = await $.clock.now()
    const goal = clip(String(input.goal ?? ''), 160) || t.untitled
    await update($, viewAtom, () => FRESH_VIEW)
    await mutate($, () => ({ ...EMPTY_BOARD, goal, createdAt: now, tasks }))

    return { result: t.planRegistered(tasks.length, tasks.map(task => `${task.id} ${task.title}`).join(' | ')) }
  })

  on('tool.call', { tool: TASK_TOOL }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const id = String(input.id ?? '')
    const status = String(input.status ?? '') as TaskStatus
    const note = clip(String(input.note ?? ''), 160)
    const b = await read($, boardAtom)
    const task = b.tasks.find(x => x.id === id)

    if (!task) return { result: t.noSuchTask(id, b.tasks.map(x => x.id).join(', ')) }
    if (!STATUSES.includes(status)) return { result: t.badStatus(status) }

    if (status === 'done') {
      const last = lastCheck(task)
      if (last && !last.ok) return { deny: t.denyDone(id, last.kind, last.command) }
    }

    await setTaskStatus($, id, status, note)
    const after = await read($, boardAtom)
    const { done, total } = progressOf(after.tasks)
    const verification = status !== 'done' ? 'n/a' : task.checks.some(c => c.ok) ? 'with' : 'without'

    return { result: t.taskUpdated(id, t.status[status], verification, done, total) }
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (tool === PLAN_TOOL || tool === TASK_TOOL) return next(e)

    if (isEnforcing && !e.agentId && EDIT_TOOLS.has(tool)) {
      const b = await read($, boardAtom)
      if (b.needsPlan) return { deny: t.denyNoPlan }
    }

    const ran = await next(e)

    if (!e.agentId) {
      const isOk = ran.deny === undefined && ran.isError !== true
      await afterCall($, tool, e as unknown as Record<string, unknown>, isOk, extraChecks)
      // A shell command may have switched branch.
      if (tool === 'Bash' || tool === 'PowerShell') await refreshProject($).catch(() => undefined)
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined || !started.agentId) return started

    const run: AgentRun = {
      id: started.agentId,
      name: clip(e.description || e.subagentType, 40),
      type: e.subagentType,
      status: 'running',
      startedAt: await $.clock.now(),
    }
    // A subagent belongs to the task it names ("t3: …"); only unnamed ones fall back to the active task.
    const named = taskIdFrom(e.description ?? '', e.prompt ?? '')

    await mutate($, cur => {
      const owner = named !== null && cur.tasks.some(x => x.id === named) ? named : cur.activeId
      if (owner === null) return { ...cur, looseAgents: [...cur.looseAgents, run].slice(-12) }

      return withTask(cur, owner, task => ({ ...task, agents: [...task.agents, run].slice(-12) }))
    })

    return started
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)

    if (e.agentId) {
      await setAgentStatus($, e.agentId, e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'stopped' : 'failed')
    } else if (e.reason !== 'answer') {
      await mutate($, cur =>
        cur.activeId === null ? cur : withTask(cur, cur.activeId, task => ({ ...task, note: task.note || t.interruptedNote })),
      )
    }

    return done
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'taskboard' }, async ($, e) => {
    const [verb = 'open'] = e.args.trim().split(/\s+/)

    if (verb === 'close') {
      await $.ui.close({ id: PANE })
      return { text: t.closed }
    }
    if (verb === 'history') {
      await update($, viewAtom, x => ({ ...x, mode: 'history' as const }))
      void $.ui.open({ id: PANE, title: t.paneTitle, columns: 52 }).catch(() => undefined)
      return { text: historyText(await read($, historyAtom), t) }
    }
    if (verb === 'clear') {
      await clearBoard($)
      return { text: t.cleared }
    }
    if (verb === 'stats') return { text: statsText(await read($, boardAtom), t) }
    if (verb === 'skip') {
      await update($, boardAtom, x => ({ ...x, needsPlan: false }))
      return { text: t.skipped }
    }

    await update($, viewAtom, x => ({ ...x, mode: 'board' as const }))
    const opened = await $.ui.open({ id: PANE, title: t.paneTitle, columns: 52 })
    const summary = boardText(await read($, boardAtom), t)

    return { text: opened.isPlaced ? summary : `${t.paneNotShown(opened.reason ?? '')}\n${summary}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    // Never name a local `h`: JSX compiles to calls of the global `h`.
    const [b, v, past, proj, now] = await Promise.all([
      read($, boardAtom),
      read($, viewAtom),
      read($, historyAtom),
      read($, projectAtom),
      $.clock.now(),
    ])
    const FULL = Math.max(34, e.props.bodyColumns)
    // The panel pads itself (2 columns each side), so W is what fits inside.
    const W = FULL - 4
    // The pane's own height: the footer sits at its bottom edge, whatever the content.
    const rows = e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 24
    const { done, total, percent } = progressOf(b.tasks)
    const counts = countsOf(b.tasks)
    const isHistory = v.mode === 'history'
    const g = gauge(done, total, Math.min(16, Math.max(8, W - 30)))

    const colorOf = (s: TaskStatus) =>
      s === 'done' ? 'green' : s === 'failed' ? 'red' : s === 'blocked' ? 'yellow' : s === 'in_progress' ? 'cyan' : 'gray'

    const card = (title: string, right: string, body: unknown) => (
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} width={W}>
        <Box justifyContent="space-between" width={W - 4}>
          <Text bold color="cyan">{`◈ ${title}`}</Text>
          <Text dimColor>{right}</Text>
        </Box>
        {body}
      </Box>
    )

    const actions = (
      <Box justifyContent="flex-end" columnGap={1} width={W}>
        {!isHistory && b.tasks.length > 0 ? (
          <Button
            key="expand-all"
            hotkey="e"
            label={v.expandAll ? t.collapse : t.expandAll}
            onPress={() => update($, viewAtom, x => ({ ...x, expandAll: !x.expandAll }))}
          />
        ) : null}
        <Button
          key="toggle-view"
          hotkey="h"
          label={isHistory ? t.viewBoard : t.viewHistory}
          onPress={() => update($, viewAtom, x => ({ ...x, mode: x.mode === 'board' ? ('history' as const) : ('board' as const) }))}
        />
        <Button key="clear" hotkey="l" label={t.clear} dimColor={b.tasks.length === 0} onPress={() => clearBoard($)} />
      </Box>
    )

    // ---- where the session runs: the project folder and its branch, at the bottom of every view
    const place = (
      <Box flexDirection="column" width={W}>
        <Text color="gray">{'─'.repeat(Math.max(1, W))}</Text>
        <Text wrap="truncate">
          <Text dimColor>{`${t.rootLabel}: `}</Text>
          <Text>{tailClip(proj.root, W - t.rootLabel.length - 2)}</Text>
        </Text>
        <Text wrap="truncate">
          <Text dimColor>{`${t.branchLabel}: `}</Text>
          <Text color="magenta" bold>
            {proj.branch ?? t.noBranch}
          </Text>
        </Text>
      </Box>
    )

    // ---- history: a list, one plan open for its detail
    if (isHistory) {
      const room = Math.max(3, Math.floor((rows - 8) / 2))
      const shown = past.slice(-room).reverse()

      return (
        <Box flexDirection="column" width={FULL} minHeight={rows} paddingX={2} paddingY={1} justifyContent="space-between">
          <Box flexDirection="column" width={W} rowGap={1}>
            {card(t.historyTitle, t.plansCount(past.length), <Text dimColor>{t.savedPlans}</Text>)}
            {actions}
            {shown.length === 0 ? <Text dimColor>{t.noFinished}</Text> : null}
            {shown.map((entry, i) => {
              const isOpen = v.historyOpen === entry.startedAt
              const markColor = entry.reason === 'completed' ? 'green' : entry.reason === 'replaced' ? 'yellow' : 'gray'
              const mark = entry.reason === 'completed' ? '✓' : entry.reason === 'replaced' ? '↻' : '✗'

              return (
                <Box flexDirection="column" borderStyle={isOpen ? 'round' : undefined} borderColor={isOpen ? markColor : undefined} paddingX={isOpen ? 1 : 0}>
                  <Box>
                    <Text color={markColor}>{`${mark} `}</Text>
                    <Button
                      key={`hist-${entry.startedAt}`}
                      plain
                      hotkey={i < 9 ? String(i + 1) : undefined}
                      label={clip(entry.goal, Math.max(10, W - 8))}
                      onPress={() => update($, viewAtom, x => ({ ...x, historyOpen: x.historyOpen === entry.startedAt ? null : entry.startedAt }))}
                    />
                  </Box>
                  <Text dimColor wrap="truncate">{`  ${entry.done}/${entry.total} · ${durationOf(entry.durationMs)} · ${stampOf(entry.startedAt)}`}</Text>
                  {isOpen ? (
                    <Box flexDirection="column">
                      {entry.tasks.map(task => (
                        <Text wrap="truncate" color={colorOf(task.status)}>
                          {`  ${GLYPH[task.status]} ${clip(task.title, W - 8)}`}
                        </Text>
                      ))}
                      <Box columnGap={2}>
                        <Button key={`reopen-${entry.startedAt}`} plain hotkey="r" label={t.reopen} onPress={() => reopenEntry($, entry, t)} />
                      </Box>
                    </Box>
                  ) : null}
                </Box>
              )
            })}
            <Text dimColor wrap="truncate">{t.historyHelp}</Text>
          </Box>
          {place}
        </Box>
      )
    }

    // ---- the friction notice: visible, with a way out
    const notice = b.needsPlan ? (
      <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} width={W}>
        <Text color="yellow" bold>
          {t.noticeTitle}
        </Text>
        <Text dimColor wrap="wrap">
          {isEnforcing ? t.noticeBlocking : t.noticeSuggesting}
        </Text>
        <Box>
          <Button key="skip-plan" plain hotkey="o" label={t.skipPlan} onPress={() => skipPlan($)} />
        </Box>
      </Box>
    ) : null

    if (b.tasks.length === 0) {
      return (
        <Box flexDirection="column" width={FULL} minHeight={rows} paddingX={2} paddingY={1} justifyContent="space-between">
          <Box flexDirection="column" width={W} rowGap={1}>
            {card(t.boardTitle, '', <Text dimColor>{t.noPlanBody}</Text>)}
            {actions}
            {notice}
            {notice === null ? <Text dimColor wrap="wrap">{t.noPlanHint}</Text> : null}
            {past.length > 0 ? <Text dimColor>{t.historyHint(past.length)}</Text> : null}
          </Box>
          {place}
        </Box>
      )
    }

    // ---- the board: summary, then one row per task, cards for the ones in focus
    const elapsed = b.createdAt === null ? '' : ` · ${durationOf(now - b.createdAt)}`
    const planTokens =
      b.tasks.reduce((n, x) => n + billableOf(x.usage) + billableOf(x.agentUsage), 0) + billableOf(b.untracked)
    const planCost = b.tasks.reduce((n, x) => n + x.cost, 0)
    const running = b.tasks.reduce((n, x) => n + x.agents.filter(a => a.status === 'running').length, 0) + b.looseAgents.filter(a => a.status === 'running').length

    const taskView = (task: Board['tasks'][number], i: number) => {
      const ms = elapsedOf(task, now)
      const color = colorOf(task.status)
      const isOpen = v.expanded === task.id
      const isCard = task.status === 'in_progress' || isOpen || v.expandAll
      const last = lastCheck(task)
      const spent = sumUsage(task.usage, task.agentUsage)
      const meta = `${ms === null ? '' : durationOf(ms)}${spent.steps > 0 ? ` · ${fmtTokens(billableOf(spent))}` : ''}${task.agents.length > 0 ? ` · ⚙${task.agents.length}` : ''}${last ? (last.ok ? ' · ✔' : ' · ✘') : ''}`

      const titleRow = (
        <Box justifyContent="space-between" width={isCard ? W - 4 : W}>
          <Box>
            <Text color={color}>{`${GLYPH[task.status]} `}</Text>
            <Button
              key={`task-${task.id}`}
              plain
              hotkey={i < 9 ? String(i + 1) : undefined}
              label={clip(task.title, Math.max(10, W - 18))}
              onPress={() => update($, viewAtom, x => ({ ...x, expanded: x.expanded === task.id ? null : task.id }))}
            />
          </Box>
          <Text dimColor>{meta}</Text>
        </Box>
      )

      if (!isCard) return <Box key={`row-${task.id}`}>{titleRow}</Box>

      return (
        <Box key={`card-${task.id}`} flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} width={W}>
          {titleRow}
          <Text dimColor wrap="truncate">{t.taskDetail(t.status[task.status], task.calls, task.checks.length)}</Text>
          {spent.steps > 0 ? (
            <Text dimColor wrap="truncate">
              {t.tokensLine(
                fmtTokens(task.usage.input + task.usage.cacheWrite),
                fmtTokens(task.usage.output),
                fmtTokens(spent.cacheRead),
                task.agentUsage.steps > 0 ? fmtTokens(billableOf(task.agentUsage)) : '',
                task.cost > 0 ? fmtUsd(task.cost) : '',
              )}
            </Text>
          ) : null}
          {task.agents.map(a => (
            <Text wrap="truncate" color={a.status === 'failed' ? 'red' : a.status === 'running' ? 'cyan' : 'gray'}>
              {`⚙ ${a.name} · ${t.agentStatus[a.status]}`}
            </Text>
          ))}
          {task.checks.slice(-3).map(c => (
            <Text wrap="truncate" color={c.ok ? 'green' : 'red'}>
              {`${c.ok ? '✔' : '✘'} ${c.kind}: ${c.command}`}
            </Text>
          ))}
          {task.note ? (
            <Text dimColor wrap="wrap">
              {`» ${task.note}`}
            </Text>
          ) : null}
          {isOpen ? (
            <Box columnGap={2}>
              {task.status !== 'in_progress' ? (
                <Button key={`go-${task.id}`} plain hotkey="i" label={t.start} onPress={() => setTaskStatus($, task.id, 'in_progress', '')} />
              ) : (
                <Button key={`ok-${task.id}`} plain hotkey="d" label={t.markDone} onPress={() => setTaskStatus($, task.id, 'done', t.manualDone)} />
              )}
              {task.status !== 'blocked' ? (
                <Button key={`block-${task.id}`} plain hotkey="b" label={t.block} onPress={() => setTaskStatus($, task.id, 'blocked', t.manualBlocked)} />
              ) : null}
              {task.status !== 'failed' ? (
                <Button key={`fail-${task.id}`} plain hotkey="f" label={t.fail} onPress={() => setTaskStatus($, task.id, 'failed', t.manualFailed)} />
              ) : null}
            </Box>
          ) : null}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" width={FULL} minHeight={rows} paddingX={2} paddingY={1} justifyContent="space-between">
        <Box flexDirection="column" width={W} rowGap={1}>
          {card(
            t.boardTitle,
            `${percent}%${elapsed}`,
            <Box flexDirection="column">
              <Text bold wrap="truncate">
                {clip(b.goal, W - 4)}
              </Text>
              <Text wrap="truncate">
                <Text color="green">{g.on}</Text>
                <Text color="gray">{g.off}</Text>
                <Text bold>{` ${done}/${total}`}</Text>
              </Text>
              <Text wrap="truncate">
                <Text color="green">{`✓ ${counts.done}`}</Text>
                <Text dimColor>{'   '}</Text>
                <Text color="cyan">{`◐ ${counts.in_progress}`}</Text>
                <Text dimColor>{'   '}</Text>
                <Text color="gray">{`○ ${counts.pending}`}</Text>
                {counts.blocked > 0 ? <Text color="yellow">{`   ⏸ ${counts.blocked}`}</Text> : null}
                {counts.failed > 0 ? <Text color="red">{`   ✗ ${counts.failed}`}</Text> : null}
                {running > 0 ? <Text color="cyan">{`   ${t.activeAgents(running)}`}</Text> : null}
              </Text>
              {planTokens > 0 ? (
                <Text dimColor wrap="truncate">
                  {t.totalLine(fmtTokens(planTokens), planCost > 0 ? fmtUsd(planCost) : '')}
                </Text>
              ) : null}
            </Box>,
          )}
          {actions}
          {notice}
          {b.isResumed ? <Text dimColor>{t.resumedBanner}</Text> : null}
          <Box flexDirection="column" width={W}>
            {b.tasks.map((task, i) => taskView(task, i))}
          </Box>
          {b.looseAgents.length > 0 ? (
            <Text dimColor wrap="truncate">{t.looseAgents(b.looseAgents.map(a => a.name).join(', '))}</Text>
          ) : null}
          <Text dimColor wrap="truncate">
            {v.expanded !== null ? t.helpTask : t.helpBoard}
          </Text>
        </Box>
        {place}
      </Box>
    )
  })
}
