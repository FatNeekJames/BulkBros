# Architecture and operating limits

## Application

Bulk Bro uses React, strict TypeScript and Vite, with Express behind same-origin `/api` requests. React manages Overview, Food diary, Training, Progress and Settings screens. `shared/domain.ts` contains validation, food scaling, targets, streaks and other derived calculations. The implementation extends this existing codebase and preserves its data model.

SQLite (`node:sqlite`) is the server record store. Development uses a Vite API proxy; a built client can be served directly by Express. The server binds to loopback and requires a reverse proxy for remote access. The `ios/` and `android/` directories contain Capacitor wrappers for the web UI, currently configured by development scripts to reach the running local server. They do not supply cloud hosting or health integrations.

## Data and ownership

`server/db.ts` initializes SQLite with foreign keys and WAL. Tables store users, hashed sessions, profiles, foods, food logs, weights, workouts/exercises/sets, daily activity, saved meals, favourites and legacy analyses. Existing analysis data is retained even though new AI requests are deferred.

Foods in the diary contain nutrition snapshots and date/meal labels. Changing a profile target or reusable definition does not rewrite an old food entry. Current goals are applied when viewing either current or historical days; target history is absent. Diary dates are local-calendar keys, not timestamps that move when a user changes timezone. Current/best streaks are derived from remaining food dates, with no synthetic/sample progress.

Queries and writes use the authenticated owner. Mutating client requests also identify the expected signed-in account; the server rejects a stale draft if another tab has changed the active session. Food edits, deletes, favourites, recents/search, saved meals, exports and workout/activity records remain owner-scoped. Export returns committed server records, including that owner's retained legacy analyses.

Food search in the active UI is private saved/recent food search. Definitions use an explicit 100 g or one-serving nutrition basis. The application keeps arithmetic precision and rounds only the presentation: whole kcal and 0.1 g macros. The correction form accepts full stored precision for fractional recipe portions. Meal review scales from a stable basis and permits corrections before saving. Equivalent legacy food definitions are displayed once, preferring an existing favourite ID; unstar removes all equivalent starred IDs without deleting definitions or creating more copies.

## Authentication

Passwords use salted scrypt hashes. Opaque random session tokens are hashed in SQLite and sent in HttpOnly/SameSite cookies, with Secure cookies in production. Sessions expire after seven days; logout revokes the active session. Mutations check a custom client header and browser origin; validation, body limits and authentication rate limits protect API boundaries. The browser does not store a session token in JavaScript.

Email verification, password recovery, OAuth, MFA, a session/device screen and distributed rate limiting are not implemented. A stable private HTTPS deployment and account recovery are needed before relying on the app beyond a closely managed trial. There is no public profile/social feed.

Development file serving is limited to client source, shared code, public assets and installed browser dependencies. A guard checks canonical file paths before Vite's public/static handlers and module loading, including symlink and raw-file aliases. Default environment/certificate/Git denies remain. Configuring a database inside a client asset directory fails startup; the existing `data/` database is preserved and excluded from serving.

The owned Vite proxy replaces forwarded identity with its socket peer. Express trusts only the immediate loopback proxy and accepts one valid forwarded IP; external reverse proxies must overwrite forwarding headers too. Authentication and unauthenticated traffic are limited by client IP, health has its own budget, and authenticated API limits use the session's verified account. One friend's traffic cannot spend another account's API allowance.

Collection schemas reject excess array lengths before child validation: 50 logs, 40 workout exercises, 30 sets per exercise and 100 recipe ingredients. Endpoints have payload limits suited to those supported sizes, and validation error details are capped. Oversized requests are rejected without persisting partial records.

## Offline and multi-device behavior

A production service worker caches versioned app-shell assets. API responses are not placed in that service-worker cache. The app separately validates and keeps a recent account snapshot and a user-scoped pending queue in localStorage; these records are unencrypted on the device.

Offline food insert/edit/delete, whole-meal deletion, profile/target changes, workouts, weight and daily activity can be queued. Every queued operation is validated. Stable UUIDs make food/workout insertion retries idempotent; queued operations replay in order under their owner's session. Failed replay retains pending records. A malformed queue is preserved with a warning, and inability to store a pending change is a failed save. An online committed write followed by a cache/refresh error is never treated as a new unsaved write.

Permanent replay rejections (400/403/404/409, except an account-change rejection) are retained as individual conflicts. Independent changes continue syncing; later changes to the affected record wait in order. The offline-changes panel identifies each draft and offers retry or discard. Discard fetches current account data before removing only the selected change, preserving the rest of the queue. Authentication, network, rate-limit and server failures retain the queue for a later retry. Optimistic cache replay restores full edited entries by ID, so a meal deletion followed by moving another entry into that meal survives repeated offline reloads.

Food definitions, favourite changes and recipe saves require a connection. Failure to save a new definition does not discard its manual meal draft. Signing out clears the account cache, open drafts and pending records, warning before unsynced changes are discarded. An offline cache can provide access to the last locally cached account while the server is unreachable; it is not an encrypted account vault. Use separate device/browser profiles if devices are shared and sign out when finished.

Each sign-in, sign-out and account deletion starts a new browser account lifetime. Requests, queued replay and UI callbacks retain their originating lifetime and cannot write cache, queue or visible account state after it ends, even when signing back into the same account. A shared browser marker invalidates work and private screens in other open tabs too; each continuation checks that marker rather than relying only on delivery of a storage event. A rejected logout or deletion resumes a new lifetime without discarding unsynced records; successful transitions clear local data and invalidate late responses. If browser storage cannot publish the account change, the app explicitly warns that other tabs could not be notified.

Another device must connect to the same running server and sign in. There is no configured cloud host, background push or automatic merge. Rejected offline changes have per-item recovery controls; concurrent successful edits still resolve by write order, without detecting overwritten versions. Reload fetches committed records. This limitation applies to the native development wrappers too.

## Backups and restore

The default file is `data/bulkbro.sqlite`; `DATABASE_PATH` can change it. The database and any WAL/SHM sidecars contain private records and must remain outside Git. The repository ignores `data/`, environment files, test output and build artifacts. Exports/backups should be kept in a private location outside the repository.

For a consistent backup, use SQLite's backup facility (for example the SQLite CLI `.backup` command) against the configured database path. Do not copy only a live WAL-mode `.sqlite` file: recent transactions may still be in its `-wal` sidecar. A server-wide database backup includes every account, so limit access to the maintainer.

A restore rehearsal should use a separate copy and port, not overwrite the live database:

1. Produce a consistent backup and keep the original database untouched.
2. Stop the target backend and choose a separate empty directory for the restored database, without old `-wal` or `-shm` sidecars.
3. Place the backup there, set `DATABASE_PATH` to it, and start a separate local instance with matching port/origin configuration.
4. Sign in to a disposable test account and check profile/targets, food definitions, yesterday/today, recipes and a restart. Verify a second account remains separate.
5. Only after validating recovery should the maintainer plan an actual live restore. Stop the live backend first and preserve its original database and sidecars together for rollback; never pair a restored database with stale sidecars.

The account JSON export is useful for personal portability and inspection. It has no import UI and is not a replacement for a tested full-database restore. Finish syncing device-only entries before exporting or backing up if those entries need inclusion.

## Activity and target estimates

Personal setup uses the existing estimate calculation and activity multiplier; the UI labels the result as an estimate and allows manual targets. No automatic goal adjustment is made. Label calories are stored directly even when they differ from macro-derived energy. This adult setup does not calculate targets for under-18s.

Manual workout energy remains an estimate. A manually entered all-inclusive active-energy total replaces the workout estimate instead of adding it again. Exercise energy is kept separate from food by default; opting into an energy adjustment is explicit. HealthKit/Health Connect steps and energy are not imported and no health permissions are requested.

## Deferred integrations and next architecture work

AI/photo scanning and coaching are hidden from the daily loop. `/api/ai/meal` and `/api/ai/coach` return `410 AI_DEFERRED` without contacting a provider. Manual logging does not require keys, credits or an external catalogue. Legacy provider modules and barcode lookup may remain for compatibility, but are outside the active UI and current acceptance scope.

Before broad distribution: deploy and operate HTTPS hosting, test backups, add account recovery, introduce versioned schema migrations and target history, and decide a multi-device conflict strategy. SQLite is currently a single-instance choice; a multi-instance deployment also needs reviewed storage and shared rate-limit state. Device integrations and a public/social product should follow a successful [small private trial](FRIEND_TEST.md), not delay the manual daily loop.
