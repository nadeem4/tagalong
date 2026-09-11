# Phase 0: Setup — acceptance

Run on **2026-09-11**, Windows 11 Home 10.0.26200, from a clean `C:\ai_pet`.

## Toolchain

| Requirement                  | Result                                |
| ---------------------------- | ------------------------------------- |
| Node.js 22 LTS               | ✅ v22.17.0                           |
| pnpm 9 or newer              | ✅ 10.34.5                            |
| Git                          | ✅ 2.49.0.windows.1                   |
| Python 3                     | ✅ 3.14.6                             |
| VS Build Tools, C++ workload | ❌ **not installed** — see Open items |

`corepack enable` failed with `EPERM` writing to `C:\Program Files\nodejs`. pnpm was installed with
`npm install -g pnpm@10` into the user-level npm prefix instead, which needs no elevation.

## Acceptance checklist

- [x] `pnpm install` succeeds — 180 packages, 4.9s
- [x] `pnpm lint` passes — eslint 10.10.0, flat config, 0 problems
- [x] `pnpm format:check` passes — prettier 3.9.6
- [x] `pnpm typecheck` passes — `tsc -b` over the project-reference graph
- [x] `pnpm test` passes — vitest 5.0.0, 3 files, 8 tests
- [x] `pnpm build` passes — all 5 workspace projects emit to `dist/`
- [x] README explains layout, commands, conventions, privacy, and the no-computer-control rule
- [x] `docs/architecture.md` exists with both Mermaid diagrams in the black-and-white theme
- [x] `.env.example` lists every variable used anywhere in the repo
- [x] CI is green on the first push — run 34658763363, all six steps passed on windows-latest

## Purity guard

Task 5 requires ESLint to block `electron` and `react` inside the pure packages. Verified by linting
throwaway probe files, which produced exactly the expected 6 errors before being deleted:

```
packages/core/src/__purity_probe.ts
  1:1   error  'electron' import is restricted from being used         no-restricted-imports
  2:1   error  'react' import is restricted from being used            no-restricted-imports
  3:35  error  Unexpected use of 'window'                              no-restricted-globals
  3:43  error  Unexpected use of 'document'                            no-restricted-globals

packages/protocol/src/__purity_probe.ts
  1:1   error  'node:fs/promises' import is restricted by a pattern    no-restricted-imports
  2:1   error  '@tagalong/core' import is restricted by a pattern      no-restricted-imports
```

## Deviations from the phase page

| Phase page said                        | What shipped                       | Why                                                                                                              |
| -------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| TypeScript 5                           | TypeScript 5.9.3                   | TypeScript 7.0.2 is available but the plan pins the 5 line; `typescript-eslint` supports `<6.1.0`.               |
| `vitest.workspace.ts`                  | `vitest.config.ts` with `projects` | Vitest 5 replaced the workspace file with `test.projects`.                                                       |
| pnpm via `corepack`                    | pnpm via `npm install -g`          | `corepack enable` needs elevation on this machine.                                                               |
| React 19 + Tailwind 4 in `packages/ui` | Placeholder TypeScript only        | Never overengineer: Phase 1 task 21 is what introduces components. The react-hooks lint config is already wired. |

## Open items for the human

1. **Install Visual Studio Build Tools** with the _Desktop development with C++_ workload before
   Phase 1 task 13 (`better-sqlite3`). Needs elevation, so it cannot be automated from here.
2. **Create API keys** (Tagalong Tasks #2) and put them in `.env.local`:
   `ANTHROPIC_API_KEY` is needed from Phase 1; `ELEVENLABS_API_KEY` and `OPENAI_API_KEY` from Phase 3.
   `.env.local` is git-ignored and `.env.example` already lists the same names.
