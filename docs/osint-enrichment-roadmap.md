# OSINT Enrichment Roadmap

This document captures the next recommended improvements for the `usphonebook-flare-app` data-collection pipeline beyond the two enrichment ideas discussed separately (`Census` address geocoding and `libphonenumber` phone enrichment).

## Current baseline

The app currently works best as a two-hop collector:

1. reverse phone search through USPhoneBook via FlareSolverr
2. optional profile-page enrich for richer person/address/phone/email/work data

The main limitation is that the collection model is still browser-led and single-source-heavy.

## Highest-value next steps

### 1. Make server-side ingestion authoritative

Right now the browser queue in `localStorage` acts as the practical source of truth, and the graph is reconstructed by posting queue items back to `/api/graph/rebuild`.

Recommended shift:

- ingest directly on the server when `/api/phone-search` succeeds
- ingest directly on the server when `/api/profile` succeeds
- store source metadata alongside normalized entities
- keep the browser queue only as a UI/job-state layer

Why this matters:

- data survives browser clears / device changes
- multi-hop collection becomes deterministic
- future enrichment modules can run headlessly or on schedules
- graph state no longer depends on one browser tab’s memory

### 2. Make `ingest` a real behavior or remove it

The current API surface exposes an ingest concept, but live fetch endpoints do not fully perform inline ingestion.

Recommended change:

- if `ingest=true`, perform the ingest immediately and return `graphIngest`
- otherwise remove or rename the flag so callers are not misled

Why this matters:

- automation becomes more reliable
- API semantics become honest
- downstream tooling can trust endpoint behavior

### 3. Auto-follow the person profile when available

`parseUsPhonebookHtml()` already returns `profilePath` from the phone-search page.

Recommended change:

- add an optional mode to auto-fetch the corresponding profile page after a successful phone hit
- merge the result into a combined response or queue a follow-up server-side job

Expected gains:

- aliases
- age
- current and previous addresses
- additional phones
- emails
- workplace / education
- marital and relationship data

This is the best immediate way to get more fine-grained data without adding a brand-new external source.

### 4. Crawl the address paths already exposed by profile pages

`parseUsPhonebookProfileHtml()` already extracts `/address/...` links.

Recommended change:

- add a dedicated address-page fetch/parser module
- model address pages as first-class source documents
- extract co-residents, household links, and cross-linked phones/persons

Why this matters:

- address pages are a natural pivot for household-level graph expansion
- they can connect separate phone-centric investigations
- they help validate whether multiple people/phones belong to the same location cluster

### 5. Add nearby-place context from open map data

After address normalization/geocoding, enrich locations with open geospatial context.

Potential additions:

- nearby schools
- transit stops
- police/fire/EMS
- places of worship
- parking
- clinics/hospitals
- neighborhood labels

Suggested public sources:

- `Nominatim` for normalized OSM place/address lookup (with strict caching and rate-limit discipline)
- `Overpass API` for nearby feature queries and POI context

Why this matters:

- gives location intelligence rather than just mailing-style addresses
- enables richer map and graph experiences
- supports contextual triage of an address without paid APIs

### 6. Add employer / workplace enrichment via public company sources

The profile parser already extracts workplace text.

Recommended change:

- normalize employer/company names
- search public company sources such as OpenCorporates
- attach matched company status, registered address, industry metadata, officers, and filing references where available

Why this matters:

- employer names become more than plain strings
- organization nodes can connect people by workplace
- industry / jurisdiction context improves entity resolution

### 7. Add more USPhoneBook entry modes

USPhoneBook publicly exposes search flows beyond reverse-phone lookup.

Recommended change:

- add name-search source module
- add address-search source module
- unify all source documents under the same ingestion/provenance model

Why this matters:

- investigations are not forced to begin with a phone number
- you can pivot from person -> phone, address -> residents, or phone -> profile with one graph model
- the app becomes a broader OSINT workbench instead of a reverse-phone utility

### 8. Add provenance and freshness per field or statement

Today merged entity JSON is useful, but it becomes hard to trust once multiple sources are involved.

Recommended change:

Store, for each observation:

- source name
- source URL
- retrieval timestamp
- normalized field name
- raw value
- normalized value
- confidence or match score
- evidence pointer/raw excerpt where practical

Why this matters:

- easier debugging when sources disagree
- better dedupe decisions
- safer long-term multi-source expansion
- future UI can show “where did this come from?”

### 9. Improve fetch observability and failure analysis

FlareSolverr is a major dependency and can fail in site-specific ways.

Recommended change:

- capture fetch duration
- capture retries / session replacements
- optionally store screenshots or truncated raw HTML on parse failure
- surface parser-failure diagnostics separately from transport failures

Why this matters:

- layout changes become easier to diagnose
- Cloudflare failures are easier to distinguish from parser bugs
- source-health dashboards become possible later

## Suggested rollout order

1. Server-side authoritative ingestion
2. Make `ingest` semantics real
3. Auto-follow person profiles
4. Add address-page crawling
5. Add field-level provenance
6. Add nearby-place map context
7. Add workplace/company enrichment
8. Add USPhoneBook name/address entry modules
9. Improve fetch observability

## Notes and cautions

- Public map/geocoding services need careful caching and low request rates.
- Multi-source enrichment should not merge fields blindly; provenance matters.
- Address and profile crawling should be configurable so the app can stay light for simple lookups.
- The graph should eventually be derivable from persisted source observations, not browser queue snapshots.
