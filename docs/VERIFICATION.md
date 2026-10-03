# Daily tracking verification — 3 October 2026

## Review regression fixes

The four follow-up findings were split across three sub-agents, then integrated and cross-reviewed:

1. Permanent offline replay conflicts retain each draft with individual retry/discard controls. Unrelated writes continue; dependent changes retain their ordering. Account isolation and failed storage remain enforced.
2. Replaying pending operations over a cached optimistic diary preserves an entry moved into a previously deleted meal, including its recalculated totals. Discard waits for active saves/replay before loading the account snapshot, preventing a just-synced meal from disappearing from the cache.
3. Editing a recipe portion of `100 / 3` grams accepts its full stored precision. Name/meal corrections preserve the exact quantity and nutrition.
4. Deduplication prefers a stored favourite ID. Legacy identical starred copies remain visible, can be unstarred together, and can be starred again without inserting another food definition.

These changes touch `src/api.ts`, `src/App.tsx`, new `src/QueueRecovery.tsx`, `src/DiaryDialogs.tsx`, `src/FoodDialog.tsx`, `src/styles.css`, storage/browser regression tests and operating documentation. The existing database schema and food records are retained.

| Review verification               | Result | Evidence                                                                                                                                                                           |
| --------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain, API and offline queue     | PASS   | `npm test`: 80 tests across 3 files, including 32 storage/replay cases                                                                                                             |
| Complete browser suite            | PASS   | `npm run test:e2e`: 15 scenarios, including 6 new regressions for fractions, duplicate favourites, per-item conflict recovery, discard during replay and cached delete/move reload |
| Compilation and production bundle | PASS   | `npm run build`: TypeScript, Vite, service-worker stamping and Express bundle completed                                                                                            |
| Production offline runtime        | PASS   | `npm run test:pwa`: service-worker offline reload, queued weigh-in persistence and reconnect sync                                                                                  |
| Narrow phone recovery controls    | PASS   | 360 px overflow assertion plus visual inspection of `test-results/queue-recovery-mobile.png`                                                                                       |
| Formatting and patch audit        | PASS   | Prettier checks, `git diff --check`, review of changed source and placeholder sweep; no new real-user data or credentials                                                          |

No review finding remains open. Discard requires a connection to refresh account data; a failed fetch or queue-storage update retains the draft and reports an error. Successful concurrent edits still use write order rather than version-aware merging, as documented in `ARCHITECTURE.md`.

## Acceptance review

1. Manual breakfast/lunch/dinner/snack and custom meal names: implemented, with private label-based foods; no scanning or catalogue dependency.
2. Per-100-g and per-serving quantities: implemented with ratio scaling, whole-kcal/0.1-g display and unrounded stored arithmetic.
3. Item corrections, movement between dates/meals, and item/whole-meal deletion: implemented; totals recompute from remaining entries.
4. Search, recents, favourites, reusable meals and repeat-meal review: implemented using account data.
5. Dashboard consumed/remaining/over values, editable targets, setup estimates: implemented; changes do not rewrite food history.
6. Explicit selected day/timezone, daily/weekly history, current/best streak and completion: implemented; backfills and deletions recompute saved-day runs.
7. Midnight, historical selection and travelling: tested; saved dates stay fixed, today follows local time, open drafts retain their date.
8. Reload/restart persistence, user-scoped queries/updates/export and logout: tested with distinct accounts and SQLite close/reopen.
9. Failed request, blocked storage and malformed data handling: tested; rejected writes retain their form, durable offline entries are distinguished from server saves, unreadable storage is preserved with warnings.
10. Phone layout, keyboard-labelled entry, progress bounds and status/errors: exercised at 360 px and 390 px; full assistive-technology/device audit is future work.
11. Existing manual workout and offline flows: preserved and exercised. Health imports are absent; no permissions are requested, and activity energy remains separate by default.
12. Private friend test: protocol and feedback template prepared in `FRIEND_TEST.md`; no invitations or real friend sessions performed.
13. Existing design/data and scope: SQLite schema and original artwork retained; no real data added to tracked files. AI UI deferred and endpoints disabled; no paid API, social or subscription additions.
14. Goal trends: food/weight history and current-target comparison are available; historical target versions/adherence trends remain P2 work.

## Evidence

| Requirement                                                          | Method                                                    | Status | Evidence                                                                                                                                                                                                             |
| -------------------------------------------------------------------- | --------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nutrition, streak/date arithmetic, persistence and account isolation | `npm test`                                                | PASS   | 63 tests across 3 files; includes database close/reopen, two-user exports/search/goals, malformed/blocked storage and stable retries                                                                                 |
| Application compilation                                              | `npm run build`                                           | PASS   | TypeScript, Vite client, service-worker stamping and bundled Express server completed                                                                                                                                |
| Daily browser acceptance                                             | `npm run test:e2e`                                        | PASS   | All 9 scenarios passed in one complete run, including 150 g→200 g→delete, 1.5→2 servings→delete, backfill/delete, goals, two timezones, midnight, phone failure/retry and logout/account switch                      |
| Offline built application                                            | `npm run test:pwa`                                        | PASS   | Built app loaded offline through service worker; queued weigh-in survived reload and synchronized on reconnect                                                                                                       |
| Formatting and patch hygiene                                         | Prettier check; `git diff --check`; changed-source review | PASS   | Changed files formatted; no whitespace errors, placeholder code, new secrets or user-data files in patch. No separate linter is configured                                                                           |
| Manual daily loop                                                    | Native Firefox UI, synthetic account                      | PASS   | Breakfast/lunch/dinner/snacks reached 1,960 kcal. Breakfast portion corrected 150 g→200 g; reload retained 2,150 kcal, 250 kcal remaining, 92.5 g protein and a 1-day streak. Synthetic account removed after review |
| Phone visual review                                                  | Generated screenshots opened and inspected                | PASS   | `test-results/dashboard-mobile.png` and `test-results/daily-loop-mobile-failed-save.png`; goals prioritized above habit/history, quantity and retry action visible in error review                                   |

Browser runs in this environment use `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/bulkbro-browsers`. Chromium download and localhost socket access required sandbox escalation. Those environment restrictions were resolved; the final checks pass. An earlier browser assertion matched both the closing draft and saved diary row; it now waits for the dialog to close before checking the saved row.

Test databases/accounts and screenshots are ignored by Git. Tests create synthetic accounts; unit/API tests use isolated databases. The development server is at `http://localhost:5188` while `npm run dev` is running.

## Files changed

- Daily experience: `src/App.tsx`, new `src/DiaryDialogs.tsx`, `src/FoodDialog.tsx`, `src/ProfileForm.tsx`, `src/components.tsx`, `src/styles.css`.
- Mathematics and persistence: `shared/domain.ts`, `src/api.ts`, `server/app.ts`. No database migration or recreation.
- Identity/configuration: `.env.example`, `index.html`, `public/manifest.webmanifest`; existing plate/doughnut assets preserved.
- Verification: `tests/domain.test.ts`, `tests/api.test.ts`, new `tests/storage.test.ts`, new `tests/e2e/daily-loop.spec.ts`, adapted `tests/e2e/ai-error.spec.ts`, and repaired built-server path in `tests/pwa-smoke.mjs`.
- Operating/product documentation: `README.md`, `docs/IMPLEMENTATION.md`, `docs/ARCHITECTURE.md`, new `docs/FRIEND_TEST.md`, this report.

## Remaining release work

The core manual loop is ready for the prepared private trial on the local server. Friends require their own accounts on the same server; there is no hosted cloud service. A real 2–3-person phone trial, broader accessibility/native-device checks, deployment and operational restore rehearsal remain. P2 follow-up includes historical goal versions, account recovery and health-device imports. JSON export exists; JSON import is not implemented. See the implementation review for the initial working/broken/partial/absent assessment and detailed operating limits.
