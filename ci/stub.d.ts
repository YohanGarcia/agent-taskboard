// A minimal stand-in for the API types Claude Code lays into .claude-plugin/types/ at load time.
// CI cannot load the mod, so `tsc -p ci` checks the project's own code against this instead.
// It type-checks logic.ts, i18n.ts, register.tsx and types/index.d.ts, not calls into the real API.
declare module 'claude-code' {
  export const atom: any
  export const read: any
  export const update: any
  export type EngineInterface = any
  export type Register = any
  export type Timer = { cancel(): void }
}

declare function h(...args: any[]): any

declare namespace JSX {
  interface IntrinsicElements {
    [name: string]: any
  }
  interface Element {}
}
