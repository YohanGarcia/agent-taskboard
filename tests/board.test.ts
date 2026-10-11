import { expect, mock, test } from 'claude-code/testing'

test('el plan crea tareas y una verificación fallida bloquea "done"', { options: { language: 'es' } }, async ($, on) => {
  mock.clock(on, { now: 1_000 })
  mock.store(on)
  on('session.cwd', () => ({ value: '/proyecto' }))
  // Under the plugin: every shell command fails, as a red test run would.
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'FAIL', isError: true as const }))

  const planned = await $.tool.call({ tool: 'mcp__agent-taskboard__plan', goal: 'Probar', tasks: ['Primera', 'Segunda'] })
  expect(String(planned.text ?? planned.result)).toContain('Plan registrado (2 tareas)')

  await $.tool.call({ tool: 'mcp__agent-taskboard__task', id: 't1', status: 'in_progress' })
  await $.tool.call({ tool: 'Bash', command: 'npm run test' })

  // The red test run was attributed to t1, so the board refuses to call it done.
  const blocked = await $.tool.call({ tool: 'mcp__agent-taskboard__task', id: 't1', status: 'done' })
  expect(String(blocked.deny ?? '')).toContain('verificación')

  // A task that never ran a check can still be closed.
  const other = await $.tool.call({ tool: 'mcp__agent-taskboard__task', id: 't2', status: 'failed', note: 'sin dependencias' })
  expect(String(other.text ?? other.result)).toContain('t2')
})
