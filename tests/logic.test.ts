import { expect, test } from 'claude-code/testing'

import {
  boardFromEntry,
  branchFromHead,
  checkKindOf,
  clip,
  countsOf,
  durationOf,
  gitDirFromFile,
  historyEntryOf,
  isFinished,
  looksComplex,
  parentOf,
  progressOf,
  tailClip,
  taskIdFrom,
  tasksFrom,
} from '../hooks/logic'
import { EMPTY_BOARD } from '../hooks/logic'

test('checkKindOf reconoce tests, tipos, lint y build', () => {
  expect(checkKindOf('npm run test')).toBe('test')
  expect(checkKindOf('npx vitest run')).toBe('test')
  expect(checkKindOf('tsc -b')).toBe('typecheck')
  expect(checkKindOf('npx eslint .')).toBe('lint')
  expect(checkKindOf('npm run build')).toBe('build')
  expect(checkKindOf('ls -la')).toBe(null)
})

test('checkKindOf reconoce claude plugin test/validate y comandos propios', () => {
  expect(checkKindOf('claude plugin test C:/mods/x')).toBe('test')
  expect(checkKindOf('claude plugin validate .')).toBe('validate')
  expect(checkKindOf('npm run check')).toBe('validate')
  expect(checkKindOf('php artisan test', [])).toBe(null)
  expect(checkKindOf('PHP Artisan Test --filter=Foo', ['artisan test'])).toBe('custom')
})

test('taskIdFrom lee el id de tarea al inicio o entre corchetes', () => {
  expect(taskIdFrom('t2: revisar tipos')).toBe('t2')
  expect(taskIdFrom('[T3] revisar tipos')).toBe('t3')
  expect(taskIdFrom('(t10) algo')).toBe('t10')
  expect(taskIdFrom('revisar tipos', 't4 - corregir')).toBe('t4')
  expect(taskIdFrom('revisar los tests t2 del módulo')).toBe(null)
  expect(taskIdFrom('')).toBe(null)
})

test('looksComplex: solicitudes largas, con acciones o listas', () => {
  expect(looksComplex('qué es un mod?', 240)).toBe(false)
  expect(looksComplex('/taskboard history', 240)).toBe(false)
  expect(looksComplex('crea el login y agrega pruebas', 240)).toBe(true)
  expect(looksComplex('haz esto:\n- uno\n- dos\n- tres', 240)).toBe(true)
  expect(looksComplex('x'.repeat(300), 240)).toBe(false)
  expect(looksComplex(`necesito que implementes esto ${'x'.repeat(300)}`, 240)).toBe(true)
})

test('countsOf y boardFromEntry reabren un plan pasado', () => {
  const entry = {
    goal: 'meta',
    startedAt: 1,
    endedAt: 2,
    durationMs: 1,
    total: 3,
    done: 1,
    failed: 1,
    reason: 'replaced' as const,
    tasks: [
      { title: 'a', status: 'done' as const },
      { title: 'b', status: 'failed' as const },
      { title: 'c', status: 'pending' as const },
    ],
  }
  const board = boardFromEntry(entry, 5_000, status => `antes: ${status}`)
  expect(countsOf(board.tasks)).toEqual({ pending: 2, in_progress: 0, done: 1, failed: 0, blocked: 0 })
  expect(board.createdAt).toBe(5_000)
  expect(board.tasks[1]?.note).toBe('antes: failed')
})

test('tasksFrom acepta textos y objetos y numera t1, t2…', () => {
  const tasks = tasksFrom(['Leer código', { title: 'Escribir pruebas' }, '', 3])
  expect(tasks.map(t => t.id)).toEqual(['t1', 't2'])
  expect(tasks[1]?.title).toBe('Escribir pruebas')
  expect(tasks[0]?.status).toBe('pending')
})

test('progreso, final y duración', () => {
  const tasks = tasksFrom(['a', 'b'])
  expect(progressOf(tasks)).toEqual({ done: 0, total: 2, percent: 0 })
  const done = tasks.map(t => ({ ...t, status: 'done' as const, startedAt: 1000, endedAt: 4000 }))
  expect(progressOf(done).percent).toBe(100)
  expect(isFinished({ ...EMPTY_BOARD, tasks: done })).toBe(true)
  expect(durationOf(65_000)).toBe('1m05s')
  expect(clip('a   b\n c', 10)).toBe('a b c')
})

test('historyEntryOf resume un plan terminado', () => {
  const tasks = tasksFrom(['a', 'b']).map(t => ({ ...t, status: 'done' as const, startedAt: 1000, endedAt: 9000 }))
  const entry = historyEntryOf({ ...EMPTY_BOARD, goal: 'meta', createdAt: 1000, tasks }, 20_000, 'completed')
  expect(entry?.done).toBe(2)
  expect(entry?.durationMs).toBe(8000)
  expect(historyEntryOf(EMPTY_BOARD, 1, 'cleared')).toBe(null)
})

test('branchFromHead lee la rama o un HEAD desacoplado', () => {
  expect(branchFromHead('ref: refs/heads/main\n')).toBe('main')
  expect(branchFromHead('ref: refs/heads/feat/web-cash\r\n')).toBe('feat/web-cash')
  expect(branchFromHead('f995d6a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6\n')).toBe('(f995d6a)')
  expect(branchFromHead('')).toBe(null)
  expect(branchFromHead('basura')).toBe(null)
})

test('gitDirFromFile, parentOf y tailClip', () => {
  expect(gitDirFromFile('gitdir: ../.git/worktrees/x\n')).toBe('../.git/worktrees/x')
  expect(gitDirFromFile('otra cosa')).toBe(null)
  expect(parentOf('E:\\proyectos\\money\\Money-Fast-Web')).toBe('E:\\proyectos\\money')
  expect(parentOf('/home/yo/proyecto')).toBe('/home/yo')
  expect(parentOf('E:\\proyectos')).toBe('E:\\')
  expect(parentOf('/')).toBe(null)
  expect(tailClip('corto', 20)).toBe('corto')
  expect(tailClip('E:\\proyectos\\money\\Money-Fast-Web', 20)).toBe('…\\Money-Fast-Web')
  expect(tailClip('E:\\proyectos\\money\\Money-Fast-Web', 14)).toBe('…oney-Fast-Web')
})
