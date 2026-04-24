# Deferred implementation steps

## Generic authenticated/public source workflow

### 1. Add source capability and session-state model
- **Status:** Partially implemented
- **Why still deferred:** Core metadata/state plumbing now exists, but downstream confirmation/ingestion flows and broader source adoption are not complete yet.
- **Implementation steps:**
  1. ✅ Extend `src/sourceCatalog.mjs` source definitions with capability fields such as `collectionMode`, `sessionMode`, `stopOnWarning`, `sessionScope`, and `reviewMode`.
  2. ✅ Add a persisted server-side source-session state store for statuses like `inactive`, `ready`, `session_required`, `challenge_required`, and related warning metadata.
  3. ✅ Expose `/api/source-sessions` endpoints for listing status and mutating safe actions.
  4. ⏳ Keep anonymous-public and session-dependent sources visually distinct across more of the main app, not just Settings/audit.

### 2. Refactor Playwright into per-source persistent contexts
- **Status:** Mostly implemented
- **Why still deferred:** The keyed profile/context layer now exists, but more source families still need to adopt it as new connectors are added.
- **Implementation steps:**
  1. ✅ Replace the single global context model with a keyed source-context registry.
  2. ✅ Store profiles under source-specific directories.
  3. ✅ Add helpers to open, reuse, inspect, and clear a context per source.
  4. ⏳ Continue migrating future source families onto the keyed API as they are implemented.

### 3. Add Settings-driven manual session actions
- **Status:** Implemented (first pass)
- **Why still deferred:** The first-pass operator controls are live, but richer status UX and source-specific guidance can still be improved.
- **Implementation steps:**
  1. ✅ Add per-source actions to `public/settings.html` / `public/settings.js`: `Open browser`, `Check session`, `Clear session`, and `Pause source`.
  2. ✅ Add backend endpoints to launch a headed Playwright page for a given source and to report current session state.
  3. ✅ Keep the browser-launch action limited to opening the local persistent context — no raw credentials are requested or stored by the app.
  4. ⏳ Improve source-specific operator guidance and inline success/warning feedback as more connectors are added.

### 4. Add challenge/session-required queue states
- **Status:** Implemented (first pass)
- **Why still deferred:** Core queue/result states now exist, but the UX can still be refined with richer saved-lead/session indicators and more source-specific actions.
- **Implementation steps:**
  1. ✅ Introduce explicit job states for `challenge_required`, `session_required`, and `review_required`.
  2. ✅ Show targeted actions in result cards such as `Open verification browser` and `Retry`.
  3. ✅ Prefer manual operator handoff when a verification/session action is available.
  4. ⏳ Add dedicated frontend regression coverage for queue persistence and rendering across the new states.

### 5. Add candidate-lead review workflow with provenance
- **Status:** Partially implemented
- **Why still deferred:** Candidate leads can now be stored and reviewed, but confirmation does not yet promote them into graph-ingestible entities or stronger normalized facts.
- **Implementation steps:**
  1. ✅ Add a candidate-lead model with source id, URL, display label, access mode, confidence, and evidence/context fields.
  2. ✅ Store confirm/reject/ambiguous review state separately from raw collected observations.
  3. ✅ Record provenance inputs for every saved lead and review action.
  4. ⏳ Promote confirmed leads into graph-ingestible / normalized downstream records only after confirmation or stronger corroboration rules.

### References
- `src/sourceCatalog.mjs`
- `src/playwrightWorker.mjs`
- `src/server.mjs`
- `public/settings.html`
- `public/settings.js`
- `public/app.js`
- `HANDOFF.md`

## Normalized result adoption follow-ups

### 1. Render result cards from `result.normalized`
- **Status:** Deferred
- **Why deferred:** The minimal pass keeps existing UI behavior stable by leaving the current raw renderers intact.
- **Implementation steps:**
  1. Add UI helpers that render from `result.normalized.records`.
  2. Migrate the phone, name, and enrich result cards one-by-one.
  3. Keep raw payload panels available for debugging until the new rendering path is proven.
  4. Remove old renderer-specific field branching only after manual verification.

### 2. Add normalized export stream support
- **Status:** Deferred
- **Why deferred:** There is no export workflow in this pass, and forcing one in now would expand scope beyond the requested minimal backend cleanup.
- **Implementation steps:**
  1. Add an export endpoint or local-download action that serializes `result.normalized` from completed jobs.
  2. Define export formats (`json`, `jsonl`, optional CSV flattening).
  3. Add record-level provenance fields if downstream workflows need source-by-source merge tracking.
  4. Add regression tests covering mixed job queues.

### 3. Graph-ingest normalized name candidates
- **Status:** Deferred
- **Why deferred:** Name-search candidates are currently ambiguous person candidates and were intentionally left out of graph ingestion in the minimal pass.
- **Implementation steps:**
  1. Decide the graph model for candidate-only people without a confirmed phone/profile ingest.
  2. Add a graph rebuild adapter for `normalized.kind === "name_search"`.
  3. Add dedupe rules for candidate records that later resolve to profile enriches.
  4. Verify graph clutter stays manageable with bulk name searches.

### 4. Add generic downstream record utilities
- **Status:** Deferred
- **Why deferred:** The normalized envelope exists now, but merge/dedupe/export helpers would be speculative until the next integration target is chosen.
- **Implementation steps:**
  1. Create shared helpers for extracting phones, addresses, relatives, and profile paths from `normalized.records`.
  2. Reuse those helpers in graph sync, exports, and future merge logic.
  3. Add fixture-based tests for mixed phone/name/profile queues.

### References
- `src/normalizedResult.mjs`
- `src/server.mjs`
- `src/graphRebuild.mjs`
- `public/app.js`
- `public/graph.js`
- `test/normalized-result.test.mjs`
