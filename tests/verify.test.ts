import { expect, mock, test } from 'claude-code/testing'

test('una verificación verde de claude plugin test cuenta para la tarea', { options: { language: 'es' } }, async ($, on) => {
  mock.clock(on, { now: 1_000 })
  mock.store(on)
  on('session.cwd', () => ({ value: '/proyecto' }))
  // Under the plugin: the shell command succeeds.
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))

  await $.tool.call({ tool: 'mcp__agent-taskboard__plan', goal: 'Verificar', tasks: ['Primera'] })
  await $.tool.call({ tool: 'mcp__agent-taskboard__task', id: 't1', status: 'in_progress' })
  await $.tool.call({ tool: 'Bash', command: 'claude plugin test C:/mods/x' })

  const done = await $.tool.call({ tool: 'mcp__agent-taskboard__task', id: 't1', status: 'done' })
  expect(String(done.text ?? done.result)).toContain('con verificación')
})

test('sin ninguna verificación la tarea se cierra "sin verificación"', { options: { language: 'es' } }, async ($, on) => {
  mock.clock(on, { now: 1_000 })
  mock.store(on)
  on('session.cwd', () => ({ value: '/proyecto' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))

  await $.tool.call({ tool: 'mcp__agent-taskboard__plan', goal: 'Sin verificar', tasks: ['Primera'] })
  await $.tool.call({ tool: 'mcp__agent-taskboard__task', id: 't1', status: 'in_progress' })
  await $.tool.call({ tool: 'Bash', command: 'ls -la' })

  const done = await $.tool.call({ tool: 'mcp__agent-taskboard__task', id: 't1', status: 'done' })
  expect(String(done.text ?? done.result)).toContain('sin verificación')
})
