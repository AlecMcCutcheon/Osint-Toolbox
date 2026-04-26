# ClustrMaps.com

**URL:** https://clustrmaps.com  
**Category:** Public Records / Address-Based People Search  
**Access:** Browser HTML  
**Integration Difficulty:** Medium

## What Data It Provides

ClustrMaps is a public records aggregator focused on address-based people discovery. Provides:

- Residents at a specific address
- Property ownership records
- Property value and tax data
- Permits and licenses
- Registered businesses at address
- License holders
- 200 million people in US database
- 107 million addresses
- Alphabetical people directory by state

## Search URL Patterns

### Address Search
```
https://clustrmaps.com/a/{address_id}
```
Example: `https://clustrmaps.com/a/123-main-st-seattle-wa`

### Person Search
```
https://clustrmaps.com/p/{person_id}
```

### State/City Directory
```
https://clustrmaps.com/{state}/{city}
```
Example: `https://clustrmaps.com/wa/seattle`

### Alphabetical People Directory
```
https://clustrmaps.com/directory/{state}
```

## Integration Strategy

### 1. URL Builder

```javascript
const BASE = "https://clustrmaps.com";

export function buildClustrMapsAddressUrl(street, city, stateAbbrev) {
  const streetSlug = String(street || "").toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  const citySlug = String(city || "").toLowerCase().replace(/\s+/g, "-");
  return `${BASE}/a/${streetSlug}-${citySlug}-${stateAbbrev.toLowerCase()}`;
}

export function buildClustrMapsStateCityUrl(stateAbbrev, city) {
  const citySlug = String(city || "").toLowerCase().replace(/\s+/g, "-");
  return `${BASE}/${stateAbbrev.toLowerCase()}/${citySlug}`;
}
```

### 2. Parser Strategy
ClustrMaps organizes data by address and person profiles:

```javascript
function parseClustrMapsAddressPage($) {
  const residents = [];
  $(".resident-card, .person-item").each((_, el) => {
    const name = $(el).find(".name, h3").first().text().trim();
    const age = $(el).find(".age").text().match(/(\d+)/)?.[1] || null;
    const personUrl = $(el).find("a[href^='/p/']").attr("href") || null;
    residents.push({ name, age, profilePath: personUrl });
  });
  
  const property = {
    owner: $(".property-owner").first().text().trim() || null,
    value: $(".property-value").first().text().trim() || null,
    taxes: $(".property-taxes").first().text().trim() || null,
    yearBuilt: $(".year-built").first().text().match(/(\d{4})/)?.[1] || null,
  };
  
  const businesses = [];
  $(".business-item").each((_, el) => {
    businesses.push({
      name: $(el).find(".business-name").text().trim(),
      type: $(el).find(".business-type").text().trim(),
    });
  });
  
  return { residents, property, businesses };
}
```

### 3. Block Detection

```javascript
function detectClustrMapsBlockReason(html) {
  const text = normalizeChallengeText(html);
  if (/captcha|recaptcha|verify you are human/i.test(text)) {
    return "captcha_challenge";
  }
  if (/not found|no records|no data available/i.test(text)) {
    return "no_match";
  }
  if (/rate limit|too many requests/i.test(text)) {
    return "rate_limited";
  }
  return null;
}
```

## Data Domains

- `person` (residents)
- `address` (property details)
- `org` (businesses)
- `parcel` (property value, taxes)

## Benefits to the Program

1. **Address-Centric Discovery:** Find ALL residents at an address - unique household view
2. **Property Intelligence:** Ownership, value, and tax data enrich address entities
3. **Business Registration:** Businesses at residential addresses are investigative leads
4. **Permit Data:** Building permits reveal construction activity and timeline
5. **Household Linking:** Multiple residents at one address create natural graph edges

## Overlaps

- `usphonebook_profile`
- `assessor_records`
- `public_web_directories`

## Implementation Notes

- ClustrMaps is unique for its **address-first** data model; integrate as a pivot source
- When a profile address is found on USPhoneBook/TruePeopleSearch, query ClustrMaps for co-residents
- Property data should enrich the `address` entity with `owner`, `value`, `taxes` fields
- Businesses at addresses should create `org` entities with `at_address` edges
- The alphabetical directory can be used for bulk person enumeration
- Address slugs must be normalized consistently (street number + street name + city + state)
- Consider adding a new edge type `co_resident` or `household_member` for residents at same address
