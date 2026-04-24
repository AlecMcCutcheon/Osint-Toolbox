# Handoff

## 2026-04-24 staged-change audit follow-up — review fixes applied
- Completed a deeper audit of the staged source-session / candidate-lead / settings changes rather than just a happy-path implementation pass.
- Two real integration bugs were found and fixed:
	1. `public/app.js` had a mangled marital-profile enrich path where the helper was given a pre-rendered `data-context-phone="..."` attribute fragment instead of the dashed phone value itself. That could break enrich actions from marital relationship rows.
	2. `public/settings.js` had drifted from the queue/graph rebuild contract and could miss normalized graph-eligible records after a DB reset/rebuild. It also risked treating successful name-search results as legacy phone rebuild items because the fallback looked only for `result.parsed`. `public/graph.js` had the same fallback looseness.
- Audit cleanup completed:
	- marital enrich actions now pass the raw dashed context phone correctly;
	- Settings rebuild now honors normalized graph-eligible queue items the same way as the main lookup and graph pages;
	- legacy rebuild fallbacks now only treat `kind === "phone"` jobs as phone graph items, which preserves the intended `graphEligible: false` behavior for name-search results.
- Net effect: the staged features remain intact, but the backend/UI wiring is now more internally consistent and less likely to silently drift after DB resets or profile-side enrich actions.

## What was verified in this audit follow-up
- `npm run test:enrich` passed (`26/26`).
- `node --test test/source-sessions.test.mjs test/candidate-leads.test.mjs` passed (`7/7`).
- `npm run test:parse` passed.
- Server booted successfully on alternate port `3058`.
- Smoke requests succeeded for:
	- `GET /api/source-audit`
	- `GET /api/source-sessions`
	- `GET /api/candidate-leads?limit=3`
	- `/settings.html`
	- `/graph.html`
- Lint, typecheck, and build remain unavailable in `package.json`, so those verification categories are still unmet at the repository level.

## 2026-04-24 implementation update — source sessions + candidate review foundation
- Implemented the first full-stack pass of the session-assisted operator workflow that was planned on 2026-04-23.
- Backend additions completed:
	- `src/sourceSessions.mjs` now persists per-source session state (`ready`, `session_required`, `challenge_required`, pause/resume, warning metadata) in SQLite.
	- `src/candidateLeads.mjs` now persists reviewable candidate/profile leads with provenance, confidence, and analyst review state.
	- `src/db/db.mjs` now creates `source_sessions` and `candidate_leads` tables.
	- `src/sourceCatalog.mjs` now carries capability/session metadata per source and can overlay live session state into source-audit snapshots.
	- `src/playwrightWorker.mjs` now supports per-source persistent Playwright profiles/contexts instead of one global context.
	- `src/server.mjs` now exposes `/api/source-sessions*` and `/api/candidate-leads*` endpoints and passes source ids through the protected-fetch path for USPhoneBook / profile / external-source flows.
- Frontend additions completed:
	- `public/settings.html` / `public/settings.js` now include Source Sessions and Candidate Leads sections with actions for open/check/clear/pause and confirm/ambiguous/reject review handling.
	- `public/app.js` now treats `challenge_required`, `session_required`, and `review_required` as explicit queue/result states instead of collapsing them into generic errors.
	- Name-search candidate rows can now be saved as reviewable leads from the main results UI.
- Important runtime note: manual verification now works as a deliberate handoff flow — the UI can open a local browser session for the affected source, after which the operator can retry the job or inspect/update session state in Settings.
- Still intentionally not implemented in this pass:
	- Full source-specific social/public-web collectors.
	- Automatic graph ingestion of ambiguous candidate leads before analyst confirmation.
	- Rich frontend indicators showing already-saved lead status inline in every result row.

## Best place to pick back up
- Best next work item: **turn candidate review into graph-eligible confirmation and wire more sources into the same session/lead workflow**.
- Recommended order:
	1. Add candidate-lead confirmation hooks that can promote confirmed leads into stronger normalized/graph records.
	2. Expand the same open/check/clear/pause flow from USPhoneBook-first cases to the planned directory/social connectors as they land.
	3. Add inline UI hints for already-saved leads and session health so the main results page becomes more self-explanatory.
	4. Consider a light browser/UI verification pass for `/settings.html` and the challenged-result flow once a reproducible challenge/session-required source case is available.

## What was verified in this pass
- Editor diagnostics reported no errors in the modified server/UI/test files.
- `npm run test:enrich` passed, including the updated `test/source-catalog.test.mjs` coverage.
- New focused tests passed:
	- `node --test test/source-sessions.test.mjs test/candidate-leads.test.mjs`
- `npm run test:parse` passed.
- Runtime smoke boot of the updated server succeeded on alternate port `3051`.
- Smoke requests to `GET /api/source-audit`, `GET /api/source-sessions`, and `GET /api/candidate-leads?limit=3` on `http://127.0.0.1:3051` all returned successful JSON responses.
- A startup attempt on the default port `3040` failed with `EADDRINUSE`, which indicates an already-running local process rather than a code defect in this pass.

## 2026-04-23 review update
- Reviewed the root `HANDOFF.md`, `.env`, `.env.local`, `src/env.mjs`, `src/server.mjs`, `src/playwrightWorker.mjs`, and `public/app.js` without making runtime/code changes.
- Important config drift was found during review: the root `HANDOFF.md` said `.env` should be on `PROTECTED_FETCH_ENGINE=auto`, while the actual root `.env` did not set that variable and would therefore fall back to `flare`.
- Follow-up correction completed: the root `.env` now explicitly sets `PROTECTED_FETCH_ENGINE=auto`, bringing the runtime config back in line with the root `HANDOFF.md` and the intended local Playwright-first workflow.
- The Playwright shutdown cleanup added in the last session looks structurally correct: `src/server.mjs` now closes both the Flare session and the Playwright persistent context on `SIGINT`/`SIGTERM`, and `src/playwrightWorker.mjs` exposes a safe `closePlaywrightContext()` helper.
- Current user-facing gap confirmed in code: API routes return `challengeRequired` / `challengeReason`, but `public/app.js` does not branch on those fields. Non-OK responses are rendered as generic job failures, so challenge pages are not surfaced as a distinct recovery state in the queue/result UI.
- Operational note: `data/playwright-profile/` is ignored in `.gitignore` and is not currently tracked by Git, so the prior "remove it from the index" suggestion is not an active blocker in the present working tree.

## 2026-04-23 planning update — authenticated/public source workflow
- Product direction clarified: the app should maximize automated search + public collection, while accepting explicit operator intervention for session establishment, challenges, and ambiguous candidate review.
- Important boundary agreed: no credentials in code or `.env`; any login-sensitive sources should use manual operator sign-in within a local Playwright browser session, with the app reusing persisted local browser state only afterward.
- Existing repo anchors for this plan:
	- `src/sourceCatalog.mjs` already defines planned `social_public_web`, `public_web_directories`, and `deep_web_directories` source families and is the right place to extend source capability metadata.
	- `public/settings.html` + `public/settings.js` already host the active source registry and are the natural home for source-session controls.
	- `src/playwrightWorker.mjs` currently supports one shared persistent profile/context; it will need to evolve into per-source profile/context management before generic authenticated source sessions are viable.
	- `public/app.js` already has queue/result state machinery that can later be extended with `session_required`, `challenge_pending`, and analyst-review states.
- Recommended feature framing: **public link discovery + session-assisted operator verification**, not full autonomous authenticated scraping.
- Recommended phased rollout:
	1. Add source capability/state metadata and Settings UI for source sessions.
	2. Refactor Playwright support to manage isolated per-source persistent contexts/profiles.
	3. Add manual “open verification browser” / “clear session” / “check session” flows.
	4. Add queue/result states for `challenge_required`, `session_required`, and operator review.
	5. Add candidate-lead persistence with provenance and confirm/reject/ambiguous review actions.

## What changed
- Tightened `src/normalizedResult.mjs` so normalized payloads omit empty optional fields instead of emitting noisy empty arrays / null-only nested objects; graph rebuild adapters were updated to handle the compacted shape safely.
- Reworked the name-search form layout in `public/index.html` / `public/styles.css` from one cramped row into stacked labeled fields so the first box clearly means `Name (first + last)` and city/state optionality is explicit.
- Updated the full-name placeholder to `First and last name` and added inline optional labels for city/state to avoid the earlier first-name/last-name confusion.
- Added `src/normalizedResult.mjs`, which defines a shared internal `normalized` result envelope for phone search, name search, and profile enrich responses without removing the existing route-specific raw payloads.
- Updated `src/server.mjs` so `/api/phone-search`, `/api/name-search`, and `/api/profile` now attach `normalized` to successful responses and cached payloads.
- Updated graph rebuild ingestion (`src/graphRebuild.mjs`) to prefer normalized queue items when present while keeping the legacy `parsed` / `profile` rebuild path for backward compatibility.
- Updated `public/app.js` and `public/graph.js` so queue-driven graph sync/rebuild flows send normalized queue items when available instead of depending only on route-specific shapes.
- Added `test/normalized-result.test.mjs` to lock down the shared schema plus the normalized→graph-rebuild adapter behavior.
- Added `.ralph/deferred-issues.md` documenting the intentionally deferred follow-ups and concrete implementation steps for deeper normalization adoption.
- Added end-to-end USPhoneBook name-search support: a new `src/parseUsPhonebookNameSearch.mjs` parser, cached `/api/name-search` GET/POST endpoints, and request normalization that mirrors the live site’s client-side route rewrite (`/<name-slug>/<state>/<city>`).
- Added `src/nameSearchCache.mjs` so repeated people-search queries reuse cached parsed results instead of re-hitting Flare every time.
- Integrated a new Name Search form directly into the existing lookup panel in `public/index.html`, matched to the current dark theme with shared input/select styling in `public/styles.css`.
- Extended `public/app.js` queueing/rendering to support a third job type (`name`) with its own queue section, structured candidate-result table, and profile-enrich actions that can run without a phone-context parent row.
- Added `test/name-search-parser.test.mjs` and wired it into `npm run test:enrich` so the new result-page parser has regression coverage.
- Replaced placeholder `.ralph/` notes with a grounded first-pass understanding of the repository, current bootstrap plan, backlog, design system observations, verification baseline, and journal entry.
- Documented that the app is a local USPhoneBook + FlareSolverr OSINT workflow with SQLite persistence, browser queueing, graph exploration, settings reset flow, and an MCP stdio interface.
- Created a root `.env` placeholder because the runtime expects `.env` but only `env.example` / `.env.local` were present.
- Added `docs/osint-enrichment-roadmap.md`, capturing the remaining implementation-quality audit recommendations for improving fine-grained collection from free/public sources.
- Implemented local phone enrichment with `libphonenumber-js`, attached to phone-search responses, profile phone rows, and persisted phone graph entities.
- Implemented public/free Census geocoding for parsed addresses plus cached/rate-limited Overpass nearby-place enrichment, both flowing into profile responses and graph rebuild ingestion.
- Added persistent SQLite-backed enrichment caching (`enrichment_cache`), a focused enrichment unit test file, and UI result summaries for phone metadata / address geocode / nearby places.
- Added external-source comparison modules for TruePeopleSearch and That’s Them, merged-source fact summarization, NANP / telecom numbering enrichment, and a configurable county assessor framework with generic field extraction.
- Added built-in Maine county property-resource references for all 16 counties plus browser-like direct-fetch headers for non-Flare external requests.
- Added shared early env bootstrap via `src/env.mjs` so env-derived defaults are available before top-level module initialization across server, DB, caches, MCP, vector, and Flare-related modules.
- Hardened enrichment caching with in-flight dedupe so concurrent cache misses do not stampede the same upstream source.
- Improved parser robustness by deduping repeated person containers from TruePeopleSearch / That’s Them HTML and by treating assessor pages with no structured data as `no_match` instead of `ok`.
- Preserved FlareSolverr's resolved `solution.url` as the final source URL, which makes cached/source metadata more truthful after redirects or challenge resolution.
- Added a minimal profile-parser hardening pass: canonical address keys now ignore date-range suffixes, duplicate same-address profile rows collapse to the best record, address `isCurrent` flags are normalized by recency, self-relative/self-spouse artifacts are filtered, and empty workplace location placeholders like `", ,"` are normalized to `null`.
- Extended that parser work with a second pass: canonical address rows now retain explicit `periods[]` history so duplicate physical locations preserve multiple observed date windows without reintroducing duplicate address identities.
- Added a Settings-page source registry view backed by `src/sourceCatalog.mjs` and `/api/source-audit`, but then trimmed that UI back to runtime-only information after review.
- Moved roadmap / overlap / silo / future-browser-automation narrative out of the live application UI and into the root documentation file `OSINT_STACK_AUDIT.md`.
- Corrected the in-app source registry wording so it reflects the current runtime stack (`FlareSolverr`, direct fetches, config-driven extraction, local logic) instead of implying Playwright is already in use.

## What was verified
- `npm run test:enrich` still passed after compacting optional normalized fields.
- Browser verification on `http://127.0.0.1:3057/` confirmed the stacked name-search form renders clearly and that entering `Kory Drake` queues a normal name-search job.
- `npm run test:enrich` passed with the new normalized-result regression coverage (25 tests total).
- `npm run test:parse` passed after the normalization changes.
- Server smoke boot succeeded on alternate port `3056` after the normalized result layer was added.
- `npm run test:enrich` passed with the new name-search parser coverage included.
- `npm run test:parse` passed after the name-search integration.
- Server smoke boot succeeded on alternate port `3055` with the new `/api/name-search` route registered.
- Browser verification on `http://127.0.0.1:3055/` confirmed the new Name Search inputs appear inside the existing lookup panel with matching styling/theme.
- Browser verification confirmed a Name Search submission creates a running job in a dedicated `Names` queue section and renders the expected in-progress state.
- `npm run test:parse` passed.
- `npm run test:enrich` passed.
- Live browser verification on `http://127.0.0.1:3040/settings.html` confirmed the removed sections are no longer rendered and the active registry shows current runtime implementations.
- `npm start` smoke check succeeded on alternate port `3053` after the Maine county integration pass.
- `node src/server.mjs` smoke check succeeded again on alternate port `3054` after the audit hardening pass.
- Added and passed synthetic regression coverage for profile parsing edge cases via `test/profile-parser.test.mjs`.
- Verified the second-pass `periods[]` address history behavior with the same parser regression suite and a clean `npm run test:enrich` run.
- Verified that `package.json` does not currently define lint, typecheck, or build scripts.
- Source changes were made in this pass; lint/typecheck/build scripts still do not exist.

## What the user should test manually
1. Run one phone lookup, one name lookup, and one profile enrich, then inspect the response payloads to confirm each includes a `normalized` object alongside the existing raw fields.
2. Open `/graph.html`, rebuild from queue storage, and confirm graph ingestion still works after the normalized-backed queue sync change.
3. Review `.ralph/deferred-issues.md` for the follow-up normalization steps that were intentionally left out of the minimal pass.
1. Open `OSINT_STACK_AUDIT.md` in the project root and confirm it contains the strategic roadmap/gap-analysis material that was removed from Settings.
2. Open `/settings.html` and confirm the page now shows only the active source registry plus database controls.
3. Confirm the source registry describes current runtime implementations rather than future Playwright plans.
4. Set `FLARE_BASE_URL` in `.env` to a reachable FlareSolverr instance and confirm `/api/health` responds as expected.
5. Run one phone lookup and verify the result card now shows normalized phone metadata.
6. Run one phone lookup and confirm the external-source card reports TruePeopleSearch / That’s Them status plus merged corroboration facts when available.
7. Enrich one Maine profile/address and confirm the address summary now includes county-aware Maine property-resource references even without custom assessor config.
8. Enrich one profile and confirm addresses show Census coordinates / geography, nearby-place context, and assessor fields when `ASSESSOR_SOURCES_JSON` is configured.
9. Open `/graph.html` after queue sync and inspect a phone node + address node JSON to confirm enrichment data persisted.
10. If the MCP surface matters for upcoming work, launch `npm run mcp` and confirm a client can consume its graph/cache tools.
11. Trigger two identical enrich requests at once and confirm the upstream source only gets hit once before the shared cached result is reused.
12. Re-open a profile with duplicated historical/current addresses and confirm the API now returns one canonical address entry per physical location with saner `isCurrent` flags and no self-spouse/self-relative artifact.
13. Confirm duplicate physical addresses now expose `periods[]` history in the API payload and the profile UI shows a compact history summary instead of duplicate address rows.

## What to watch for
- Any downstream code that assumes only `parsed` or `profile` exists should continue working, but future integrations should prefer `normalized` to avoid shape drift.
- Port collisions on `3040` during local startup.
- Differences between browser-local queue state and server-side graph state after rebuild/reset operations.
- Any missing loading, error, or disabled-state behavior during slow FlareSolverr interactions.
- Public endpoint availability / throttling from Census or Overpass during unusually heavy manual testing.
- Cloudflare/captcha blocks from TruePeopleSearch / That’s Them, which are expected sometimes and should surface as `blocked` rather than crash the lookup.
- County assessor templates that need county-specific search URLs before they can return live property data.
- Maine county references are a launch point, not guaranteed owner/value data, because municipal systems hold much of the assessment detail.
- External-source DOM changes can still reduce extraction quality; the parser dedupe work removes repeated duplicates but cannot fully protect against upstream redesigns.
- Address history is now represented as `periods[]` inside each canonical address row; if graph-level time-aware residency edges become important, that should be modeled explicitly rather than inferred only from the address entity payload.

## Known limitations
- The UI still renders route-specific raw payloads; this pass normalized the backend/internal contract and graph sync path, not the visual result renderers.
- Name-search normalized records are not yet graph-ingested because candidate results remain ambiguous until confirmed by profile enrichment.
- Real network-based Census / Overpass calls were implemented but not exercised against live upstream services in this pass.
- Real live fetches against TruePeopleSearch / That’s Them / county assessor sites were implemented with fail-soft behavior but not end-to-end validated against a stable real-world success response in this pass.
- Verification coverage is thin because the repo currently lacks lint/typecheck/build commands.
- Accessibility and responsive behavior still need explicit manual review.

## Report back if you notice
- visual regressions
- broken interactions
- edge-case failures
- copy or workflow confusion
- animation or spacing issues