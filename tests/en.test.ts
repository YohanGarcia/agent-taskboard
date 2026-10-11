import { expect, mock, test } from 'claude-code/testing'

import { messages, resolveLang } from '../hooks/i18n'

test('resolveLang: explicit choice wins, auto follows the locale', () => {
  expect(resolveLang('en', 'es-ES')).toBe('en')
  expect(resolveLang('es', 'en-US')).toBe('es')
  expect(resolveLang('auto', 'es-MX')).toBe('es')
  expect(resolveLang('auto', 'en-GB')).toBe('en')
  expect(resolveLang(undefined, '')).toBe('en')
})

test('both languages say the same things', () => {
  const es = messages('es')
  const en = messages('en')
  expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort())
  expect(en.status.done).not.toBe(es.status.done)
})

test('in English the plan tool answers in English', { options: { language: 'en' } }, async ($, on) => {
  mock.clock(on, { now: 1_000 })
  mock.store(on)
  on('session.cwd', () => ({ value: '/project' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'FAIL', isError: true as const }))

  const planned = await $.tool.call({ tool: 'mcp__agent-taskboard__plan', goal: 'Try it', tasks: ['First'] })
  expect(String(planned.text ?? planned.result)).toContain('Plan registered (1 tasks)')

  await $.tool.call({ tool: 'mcp__agent-taskboard__task', id: 't1', status: 'in_progress' })
  await $.tool.call({ tool: 'Bash', command: 'npm run test' })

  const blocked = await $.tool.call({ tool: 'mcp__agent-taskboard__task', id: 't1', status: 'done' })
  expect(String(blocked.deny ?? '')).toContain('cannot be marked done')
})

test('in English the panel draws English labels', { options: { language: 'en' } }, async ($, on) => {
  mock.clock(on, { now: 1_000 })
  mock.store(on)
  on('session.cwd', () => ({ value: '/project' }))

  const pane = await $.ui.mount({
    plugin: 'agent-taskboard',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'agent-taskboard',
    props: { bodyColumns: 52 },
    viewport: { columns: 60, rows: 24 },
  } as never)

  expect(await pane.find({ text: /TASK BOARD/ })).toBeDefined()
  expect(await pane.find({ text: /No active plan/ })).toBeDefined()
  await pane.unmount()
})
