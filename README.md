# usphonebook-flare-app

Express server that fetches [USPhoneBook](https://www.usphonebook.com) phone search pages through **[FlareSolverr](https://github.com/FlareSolverr/FlareSolverr)** (to get past Cloudflare), then parses results with **cheerio**. The static UI and `/api/*` run on the same origin so the browser does not need CORS workarounds.

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
| `FLARE_MAX_TIMEOUT_MS` | No | Default `maxTimeout` for `request.get` (default `240000`) |
| `FLARE_WAIT_AFTER_SECONDS` | No | Flare `waitInSeconds` after a solve; default `0` (omit). Use `1` if HTML is sometimes incomplete. |
| `FLARE_DISABLE_MEDIA` | No | If `1`, set Flare’s `disableMedia` unless overridden per request |
| `PHONE_CACHE_TTL_MS` | No | In-memory cache for successful lookups, default `86400000` (24h). `0` disables. |
| `PHONE_CACHE_MAX` | No | Max distinct phone numbers cached, default `500` (oldest evicted) |
| `PHONE_CACHE_BYPASS` | No | Comma-separated param names; `?nocache=1` (etc.) forces a fresh Flare fetch |
| `NAME_SEARCH_CACHE_TTL_MS` | No | Cache TTL for parsed USPhoneBook name searches (defaults to `PHONE_CACHE_TTL_MS`) |
| `NAME_SEARCH_CACHE_MAX` | No | Max cached name-search queries (default `250`) |
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
- `GET /api/phone-search?phone=207-242-0526&maxTimeout=240000&wait=0&disableMedia=1&proxy=http://...` — repeat same `phone` returns cached JSON with `"cached": true` (until TTL); add `&nocache=1` to bypass.
- `POST /api/phone-search` with JSON `{ "phone": "…", "maxTimeout": 240000, "waitInSeconds": 0, "proxy": { "url": "http://…" } }` (Flare [proxy](https://github.com/FlareSolverr/FlareSolverr) for outbound fetches)
- `GET /api/name-search?name=John+Doe&city=Portland&state=ME&maxTimeout=240000&disableMedia=1` — mirrors USPhoneBook’s people-search route rewrite and returns parsed candidate rows; repeat same query returns cached JSON with `"cached": true` unless bypassed.
- `POST /api/name-search` with JSON `{ "name": "John Doe", "city": "Portland", "state": "ME", "maxTimeout": 240000 }`

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

Typical levers (try in order):

- Raise **`FLARE_MAX_TIMEOUT_MS`** in `.env` (the demo UI and default are `240000`; increase if challenges still time out).
- Set **`FLARE_DISABLE_MEDIA=1`** (or per-request `disableMedia=1` on the API) so the headless page skips heavy resources.
- On the **FlareSolverr host**, check logs (`LOG_LEVEL=debug`), CPU/RAM, and that **Chrome** inside the container is healthy. Update **FlareSolverr** if you are on an old v3.4.x.
- Some sites block **datacenter / VPN IPs**; a **residential proxy** passed in the Flare [proxy](https://github.com/FlareSolverr/FlareSolverr#-requestget) field can help, but is not always allowed.

## Speed (typical 40–90s is mostly Flare + browser)

**Session reuse (default off):** with default settings this app does **not** call `sessions.create` and does **not** pass `session` on `request.get`—each lookup uses a fresh browser instance from Flare’s perspective. The **phone cache** still avoids Flare on repeat numbers. Set **`FLARE_REUSE_SESSION=1`** to reuse one Flare `session` (faster, one warm browser) per [Flare’s session API](https://github.com/FlareSolverr/FlareSolverr#-sessions.create). On Docker, watch for process explosion before enabling. Optional **`FLARE_SESSION_TTL_MINUTES`** sets **`session_ttl_minutes`** when reuse is on.

**Also:** **`FLARE_DISABLE_MEDIA=1`**, **low network latency** to Flare, and **`FLARE_WAIT_AFTER_SECONDS=0`**. If sessions feel sluggish after many requests, use TTL rotation or restart Flare; see upstream [issues about long session slowdown](https://github.com/FlareSolverr/FlareSolverr/issues).

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
| `ASSESSOR_SOURCES_JSON` | No | JSON array of county assessor search templates matched by state/county |
| `ASSESSOR_CACHE_TTL_MS` | No | County assessor record cache TTL (default `1209600000`) |
| `ASSESSOR_TIMEOUT_MS` | No | County assessor fetch timeout (default `25000`) |

### External-source caveats

- **TruePeopleSearch** and **That’s Them** may block automated access with Cloudflare / captcha pages. The app detects and surfaces that status instead of silently pretending there was no data.
- There is no single magic anti-bot trust slider. The safest improvements are: stable browser sessions, realistic browser headers, lower request burstiness, consistent IP geography, and residential or otherwise reputable exit IPs when legally appropriate.
- The assessor layer is intentionally **config-driven** because there is no universal county appraiser layout. Once a county template URL is configured, the app attempts generic owner/parcel/value extraction from tables, `<dl>` blocks, and JSON-LD.
- In **Maine**, county references are included automatically, but actual assessment/tax detail is often municipal. Treat the built-in Maine records as a county-aware launch point, then add municipality-specific `ASSESSOR_SOURCES_JSON` entries for the towns you care about most.
- The telecom layer is local and deterministic; it classifies NANP numbers, toll-free ranges, N11 service codes, and basic numbering-plan structure without additional external APIs.

### Verification commands

```bash
npm run test:parse
npm run test:enrich
```
