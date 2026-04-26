# OSINT Sources Research & Integration Guide

This folder contains research on external OSINT (Open Source Intelligence) sources that can be integrated into the usphonebook-flare-app scraping pipeline. Each source is documented with its data offerings, URL patterns, parser strategy, block detection, and integration benefits.

## How to Read These Files

Each markdown file follows a consistent structure:
- **Source name and URL**
- **Category and access method** (browser HTML, direct HTTP, etc.)
- **Integration difficulty** (Low / Medium / High)
- **What data it provides**
- **Search URL patterns** for phone, name, and address lookups
- **Integration strategy** with code examples
- **Block/challenge detection** patterns
- **Data domains** (what entity types it enriches)
- **Benefits to the program**
- **Overlaps** with existing sources
- **Implementation notes**

## Source Index

### Tier 1: High-Value People Search Directories (Immediate Integration Candidates)

| # | Source | Difficulty | Unique Value |
|---|--------|------------|--------------|
| 01 | [Whitepages.com](01-whitepages.md) | Medium | 500M US numbers, carrier data |
| 02 | [AnyWho.com](02-anywho.md) | Medium | Family data, social hints, completely free |
| 03 | [ZabaSearch.com](03-zabasearch.md) | Medium | Intelius backbone, alphabetical directories |
| 04 | [Addresses.com](04-addresses-com.md) | Medium | Address-centric, reverse address, business listings |
| 06 | [NumLookup.com](06-numlookup.md) | Low-Medium | Carrier/spam risk, email addresses |
| 07 | [SpyDialer.com](07-spydialer.md) | Medium | **Voicemail audio**, photos, user reports |
| 10 | [CocoFinder](10-cocofinder.md) | Medium | DOB, criminal record hints |
| 11 | [PeopleFinders.com](11-peoplefinders.md) | Medium | Associates, marriage records, business affiliations |

### Tier 2: Specialized & Pivot Sources

| # | Source | Difficulty | Unique Value |
|---|--------|------------|--------------|
| 05 | [PeekYou.com](05-peekyou.md) | Medium-High | Social media profile links, usernames |
| 08 | [ClustrMaps.com](08-clustrmaps.md) | Medium | **Address-first** discovery, co-residents, property data |
| 09 | [Spokeo.com](09-spokeo.md) | High | Next.js structured data, comprehensive database |

### Tier 3: Advanced OSINT & Enrichment

| # | Source | Difficulty | Unique Value |
|---|--------|------------|--------------|
| 12 | [Social Media OSINT](12-social-media-osint.md) | High | Facebook, LinkedIn, Twitter/X, Instagram |
| 13 | [Public Records & Government](13-public-records-government.md) | High | County assessors, voter records, court records, licenses |
| 14 | [Email OSINT](14-email-osint.md) | Low-Medium | Hunter.io, email permutation, format guessing |
| 15 | [Property Records](15-property-records.md) | Medium | Realtor.com, Zillow, PropertyShark, owner-resident divergence |

## Integration Architecture

These sources follow the same architecture patterns already established in the codebase:

1. **Source Catalog Entry** - Add to `src/sourceCatalog.mjs` `SOURCE_DEFINITIONS`
2. **URL Builder Module** - Create `src/{source}.mjs` with `build{Source}PhoneUrl()`, `build{Source}NameUrl()`
3. **Parser Module** - Export `parse{Source}PhoneHtml()`, `parse{Source}NameHtml()`, `parse{Source}ProfileHtml()`
4. **Block Detection** - Export `detect{Source}BlockReason()`, `is{Source}Blocked()`
5. **Server Integration** - Add fetch functions to `src/server.mjs` `enrichPhoneWithExternalSources()`
6. **Source Sessions** - Register in `src/sourceSessions.mjs` if sessionMode is "required"
7. **Graph Ingestion** - Ensure parsed data maps to existing entity types (person, phone_number, address, email, relative, org)

## Recommended Implementation Order

1. **NumLookup** (lowest difficulty, unique carrier/spam data)
2. **CocoFinder** (DOB is a strong identity anchor)
3. **Whitepages** (largest directory, but high anti-bot)
4. **ClustrMaps** (address-centric pivoting)
5. **SpyDialer** (voicemail audio is unique tactical value)
6. **PeekYou** (social media pivoting)
7. **Email OSINT** (local logic, no scraping risk)
8. **Property Records** (address enrichment)
9. **Public Records** (long-term, high-value, driver-based architecture)
10. **Social Media** (highest risk, use dedicated accounts)

## Anti-Bot Considerations

All new sources should implement:
- `PROTECTED_FETCH_COOLDOWN_MS` between requests
- Playwright persistent context sessions where needed
- Cloudflare challenge detection and classification
- Graceful handling of paywalls (classify as `no_match`, not error)
- Source-specific user agents and headers
- Request/response telemetry for debugging

## Data Quality & Ethics

- All sources listed provide **publicly available data** or data derived from public records
- No APIs are used; all integration is via HTML scraping or local logic
- Parser outputs should be cached via `withEnrichmentCache()` to minimize re-scraping
- Source trust failures should be recorded via `recordProtectedFetchEvent()`
- Paid redirects should be detected and handled gracefully
