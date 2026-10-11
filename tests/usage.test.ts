import { expect, mock, test } from 'claude-code/testing'

import {
  EMPTY_BOARD,
  addUsage,
  billableOf,
  emptyUsage,
  estimateTokens,
  fmtTokens,
  fmtUsd,
  historyEntryOf,
  markCost,
  normalizeTask,
  settleCost,
  sumUsage,
  tasksFrom,
} from '../hooks/logic'

test('addUsage suma cada petición y billableOf deja fuera la caché leída', () => {
  const one = addUsage(undefined, {
    input_tokens: 100,
    output_tokens: 40,
    cache_creation_input_tokens: 500,
    cache_read_input_tokens: 9000,
  })
  const two = addUsage(one, { input_tokens: 10, output_tokens: 5 })

  expect(two).toEqual({ input: 110, output: 45, cacheRead: 9000, cacheWrite: 500, steps: 2 })
  expect(billableOf(two)).toBe(110 + 500 + 45)
  expect(addUsage(two, null)).toEqual(two)
  expect(sumUsage(two, one).steps).toBe(3)
  expect(billableOf(undefined)).toBe(0)
})

test('fmtTokens, fmtUsd y estimateTokens', () => {
  expect(fmtTokens(842)).toBe('842')
  expect(fmtTokens(1234)).toBe('1.2k')
  expect(fmtTokens(48_000)).toBe('48k')
  expect(fmtTokens(1_300_000)).toBe('1.3M')
  expect(fmtUsd(0.043)).toBe('$0.04')
  expect(fmtUsd(12.34)).toBe('$12.3')
  expect(estimateTokens('x'.repeat(400))).toBe(100)
})

test('el costo de una tarea se suma por tramos en marcha', () => {
  const [task] = tasksFrom(['a'])
  if (!task) throw new Error('sin tarea')

  const running = markCost(task, 1.0)
  expect(running.costMark).toBe(1.0)

  const paused = settleCost(running, 1.25)
  expect(Math.round(paused.cost * 100)).toBe(25)
  expect(paused.costMark).toBe(null)

  const again = settleCost(markCost(paused, 2.0), 2.1)
  expect(Math.round(again.cost * 100)).toBe(35)
  // A host with no cost ledger adds nothing and never goes negative.
  expect(settleCost(markCost(task, null), 5).cost).toBe(0)
  expect(settleCost(markCost(task, 3), 2).cost).toBe(0)
})

test('normalizeTask completa una tarea guardada por una versión anterior', () => {
  const [task] = tasksFrom(['a'])
  const old = { ...task, usage: undefined, agentUsage: undefined, cost: undefined, costMark: undefined } as never
  const fixed = normalizeTask(old)

  expect(fixed.usage).toEqual(emptyUsage())
  expect(fixed.cost).toBe(0)
  expect(fixed.costMark).toBe(null)
})

test('un plan terminado guarda sus tokens y su costo en el historial', () => {
  const tasks = tasksFrom(['a', 'b']).map((t, i) => ({
    ...t,
    status: 'done' as const,
    startedAt: 1000,
    endedAt: 9000,
    usage: addUsage(undefined, { input_tokens: 100 * (i + 1), output_tokens: 50 }),
    cost: 0.1,
  }))
  const entry = historyEntryOf({ ...EMPTY_BOARD, goal: 'meta', createdAt: 1000, tasks }, 20_000, 'completed')

  expect(entry?.tokens).toBe(100 + 50 + 200 + 50)
  expect(Math.round((entry?.cost ?? 0) * 100)).toBe(20)
})

test('/taskboard stats muestra tokens por tarea y el costo propio del mod', { options: { language: 'es' } }, async ($, on) => {
  mock.clock(on, { now: 1_000 })
  mock.store(on)
  on('session.cwd', () => ({ value: '/proyecto' }))

  await $.tool.call({ tool: 'mcp__agent-taskboard__plan', goal: 'Medir', tasks: ['Primera', 'Segunda'] })
  const stats = await $.command.run({ command: 'taskboard', args: 'stats' })
  const text = String((stats as { text?: unknown }).text ?? '')

  expect(text).toContain('Tokens y costo del plan: Medir')
  expect(text).toContain('t1 Primera')
  expect(text).toContain('Total:')
  expect(text).toContain('Costo propio de agent-taskboard')
})
