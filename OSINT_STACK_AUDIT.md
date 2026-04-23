# OSINT Stack Audit and Expansion Notes

This document contains the strategic material that should live in documentation rather than the application UI.

## Browser automation recommendation

- **Current runtime:** the app is **not using Playwright today**.
- Current active runtime stack is:
  - **FlareSolverr** for browser-challenge-backed HTML retrieval where needed
  - **direct `fetch`** for public HTTP sources like Census and Overpass
  - **server-side parsing** and enrichment in Node
- **Future recommendation:** if the project adds richer browser-worker connectors for JavaScript-heavy public sources, **Playwright** is the cleanest primary automation layer.
- **Why Playwright later:** isolated browser contexts, storage-state capture, route/network hooks, and deterministic waits make it a good fit for multi-step public-source connectors.
- **Why not claim it now:** no Playwright worker pool, connector runtime, or dependency-backed implementation is active in the current app.

## Highest-priority roadmap

1. **Persist source documents before graph merges**
   - Store raw source documents, retrieval metadata, and parser outputs separately so parser drift can be replayed without re-fetching.
2. **Make server-side jobs authoritative**
   - Move the browser queue from source-of-truth to UI state only; persist job runs, source runs, and replayable artifacts on the server.
3. **Attach per-field provenance**
   - Every normalized fact should carry source id, URL, retrieval time, evidence snippet, and confidence.

## Data silos and architectural gaps

### Browser queue remains a data silo

Completed jobs still originate from browser-local state and must be pushed back to the server to reconstruct graph truth.

### Source documents are not yet first-class persisted records

Current ingestion stores merged entities but not replayable source documents, making parser evolution and audit trails harder.

### Connector capabilities are implicit in code

The app has multiple adapters, but rate limits, session models, and search inputs are not represented in a connector registry yet.

### Fetch observability is incomplete

There is limited structured capture of navigation timings, blocked states, and parser-failure artifacts across sources.

## Functional overlaps

### Person identity overlap

- Sources: `usphonebook_phone_search`, `usphonebook_profile`, `truepeoplesearch`, `thatsthem`, future `social_public_web`
- Shared fields: display name, aliases, profile path or handle, relatives

### Address context overlap

- Sources: `usphonebook_profile`, `census_geocoder`, `openstreetmap_overpass`, `assessor_records`, future `public_web_directories`
- Shared fields: normalized address, geography, parcel context, nearby places

### Phone fact overlap

- Sources: `usphonebook_phone_search`, `usphonebook_profile`, `truepeoplesearch`, `thatsthem`, `telecom_local`
- Shared fields: normalized line, line type, ownership clues

## Full roadmap

### Now

- Persist source documents before graph merges
- Make server-side jobs authoritative
- Attach per-field provenance

### Next

- Introduce a driver registry for address and public-record sources
- Add a browser worker pool for future JS-heavy public sources

### Later

- Add public social-surface connectors
- Add searchable deep-web/public-directory workflow drivers where legally appropriate and operationally useful

## Notes on active source registry wording

The in-app **Source Registry** should describe the **actual current runtime** only:

- USPhoneBook flows: **FlareSolverr + server-side parser**
- TruePeopleSearch / That's Them: **current fetch helper + parser + cache**
- Census / Overpass: **direct fetch**
- Assessor: **config-driven fetch + generic extraction**
- Telecom: **local logic**

Future framework recommendations belong in documentation, not in the live operations UI.