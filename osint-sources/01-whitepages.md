# Whitepages.com

**URL:** https://www.whitepages.com  
**Category:** People Directory / Reverse Phone Lookup  
**Access:** Browser Challenge HTML (Cloudflare protected)  
**Integration Difficulty:** Medium

## What Data It Provides

Whitepages is one of the largest US phone directories with nearly 500 million US numbers. Free tier provides:

- Full name associated with phone number
- Location (city/state)
- Line type (landline, mobile, VoIP)
- Carrier information
- Age range
- Address history (limited on free tier)
- Relative hints (limited on free tier)

## Search URL Patterns

### Reverse Phone Lookup
```
https://www.whitepages.com/phone/1-XXX-XXX-XXXX
```
Example: `https://www.whitepages.com/phone/1-555-555-5555`

### Name Search
```
https://www.whitepages.com/name/First-Last/City-State
```
Example: `https://www.whitepages.com/name/John-Smith/Seattle-WA`

### Address Search
```
https://www.whitepages.com/address/123-Main-St/Seattle-WA
```

## Integration Strategy

### 1. URL Builder (`src/whitepages.mjs`)
Create a module similar to `truePeopleSearch.mjs`:

```javascript
const BASE = "https://www.whitepages.com";

export function buildWhitepagesPhoneUrl(rawPhone) {
  const norm = normalizeUsPhoneDigits(rawPhone);
  const digits = norm.digits || String(rawPhone || "").replace(/\D/g, "");
  return `${BASE}/phone/1-${digits.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3")}`;
}

export function buildWhitepagesNameUrl(nameSlug, citySlug, stateSlug) {
  const location = citySlug && stateSlug 
    ? `${citySlug}-${stateSlug}` 
    : stateSlug || "";
  return `${BASE}/name/${encodeURIComponent(nameSlug)}${location ? `/${location}` : ""}`;
}
```

### 2. Parser Strategy
Whitepages uses structured HTML with schema.org markup. Key selectors:

```javascript
// Person name
$("[itemprop='name']").first().text()

// Phone details
$("[data-testid='phone-detail']")

// Location
$("[itemprop='addressLocality']").text()
$("[itemprop='addressRegion']").text()

// Carrier/line type
$(".carrier-info").text()

// Age
$("[data-testid='age']").text()
```

### 3. Block Detection
Whitepages is heavily Cloudflare-protected. Detect:

```javascript
function detectWhitepagesBlockReason(html) {
  const text = normalizeChallengeText(html);
  if (/checking your browser|just a moment|attention required/i.test(text)) {
    return "cloudflare_challenge";
  }
  if (/captcha|recaptcha|hcaptcha/i.test(text)) {
    return "captcha_challenge";
  }
  if (/no name associated with this number/i.test(text)) {
    return "no_match";
  }
  // Result page markers
  if (/href=["'][^"']*\/phone\/1-\d{3}-\d{3}-\d{4}["']/i.test(html)) {
    return null; // Not blocked, has result links
  }
  return null;
}
```

### 4. Session Requirements
- **sessionMode:** `required`
- Requires Playwright persistent context with human-warmed session
- Cloudflare challenges are frequent; manual session warmup in Settings UI needed
- Fall back from FlareSolverr to Playwright-local on challenge

## Data Domains

- `person` (name, age)
- `phone_number` (line type, carrier)
- `address` (city, state, full address)
- `relative` (name hints)

## Benefits to the Program

1. **Massive Coverage:** Nearly 500 million US numbers - largest phone directory
2. **Carrier Intelligence:** Provides carrier and line type data that enriches phone metadata
3. **Cross-Reference:** Can verify names found on other sources (USPhoneBook, TruePeopleSearch)
4. **Address Depth:** Good address history data for profile enrichment
5. **Name Search:** Strong name search with location filtering

## Overlaps

- `usphonebook_phone_search`
- `usphonebook_profile`
- `truepeoplesearch`
- `fastpeoplesearch`

## Implementation Notes

- Whitepages aggressively rate-limits; use `PROTECTED_FETCH_COOLDOWN_MS` of at least 3000ms
- Free tier limits results; parser should handle truncated/partial data gracefully
- Some results redirect to paid pages; detect and classify as `no_match` rather than error
- Use the same session scope pattern as `truepeoplesearch` and `fastpeoplesearch`
