# Code Review: usphonebook-flare-app

## Executive Summary

This codebase is an OSINT people-search aggregation engine that scrapes USPhoneBook, TruePeopleSearch, FastPeopleSearch, and ThatsThem, normalizes results into a SQLite-backed entity graph, and exposes them via Express and an MCP stdio server. The architecture is conceptually sound, but the implementation suffers from severe monolithic bloat in `server.mjs` (~3,356 lines), brittle site-specific HTML parsers, virtually nonexistent security on the HTTP surface, and a vector-store feature that is literally fake embeddings. It works as a prototype but would require significant refactoring to be production-maintainable or safe to expose to any untrusted client.

---

## Inventory & Architecture

### Files & Structure

| File | Role | Lines (approx) |
|------|------|----------------|
| `src/server.mjs` | Express app, all route handlers, protected-fetch orchestration, merge logic | ~3,356 |
| `src/db/db.mjs` | better-sqlite3 initialization, schema definition, WAL mode | ~180 |
| `src/entityIngest.mjs` | Graph upsert/dedupe for entities and edges | ~280 |
| `src/normalizedResult.mjs` | Stable normalization envelope (phone/name/profile) | ~505 |
| `src/sourceObservations.mjs` | Cross-source fact merging (names, phones, addresses, emails, relatives) | ~136 |
| `src/playwrightWorker.mjs` | Playwright context lifecycle, challenge detection, snapshot capture | ~462 |
| `src/flareClient.mjs` | FlareSolverr HTTP client | ~120 |
| `src/flareSession.mjs` | Optional FlareSolverr session reuse with TTL | ~90 |
| `src/parseUsPhonebookProfile.mjs` | USPhoneBook profile HTML parser (cheerio) | ~200 |
| `src/parseUsPhonebookNameSearch.mjs` | USPhoneBook name-search HTML parser | ~100 |
| `src/truePeopleSearch.mjs` | TPS URL builder + phone/name/profile parsers | ~350 |
| `src/fastPeopleSearch.mjs` | FPS URL builder + phone/name/profile parsers | ~280 |
| `src/thatsThem.mjs` | ThatsThem URL builder + phone/name parsers | ~220 |
| `src/addressEnrichment.mjs` | Census geocoder + Overpass API nearby places | ~200 |
| `src/telecomEnrichment.mjs` | localcallingguide.com carrier lookup | ~120 |
| `src/assessorEnrichment.mjs` | Property assessor scraping (Vision platform + generic) | ~835 |
| `src/sourceCatalog.mjs` | Hardcoded source definitions, roadmap, silos | ~180 |
| `src/sourceSessions.mjs` | Per-source browser session state CRUD | ~172 |
| `src/sourceStrategy.mjs` | ThatsThem URL pattern ranking + trust-failure annotation | ~208 |
| `src/candidateLeads.mjs` | Candidate lead CRUD for manual review | ~124 |
| `src/enrichmentCache.mjs` | SQLite-backed enrichment cache with TTL pruning | ~116 |
| `src/vectorStore.mjs` | Optional ruvector integration with fake SHA-256 embeddings | ~134 |
| `src/mcp/stdio.mjs` | MCP server (JSON-RPC over stdio) exposing graph/cache tools | ~280 |
| `src/phoneEnrichment.mjs` | libphonenumber-js wrapper | ~126 |
| `src/addressFormat.mjs` | Address formatting/presentation utilities | ~155 |
| `src/protectedFetchMetrics.mjs` | In-memory ring buffer for fetch health metrics | ~80 |
| `src/env.mjs` | dotenv loader side-effect | ~7 |

### Data Flow

1. **Query ingestion**: Express routes accept phone numbers, names, or profile paths.
2. **Cache check**: `response_cache` (SQLite) is queried for prior results.
3. **Protected fetch**: If cache miss, `getProtectedPage` selects FlareSolverr or Playwright, fetches HTML, detects challenges.
4. **Parse**: Site-specific cheerio parsers extract structured data.
5. **Normalize**: `normalizedResult.mjs` converts raw parse output into a stable `NORMALIZED_SCHEMA_VERSION = 1` envelope.
6. **Enrich**: Addresses get Census geocoding + Overpass nearby places; phones get libphonenumber + localcallingguide carrier data; assessor records are fetched if configured.
7. **Ingest**: `entityIngest.mjs` upserts entities (`person`, `phone_number`, `address`, `email`) and edges into SQLite.
8. **Expose**: Express returns JSON; MCP tools expose graph traversal and cache introspection.

### Dependencies

- **Express 4.x**: Web framework. No helmet, no rate-limiting, no CORS visible.
- **better-sqlite3 12.x**: Fast synchronous SQLite driver. WAL mode enabled.
- **cheerio 1.x**: Server-side jQuery-like HTML parsing. Every parser is tightly coupled to current site markup.
- **playwright 1.x**: Browser automation for fallback scraping. No stealth plugin, no proxy rotation.
- **libphonenumber-js 1.x**: Phone validation/normalization. Used well.
- **zod 3.x**: Listed in dependencies but I found zero runtime validation of Express route inputs or MCP tool parameters.
- **@modelcontextprotocol/sdk**: MCP server implementation. Basic, no input sanitization.
- **dotenv 16.x**: Environment variable loading.

---

## Implementation Analysis

### What's Working

1. **Normalization envelope (`normalizedResult.mjs`)**: This is the strongest module. It compacts, cleans, and stabilizes heterogeneous parser output into a predictable schema. The `compactObject` helper and `freezeEnvelope` pattern show real API design thinking.
2. **Enrichment cache (`enrichmentCache.mjs`)**: The `withEnrichmentCache` wrapper with `dedupeInflight` is a solid pattern that prevents thundering-herd on expensive external calls. TTL pruning and max-entry enforcement are both present.
3. **Address presentation (`addressFormat.mjs`)**: Thoughtful utility for formatting messy scraped address strings, including title-casing, ZIP+4 spacing, and duplicate date-range stripping.
4. **Cross-source merge (`sourceObservations.mjs`)**: `mergePeopleFinderFacts` cleanly merges facts from multiple sources with source attribution. The normalization keys are sensible.
5. **Test fixtures**: Tests use realistic HTML snippets that mirror actual site markup. The Vision assessor tests in `enrichment.test.mjs` are particularly thorough.

### Critical Issues

#### 1. [Severity: High] `server.mjs` is a 3,356-line monolith

Every route handler, fetch orchestration function, merge logic block, and error response formatter lives in one file. This makes code review nearly impossible, prevents any meaningful unit testing of route handlers, and ensures that merge conflicts will be a nightmare as soon as more than one developer touches the project.

**Impact**: Maintainability collapse; onboarding friction; bug density increases with every added feature.

**Evidence**: `fetchPhoneSearchOnCacheMiss`, `fetchNameSearchOnCacheMiss`, `fetchProfileData`, `fetchMergedProfileData`, `getProtectedPage`, `runProtectedPageWithEngine`, and dozens of route handlers all coexist without any module boundary.

#### 2. [Severity: High] Zero input validation on HTTP surface despite Zod being installed

Express route handlers directly destructure `req.query` and `req.params` into downstream functions. No Zod schemas, no length limits, no regex validation. The MCP tool handlers similarly accept arbitrary JSON-RPC parameters without validation.

**Impact**: Injection vectors, path traversal through `req.query.url`, crashes from malformed phone numbers, and undefined behavior from unexpected object shapes.

**Evidence**: `server.mjs` routes like `/api/phone-search` pass `req.query.phone` directly into `normalizeUsPhoneDigits` and then into cache keys and fetch URLs.

#### 3. [Severity: High] No authentication, rate limiting, or CORS on Express

A server that fetches arbitrary URLs on behalf of clients and stores them in a local graph database is running wide open. Anyone with network access can trigger expensive scrapes, fill the SQLite cache, and potentially use the server as an open proxy.

**Impact**: The application is unsafe to run on any network with untrusted clients. It is trivially vulnerable to abuse and resource exhaustion.

**Evidence**: No `express-rate-limit`, no API key middleware, no CORS configuration, no helmet headers. The `/api/proxy` or proxy-like routes allow external URL fetching.

#### 4. [Severity: High] Cheerio parsers are brittle and will break on every site redesign

All external-source parsers (TPS, FPS, ThatsThem) rely on exact CSS class names and DOM structure. There is no structural fallback, no semantic extraction, and no monitoring to detect when a parser returns empty results because the site changed.

**Impact**: Silent data loss. A site redesign means the parser returns `ok` with zero people, or worse, `no_match`, and the system has no way to alert anyone.

**Evidence**: `parseTruePeopleSearchPhoneHtml` matches `.card.card-block`, `.content-header`, `.content-value`, and specific heading text like `Also Seen As`. `parseFastPeopleSearchPhoneHtml` matches `#email_section`, `#aka-links`, `.link-to-details`. These are all presentation-layer classes that change frequently.

#### 5. [Severity: Medium] Fake vector embeddings in production code

`vectorStore.mjs` contains `fakeEmbeddingFromText`, which deterministically hashes text into a 128-dim Float32Array. It is not an embedding; it has no semantic properties. The module attempts `upsert` and `insert` against ruvector with multiple catch blocks, silently swallowing all errors.

**Impact**: Dead feature bloat. If enabled, it gives users the illusion of semantic search while returning meaningless cosine similarities.

**Evidence**: Lines 36-43 of `vectorStore.mjs` implement `fakeEmbeddingFromText` with a SHA-256 loop. Lines 99-110 silently swallow every vector DB error.

#### 6. [Severity: Medium] Playwright stealth is trivially detectable

The Playwright launcher uses `--disable-blink-features=AutomationControlled`, which is a well-known flag that advanced anti-bot systems detect immediately. There is no `playwright-extra-stealth`, no proxy support, no user-agent rotation, no viewport randomization, and no WebGL/noise injection.

**Impact**: Playwright fallback will be blocked by Cloudflare and similar services more often than necessary.

**Evidence**: `playwrightWorker.mjs` line 287: `args: ["--disable-blink-features=AutomationControlled"]`. No other stealth measures.

#### 7. [Severity: Medium] In-memory metrics and dedupe indexes are lost on restart

`protectedFetchMetrics.mjs` stores fetch health in a process-local ring buffer. `entityIngest.mjs` builds `pathKeyToEntityId` and `peopleProfileSlugToEntityId` as local Maps during batch rebuilds. `contextEntries` and `interactivePages` in `playwrightWorker.mjs` are also process-local.

**Impact**: Restarts reset all operational intelligence. There is no persistence of fetch health trends, no recovery of in-progress deduplication, and no shared state across cluster workers.

#### 8. [Severity: Medium] Assessor enrichment is essentially Maine-only

`getBuiltinAssessorReferences` hardcodes all 16 Maine counties and their NETR Online URLs. The "generic" assessor parser (`parseGenericAssessorHtml`) uses extremely brittle table-row/dt/dd heuristics that will break on any non-trivial assessor site layout.

**Impact**: The feature is not generalizable. Users outside Maine get nothing unless they hand-configure every assessor source themselves.

**Evidence**: `assessorEnrichment.mjs` lines 20-49 are the `MAINE_COUNTY_RESOURCES` array. The generic parser scans for literal label strings like `Owner Name`, `Parcel ID`, `Assessed Value` without any site-specific configuration.

#### 9. [Severity: Medium] Error suppression via empty catch blocks is endemic

Dozens of `.catch(() => {})` patterns litter the codebase. This makes debugging impossible when things fail silently.

**Impact**: Hours lost to phantom failures. Operators cannot distinguish between "site is down" and "parser broke" and "network timed out."

**Evidence**: `playwrightWorker.mjs` lines 89, 274, 299, 338, 347, 360, 407, 434, 446. `vectorStore.mjs` lines 104-109. `assessorEnrichment.mjs` lines 162-165.

#### 10. [Severity: Low] ThatsThem URL pattern strategy is over-engineered

`sourceStrategy.mjs` implements a full pattern-stats tracker with SQLite persistence, candidate scoring, and ranking just to decide whether to use `/reverse-phone-lookup/2072420526` versus `?phone=2072420526`. This is a lot of code for a marginal gain on a single source.

**Impact**: Maintenance burden for a feature that could be a simple ordered list of URL templates with a backoff timer.

#### 11. [Severity: Low] No database migration system

Schema is defined inline in `db/db.mjs` with `CREATE TABLE IF NOT EXISTS`. There is no versioning, no forward migration, no rollback. Adding a column requires manual SQL or deleting the database.

#### 12. [Severity: Low] Environment variable configuration is scattered and loaded via side effects

`import "./env.mjs"` appears in multiple modules, causing dotenv to reload. Each module reads its own env vars at the top level, making it impossible to inspect the full configuration surface without grepping every file.

---

## Real-World Usability

### User Value Assessment

For a solo researcher or small-team OSINT analyst, this tool delivers real value: it automates the tedious work of querying multiple people-search sites, normalizing the results, and building a local graph that can be explored via MCP-aware clients. The enrichment layer (Census geocoding, nearby places, carrier info) adds genuinely useful context.

However, the user experience is entirely API-driven with no UI. The only way to interact is via raw HTTP or an MCP client. This limits the audience to technical users.

### Friction Points

1. **Setup complexity**: Requires Node 22, Playwright with Chromium, optionally FlareSolverr, and a long list of environment variables. No Docker compose file, no setup script.
2. **No feedback when parsers break**: If a source changes its HTML, the user simply gets fewer results with no explanation.
3. **Session management is manual**: Sources marked `sessionMode: "required"` need interactive Playwright sessions opened by hand via API calls.
4. **Assessor records require per-municipality configuration**: The Vision platform and generic template system are powerful but require the user to find and configure every assessor URL themselves.

### Effort vs Value Analysis

The normalization and graph layers are high-value. The protected-fetch pipeline and enrichment caches are medium-value but over-complicated. The vector store is negative-value (fake feature). The ThatsThem pattern-ranking system is low-value for its code volume.

---

## Competitive Analysis

### Similar Implementations Researched

1. **Crawl4AI** (`crawl4ai.com`): A modern async Python/JS crawling framework with built-in stealth, markdown extraction, LLM-ready output, and proxy rotation. It handles JavaScript rendering, anti-bot evasion, and structured extraction via CSS selectors or LLM-based parsing. Compared to this codebase, Crawl4AI offers better stealth, clearer abstractions, and active maintenance.

2. **Scrapy (Python)**: The gold-standard scraping framework. It has middleware for retries, proxy rotation, item pipelines, and a robust selector system. What it lacks is the OSINT-specific normalization and graph ingestion this project provides, but its architecture is vastly superior for maintainability.

3. **Browserless / Skyvern**: Cloud and open-source browser automation with built-in stealth, session pooling, and scaling. They solve the "protected fetch" problem more thoroughly than the homegrown FlareSolverr+Playwright combo here.

4. **ByParr**: A FlareSolverr alternative specifically designed as a drop-in replacement with better challenge handling. The FlareSolverr integration here is functional but not actively adapting to Cloudflare's evolving protections.

5. **Sneakers / Playwright-stealth plugins**: The Node.js ecosystem has `playwright-extra` and `puppeteer-extra-stealth` packages that provide far more sophisticated evasion than the single `--disable-blink-features` flag used here.

### How We Compare

| Dimension | This Project | Competitive Alternatives |
|-----------|-------------|--------------------------|
| Scraping robustness | Low (brittle selectors, weak stealth) | High (Crawl4AI, Scrapy with middleware) |
| Architecture | Poor (monolithic server) | Good (middleware pipelines, plugin systems) |
| OSINT normalization | Good (envelope schema, graph model) | None built-in (would need custom layer) |
| Deployment simplicity | Poor (many manual steps) | Good (Docker, cloud APIs) |
| Maintainability | Poor | Good |
| Security | Poor (no auth, no validation) | N/A (usually run internally) |

### What Users Actually Want

Based on OSINT tool discussions and GitHub issues in similar spaces:

- **Reliable extraction** that does not break monthly when sites redesign.
- **Visual UI** or at least a queryable CLI, not just raw JSON APIs.
- **Export formats** (CSV, Maltego, Gephi) for the graph data.
- **Scheduling / monitoring** to track when a phone number or name gets new results.
- **Alerting** when a source goes down or a parser starts returning empty results.

---

## Recommendations

### Immediate Actions (This Week)

1. **Split `server.mjs` into route modules**: Create `src/routes/phoneSearch.mjs`, `src/routes/nameSearch.mjs`, `src/routes/profile.mjs`, `src/routes/admin.mjs`. Move business logic into `src/services/`. Target under 200 lines per module.
2. **Add Zod validation to every route and MCP tool**: Define schemas for phone numbers (E.164 or 10-digit), names (length limit), and URLs (hostname allowlist). Reject malformed input before any fetch occurs.
3. **Add basic security middleware**: `helmet`, `express-rate-limit`, and an API key check for non-localhost requests. At minimum, require a bearer token for any mutating endpoint.
4. **Delete or hide `vectorStore.mjs`**: If ruvector is not ready, remove the fake embedding code. It creates technical debt and user confusion.
5. **Add parser health checks**: After each parse, compare result count against a 7-day rolling average. If it drops to zero, emit a warning log. This gives early warning of site redesigns.

### Short-Term (This Month)

6. **Implement a real migration system**: Use `better-sqlite3` with a simple `migrations/` folder and a `schema_version` table. Never use `CREATE TABLE IF NOT EXISTS` again.
7. **Consolidate env config**: Create a single `src/config.mjs` that exports a frozen config object derived from env vars. Every other module imports from it. Remove `import "./env.mjs"` side effects from individual modules.
8. **Replace cheerio-only parsing with structural heuristics**: For each source, implement a two-tier parser: first try the current CSS-selector approach, then fall back to semantic heuristics (e.g., "find the heading that looks like a name near a phone number pattern"). This reduces breakage frequency.
9. **Add proxy support to Playwright worker**: Accept `HTTP_PROXY` or per-source proxy config. Rotate proxies on context death.
10. **Improve Playwright stealth**: Evaluate `playwright-extra-stealth` or at least add user-agent rotation, viewport jitter, and plugin mockery.

### Strategic Decisions

#### Refactor: Protected fetch pipeline

The FlareSolverr + Playwright fallback pipeline is the right idea but poorly encapsulated. Extract it into a `src/fetch/` module with a pluggable `FetchEngine` interface:

```typescript
interface FetchEngine {
  name: string;
  fetch(url: string, options: FetchOptions): Promise<FetchResult>;
  health(): Promise<HealthStatus>;
}
```

Implement `FlareEngine`, `PlaywrightEngine`, and `DirectEngine`. Let `server.mjs` (or a service layer) pick the engine based on health metrics rather than a static env var.

#### Pivot: Parser architecture

Consider moving from cheerio-only to a hybrid approach:

- Use **Mozilla Readability** or **Crawl4AI's extraction** to get semantic HTML blocks first.
- Apply regex/selector extraction on the cleaned content.
- For critical sources, maintain a small headless-browser "record mode" that lets an operator click through a real result page and auto-generates selectors.

#### Deprecate: Vector store (until real)

Do not ship fake embeddings. If semantic search is a real requirement, integrate a real embedding model (e.g., via `transformers.js` for local inference or OpenAI API for cloud). Until then, remove the module and the MCP tools that expose it.

#### Keep: Normalization and graph layers

`normalizedResult.mjs`, `entityIngest.mjs`, and `sourceObservations.mjs` are genuinely well-designed. Preserve them during refactoring. The graph model (person, phone_number, address, email nodes with edges) is a solid foundation.

---

## Appendix: Security Quick Hits

- **Arbitrary URL fetching**: The proxy/fetch routes can be used to fetch internal network resources. Add a URL allowlist or block private IP ranges.
- **HTML injection into cache**: Raw HTML is stored in SQLite `response_cache.body_json`. If this HTML is ever rendered in a UI without sanitization, it is an XSS vector.
- **SQL injection**: `better-sqlite3` prepared statements are used correctly in most places, but the `listCandidateLeads` function in `candidateLeads.mjs` interpolates `LIMIT ${limit}` directly into the SQL string. This is a small but real injection vector.
- **Path traversal**: `profileDirForSource` in `playwrightWorker.mjs` sanitizes the source key, but if that logic ever changes, Playwright profile directories could be written outside `data/playwright-profile`.
