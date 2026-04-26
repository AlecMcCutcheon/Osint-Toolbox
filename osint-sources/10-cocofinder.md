# CocoFinder

**URL:** https://cocofinder.com  
**Category:** People Search / Reverse Phone / Background Check  
**Access:** Browser HTML  
**Integration Difficulty:** Medium

## What Data It Provides

CocoFinder is a free people search and background check platform. Free tier provides:

- Full name
- Age and date of birth
- Current and past addresses
- Phone numbers
- Email addresses
- Criminal records (hints)
- Court records (hints)
- Relatives and associates
- Social media profiles (hints)
- Property records (hints)

## Search URL Patterns

### Reverse Phone Lookup
```
https://cocofinder.com/phone/XXXXXXXXXX
```
Example: `https://cocofinder.com/phone/5555555555`

### People Search
```
https://cocofinder.com/people/{first}-{last}
```
Example: `https://cocofinder.com/people/john-smith`

### People Search with State
```
https://cocofinder.com/people/{first}-{last}/{state}
```

### Background Check
```
https://cocofinder.com/background-check/{first}-{last}
```

## Integration Strategy

### 1. URL Builder

```javascript
const BASE = "https://cocofinder.com";

export function buildCocoFinderPhoneUrl(rawPhone) {
  const digits = String(rawPhone || "").replace(/\D/g, "");
  return `${BASE}/phone/${encodeURIComponent(digits)}`;
}

export function buildCocoFinderNameUrl(first, last, stateSlug) {
  const nameSlug = `${String(first || "").trim()}-${String(last || "").trim()}`.toLowerCase();
  if (stateSlug) {
    return `${BASE}/people/${nameSlug}/${stateSlug.toLowerCase()}`;
  }
  return `${BASE}/people/${nameSlug}`;
}
```

### 2. Parser Strategy
CocoFinder uses structured result cards:

```javascript
function parseCocoFinderResultCard($, root) {
  const $root = $(root);
  const displayName = $root.find("h2, h3, .name").first().text().trim();
  const age = $root.find(".age").text().match(/(\d+)/)?.[1] || null;
  const dob = $root.find(".dob").text().trim() || null;
  
  const addresses = [];
  $root.find(".address").each((_, el) => {
    const label = $(el).text().trim();
    const isCurrent = $(el).hasClass("current");
    addresses.push({ label, formattedFull: label, isCurrent });
  });
  
  const phones = [];
  $root.find(".phone").each((_, el) => {
    const raw = $(el).text();
    const norm = normalizeUsPhoneDigits(raw);
    if (norm.dashed) phones.push({ display: raw, dashed: norm.dashed });
  });
  
  const emails = [];
  $root.find(".email").each((_, el) => {
    const email = $(el).text().trim();
    if (email.includes("@")) emails.push(email);
  });
  
  const relatives = [];
  $root.find(".relative").each((_, el) => {
    relatives.push({ name: $(el).text().trim(), path: null });
  });
  
  const criminalRecords = [];
  $root.find(".criminal-record").each((_, el) => {
    criminalRecords.push($(el).text().trim());
  });
  
  return { displayName, age, dob, addresses, phones, emails, relatives, criminalRecords };
}
```

### 3. Block Detection

```javascript
function detectCocoFinderBlockReason(html) {
  const text = normalizeChallengeText(html);
  if (/captcha|recaptcha|verify you are human/i.test(text)) {
    return "captcha_challenge";
  }
  if (/no results|not found|0 results/i.test(text)) {
    return "no_match";
  }
  if (/rate limit|too many requests/i.test(text)) {
    return "rate_limited";
  }
  return null;
}
```

## Data Domains

- `person` (name, age, DOB)
- `address`
- `phone_number`
- `email`
- `relative`
- `criminal_record` (hints)

## Benefits to the Program

1. **Date of Birth:** Provides DOB which is rare on free sources - strong identity anchor
2. **Criminal Records Hints:** Free tier shows criminal record presence/absence
3. **Email Addresses:** Often includes email addresses in free results
4. **Social Media Hints:** Links to social profiles
5. **Property Records:** Additional property ownership data

## Overlaps

- `usphonebook_phone_search`
- `usphonebook_profile`
- `truepeoplesearch`
- `fastpeoplesearch`
- `zabasearch`

## Implementation Notes

- Criminal record hints should be stored as person metadata, not primary identity data
- DOB is highly valuable for disambiguating people with common names
- Social media links should be extracted and stored as social profile entities
- Property records can enrich the assessor_records source pipeline
- Rate limiting is moderate; 2500ms cooldown recommended
- Background check URLs may redirect to paid reports; detect and classify appropriately
