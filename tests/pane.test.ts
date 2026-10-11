import { expect, mock, test } from 'claude-code/testing'

// Regresión: el panel lanzó "h is not a function" porque una variable local `h` tapaba la fábrica JSX.
// Montarlo de verdad es lo único que atrapa ese tipo de error.
test('el panel dibuja el tablero vacío y con un plan', { options: { language: 'es' } }, async ($, on) => {
  mock.clock(on, { now: 1_000 })
  mock.store(on)
  on('session.cwd', () => ({ value: '/proyecto' }))

  const target = {
    plugin: 'agent-taskboard',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'agent-taskboard',
    props: { bodyColumns: 52 },
    viewport: { columns: 60, rows: 24 },
  } as const

  const empty = await $.ui.mount(target as never)
  expect(await empty.find({ text: /TABLERO/ })).toBeDefined()
  expect(await empty.find({ text: /Sin plan/ })).toBeDefined()
  await empty.unmount()

  await $.tool.call({ tool: 'mcp__agent-taskboard__plan', goal: 'Probar el panel', tasks: ['Primera', 'Segunda'] })

  const planned = await $.ui.mount(target as never)
  expect(await planned.find({ text: /Probar el panel/ })).toBeDefined()
  expect(await planned.find({ text: /0\/2/ })).toBeDefined()
  await planned.unmount()
})

test('abrir una tarea muestra sus acciones y el historial se alterna', { options: { language: 'es' } }, async ($, on) => {
  mock.clock(on, { now: 1_000 })
  mock.store(on)
  on('session.cwd', () => ({ value: '/proyecto' }))

  await $.tool.call({ tool: 'mcp__agent-taskboard__plan', goal: 'Interacción', tasks: ['Primera', 'Segunda'] })

  const pane = await $.ui.mount({
    plugin: 'agent-taskboard',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'agent-taskboard',
    props: { bodyColumns: 52 },
    viewport: { columns: 60, rows: 24 },
  } as never)

  expect(await pane.find({ text: /iniciar/ })).toBeUndefined()
  await pane.press({ key: 'task-t1' })
  expect(await pane.find({ text: /iniciar/ })).toBeDefined()

  await pane.press({ key: 'toggle-view' })
  expect(await pane.find({ text: /HISTORIAL/ })).toBeDefined()
  await pane.unmount()
})
