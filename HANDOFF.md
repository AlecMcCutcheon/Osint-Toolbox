# Handoff

## Current runtime setup

- Local app runs on `APP_PORT=3040`.
- `.env` is currently set to `PROTECTED_FETCH_ENGINE=auto` and `FLARE_BASE_URL=http://localhost:32768`.
- Current understanding from the latest session: local Playwright is in use for the protected-fetch path; Docker is not part of the intended runtime for the user's setup.

## What changed this session

### Playwright shutdown cleanup

- Added a Playwright context shutdown helper in `src/playwrightWorker.mjs`.
- Wired server shutdown to close the Playwright persistent context in `src/server.mjs`.
- Result: when the app is stopped with `Ctrl+C`, the local Playwright browser context should now be torn down cleanly instead of being left open until process exit.

### Git ignore update

- Added `data/playwright-profile/` to `.gitignore`.
- Result: the persistent Chromium profile used by Playwright is now treated as generated local state.

## Relevant files

- `src/server.mjs`
- `src/playwrightWorker.mjs`
- `.gitignore`
- `.env`

## Current protected-fetch behavior

- `flare` uses the FlareSolverr-backed path.
- `playwright-local` uses a persistent local Chromium profile under `data/playwright-profile`.
- `auto` tries Playwright first and falls back to Flare on challenge/timeout/error.
- `/api/health` and `/api/trust-health` expose current protected-fetch engine information and recent fetch metrics.

## Known constraints

- There is still no full UI-driven manual handoff flow for Playwright challenge pages.
- When a challenge is detected, the API surfaces `challengeRequired` rather than continuing through a richer browser-assisted recovery path.
- The browser queue remains an important operational layer; broader server-authoritative ingestion work is still tracked separately in the roadmap.

## Suggested next pickup points

1. Decide whether `.env` should stay on `auto` or move fully to `playwright-local` for the user's non-Docker workflow.
2. Exercise shutdown once in a live run to confirm Chromium exits cleanly after `Ctrl+C`.
3. If challenge pages are common, wire `challengeRequired` into the UI instead of treating it as a generic fetch failure.
4. If Git is already tracking `data/playwright-profile`, remove it from the index with `git rm -r --cached data/playwright-profile` before the next commit.