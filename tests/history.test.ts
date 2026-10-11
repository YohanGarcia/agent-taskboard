import { expect, mock, test } from 'claude-code/testing'

import { dropEntry } from '../hooks/logic'
import type { HistoryEntry } from '../types'

const entry = (goal: string, startedAt: number): HistoryEntry => ({
  goal,
  startedAt,
  endedAt: startedAt + 1,
  durationMs: 1,
  total: 1,
  done: 0,
  failed: 0,
  reason: 'replaced',
  tasks: [{ title: 'a', status: 'pending' }],
})

test('dropEntry cuenta desde la más reciente y rechaza números fuera de rango', () => {
  const list = [entry('vieja', 1), entry('media', 2), entry('nueva', 3)]

  expect(dropEntry(list, 1)?.dropped.goal).toBe('nueva')
  expect(dropEntry(list, 3)?.rest.map(e => e.goal)).toEqual(['media', 'nueva'])
  expect(dropEntry(list, 0)).toBe(null)
  expect(dropEntry(list, 4)).toBe(null)
  expect(dropEntry(list, 1.5)).toBe(null)
  expect(dropEntry([], 1)).toBe(null)
})

test('/taskboard history drop y clear borran del historial', { options: { language: 'es' } }, async ($, on) => {
  mock.clock(on, { now: 1_000 })
  mock.store(on)
  on('session.cwd', () => ({ value: '/proyecto' }))

  for (const goal of ['Primero', 'Segundo', 'Tercero']) {
    await $.tool.call({ tool: 'mcp__agent-taskboard__plan', goal, tasks: ['a', 'b'] })
    await $.command.run({ command: 'taskboard', args: 'clear' })
  }

  const run = async (args: string) => String((await $.command.run({ command: 'taskboard', args })).text)

  const listed = await run('history')
  expect(listed).toContain('1.')
  expect(listed.indexOf('Tercero')).toBeLessThan(listed.indexOf('Primero'))

  expect(await run('history drop 1')).toContain('Tercero')
  const after = await run('history')
  expect(after).not.toContain('Tercero')
  expect(after).toContain('Segundo')

  expect(await run('history drop 9')).toContain('No hay una entrada 9')
  expect(await run('history nada')).toContain('Uso:')

  expect(await run('history clear')).toContain('2 plan(es)')
  expect(await run('history')).toContain('vacío')
})
