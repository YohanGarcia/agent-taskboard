import { expect, mock, test } from 'claude-code/testing'

import {
  EMPTY_BOARD,
  boardFromNative,
  commandLabel,
  historyEntryOf,
  isPlanFile,
  itemsFromTodos,
  planFromMarkdown,
  sharesTask,
  tasksFrom,
  workTimeOf,
} from '../hooks/logic'

test('commandLabel quita el cd inicial y deja el comando que importa', () => {
  expect(commandLabel('cd E:\\proyectos\\money\\Money-Fast-Web && npm run lint')).toBe('npm run lint')
  expect(commandLabel('cd "E:/mis proyectos/app"; npx vitest run')).toBe('npx vitest run')
  expect(commandLabel('cd /a && cd /b && npm test')).toBe('npm test')
  expect(commandLabel('npm test')).toBe('npm test')
  expect(commandLabel('cd /solo')).toBe('cd /solo')
})

test('workTimeOf suma los tramos de trabajo y no las horas sin actividad', () => {
  const [a, b, c] = tasksFrom(['a', 'b', 'c'])
  const tasks = [
    { ...a!, status: 'done' as const, startedAt: 0, endedAt: 60_000 },
    // Plan left open for 12 hours, then the second stretch.
    { ...b!, status: 'done' as const, startedAt: 12 * 3_600_000, endedAt: 12 * 3_600_000 + 30_000 },
    { ...c!, status: 'pending' as const },
  ]
  expect(workTimeOf(tasks, 13 * 3_600_000)).toBe(90_000)
  // Overlapping stretches are not counted twice.
  expect(workTimeOf([{ ...a!, startedAt: 0, endedAt: 10_000 }, { ...b!, startedAt: 5_000, endedAt: 20_000 }], 0)).toBe(20_000)
  // A running task counts up to now.
  expect(workTimeOf([{ ...a!, status: 'in_progress' as const, startedAt: 1_000, endedAt: null }], 4_000)).toBe(3_000)
})

test('el historial guarda el tiempo de trabajo, no el tiempo de reloj', () => {
  const [a] = tasksFrom(['a'])
  const task = { ...a!, status: 'done' as const, startedAt: 12 * 3_600_000, endedAt: 12 * 3_600_000 + 45_000 }
  const entry = historyEntryOf({ ...EMPTY_BOARD, goal: 'meta', createdAt: 0, tasks: [task] }, 13 * 3_600_000, 'completed')
  expect(entry?.durationMs).toBe(45_000)
})

test('itemsFromTodos traduce los estados de TodoWrite', () => {
  const items = itemsFromTodos([
    { content: 'Leer el código', status: 'completed', activeForm: 'Leyendo' },
    { content: 'Escribir tests', status: 'in_progress' },
    { content: 'Publicar', status: 'pending' },
    { content: '' },
  ])
  expect(items).toEqual([
    { title: 'Leer el código', status: 'done' },
    { title: 'Escribir tests', status: 'in_progress' },
    { title: 'Publicar', status: 'pending' },
  ])
  expect(itemsFromTodos('nada')).toEqual([])
})

test('planFromMarkdown saca el objetivo y los pasos numerados', () => {
  const plan = planFromMarkdown(
    ['# Plan: migrar a Vite', '', 'Contexto breve.', '', '1. **Instalar** vite', '   - detalle anidado', '2. Mover `index.html`', '', '## Archivos', '- src/main.ts'].join('\n'),
  )
  expect(plan.goal).toBe('Plan: migrar a Vite')
  expect(plan.steps).toEqual(['Instalar vite', 'Mover index.html'])
})

test('planFromMarkdown usa viñetas o subtítulos cuando no hay numeración', () => {
  expect(planFromMarkdown('# Meta\n- uno\n- dos').steps).toEqual(['uno', 'dos'])
  expect(planFromMarkdown('# Meta\n## Fase A\ntexto\n## Fase B').steps).toEqual(['Fase A', 'Fase B'])
})

test('boardFromNative conserva el trabajo de las tareas que ya estaban', () => {
  const first = boardFromNative(
    EMPTY_BOARD,
    [{ title: 'A', status: 'in_progress' }, { title: 'B', status: 'pending' }],
    { goal: 'Meta', source: 'todo', now: 1000, cost: null, fresh: true },
  )
  expect(first.activeId).toBe('t1')
  expect(first.tasks[0]?.startedAt).toBe(1000)

  const second = boardFromNative(
    first,
    [{ title: 'A', status: 'done' }, { title: 'B', status: 'in_progress' }],
    { goal: 'otra', source: 'todo', now: 5000, cost: null, fresh: false },
  )
  expect(second.goal).toBe('Meta')
  expect(second.tasks[0]).toMatchObject({ status: 'done', startedAt: 1000, endedAt: 5000 })
  expect(second.activeId).toBe('t2')
  expect(sharesTask(second, [{ title: ' a ', status: 'pending' }])).toBe(true)
  expect(sharesTask(second, [{ title: 'Z', status: 'pending' }])).toBe(false)
})

test('TodoWrite y ExitPlanMode llegan al tablero y liberan el guard', { options: { language: 'es' } }, async ($, on) => {
  mock.clock(on, { now: 1_000 })
  mock.store(on)
  on('session.cwd', () => ({ value: '/proyecto' }))
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'ExitPlanMode' }, () => ({ result: 'ok' }))

  await $.tool.call({ tool: 'TodoWrite', todos: [
    { content: 'Primera', status: 'in_progress', activeForm: 'Haciendo la primera' },
    { content: 'Segunda', status: 'pending', activeForm: 'Haciendo la segunda' },
  ] })
  let shown = await $.command.run({ command: 'taskboard', args: 'stats' })
  expect(String(shown.text)).toContain('Primera')

  await $.tool.call({ tool: 'ExitPlanMode', plan: '# Rehacer login\n1. Cambiar formulario\n2. Probar' })
  shown = await $.command.run({ command: 'taskboard', args: 'stats' })
  expect(String(shown.text)).toContain('Rehacer login')
  expect(String(shown.text)).toContain('Cambiar formulario')
})

test('el guard deja escribir el archivo del plan pero no el código', { options: { language: 'es' } }, async ($, on) => {
  mock.clock(on, { now: 1_000 })
  mock.store(on)
  on('session.cwd', () => ({ value: '/proyecto' }))
  on('tool.call', { tool: 'Write' }, () => ({ result: 'escrito' }))
  on('prompt.submit', (_, e) => ({ text: e.text }))

  await $.prompt.submit({
    text: 'Quiero crear una utilidad nueva:\n1. diseñar\n2. implementar\n3. probar\n4. documentar',
  })

  const code = await $.tool.call({ tool: 'Write', file_path: '/proyecto/src/a.ts', content: 'x' })
  expect(String(code.deny ?? '')).toContain('plan')

  const plan = await $.tool.call({ tool: 'Write', file_path: 'C:/Users/yo/.claude/plans/mi-plan.md', content: '# Plan' })
  expect(plan.deny).toBeUndefined()
})

test('isPlanFile reconoce .claude/plans en Windows y POSIX', () => {
  expect(isPlanFile('C:\\Users\\yo\\.claude\\plans\\x.md')).toBe(true)
  expect(isPlanFile('/home/yo/.claude/plans/x.md')).toBe(true)
  expect(isPlanFile('/proyecto/src/plans/x.ts')).toBe(false)
  expect(isPlanFile(undefined)).toBe(false)
})
