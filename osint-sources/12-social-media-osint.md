# Social Media OSINT

**Category:** Social Media Intelligence  
**Access:** Browser HTML (varies by platform)  
**Integration Difficulty:** High

## Overview

Social media platforms contain vast amounts of public personal information. While most platforms restrict automated access via APIs, public profile pages can still be scraped using browser automation for OSINT enrichment.

## Platforms and Data

### Facebook
**URL:** https://www.facebook.com

**Search Patterns:**
```
https://www.facebook.com/search/people/?q=First+Last
https://www.facebook.com/search/people/?q=phone%3A%2B15555555555
```

**Data Available (Public Profiles):**
- Name
- Profile photo
- Location (city, hometown)
- Workplace
- Education
- Public posts
- Friend count
- Relationship status

**Integration Notes:**
- Facebook heavily restricts automated access; requires logged-in session
- Search by phone number works if the number is public on the profile
- Graph search has been limited; people search is the primary vector
- **High risk of account ban** - use dedicated OSINT accounts

### LinkedIn
**URL:** https://www.linkedin.com

**Search Patterns:**
```
https://www.linkedin.com/pub/dir/First/Last
https://www.linkedin.com/search/results/people/?keywords=First%20Last
```

**Data Available (Public Profiles):**
- Name
- Headline/occupation
- Current and past workplaces
- Education history
- Location
- Profile photo
- Connection count
- Skills

**Integration Notes:**
- LinkedIn aggressively blocks scrapers; requires session management
- Public profiles show limited data without login
- Sales Navigator or Recruiter accounts have better search
- **High ban risk** - rotate sessions carefully

### Twitter/X
**URL:** https://x.com

**Search Patterns:**
```
https://x.com/search?q=First+Last&f=user
https://x.com/search?q=5555555555
```

**Data Available:**
- Username/handle
- Display name
- Bio
- Location (self-reported)
- Website link
- Public tweets
- Follower/following counts
- Profile photo

**Integration Notes:**
- X requires login for most searches now
- Phone number search in tweets can reveal associations
- Advanced search operators available: `from:username`, `to:username`, etc.
- Nitter instances (if available) provide alternative access

### Instagram
**URL:** https://www.instagram.com

**Search Patterns:**
```
https://www.instagram.com/{username}
```

**Data Available (Public Profiles):**
- Username
- Display name
- Bio
- Website link
- Public posts (photos/videos)
- Follower/following counts
- Profile photo

**Integration Notes:**
- Instagram heavily rate-limits unauthenticated requests
- Profile pages are JavaScript-rendered; requires Playwright
- Search by name is limited; username knowledge is preferred
- **Very high ban risk** for automated access

## Integration Strategy

### 1. URL Builders

```javascript
export function buildFacebookPeopleSearchUrl(name) {
  return `https://www.facebook.com/search/people/?q=${encodeURIComponent(name)}`;
}

export function buildLinkedInDirUrl(first, last) {
  return `https://www.linkedin.com/pub/dir/${encodeURIComponent(first)}/${encodeURIComponent(last)}`;
}

export function buildTwitterSearchUrl(query) {
  return `https://x.com/search?q=${encodeURIComponent(query)}&f=user`;
}
```

### 2. Parser Strategy

```javascript
function parseFacebookProfile($) {
  return {
    displayName: $("h1").first().text().trim(),
    location: $("[data-testid='profile_location']").text().trim() || null,
    workplace: $("[data-testid='profile_work']").text().trim() || null,
    education: $("[data-testid='profile_education']").text().trim() || null,
    relationship: $("[data-testid='profile_relationship']").text().trim() || null,
  };
}

function parseLinkedInProfile($) {
  return {
    displayName: $("h1").first().text().trim(),
    headline: $(".top-card-layout__headline").text().trim() || null,
    location: $(".top-card-layout__first-subline").text().trim() || null,
    workplaces: $(".experience-item__title").map((_, el) => $(el).text().trim()).get(),
    education: $(".education-item__title").map((_, el) => $(el).text().trim()).get(),
  };
}
```

## Data Domains

- `person` (name, location, education, workplace)
- `social_profile` (platform, username, URL)
- `org` (workplaces)
- `email` (from bio/website links)
- `address` (location hints)

## Benefits to the Program

1. **Digital Footprint:** Social media provides the richest behavioral and connection data
2. **Workplace Intelligence:** LinkedIn employment history is unmatched for professional OSINT
3. **Photo Verification:** Profile photos aid identity confirmation across sources
4. **Connection Mapping:** Friend/follower networks reveal social graphs
5. **Self-Reported Data:** Users voluntarily provide accurate location, workplace, education

## Overlaps

- `usphonebook_profile`
- `peekyou`
- `public_web_directories`

## Implementation Notes

- **HIGH RISK:** All major social platforms aggressively ban scrapers
- Use **dedicated OSINT accounts** with realistic usage patterns
- Implement **session rotation** and **request jitter** to avoid detection
- Prefer **Playwright with persistent contexts** that mimic real browser behavior
- Consider using **alternative frontends** (Nitter for Twitter, Bibliogram alternatives for Instagram) where available
- Store social profile URLs as entity data for manual analyst follow-up
- Social media should be treated as **enrichment** rather than primary collection
- Add `social_profile` entity type to the graph with edges `has_profile` from person
