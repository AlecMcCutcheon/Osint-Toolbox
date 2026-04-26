# SpyDialer.com

**URL:** https://www.spydialer.com  
**Category:** Reverse Phone Lookup / Voicemail Lookup  
**Access:** Browser HTML  
**Integration Difficulty:** Medium

## What Data It Provides

SpyDialer is a free reverse phone lookup with a unique voicemail retrieval feature. Provides:

- Owner name
- Voicemail greeting (audio) - unique feature
- Photo (if available)
- Address
- Email address
- Social media hints
- Spam/scam reports from users
- Works with mobile, landline, and VoIP numbers
- Claims to work with non-published numbers

## Search URL Patterns

### Reverse Phone Lookup
```
https://www.spydialer.com/default.aspx?PhoneNo=XXXXXXXXXX
```
Example: `https://www.spydialer.com/default.aspx?PhoneNo=5555555555`

### Voicemail Lookup
```
https://www.spydialer.com/voicemail.aspx?PhoneNo=XXXXXXXXXX
```

## Integration Strategy

### 1. URL Builder

```javascript
const BASE = "https://www.spydialer.com";

export function buildSpyDialerPhoneUrl(rawPhone) {
  const digits = String(rawPhone || "").replace(/\D/g, "");
  return `${BASE}/default.aspx?PhoneNo=${encodeURIComponent(digits)}`;
}

export function buildSpyDialerVoicemailUrl(rawPhone) {
  const digits = String(rawPhone || "").replace(/\D/g, "");
  return `${BASE}/voicemail.aspx?PhoneNo=${encodeURIComponent(digits)}`;
}
```

### 2. Parser Strategy
SpyDialer has a unique layout with voicemail integration:

```javascript
function parseSpyDialerResult($) {
  const displayName = $(".result-name, #name").first().text().trim();
  const address = $(".result-address, #address").first().text().trim();
  const email = $(".result-email, #email").first().text().trim() || null;
  
  // Voicemail audio link
  const voicemailUrl = $("audio source").attr("src") || $("a[href*='voicemail']").attr("href") || null;
  
  // Photo
  const photoUrl = $(".result-photo img, #photo img").attr("src") || null;
  
  // User reports
  const reports = [];
  $(".report-item, .user-report").each((_, el) => {
    reports.push($(el).text().trim());
  });
  
  return {
    displayName: displayName || null,
    addresses: address ? [{ label: address, formattedFull: address }] : [],
    emails: email ? [email] : [],
    voicemailUrl,
    photoUrl,
    userReports: reports,
    relatives: []
  };
}
```

### 3. Block Detection

```javascript
function detectSpyDialerBlockReason(html) {
  const text = normalizeChallengeText(html);
  if (/captcha|recaptcha|verify you are human/i.test(text)) {
    return "captcha_challenge";
  }
  if (/no results|not found|invalid number/i.test(text)) {
    return "no_match";
  }
  if (/daily limit|50 lookups|maximum reached/i.test(text)) {
    return "quota_exceeded";
  }
  return null;
}
```

## Data Domains

- `person` (name, photo)
- `address`
- `email`
- `phone_number` (voicemail, user reports)

## Benefits to the Program

1. **Voicemail Intelligence:** UNIQUE capability - hearing the voicemail greeting confirms identity
2. **Photo Matching:** Profile photos aid visual verification of person entities
3. **User Reports:** Crowdsourced spam/scam reports add trust indicators
4. **Non-Published Numbers:** Claims to work with unlisted numbers
5. **High Success Rate:** User testimonials report >90% success rate

## Overlaps

- `usphonebook_phone_search`
- `truepeoplesearch`
- `fastpeoplesearch`
- `numlookup`

## Implementation Notes

- **Voicemail audio can be downloaded** and stored as evidence; adds a unique data type
- Daily limit of ~50 lookups per IP/session; implement strict cooldown
- Photo URLs should be downloaded and stored locally (hotlink protection likely)
- User spam reports should be stored as phone entity metadata
- The voicemail feature requires audio file handling infrastructure
- Consider adding a new edge type `voicemail_from` linking phone to audio evidence
- This source is best used as a **tactical enrichment** for high-value numbers due to lookup limits
