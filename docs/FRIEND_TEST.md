# Private daily-loop trial

**Status: prepared only.** This protocol has not been sent to friends and has not been completed with human participants. Automated test accounts are not a substitute for this trial.

Invite 2–3 friends after the maintainer has a reachable private server and has checked backup/restore. Each friend gets their own account. For an in-person LAN session, all phones and the computer use the same trusted network and the backend stays running. For remote friends, deploy HTTPS first; a localhost URL or debug APK does not create a shared hosted service.

## Maintainer setup

1. Use a test database or make a SQLite backup outside source control. Rehearse restoring a copy, as described in [architecture](ARCHITECTURE.md#backups-and-restore).
2. Start the server, confirm the exact reachable URL, and explain that this is a private early test. No scanning, subscription, social posting or connected-health setup is needed.
3. Ask friends to use ordinary food labels and comfortable manual targets. They may use fictional food/body details for privacy. Passwords should be unique to this test; account recovery is not available yet.
4. Record device, browser, viewport/large-text setting and timezone. Observe rather than explain each button in advance. Do not collect passwords or unredacted exports as feedback.

## Participant tasks

1. Create your account, complete personal setup, and find/edit your daily calorie and macro targets. Confirm any automatically suggested numbers are described as estimates.
2. Log a normal day across breakfast, lunch, dinner and snacks. Create one food using per-100-g nutrition, log 150 g, and one food using per-serving nutrition. Find one item again using search, recents or favourites.
3. Correct the 150 g item to 200 g. Check that calories/macros and remaining values change. Delete an accidental item and check that it disappears. Note whether the correction path was obvious.
4. Save a reusable meal, add a portion on another day, and repeat a previous meal. Check the date, meal category and quantities before saving.
5. Revisit yesterday, add a meal there, and return to today. Reload the app. Confirm both dates, current/best streak and day completion make sense. Change a target and check the old foods themselves have not changed.
6. Log out, reload, then sign in again. On a shared device, a second friend's account should show only its own meals, targets, saved foods and history. Never share a password to perform this check.
7. If using the same server on a second device, sign in and reload to see committed records. Treat any pending device-only entries separately. Export your server data from settings after syncing.
8. Optionally disconnect after loading the app, log a meal, and observe the device-only pending message. Reconnect and check that it syncs once. Do not clear browser storage or sign out while it is pending unless you intend to discard that change.
9. Close the app and return tomorrow. Find the new day's goals, yesterday's history and the next obvious action without coaching.

The maintainer, using disposable test accounts, additionally checks a gap day, backfilling the gap and deleting its only food; midnight rollover; a timezone change; and a deliberately failed save/storage write. A failure must leave the draft or a truthful pending message, never a success claim for lost data. Automated acceptance checks already target these failure cases, but observed wording still matters.

## Feedback template

```text
Participant alias:
Device / browser / timezone / large-text setting:
Task attempted:
What I expected to happen:
What happened:
Where I hesitated or looked for a control:
Was the meal date and save/pending state clear?
Could I correct a mistaken portion without help?
Approximate time to log a familiar meal:
Screenshot (optional; remove email, names and private details):
One thing that would make tomorrow's log easier:
```

## Decide what to fix

Record issues as reproducible steps with expected/actual results. Prioritize data loss, account leakage, wrong nutrition totals and unclear save states immediately. When two participants struggle at the same step, treat it as recurring friction and fix it before considering a broader release. Rerun that step and the complete daily loop after the fix.

A trial is complete when each participant can log a normal day, correct a portion, revisit yesterday, reload and return tomorrow without help, and no unresolved data-loss/isolation/incorrect-total issue remains. Keep a separate dated results note with consented, minimal feedback; do not label this protocol itself as a successful test.
