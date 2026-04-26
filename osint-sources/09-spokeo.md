# Spokeo.com

**URL:** https://www.spokeo.com  
**Category:** People Search / Reverse Phone  
**Access:** Browser HTML (JavaScript-heavy, Next.js app)  
**Integration Difficulty:** High

## What Data It Provides

Spokeo is a major people search platform. Limited free tier provides:

- Full name
- Age
- Location (city, state)
- Possible relatives (names only on free tier)
- Phone type hints
- Address hints (partial on free)
- Court records hints (paid)
- Social profiles hints (paid)
- Email hints (paid)
- Wealth data hints (paid)

## Search URL Patterns

### Reverse Phone
```
https://www.spokeo.com/XXX-XXX-XXXX
```
Example: `https://www.spokeo.com/555-555-5555`

### Name Search
```
https://www.spokeo.com/{First}-{Last}
```
Example: `https://www.spokeo.com/John-Smith`

### Name with Location
```
https://www.spokeo.com/{First}-{Last}/{State}
```

## Integration Strategy

### 1. URL Builder

```javascript
const BASE = "https://www.spokeo.com";

export function buildSpokeoPhoneUrl(rawPhone) {
  const dashed = String(rawPhone || "").replace(/\D/g, "").replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3");
  return `${BASE}/${encodeURIComponent(dashed)}`;
}

export function buildSpokeoNameUrl(first, last, stateAbbrev) {
  const nameSlug = `${String(first || "").trim()}-${String(last || "").trim()}`.toLowerCase();
  if (stateAbbrev) {
    return `${BASE}/${encodeURIComponent(nameSlug)}/${stateAbbrev.toLowerCase()}`;
  }
  return `${BASE}/${encodeURIComponent(nameSlug)}`;
}
```

### 2. Parser Strategy
Spokeo is a Next.js React application with JSON data embedded in the page:

```javascript
function parseSpokeoResult(html) {
  const $ = cheerio.load(html);
  
  // Extract Next.js data
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextDataMatch) {
    try {
      const nextData = JSON.parse(nextDataMatch[1]);
      // Navigate the Next.js data structure for person/phone results
      const pageProps = nextData.props?.pageProps || {};
      const results = pageProps.results || pageProps.data || [];
      
      return results.map((r) => ({
        displayName: r.name || r.displayName || null,
        age: r.age || null,
        addresses: (r.addresses || []).map((a) => ({
          label: a.fullAddress || `${a.city}, ${a.state}`,
          formattedFull: a.fullAddress,
          city: a.city,
          state: a.state,
        })),
        phones: (r.phones || []).map((p) => ({
          display: p.number,
          dashed: normalizeUsPhoneDigits(p.number).dashed,
        })),
        relatives: (r.relatives || []).map((rel) => ({
          name: rel.name,
          path: null,
        })),
      }));
    } catch {
      // Fall through to DOM parsing
    }
  }
  
  // DOM fallback parsing
  const cards = $(".card, .result-card").toArray();
  return cards.map((el) => parseSpokeoCard($, el));
}
```

### 3. Block Detection

```javascript
function detectSpokeoBlockReason(html) {
  const text = normalizeChallengeText(html);
  if (/checking your browser|just a moment|attention required/i.test(text)) {
    return "cloudflare_challenge";
  }
  if (/captcha|recaptcha|hcaptcha/i.test(text)) {
    return "captcha_challenge";
  }
  if (/results not found|did not match any results/i.test(text)) {
    return "no_match";
  }
  if (/login|sign up|purchase|unlock full report/i.test(text)) {
    return "paywall";
  }
  return null;
}
```

## Data Domains

- `person` (name, age)
- `address`
- `phone_number`
- `relative`
- `email` (paid hints)
- `social_profile` (paid hints)

## Benefits to the Program

1. **Comprehensive Database:** Large, well-maintained people database
2. **Structured Data:** Next.js embedded JSON is actually parseable without DOM scraping
3. **Cross-Reference Anchor:** Good for verifying data from other sources
4. **Relative Hints:** Free tier shows possible relative names
5. **Location Data:** Strong city/state location data

## Overlaps

- `usphonebook_phone_search`
- `usphonebook_profile`
- `truepeoplesearch`
- `fastpeoplesearch`
- `whitepages`

## Implementation Notes

- **High Difficulty:** Spokeo is heavily JavaScript-rendered and Cloudflare-protected
- **Next.js Data:** The `__NEXT_DATA__` script tag contains structured JSON - parse this first
- **Paywall Heavy:** Most detailed data requires purchase; free tier is limited
- **Session Required:** Almost certainly requires `sessionMode: "required"` with Playwright
- **Rate Limiting:** Very aggressive; use long cooldowns (5000ms+)
- **Value as Verification:** Best used to confirm names/locations found on other sources
- Parser should attempt `__NEXT_DATA__` extraction before falling back to Cheerio DOM scraping
