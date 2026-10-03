# Bulk Bro

**Build a stronger you.** A private calorie and macro tracker for a small group of friends, keeping the existing plate/doughnut artwork and dark green interface. Open your goals, log food manually, review progress, and return tomorrow.

This existing project has a React/TypeScript client, an Express API, SQLite storage, and separate email/password accounts. It is a working local web app with Capacitor phone projects, not an already hosted service. Photo scanning and AI coaching are deferred; manual tracking needs no provider key, credits, or external food catalogue.

## Run locally

Requires **Node.js 24.12+** (`node:sqlite`).

```sh
npm ci
npm run dev
```

Open **http://localhost:5188**. The API listens on loopback port **3001**. Register an account and complete setup; the diary starts empty. There is no demo account or seeded streak. Keep the terminal running while using the app.

Configuration lives in `.env.example`; `.env` and `.env.local` are supported and ignored by Git. The default database is `data/bulkbro.sqlite`. Set `DATABASE_PATH` to use a separate database. No AI configuration is needed for this release.

Keep the database and backups outside `src/`, `shared/`, `public/` and `node_modules/`. The preview serves only client code/assets and rejects private files, including database sidecars and symlink aliases. Existing `data/` records stay in place; no migration is required.

For a production-style local build:

```sh
npm run build
APP_ORIGIN=http://localhost:3001 npm start
```

Open **http://localhost:3001**. Remote hosting requires a stable HTTPS origin, a reverse proxy for the loopback server, `NODE_ENV=production`, and `APP_ORIGIN` set to that exact origin. A hosted backend, account recovery and operational backup process have not been deployed in this pass. Do not expose the Vite development server publicly.

The reverse proxy must connect over loopback and **replace** `X-Forwarded-For` with the actual client IP, removing incoming `Forwarded` metadata. The API trusts only that single loopback hop. The supplied Vite proxy already does this; an external proxy must enforce the same rule so callers cannot choose their rate-limit identity.

## Everyday use

- Set editable daily calorie, protein, carbohydrate and fat targets. Setup can suggest an estimate from age, height, weight, activity and gain/maintain/lose preference.
- Choose breakfast, lunch, dinner, snacks or your own meal name. Search your private foods, pick a recent/favourite food, repeat a meal, or create a food from its nutrition label.
- Define nutrition per **100 g** or **one serving**, then enter the amount eaten. `150 g` uses `1.5 ×` the per-100-g values; `2 servings` uses `2 ×` the per-serving values. A serving is the label's serving, not an assumed gram weight.
- Review quantities and save. Calories display as whole kcal and macros to 0.1 g; calculations retain their precision. Edit or delete an item, or delete a whole meal, from the diary to correct totals.
- Review consumed, remaining or over-target values, selected-day totals, a seven-day diary, current/best streak and activity-based achievements. Historical foods stay unchanged when goals change; historical comparisons use current targets.
- Save reusable meals, record bodyweight and manually log workouts, steps, active energy and water. Exercise energy stays separate by default. There is no connected step import or health permission request.

A streak means consecutive local-calendar dates with at least one saved food in a meal. Yesterday's run remains current while today is unfinished. Backfilling can connect a run; deleting the only food on a date removes that date from both current and best streak calculations. The displayed timezone follows the device. Existing diary dates never move when the timezone changes. See [the precise rules and scope assessment](docs/IMPLEMENTATION.md).

## Accounts, persistence and offline use

Meals, food definitions, targets, recipes and workouts are private records in the running server's SQLite database and survive a restart. Streaks are recalculated from those records. Each friend needs a separate account. Other devices can see an account's server records only when they connect to **the same running server** and sign in; there is no configured cloud service or live cross-device push. Reload to fetch another device's changes.

The browser keeps an unencrypted cache and a user-scoped queue for supported offline changes. Pending entries are shown as saved **on this device**, not synced. Food entries, corrections/deletions, targets, workouts, weigh-ins and activity can queue; saving food definitions, favourites and reusable recipes requires a connection. If a new definition cannot save, its meal draft remains available to log. Blocked or malformed browser storage produces an explicit warning; an offline write that cannot persist keeps the form open without a success claim.

Signing out revokes the session and clears the device cache and pending entries. If entries are unsynced, the app asks before discarding them. Reconnect and finish syncing first to retain them. Production builds cache the app shell for offline reopening; the development server does not prove installable offline behavior.

Use **Settings → Export my data** for an account-scoped JSON export after syncing. It contains server records only. JSON re-import is not implemented. For server disaster recovery, back up and restore SQLite as described in [architecture](docs/ARCHITECTURE.md); an export is not a replacement for that backup. Keep health records, exports and backups out of source control.

## Phone preview and native projects

To try a phone on the same trusted Wi-Fi/network, keep `npm run dev` running, then run this in a second terminal:

```sh
npm run dev:mobile
```

It prints a private-network URL on port **5191** and creates `test-results/mobile-qr.png`. Open that URL on the phone. This is a local HTTP development preview; installable offline features require localhost or a secure origin. The phone loses server access when the computer or backend stops.

The same React UI is wrapped with Capacitor in `ios/` and `android/`. These projects are development wrappers, not separately hosted or store-ready apps. They need the running backend and LAN preview. A standalone release needs a deployed HTTPS API and production API configuration.

**iPhone:** On a Mac with Xcode and a connected iPhone, run `npm run mobile:ios:dev` while both servers run. Open `ios/App/App.xcodeproj`, choose a signing team and the device, then press Run. If the servers are on another computer, set `BULKBRO_MOBILE_DEV_URL` to its LAN URL before running the script. Local-network transport exceptions are for development. iOS signing requires Xcode on macOS.

**Android:** With Android Studio, SDK 36 and JDK 21, run `npm run mobile:android:dev` while both servers run. It creates `artifacts/bulkbro-android-dev.apk`. `npm run mobile:android:share` serves a download page on port **5192** and writes `test-results/android-install-qr.png`. Install the APK using the phone's normal sideload permission flow. This is a local debug build, not a Play Store release.

HealthKit, Health Connect, native scanning and push notifications are not connected. No paid API is needed by either wrapper's manual logging flow.

## Checks and private trial

```sh
npm run check
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:pwa
```

Unit/API checks use isolated databases. Browser tests create test accounts against the configured local server, and screenshots go to the ignored `test-results/` directory. These are commands to reproduce validation, not a claim that every deployment or native device has been tested.

See [implementation status](docs/IMPLEMENTATION.md), [architecture and backups](docs/ARCHITECTURE.md), and the [prepared 2–3-friend trial](docs/FRIEND_TEST.md). The friend protocol has not been sent to anyone or completed with real participants.
