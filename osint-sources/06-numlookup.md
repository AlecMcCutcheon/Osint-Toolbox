# NumLookup.com

**URL:** https://www.numlookup.com  
**Category:** Reverse Phone Lookup  
**Access:** Browser HTML + Internal API  
**Integration Difficulty:** Low-Medium

## What Data It Provides

NumLookup is a free reverse phone lookup service. Free tier provides:

- Full name of owner
- Age
- Address
- Email address
- Phone carrier
- Spam risk indicator
- Location (city, state)
- First few lookups free, then subscription required

## Search URL Patterns

### Reverse Phone Lookup (Form-based)
Homepage has a phone lookup form that submits via JavaScript:
```
https://www.numlookup.com/
```

### People Search
```
https://www.numlookup.com/people-search
```

### Search Results (after form submission)
```
https://www.numlookup.com/search
```

## Integration Strategy

### 1. URL Builder

```javascript
const BASE = "https://www.numlookup.com";

export function buildNumLookupPhoneUrl() {
  // NumLookup uses form submission; return the homepage
  return `${BASE}/`;
}

export function buildNumLookupNameUrl() {
  return `${BASE}/people-search`;
}
```

### 2. Form-Submission Strategy
NumLookup uses client-side JavaScript to store the lookup number in sessionStorage and redirect:

```javascript
async function fetchNumLookupPhonePage(dashed, page) {
  await page.goto("https://www.numlookup.com/");
  await page.fill("#phone_number", dashed);
  await page.click(".btn-number-search");
  // Wait for navigation to /search
  await page.waitForURL("**/search", { timeout: 15000 });
  return await page.content();
}
```

### 3. Parser Strategy
Result page uses a structured report layout:

```javascript
function parseNumLookupResult($) {
  const displayName = $(".nl-rpl-pro__row-value").filter((_, el) => {
    return $(el).prev(".nl-rpl-pro__row-label").text().includes("Name");
  }).first().text().trim();
  
  const age = $(".nl-rpl-pro__row-value").filter((_, el) => {
    return $(el).prev(".nl-rpl-pro__row-label").text().includes("Age");
  }).first().text().match(/(\d+)/)?.[1] || null;
  
  const address = $(".nl-rpl-pro__row-value").filter((_, el) => {
    return $(el).prev(".nl-rpl-pro__row-label").text().includes("Address");
  }).first().text().trim();
  
  const email = $(".nl-rpl-pro__row-value").filter((_, el) => {
    return $(el).prev(".nl-rpl-pro__row-label").text().includes("Email");
  }).first().text().trim() || null;
  
  const carrier = $(".nl-rpl-pro__row-value").filter((_, el) => {
    return $(el).prev(".nl-rpl-pro__row-label").text().includes("Carrier");
  }).first().text().trim() || null;
  
  return {
    displayName: displayName || null,
    age: age ? Number(age) : null,
    addresses: address ? [{ label: address, formattedFull: address }] : [],
    emails: email ? [email] : [],
    phones: [],
    carrier,
    spamRisk: null,
    relatives: []
  };
}
```

### 4. Block Detection

```javascript
function detectNumLookupBlockReason(html) {
  const text = normalizeChallengeText(html);
  if (/captcha|recaptcha/i.test(text)) {
    return "captcha_challenge";
  }
  if (/no results|not found|invalid phone/i.test(text)) {
    return "no_match";
  }
  if (/limit reached|upgrade|subscription/i.test(text)) {
    return "quota_exceeded";
  }
  return null;
}
```

## Data Domains

- `person` (name, age)
- `phone_number` (carrier, spam risk)
- `address`
- `email`

## Benefits to the Program

1. **Carrier Intelligence:** Provides carrier info and spam risk - enriches phone metadata
2. **Email Discovery:** One of the few free sources that provides email addresses
3. **Structured Reports:** Clean, consistent report layout makes parsing reliable
4. **Low Block Rate:** Generally less aggressive anti-bot protection than major directories
5. **Fast Results:** Quick lookup with minimal page weight

## Overlaps

- `usphonebook_phone_search`
- `truepeoplesearch`
- `fastpeoplesearch`
- `whitepages`

## Implementation Notes

- Free tier is limited (first few lookups); rotate sessions or use sparingly
- The form submission stores data in sessionStorage before redirecting
- Results page has a consistent `.nl-rpl-pro*` class structure
- Spam risk indicators add trust/scam assessment value
- Carrier data should be merged into existing phone entity metadata
- Use as a secondary enrichment source rather than primary due to lookup limits
