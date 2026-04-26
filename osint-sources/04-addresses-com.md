# Addresses.com

**URL:** https://www.addresses.com  
**Category:** Address / People / Phone Search  
**Access:** Browser HTML (powered by Intelius)  
**Integration Difficulty:** Medium

## What Data It Provides

Addresses.com is a white pages and public information search engine powered by Intelius. Free tier provides:

- Full name
- Address (current)
- Age
- Partial phone numbers
- Business listings
- Reverse phone lookup
- Reverse address lookup
- State-by-state white pages directory

## Search URL Patterns

### People Search
```
https://www.addresses.com/people/{First}+{Last}/{State}
```
Example: `https://www.addresses.com/people/John+Smith/WA`

### Reverse Phone
```
https://www.addresses.com/phone/XXX-XXX-XXXX
```
Example: `https://www.addresses.com/phone/555-555-5555`

### Reverse Address
```
https://www.addresses.com/address/{Street}/{City}-{State}
```

### State White Pages
```
https://www.addresses.com/white-pages/{State}/{Letter}
```
Example: `https://www.addresses.com/white-pages/WA/A`

## Integration Strategy

### 1. URL Builder

```javascript
const BASE = "https://www.addresses.com";

export function buildAddressesComPhoneUrl(rawPhone) {
  const dashed = String(rawPhone || "").replace(/\D/g, "").replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3");
  return `${BASE}/phone/${encodeURIComponent(dashed)}`;
}

export function buildAddressesComNameUrl(first, last, stateAbbrev) {
  return `${BASE}/people/${encodeURIComponent(first)}+${encodeURIComponent(last)}${stateAbbrev ? `/${stateAbbrev}` : ""}`;
}

export function buildAddressesComAddressUrl(street, city, stateAbbrev) {
  const streetSlug = String(street || "").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return `${BASE}/address/${streetSlug}/${encodeURIComponent(city)}-${stateAbbrev}`;
}
```

### 2. Parser Strategy
Results are displayed in listing cards:

```javascript
function parseAddressesComResultCard($, root) {
  const $root = $(root);
  const displayName = $root.find("h3, .name").first().text().trim();
  const age = $root.find(".age").text().match(/(\d+)/)?.[1] || null;
  const address = $root.find(".address").text().trim();
  const phones = [];
  $root.find(".phone").each((_, el) => {
    const raw = $(el).text();
    const norm = normalizeUsPhoneDigits(raw);
    if (norm.dashed) phones.push({ display: raw, dashed: norm.dashed });
  });
  return { displayName, age, addresses: address ? [{ label: address, formattedFull: address }] : [], phones, relatives: [] };
}
```

### 3. Block Detection

```javascript
function detectAddressesComBlockReason(html) {
  const text = normalizeChallengeText(html);
  if (/cloudflare|checking your browser|just a moment/i.test(text)) {
    return "cloudflare_challenge";
  }
  if (/captcha|recaptcha/i.test(text)) {
    return "captcha_challenge";
  }
  if (/no results|not found/i.test(text)) {
    return "no_match";
  }
  // Intelius paid redirect
  if (/intelius\.com/i.test(html) && /report|purchase/i.test(text)) {
    return "paid_redirect";
  }
  return null;
}
```

## Data Domains

- `person`
- `address`
- `phone_number`
- `org` (business listings)

## Benefits to the Program

1. **Address-Centric:** Strong reverse address lookup - find residents at an address
2. **State Directories:** Alphabetical white pages by state for enumeration
3. **Business Data:** Business listings add org entities to the graph
4. **Intelius Backend:** Same data backbone as ZabaSearch
5. **Multi-Modal:** Supports people, phone, address, and business search

## Overlaps

- `zabasearch` (same Intelius backend)
- `usphonebook_profile`
- `truepeoplesearch`
- `fastpeoplesearch`
- `whitepages`

## Implementation Notes

- Shares Intelius backend with ZabaSearch; similar terms-acceptance flow
- Reverse address search is a unique capability not in current sources
- State white pages directories can be used for bulk enumeration
- Business listings should create `org` type entities in the graph
- Paid redirects are common; parser must handle gracefully
