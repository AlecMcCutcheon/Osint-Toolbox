# AnyWho.com

**URL:** https://www.anywho.com  
**Category:** People Directory / White Pages  
**Access:** Browser HTML (moderate protection)  
**Integration Difficulty:** Medium

## What Data It Provides

AnyWho is a free people search and white pages directory. Free tier provides:

- Full name
- Age and gender
- Full address
- Phone number
- Email address (sometimes)
- Social media profiles (hints)
- Family members information
- Property ownership
- Marital status
- Employment history (limited)

## Search URL Patterns

### Reverse Phone Lookup
AnyWho uses a search form rather than direct URLs for phone lookup. The search POSTs to:
```
https://www.anywho.com/phone-search
```
With form data: `phone=XXX-XXX-XXXX`

### Name Search
```
https://www.anywho.com/people-search?name=First+Last&city=City&state=ST
```

### Address Search
```
https://www.anywho.com/address-search
```

## Integration Strategy

### 1. URL Builder & Fetch
AnyWho requires form submission rather than direct URL access. Integration would use Playwright to:

```javascript
const BASE = "https://www.anywho.com";

export function buildAnywhoPhoneUrl(rawPhone) {
  const norm = normalizeUsPhoneDigits(rawPhone);
  const dashed = norm.dashed || String(rawPhone || "").replace(/\D/g, "").replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3");
  // AnyWho uses form POST; return the search page URL
  return `${BASE}/phone-search`;
}

export function buildAnywhoNameUrl(name, city, stateAbbrev) {
  const params = new URLSearchParams();
  params.set("name", name);
  if (city) params.set("city", city);
  if (stateAbbrev) params.set("state", stateAbbrev);
  return `${BASE}/people-search?${params.toString()}`;
}
```

### 2. Form-Submission Strategy
Since AnyWho uses form POSTs for phone search, the fetch strategy differs from direct-URL sources:

```javascript
async function fetchAnywhoPhonePage(dashed, page) {
  // Navigate to the phone search page
  await page.goto("https://www.anywho.com/phone-search");
  // Fill the phone input
  await page.fill("input[name='phone']", dashed);
  // Submit the form
  await page.click("button[type='submit']");
  // Wait for results
  await page.waitForSelector(".result-card, .no-results", { timeout: 15000 });
  return await page.content();
}
```

### 3. Parser Strategy
Result cards use a consistent structure:

```javascript
function parseAnywhoResultCard($, root) {
  const $root = $(root);
  const displayName = $root.find(".result-name, h3").first().text().trim();
  const age = $root.find(".result-age").text().match(/(\d+)/)?.[1] || null;
  const address = $root.find(".result-address").text().trim();
  const phones = [];
  $root.find(".result-phone").each((_, el) => {
    const raw = $(el).text();
    const norm = normalizeUsPhoneDigits(raw);
    if (norm.dashed) phones.push({ display: raw, dashed: norm.dashed });
  });
  // Family members
  const relatives = [];
  $root.find(".result-relative").each((_, el) => {
    relatives.push({ name: $(el).text().trim(), path: null });
  });
  return { displayName, age, addresses: [{ label: address, formattedFull: address }], phones, relatives };
}
```

### 4. Block Detection

```javascript
function detectAnywhoBlockReason(html) {
  const text = normalizeChallengeText(html);
  if (/captcha|recaptcha|verify you are human/i.test(text)) {
    return "captcha_challenge";
  }
  if (/rate limit|too many requests/i.test(text)) {
    return "rate_limited";
  }
  if (/no results found|we couldn't find/i.test(text)) {
    return "no_match";
  }
  return null;
}
```

## Data Domains

- `person` (name, age)
- `phone_number`
- `address`
- `email`
- `relative`

## Benefits to the Program

1. **Completely Free:** No paid tier required for basic results
2. **Family Data:** Strong relative/family member listings
3. **Social Media Hints:** Sometimes includes social profile links
4. **Property Data:** Includes property ownership information
5. **Employment History:** Limited but useful workplace data

## Overlaps

- `usphonebook_phone_search`
- `truepeoplesearch`
- `fastpeoplesearch`
- `whitepages`

## Implementation Notes

- Form-submission workflow requires Playwright (not FlareSolverr GET)
- Results are AJAX-loaded; wait for `.result-card` or `.no-results` selector
- Parse should handle both list-view and detail-view result layouts
- Use conservative cooldown (2000ms+) between requests
