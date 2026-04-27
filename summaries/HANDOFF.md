# Handoff

## Current runtime setup

- Local app runs on `APP_PORT=3040`.
- `.env` is currently set to `PROTECTED_FETCH_ENGINE=auto` and `FLARE_BASE_URL=http://localhost:32768`.
- Current runtime understanding: the main app is being run locally with Node, and local Playwright is active in the protected-fetch path. FlareSolverr is currently hosted separately in Docker and exposed on `FLARE_BASE_URL=http://localhost:32768`, so the app is not fully containerized even though the Flare component is.

## What changed this session

### External-source observability and trust classification

- Extended external people-source logging so fetch success and parse outcome are logged separately.
- `src/server.mjs` now emits compact post-parse result lines such as:
	- `source parse ok`
	- `source parse no_match`
	- `source parse blocked`
- Those lines now include parser `reason` values where available.
- Added parser reason detection for:
	- `src/truePeopleSearch.mjs`: `attention_required`, `cloudflare`, `javascript_required`, `access_denied`, `forbidden`, `no_results_text`, `no_parseable_people`
	- `src/thatsThem.mjs`: `humanity_check`, `recaptcha`, `captcha`, `odd_traffic`, `not_found_page`, `no_results_text`, `no_parseable_people`
- Added source-trust classification helpers in `src/sourceStrategy.mjs`.
- Parser-detected anti-bot outcomes are now tagged as `failureKind: "source_trust"` instead of being treated like generic fetch errors.
- `src/protectedFetchMetrics.mjs` now counts parser-level trust failures in protected-fetch health/trust calculations.

### That’s Them candidate strategy

- Added adaptive candidate ranking/skipping for That’s Them in:
	- `src/sourceStrategy.mjs`
	- `src/server.mjs`
- Candidate URL patterns are now classified and tracked separately:
	- `path_digits`
	- `path_dashed`
	- `query_phone`
	- `query_Phone`
- Repeated `not_found_page` outcomes demote a pattern.
- After repeated structural misses, dead-end patterns are skipped instead of being retried forever.
- Patterns that at least reach parseable content remain preferred.

### TruePeopleSearch session-based strategy

- TruePeopleSearch is no longer treated as a normal Flare-first source.
- Updated `src/sourceCatalog.mjs` so `truepeoplesearch` is now `sessionMode: "required"`.
- Updated `src/server.mjs` so TruePeopleSearch:
	- returns `session_required` if the source session is not ready,
	- uses the persistent Playwright browser profile when the session is ready,
	- updates source-session status based on live TPS outcomes,
	- no longer caches cold-session or blocked-session placeholder results.
- Updated `src/enrichmentCache.mjs` so callers can decide whether a produced value should be cached.
- Updated `public/app.js` so TPS/That’s Them source chips and inline phone summaries can show `session required` distinctly instead of collapsing that into `no match`.

### Why this matters operationally

- TruePeopleSearch can still return HTTP 200 from Flare while the content itself is a Cloudflare/interstitial page.
- The current working conclusion is that TPS reliability depends on a warmed persistent browser session, not another parser tweak and not another fetch fallback.
- Logging is now good enough to distinguish:
	- transport failure,
	- parser-level trust failure,
	- real no-match,
	- session-required state.

### Maine assessor / Vision clarification

- For Maine assessor coverage, Vision Government Solutions was chosen as the best first platform family to integrate because it covers multiple municipalities with a reusable structure.
- Important distinction: `https://www.vgsi.com/maine-online-database/` is a directory/discovery page, not the actual parcel-record endpoint to scrape for assessor data.
- The real record targets are the individual municipal Vision assessor/property search sites linked from that directory.
- Operationally, use the VGSI Maine page to identify supported towns and their municipal endpoints, then run the Vision driver against those municipal sites rather than scraping parcel data from the statewide directory page itself.
- This should remain part of the continuation plan when expanding Maine assessor coverage beyond the towns already configured.

### AxisGIS follow-up assessment

- AxisGIS currently looks like the strongest next assessor platform family candidate after Vision for expanding Maine municipal coverage.
- Live inspection of `https://www.axisgis.com/WatervilleME/` suggests it is not a simple HTML assessor site like Vision:
	- it is a client-side GIS/property app,
	- it is Esri-backed,
	- it is heavily JavaScript/WebGL driven,
	- it exposes parcel search UI for street / owner / parcel number lookups.
- Current conclusion: AxisGIS should probably be integrated API-first by reverse-engineering its underlying Esri/JSON/service calls, not by scraping rendered HTML.
- The right first implementation target would be one concrete municipal site such as Waterville, then a reusable `platform: "axisgis"` driver if the request/response shape is stable across towns.
- AxisGIS is not implemented in the repo yet; it is still a next-platform candidate, not a completed integration.

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
- `src/sourceStrategy.mjs`
- `src/assessorEnrichment.mjs`
- `src/truePeopleSearch.mjs`
- `src/thatsThem.mjs`
- `src/protectedFetchMetrics.mjs`
- `src/enrichmentCache.mjs`
- `src/sourceCatalog.mjs`
- `test/source-adapters.test.mjs`
- `docs/maine-assessor-integration.md`
- `docs/assessor-sources.maine.vision.json`
- `docs/osint-enrichment-roadmap.md`
- `.gitignore`
- `.env`
- `HANDOFF.md`

## Current protected-fetch behavior

- `flare` uses the FlareSolverr-backed path.
- `playwright-local` uses a persistent local Chromium profile under `data/playwright-profile`.
- `auto` tries Playwright first and falls back to Flare on challenge/timeout/error.
- `/api/health` and `/api/trust-health` expose current protected-fetch engine information and recent fetch metrics.
- Practical runtime distinction: the Express app itself is started locally with `npm run start`, while FlareSolverr is provided separately via `FLARE_BASE_URL` and is currently Docker-backed even though the app itself is not.

## Known constraints

- The new manual handoff flow is a first pass: it opens/checks/clears source sessions and lets challenged jobs retry, but it does not yet provide source-specific “already verified” or “lead already saved” inline UI everywhere.
- Candidate leads are now reviewable, but confirmed leads are not yet automatically promoted into graph-ingested entities/facts.
- The browser queue remains an important operational layer; broader server-authoritative ingestion work is still tracked separately in the roadmap.
- TruePeopleSearch now intentionally requires a ready local browser session; if Settings does not show TPS as `ready`, TPS lookups should return `session_required` rather than silently attempting Flare.
- TPS session readiness is only as good as the persistent Playwright profile under `data/playwright-profile/truepeoplesearch`; if the site challenges again later, the session must be re-opened/checked.
- That’s Them candidate pattern ranking is currently in-memory process state, not persisted across restarts.
- Assessor platform coverage is still partial: Vision is the only reusable municipal family implemented so far.
- Non-Vision Maine towns still need dedicated platform work; AxisGIS and Harris-style sites remain unfinished.
- AxisGIS likely requires network/API reverse-engineering rather than the existing HTML parser path, so it is not just a metadata-onboarding task.

## Validation completed

- `node --test test/source-adapters.test.mjs` passed after the parser reason + source strategy changes.
- `node --check src/server.mjs` passed after the external-source strategy changes.
- `node --check public/app.js` passed after the `session required` UI changes.
- `npm run test:enrich` passed after both the trust/candidate changes and the TPS session-required changes.
- Latest known passing count after the TPS session work: 33 tests.

## Exact resume point

- The recommended immediate next live check is a real TPS session warm-up followed by one retry of a previously blocked lookup.
- The main assessor expansion decision after that is whether to continue deeper TPS hardening work first or start the first AxisGIS reverse-engineering pass.
- Resume from this operational sequence:
	1. Start the app with `npm run start`.
	2. Open Settings at `/settings.html`.
	3. In Source Sessions, find `TruePeopleSearch`.
	4. Click `Open browser`.
	5. In the opened browser/profile, complete any challenge/interstitial/captcha that TPS presents.
	6. Return to Settings and click `Check session`.
	7. Confirm the session state shows `ready`.
	8. Retry one of the numbers that previously logged `reason=cloudflare` for TPS.
	9. Inspect console logs for whether TPS now reaches `source parse ok`, `source parse no_match`, or falls back to `source parse blocked` again.
	10. If TPS is stable enough, the next assessor platform to investigate is AxisGIS, starting with Waterville.

## What to watch for in the next live run

- Desired TPS behavior:
	- no immediate `session_required`
	- fetch path uses `playwright-local`
	- parse result becomes `ok` or a legitimate `no_match`
- If TPS still blocks after session warm-up:
	- check whether the opened persistent browser actually cleared the challenge,
	- use `Check session` again,
	- if still bad, use `Clear session` and repeat the warm-up,
	- if it still fails after that, capture the new logs because the blocker is likely a deeper source-side challenge variant.
- Desired That’s Them behavior:
	- dead-end URL shapes should gradually disappear from repeated runs once enough `not_found_page` evidence accumulates.
- Desired assessor expansion behavior:
	- Vision stays the reusable HTML-family path,
	- AxisGIS is treated as a separate Esri/API-family path,
	- no attempt is made to force AxisGIS into the Vision/generic HTML config model prematurely.

## Unfinished work

- Run a real TruePeopleSearch session warm-up and confirm whether the persistent browser profile converts previous parser-level `cloudflare` failures into usable outcomes.
- Persist blocked HTML samples for TPS if the warmed session still fails, so challenge variants can be fingerprinted.
- Decide whether That’s Them candidate-pattern learning should be persisted instead of staying in-memory only.
- Promote confirmed candidate leads into graph/normalized facts instead of leaving them review-only.
- Expand Maine assessor coverage beyond Vision.
- Reverse-engineer one AxisGIS municipality and determine whether a reusable `platform: "axisgis"` driver is viable.
- Investigate additional non-Vision assessor families such as Harris if Maine coverage still has major gaps after Vision + AxisGIS.
- Decide whether the queue should eventually become server-authoritative rather than browser-local.

## Suggested next pickup points

1. Run one live TruePeopleSearch session warm-up and confirm whether the persistent profile actually converts prior `cloudflare` blocks into `ok` or legitimate `no_match` outcomes.
2. If TPS still blocks after a warmed session, persist blocked HTML samples for TPS so challenge variants can be fingerprinted and compared over time.
3. Reverse-engineer the Waterville AxisGIS site and identify the underlying parcel search / owner search / parcel-detail request flow.
4. Decide whether AxisGIS responses are reusable enough across towns to justify a `platform: "axisgis"` driver.
5. Consider persisting That’s Them candidate-pattern statistics if adaptive ranking should survive app restarts.
6. Add graph/normalized promotion logic for confirmed candidate leads.
7. Expand the same source-session pattern to future directory/social connectors as those adapters are implemented.
8. Add broader frontend verification/polish for Settings and challenged-result flows once more real session-required cases are available.
9. Decide whether the main queue should eventually become server-authoritative rather than browser-local only.