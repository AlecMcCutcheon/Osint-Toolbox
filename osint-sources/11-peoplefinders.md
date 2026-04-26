# PeopleFinders.com

**URL:** https://www.peoplefinders.com  
**Category:** People Search / Public Records  
**Access:** Browser HTML  
**Integration Difficulty:** Medium

## What Data It Provides

PeopleFinders is a people search and public records aggregator. Free tier provides:

- Full name
- Age
- Current and past addresses
- Phone numbers
- Relatives
- Associates
- Property records
- Court records (hints)
- Marriage/divorce records (hints)
- Business affiliations

## Search URL Patterns

### Reverse Phone
```
https://www.peoplefinders.com/phone/{XXX-XXX-XXXX}
```
Example: `https://www.peoplefinders.com/phone/555-555-5555`

### People Search
```
https://www.peoplefinders.com/people/{first}-{last}
```

### People Search with Location
```
https://www.peoplefinders.com/people/{first}-{last}/{state}/{city}
```

## Integration Strategy

### 1. URL Builder

```javascript
const BASE = "https://www.peoplefinders.com";

export function buildPeopleFindersPhoneUrl(rawPhone) {
  const dashed = String(rawPhone || "").replace(/\D/g, "").replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3");
  return `${BASE}/phone/${encodeURIComponent(dashed)}`;
}

export function buildPeopleFindersNameUrl(first, last, stateSlug, citySlug) {
  const nameSlug = `${String(first || "").trim()}-${String(last || "").trim()}`.toLowerCase();
  if (citySlug && stateSlug) {
    return `${BASE}/people/${nameSlug}/${stateSlug.toLowerCase()}/${citySlug.toLowerCase()}`;
  }
  if (stateSlug) {
    return `${BASE}/people/${nameSlug}/${stateSlug.toLowerCase()}`;
  }
  return `${BASE}/people/${nameSlug}`;
}
```

### 2. Parser Strategy

```javascript
function parsePeopleFindersResultCard($, root) {
  const $root = $(root);
  const displayName = $root.find("h2, h3, .name").first().text().trim();
  const age = $root.find(".age").text().match(/(\d+)/)?.[1] || null;
  
  const addresses = [];
  $root.find(".address").each((_, el) => {
    const label = $(el).text().trim();
    const isCurrent = $(el).hasClass("current") || $(el).closest(".current-address").length > 0;
    addresses.push({ label, formattedFull: label, isCurrent });
  });
  
  const phones = [];
  $root.find(".phone").each((_, el) => {
    const raw = $(el).text();
    const norm = normalizeUsPhoneDigits(raw);
    if (norm.dashed) phones.push({ display: raw, dashed: norm.dashed });
  });
  
  const relatives = [];
  $root.find(".relative").each((_, el) => {
    relatives.push({ name: $(el).text().trim(), path: null });
  });
  
  const associates = [];
  $root.find(".associate").each((_, el) => {
    associates.push({ name: $(el).text().trim(), path: null });
  });
  
  return { displayName, age, addresses, phones, relatives, associates };
}
```

### 3. Block Detection

```javascript
function detectPeopleFindersBlockReason(html) {
  const text = normalizeChallengeText(html);
  if (/captcha|recaptcha|verify you are human/i.test(text)) {
    return "captcha_challenge";
  }
  if (/no results|not found|we couldn't find/i.test(text)) {
    return "no_match";
  }
  if (/purchase|unlock|view full report/i.test(text) && !/result-card/i.test(html)) {
    return "paywall";
  }
  return null;
}
```

## Data Domains

- `person`
- `address`
- `phone_number`
- `relative`
- `associate`
- `org` (business affiliations)

## Benefits to the Program

1. **Associates Data:** Unique "associates" field shows non-family connections
2. **Marriage Records:** Hints at marital status and spouse connections
3. **Business Affiliations:** Links people to organizations
4. **Property Records:** Ownership data enriches address entities
5. **Cross-Reference Value:** Strong for verifying data from primary sources

## Overlaps

- `usphonebook_phone_search`
- `usphonebook_profile`
- `truepeoplesearch`
- `fastpeoplesearch`
- `whitepages`

## Implementation Notes

- Associates should be stored similarly to relatives but with a different edge type
- Business affiliations should create `org` entities with `affiliated_with` edges
- Marriage/divorce hints can create `spouse` or `was_married_to` edges
- Property ownership data should merge with assessor_records data
- The site has moderate anti-bot protection; Playwright with session warmup recommended
- Paid redirects are common for detailed reports; free tier still provides good summary data
