import type { AgentStatus, TaskStatus } from '../types'

export type Lang = 'es' | 'en'

/** Every sentence the mod shows or says to the model, in one language. */
export type Messages = {
  // for the model: the rules it reads, the tools it calls and what they answer
  planRules: string
  denyNoPlan: string
  planToolDescription: string
  taskToolDescription: string
  goalDescription: string
  tasksDescription: string
  idDescription: string
  noteDescription: string
  emptyPlan: string
  untitled: string
  todoGoal: string
  planRegistered: (count: number, list: string) => string
  noSuchTask: (id: string, ids: string) => string
  badStatus: (status: string) => string
  denyDone: (id: string, kind: string, command: string) => string
  taskUpdated: (id: string, status: string, verification: 'with' | 'without' | 'n/a', done: number, total: number) => string

  // vocabulary
  status: Record<TaskStatus, string>
  agentStatus: Record<AgentStatus, string>

  // notes the mod writes on a task
  resumedNote: string
  interruptedNote: string
  manualDone: string
  manualBlocked: string
  manualFailed: string
  previously: (status: string) => string

  // /taskboard command
  commandDescription: string
  paneTitle: string
  closed: string
  cleared: string
  skipped: string
  paneNotShown: (reason: string) => string
  noActivePlan: string
  historyEmpty: string
  historyHeading: string

  // panel
  boardTitle: string
  historyTitle: string
  plansCount: (count: number) => string
  savedPlans: string
  noFinished: string
  expandAll: string
  collapse: string
  viewBoard: string
  viewHistory: string
  clear: string
  reopen: string
  historyHelp: string
  noticeTitle: string
  noticeBlocking: string
  noticeSuggesting: string
  skipPlan: string
  noPlanBody: string
  noPlanHint: string
  historyHint: (count: number) => string
  taskDetail: (status: string, calls: number, checks: number) => string
  start: string
  markDone: string
  block: string
  fail: string
  activeAgents: (count: number) => string
  resumedBanner: string
  looseAgents: (names: string) => string
  helpTask: string
  helpBoard: string
  rootLabel: string
  branchLabel: string
  noBranch: string
  // tokens and cost
  tokensLine: (input: string, output: string, cache: string, agents: string, cost: string) => string
  totalLine: (tokens: string, cost: string) => string
  statsTitle: (goal: string) => string
  statsNoPlan: string
  statsRow: (id: string, title: string, tokens: string, detail: string, cost: string) => string
  statsUntracked: (tokens: string) => string
  statsTotal: (tokens: string, cost: string) => string
  statsOverhead: (rules: string, tools: string, total: string) => string
}

const es: Messages = {
  planRules: [
    'Tablero de tareas (agent-taskboard).',
    'Ante una solicitud compleja (varios archivos, varias etapas, una funcionalidad nueva o un refactor), ANTES de editar o escribir archivos llama a mcp__agent-taskboard__plan con { goal, tasks }: tasks es una lista corta de pasos concretos y verificables.',
    'Mientras trabajas usa mcp__agent-taskboard__task con { id, status }: marca "in_progress" al empezar cada tarea y "done" al terminarla. Antes de "done" ejecuta la verificación que corresponda (tests, build, lint o tsc): el tablero rechaza "done" si la última verificación de esa tarea falló.',
    'Si una tarea no se puede completar, márcala "failed" o "blocked" con una nota breve. Para solicitudes simples no crees plan.',
    'El plan del modo plan (ExitPlanMode) y la lista TodoWrite se reflejan solos en el tablero: si usas uno de ellos no hace falta llamar a plan.',
    'Al lanzar un subagente para una tarea del plan, empieza su description con el id, por ejemplo "t2: revisar tipos", para que el tablero lo asigne a esa tarea.',
  ].join('\n'),
  denyNoPlan:
    'agent-taskboard: esta solicitud es compleja y aún no hay plan. Antes de editar o escribir archivos, registra el plan con mcp__agent-taskboard__plan ({ goal, tasks }) y luego continúa.',
  planToolDescription:
    'Registra el plan de trabajo en el tablero de tareas antes de implementar una solicitud compleja. Reemplaza el plan anterior.',
  taskToolDescription:
    'Actualiza el estado de una tarea del plan (id t1, t2, …). "done" se rechaza si la última verificación de esa tarea falló.',
  goalDescription: 'Objetivo general en una frase',
  tasksDescription: 'Pasos concretos y verificables, en orden',
  idDescription: 'Id de la tarea, por ejemplo t1',
  noteDescription: 'Nota breve opcional',
  emptyPlan: 'Plan vacío: indica al menos una tarea en "tasks".',
  untitled: 'Sin título',
  todoGoal: 'Tareas de Claude Code',
  planRegistered: (count, list) =>
    `Plan registrado (${count} tareas): ${list}. Actualiza cada una con mcp__agent-taskboard__task.`,
  noSuchTask: (id, ids) => `No existe la tarea "${id}". Tareas del plan: ${ids || 'ninguna'}.`,
  badStatus: status => `Estado inválido "${status}". Usa in_progress, done, failed, blocked o pending.`,
  denyDone: (id, kind, command) =>
    `agent-taskboard: "${id}" no puede pasar a hecha: la última verificación (${kind}: ${command}) falló. Corrígela y vuelve a ejecutarla.`,
  taskUpdated: (id, status, verification, done, total) =>
    `Tarea ${id} → ${status}${verification === 'with' ? ' (con verificación)' : verification === 'without' ? ' (sin verificación)' : ''}. Progreso: ${done}/${total}.`,

  status: { pending: 'pendiente', in_progress: 'en curso', done: 'hecha', failed: 'falló', blocked: 'bloqueada' },
  agentStatus: { running: 'en curso', done: 'hecho', failed: 'falló', stopped: 'detenido' },

  resumedNote: 'retomada: la sesión anterior terminó con ella en curso',
  interruptedNote: 'turno interrumpido',
  manualDone: 'marcada a mano',
  manualBlocked: 'bloqueada a mano',
  manualFailed: 'marcada a mano',
  previously: status => `antes: ${status}`,

  commandDescription: 'Tablero de tareas: abrir, cerrar, historial, limpiar u omitir el plan',
  paneTitle: 'Tablero de tareas',
  closed: 'Tablero cerrado.',
  cleared: 'Tablero limpiado; el plan quedó en el historial.',
  skipped: 'Plan omitido para esta solicitud: Edit/Write ya no se bloquean.',
  paneNotShown: reason => `El panel aún no se muestra: ${reason}`,
  noActivePlan: 'Sin plan activo.',
  historyEmpty: 'Historial vacío: aún no hay planes terminados en este proyecto.',
  historyHeading: 'Historial (más reciente primero):',

  boardTitle: 'TABLERO DE TAREAS',
  historyTitle: 'HISTORIAL',
  plansCount: count => `${count} plan(es)`,
  savedPlans: 'Planes guardados en este proyecto',
  noFinished: 'Aún no hay planes terminados.',
  expandAll: 'todo',
  collapse: 'menos',
  viewBoard: 'tablero',
  viewHistory: 'historial',
  clear: 'limpiar',
  reopen: '↻ retomar este plan',
  historyHelp: '1-9 abre · r retoma · h vuelve al tablero',
  noticeTitle: 'Solicitud compleja detectada',
  noticeBlocking: 'Edit/Write quedan bloqueados hasta que Claude registre un plan.',
  noticeSuggesting: 'Conviene que Claude registre un plan antes de editar.',
  skipPlan: 'omitir plan',
  noPlanBody: 'Sin plan activo',
  noPlanHint: 'Sin plan. Claude creará uno al recibir una solicitud compleja.',
  historyHint: count => `${count} plan(es) en el historial · h para verlos`,
  taskDetail: (status, calls, checks) =>
    `${status} · ${calls} llamadas${checks > 0 ? ` · ${checks} verificación(es)` : ''}`,
  start: '▶ iniciar',
  markDone: '✓ hecha',
  block: '⏸ bloquear',
  fail: '✗ falló',
  activeAgents: count => `⚙ ${count} activo(s)`,
  resumedBanner: 'retomado de una sesión anterior',
  looseAgents: names => `sin tarea: ${names}`,
  helpTask: 'i iniciar · d hecha · b bloquear · f falló · e todo',
  helpBoard: '1-9 abre una tarea · e todo · h historial · l limpiar',
  rootLabel: 'raíz',
  branchLabel: 'rama',
  noBranch: 'sin git',
  tokensLine: (input, output, cache, agents, cost) =>
    `↑${input} ↓${output} · caché ${cache}${agents ? ` · subagentes ${agents}` : ''}${cost ? ` · ${cost}` : ''}`,
  totalLine: (tokens, cost) => `Σ ${tokens} tokens${cost ? ` · ${cost}` : ''}`,
  statsTitle: goal => `Tokens y costo del plan: ${goal}`,
  statsNoPlan: 'No hay plan activo; nada que medir.',
  statsRow: (id, title, tokens, detail, cost) => `${id} ${title} · ${tokens}${detail ? ` (${detail})` : ''}${cost ? ` · ${cost}` : ''}`,
  statsUntracked: tokens => `sin tarea: ${tokens}`,
  statsTotal: (tokens, cost) => `Total: ${tokens} tokens${cost ? ` · ${cost}` : ''}`,
  statsOverhead: (rules, tools, total) =>
    `Costo propio de agent-taskboard (estimación, texto fijo en cada petición): ~${total} tokens (reglas ${rules} + herramientas ${tools}). Casi todo se sirve desde la caché del prompt.`,
}

const en: Messages = {
  planRules: [
    'Task board (agent-taskboard).',
    'For a complex request (several files, several stages, a new feature or a refactor), BEFORE editing or writing files call mcp__agent-taskboard__plan with { goal, tasks }: tasks is a short list of concrete, verifiable steps.',
    'While you work use mcp__agent-taskboard__task with { id, status }: mark "in_progress" when you start each task and "done" when you finish it. Before "done" run the check that fits (tests, build, lint or tsc): the board rejects "done" if that task\'s last check failed.',
    'If a task cannot be completed, mark it "failed" or "blocked" with a short note. For simple requests do not create a plan.',
    'The plan from plan mode (ExitPlanMode) and the TodoWrite list are mirrored on the board by themselves: if you use one of them there is no need to call plan.',
    'When you start a subagent for a plan task, begin its description with the id, for example "t2: review types", so the board assigns it to that task.',
  ].join('\n'),
  denyNoPlan:
    'agent-taskboard: this request is complex and there is no plan yet. Before editing or writing files, register the plan with mcp__agent-taskboard__plan ({ goal, tasks }) and then continue.',
  planToolDescription:
    'Registers the work plan on the task board before implementing a complex request. Replaces the previous plan.',
  taskToolDescription:
    'Updates the status of a plan task (id t1, t2, …). "done" is rejected if that task\'s last check failed.',
  goalDescription: 'Overall goal in one sentence',
  tasksDescription: 'Concrete, verifiable steps, in order',
  idDescription: 'Task id, for example t1',
  noteDescription: 'Optional short note',
  emptyPlan: 'Empty plan: give at least one task in "tasks".',
  untitled: 'Untitled',
  todoGoal: 'Claude Code tasks',
  planRegistered: (count, list) =>
    `Plan registered (${count} tasks): ${list}. Update each one with mcp__agent-taskboard__task.`,
  noSuchTask: (id, ids) => `There is no task "${id}". Plan tasks: ${ids || 'none'}.`,
  badStatus: status => `Invalid status "${status}". Use in_progress, done, failed, blocked or pending.`,
  denyDone: (id, kind, command) =>
    `agent-taskboard: "${id}" cannot be marked done: its last check (${kind}: ${command}) failed. Fix it and run it again.`,
  taskUpdated: (id, status, verification, done, total) =>
    `Task ${id} → ${status}${verification === 'with' ? ' (verified)' : verification === 'without' ? ' (unverified)' : ''}. Progress: ${done}/${total}.`,

  status: { pending: 'pending', in_progress: 'in progress', done: 'done', failed: 'failed', blocked: 'blocked' },
  agentStatus: { running: 'running', done: 'done', failed: 'failed', stopped: 'stopped' },

  resumedNote: 'resumed: the previous session ended with it in progress',
  interruptedNote: 'turn interrupted',
  manualDone: 'set by hand',
  manualBlocked: 'blocked by hand',
  manualFailed: 'set by hand',
  previously: status => `before: ${status}`,

  commandDescription: 'Task board: open, close, history, clear or skip the plan',
  paneTitle: 'Task board',
  closed: 'Task board closed.',
  cleared: 'Task board cleared; the plan is in the history.',
  skipped: 'Plan skipped for this request: Edit/Write are no longer blocked.',
  paneNotShown: reason => `The pane is not shown yet: ${reason}`,
  noActivePlan: 'No active plan.',
  historyEmpty: 'History is empty: no finished plans in this project yet.',
  historyHeading: 'History (most recent first):',

  boardTitle: 'TASK BOARD',
  historyTitle: 'HISTORY',
  plansCount: count => `${count} plan(s)`,
  savedPlans: 'Plans saved in this project',
  noFinished: 'No finished plans yet.',
  expandAll: 'all',
  collapse: 'less',
  viewBoard: 'board',
  viewHistory: 'history',
  clear: 'clear',
  reopen: '↻ resume this plan',
  historyHelp: '1-9 open · r resume · h back to the board',
  noticeTitle: 'Complex request detected',
  noticeBlocking: 'Edit/Write are blocked until Claude registers a plan.',
  noticeSuggesting: 'Claude should register a plan before editing.',
  skipPlan: 'skip plan',
  noPlanBody: 'No active plan',
  noPlanHint: 'No plan. Claude will create one for a complex request.',
  historyHint: count => `${count} plan(s) in history · h to see them`,
  taskDetail: (status, calls, checks) => `${status} · ${calls} calls${checks > 0 ? ` · ${checks} check(s)` : ''}`,
  start: '▶ start',
  markDone: '✓ done',
  block: '⏸ block',
  fail: '✗ failed',
  activeAgents: count => `⚙ ${count} active`,
  resumedBanner: 'resumed from a previous session',
  looseAgents: names => `no task: ${names}`,
  helpTask: 'i start · d done · b block · f failed · e all',
  helpBoard: '1-9 open a task · e all · h history · l clear',
  rootLabel: 'root',
  branchLabel: 'branch',
  noBranch: 'no git',
  tokensLine: (input, output, cache, agents, cost) =>
    `↑${input} ↓${output} · cache ${cache}${agents ? ` · subagents ${agents}` : ''}${cost ? ` · ${cost}` : ''}`,
  totalLine: (tokens, cost) => `Σ ${tokens} tokens${cost ? ` · ${cost}` : ''}`,
  statsTitle: goal => `Tokens and cost of the plan: ${goal}`,
  statsNoPlan: 'No active plan; nothing to measure.',
  statsRow: (id, title, tokens, detail, cost) => `${id} ${title} · ${tokens}${detail ? ` (${detail})` : ''}${cost ? ` · ${cost}` : ''}`,
  statsUntracked: tokens => `no task: ${tokens}`,
  statsTotal: (tokens, cost) => `Total: ${tokens} tokens${cost ? ` · ${cost}` : ''}`,
  statsOverhead: (rules, tools, total) =>
    `agent-taskboard's own cost (estimate, fixed text on every request): ~${total} tokens (rules ${rules} + tools ${tools}). Most of it is served from the prompt cache.`,
}

const TABLE: Record<Lang, Messages> = { es, en }

export function messages(lang: Lang): Messages {
  return TABLE[lang]
}

/** The system's locale as the runtime reports it, or an empty string when it does not. */
export function systemLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    return ''
  }
}

/** `es`, `en`, or `auto` (the system locale: Spanish for es-*, English otherwise). */
export function resolveLang(option: unknown, locale: string): Lang {
  if (option === 'es' || option === 'en') return option

  return locale.toLowerCase().startsWith('es') ? 'es' : 'en'
}
