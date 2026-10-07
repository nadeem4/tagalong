# Phase 8: Roles — acceptance

Run on **2026-10-07** on Windows 11 (Node 22.17.0, pnpm 10.34.5), on branch
`feat/roles-notice-and-wizard`, rebased on `main` at `0a07a3a` (PR #34).

Marks: `[x]` verified in this run, `[~]` partly verified — the rest of that item is under
_Needs a human run_, `[ ]` not verified here.

No model provider was called to produce this record. Every unit test ran on the fake provider or on
pure functions, and the Electron suites ran with `TAGALONG_FAKE_PROVIDERS=1` on throwaway profiles.

## What Phase 8 delivered

| PR  | What                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #29 | The role library: five role files in `packages/core/roles/`, a generator to `library.generated.ts`, and the tier table behind `recommendedModel`.                                                        |
| #30 | One tools module: the `Tool` shape, `ToolRegistry`, and a single dispatch for all 12 built-in tools.                                                                                                     |
| #31 | The Crew Office window: the crew as pixel characters, a party list, the meetings panel.                                                                                                                  |
| #32 | Pets carry a role (`roleId`, `roleVersion`, `toolGrants`, `notes`); migration 5 upgrades stored pets; a turn's tools and instructions come from the role; directory cards in `ask_pet`.                  |
| #33 | Roles over RPC (`roles.list`, `roles.recommendModel`); `pets.upsert` refuses an unknown role; the office labels each pet with its role name in its role ink.                                             |
| #34 | Settings split per section and restyled, with the pet role editor: role picker, recommended model, tool switches and the directory card preview.                                                         |
| —   | This branch: the one-time "Your crew has roles now" notice for upgraded installs (migration 6, `notices.rolesUpgrade`, `notices.dismiss`, the office dialog), and roles in the setup wizard's crew step. |

## Checks

| Command                                                      | Result                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `pnpm install`                                               | ✅ exit 0                                                                 |
| `pnpm -r --filter "./packages/**" build`                     | ✅ protocol, core, ui                                                     |
| `pnpm --filter @tagalong/desktop build`                      | ✅ main, preload and every renderer page                                  |
| `pnpm lint`                                                  | ✅ exit 0                                                                 |
| `pnpm format:check`                                          | ✅ exit 0                                                                 |
| `pnpm typecheck`                                             | ✅ exit 0                                                                 |
| `pnpm test`                                                  | ✅ 125 files, 1,555 tests passed, exit 0                                  |
| `cd apps/desktop && TAGALONG_FAKE_PROVIDERS=1 pnpm test:e2e` | ✅ 18 Electron tests passed (smoke 12, hotkey recovery 4, roles notice 2) |

`main` before this branch (`0a07a3a`) stood at 122 files and 1,523 tests, and 15 Electron tests. This
branch adds 3 test files, 32 unit tests and 3 Electron tests.

New tests:

- `packages/protocol/src/notices.test.ts` — the notice and the two methods' schemas.
- `packages/core/src/pets/roles-notice.test.ts` — migration 6 records each upgraded pet, its role,
  `keptNotes` and `madeByYou`; a fresh install records nothing; dismissing is for good.
- `packages/core/src/memory/db.test.ts` — migration 6 runs after 5 on a pre-roles database; a fresh
  database has no notice.
- `packages/core/src/engine.test.ts` — `notices.rolesUpgrade` and `notices.dismiss` over the real
  socket, on a fresh and on a pre-roles data dir.
- `packages/ui/src/office/roles-notice.test.tsx` — the dialog's rows, inks, focus on Got it, the
  disclosure, and dismissal by Got it, Escape and Review my crew.
- `apps/desktop/src/renderer/src/onboarding-flow.test.ts` — `recommendationsFor`,
  `withRecommendations`, `isRecommended`.
- `apps/desktop/e2e/roles-notice.spec.ts` — a real profile rewound to before roles opens the office on
  the notice at launch; Got it dismisses it; a restart stays quiet.
- `apps/desktop/e2e/smoke.spec.ts` — the wizard's crew step shows each role and prefills Ink's
  recommended model with a Recommended chip that goes away when the model is edited.

The smoke suite now launches on a fresh temporary profile (`--user-data-dir`), so a developer's own
crew, or a pending notice, cannot change what it sees.

## Phase acceptance script

- [x] **An upgraded install sees the roles notice once.** `roles-notice.spec.ts`: the office opens by
      itself at launch with "Your crew has roles now" and a row per pet (Ink: "Your edited persona is
      kept as notes."; Scout: "Default persona replaced by the role."; Nova, a pet the user made:
      "pick a better role any time"); Got it closes it, and after a restart nothing opens.
- [x] **A fresh install never sees it.** `roles-notice.test.ts`, `db.test.ts`, `engine.test.ts`, and the
      smoke suite's first test, which still sees only the avatar and the panel on a fresh profile.
- [x] **The wizard names each pet's role and recommends a model.** The smoke test for the
      wizard's crew step: each role is shown, and Ink's recommended model is prefilled.
- [x] **Roles decide tools and instructions; Settings edits the role.** Unit-tested in #32 to #34
      (`tools/registry.test.ts`, `conversation/prompt-assembler.test.ts`, `settings/pet-settings.test.tsx`) and in the Settings smoke test.
- [~] **A pet consults a teammate by role.** The directory cards and the `ask_pet` routing are unit
  tested on the fake provider; a real model choosing a teammate needs a human run.

## Needs a human run

Run these locally. None were observed in this run.

- [ ] **Upgrade an existing install and see the notice.** Start from a build before roles (for example
      commit `eca2ac3`) with its own profile, edit one pet's persona and add a pet of your own, quit,
      then start this build on the same profile. The Crew Office opens on "Your crew has roles now",
      with your edited pet reading "Your edited persona is kept as notes." and your own pet "A pet you
      made…". **What changed?** opens three lines. **Review my crew** opens Settings; restart and
      check the notice does not come back. (An install already on migration 5 from a development
      build also shows the notice once, since migration 6 records what migration 5 left.)
- [ ] **Change a pet's role in Settings and see its tools change.** Pick Ink in Settings, switch its role
      from Writer to Researcher, and check the tool switches and the directory card change; ask Ink
      something that needs a tool only the new role has.
- [ ] **Ask a pet something and see it consult a teammate by role.** With a real provider, ask Scout a
      question about a stack trace; it should hand the question to Bolt, the Backend engineer, through
      `ask_pet`.
- [ ] **Run the wizard with a real key.** Paste a real key, check each pet shows its role, a pet moving
      to that provider starts on its role's model with **Recommended**, and editing the model removes
      the chip.
- [ ] **Look at the notice and the wizard at your screen's scale.** Screenshots from the Electron run
      were reviewed at 1280x800 only.
