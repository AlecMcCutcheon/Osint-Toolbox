# ZabaSearch.com

**URL:** https://www.zabasearch.com  
**Category:** People Search Engine  
**Access:** Browser HTML (powered by Intelius)  
**Integration Difficulty:** Medium

## What Data It Provides

ZabaSearch is a free people search engine powered by Intelius. Free tier provides:

- Full name
- Age
- Address (current and past)
- Partial phone numbers (last 4 digits hidden on free tier)
- City and state
- Name search by first/last name
- Reverse phone search
- Alphabetical people directory

## Search URL Patterns

### Name Search
```
https://www.zabasearch.com/people/search?first=First&last=Last&state=ST&city=City
```
Example: `https://www.zabasearch.com/people/search?first=John&last=Smith&state=WA`

### Reverse Phone Search
```
https://www.zabasearch.com/phone/XXXXXXXXXX
```
Example: `https://www.zabasearch.com/phone/5555555555`

### Alphabetical Directory
```
https://www.zabasearch.com/directory/{state}/{letter}
```

## Integration Strategy

### 1. URL Builder

```javascript
const BASE = "https://www.zabasearch.com";

export function buildZabaSearchPhoneUrl(rawPhone) {
  const digits = String(rawPhone || "").replace(/\D/g, "");
  return `${BASE}/phone/${encodeURIComponent(digits)}`;
}

export function buildZabaSearchNameUrl(first, last, city, stateAbbrev) {
  const params = new URLSearchParams();
  params.set("first", first);
  params.set("last", last);
  if (city) params.set("city", city);
  if (stateAbbrev) params.set("state", stateAbbrev);
  return `${BASE}/people/search?${params.toString()}`;
}
```

### 2. Parser Strategy
ZabaSearch results are structured in cards:

```javascript
function parseZabaSearchResultCard($, root) {
  const $root = $(root);
  const displayName = $root.find(".result-name, h3 a").first().text().trim();
  const age = $root.find(".result-age").text().match(/(\d+)/)?.[1] || null;
  const address = $root.find(".result-address").text().trim();
  // Phone numbers may be partially masked (XXX-XXX-__XX)
  const phones = [];
  $root.find(".result-phone").each((_, el) => {
    const raw = $(el).text();
    const norm = normalizeUsPhoneDigits(raw);
    if (norm.dashed) phones.push({ display: raw, dashed: norm.dashed });
  });
  const relatives = [];
  $root.find(".result-relative").each((_, el) => {
    relatives.push({ name: $(el).text().trim(), path: null });
  });
  return { displayName, age, addresses: address ? [{ label: address, formattedFull: address }] : [], phones, relatives };
}
```

### 3. Block Detection

```javascript
function detectZabaSearchBlockReason(html) {
  const text = normalizeChallengeText(html);
  if (/i agree|terms of use|privacy policy/i.test(text) && /agree button|i agree/i.test(text)) {
    return "terms_acceptance_required";
  }
  if (/captcha|recaptcha|verify you are human/i.test(text)) {
    return "captcha_challenge";
  }
  if (/no results found|we did not find/i.test(text)) {
    return "no_match";
  }
  // Intelius redirect detection
  if (/intelius\.com\/checkout/i.test(html)) {
    return "paid_redirect";
  }
  return null;
}
```

### 4. Session Requirements
- **sessionMode:** `optional`
- Often requires clicking "I Agree" to terms before searching
- Playwright can auto-accept terms if the checkbox/button is predictable
- May redirect to Intelius paid pages; classify as `no_match` rather than error

## Data Domains

- `person` (name, age)
- `address` (current and past)
- `phone_number` (may be partial on free tier)
- `relative`

## Benefits to the Program

1. **Intelius Data Backbone:** Access to Intelius's massive public records database
2. **Alphabetical Directory:** Can be used for broad name enumeration by state
3. **Free Tier Viable:** Basic name/age/address data is free
4. **Cross-Reference Value:** Good for confirming addresses found on other sources
5. **State Filtering:** Strong state/city filtering for name searches

## Overlaps

- `usphonebook_phone_search`
- `usphonebook_profile`
- `truepeoplesearch`
- `fastpeoplesearch`
- `whitepages`

## Implementation Notes

- The "I Agree" terms acceptance is a key challenge; Playwright can auto-click it
- Phone numbers are often masked on free results; parser should handle partial numbers
- Redirects to Intelius checkout should be detected and treated as `no_match`
- Conservative request pacing needed (Intelius backend rate-limiting)
