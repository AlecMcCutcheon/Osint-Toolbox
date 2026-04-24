# Handoff

## Current runtime setup

- Local app runs on `APP_PORT=3040`.
- `.env` is currently set to `PROTECTED_FETCH_ENGINE=auto` and `FLARE_BASE_URL=http://localhost:32768`.
- Current understanding from the latest session: local Playwright is in use for the protected-fetch path; Docker is not part of the intended runtime for the user's setup.

## What changed this session

### Source-session + candidate-review workflow foundation

- Added SQLite-backed source-session state and candidate-lead persistence:
	- `src/sourceSessions.mjs`
	- `src/candidateLeads.mjs`
	- schema updates in `src/db/db.mjs`
- Extended `src/sourceCatalog.mjs` with source capability/session metadata and live session-state overlay support.
- Refactored `src/playwrightWorker.mjs` to support per-source persistent Playwright profiles/contexts instead of one shared context.
- Extended `src/server.mjs` with:
	- source-aware protected-fetch routing for the key USPhoneBook flows,
	- `/api/source-sessions` endpoints for open/check/clear/pause actions,
	- `/api/candidate-leads` endpoints for storing and reviewing ambiguous leads.
- Extended `public/settings.html` / `public/settings.js` so Settings now includes:
	- Source Sessions control surface,
	- Candidate Leads review surface.
- Extended `public/app.js` so the queue/result UI now recognizes:
	- `challenge_required`
	- `session_required`
	- `review_required`
	and offers an `Open verification browser` recovery path instead of always showing a generic failure.
- Name-search candidate rows can now be saved as analyst-review leads from the main result view.

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

- The new manual handoff flow is a first pass: it opens/checks/clears source sessions and lets challenged jobs retry, but it does not yet provide source-specific “already verified” or “lead already saved” inline UI everywhere.
- Candidate leads are now reviewable, but confirmed leads are not yet automatically promoted into graph-ingested entities/facts.
- The browser queue remains an important operational layer; broader server-authoritative ingestion work is still tracked separately in the roadmap.

## Suggested next pickup points

1. Add graph/normalized promotion logic for confirmed candidate leads.
2. Expand the same source-session pattern to future directory/social connectors as those adapters are implemented.
3. Add broader frontend verification/polish for Settings and challenged-result flows once reproducible challenge/session-required cases are available.
4. Decide whether the main queue should eventually become server-authoritative rather than browser-local only.