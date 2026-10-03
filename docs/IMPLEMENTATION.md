# Daily tracking implementation review

Bulk Bro — **Build a stronger you** — was an existing React/TypeScript/Vite app with an Express API, SQLite database, authenticated accounts, Capacitor wrappers, and unit/API/browser/PWA checks. The work extends that app and keeps its green interface and plate/doughnut brand direction. It does not replace the database or seed user activity.

The review traced registration/setup, manual meal entry, persistence/reload, and the existing nutrition, training, progress and settings screens. These screens use in-app React navigation, with `/api` endpoints handled by Express. Development/build commands are in the [README](../README.md).

## Requested feature assessment

“Before” describes the inspected source at the start of this pass. “Now” describes the implemented scope; test evidence is recorded separately after final validation.

| Requested feature                                  | Before                                                                                                                    | Now                                                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Manual meal logging and standard/custom meal names | Working, with several competing scanning/search entry points                                                              | Working; manual-first source picker and compact portion review                                                                          |
| Explicit nutrition per 100 g or per serving        | Partial; generic amount/unit inputs did not clearly distinguish label basis from amount eaten                             | Working; explicit basis, quantity and conversion examples; no assumed grams per serving                                                 |
| Private custom food definitions                    | Partial; separate save action was easy to skip                                                                            | Working; created foods save to the account when connected; failed library save retains the portion draft                                |
| Food search, recents and favourites                | Partial; search depended on an external catalogue and could stall                                                         | Working within private saved foods/recent portions; favourites toggle; no external search required                                      |
| Reusable meals and recipes                         | Working                                                                                                                   | Preserved; one-portion review plus repeats of previous date/meal groups                                                                 |
| Correct already saved portions/nutrition           | Absent for persisted food entries                                                                                         | Working; owner-scoped updates recalculate diary/dashboard totals                                                                        |
| Delete food item or complete meal                  | Partial; individual delete existed, whole-meal correction was incomplete                                                  | Working; individual and whole-meal removal recalculate totals                                                                           |
| Calories/macros against editable targets           | Working but incomplete remaining/over-target detail                                                                       | Working; units, numerical consumed/remaining/over values and clamped progress graphics                                                  |
| Age/body measurements/activity/goal setup          | Working                                                                                                                   | Preserved; estimated targets labelled and editable manual targets available                                                             |
| Selected day and historical navigation             | Partial; date navigation existed, timezone and rollover rules were unclear                                                | Working; selected date, device timezone, historical/current-target explanation and seven-day diary                                      |
| Current and best meal streak, day completion       | Partial; current streak existed, best/completion and correction rules incomplete                                          | Working; current/best derived from saved dates, explicit completion, no seeded activity                                                 |
| Durable accounts/database                          | Working                                                                                                                   | Preserved; existing private SQLite records survive reload/restart                                                                       |
| Owner separation and account lifecycle checks      | Partial; basic query scoping existed, correction/favourite edge cases and stale-client writes needed coverage             | Hardened owner checks and expected-account guards; separate-user tests cover records, targets, favourites/search, export and logout     |
| Honest failed saves/offline storage                | Broken in edge cases; malformed storage could look empty and committed writes could be queued again after refresh failure | Validated cache/queue; blocked persistence prevents a false success; committed writes are not requeued for a failed refresh             |
| JSON export / restore                              | Export working; restore absent                                                                                            | Account export preserved; operational SQLite backup/restore documented; no JSON import UI                                               |
| Phone and keyboard usability                       | Partial; usable responsive base, tiny food details and crowded workflow                                                   | Focused quantity review, labelled controls, reduced picker clutter and improved phone controls; full assistive-technology audit remains |
| Daily/weekly history and goal trends               | Partial; weekly calories/bodyweight chart existed                                                                         | Seven-day food totals added; bodyweight trends preserved; historical target versions/trends remain absent                               |
| Achievements                                       | Working basic achievements, streak milestone used current streak only                                                     | Retained; meal milestones use actual logged dates/best run so normal missed days do not erase earned history                            |
| Manual workouts/steps and energy separation        | Working manual entry; device import absent                                                                                | Preserved; manual workout/browser coverage, distinct energy, all-inclusive active energy replaces workout estimate                      |
| Private 2–3-friend trial                           | Absent                                                                                                                    | Prepared protocol and feedback template; no invitations sent or real participants tested                                                |
| AI scanning/coaching, social feed, subscriptions   | AI paths existed; social/payments absent                                                                                  | AI UI removed/deferred, AI endpoints return `410 AI_DEFERRED` without a provider call; no social or subscription additions              |

## Nutrition and correction policy

Foods contain their own calorie/protein/carbohydrate/fat nutrition snapshot. New definitions use either 100 g or one label serving as their basis. Quantity scaling uses `amount / basis amount`. Thus 200 kcal per 100 g gives 300 kcal for 150 g and 400 kcal for 200 g; 200 kcal per serving gives 300 kcal for 1.5 servings. Protein, carbohydrate, fat and optional fibre use the same ratio.

Calories display to the nearest kcal; macros display to 0.1 g. Supported portion inputs start at 0.1. The correction form accepts full stored fractional precision, including recipe portions such as 100 g divided by three; changing the name, meal or date does not round the saved nutrition. Arithmetic retains unrounded values and scales from a stable nutrition basis while reviewing a draft. Label calories are retained even if 4/4/9 macro math differs because of label precision or fibre. A serving does not automatically convert to grams: that would require an explicit known serving weight, which this release does not collect.

Adding a draft does not count it towards the day until **Log meal** succeeds on the server or is durably queued on this device. A food-definition save is distinguished from logging its portion. Empty/invalid quantities prevent logging. Corrections keep the food's saved identity and update the selected date/meal and nutrition; removing the last item leaves an honest empty meal/day. Retry IDs are stable so a lost response does not create a second food log.

Changing a target updates comparison/progress, not any saved food's nutrition. Historical screens explicitly compare historical foods against **current targets**. Target history and historical adherence against the target in effect at the time are not implemented.

## Calendar and streak policy

- A completed day has at least one saved food in a meal on that date. Calorie or macro target attainment is irrelevant.
- Current streak ends today when today contains food, otherwise yesterday. This gives an unfinished today time to be logged. A missed yesterday breaks the current run.
- Best streak is the longest consecutive run among remaining logged dates up to today. Duplicate items on one day count once. Future-dated entries never inflate current/best streak or meal milestones.
- Backfilling a gap can connect a run. Deleting a day's only food removes that day and recalculates both current and best streak. Food milestones therefore reflect remaining records rather than a separate permanent badge counter.
- Calendar dates use `YYYY-MM-DD`. Day offsets use calendar arithmetic independent of DST, and “today” uses the device's current timezone. The displayed timezone is refreshed while the app is open and when it regains focus.
- Existing entry dates stay as logged when travelling or changing device timezone. Only “today” and the current-run anchor change; no diary is silently redistributed between dates.
- A view of today follows the next local day at midnight when no entry/edit dialog is open. An open draft keeps its chosen date. A historical view stays pinned. Use **Back to today** to return after reviewing a historical date or keeping a draft across midnight.

Streak values are derived from the account's food logs after reload. There is no separately incremented counter, sample history or target-dependent streak inflation.

## Persistence and account boundaries

The server is the durable record store, not browser localStorage. The default SQLite file is `data/bulkbro.sqlite`, with foreign keys and WAL enabled. Users have independent profiles, food definitions, diary entries, saved meals, favourites, activity and training. Authenticated queries and updates use the server session's owner, and mutating client calls send the expected account so another tab changing sessions cannot silently write a draft into a different account.

The device cache/queue is unencrypted. Supported offline food changes, target edits, workouts, bodyweight and activity updates are labelled pending until synced. Definitions, favourites and reusable recipes need a connection. Cached/offline records are validated; malformed storage is preserved with a warning rather than treated as an empty diary. If a queued write cannot be stored, the form remains with an error and no success toast. A successful server write followed by a failed refresh is reported as saved with stale totals, rather than retried as a new write.

Signing out revokes the active server session and clears cached data, open account drafts and queued changes; unsynced entries require confirmation before discarding. Sync/export concern the active account. Export contains only committed server records, so finish syncing before exporting. There is no JSON import screen. [SQLite backup/restore](ARCHITECTURE.md#backups-and-restore) protects server data independently.

Two devices need the same running server and their own sign-in. There is no hosted cloud backend or live push synchronization. Permanent offline replay rejections appear in a per-item recovery panel: retry or discard a selected local change while unrelated entries continue saving. Changes dependent on an unresolved record remain queued. Discard requires a fresh account snapshot and retains every other pending change. Reload fetches current server state; concurrent successful edits still resolve in write order, without version comparison or automatic merging.

## Remaining work

Core manual logging is implemented for this local account-backed release. Remaining P1 release verification is the prepared human phone trial and broader keyboard/screen-reader/large-text/device coverage. Hosting and an operational backup/restore rehearsal are needed before friends rely on a remotely available server; native packaging alone does not provide that server.

P2 and operational follow-up:

- Run [the 2–3-friend protocol](FRIEND_TEST.md), fix repeated confusion, then rerun the affected daily loop. No real friend trial has happened yet.
- Deploy a private HTTPS server with backups, restore verification and monitoring; introduce schema migrations before structural database changes. The current runtime is a single server instance.
- Add account recovery/email verification and a session/device management flow before wider distribution. These are absent today.
- Add target history if users need meaningful long-term goal/adherence trends; current history deliberately shows current-target comparison.
- Add JSON import only with reviewed ownership, validation and duplicate-handling behavior.
- Implement HealthKit/Health Connect only after the daily loop trial, with permissions, revocation and activity de-duplication. No import permission is requested now.
- Assess concurrent edits and encrypted native storage before promising robust cross-device offline merging.

AI/photo scanning, AI coaching, huge food catalogues, social posting and subscriptions remain outside this pass. Existing legacy AI/analysis storage is preserved for compatibility; the active AI endpoints do not call a provider.
