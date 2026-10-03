# BulkBro

A working, private, mobile-responsive nutrition and training app built from the supplied product brief and BulkBro artwork. This is a **local MVP**, not a claim that the entire six-phase production roadmap is finished.

## Run

Requires Node.js 24.12+ (uses `node:sqlite`).

```sh
npm ci
npm run dev
```

Open **http://localhost:5188**. The backend runs on loopback port 3001. Create your own account and complete onboarding; there is no prefilled user diary or demo account. Keep this terminal running while using the preview.

To test on a phone on the same Wi-Fi/network, keep `npm run dev` running and start a second terminal with `npm run dev:mobile`. It prints the private-network URL (port 5191) and writes a scannable QR image to `test-results/mobile-qr.png`. Open the URL in the phone's browser. The LAN preview uses HTTP, so only use it on a trusted network; browser camera barcode detection and installable offline behavior require a secure origin. The meal photo file picker can still let you take or choose a photo, and barcode numbers can be entered manually.

## Native phone app projects

The same React interface is packaged with Capacitor in `ios/` and `android/`. These are native Xcode/Android Studio projects, not browser shortcuts. The development builds point at the local app URL so account and logging requests reach the running Node backend. They need the computer and phone on the same trusted network and both `npm run dev` and `npm run dev:mobile` running. They stop working when the backend stops. A standalone release needs a deployed HTTPS backend and production API configuration before distribution.

**iPhone:** On a Mac with Xcode and an iPhone connected, install dependencies with `npm ci`, run the two development servers, then run `npm run mobile:ios:dev`. Open `ios/App/App.xcodeproj` in Xcode, select your signing team and connected iPhone, and press Run. If the servers run on another computer, set `BULKBRO_MOBILE_DEV_URL` to its LAN URL before `npm run mobile:ios:dev`. The project includes a local-network usage description and local-network transport exception for this development connection. iOS builds and signing cannot run on Windows.

**Android:** With Android Studio, SDK 36 and JDK 21 installed, run `npm run mobile:android:dev` while the two servers are running. The script creates `artifacts/bulkbro-android-dev.apk` for installation on an Android phone. Run `npm run mobile:android:share` to serve a download page on port 5192 and create `test-results/android-install-qr.png`; scan it on the phone or open the printed URL. Download and install the APK on the phone, allowing installation from that source if Android asks. This is a local debug build, not a Play Store release. The debug APK uses the local HTTP address for development only.

The mobile wrappers do not yet implement HealthKit/Health Connect, native barcode scanning, push notifications or a production HTTPS API. No OpenAI key is included in either phone app.

```sh
npm run build
npm start
```

The production build includes a compiled server and is served on port 3001. Set `APP_ORIGIN=http://localhost:3001` for local build testing. For deployment, use HTTPS, set `NODE_ENV=production` and `APP_ORIGIN` to the exact public origin, and put the loopback server behind a reverse proxy. Cookies become Secure in production. Do not expose the Vite development server publicly.

Configuration is documented in `.env.example`; `.env.local` is also supported and ignored by Git. The server inherits the existing `OPENAI_API_KEY` from its environment. **The reused key was not printed, copied into a file, or bundled into the client.** The key authenticated, but the live model check returned `credit_balance_exhausted`; AI features require available API credit. This does not block the rest of the app. Never name a secret with a `VITE_` prefix.

Brand text is configurable with `VITE_APP_NAME`. The supplied image is `public/brand.png`; the small interface icon is a separate SVG. Replace the image and manifest name as well when changing the brand.

## Working flows

- Email/password registration and login; scrypt password hashes; opaque, hashed server-side sessions; HttpOnly cookies; protected mutations and account-scoped queries.
- Adult onboarding, metric/imperial body inputs, Mifflin–St Jeor BMR/TDEE estimates, gain/cut/maintenance targets, editable macros in grams or percentages with 4/4/9 consistency.
- Daily calorie ring, macros, meals, activity, water, streak and progress overview. Starts empty and reflects actual logged data.
- Food search via Open Food Facts and private custom foods, manual nutrition entry, recent/favourite foods, custom meal categories, copy previous day, editable portions and nutrients.
- Barcode lookup plus camera detection where the browser supports `BarcodeDetector`. Unsupported browsers offer barcode number entry.
- Saved meals and recipes with total/per-portion calculation and one-portion insertion into a review.
- Photo capture/upload → server-side structured recognition → nutrition database candidates → explicit user match selection → editable review → saved food log. Original recognition and corrections are stored; photo bytes are not retained by this application.
- Manual steps, daily active energy and water. An all-inclusive wearable energy total replaces workout estimates instead of adding to them.
- Workout templates, custom exercise lists, reusable previous routines, sets/reps/load/RPE, history, volume and PR detection.
- Bodyweight history with 7-day rolling averages and 7D/30D/3M/6M/1Y/all ranges; weekly nutrition chart and review; achievements, XP and levels.
- Optional AI coach grounded in the authenticated user's structured logs, with explicit data-sharing copy.
- JSON data export and password-confirmed account deletion with foreign-key cascades.
- Offline cache, durable pending food/workout/weight/activity writes, user-scoped replay and idempotent food/workout insertion. Production service worker caches the app shell; API responses never enter the service-worker cache. Signing out clears cached health records after warning if entries are unsynced.

## Verification

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:pwa
```

Unit/API tests use isolated in-memory databases. Browser tests create and remove their own accounts on the local server. Screenshots are written to `test-results/` (ignored by Git). Test fixtures are not production user data.

See [the implementation review](docs/IMPLEMENTATION.md) for the full scope assessment, known limitations and release gates, and [architecture](docs/ARCHITECTURE.md) for the security/data/AI decisions.
