export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'blocked'

export type AgentStatus = 'running' | 'done' | 'failed' | 'stopped'

/** A subagent that ran under a task (or loose, when no task was active). */
export type AgentRun = {
  id: string
  name: string
  type: string
  status: AgentStatus
  startedAt: number
}

/** A real verification: a test, build, lint or typecheck command that ran. */
export type Check = {
  kind: 'test' | 'typecheck' | 'lint' | 'build' | 'validate' | 'custom'
  command: string
  ok: boolean
  at: number
}

/** Tokens as the API counts them, summed over the model requests of a task. */
export type Usage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  /** Model requests counted. */
  steps: number
}

export type Task = {
  id: string
  title: string
  status: TaskStatus
  startedAt: number | null
  endedAt: number | null
  calls: number
  agents: AgentRun[]
  checks: Check[]
  note: string
  /** The main agent's requests while this task was the active one. */
  usage: Usage
  /** The requests of the subagents that belong to this task. */
  agentUsage: Usage
  /** Session cost (USD) accumulated while the task ran. */
  cost: number
  /** The session cost when the running stretch began; null when not running. */
  costMark: number | null
}

export type Board = {
  goal: string
  createdAt: number | null
  tasks: Task[]
  activeId: string | null
  looseAgents: AgentRun[]
  /** Requests made while no task was active. */
  untracked: Usage
  /** A complex request came in and no plan exists yet. */
  needsPlan: boolean
  /** The plan was stored in history already (finished or replaced). */
  isArchived: boolean
  /** The board came back from a previous session. */
  isResumed: boolean
}

export type HistoryEntry = {
  goal: string
  startedAt: number
  endedAt: number
  durationMs: number
  total: number
  done: number
  failed: number
  reason: 'completed' | 'replaced' | 'cleared'
  /** Billable tokens of the plan (input + cache writes + output); absent in older entries. */
  tokens?: number
  /** Session cost of the plan in USD; absent in older entries. */
  cost?: number
  tasks: { title: string; status: TaskStatus }[]
}

export type View = {
  mode: 'board' | 'history'
  /** The task whose card shows its detail and action buttons. */
  expanded: string | null
  /** Show every task's detail at once. */
  expandAll: boolean
  /** The history entry opened for detail, by its `startedAt`. */
  historyOpen: number | null
}

/** Where the session runs: the project folder and the git branch checked out there. */
export type Project = {
  root: string
  /** `null` outside a git repository; `(abc1234)` for a detached HEAD. */
  branch: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'agent-taskboard': {
      board: Board
      view: View
      history: HistoryEntry[]
      project: Project
    }
  }
}
