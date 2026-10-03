# Architecture decisions

## Client and deployment

React + strict TypeScript + Vite, with a responsive installable web app. This makes the first usable release runnable on the provided Windows workspace and mobile browsers without pretending that native health APIs are available in a web page. The brief suggested React Native/Expo or Flutter; **native iOS/Android clients have not been implemented**. Keep `shared/domain.ts` portable so a native client can reuse validation and arithmetic against the same API. Use a native secure credential store if adding token-based mobile authentication later.

Express is the structured TypeScript backend. The same origin serves the API and built client, avoiding token storage in browser JavaScript and reducing cross-origin complexity. Development requests use a Vite proxy. All external API calls and the OpenAI key stay server-side.

## Storage

SQLite in WAL mode is used for the runnable single-instance MVP; `server/db.ts` contains version-one DDL. Users, profiles, sessions, foods, food logs, weights, workouts, exercises, sets, activity, saved meals, favourites and AI analyses have separate tables, owner keys and foreign-key relationships. Workout sets are normalized. Immutable nutrition snapshots and extensible profile/recipe structures use validated JSON payloads, so changing a custom food does not rewrite historical nutrition.

This is **not the requested PostgreSQL/Prisma production design**. Before multi-instance production: introduce numbered migrations, normalize recipe ingredients and target history, port data access to PostgreSQL, add indexes/load tests and retention jobs, and move rate-limit state to a shared store. Social models should be added with a default-private visibility policy when implementing social; empty pretend endpoints are intentionally absent.

Back up the database with SQLite's online backup API or while the process is stopped; copying only the database file during active WAL writes can lose data. Do not commit `data/`, logs or backups. Test restoring a backup before hosting real user accounts.

## Authentication and isolation

Passwords are scrypt-derived using a unique random salt; comparisons are constant-time. Random 256-bit session tokens are stored only in HttpOnly/SameSite cookies and hashed in the database. Sessions expire after seven days and logout revokes the active session. Queries always scope by authenticated user; the API never accepts an owner supplied by the client. Mutations require a custom header and reject unexpected browser origins. Helmet provides production security headers and CSP. Input validation, body limits, auth throttling and per-user AI quotas protect boundaries.

No OAuth, email verification, password recovery, refresh-token rotation, session-device screen, MFA or distributed rate limiting is implemented. These are explicit public-release blockers, not represented by nonfunctional buttons. The server binds to loopback; configure a reviewed reverse proxy before remote access.

## Nutrition and safety

`shared/domain.ts` owns nutrition mathematics, unit conversions, validation, volume, PRs, rolling averages and streak calculations. BMR follows Mifflin–St Jeor; multiplier-based expenditure is an estimate. Calorie adjustments are explicit and never automatically applied. The adult-only release rejects under-18 target creation. Floors of 1,200/1,500 kcal are conservative software safeguards, **not individualized medical recommendations**; specialist review is required before a public nutrition product launch. Macro energy uses 4 kcal/g protein, 4 kcal/g carbohydrate, 9 kcal/g fat. Food label calories are allowed to differ from macro-derived calories because fibre and label rounding exist.

Exercise estimates use net MET energy `(MET − 1) × 3.5 × kg / 200 × minutes`, with clearly labelled light/moderate/vigorous resistance-training estimates. A manually supplied total active-energy reading is assumed to include workouts and overrides estimates. Activity is separate from nutrition targets by default. Opting into adding it warns that an activity multiplier already includes usual exercise.

## AI pipeline

The OpenAI Responses API returns a strict JSON recognition structure containing food names, gram estimates, confidence and clarifying questions—not calorie guesses. Each name is searched against USDA FoodData Central if `USDA_API_KEY` is configured; otherwise Open Food Facts is used. Open Food Facts is primarily packaged foods, so its candidates may not match a cooked meal. The user must select a matching candidate or supply verified label nutrition manually. No unknown nutrient is silently replaced with zero, except optional fibre.

The review permits editing food, amount, unit and all main nutrients. The original recognition and corrected log values are stored under an owner-scoped analysis ID. Images are accepted as limited-size JPEG/PNG/WebP data URLs, passed to the provider, and not stored locally. `store:false` is used for Responses; provider processing policies still apply. The coach receives limited recent structured history and has no write tools. It cannot change goals or post data publicly.

## Offline behavior

Production app-shell assets are precached by a service worker using the build's exact asset list and a versioned cache name. Recent account data is cached in localStorage, explicitly disclosed in privacy settings. This is **not encrypted at rest on the device**; signing out clears it. There is no client-side session token. Pending records carry a user ID and stable UUID, survive reloads, and overlay server snapshots until synced. Food/workout retries insert once. Weight/activity updates are deliberate daily upserts; if two devices edit the same day, the last successfully synced write currently wins. The UI retains the queue on rejected requests rather than silently discarding them. Full conflict resolution and encrypted native storage are later requirements.

## Sources

- [Mifflin–St Jeor original publication](https://pubmed.ncbi.nlm.nih.gov/2305711/)
- [OpenAI image input documentation](https://developers.openai.com/api/docs/guides/images-vision)
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Open Food Facts API](https://openfoodfacts.github.io/openfoodfacts-server/api/ref-cheatsheet/)
- [USDA FoodData Central API](https://fdc.nal.usda.gov/api-guide/)

Open Food Facts data is under ODbL. Attribution is shown with search results and in settings. Review database licensing and provider rate limits before production distribution.
