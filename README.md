# usphonebook-flare-app

Express server that fetches [USPhoneBook](https://www.usphonebook.com) phone search pages through **[FlareSolverr](https://github.com/FlareSolverr/FlareSolverr)** (to get past Cloudflare), then parses results with **cheerio**. The static UI and `/api/*` run on the same origin so the browser does not need CORS workarounds.

## Platform guides

- Linux users: see [`README-linux.md`](./README-linux.md) for a Linux-first setup and troubleshooting guide.

## You must have FlareSolverr running

This app does **not** bundle or start FlareSolverr. You need a **FlareSolverr server already running** and reachable from the machine that runs this app—typically a Docker container on another host, e.g. `flaresolverr/flaresolverr:v3.4.6` with port **8191** published.

Point this app at it with **`FLARE_BASE_URL`**: the full HTTP base URL, **no path** (Flare’s API is at `…/v1`).

**Examples**

- Flare on the same machine with port mapped to `localhost`:`http://127.0.0.1:8191`
- Flare on another host on your LAN: `http://192.168.1.50:8191` (use that host’s real IP or hostname, not a Docker internal IP like `172.19.0.3` unless this client is on the same Docker network)

**Firewall / Docker:** The Flare container must accept TCP connections to **8191** from where this app runs. Ensure the port is published to the host (`-p 8191:8191` or your compose mapping) and that the host or firewall allows the client.

**`172.19.x.x` (Docker bridge):** That address is only routable from containers or hosts attached to the *same* Docker network. If you run this Node app on your laptop/PC, set `FLARE_BASE_URL` to the **host machine’s LAN IP and published port** (e.g. `http://192.168.1.10:8191`), not the container’s internal IP.

## Config on disk

`env.example` is a template. Copy it to **`.env`** in the app root and set `FLARE_BASE_URL`. The app loads that file with [dotenv](https://github.com/motdotla/dotenv) on startup. Use **`DOTENV_PATH=/absolute/path/.env`** if the process working directory is not the app root.

## Check Flare connectivity

```bash
npm run probe:flare
```

Expect `HTTP: 200` and a JSON body with `sessions` (and no `status: "error"`). If it times out, fix `FLARE_BASE_URL` to an address this machine can actually reach, then re-run.

## Config

| Variable | Required | Meaning |
| -------- | -------- | ------- |
| **`FLARE_BASE_URL`** | Yes (or use default `http://127.0.0.1:8191`) | FlareSolverr base URL, e.g. `http://10.0.0.5:8191` |
| `PROTECTED_FETCH_ENGINE` | No | Protected-page engine. `flare` is the default FlareSolverr path, `playwright-local` uses the local Playwright worker, and `auto` tries Playwright first then falls back to Flare. |
| `PROTECTED_FETCH_FALLBACK_ON_FLARE_ERROR` | No | Default `1`. When `engine=flare`, retry Flare timeout / 5xx / challenge-style failures with the fallback engine instead of failing immediately. |
| `PROTECTED_FETCH_FALLBACK_ENGINE` | No | Fallback engine used after a Flare failure, default `playwright-local` |
| `PROTECTED_FETCH_COOLDOWN_MS` | No | Delay between protected fetches to reduce burstiness (default `1500`) |
| `CHROME_EXECUTABLE_PATH` | No | Absolute path to a local Chrome/Chromium binary for `playwright-local`. If unset, the app tries common OS locations and then falls back to Playwright's bundled Chromium. |
| `SCRAPE_LOGGING` | No | Default `1`. Emits live scrape progress logs in the Node terminal for protected fetches, parsing, and source follow-ups. |
| `SCRAPE_PROGRESS_INTERVAL_MS` | No | Heartbeat interval for long-running scrape steps (default `15000`) |
| `FLARE_MAX_TIMEOUT_MS` | No | Default `maxTimeout` for `request.get` (default `240000`) |
| `FLARE_PROXY_URL` | No | Default outbound proxy for Flare `request.get` when a request does not pass `proxy.url`, e.g. `http://user:pass@host:port` |
| `FLARE_WAIT_AFTER_SECONDS` | No | Flare `waitInSeconds` after a solve; default `0` (omit). Use `1` if HTML is sometimes incomplete. |
| `FLARE_DISABLE_MEDIA` | No | If `1`, set Flare’s `disableMedia` unless overridden per request |
| `PHONE_CACHE_TTL_MS` | No | In-memory cache for successful lookups, default `86400000` (24h). `0` disables. |
| `PHONE_CACHE_MAX` | No | Max distinct phone numbers cached, default `500` (oldest evicted) |
| `PHONE_CACHE_BYPASS` | No | Comma-separated param names; `?nocache=1` (etc.) forces a fresh Flare fetch |
| `NAME_SEARCH_CACHE_TTL_MS` | No | Cache TTL for parsed USPhoneBook name searches (defaults to `PHONE_CACHE_TTL_MS`) |
| `NAME_SEARCH_CACHE_MAX` | No | Max cached name-search queries (default `250`) |
| `SQLITE_PATH` | No | Absolute or relative path for the SQLite database file. Useful on shared Linux hosts or when you want data outside the repo's `data/` directory. |
| `FLARE_REUSE_SESSION` | No | Default `0` (per-request Flare: no `sessions.create`, no shared `session` id). Set `1` to reuse one Flare session for all `request.get` (faster but one long-lived browser; avoid on constrained Docker). |
| `FLARE_SESSION_TTL_MINUTES` | No | If set, passed as Flare `session_ttl_minutes` on `request.get` to rotate the session. |
| `APP_PORT` | No | This app (default `3040`) |
| `DOTENV_PATH` | No | Path to a `.env` file if not using `app/.env` |

```bash
cp env.example .env
# edit .env — set FLARE_BASE_URL
npm install
npm start
```

Or set `export FLARE_BASE_URL=...` in the shell (overrides values from `.env` if exported before `dotenv` load—dotenv does not override existing env vars by default).

## API

- `GET /api/health` — checks Flare with `sessions.list` (also shows `flareBase` in the JSON)
- `GET /api/trust-health` — rolling protected-fetch trust diagnostics: challenge rate, success rate, median duration, and recent events
- `GET /api/phone-search?phone=207-242-0526&maxTimeout=240000&wait=0&disableMedia=1&proxy=http://...` — repeat same `phone` returns cached JSON with `"cached": true` (until TTL); add `&nocache=1` to bypass.
- `POST /api/phone-search` with JSON `{ "phone": "…", "maxTimeout": 240000, "waitInSeconds": 0, "proxy": { "url": "http://…" } }` (Flare [proxy](https://github.com/FlareSolverr/FlareSolverr) for outbound fetches)
- `GET /api/name-search?name=John+Doe&city=Portland&state=ME&maxTimeout=240000&disableMedia=1` — mirrors USPhoneBook’s people-search route rewrite and returns parsed candidate rows; repeat same query returns cached JSON with `"cached": true` unless bypassed.
- `POST /api/name-search` with JSON `{ "name": "John Doe", "city": "Portland", "state": "ME", "maxTimeout": 240000 }`

All protected fetch routes also accept `engine=flare`, `engine=playwright-local`, or `engine=auto` per request.

### Normalized internal result contract

Phone search, name search, and profile enrich responses now also include a shared `normalized` object intended for internal downstream integrations. The existing raw payloads remain intact for backward compatibility.

`normalized` shape:

- `schemaVersion`
- `source`
- `kind` — one of `phone_search`, `name_search`, `profile_lookup`
- `query` — request context such as phone, name/city/state, or profile path
- `meta` — source URL, HTTP status, cache flags, graph eligibility, and record count
- `summary` — small route-specific summary counts
- `records[]` — normalized person/listing/candidate records with shared fields like:
	- `recordType`
	- `displayName`
	- `profilePath`
	- `age`
	- `aliases[]`
	- `emails[]`
	- `phones[]`
	- `addresses[]`
	- `relatives[]`
	- `sourceFields`

This contract is now used by graph rebuild flows when present, while the UI still renders from the existing raw route-specific payloads in this minimal pass.

Use in compliance with USPhoneBook’s terms and applicable law.

## “Error solving the challenge. Timeout after …”

FlareSolverr is **contactable**, but it did not finish the **Cloudflare / browser challenge** on `usphonebook.com` before `maxTimeout`. That is reported as **HTTP 500** from Flare, which this app surfaces as an error.

This repo now also logs the protected-fetch stage to the Node terminal and, by default, treats Flare timeout / 5xx failures as recoverable: it immediately retries that same URL with the local Playwright engine instead of stopping at the Flare 500.

Typical levers (try in order):

- Raise **`FLARE_MAX_TIMEOUT_MS`** in `.env` (the demo UI and default are `240000`; increase if challenges still time out).
- Set **`FLARE_DISABLE_MEDIA=1`** (or per-request `disableMedia=1` on the API) so the headless page skips heavy resources.
- If your normal exit IP is challenged, set **`FLARE_PROXY_URL`** in `.env` so all Flare-backed requests use the same better proxy path by default.
- On the **FlareSolverr host**, check logs (`LOG_LEVEL=debug`), CPU/RAM, and that **Chrome** inside the container is healthy. Update **FlareSolverr** if you are on an old v3.4.x.
- Some sites block **datacenter / VPN IPs**; a **residential proxy** passed in the Flare [proxy](https://github.com/FlareSolverr/FlareSolverr#-requestget) field can help, but is not always allowed.

## Live scrape logs

When the server is running, the Node terminal now prints lines such as:

```text
[scrape usphonebook_phone_search:abc123] phone search started phone=207-649-1000 requestedEngine=flare maxTimeout=120000
[scrape usphonebook_phone_search:abc123] flare fetch: still running engine=flare timeoutMs=120000 elapsed=15s
[scrape usphonebook_phone_search:abc123] flare failed; trying fallback engine fallbackEngine=playwright-local error="FlareSolverr HTTP 500: Error: Error solving the challenge. Timeout after 120.0 seconds."
[scrape usphonebook_phone_search:abc123] playwright-local fetch completed engine=playwright-local status=ok elapsed=7.2s finalUrl=www.usphonebook.com/phone-search/207-649-1000 htmlBytes=48231
```

Use `SCRAPE_LOGGING=0` to silence these logs, or change `SCRAPE_PROGRESS_INTERVAL_MS` if you want the heartbeat more or less frequently.

## Speed (typical 40–90s is mostly Flare + browser)

**Session reuse (default off):** with default settings this app does **not** call `sessions.create` and does **not** pass `session` on `request.get`—each lookup uses a fresh browser instance from Flare’s perspective. The **phone cache** still avoids Flare on repeat numbers. Set **`FLARE_REUSE_SESSION=1`** to reuse one Flare `session` (faster, one warm browser) per [Flare’s session API](https://github.com/FlareSolverr/FlareSolverr#-sessions.create). On Docker, watch for process explosion before enabling. Optional **`FLARE_SESSION_TTL_MINUTES`** sets **`session_ttl_minutes`** when reuse is on.

**Also:** **`FLARE_DISABLE_MEDIA=1`**, **low network latency** to Flare, and **`FLARE_WAIT_AFTER_SECONDS=0`**. If sessions feel sluggish after many requests, use TTL rotation or restart Flare; see upstream [issues about long session slowdown](https://github.com/FlareSolverr/FlareSolverr/issues).

## Optional Playwright Worker

This repo can now be pointed at a local protected-page engine with `PROTECTED_FETCH_ENGINE=playwright-local`, or to a hybrid mode with `PROTECTED_FETCH_ENGINE=auto`. The current implementation is additive: Flare remains available, while Playwright uses a persistent Chromium profile under `data/playwright-profile`.

To use it locally:

```bash
npm install
npx playwright install chromium
```

### Windows and Linux notes

- **Windows:** `playwright-local` auto-detects Chrome in the usual `Program Files` and `%LOCALAPPDATA%` locations. If Chrome lives somewhere unusual, set `CHROME_EXECUTABLE_PATH` in `.env`.
- **Linux:** install Playwright's browser/runtime bundle with `npx playwright install --with-deps chromium` on supported Debian/Ubuntu systems. If you want a branded Google Chrome binary for better anti-bot fidelity, install `google-chrome-stable` (or point `CHROME_EXECUTABLE_PATH` at your distro-specific Chrome/Chromium path). If no system Chrome is found, the app falls back to Playwright's bundled Chromium.
- **Shared or multi-user Linux hosts:** set `SQLITE_PATH` if you want the database outside the repo tree, and make sure the `data/playwright-profile/` directory is writable by the user running the app.

Playwright officially supports Windows and Linux, but Linux browser dependencies are stricter than Windows. If the browser fails to start on Linux, `npx playwright install --with-deps chromium` is the first wrench to grab.

Then set `PROTECTED_FETCH_ENGINE=playwright-local` or `PROTECTED_FETCH_ENGINE=auto` in `.env` and restart the app. You can also override per request by passing `engine=playwright-local`, `engine=flare`, or `engine=auto` to phone/name/profile routes.

In `auto` mode the server tries Playwright first and falls back to Flare when the Playwright attempt ends in challenge-required, timeout, or another protected-fetch error.

The current Playwright slice does not yet include a full UI-driven manual handoff flow. When a challenge page is detected it surfaces `challengeRequired` in the API response so the next step can wire that into the queue/UI instead of treating it like a generic parser failure.

## Parser self-test (no Flare, no network)

```bash
npm run test:parse
```

## Enrichment now included in results and graph rebuilds

Completed phone/profile jobs now carry three extra layers of context:

- **Phone metadata** via `libphonenumber-js` — normalized dashed/E.164 formats, country, validity, and line type when available.
- **Census address geocoding** — matched address, coordinates, and census geography for parsed U.S. addresses.
- **Nearby-place context** via **Overpass** — a small cached, rate-limited list of nearby POIs around geocoded addresses.

These enrichments flow through both live API responses and `POST /api/graph/rebuild`, so rebuilding the graph from saved queue jobs preserves the added context.

Completed phone lookups now also attempt a lightweight **external-source comparison** layer:

- **TruePeopleSearch** reverse-phone corroboration
- **That’s Them** reverse-phone corroboration / captcha detection
- **telecom numbering analysis** for NANP area-code and special-use classification

Profile address enriches also support a configurable **county assessor / property appraiser** framework. Because county sites vary wildly, assessor lookups are driven by `ASSESSOR_SOURCES_JSON` templates plus generic HTML field extraction.

For **Maine**, the app now ships with built-in county-aware property-resource references for all 16 counties derived from census county matches. These do not require custom config and point to Maine county/municipal property-record directories, which is useful because Maine assessment data is commonly managed at the municipal rather than county level.

### Public-source enrichment notes

- **No API key is required** for the U.S. Census geocoder.
- Overpass is also public/free, but this app caches results and spaces requests out by default to avoid hammering public infrastructure.
- If you plan to use Overpass heavily, set `OSINT_CONTACT_EMAIL` (or a custom `ENRICHMENT_USER_AGENT`) in `.env` so requests identify your instance more politely.

### Additional config

| Variable | Required | Meaning |
| -------- | -------- | ------- |
| `ENRICHMENT_CACHE_MAX` | No | Max persistent public-enrichment cache rows (default `5000`) |
| `ENRICHMENT_HTTP_TIMEOUT_MS` | No | Timeout for Census / Overpass requests (default `20000`) |
| `ENABLE_EXTERNAL_PEOPLE_SOURCES` | No | Enable TruePeopleSearch / That’s Them comparison lookups (default `1`) |
| `EXTERNAL_SOURCE_TIMEOUT_MS` | No | Timeout for external people-finder fetches (default `45000`) |
| `EXTERNAL_SOURCE_CACHE_TTL_MS` | No | Cache TTL for external people-finder results (default `604800000`) |
| `EXTERNAL_SOURCE_USER_AGENT` | No | Browser-like User-Agent for direct external-source fetches |
| `EXTERNAL_SOURCE_ACCEPT_LANGUAGE` | No | Accept-Language header for direct external-source fetches |
| `OSINT_CONTACT_EMAIL` | No | Contact email appended to public-source requests |
| `ENRICHMENT_USER_AGENT` | No | Explicit User-Agent for public-source requests |
| `CENSUS_CACHE_TTL_MS` | No | Census geocode cache TTL (default `2592000000`) |
| `CENSUS_BENCHMARK` | No | Census benchmark (default `Public_AR_Current`) |
| `CENSUS_VINTAGE` | No | Census vintage (default `Current_Current`) |
| `OVERPASS_CACHE_TTL_MS` | No | Overpass nearby-place cache TTL (default `2592000000`) |
| `OVERPASS_RADIUS_METERS` | No | Nearby-place search radius (default `500`) |
| `OVERPASS_MAX_PLACES` | No | Max nearby places stored per address (default `8`) |
| `OVERPASS_MIN_INTERVAL_MS` | No | Minimum delay between Overpass requests (default `1100`) |
| `OVERPASS_ENDPOINT` | No | Override Overpass API endpoint |
| `ASSESSOR_SOURCES_JSON` | No | JSON array of assessor search templates matched by state/county/city |
| `ASSESSOR_SOURCES_FILE` | No | Path to a JSON file containing the same assessor template array; easier than stuffing large configs into `.env` |
| `ASSESSOR_CACHE_TTL_MS` | No | County assessor record cache TTL (default `1209600000`) |
| `ASSESSOR_TIMEOUT_MS` | No | County assessor fetch timeout (default `25000`) |
| `ASSESSOR_LOGGING` | No | Default `1`. Enables assessor lookup logs in the Node terminal. |
| `ASSESSOR_LOG_LEVEL` | No | Default `signal`. Use `signal` for cache/result/error summaries, `verbose` for step-by-step tracing, or `off` to silence assessor logs. |

### External-source caveats

- **TruePeopleSearch** and **That’s Them** may block automated access with Cloudflare / captcha pages. The app detects and surfaces that status instead of silently pretending there was no data.
- There is no single magic anti-bot trust slider. The safest improvements are: stable browser sessions, realistic browser headers, lower request burstiness, consistent IP geography, and residential or otherwise reputable exit IPs when legally appropriate.
- The assessor layer is intentionally **config-driven** because there is no universal county appraiser layout. Once a county template URL is configured, the app attempts generic owner/parcel/value extraction from tables, `<dl>` blocks, and JSON-LD.
- In **Maine**, county references are included automatically, but actual assessment/tax detail is often municipal. Treat the built-in Maine records as a county-aware launch point, then add municipality-specific assessor configs for the towns you care about most.

### Assessor setup

The orange `Assessor ref` badge means the app only has built-in resource links. To get real parcel fields like owner, parcel ID, and assessed value, add assessor configs that point at searchable municipal/county property pages.

Each config supports these common fields:

- `key`: stable source ID
- `name`: display name
- `state`: two-letter state filter
- `countyIncludes`: optional county-name substrings
- `cityIncludes` or `townIncludes`: optional city/town-name substrings
- `searchUrlTemplate`: URL template using placeholders like `{encodedAddress}`, `{encodedStreet}`, `{city}`, `{citySlug}`, `{state}`, `{county}`, `{zip}`
- `platform`: optional built-in platform driver such as `vision`
- `baseUrl`: required for built-in platform drivers like `vision`, for example `https://gis.vgsi.com/augustame/`
- `maxTimeout`: optional per-source timeout override
- `useFlare`: set `true` only if that property site needs the protected fetch path

You can keep these in `.env` via `ASSESSOR_SOURCES_JSON`, but for anything beyond one or two sites, use `ASSESSOR_SOURCES_FILE` instead.

The repo now includes a Maine Vision starter file at `docs/assessor-sources.maine.vision.json`. Point `ASSESSOR_SOURCES_FILE` at it to turn on the first reusable municipal assessor family.

Assessor logs default to a high-signal mode so they stay useful when you send them back for bad matches: cache hit/miss, accepted parcel, rejected parcel, and upstream errors. Switch `ASSESSOR_LOG_LEVEL=verbose` only when you need the full search flow.
- The telecom layer is local and deterministic; it classifies NANP numbers, toll-free ranges, N11 service codes, and basic numbering-plan structure without additional external APIs.

### Verification commands

```bash
npm run test:parse
npm run test:enrich
```
