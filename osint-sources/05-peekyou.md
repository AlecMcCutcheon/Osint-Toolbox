# PeekYou.com

**URL:** https://www.peekyou.com  
**Category:** Social Media People Search Engine  
**Access:** Browser HTML  
**Integration Difficulty:** Medium-High

## What Data It Provides

PeekYou is a free people search engine that aggregates social media profiles, news sources, homepages, and blog platforms. Provides:

- Full name
- Age
- Location (city, state)
- Social media profile links (Facebook, Twitter, LinkedIn, Instagram, etc.)
- Blog/website URLs
- News mentions
- Photo thumbnails
- Email domain hints
- Username handles across platforms

## Search URL Patterns

### Name Search
```
https://www.peekyou.com/{first}_{last}
```
Example: `https://www.peekyou.com/john_smith`

### Search with Location
```
https://www.peekyou.com/{first}_{last}/{state}/{city}
```
Example: `https://www.peekyou.com/john_smith/wa/seattle`

### Direct Profile
```
https://www.peekyou.com/{profile_id}
```

## Integration Strategy

### 1. URL Builder

```javascript
const BASE = "https://www.peekyou.com";

export function buildPeekYouNameUrl(first, last, stateSlug, citySlug) {
  const namePart = `${String(first || "").toLowerCase().trim()}_${String(last || "").toLowerCase().trim()}`;
  if (citySlug && stateSlug) {
    return `${BASE}/${namePart}/${stateSlug}/${citySlug}`;
  }
  if (stateSlug) {
    return `${BASE}/${namePart}/${stateSlug}`;
  }
  return `${BASE}/${namePart}`;
}
```

### 2. Parser Strategy
PeekYou results are organized as profile cards with social links:

```javascript
function parsePeekYouResultCard($, root) {
  const $root = $(root);
  const displayName = $root.find(".name, h2, h3").first().text().trim();
  const age = $root.find(".age").text().match(/(\d+)/)?.[1] || null;
  const location = $root.find(".location").text().trim();
  
  // Social media links
  const socialProfiles = [];
  $root.find("a[href*='facebook.com'], a[href*='twitter.com'], a[href*='linkedin.com'], a[href*='instagram.com']").each((_, el) => {
    const href = $(el).attr("href");
    const platform = href.includes("facebook") ? "facebook" 
      : href.includes("twitter") ? "twitter" 
      : href.includes("linkedin") ? "linkedin" 
      : href.includes("instagram") ? "instagram" 
      : "other";
    socialProfiles.push({ platform, url: href });
  });
  
  // Blog/website links
  const websites = [];
  $root.find("a[href^='http']").each((_, el) => {
    const href = $(el).attr("href");
    if (!href.includes("peekyou.com") && !href.includes("facebook.com") && !href.includes("twitter.com")) {
      websites.push(href);
    }
  });
  
  return { displayName, age, location, socialProfiles, websites };
}
```

### 3. Block Detection

```javascript
function detectPeekYouBlockReason(html) {
  const text = normalizeChallengeText(html);
  if (/captcha|recaptcha|verify you are human/i.test(text)) {
    return "captcha_challenge";
  }
  if (/no results|no profiles found/i.test(text)) {
    return "no_match";
  }
  if (/rate limit|too many requests/i.test(text)) {
    return "rate_limited";
  }
  return null;
}
```

## Data Domains

- `person` (name, age)
- `address` (location hint)
- `social_profile` (platform, username, URL)
- `email` (domain hints)
- `org` (workplace from LinkedIn)

## Benefits to the Program

1. **Social Media Pivot:** Unique among sources for providing social media profile links
2. **Username Correlation:** Cross-platform username discovery aids OSINT pivoting
3. **Digital Footprint:** Blog/website links expand the investigation surface
4. **Photo Intelligence:** Profile photos can aid visual verification
5. **News Mentions:** Public news references add temporal context

## Overlaps

- `usphonebook_profile`
- `truepeoplesearch`
- `public_web_directories`

## Implementation Notes

- PeekYou results are heavily social-media-oriented; parser should extract all `a[href]` links
- Profile photos can be stored as evidence URLs in entity data
- Social media links should create `social_profile` type entities or enrich person data
- Username extraction from social URLs is valuable for cross-referencing
- Some results are stale/dead links; validate URLs before storing
- Rate limiting is moderate; 2000ms cooldown recommended
