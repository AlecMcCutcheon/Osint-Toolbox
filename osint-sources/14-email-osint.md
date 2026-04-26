# Email OSINT

**Category:** Email Intelligence / Contact Discovery  
**Access:** Direct HTTP + Browser HTML  
**Integration Difficulty:** Low-Medium

## Overview

Email OSINT techniques discover and verify email addresses associated with people, organizations, and domains. These are passive, low-risk collection methods that complement the existing people-search pipeline.

## Sources and Techniques

### 1. Hunter.io (Free Tier)
**URL:** https://hunter.io

**Data Available (Free):**
- Email addresses by domain
- Email pattern guessing (e.g., `{first}.{last}@company.com`)
- Email verification status
- Sources (where the email was found)
- 25 searches/month free

**Search Patterns:**
```
https://hunter.io/find/{domain}
https://hunter.io/search/{name}%20{domain}
```

**Integration:**
```javascript
const BASE = "https://hunter.io";

export function buildHunterDomainSearchUrl(domain) {
  return `${BASE}/find/${encodeURIComponent(domain)}`;
}

export function buildHunterPersonSearchUrl(first, last, domain) {
  return `${BASE}/search/${encodeURIComponent(`${first} ${domain}`)}`;
}
```

**Parser:**
```javascript
function parseHunterResult($) {
  const emails = [];
  $(".email-result").each((_, el) => {
    const email = $(el).find(".email").text().trim();
    const status = $(el).find(".verification-status").text().trim();
    const sources = $(el).find(".source").map((_, s) => $(s).text().trim()).get();
    emails.push({ email, status, sources });
  });
  return { emails };
}
```

### 2. Email-Format.com
**URL:** https://www.email-format.com

**Data Available:**
- Common email patterns for a domain
- Example email addresses

**Search Pattern:**
```
https://www.email-format.com/d/{domain}
```

**Integration:**
```javascript
export function buildEmailFormatUrl(domain) {
  return `https://www.email-format.com/d/${encodeURIComponent(domain)}`;
}
```

### 3. Email Permutation Guessing
Local logic that generates likely email patterns from a person's name and a domain:

```javascript
function generateEmailPermutations(first, last, domain) {
  const f = first.toLowerCase().trim();
  const l = last.toLowerCase().trim();
  const fi = f[0];
  const li = l[0];
  
  return [
    `${f}@${domain}`,
    `${l}@${domain}`,
    `${f}.${l}@${domain}`,
    `${f}${l}@${domain}`,
    `${fi}${l}@${domain}`,
    `${f}${li}@${domain}`,
    `${fi}.${l}@${domain}`,
    `${f}.${li}@${domain}`,
    `${l}.${f}@${domain}`,
    `${fi}${li}@${domain}`,
    `${f}-${l}@${domain}`,
    `${f}_${l}@${domain}`,
    `${l}_${f}@${domain}`,
  ];
}
```

### 4. Google Dorks for Email Discovery
```
site:linkedin.com "John Smith" "@company.com"
site:facebook.com "John Smith" "email"
"john.smith" "@company.com" filetype:pdf
```

These can be automated via search engine scraping (with rate limits).

## Integration Strategy

### 1. Email Enrichment Pipeline
When a person entity has a workplace identified, trigger email discovery:

```javascript
async function enrichPersonEmails(personEntity) {
  const workplaces = personEntity.data.workplaces || [];
  const emails = [];
  
  for (const workplace of workplaces) {
    const domain = extractDomain(workplace.website || workplace.name);
    if (!domain) continue;
    
    // Try Hunter.io
    const hunterEmails = await fetchHunterEmails(domain, personEntity.label);
    emails.push(...hunterEmails);
    
    // Try email-format pattern guessing
    const patterns = await fetchEmailFormatPatterns(domain);
    const permutations = generateEmailPermutations(
      personEntity.data.givenName,
      personEntity.data.familyName,
      domain
    );
    
    // Match patterns against permutations
    for (const pattern of patterns) {
      const matched = permutations.find((p) => patternMatches(p, pattern));
      if (matched) emails.push({ email: matched, source: "email_format_guess" });
    }
  }
  
  return emails;
}
```

### 2. Email Verification
Use local logic or external verification (carefully rate-limited):
- SMTP handshake verification (risky, may blacklist)
- Pattern-based confidence scoring
- Cross-reference with sources that list emails (CocoFinder, NumLookup, etc.)

## Data Domains

- `email`
- `org` (workplace domain)
- `person` (linked via has_email edge)

## Benefits to the Program

1. **Contact Completeness:** Email addresses are critical contact points for investigations
2. **Workplace Confirmation:** Email domain confirms workplace affiliation
3. **Cross-Platform Pivot:** Email is the universal key for cross-referencing online accounts
4. **Low Risk:** Passive collection via public sources and local logic
5. **Graph Enrichment:** Adds `email` entities connected to person nodes

## Overlaps

- `usphonebook_profile` (some profiles list emails)
- `cocofinder` (lists emails)
- `numlookup` (lists emails)
- `public_web_directories`

## Implementation Notes

- Hunter.io free tier is limited (25 searches/month); use sparingly
- Email permutation guessing is completely free and local
- Store email confidence levels: `verified`, `pattern_match`, `guessed`
- Never perform SMTP verification without explicit user consent (risk of IP blacklisting)
- Email entities should use the existing `email` type with `has_email` edges
- Consider email format pattern caching by domain to avoid repeated lookups
- The `org` entity type should store known email domains for pattern matching
